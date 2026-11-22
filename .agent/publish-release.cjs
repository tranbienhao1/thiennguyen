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
  const tag = process.argv[2] || 'v3.9.72';
  const name = process.argv[3] || `Nocturne ${tag} (Sửa triệt để nút Play/Pause Web & FiiO M11S + Chống trùng lặp Google Drive/OneDrive Shared & Shortcut + Bảo toàn vị trí khi fallback Bit-Perfect & Bảo vệ giải mã ảnh bìa lớn)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 126) — Sửa triệt để Play/Pause (Web + FiiO M11S) + Chống trùng lặp Cloud Shared/Shortcut + Fallback Bit-Perfect & An toàn ảnh bìa lớn

#### 1. Khắc phục triệt để nút Play/Pause trên Web & Android/FiiO M11S (\`index.html\`, \`MainActivity.java\`)
- **Chống treo \`AudioContext.resume()\` & khóa \`_playBtnBusy\` vĩnh viễn**: Bọc giới hạn timeout 350ms cho \`resume()\` và cơ chế tự nhả khóa theo mốc thời gian (\`_playBtnBusyUntil\`) cùng bộ giải phóng 800ms khi buffering chậm để nút Play/Pause không bao giờ bị đơ.
- **Chặn sự kiện \`pause\`/\`play\` trễ từ HTML5 \`<audio>\` khi đang phát Bit-Perfect**: Khi chuyển sang phát \`BitPerfectAudioPlayer\` thuần native, các sự kiện \`pause\` bất đồng bộ từ deck HTML5 cũ không còn lật ngược biểu tượng nút về \`▶\` hay ghi đè trạng thái \`MediaSession\`.
- **Sửa chạm liên tiếp (\`attachReliableTransportTap\`) & lớp phủ footer desktop (\`z-index\`)**: Dùng cờ ghost-click một lần (\`_touchTapGhostPending\`) tránh nuốt nhầm lần bấm Play/Pause thứ 2 và nâng \`.footer-center-controls\` / \`#play-button\` lên trên tránh vùng bấm lân cận che khuất.
- **Đồng bộ notification & MediaSession Bit-Perfect trên UI thread (\`MainActivity.java\`)**: \`BitPerfectAudioPlayer.pause()/resume()\` giữ nguyên metadata thực đang phát (\`mLastMediaTitle\`) và cập nhật \`mLastMediaPositionMs\` trên UI thread.

#### 2. Đồng bộ Google Drive & OneDrive: Chống trùng lặp Shared/Shortcut & Xóa đồng bộ (\`index.html\`)
- **Google Drive (\`scanGoogleDriveAudioShortcuts\`, \`tryLoadGoogleChangesDelta\`, \`loadGoogleFiles\`)**: Ánh xạ hai chiều \`remoteId <-> targetRemoteId\`, chống nhân đôi nhiều shortcut cùng trỏ 1 bài hoặc giữa shortcut và file gốc, đồng thời xử lý đúng sự kiện xóa khi target bị cho vào Thùng rác.
- **OneDrive (\`normalizeMicrosoftDriveItem\`, \`enqueueMicrosoftSharedItems\`, \`tryLoadMicrosoftDeltaSync\`, \`loadMicrosoftFiles\`)**: Bảo toàn \`remoteShortcutId\`, chống trùng lặp mục \`sharedWithMe\` với shortcut trong My files và xóa sạch bài qua ID shortcut trong Delta Sync.
- **\`restoreCloudCatalog\`**: Lọc trùng lặp O(1) ngay khi nạp danh mục từ IndexedDB.

#### 3. Bảo toàn vị trí khi Bit-Perfect fallback & tối ưu `/local-media`, `/local-cover` (\`MainActivity.java\`, \`index.html\`)
- **Truyền mốc vị trí ms chính xác từ native (\`notifyBitPerfectErrorToWeb\`) + \`AudioTrack.STATE_INITIALIZED\`**: Giữ chính xác vị trí bài hát (kể cả trong CUE sheet) khi chuyển dự phòng sang Web Audio và bám sớm \`loadedmetadata\`.
- **An toàn tua nhanh \`BoundedFileInputStream\` / \`BoundedContentUriInputStream\` & giải mã ảnh bìa lớn (\`coverFileToJpeg\`)**: Xử lý êm đóng luồng đồng thời khi tua nhanh HTTP 206 và giải mã trực tiếp file ảnh bìa tới 24 MB kèm giới hạn kích thước khung hình chống OOM.

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
