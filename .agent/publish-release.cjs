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
  const tag = process.argv[2] || 'v3.9.49';
  const name = process.argv[3] || `Nocturne ${tag} (Làm mới token metadata Cloud 401/403, gộp batch IndexedDB, khôi phục quyền FileHandle & dọn worker DSD khi Next nhanh)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 103) — Làm mới token metadata Cloud 401/403, gộp batch IndexedDB, khôi phục quyền FileHandle & dọn worker DSD khi Next nhanh

#### 1. Gia cố đọc metadata Cloud & gộp ghi batch IndexedDB (\`cloud-metadata.js\` + \`index.html\`)
- **\`cloud-metadata.js\`**: Gắn mã HTTP \`.status\` lên lỗi trả về từ \`makeRangeReader\`, \`loadReaderRangeAsync\` và \`readRemoteTags\` để tầng ứng dụng nhận diện chính xác \`401\`/\`403\`.
- **\`cloudTagRequest\` & \`googleThumbnail\`**: Tự động ép làm mới token Google Drive (\`ensureGoogleToken(true)\`) hoặc link/token OneDrive (\`getMicrosoftToken\`, \`graphGet\`) và thử lại 1 lần khi nhận \`401\`/\`403\` trong lúc đọc tag hoặc tải ảnh bìa từ xa.
- **\`queueCloudCatalogPersist\` / \`flushQueuedCloudCatalogPersist\`**: Gom ghi kết quả metadata từ \`enrichCloudTrack\` theo lô (tối đa \`12\` bài hoặc debounce \`1.5s\`), tự xả lô và \`pruneCloudCatalog\` khi hàng đợi hoàn tất hoặc trước lúc thoát (\`beforeunload\`) để giảm ghi flash trên FiiO M11S.

#### 2. Khôi phục quyền \`FileSystemFileHandle\` & tối ưu preload DSD khi bấm Next nhanh (\`index.html\`)
- **\`ensureLocalTrackPlayableUrl(track, options)\`**: Kiểm tra \`queryPermission({ mode: 'read' })\` và chủ động gọi \`requestPermission({ mode: 'read' })\` khi phát trực tiếp (\`playTrack\` truyền \`{ requestPermission: true }\`), giúp khôi phục phát bài từ thư mục cục bộ trên Desktop Web sau khi cấp lại quyền.
- **\`clearStalePreload\` & \`preloadDsdNext\`**: Hủy worker giải mã DSD nền cũ (\`stopPrefetchDsdSlice()\`) khi chuyển bài hoặc đổi bài DSD kế tiếp, và giải phóng \`next.file = null\` nếu lượt tải DSD Cloud đã bị thay thế bởi thao tác bấm Next nhanh.

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
