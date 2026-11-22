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
  const tag = process.argv[2] || 'v3.9.88';
  const name = process.argv[3] || `Nocturne ${tag} (Cloud Favorites/Rating/PlayCount Sync Preservation + Album Hero Multi-Source Dedup + Cross-Device M3U8 Mount Matching + Auto-Advance/Bit-Perfect/Reload Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 142) — Bảo toàn Yêu thích/Rating/Số lần phát khi đồng bộ Cloud + Lọc trùng hàng đợi Album đa nguồn + Khớp M3U/M3U8 xuyên thiết bị

#### 1. Bảo toàn Yêu thích, Đánh giá sao & Số lần phát qua đồng bộ Cloud & đổi Alias (\`library-utils.js\` & \`index.html\`)
- Mở rộng \`isTrackInFavorites\` nhận diện đầy đủ alias phím tắt Cloud (\`targetRemoteId\` Google Drive & \`remoteShortcutId\` OneDrive) mà không làm đổi chuẩn \`stableFavoriteKey\`.
- Bảo toàn \`rating\` và \`playCount\` trong \`serializableCloudTrack\`, ánh xạ thống nhất \`getTrackRating\`/\`setTrackRating\` theo cả \`track.id\` và khóa ổn định \`getFavoriteKey(track)\`, đồng thời lưu bền vững \`playCount\` vào \`nocturne-play-counts\` khi bài đạt ngưỡng scrobble và tự nạp lại trong \`restoreCloudCatalog\`.

#### 2. Lọc trùng thông minh khi phát từ Album/Nghệ sĩ đa nguồn (\`renderAlbumHero\`)
- Thêm \`dedupeHeroTracks\` loại bỏ bản ghi trùng lặp giữa Local/Google Drive/OneDrive khi bấm **Phát album**, **Ngẫu nhiên**, hoặc **+ Hàng đợi**, vẫn giữ nguyên hoàn toàn khởi tạo \`setupAudio()\` chuẩn PWA.

#### 3. Khớp đường dẫn tương đối M3U/M3U8 xuyên thiết bị (\`matchPlaylistWithLibrary\`)
- Tự động chuẩn hóa tiền tố phân vùng Android (\`/storage/emulated/0/\`, \`/sdcard/\`, \`/mnt/media_rw/<vol>/\`, \`/storage/<vol>/\`) và ổ đĩa Windows (\`C:/\`, \`D:/\`) khi so khớp danh sách M3U/M3U8 với thư viện Local/FiiO/Cloud.

#### 4. Mở rộng Chrome thật (CDP E2E)
- Kiểm chứng thêm tự chuyển bài khi track kết thúc tự nhiên (\`ended\`), bật/tắt công tắc \`#bitperfect-mode-toggle\` trên UI, và lưu phiên \`savePlaybackSession\` + tải lại trang \`Page.reload\` với \`0\` lỗi JS.

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
