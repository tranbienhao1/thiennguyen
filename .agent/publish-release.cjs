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
  const tag = process.argv[2] || 'v3.9.60';
  const name = process.argv[3] || `Nocturne ${tag} (Khử trùng lặp ảnh bìa Cloud 10x cho thư viện lớn + LruCache RAM ảnh bìa nội bộ & quét cập nhật thẻ DATE_MODIFIED trên Android/FiiO)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 114) — Khử trùng lặp ảnh bìa Cloud cho thư viện lớn + LruCache ảnh bìa nội bộ & đồng bộ thẻ \`DATE_MODIFIED\` trên Android/FiiO

#### 1. Khử trùng lặp ảnh bìa \`base64\` theo album cho thư viện Google Drive / OneDrive lớn (\`library-utils.js\` + \`index.html\`)
- **\`deduplicateCatalogCovers\` & nén danh mục IndexedDB**: Khi 10–20 bài trong cùng một album/thư mục Cloud dùng chung một ảnh bìa \`data:image\`, Nocturne chỉ lưu 1 bản đại diện trong IndexedDB thay vì nhân bản theo từng bài (giảm tới ~10x dung lượng & RAM khi mở lại app, giữ được gấp 10 lần số album có ảnh bìa trong ngân sách 8 MiB, đồng thời vẫn bảo toàn nguyên vẹn ảnh riêng biệt cho album tổng hợp).
- **Nén gọn danh mục FiiO/Android**: \`compactFiioTrackForStorage\` lược bỏ chuỗi mặc định dư thừa (\`Unknown Artist\` / \`FiiO Internal & SD Card\`) và lưu kèm \`lastModified\` giúp thư viện >5.000–10.000 bài trên MicroSD gọn hơn ~15–20%.

#### 2. Tăng tốc ảnh bìa nội bộ & sửa đường dẫn chứa \`+\` / \`%\` trên Android/FiiO (\`MainActivity.java\`)
- **\`mCoverMemCache\` (\`LruCache\` giới hạn 3 MB trên máy RAM thấp / 6 MB trên Android thường)**: Phục vụ ảnh bìa \`/local-cover\` trực tiếp từ RAM khi cuộn lưới album mà không đọc lại flash nhiều lần, tự động giải phóng khi hệ thống gọi \`onTrimMemory\` hoặc \`clearLocalCoverCache\`.
- **Sửa lỗi 404 ảnh bìa với thư mục/tệp chứa \`+\` hoặc \`%\` lẻ**: \`handleLocalCoverArt\` sử dụng \`extractLocalMediaQueryParam\` an toàn và mở rộng hỗ trợ kế thừa ảnh bìa thư mục cha cho \`Vol\` / \`Volume\` / \`Part\`.

#### 3. Đồng bộ lại thay đổi thẻ metadata theo \`DATE_MODIFIED\` trên Android/FiiO (\`MainActivity.java\` + \`index.html\`)
- **\`scanMediaStoreAudio\` xuất \`lastModified\` (\`DATE_MODIFIED * 1000\`)**: \`applyFiioRescanFields\` tự nhận diện tệp vừa được sửa thẻ tag tại chỗ (dù giữ nguyên đường dẫn) để làm mới ngay \`title\`, \`artist\`, \`album\`, \`albumArtist\`, \`trackNumber\`, \`discNumber\`, \`year\`, \`duration\`.

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
