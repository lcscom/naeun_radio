const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8611;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

// 1. 전역 데이터 영속 저장을 위한 파일 경로
const DDAY_FILE = path.join(__dirname, 'dday_config.json');
const DDAY_TEMP = path.join(__dirname, 'dday_config.json.tmp');

const ALBUM_FILE = path.join(__dirname, 'photo_album.json');
const ALBUM_TEMP = path.join(__dirname, 'photo_album.json.tmp');

// 초기 기본 상태
let sharedDdayConfig = { title: '나은', date: '2026-07-24' };
let sharedPhotoAlbum = {
    url: "https://photos.app.goo.gl/qSyFwXqYZ7ZhYovp8",
    images: []
};

// 원자적 파일 저장 (Atomic Write)
async function loadDb() {
    try {
        const ddayData = await fs.readFile(DDAY_FILE, 'utf8');
        sharedDdayConfig = JSON.parse(ddayData);
        console.log('[DB Loaded] D-Day Config:', sharedDdayConfig);
    } catch (e) {
        console.log('[DB Init] 기본 D-Day 설정 사용');
    }

    try {
        const albumData = await fs.readFile(ALBUM_FILE, 'utf8');
        sharedPhotoAlbum = JSON.parse(albumData);
        console.log('[DB Loaded] Album Config Images:', sharedPhotoAlbum.images.length);
    } catch (e) {
        console.log('[DB Init] 기본 앨범 설정 사용');
    }
}

async function saveDdayDb() {
    try {
        await fs.writeFile(DDAY_TEMP, JSON.stringify(sharedDdayConfig, null, 2), 'utf8');
        await fs.rename(DDAY_TEMP, DDAY_FILE);
    } catch (e) {
        console.error('[DB Save Error] D-Day:', e.message);
    }
}

async function saveAlbumDb() {
    try {
        await fs.writeFile(ALBUM_TEMP, JSON.stringify(sharedPhotoAlbum, null, 2), 'utf8');
        await fs.rename(ALBUM_TEMP, ALBUM_FILE);
    } catch (e) {
        console.error('[DB Save Error] Album:', e.message);
    }
}

loadDb();

const httpClient = axios.create({
    timeout: 15000,
    maxRedirects: 10,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    }
});

// 2. D-Day 전역 동기화 API
app.get('/api/dday', (req, res) => res.json({ status: 'success', data: sharedDdayConfig }));

app.post('/api/dday', async (req, res) => {
    const { title, date } = req.body;
    if (title) sharedDdayConfig.title = title.trim();
    if (date) sharedDdayConfig.date = date;
    await saveDdayDb();
    console.log(`[D-Day Updated]: ${sharedDdayConfig.title} / ${sharedDdayConfig.date}`);
    return res.json({ status: 'success', data: sharedDdayConfig });
});

// 3. 전역 공유 구글 포토 앨범 조회 API
app.get('/api/shared_photo_album', (req, res) => {
    return res.json({ status: 'success', data: sharedPhotoAlbum });
});

// 구글 포토 스크래핑 엔진
async function parseGooglePhotosUrl(albumUrl) {
    const resp = await httpClient.get(albumUrl);
    const html = resp.data;

    const regexPw = /https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9\-_]{40,}/g;
    const regexGeneral = /https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9\-_]{40,}/g;

    let matches = html.match(regexPw) || html.match(regexGeneral);
    if (!matches || matches.length === 0) return [];

    const rawUrls = Array.from(new Set(matches));
    return rawUrls
        .filter(url => !url.includes('/a/'))
        .map(url => `${url.split('=')[0]}=w1920-h1080-no`);
}

// 4. 구글 포토 파싱 및 전역 저장 API
app.get('/api/parse_google_photos', async (req, res) => {
    const albumUrl = req.query.url;
    if (!albumUrl || (!albumUrl.includes('photos.app.goo.gl') && !albumUrl.includes('photos.google.com'))) {
        return res.status(400).json({ status: 'error', message: '올바른 구글 포토 공유 링크가 아닙니다.' });
    }

    try {
        console.log(`[Google Photos Scraping]: ${albumUrl}`);
        const images = await parseGooglePhotosUrl(albumUrl);
        if (images.length > 0) {
            sharedPhotoAlbum = { url: albumUrl, images: images };
            await saveAlbumDb();
            console.log(`[Shared Album Updated]: ${albumUrl} (${images.length}장)`);
            return res.json({ status: 'success', count: images.length, images: images });
        } else {
            return res.status(404).json({ status: 'error', message: '앨범 내 사진을 추출하지 못했습니다. 공개 설정을 확인하세요.' });
        }
    } catch (e) {
        console.error('[Google Photos Scraping Error]:', e.message);
        return res.status(500).json({ status: 'error', message: '구글 포토 서버 파싱 중 오류가 발생했습니다.' });
    }
});

// 5. 국내 방송사 라디오 라이브 주소 파서
async function getKbsStream(channelCode) {
    try {
        const resp = await httpClient.get(`https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/${channelCode}`, {
            headers: { 'Referer': 'https://onair.kbs.co.kr/' }
        });
        const items = resp.data.channel_item || [];
        for (const item of items) {
            if (item.media_type === 'radio' && item.service_url) return item.service_url;
        }
    } catch (e) {}
    return channelCode === '25' 
        ? "https://kbsfmchannel.kbs.co.kr/hls/live/2004246/2fm/master.m3u8"
        : "https://kbsfmchannel.kbs.co.kr/hls/live/2004245/1fm/master.m3u8";
}

async function getMbcSfm() {
    try {
        const resp = await httpClient.get('https://sminiplay.imbc.com/aacplay.ashx?agent=webapp&channel=sfm&callback=jarvis.miniInfo.loadOnAirComplete', {
            headers: { 'Referer': 'http://mini.imbc.com/' }
        });
        const match = resp.data.match(/"(https:\/\/[^"]+)"/);
        if (match && match[1]) return match[1];
    } catch (e) {}
    return "https://sf.cdn.imbc.com/sf/sf_sfm/_definst_/sf_sfm.stream/playlist.m3u8";
}

async function getSbsPowerFm() {
    try {
        const resp = await httpClient.get('https://apis.sbs.co.kr/play-api/1.0/livestream/powerpc/powerfm?protocol=hls&ssl=Y', {
            headers: { 'Referer': 'https://gorealraplayer.radio.sbs.co.kr/' }
        });
        if (typeof resp.data === 'string' && resp.data.startsWith('http')) return resp.data.trim();
    } catch (e) {}
    return "https://gorealra.sbs.co.kr/gorealra/powerfm.m3u8";
}

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

app.get('/', (req, res) => res.send('Smart Home Dashboard Long-Term Production Server Active'));
app.listen(PORT, '0.0.0.0', () => console.log(`[Smart Home Production Backend Active] Port: ${PORT}`));
