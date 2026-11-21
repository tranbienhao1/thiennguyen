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
  const tag = process.argv[2] || 'v3.9.61';
  const name = process.argv[3] || `Nocturne ${tag} (Đồng bộ tiếp điểm dừng Cloud khi rớt mạng + nhập M3U/M3U8 đường dẫn tương đối & nạp trước Cloud khi phát Bit-Perfect)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 115) — Điểm dừng đồng bộ Cloud thông minh + Nhập playlist M3U/M3U8 chuẩn đường dẫn tương đối & Chuyển tiếp Bit-Perfect -> Cloud mượt mà

#### 1. Điểm dừng đồng bộ (Checkpoint Resume) cho thư viện Google Drive & OneDrive lớn (\`index.html\`)
- **Tiếp tục đúng trang/thư mục đang dở khi rớt mạng**: Lưu tạm \`pageToken\` (Google Drive) và hàng đợi thư mục còn lại (OneDrive, TTL 6 giờ) sau mỗi đợt quét hoặc ngay khi một cụm thư mục gặp lỗi mạng, giúp lượt đồng bộ kế tiếp tiếp tục ngay phần còn thiếu thay vì quét lại từ đầu.
- **Bảo vệ tuyệt đối thư viện đã lưu**: Tự động bỏ qua bước xóa bài thừa trên lượt đồng bộ tiếp điểm dừng (tránh xóa nhầm bài từ các trang đã quét trước đó) và tự khôi phục về trang 1 nếu \`pageToken\` đã hết hạn (HTTP 400).

#### 2. Nâng cấp đọc & khớp playlist \`.m3u\` / \`.m3u8\` cho Nội bộ & Cloud (\`library-utils.js\`)
- **Hỗ trợ UTF-8 BOM, M3U thuần không có \`#EXTM3U\`, dấu \`\\\` Windows & \`file://\`**: Giải mã an toàn ký tự \`+\` / \`%\`, trích xuất tên bài/nghệ sĩ từ tên tệp khi thiếu \`#EXTINF\`.
- **\`resolveM3uRelativePath\` & khớp hậu tố đường dẫn + Unicode NFC/NFD**: \`matchPlaylistWithLibrary\` khớp chính xác cả đường dẫn tương đối (\`../Album/01.flac\`), hậu tố thư mục-tệp và tên tệp duy nhất trên thẻ nhớ FiiO/Android, thư mục nội bộ Web, Google Drive và OneDrive.

#### 3. Nạp trước bài Cloud ngay trong lúc phát nội bộ Bit-Perfect (\`index.html\`)
- **\`preloadCloudNextDuringBitPerfect\` không chạm \`AudioContext\`**: Khi bài nội bộ đang phát ở chế độ Native Bit-Perfect gần kết thúc mà bài kế tiếp nằm trên Google Drive / OneDrive, Nocturne chủ động làm mới token/\`downloadUrl\` và tải trước lát đầu mà không gây tranh chấp AudioFocus trên Android/FiiO M11S.

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
