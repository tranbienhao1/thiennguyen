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
  const tag = 'v3.9.31';
  const name = 'Nocturne v3.9.31 (FiiO M11S UI, Album Art & Artist Overhaul)';
  const bodyText = `### Nocturne v3.9.31 (FiiO M11S UI, Album Art & Artist Overhaul)

#### Điểm mới & Cải tiến:
- **Khắc phục lỗi hiển thị Album không có ảnh bìa**: Sửa lỗi gán nhầm \`.is-artist\` (50% border radius) khiến các album không có bìa bị biến thành hình tròn thay vì bìa vuông tiêu chuẩn trên FiiO M11S.
- **Trích xuất ảnh bìa tự động (Native \`/local-cover\`)**: \`library.resolveTrackCover\` và \`instantResolveTrackCover\` tự động trích xuất ảnh bìa \`/local-cover\` cho các bài hát MicroSD (đường dẫn \`path\`) và MediaStore (\`content:// uri\`), tự động chia sẻ ảnh bìa trong cùng album mà không tốn RAM.
- **Tối ưu hóa ảnh đại diện Nghệ sĩ ở Trang chủ**: \`renderRecentArtists\` tự động tra cứu ảnh bìa từ danh mục bài hát của nghệ sĩ đó để hiển thị avatar nghệ sĩ dạng tròn sắc nét thay vì chữ cái viết tắt.
- **Nâng cấp trang chi tiết Nghệ sĩ (Artist Hero)**: Phân tách rõ ràng số lượng Album và số lượng bài hát, gắn nhãn nút *"Phát tất cả"* thay cho *"Phát album"*, và tự tạo avatar monogram nghệ sĩ trên nền dải màu tím-chàm (purple-indigo gradient) khi nghệ sĩ chưa có ảnh.
- **Hiển thị ảnh bìa tràn viền trong danh sách bài**: Nâng cấp \`object-contain\` lên \`object-cover\` cho \`.track-art img\`, loại bỏ viền đen/xám trên màn hình 5-inch 720x1280 của FiiO M11S.
- **Hỗ trợ định dạng WebP**: Bổ sung trích xuất ảnh bìa thư mục dạng \`.webp\` (\`cover.webp\`, \`folder.webp\`,...) trong \`MainActivity.java\`.

#### Tệp đính kèm:
- **Nocturne-Android.apk** (6.61 MB)`;

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
