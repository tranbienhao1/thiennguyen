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
  const tag = process.argv[2] || 'v3.9.62';
  const name = process.argv[3] || `Nocturne ${tag} (Khôi phục token Google Drive/OneDrive sau ngủ đông Doze + nâng cấp chuyển lát DSD mượt không nhấp nháy & hợp nhất nhập M3U/M3U8)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 116) — Khôi phục token Cloud sau ngủ đông Android Doze + Nâng cấp chuyển lát DSD mượt & Hợp nhất nhập playlist M3U/M3U8

#### 1. Tự phục hồi token Google Drive & OneDrive sau Android Doze / đóng băng tab (\`index.html\`)
- **\`runCloudWakeTokenRefresh\` & sửa lỗi \`remainingMs <= 0\` trong \`runGoogleTokenKeepAliveTick\`**: Khi mở lại ứng dụng hoặc mở khóa màn hình sau nhiều giờ ngủ đông (\`onAndroidAppLifecycle('foreground')\` / \`visibilitychange\`), Nocturne tự làm mới ngầm cả Google Drive lẫn OneDrive (ngay cả khi token đã quá hạn trong lúc ngủ) và dọn sạch \`downloadUrl\` SharePoint quá tuổi để lần bấm phát đầu tiên không gặp lỗi 401/403.
- **Bảo vệ AudioFocus Native Bit-Perfect khi mở sáng màn hình**: Thêm điều kiện \`!state.isNativeBitPerfectPlaying\` trong \`visibilitychange\` để không đánh thức nhầm WebView \`AudioContext\`.

#### 2. Chuyển lát đầu -> bản đầy đủ DSD mượt mà & an toàn lỗi worker (\`index.html\`)
- **Tôn trọng mốc tua sớm \`_pendingSeekAfterFullUpgrade\` & cờ \`deck._upgradingFullAudio\`**: Khi người dùng kéo thanh tua trong lúc DSD đang giải mã xong lát đầu 2 giây, bản PCM đầy đủ nhảy thẳng tới đúng mốc tua mà không làm nhấp nháy nút Play/Pause hay thông báo Android.
- **Giải phóng triệt để khi \`dsd-worker\` báo lỗi**: Giải quyết ngay \`dsdFullResolve()\` và đặt lại \`firstSlicePlayback\` / \`fullAudioPromise\` trong cả nhánh \`message.type === 'error'\`, \`worker.onerror\` lẫn \`catch\`.

#### 3. Hợp nhất bộ nhập M3U/M3U8 & vệ sinh quét tệp nội bộ Android/FiiO (\`index.html\`)
- **\`#playlist-m3u-file-input\` & \`#playlist-import-file\`**: Dùng chung bộ phân tích \`library.parseM3u8Playlist\` (hỗ trợ UTF-8 BOM, M3U thuần, đuôi chữ hoa \`.M3U8\`) và truyền \`playlistDir\` vào \`matchPlaylistWithLibrary\`; \`ingestFiioScannedFilesChunk\` bỏ qua tệp \`.m3u\`/\`.m3u8\` để không tạo hàng bài hát hỏng trong thư viện nội bộ.

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
