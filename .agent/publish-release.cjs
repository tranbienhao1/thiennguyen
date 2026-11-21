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
  const tag = process.argv[2] || 'v3.9.53';
  const name = process.argv[3] || `Nocturne ${tag} (Sửa triệt để lỗi thanh phát Play/Pause trên FiiO M11S & Android Bit-Perfect)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 107) — Sửa triệt để lỗi thanh phát Play/Pause trên FiiO M11S & Android Bit-Perfect

#### 1. Triệt tiêu lỗi tự Pause khi bấm Play / chuyển bài trên Android 10 FiiO M11S (\`MainActivity.java\`, \`index.html\`)
- **Tái sử dụng duy nhất một \`AudioFocusRequest\` (\`requestAudioFocus\`)**: Khắc phục lỗi Android 10 (\`AudioService\`) tự gửi \`AUDIOFOCUS_LOSS\` về listener cũ và tự dừng \`BitPerfectAudioPlayer\` ngay khi người dùng bấm Play (resume) hoặc chuyển bài.
- **Chặn WebView cướp AudioFocus khi Bit-Perfect đang phát**: \`unlockAudioContextOnGesture\`, \`handleTrackRowActivation\` và \`onAndroidAppLifecycle('foreground')\` không gọi \`state.context.resume()\` khi \`BitPerfectAudioPlayer\` đang hoạt động, loại bỏ hoàn toàn hiện tượng chạm vào nút Play/Pause hay màn hình làm nhạc tự dừng.
- **Non-blocking PCM write & mở khóa Pause/Seek/Resume tức thì**: Chuyển vòng ghi \`AudioTrack.write\` trong \`BitPerfectAudioPlayer\` sang \`WRITE_NON_BLOCKING\` theo từng chunk để phản hồi Pause/Seek/Resume/Next trong <5ms (không kẹt buffer cũ), hỗ trợ resume từ trạng thái \`PLAYSTATE_STOPPED\` lẫn \`PLAYSTATE_PAUSED\`, chặn gửi vị trí cũ khi đang tạm dừng và đồng bộ lại cả trạng thái Play/Pause khi mở khóa màn hình (\`onResume\`).

#### 2. Phản hồi cảm ứng 1 chạm cho thanh phát Play/Pause trên FiiO M11S (\`index.html\`)
- **Không còn nuốt thao tác bấm nút Play/Pause sau khi chọn bài**: Bộ chống lặp click của Fast-Tap chỉ chặn click trùng trên chính phần tử vừa chạm thay vì chặn mọi click trong 450ms.
- **Bấm 1 chạm tin cậy & đồng bộ trạng thái thật từ Native**: Bổ sung \`attachReliableTransportTap\` cho các nút \`#play-button\`, \`#room-play\`, \`#mini-play\`, \`#fullscreen-play-btn\`, \`#previous-button\`, \`#next-button\` (chịu lệch tay đến 18px trên màn hình 5 inch, không double-toggle), nâng \`z-index\` cụm điều khiển trên thanh phát, đồng bộ \`handleNativeBitPerfectPlayPauseClick\` theo trạng thái thật \`isBitPerfectPlaying()\` và cộng bù \`cueStart\` khi tua CUE trên Bit-Perfect.

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
