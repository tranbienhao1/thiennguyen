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
  const tag = process.argv[2] || 'v3.9.45';
  const name = process.argv[3] || `Nocturne ${tag} (Tiền làm mới token/downloadUrl Cloud trong preloadNext, khớp CUE đa thư mục & đồng bộ tăng trưởng bộ nhớ nội bộ/MicroSD)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 99) — Tiền làm mới token/downloadUrl Cloud trong preloadNext, khớp CUE đa thư mục & đồng bộ tăng trưởng bộ nhớ nội bộ/MicroSD

#### 1. Tiền làm mới \`downloadUrl\` OneDrive & OAuth Token Google Drive / OneDrive trong \`preloadNext\` & \`preloadDsdNext\` (\`index.html\`)
- **\`prepareCloudTrackForPreload(track)\`**: Tự động phát hiện \`track.downloadUrl\` OneDrive sắp chạm ngưỡng hết hạn (còn dưới 5 phút của chu kỳ 30 phút hoặc thiếu \`downloadUrlAt\`) để xóa và xin lại link mới qua \`resolveMicrosoftDownloadUrl\`, đồng thời chủ động làm mới token Google Drive (\`ensureGoogleToken\`) và OneDrive (\`getMicrosoftToken\`) khi còn dưới 3 phút hiệu lực ngay trong bước nạp trước (\`preloadNext\` / \`preloadDsdNext\`).
- Giảm thời gian chờ thử lại preload từ 30 giây xuống 8 giây và xóa cờ lỗi preload ngay khi nạp trước thành công.

#### 2. Khớp file âm thanh gốc cho CUE đa thư mục / đổi đuôi & Đồng bộ tăng trưởng bộ nhớ nội bộ / MicroSD (\`index.html\`)
- **\`addLocalFiles\` Smart CUE Matching**: Ưu tiên khớp file âm thanh nằm cùng thư mục (\`cueDir\`), tự động bỏ tiền tố đường dẫn trong \`FILE "..."\`, hỗ trợ khớp theo tên gốc khi file nhạc đã chuyển từ \`.wav\` sang \`.flac\`/\`.ape\`/\`.wv\` hoặc file \`.cue\` có đuôi kép (\`album.flac.cue\`), và bỏ qua \`makeLocalTrack\` dư thừa khi toàn bộ CUE sub-track đã tồn tại khi quét lại thư mục.
- **\`ingestFiioScannedFilesChunk\` Incremental Upgrade**: Đồng bộ hai chiều \`existingUris\`/\`existingPaths\` khi bài hát nội bộ nhận thêm \`content://\` URI hoặc đường dẫn, bổ sung \`size\` và \`trackNumber\` còn thiếu, và tự động gọi \`restoreLocalTrackUrlSync\` để đảm bảo URL \`/local-media\` luôn hợp lệ.

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
