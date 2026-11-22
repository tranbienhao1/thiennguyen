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
  const tag = process.argv[2] || 'v3.9.91';
  const name = process.argv[3] || `Nocturne ${tag} (UI Cloud Disconnect Wiring + FiiO DAC Reconnect Telemetry + Web Multi-Folder LRC/Cover Parity + Queue/Resume Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 145) — Ngắt kết nối Google Drive / OneDrive độc lập + Telemetry USB DAC + Khớp LRC/Cover kéo-thả đa thư mục & Queue/Resume Chrome E2E

#### 1. Giao diện Ngắt kết nối từng nguồn Cloud độc lập (\`disconnectCloudSource\`)
- Bổ sung nút \`#google-disconnect\` và \`#microsoft-disconnect\` trong Cài đặt, nối trực tiếp vào \`disconnectCloudSource('google' | 'onedrive')\` để hủy token, xóa lịch làm mới OAuth, đặt lại trạng thái UI và gọi \`clearCloudSourceCatalog\` mà không làm mất nhạc của nguồn khác hoặc FiiO/Nội bộ.

#### 2. Telemetry USB DAC FiiO M11S & HUD khi tạm dừng (\`getRoutedDevice\`, \`onBitPerfectFormatLocked\`)
- \`createAndConfigureBitPerfectAudioTrack\` tự động truy vấn \`built.getRoutedDevice()\` làm nhãn thiết bị khi chuyển mạch đầu ra, đồng thời \`onBitPerfectFormatLocked\` cập nhật HUD cả khi đang tạm dừng sau rút/cắm DAC và \`applyBitPerfectMode(false)\` đặt lại \`bitPerfectLockedFormat\`.

#### 3. Khớp \`.lrc\` & ảnh bìa thư mục kéo-thả đa thư mục Unicode trên Web
- Bổ sung nhánh dự phòng \`findLocalCueLrcFile\` cho file nhạc thường có tên \`.lrc\` lệch nhẹ hoặc đánh số đĩa, và chuẩn hóa Unicode NFC + chữ hoa/thường trong \`lookupLocalFolderCover\`.

#### 4. Mở rộng Chrome thật (CDP E2E)
- Kiểm chứng thêm/xóa bài trực tiếp trong \`#queue-panel\` và khôi phục banner phiên phát \`#resume-session-banner\` -> \`#resume-session-play\` sau \`Page.reload\` với \`0\` lỗi JS.

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
