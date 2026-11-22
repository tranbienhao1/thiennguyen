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
  const tag = process.argv[2] || 'v3.9.83';
  const name = process.argv[3] || `Nocturne ${tag} (Online/Offline & Screen-Wake Cloud Preload/Token Recovery + Paused Bit-Perfect Fallback Guard + MicroSD Remount URI & Cover Self-Heal)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 137) — Hồi phục nạp trước & token Cloud khi có mạng / bật màn hình + Bảo vệ Pause khi Bit-Perfect fallback + Tự làm mới URI/ảnh bìa khi gắn lại MicroSD

#### 1. Hồi phục mượt Cloud khi mất/có mạng & khi bật lại màn hình sau Doze (\`index.html\`)
- **Sự kiện \`online\` & \`offline\`**: Khi mạng hồi phục, tự động xóa mốc chặn lỗi preload cũ (\`_preloadFailedTrackId\`), chạy \`runCloudWakeTokenRefresh()\` trước khi nối lại bản nâng cấp Full-Audio và kích hoạt \`resyncNextPreload(false)\` cho cả **Web Audio lẫn Native Bit-Perfect**; khi rớt mạng (\`offline\`), tự động dọn bộ đệm preload bài Cloud chưa cache để chuyển sang bài ngoại tuyến kế tiếp.
- **\`runCloudWakeTokenRefresh()\`**: Khi bật lại màn hình sau Doze, nếu bài Cloud đang phát còn chờ nâng cấp từ First-Slice sẽ tự gọi \`retryPendingCurrentSliceUpgrade()\`, đồng thời làm mới preload nếu vừa xóa URL OneDrive hết hạn.

#### 2. Bảo vệ trạng thái Pause khi Bit-Perfect fallback & Tự hồi phục MicroSD gắn lại (\`index.html\`)
- **\`window.onNativeBitPerfectError\`**: Lưu \`wasNativeBpPaused\` trước khi đặt lại trạng thái; nếu người dùng đang tạm dừng khi USB DAC ngắt kết nối hoặc thiết bị báo lỗi Bit-Perfect, giữ nguyên trạng thái tạm dừng kèm vị trí phát \`_resumeAfterBpFallbackSec\` thay vì tự động phát nhạc ra loa ngoài.
- **\`applyFiioRescanFields\` & \`window.onAndroidStorageStateChanged('mounted')\`**: Khi gắn lại thẻ nhớ MicroSD và Android cấp lại MediaStore \`content://\` URI mới, tự xóa cache ảnh lỗi \`failedNativeCovers\`, gỡ cờ \`_localAccessError\` / \`_pathFallbackRetriedGen\` và làm mới cả \`url\` lẫn \`cover\` để nhạc và ảnh bìa phục hồi tức thì không cần khởi động lại app.

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
