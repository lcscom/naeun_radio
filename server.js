const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8611;

// Vercel 프론트엔드 요청 허용을 위한 CORS 설정
app.use(cors({
    origin: '*',
    methods: ['GET', 'OPTIONS']
}));

const httpClient = axios.create({ timeout: 5000 });

// 1. KBS 클래식 FM (채널 코드: 24) 라이브 주소 파싱
async function getKbsClassic() {
    try {
        const resp = await httpClient.get('https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/24', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://onair.kbs.co.kr/'
            }
        });
        const items = resp.data.channel_item || [];
        for (const item of items) {
            if (item.media_type === 'radio' && item.service_url) {
                return item.service_url;
            }
        }
    } catch (e) {
        console.error('[KBS Parsing Error]:', e.message);
    }
    return "https://kbsfmchannel.kbs.co.kr/hls/live/2004245/1fm/master.m3u8";
}

// 2. MBC 표준FM (sfm 채널) 라이브 주소 파싱
async function getMbcSfm() {
    try {
        const resp = await httpClient.get('https://sminiplay.imbc.com/aacplay.ashx?agent=webapp&channel=sfm&callback=jarvis.miniInfo.loadOnAirComplete', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'http://mini.imbc.com/'
            }
        });
        const match = resp.data.match(/"(https:\/\/[^"]+)"/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (e) {
        console.error('[MBC Parsing Error]:', e.message);
    }
    return "https://sf.cdn.imbc.com/sf/sf_sfm/_definst_/sf_sfm.stream/playlist.m3u8";
}

// 3. 방송사 스트림 URL 반환 API
app.get('/api/get_stream_url', async (req, res) => {
    const channel = req.query.ch;
    let streamUrl = null;

    if (channel === 'mbc_fm') {
        streamUrl = await getMbcSfm();
    } else if (channel === 'kbs_classic') {
        streamUrl = await getKbsClassic();
    }

    if (streamUrl) {
        console.log(`[Stream URL Parsed Successfully - ${channel}]:`, streamUrl);
        return res.json({ status: 'success', url: streamUrl });
    } else {
        return res.status(500).json({ status: 'error', message: 'Failed to parse stream URL' });
    }
});

// 헬스체크용 엔드포인트
app.get('/', (req, res) => {
    res.send('Radio Stream Backend API is Running');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Radio Backend Server Running] Port: ${PORT}`);
});
