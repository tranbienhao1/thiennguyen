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
  const tag = process.argv[2] || 'v3.9.71';
  const name = process.argv[3] || `Nocturne ${tag} (Hủy tải DSD Cloud giữa chừng & giải phóng RAM + Đồng bộ khóa màn hình Android sau cuộc gọi/AudioFocus + Tự bỏ qua bài Cloud chưa cache khi Album ngoại tuyến)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 125) — Hủy tải DSD Cloud & Giải phóng RAM + Đồng bộ AudioFocus Khóa màn hình Android + Chuyển tiếp Album Ngoại tuyến

#### 1. Phát DSD Cloud an toàn RAM & Hủy tải tức thì khi chuyển bài (\`index.html\`)
- **\`fetchCloudFile\`**: Chống tải trùng qua \`track._cloudFilePromise\`, gắn \`AbortController\` (\`track._dsdFetchAbort\`) tự hủy tải file DSD dung lượng lớn khi chuyển bài, và bổ sung dự phòng 2 lớp cho OneDrive chia sẻ (\`freshDirect\` -> Graph \`/drives/{remoteDriveId}/items/{remoteId}/content\`).
- **\`releaseUnusedCloudUrl\`**: Chủ động hủy \`_dsdFetchAbort\` và giải phóng \`track.file = null\` trên bài DSD Cloud đã chuyển qua để chống tràn RAM trên máy nghe nhạc FiiO M11S (3GB RAM).

#### 2. Đồng bộ khóa màn hình & Bluetooth AVRCP tức thì khi nhận cuộc gọi / AudioFocus trên Android (\`MainActivity.java\`)
- **\`AUDIOFOCUS_LOSS\` / \`AUDIOFOCUS_LOSS_TRANSIENT\` / \`AUDIOFOCUS_GAIN\`**: Đồng bộ ngay \`updateMediaSessionMetadata\` và \`showMediaNotification\` ngay trên luồng gốc (kể cả khi màn hình tắt và WebView bị đóng băng trong cuộc gọi), đồng thời đồng bộ lại vị trí phát \`onNativeBitPerfectPosition\` khi tự phát tiếp sau cuộc gọi.

#### 3. Chuyển bài mượt mà trong Album hỗn hợp khi mất mạng (\`index.html\`)
- **\`playNext\`**: Trong chế độ phát tuần tự Album (\`isSequentialAlbum\`) khi ngoại tuyến (\`navigator.onLine === false\` hoặc bộ lọc Offline), tự lọc các bài có thể phát ngoại tuyến (\`canPlayOffline\`) để nhảy sang bài nội bộ/có lát đệm kế tiếp thay vì vấp lỗi trên bài Cloud chưa cache.

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
