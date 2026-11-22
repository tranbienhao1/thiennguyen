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
  const tag = process.argv[2] || 'v3.9.73';
  const name = process.argv[3] || `Nocturne ${tag} (OneDrive 401/403 Force-Refresh & SharePoint 404/410 Recovery + First-Slice Retry Backoff + MicroSD Delta Fast-Skip + Android SAF 403/Fallback)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 127) — Ổn định Token/URL Cloud giữa chừng + Backoff lát đầu + Quét nhanh MicroSD & Phục hồi SAF Android 11–15

#### 1. Phát nhạc Cloud ổn định khi mạng chập chờn & token/SharePoint hết hạn giữa bài (\`index.html\`, \`library-utils.js\`)
- **Làm mới cưỡng bức token OneDrive (\`getMicrosoftToken(false, true)\`)**: Khi gặp HTTP 401/403 trong lúc đang phát hoặc đồng bộ (\`graphGet\`, \`fetchCloudTrack\`, \`upgradeSliceToFullAudio\`, \`retryPendingCurrentSliceUpgrade\`, \`fetchCloudFile\`, \`loadMicrosoftAudio\`, \`fetchOneDriveMetadataBytes\`, \`fetchCloudSidecarLyrics\`), gọi \`acquireTokenSilent({ forceRefresh: true })\` qua hàng đợi riêng \`microsoftTokenForceRefreshPromise\` thay vì trả nhầm token hết hạn trong cache MSAL.
- **Khôi phục link SharePoint \`directUrl\` hết hạn 404/410**: \`fetchCloudTrack\` và \`fetchCloudFile\` bắt thêm mã 404/410 của CDN SharePoint để lấy \`resolveMicrosoftDownloadUrl\` mới hoặc chuyển thẳng về Graph \`/content\`; \`loadMicrosoftAudio\` thử cấp lại \`directUrl\` một lần nếu trước đó dùng link lưu cache rồi mới fallback sang Graph với token làm mới.
- **Tăng sức bền tải lát đầu (\`fetchAudioFirstSlice\`)**: Hỗ trợ \`FETCH_AUDIO_SLICE_MAX_ATTEMPTS = 3\` kèm backoff cấp số nhân (\`fetchAudioRetryDelayMs\`) và kiểm tra \`AbortSignal\` ở mỗi lần thử lại khi chuyển Wi-Fi -> 4G.

#### 2. Tăng tốc quét lại thẻ MicroSD lớn & Xử lý quyền SAF trên Android 11–15 (\`index.html\`, \`MainActivity.java\`)
- **Bỏ qua nhanh bài chưa đổi khi quét lại MicroSD (\`isFiioTrackRescanUnchanged\`, \`ingestFiioScannedFilesChunk\`)**: Với hàng nghìn file không đổi \`path\`/\`uri\`/\`name\`/\`size\`/\`lastModified\` và đã đủ metadata + ảnh bìa, bỏ qua bước phân tích thẻ thừa (giữ nguyên làm mới tức thì cho bài đổi kích thước, sửa tag, đổi tên hoặc thiếu bìa).
- **Bảo vệ luồng \`content://\` & kiểm tra quyền SAF bền vững (\`MainActivity.java\`)**: \`handleLocalMediaRequest\` bắt \`SecurityException\` / \`FileNotFoundException\`, tự động fallback về đường dẫn vật lý/MediaStore nếu có, hoặc trả HTTP \`403 Forbidden\` kèm header \`X-Nocturne-Storage-Error: SAF_PERMISSION_REVOKED\`; bổ sung \`getPersistedSafUrisJson()\` và \`hasValidPersistedUriPermission(uri)\` trên \`NocturneJsBridge\`.

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
