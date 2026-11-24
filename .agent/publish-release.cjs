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
  const tag = process.argv[2] || 'v3.9.95';
  const name = process.argv[3] || `Nocturne ${tag} (Mixed Cloud/Local Preload Expiry Guard, USB DAC Mid-Playback Reconnect & Cloud Folder Cover Propagation)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 149) — Gia cố Preload Cloud/Nội bộ, USB DAC Reconnect & Lan truyền Ảnh bìa Thư mục Cloud

#### 1. Chuyển tiếp bài kế Mixed Cloud <-> Nội bộ & Phím tắt điều khiển (\`index.html\`)
- Bổ sung \`isPreloadedStandbyStaleOrErrored(next, preloadUrl)\` kiểm tra \`standbyAudio.error\`, URL OneDrive pre-signed sắp hết hạn và token Google Drive gần hết hạn; tích hợp vào \`tryReuseHealthyStandbyPreload\`, \`preloadNext\` và \`playTrack\` để tự động vô hiệu hóa URL cũ và tải lại luồng sạch khi chuyển bài.
- Bổ sung \`event.preventDefault()\` cho phím tắt \`n\` / \`p\` và mở rộng bài kiểm thử Chrome CDP E2E thực tế cho bộ phím \`n\` / \`p\` / \`s\` / \`r\`.

#### 2. Tự động dựng lại AudioTrack khi cắm lại USB DAC & Đồng bộ Bit-Perfect HUD (\`MainActivity.java\`, \`index.html\`)
- Bổ sung cờ \`mRouteRefreshWasConnect\` trong \`BitPerfectAudioPlayer\` để luôn dựng lại \`AudioTrack\` và cấu hình lại API 34 Bit-Perfect mixer khi cắm USB DAC ngoài giữa lúc đang phát (kể cả khi Android tái sử dụng \`deviceId\` hoặc đang fallback 16-bit trên loa trong).
- Reset \`state.bitPerfectLockedFormat = null\` trong \`playTrack\` tại các điểm chuyển đổi giữa DSD, Native Bit-Perfect bài mới và Web Audio để badge tần số mẫu / bit-depth không bao giờ hiển thị thông số cũ.

#### 3. Lan truyền Ảnh bìa Thư mục Cloud & Dọn dẹp Object URLs (\`library-utils.js\`, \`index.html\`)
- Mở rộng \`library.extractTrackDirectory\` hỗ trợ \`remotePath\`, \`parentPath\` / \`folderPath\`, \`remoteParentId\` (OneDrive) và \`parents[0]\` (Google Drive) đồng thời bỏ qua \`blob:\` / \`data:\` URL, giúp \`restoreCloudCatalog\` -> \`propagateAndBroadcastCovers\` lan truyền ảnh bìa chuẩn xác sau khi tải lại trang.
- Mở rộng \`pruneRemovedLocalFolderTracks\` thu hồi các \`blob:\` cover không còn được tham chiếu và gọi \`pruneOrphanedAlbumCovers()\` + \`pruneExcessObjectUrls()\`.

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
