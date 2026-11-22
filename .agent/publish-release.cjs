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
  const tag = process.argv[2] || 'v3.9.79';
  const name = process.argv[3] || `Nocturne ${tag} (Cloud Replaced-Track Tag & Preload Invalidation, OneDrive Delta Folder Cover Refresh, Queue Removal/Sort Preload Re-Sync & Android MediaStore Storage Aliases)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 133) — Cập nhật Tag/Preload khi thay tệp Cloud, Làm mới ảnh bìa thư mục OneDrive Delta, Đồng bộ Preload khi sửa Hàng đợi & Tra cứu bí danh MediaStore Android

#### 1. Làm mới Tag nhị phân, Preload & Ảnh bìa thư mục khi tệp Cloud thay đổi (\`index.html\`)
- **\`invalidateCloudTrackContent\` & \`enrichCloudTrack\`**: Xóa \`metadataRetryAt\`, \`thumbnailRetryAt\`, \`_metaRateLimitRetries\` và hủy \`clearStalePreload()\` nếu bài bị sửa đang nằm trên \`standbyAudio\`; cho phép các thông số header nhị phân mới (\`sampleRate\`, \`bitDepth\`, \`channels\`, \`duration\`, \`albumArtist\`, \`iTunNORM\`, \`lyricsText\`) ghi đè thông số cũ khi tệp trên Google Drive / OneDrive được thay bản remaster tại cùng \`remoteId\`.
- **\`applyMicrosoftSiblingFolderCovers\` & \`tryLoadMicrosoftDeltaSync\`**: Đánh dấu \`forceUpdate: true\` cho ảnh bìa thư mục mới/cập nhật trong OneDrive Delta và \`_needsFolderCoverRefresh\` khi bài không có ảnh nhúng chuyển thư mục, truyền \`{ forceNonEmbedded: true }\` để cập nhật ảnh bìa thư mục tương đương với Google Drive.

#### 2. Đồng bộ lại \`preloadNext\` khi xóa/xếp lại Hàng đợi & Tra cứu bí danh MediaStore (\`index.html\`, \`MainActivity.java\`)
- **\`removeFromQueue\`, \`moveQueueTrack\`, \`#queue-clear\`, \`#sonic-flow-btn\`, \`#queue-bpm-sort-btn\`**: Xóa \`state.preloadTrackId\` / \`state.preloadReadyUrl\` khi bài đầu hàng đợi bị xóa hoặc đổi vị trí (ngăn \`queueIndex()\` trong chế độ Shuffle giữ lại bài vừa xóa) và gọi \`preloadNext(true)\` trên cả Web Audio lẫn Native Bit-Perfect.
- **\`queryMediaStoreAudioWithStorageAliases\` (\`MainActivity.java\`)**: Mở rộng \`resolveMediaStoreContentUriForPath\` tự động ánh xạ hai chiều \`/sdcard/\` ↔ \`/storage/emulated/0/\` và \`/mnt/media_rw/\` ↔ \`/storage/\` trên mọi biến thể đường dẫn (gốc, NFC, NFD, URL-decoded).

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
