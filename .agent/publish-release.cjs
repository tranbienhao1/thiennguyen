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
  const tag = process.argv[2] || 'v3.9.65';
  const name = process.argv[3] || `Nocturne ${tag} (Đồng bộ đổi tên/di chuyển thư mục & ảnh bìa Delta cho Google Drive/OneDrive + Tự tạm dừng khi rút tai nghe/USB DAC trên Android/FiiO)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 119) — Đồng bộ đổi tên/di chuyển thư mục & ảnh bìa Delta cho Google Drive / OneDrive + Tự tạm dừng chuẩn xác khi ngắt tai nghe / USB DAC trên Android/FiiO

#### 1. Đồng bộ Delta đổi tên/di chuyển thư mục & làm mới ảnh bìa Google Drive / OneDrive (\`index.html\`)
- **Google Drive Delta Sync (\`tryLoadGoogleChangesDelta\` & \`discoverGoogleDriveFolderArtwork\`)**: Nhận diện đổi tên thư mục (cập nhật \`discNumber\` khi đổi tên \`Disc N\`/\`CD N\`), di chuyển bài sang thư mục mới và thêm/thay thế ảnh bìa \`cover.jpg\`/\`folder.jpg\` để tự làm mới ảnh bìa thư mục mà không ghi đè ảnh nhúng trong tag FLAC/MP3.
- **OneDrive Delta Sync (\`tryLoadMicrosoftDeltaSync\` & \`remoteParentId\`)**: Lưu bền vững \`remoteParentId\` trên track OneDrive; khi đổi tên hoặc di chuyển thư mục cha trong chế độ Delta Sync, tự lan truyền \`remotePath\` và \`discNumber\` mới xuống các bài bên trong mà không cần xóa thư viện quét lại.

#### 2. Tự động tạm dừng thông minh khi ngắt tai nghe / USB-C DAC trên Android & FiiO (\`MainActivity.java\` + \`index.html\`)
- **Bổ sung dự phòng từ \`AudioDeviceCallback\` khi rút USB DAC / tai nghe**: Khi ngắt thiết bị âm thanh ngoài và không còn ngõ ra ngoài nào khác (\`!hasActiveExternalAudioSink()\`), \`MainActivity\` tự động kích hoạt \`triggerAudioBecomingNoisy\` (chống trùng trong 800ms) để tạm dừng ngay cả Native Bit-Perfect lẫn WebView Audio.
- **Đồng bộ thanh thông báo & chống toast thừa**: \`window.onAndroidAudioBecomingNoisy\` đồng bộ trạng thái \`paused\` lên \`MediaSession\` và thông báo khóa màn hình Android/FiiO, đồng thời chỉ hiển thị thông báo khi nhạc thực sự đang phát.

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
