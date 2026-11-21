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
  const tag = process.argv[2] || 'v3.9.66';
  const name = process.argv[3] || `Nocturne ${tag} (Tự dọn QuotaExceededError cho bộ đệm lát đầu Cloud + Đồng bộ thanh tua khóa màn hình Android/FiiO chuẩn CUE & Google Drive/OneDrive)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 120) — Tự dọn bộ đệm lát đầu khi cạn quota IndexedDB + Đồng bộ thanh tua khóa màn hình Android/FiiO chuẩn xác cho Cloud, Bit-Perfect & CUE

#### 1. Chống tràn dung lượng \`firstSliceCache\` trên FiiO M11S & di động (\`index.html\`)
- **Tự phục hồi khi gặp \`QuotaExceededError\`**: \`cacheFirstSlice\` phát hiện lỗi đầy bộ nhớ IndexedDB, chủ động dọn 50% lát cũ nhất (\`evictOldestFirstSlicesForQuota\`, bảo vệ bài đang phát) rồi ghi lại tự động mà không làm gián đoạn luồng phát.
- **Giới hạn gọn nhẹ cho FiiO/Android cũ & đồng bộ cờ \`firstSliceCached\`**: Siết hạn mức \`firstSliceCache\` về tối đa \`16\` mục / \`18 MiB\` trên thiết bị FiiO/Android cũ, ghi kèm \`lastAccessedAt\` chuẩn LRU, và xóa cờ \`firstSliceCached\` khi mục bị loại.

#### 2. Thanh tua & nút điều khiển khóa màn hình Android/FiiO chuẩn xác cho mọi nguồn (\`MainActivity.java\` + \`index.html\`)
- **Hiện thanh tiến độ & thời lượng cho cả Google Drive, OneDrive, DSD & CUE (kể cả FiiO M11S Chromium 74)**: Bổ sung \`NocturneNative.updateMediaSessionPosition(posMs, durMs, isPlaying)\` nối trực tiếp từ \`updatePositionState\`, đồng thời sửa lỗi \`showMediaNotification\` trước đây ghi đè mất \`ACTION_SEEK_TO\` và đặt sai tốc độ \`1.0f\` lúc đang tạm dừng.
- **Tua từ màn hình khóa / Bluetooth giữ đúng \`cueStart\`**: \`dispatchSeekToWeb\` và \`dispatchSeekOffsetToWeb\` định tuyến qua \`window.onHardwareSeekTo\` / \`window.onHardwareSeekOffset\` (có dự phòng trực tiếp xuống \`BitPerfectAudioPlayer\` khi WebView chưa sẵn sàng), giúp tua sub-track \`.cue\` không còn nhảy ngược về Track 1.

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
