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
  const tag = process.argv[2] || 'v3.9.96';
  const name = process.argv[3] || `Nocturne ${tag} (Cloud Delta & Checkpoint Recovery, Native Bit-Perfect HTTP Range Stream Reconnect & Seek Sync, Cache Hygiene & Keyboard Shortcuts)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 150) — Gia cố Đồng bộ Delta/Checkpoint Cloud, Luồng Bit-Perfect HTTP Range & Phím tắt / Cache Hygiene

#### 1. Khôi phục Delta Cursor & Tiếp tục Quét Cloud Thư viện lớn (\`index.html\`)
- Bổ sung \`parseCloudRetryAfterMs\` (hỗ trợ số giây, HTTP-date và giới hạn 30s + jitter) cùng cơ chế lan truyền OAuth token mới làm tươi trong \`fetchGoogleDrivePageWithRetry\`, \`graphGet\`, \`enqueueMicrosoftSharedItems\` và \`saveMicrosoftLatestDeltaLink\`.
- Gia cố \`tryLoadGoogleChangesDelta\` và \`tryLoadMicrosoftDeltaSync\` để lưu các trang đã đồng bộ trước khi xử lý \`410 Gone\` / \`syncStateNotFound\` / lỗi mạng hoặc vượt ngưỡng trang; khôi phục checkpoint Google Drive / OneDrive khi gặp \`404\`/\`410\`, giữ hàng đợi >500 thư mục, hoãn xóa checkpoint cho đến khi hoàn tất \`scanGoogleDriveAudioShortcuts\` và chia sẻ khóa WakeLock/WifiLock \`setCloudSyncActive\` xuyên suốt cả hai nguồn Cloud.

#### 2. Tự động Kết nối lại & Tua HTTP Range cho Native Bit-Perfect Cloud (\`MainActivity.java\`, \`index.html\`)
- Triển khai \`HttpRangeMediaDataSource\` trong \`BitPerfectAudioPlayer\` (bộ nhớ đệm LRU 16 chunk × 256 KB giữ đầu/cuối tệp, xử lý \`206\`/\`416\` và chuyển hướng khác host, tự kết nối lại tối đa 5 lần khi rớt mạng hoặc EOF sớm, chờ làm mới OAuth \`401\`/\`403\`/\`404\`/\`410\` qua \`CountDownLatch\` và \`window.onNativeBitPerfectAuthRefresh\`).
- Định tuyến luồng \`google\` / \`onedrive\` trực tiếp qua \`resolveCloudBitPerfectStream\` + \`setBitPerfectStreamAuth\` không tạo \`blob:\`, phân loại lỗi \`[NET]\`/\`[AUTH]\` trong \`onNativeBitPerfectError\`, và đồng bộ tua nhanh (\`mSeekGeneration\`, gộp 90ms cho luồng mạng, \`extractor.getSampleTime()\`, giữ \`sawOutputEOS\`, \`_bpSeekHoldUntilMs\`, \`#room-seek\` \`isSeeking\`, và chuẩn hóa offset CUE trên \`seekByStep\`, \`wfCanvas\`, \`0\`–\`9\`, \`j\`/\`l\`).

#### 3. Vệ sinh Bộ nhớ đệm Cloud & Phím tắt Điều khiển (\`index.html\`, \`library-utils.js\`, Chrome E2E)
- Đồng bộ hóa việc dọn dẹp \`firstSliceCache\` theo cả khóa \`library.historyTrackKey\` (\`["google",...]\` / \`["onedrive",...]\`) lẫn tiền tố cũ trong \`clearCloudSourceCatalog\`, \`purgeCloudSliceCacheAndOrphanedCovers\` và \`defragmentCacheDatabase\`; chặn tái sinh \`cloudCatalog\` bằng \`_cloudSourceCleared\`, dọn hàng đợi metadata/persist, và tự phát hiện đổi tài khoản Google Drive / OneDrive.
- Vá lỗi null \`volume-mobile\` trong \`setGain\`, đồng bộ \`corsBypassAudio.volume\`, thông báo khóa âm lượng Bit-Perfect cho \`toggleMute\`/\`ArrowUp\`/\`ArrowDown\`, tránh xung đột phím \`n\` với Night Dimmer, và mở rộng kiểm thử Chrome CDP E2E cho \`ArrowUp\`, \`ArrowDown\`, \`u\`, \`0\`–\`9\`, \`j\`, \`l\`.

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
