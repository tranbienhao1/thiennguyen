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
  const tag = process.argv[2] || 'v3.9.76';
  const name = process.argv[3] || `Nocturne ${tag} (Web Gapless Clone & CUE Preload Continuity + Cloud Slice Cache Invalidation + FiiO Storage Scan Path Dedup & CUE Move Guard)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 130) — Liên tục phát Gapless khi đổi \`sampleRate\` & Preload CUE + Xóa cache Cloud bền bỉ & Khử trùng lặp quét bộ nhớ FiiO/Android

#### 1. Phát Gapless, đổi \`sampleRate\` Web & Preload CUE liền mạch (\`index.html\`)
- **\`attachAudioElement\` & \`playTrack\`**: Khi \`AudioContext\` khởi tạo lại theo \`sampleRate\` mới (44.1kHz <-> 96kHz/192kHz) và nhân bản \`standbyAudio\`, tự dọn \`preloadReadyUrl\` cũ nếu \`readyState < 2\` và gọi \`clone.load()\` cho nguồn đang gắn (bổ sung guard \`readyState === 0 && networkState === 0\` trong \`playTrack\`) để không bị treo im lặng sau khi đổi DAC/tần số lấy mẫu.
- **\`preloadNext\` & \`seekPreloadedCueStandby\`**: Giữ nguyên bộ đệm \`standbyAudio\` khỏe mạnh cùng bài kế khi \`preloadNext(true)\` kích hoạt lại (trộn bài/cập nhật hàng đợi) mà vẫn làm mới token Cloud gần hết hạn, đồng thời tự tua sẵn về \`cueStart > 0\` khi nạp trước đĩa CUE khác tệp.

#### 2. Dọn \`firstSliceCache\` bền bỉ khi bài Cloud đổi nội dung & Khử trùng lặp quét Android (\`index.html\`, \`MainActivity.java\`)
- **\`deleteCachedFirstSlice\` & \`invalidateCloudTrackContent\`**: Bổ sung fallback \`openDatabase()\` khi \`state.db\` chưa mở hoặc đã đóng, đồng thời dọn sạch \`_loadedFromSliceCache\`, \`sliceEndedEarly\` và URL CDN OneDrive cũ (\`downloadUrl\`/\`downloadUrlAt\`) khi tệp Cloud thay đổi phiên bản.
- **\`reconcileMovedFiioTracks\` & \`normalizeStorageScanPathKey\` (\`MainActivity.java\`)**: Chặn ghép nhầm bài con CUE với tệp mẹ nguyên bản cùng dung lượng, giữ nguyên \`discNumber\`/\`trackNumber\`/\`year\` khi chuyển đường dẫn, và chuẩn hóa khóa đường dẫn \`/sdcard\` ↔ \`/storage/emulated/0\` cùng \`canonicalPath\` trong \`startAsyncStorageScan\` để không quét trùng giữa MediaStore và thẻ MicroSD.

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
