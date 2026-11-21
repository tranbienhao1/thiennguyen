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
  const tag = process.argv[2] || 'v3.9.58';
  const name = process.argv[3] || `Nocturne ${tag} (Chống treo mạng đồng bộ Google Drive/OneDrive + khôi phục phiên nghe Cloud chính xác & hỗ trợ tên tệp #, %, ?, + trên Android)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 112) — Chống treo mạng đồng bộ Google Drive/OneDrive + khôi phục phiên nghe Cloud chính xác & đường dẫn ký tự đặc biệt trên Android

#### 1. Chống treo đồng bộ Google Drive & OneDrive trên mạng 4G/Wi-Fi yếu (\`index.html\`)
- **\`fetchWithTimeout\` chủ động (25s API / 15s ảnh bìa)**: Tránh tình trạng \`fetch\` treo vô hạn trên kết nối di động yếu làm khóa \`cloudSyncPromise\`.
- **Thử lại tự động khi rớt mạng & tôn trọng \`Retry-After\`**: \`fetchGoogleDrivePageWithRetry\` và \`graphGet\` tự động thử lại tối đa 3 lần khi gặp lỗi mạng đột ngột hoặc quá hạn timeout, đồng thời tuân thủ header \`Retry-After\` khi gặp giới hạn HTTP 429/5xx.

#### 2. Khôi phục phiên nghe Cloud chính xác không bị cắt ở lát đầu (\`index.html\`)
- **Tua thông minh khi tiếp tục bài nghe dài từ Google Drive/OneDrive**: \`seekCurrentPlaybackToSeconds\` tự chuyển qua \`applySmartSeekTime\` nếu bài đang ở \`firstSlicePlayback\`, bảo toàn đúng mốc tua dài (vd. \`03:45\`) thay vì bị kẹp về cuối lát đầu 15 giây; nút "Tiếp tục" chủ động làm mới token/\`downloadUrl\` trước khi gọi \`playTrack\`.

#### 3. An toàn tuyệt đối với tệp nội bộ chứa ký tự \`#\`, \`%\`, \`?\`, \`+\`, \`file://\` trên Android/FiiO (\`MainActivity.java\`)
- **\`resolveReadableLocalFile\` & \`extractLocalMediaQueryParam\`**: Gỡ tiền tố \`file://\` không làm cắt cụt tại \`#\`/\`?\`, bảo vệ cả ký tự \`+\` lẫn dấu \`%\` đứng lẻ (như \`100% Love.flac\`) trước khi giải mã URL trong \`handleLocalMediaStreaming\`, và bổ sung fallback \`ParcelFileDescriptor\` cho \`fallbackMediaUri\` trong \`BitPerfectAudioPlayer\` trên Android 11–15 Scoped Storage.

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
