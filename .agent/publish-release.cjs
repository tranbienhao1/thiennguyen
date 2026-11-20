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
  const tag = process.argv[2] || 'v3.9.42';
  const name = process.argv[3] || `Nocturne ${tag} (Phát nhạc & đồng bộ Google Drive, OneDrive, Nội bộ / CUE Bit-Perfect cho Web + APK)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 96) — Nâng cấp Phát nhạc & Đồng bộ Google Drive, OneDrive, Nội bộ / CUE (Web + Android APK)

#### 1. Khắc phục đứt nhạc OneDrive khi \`directUrl\` hết hạn giữa bài (\`index.html\`)
- **\`upgradeSliceToFullAudio\`**: Khi tải nền file đầy đủ từ \`@microsoft.graph.downloadUrl\` gặp lỗi \`401\`/\`403\` (đặc biệt khi lát đầu phát từ IndexedDB cache mà link tạm đã hết hạn), tự động xóa \`track.downloadUrl\`, xin lại \`resolveMicrosoftDownloadUrl(track)\` mới hoặc fallback sang Microsoft Graph \`/content\` kèm \`Bearer token\` để không bị dừng nhạc sau lát đầu.

#### 2. Đồng bộ tăng trưởng & dọn bài đã xóa trên Google Drive và OneDrive (\`index.html\`)
- **\`loadGoogleFiles\`**: Tự động bổ sung \`parents\`, \`thumbnailUrl\`, \`size\`, \`name\` cho các bài đã lưu trong catalog từ phiên trước (để \`discoverGoogleDriveFolderArtwork\` nhận diện đầy đủ ảnh bìa thư mục) và dọn sạch các bài đã bị xóa khỏi Drive sau khi quét hoàn tất (bảo vệ bài đang phát \`state.currentId\`).
- **\`loadMicrosoftFiles\`**: Chuyển \`persistCloudCatalog\` sang chuỗi lưu nền không chặn (\`persistChain\`), tra cứu O(1) qua \`existingByRemoteId\`, cập nhật \`downloadUrl\`/\`remotePath\` mới và tự động loại bỏ các bài đã xóa khỏi OneDrive.

#### 3. Chuẩn hóa phát nhạc nội bộ & CUE sub-track trên Bit-Perfect Native (\`index.html\`)
- **\`playTrack\` & \`window.onNativeBitPerfectPosition\`**: Tự động gọi \`seekBitPerfectPlayback(Math.round(track.cueStart * 1000))\` khi khởi chạy bài CUE, hiển thị thời gian và thanh tiến trình tương đối \`0..track.duration\`, tự động chuyển bài tại ranh giới \`cueStart + duration\`, và đồng bộ \`#room-play\` theo \`isNotifPlaying\` trong \`displayTrack(track)\`.

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
