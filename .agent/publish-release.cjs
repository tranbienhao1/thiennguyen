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
  const tag = process.argv[2] || 'v3.9.34';
  const name = process.argv[3] || `Nocturne ${tag} (Web PWA UX Polish + Nút Làm mới ảnh bìa Web & FiiO)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} — Hoàn thiện PWA UX & Làm mới Ảnh bìa (Web + FiiO M11S)

#### 1. Tối ưu Web PWA trên Desktop & Mobile Browser
- **Loại bỏ icon trùng trong \`manifest.json\`**: Giữ 3 entry chuẩn duy nhất (\`icon.svg\`, \`192x192\`, \`512x512\`) chuẩn Lighthouse PWA.
- **Đồng bộ \`MediaSession\` theo thời gian thực**: Khi ảnh bìa album/ca sĩ được nạp bất đồng bộ sau khi phát (\`broadcastCoverUpdate\`), thông tin \`navigator.mediaSession.metadata\` và \`setPositionState\` tự động cập nhật ngay lập tức trên khóa màn hình và điều khiển hệ thống.
- **Sửa lỗi Kéo-Thả (Drag & Drop)**: Chặn lớp phủ \`#drop-target\` bật nhầm khi kéo sắp xếp hàng đợi nội bộ (\`isExternalFileDrag\`), đồng thời giữ nguyên \`relativePath\` thư mục con khi thả cả folder album để ghép \`cover.jpg\` và \`.lrc\` chính xác.
- **Nhắc cập nhật PWA gọn nhẹ (\`notifyPwaServiceWorkerUpdate\`)**: Service Worker lắng nghe \`reg.waiting\` và \`updatefound\` để hiển thị biểu ngữ \`#update-banner\` không ép tải lại, tự lưu vị trí đang phát nếu người dùng chọn cập nhật.

#### 2. Nút "Làm mới ảnh bìa" trong Cài đặt (\`#refresh-cover-art-btn\`)
- **Xóa cache ảnh cũ 1 chạm cho cả Web & FiiO APK**: Thêm \`NocturneNative.clearLocalCoverCache()\` trên Android (\`MainActivity.java\`) kết hợp \`refreshAllArtworkCaches()\` xóa \`albumCovers\`, \`artistPortraits\`, \`failedNativeCovers\`, làm mới tham số chống cache HTTP \`&r=\` cho \`/local-cover\`, và kích hoạt quét lại ảnh bìa mà không mất thư viện hay danh sách yêu thích.

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
