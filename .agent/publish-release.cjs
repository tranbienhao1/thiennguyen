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
  const tag = process.argv[2] || 'v3.9.51';
  const name = process.argv[3] || `Nocturne ${tag} (Gia cố BitPerfectAudioPlayer chống treo/lỗi stream & đối soát file đổi tên/di chuyển Cloud + Nội bộ)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 105) — Gia cố BitPerfectAudioPlayer chống treo/lỗi stream & đối soát file đổi tên/di chuyển Cloud + Nội bộ

#### 1. Gia cố Android \`BitPerfectAudioPlayer\` (\`MainActivity.java\`)
- **Mở khóa chuyển bài nhanh (\`stopInternal\`)**: Chủ động gọi \`pause()\` / \`flush()\` / \`stop()\` trên \`AudioTrack\` trước khi chờ \`mPlaybackThread.join(800)\` nhằm giải phóng tức thì \`AudioTrack.write(..., WRITE_BLOCKING)\` khi chuyển bài liên tục trên FiiO M11S.
- **Fallback \`content://\` bằng \`ParcelFileDescriptor\` & ước tính thời lượng**: Hỗ trợ \`openFileDescriptor(uri, "r")\` cho cả \`MediaExtractor\` lẫn \`MediaMetadataRetriever\`, kèm \`estimateBitrateDurationMs(fileBytes, bitrateBps)\` khi container thiếu trường thời lượng.
- **Chống treo luồng giải mã & rò rỉ AudioFocus**: Đẩy lỗi \`audioTrackIdx < 0\` về nhánh \`finally\` (giải phóng Focus trước khi báo Web), giới hạn vòng đợi xả EOS (\`idleDrainIterations >= 200\`), xử lý lỗi frame cắt ngắn cuối file (\`consecutiveCodecErrors >= 5\`), thoát sạch khi \`AudioTrack.write < 0\` (DAC ngắt kết nối) và bảo vệ \`mWebView != null\` khi hoàn tất bài.

#### 2. Bảo toàn & đối soát tệp nhạc đổi tên / di chuyển thư mục (\`index.html\`)
- **Google Drive & OneDrive**: \`mergeMicrosoftTrack\` không ghi đè mất \`metadataLoaded\` / \`duration\` / tag ID3-FLAC đã đọc khi chưa đổi nội dung; đồng bộ \`tryLoadGoogleChangesDelta\`, \`loadGoogleFiles\`, \`tryLoadMicrosoftDeltaSync\` và \`loadMicrosoftFiles\` cập nhật tên mới và fallback theo tên tệp mà vẫn giữ nguyên ảnh bìa, đánh giá và lịch sử phát.
- **FiiO Internal & MicroSD**: \`applyFiioRescanFields\` cập nhật lại \`path\`, \`name\`, URL \`/local-media\` và xóa khóa cũ khi tệp di chuyển giữ nguyên \`uri\`; \`reconcileMovedFiioTracks\` + \`pruneMissingFiioTracks\` tự động chuyển giao ảnh bìa, đánh giá, lời bài hát, thông số Hi-Res và khóa \`recentHistory\` khi tệp chuyển vị trí nhận \`uri\` mới duy nhất.

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
