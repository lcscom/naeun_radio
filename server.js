const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8611;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

const httpClient = axios.create({
    timeout: 10000,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    }
});

// 1. KBS 라디오 스트림 파싱
async function getKbsStream(channelCode) {
    try {
        const resp = await httpClient.get(`https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/${channelCode}`, {
            headers: { 'Referer': 'https://onair.kbs.co.kr/' }
        });
        const items = resp.data.channel_item || [];
        for (const item of items) {
            if (item.media_type === 'radio' && item.service_url) {
                return item.service_url;
            }
        }
    } catch (e) {
        console.error(`[KBS ${channelCode} 파싱 에러]:`, e.message);
    }
    return channelCode === '25' 
        ? "https://kbsfmchannel.kbs.co.kr/hls/live/2004246/2fm/master.m3u8"
        : "https://kbsfmchannel.kbs.co.kr/hls/live/2004245/1fm/master.m3u8";
}

// 2. MBC 표준FM 스트림 파싱
async function getMbcSfm() {
    try {
        const resp = await httpClient.get('https://sminiplay.imbc.com/aacplay.ashx?agent=webapp&channel=sfm&callback=jarvis.miniInfo.loadOnAirComplete', {
            headers: { 'Referer': 'http://mini.imbc.com/' }
        });
        const match = resp.data.match(/"(https:\/\/[^"]+)"/);
        if (match && match[1]) return match[1];
    } catch (e) {
        console.error('[MBC 파싱 에러]:', e.message);
    }
    return "https://sf.cdn.imbc.com/sf/sf_sfm/_definst_/sf_sfm.stream/playlist.m3u8";
}

// 3. SBS 파워FM 스트림 파싱
async function getSbsPowerFm() {
    try {
        const resp = await httpClient.get('https://apis.sbs.co.kr/play-api/1.0/livestream/powerpc/powerfm?protocol=hls&ssl=Y', {
            headers: { 'Referer': 'https://gorealraplayer.radio.sbs.co.kr/' }
        });
        if (typeof resp.data === 'string' && resp.data.startsWith('http')) {
            return resp.data.trim();
        }
    } catch (e) {
        console.error('[SBS 파싱 에러]:', e.message);
    }
    return "https://gorealra.sbs.co.kr/gorealra/powerfm.m3u8";
}

// 라디오 파싱 API
app.get('/api/get_stream_url', async (req, res) => {
    const channel = req.query.ch;
    let streamUrl = null;

    if (channel === 'mbc_fm') streamUrl = await getMbcSfm();
    else if (channel === 'kbs_classic') streamUrl = await getKbsStream('24');
    else if (channel === 'kbs_cool') streamUrl = await getKbsStream('25');
    else if (channel === 'sbs_power') streamUrl = await getSbsPowerFm();

    if (streamUrl) {
        return res.json({ status: 'success', url: streamUrl });
    } else {
        return res.status(500).json({ status: 'error', message: 'Failed to parse stream URL' });
    }
});

// 4. 구글 포토 공유 앨범 전용 스크래퍼 API (고도화 버전)
app.get('/api/parse_google_photos', async (req, res) => {
    const albumUrl = req.query.url;
    if (!albumUrl || (!albumUrl.includes('photos.app.goo.gl') && !albumUrl.includes('photos.google.com'))) {
        return res.status(400).json({ status: 'error', message: '올바른 구글 포토 공유 링크 형태가 아닙니다.' });
    }

    try {
        console.log(`[Google Photos Scraping Start]: ${albumUrl}`);
        const resp = await httpClient.get(albumUrl);
        const html = resp.data;

        // 구글 포토의 이미지 CDN 패턴 정규식 파싱
        const regexPatterns = [
            /https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9\-_]{50,}/g,
            /https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9\-_]{50,}/g
        ];

        let extractedUrls = [];
        for (const pattern of regexPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                extractedUrls = matches;
                break;
            }
        }

        // 중복 제거 및 고화질 옵션 처리 (=w1920-h1080-no)
        const uniqueUrls = Array.from(new Set(extractedUrls))
            .filter(url => !url.includes('/a/')) // 계정 프로필 이미지 제어
            .map(url => {
                const cleanUrl = url.split('=')[0];
                return `${cleanUrl}=w1920-h1080-no`;
            });

        if (uniqueUrls.length > 0) {
            console.log(`[Google Photos Scraping Success]: ${uniqueUrls.length}개 발견`);
            return res.json({ status: 'success', count: uniqueUrls.length, images: uniqueUrls });
        } else {
            return res.status(404).json({ status: 'error', message: '앨범 내에 이미지가 없거나 비공개 앨범입니다.' });
        }
    } catch (e) {
        console.error('[Google Photos Scraping Error]:', e.message);
        return res.status(500).json({ status: 'error', message: '구글 포토 앨범 정보를 가져오는 데 실패했습니다.' });
    }
});

app.get('/', (req, res) => res.send('Radio & Google Photos Backend API Service Active'));
app.listen(PORT, '0.0.0.0', () => console.log(`[Backend Server Running] Port: ${PORT}`));
