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
  const tag = process.argv[2] || 'v3.9.89';
  const name = process.argv[3] || `Nocturne ${tag} (Live Cloud Alias Stats Migration + M3U8 Album/Folder Disambiguation + Orphaned Cover Hygiene + Web DSD Bit-Perfect HUD + Repeat One E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 143) — Di trú khóa Yêu thích/Rating/PlayCount khi đổi Alias Cloud + Phân giải trùng tên M3U8 + Dọn ảnh bìa thừa & HUD Bit-Perfect DSD

#### 1. Di trú khóa Yêu thích, Rating & Số lần phát khi đổi Alias Cloud / Di chuyển Local (\`migrateTrackUserStatKeys\`)
- Tự động di trú và hợp nhất \`state.favorites\`, \`state.trackRatings\`, và \`nocturne-play-counts\` khi \`applyGoogleScanUpdate\` đổi \`targetRemoteId\`, \`loadMicrosoftFiles\` gán \`remoteShortcutId\`, hoặc \`reconcileMovedFiioTracks\` ghép bài Local/FiiO chuyển thư mục.

#### 2. Khử nhập nhằng khi trùng tên tệp M3U/M3U8 (\`matchPlaylistWithLibrary\`)
- Dùng thêm tên album (\`#EXTALBUM\`), \`playlistName\`, và \`folderHint\` (thư mục đã mở gần đây) để chọn chính xác bài khi nhiều album có cùng tên file (ví dụ \`01 - Intro.flac\`).

#### 3. Dọn ảnh bìa thừa & Chuẩn hóa HUD Bit-Perfect cho Web DSD (\`pruneOrphanedAlbumCovers\`, \`displayTrack\`, \`updateMiniPlayerHud\`)
- Thêm \`pruneOrphanedAlbumCovers\` giải phóng ngay ảnh bìa không còn bài tham chiếu trong \`removeDeletedCloudTracks\` và \`pruneMissingFiioTracks\`.
- Hiển thị chính xác \`pcmRate\`/\`pcmBitDepth\` trên huy hiệu Bit-Perfect khi phát DSD-to-PCM trên Web và bổ sung nhãn \`⚡ BP\` trên Mini Player HUD.

#### 4. Mở rộng Chrome thật (CDP E2E)
- Kiểm chứng chế độ **Repeat One** (\`↻¹\`) lặp lại chính Track 2 khi sự kiện \`ended\` kích hoạt tự nhiên, cùng khôi phục phiên và \`0\` ngoại lệ JS.

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
