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
  const tag = process.argv[2] || 'v3.9.32';
  const name = process.argv[3] || `Nocturne ${tag} (Sửa triệt để ảnh Album/Nghệ sĩ FiiO M11S + Nâng cấp FLAC/Artwork Web & Cloud)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} — Tối ưu Ảnh Album / Nghệ sĩ FiiO M11S & Nâng cấp Web / Cloud

#### 1. Sửa triệt để nguyên nhân gốc gây mất ảnh Album & Ca sĩ trên FiiO M11S (Android 10):
- **Tăng song song & gộp luồng (Single-Flight)**: Nâng \`COVER_ART_PERMITS\` từ \`2\` -> \`4\` và timeout \`4s\` -> \`15s\`, đồng bộ khóa theo hash album (\`mCoverHashLocks\`) để không trả về lỗi \`503 Busy\` khi cuộn danh sách dài trên WebView 74.
- **Đọc trực tiếp nhị phân FLAC & Vorbis Base64**: Bổ sung \`extractFlacPictureFromStream\` (block 6 \`PICTURE\` + Vorbis \`METADATA_BLOCK_PICTURE\` base64) cho mọi tệp Hi-Res FLAC kể cả khi \`MediaMetadataRetriever\` Android 10 trả về null; hỗ trợ đọc qua cả \`File\` lẫn \`content://\` URI.
- **Fallback Android 10 MediaStore \`ALBUM_ID\` + Thư mục ảnh**: Tra cứu thêm \`content://media/external/audio/albumart/<album_id>\` và kiểm tra thư mục con \`Artwork/\`, \`Cover/\`, \`Covers/\`, \`Scans/\`, \`Images/\`.
- **Làm mới cache cũ v3.9.27–v3.9.31**: Nâng namespace cache lên \`v3k:\`/\`v3s:\` (loại bỏ toàn bộ tệp âm tính \`.none\` cũ) và đặt TTL \`10 phút\` cho \`.none\`.
- **Lazy Load \`IntersectionObserver\` & Thử lại thông minh**: Chỉ tải ảnh \`/local-cover\` khi cuộn tới trên FiiO/Android cũ, thử lại 1 lần sau 1.2s trước khi đánh dấu lỗi, và tự gọi quét lại giao diện ngay cả khi quét lại không thêm bài mới (\`fiioScanUpgradedCount\`).
- **Sửa CSS WebView 74 Grid**: Bổ sung \`position: absolute\` cho ảnh trong \`.collection-art\` và \`width: 100%\` cho \`.collection-card\` để thẻ không bao giờ bị xẹp chiều cao.

#### 2. Nâng cấp mạnh cho bản Web & Cloud (Google Drive / OneDrive / Local PC):
- **Đọc thẻ & ảnh bìa FLAC thuần JS (\`parseFlacMetadataSafe\`)**: Hỗ trợ đầy đủ nhạc FLAC nội bộ (slice 2 MiB) và nhạc FLAC trên Google Drive/OneDrive qua HTTP Range không phụ thuộc CDN \`jsmediatags\`.
- **Tự động tải ảnh Album & chân dung Ca sĩ online khi thiếu ảnh nhúng**: Tích hợp API Wikipedia (vi/en) + iTunes Search API (CORS verified) cho cả Web và FiiO M11S.
- **Sửa lỗi chọn thư mục Web (\`pickFolder()\`)**: Giữ nguyên \`relativePath\` thư mục con và nạp luôn tệp lời nhạc \`.lrc\`, giúp tự động ghép \`cover.jpg\`, Suy luận Ca sĩ/Album và đồng bộ lyrics trên trình duyệt máy tính.

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
