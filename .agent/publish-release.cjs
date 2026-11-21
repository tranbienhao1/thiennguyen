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
  const tag = process.argv[2] || 'v3.9.55';
  const name = process.argv[3] || `Nocturne ${tag} (Đồng bộ đa thư mục nội bộ + ảnh bìa/đa đĩa Google Drive & OneDrive + nhận rút/cắm thẻ nhớ Android 13–15)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 109) — Đồng bộ đa thư mục nội bộ + ảnh bìa/đa đĩa Google Drive & OneDrive + hot-plug thẻ nhớ Android 13–15

#### 1. Đồng bộ thư mục nội bộ bền bỉ & tự dọn bài đã xóa (\`index.html\`, \`library-utils.js\`)
- **Lưu tối đa 8 thư mục \`FileSystemDirectoryHandle\`**: Tự động khôi phục mọi thư mục đã cấp quyền khi mở lại ứng dụng Web/Desktop thay vì chỉ giữ 1 thư mục duy nhất.
- **Bỏ qua thư mục ẩn/hệ thống & chống lỗi từng tệp**: \`collectAudioAndCoverFilesFromDirectoryHandle\` bỏ qua \`.git\`, \`$RECYCLE.BIN\`, \`System Volume Information\`, \`@eaDir\`, \`__MACOSX\`, thư mục ẩn và cô lập lỗi đọc từng tệp/thư mục con để không làm gãy cả phiên quét.
- **Tự động dọn bài đã xóa trên đĩa**: Khi quét lại thư mục đã lưu, các bài đã bị xóa khỏi ổ đĩa được dọn sạch khỏi thư viện (luôn bảo vệ bài đang phát \`state.currentId\` và thu hồi blob URL không còn dùng).

#### 2. Đồng bộ đa đĩa (\`discNumber\`/\`trackNumber\`) & kế thừa ảnh bìa thư mục cha trên Google Drive, OneDrive và Nội bộ (\`library-utils.js\`, \`index.html\`)
- **Sắp xếp chính xác album nhiều đĩa trên OneDrive & Google Drive**: \`extractDiscAndTrackFromPath\` nay đọc cả \`remotePath\` của OneDrive; \`microsoftTrack\`/\`mergeMicrosoftTrack\` nạp thêm \`item.audio.disc\` + \`item.audio.track\` từ Microsoft Graph kèm fallback từ đường dẫn thư mục; \`googleTrack\` trích số đĩa/bài từ tên tệp ngay khi quét.
- **Kế thừa ảnh bìa từ thư mục cha cho \`Disc 1\` / \`CD 2\`**: Áp dụng thống nhất qua \`resolveFolderCoverWithDiscFallback\` cho Nội bộ, OneDrive (gồm cả thư mục Shared) và tra cứu 1 cấp thư mục cha trên Google Drive để gán cả \`discNumber\` lẫn \`cover.jpg\`/\`folder.jpg\`.

#### 3. Hot-plug thẻ nhớ MicroSD / USB-OTG ổn định trên Android 13–15 & FiiO M11S (\`MainActivity.java\`, \`index.html\`)
- **Bắt đủ sự kiện cắm & rút thẻ nhớ trên Android 13–15**: \`registerStorageMountReceiver\` dùng \`Context.RECEIVER_EXPORTED\` trên Android 13+ (tránh \`SecurityException\` trên Android 14–15) và lắng nghe thêm \`ACTION_MEDIA_UNMOUNTED\`, \`ACTION_MEDIA_EJECT\`, \`ACTION_MEDIA_REMOVED\`, \`ACTION_MEDIA_BAD_REMOVAL\`.
- **Chống dội sự kiện & hàng đợi quét lại**: \`window.onAndroidStorageStateChanged\` gom burst sự kiện (1200ms) và xếp hàng quét nối tiếp khi \`fiioScanInProgress\` đang bận để không bao giờ bỏ sót sự kiện cắm/rút MicroSD hay USB-OTG.

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
