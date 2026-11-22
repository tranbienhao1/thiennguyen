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
  const tag = process.argv[2] || 'v3.9.82';
  const name = process.argv[3] || `Nocturne ${tag} (Preload Re-Sync for Repeat/Shuffle/Autoplay/Album/Contextual Queue Across Web & Bit-Perfect + Google Drive & OneDrive Delta Sidecar .LRC & Shared Artwork Refresh)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 136) — Đồng bộ nạp trước bài kế (Web Audio + Native Bit-Perfect) & Làm mới lời .LRC / ảnh bìa thư mục chia sẻ qua Cloud Delta Sync

#### 1. Đồng bộ hủy & nạp trước bài kế khi đổi Repeat / Shuffle / Autoplay / Album / Hàng đợi (\`index.html\`)
- **Hợp nhất cơ chế \`resyncNextPreload(forceClear)\`**: Khi chuyển chế độ Repeat (\`#repeat-button\`), Shuffle (\`#shuffle-button\`), Autoplay (\`#autoplay-button\`), hoặc thêm Album / Danh sách gợi ý vào hàng đợi (\`#album-hero-queue\`, \`#contextual-queue-btn\`), tự động hủy bộ đệm \`standbyAudio\` cũ, bỏ ghim \`bpCloudPreloadTrackId\` và nạp lại đúng bài kế tiếp cho cả Web Audio lẫn Native Bit-Perfect.
- **Bảo vệ Bit-Perfect khi bấm Phát Album (\`#album-hero-play\`, \`#album-hero-shuffle\`, \`#contextual-play-btn\`)**: Không đánh thức \`AudioContext\` của WebView khi bài đầu album đang định tuyến tới Native Bit-Perfect trên FiiO M11S/Android, đồng thời dọn sạch preload cũ trước khi chuyển ngữ cảnh phát.

#### 2. Google Drive & OneDrive Delta Sync — Làm mới lời bài hát \`.lrc\` & ảnh bìa thư mục chia sẻ (\`index.html\`)
- **Google Drive Delta Sync (\`tryLoadGoogleChangesDelta\`)**: Nhận diện các tệp \`.lrc\` mới thêm/sửa hoặc shortcut trỏ tới thư mục chia sẻ, tự động mở khóa lại \`_checkedDriveLrc\` cho các bài hát cùng thư mục và làm mới danh sách thư mục ảnh bìa (\`changedArtParents\`, \`changedLrcParents\`).
- **OneDrive Delta Sync & Shared Folders (\`tryLoadMicrosoftDeltaSync\`, \`applyMicrosoftSiblingLrcLinks\`, \`loadMicrosoftFiles\`)**: Chuẩn hóa Unicode NFC khi khớp tên \`.lrc\` (tiếng Việt/Nhật), phát hiện đổi \`cTag\`/\`driveId\` và tự động xóa liên kết \`remoteLrc\` mồ côi khi tệp \`.lrc\` bị xóa trên OneDrive; bật \`forceCoverRefresh\` cho thư mục chia sẻ khi chạy Delta Sync.

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
