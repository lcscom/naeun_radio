const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8611;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

// 구글 차단 회피용 정밀 브라우저 헤더 세팅
const httpClient = axios.create({
    timeout: 15000,
    maxRedirects: 10,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
});

// 1. KBS 라디오 라이브 파싱
async function getKbsStream(channelCode) {
    try {
        const resp = await httpClient.get(`https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/${channelCode}`, {
            headers: { 'Referer': 'https://onair.kbs.co.kr/' }
        });
        const items = resp.data.channel_item || [];
        for (const item of items) {
            if (item.media_type === 'radio' && item.service_url) return item.service_url;
        }
    } catch (e) {
        console.error(`[KBS ${channelCode} 에러]:`, e.message);
    }
    return channelCode === '25' 
        ? "https://kbsfmchannel.kbs.co.kr/hls/live/2004246/2fm/master.m3u8"
        : "https://kbsfmchannel.kbs.co.kr/hls/live/2004245/1fm/master.m3u8";
}

// 2. MBC 표준FM 라이브 파싱
async function getMbcSfm() {
    try {
        const resp = await httpClient.get('https://sminiplay.imbc.com/aacplay.ashx?agent=webapp&channel=sfm&callback=jarvis.miniInfo.loadOnAirComplete', {
            headers: { 'Referer': 'http://mini.imbc.com/' }
        });
        const match = resp.data.match(/"(https:\/\/[^"]+)"/);
        if (match && match[1]) return match[1];
    } catch (e) {
        console.error('[MBC 에러]:', e.message);
    }
    return "https://sf.cdn.imbc.com/sf/sf_sfm/_definst_/sf_sfm.stream/playlist.m3u8";
}

// 3. SBS 파워FM 라이브 파싱
async function getSbsPowerFm() {
    try {
        const resp = await httpClient.get('https://apis.sbs.co.kr/play-api/1.0/livestream/powerpc/powerfm?protocol=hls&ssl=Y', {
            headers: { 'Referer': 'https://gorealraplayer.radio.sbs.co.kr/' }
        });
        if (typeof resp.data === 'string' && resp.data.startsWith('http')) return resp.data.trim();
    } catch (e) {
        console.error('[SBS 에러]:', e.message);
    }
    return "https://gorealra.sbs.co.kr/gorealra/powerfm.m3u8";
}

// 라디오 스트림 반환 API
app.get('/api/get_stream_url', async (req, res) => {
    const channel = req.query.ch;
    let streamUrl = null;

    if (channel === 'mbc_fm') streamUrl = await getMbcSfm();
    else if (channel === 'kbs_classic') streamUrl = await getKbsStream('24');
    else if (channel === 'kbs_cool') streamUrl = await getKbsStream('25');
    else if (channel === 'sbs_power') streamUrl = await getSbsPowerFm();

    if (streamUrl) return res.json({ status: 'success', url: streamUrl });
    return res.status(500).json({ status: 'error', message: 'Failed to parse stream URL' });
});

// 4. [초고도화] 구글 포토 앨범 완전 파싱 전용 API
app.get('/api/parse_google_photos', async (req, res) => {
    const albumUrl = req.query.url;
    if (!albumUrl || (!albumUrl.includes('photos.app.goo.gl') && !albumUrl.includes('photos.google.com'))) {
        return res.status(400).json({ status: 'error', message: '올바른 구글 포토 공유 링크 형태가 아닙니다.' });
    }

    try {
        console.log(`[Google Photos Parsing Target]: ${albumUrl}`);

        // 1. 단축 URL 리다이렉트 추적 수신
        const resp = await httpClient.get(albumUrl);
        const html = resp.data;

        // 2. 다중 CDN 패턴 검사 (pw 암호화 경로 + 일반 googleusercontent 경로)
        const regexPw = /https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9\-_]{40,}/g;
        const regexGeneral = /https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9\-_]{40,}/g;

        let matches = html.match(regexPw);
        if (!matches || matches.length === 0) {
            matches = html.match(regexGeneral);
        }

        if (!matches || matches.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: '앨범 내 사진을 추출하지 못했습니다. 구글 포토에서 앨범 공유가 "링크가 있는 모든 사용자"로 열려있는지 확인해 주세요.'
            });
        }

        // 3. 중복 제거 및 원본 규격 파라미터(=w1920-h1080-no) 결합
        const rawUrls = Array.from(new Set(matches));
        const finalImages = rawUrls
            .filter(url => !url.includes('/a/')) // 계정 프로필 아이콘 필터링
            .map(url => {
                const baseUrl = url.split('=')[0];
                return `${baseUrl}=w1920-h1080-no`;
            });

        console.log(`[Google Photos Success]: 총 ${finalImages.length}개 이미지 수집 성공`);
        return res.json({
            status: 'success',
            count: finalImages.length,
            images: finalImages
        });

    } catch (e) {
        console.error('[Google Photos Error]:', e.message);
        return res.status(500).json({
            status: 'error',
            message: '구글 포토 서버 연결에 실패했습니다. (Render 백엔드 통신 상태를 확인하세요)'
        });
    }
});

app.get('/', (req, res) => res.send('Smart Home Dashboard Backend Service Running'));
app.listen(PORT, '0.0.0.0', () => console.log(`[Backend Active] Port: ${PORT}`));
