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
  const tag = process.argv[2] || 'v3.9.77';
  const name = process.argv[3] || `Nocturne ${tag} (DSD Worker & Fetch Cancellation on Fast Source Switch + Android /local-media SAF Pipe/416 Range Resilience + FiiO /sdcard Normalization)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 131) — Dọn dẹp giải mã DSD khi chuyển nguồn nhanh + Phục hồi seek Range SAF & Chuẩn hóa đường dẫn FiiO/Android

#### 1. Hủy đồng bộ tải & Worker DSD khi chuyển bài/nguồn nhanh (\`index.html\`)
- **\`playTrack\`, \`stopDsdWorker\` & \`playDsdTrack\`**: Hủy \`_dsdFetchAbort\` ngay khi chuyển rời bài DSD Cloud đang tải, dọn sạch \`_pendingSeekAfterFullUpgrade\`, \`sliceEndedEarly\`, \`fullAudioPromise\` (\`_dsdFullResolve\`) và dừng ngay Worker lệch \`playGeneration\` kể cả khi lát đầu \`state.dsdUrl\` chưa kịp tạo, không làm tắt nhầm trạng thái đang tải của bài kế tiếp.

#### 2. Phục hồi seek Range SAF/MediaStore & Chuẩn hóa đường dẫn quét nội bộ FiiO (\`MainActivity.java\`, \`index.html\`)
- **\`BoundedContentUriInputStream\` & HTTP \`416\` (\`MainActivity.java\`)**: Chuyển \`catch\` khi truy cập \`FileChannel\` / \`mFis.skip()\` trên \`AssetFileDescriptor\` SAF sang fallback đọc tuần tự an toàn trước \`UnsupportedOperationException\` / \`ESPIPE\`, đồng thời bổ sung \`Content-Length: 0\` và \`Accept-Ranges: bytes\` cho phản hồi \`416 Range Not Satisfiable\`.
- **\`normalizeFiioPathKey\` & \`scanFiioStorage\` (\`index.html\`)**: Chuẩn hóa ánh xạ \`/sdcard\` ↔ \`/storage/emulated/0\` và chữ hoa/thường dưới \`/storage/\`, \`/mnt/media_rw/\` xuyên suốt \`buildExistingFiioTrackSets\`, \`buildExistingFiioTrackMaps\`, \`ingestFiioScannedFilesChunk\`, \`pruneMissingFiioTracks\` và nhánh quét dự phòng cũ (kèm khôi phục tệp mẹ khi xóa \`.cue\`).

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
