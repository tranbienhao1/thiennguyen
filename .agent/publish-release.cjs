'use strict';

const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

function getGitToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execSync('git credential fill', { input, encoding: 'utf8' });
  for (const line of out.split('\n')) {
    if (line.startsWith('password=')) {
      return line.substring('password='.length).trim();
    }
  }
  throw new Error('No password in git credential output');
}

function requestJson(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json || body);
        } else {
          const err = new Error(`HTTP ${res.statusCode}: ${body}`);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function uploadAsset(uploadUrl, token, filePath, assetName) {
  const fileBuf = fs.readFileSync(filePath);
  const cleanUrl = uploadUrl.replace(/\{.*?\}$/, '') + `?name=${encodeURIComponent(assetName)}`;
  const parsed = new URL(cleanUrl);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': fileBuf.length,
        'User-Agent': 'Nocturne-Release-Agent',
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json || body);
        } else {
          reject(new Error(`Asset upload HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(fileBuf);
    req.end();
  });
}

async function main() {
  const token = getGitToken();
  const repo = 'tranbienhao1/thiennguyen';
  const tag = process.argv[2] || 'v3.9.39';
  const name = process.argv[3] || `Nocturne ${tag} (Fix ảnh bài hát & thanh phát FiiO M11S, tự phục hồi WebView, Sleep Timer & MediaSession)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} — Fix ảnh bài hát & thanh phát trên FiiO M11S, phục hồi WebView, Sleep Timer & MediaSession

#### 1. Fix ảnh bìa bài hát & thanh phát/seekbar trên FiiO M11S (\`MainActivity.java\` & \`index.html\`)
- **Ảnh bìa \`/local-cover?\`**: Tách file negative cache \`.none\` theo từng bài (\`v3src:\`) thay vì chung cả album để 1 file thiếu tag không chặn ảnh của cả album; bổ sung \`Content-Type\`, \`Content-Length\` và \`Cache-Control: no-store\` cho phản hồi lỗi; giữ nguyên DOM \`<img id="room-cover">\` khi fallback, cho phép thử lại cache-bust \`_r=1..2\`, đồng bộ \`data-album-key\` & \`displayTrack\` với ảnh online fallback.
- **Thanh phát & tiến trình Bit-Perfect / WebView 74**: Thêm fallback đọc thời lượng qua \`MediaMetadataRetriever\`, đếm frame PCM thực tế (\`writtenFramesSinceBase\`) làm dự phòng khi decoder \`presentationTimeUs\` đứng yên, đồng bộ đồng thời \`#seek\`, \`#seek-mobile\`, \`#room-seek\`, \`#fullscreen-time-cur/dur\`, \`#fullscreen-waveform\`, \`#mini-waveform\`, kèm \`-webkit-appearance: none\` chuẩn Chromium 74 và watchdog 500ms.

#### 2. Khôi phục WebView \`onRenderProcessGone\` mà không ngắt nhạc (\`MainActivity.java\`)
- **Phục hồi có giới hạn (tối đa 3 lần / 60 giây)**: Khi Chromium renderer bị crash/kill, tự khởi tạo mới \`R.id.web_view\` đúng vị trí/layout và nạp lại giao diện trong khi **giữ nguyên \`mBitPerfectPlayer\` đang phát**; tự đóng/hủy OAuth \`popupWebView\` khi gặp sự cố.

#### 3. Đồng bộ Hẹn giờ ngủ & \`navigator.mediaSession\`
- \`setSleepTimer\` và \`sleepAtTrackEnd\` tạm dừng đồng thời Web Audio, \`standbyAudio\` và \`NocturneNative.pauseBitPerfectPlayback()\`; \`playNext(-1)\` và \`#sleep-album-end\` dùng \`getCurrentPlaybackPositionSeconds()\`; \`navigator.mediaSession\` hỗ trợ đầy đủ Bit-Perfect \`play\`/\`pause\`/\`seekbackward\`/\`seekforward\` và \`applySmartSeekTime\` cho Web \`seekbackward\`.

#### Tệp đính kèm:
- **Nocturne-Android.apk**`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Nocturne-Release-Agent',
    'Content-Type': 'application/json'
  };

  let release = null;
  try {
    release = await requestJson({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/tags/${tag}`,
      method: 'GET',
      headers
    });
    console.log(`Found existing release: ${release.id}`);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  if (release) {
    console.log(`Updating release ${release.id}...`);
    release = await requestJson({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/${release.id}`,
      method: 'PATCH',
      headers
    }, JSON.stringify({ name, body: bodyText }));
  } else {
    console.log(`Creating release ${tag}...`);
    release = await requestJson({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases`,
      method: 'POST',
      headers
    }, JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name,
      body: bodyText,
      draft: false,
      prerelease: false
    }));
    console.log(`Created release: ${release.id}`);
  }

  // Check and delete existing asset if present
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      if (asset.name === 'Nocturne-Android.apk') {
        console.log(`Deleting existing asset ${asset.id}...`);
        await requestJson({
          hostname: 'api.github.com',
          path: `/repos/${repo}/releases/assets/${asset.id}`,
          method: 'DELETE',
          headers
        });
      }
    }
  }

  const apkPath = 'C:\\Users\\thien\\Downloads\\Nocturne-Android.apk';
  console.log(`Uploading ${apkPath} (${fs.statSync(apkPath).size} bytes)...`);
  const uploaded = await uploadAsset(release.upload_url, token, apkPath, 'Nocturne-Android.apk');
  console.log(`Upload complete! Download URL: ${uploaded.browser_download_url}`);
}

main().catch(err => {
  console.error('Publish error:', err);
  process.exit(1);
});
