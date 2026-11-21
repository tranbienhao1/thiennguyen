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
  const tag = process.argv[2] || 'v3.9.59';
  const name = process.argv[3] || `Nocturne ${tag} (Chống treo tải luồng nhạc Cloud + tự khớp hàng đợi/yêu thích/CUE sau quét lại & bảo vệ OTA Android)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 113) — Chống treo tải luồng nhạc Cloud + tự khớp hàng đợi/yêu thích/CUE sau quét lại & bảo vệ OTA Android

#### 1. Chống treo tải luồng nhạc Google Drive & OneDrive (\`library-utils.js\`)
- **Timeout chủ động cho Range lát đầu (25s), tải toàn tệp FLAC/DSD (90s) và thăm dò \`moov\` đuôi MP4/ALAC (15s)**: \`createAudioFetchTimeoutGuard\` kết hợp \`AbortController\` + \`Promise.race\` hủy thân luồng \`response.body\` ngay khi socket bị treo trên mạng 4G/Wi-Fi yếu.
- **Tự động thử lại lỗi timeout nhưng dừng tức thì khi người dùng hủy**: Phân tách rạch ròi \`TimeoutError\` (\`retryable: true\`) với \`AbortError\` từ tín hiệu ngoài để chuyển bài nhanh và tự phục hồi khi mạng chập chờn.

#### 2. Tự khớp phiên nghe, hàng đợi, yêu thích & vị trí \`.cue\` xuyên phiên quét (\`library-utils.js\` + \`index.html\`)
- **\`buildStableTrackRef\` & \`matchTrackByStableRef\`**: Lưu chữ ký ổn định (\`remoteId\`/\`remoteDriveId\` cho Google Drive & OneDrive; \`path\`/\`uri\`/\`relativePath\` + \`size\`/\`cueStart\` cho nội bộ Web & Android/FiiO) trong phiên nghe và hàng đợi để tự khớp lại đúng bài hát kể cả khi thư viện nội bộ được quét lại với ID mới hoặc tệp trên thẻ nhớ bị di chuyển.
- **Sửa lỗi mất mốc tua \`.cue\` khi tiếp tục nghe**: \`restorePlaybackSession\` và \`formatResumePrompt\` tính đúng khoảng \`[cueStart, cueStart + duration]\` thay vì đặt lại về \`0:00\` cho bài thứ 2 trở đi trong album \`.cue\`.
- **Yêu thích bền vững & đếm đúng OneDrive Cloud**: \`stableFavoriteKey\` / \`isTrackInFavorites\` giữ nguyên trạng thái Yêu thích sau khi mở lại thư mục nội bộ hoặc di chuyển tệp trên FiiO/Android (\`reconcileMovedFiioTracks\` tự chuyển cả hàng đợi, yêu thích và phiên nghe), đồng thời tính đúng nguồn \`onedrive\` vào nhóm Cloud.

#### 3. Bảo vệ tải OTA Web Assets trên Android/FiiO (\`MainActivity.java\`)
- **Giới hạn thời gian tổng & dung lượng 16 MB trong \`downloadUrlBytes\`**: Chống treo luồng kiểm tra OTA khi mạng di động rớt nhỏ giọt hoặc gặp trang captive-portal trả về dữ liệu quá lớn gây tràn RAM.

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
