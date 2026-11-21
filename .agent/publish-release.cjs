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
  const tag = process.argv[2] || 'v3.9.46';
  const name = process.argv[3] || `Nocturne ${tag} (Làm mới cache lát đầu khi đổi file Google Drive/OneDrive & tự phục hồi deck nạp trước standbyAudio)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 100) — Làm mới cache lát đầu khi đổi file Google Drive/OneDrive & tự phục hồi deck nạp trước standbyAudio

#### 1. Phát hiện thay đổi file nhạc & vô hiệu hóa cache lát đầu trên Google Drive / OneDrive (\`index.html\`)
- **\`contentRev\` & \`invalidateCloudTrackContent\`**: Lưu \`contentRev\` (\`md5Checksum\` / \`modifiedTime\` với Google Drive; \`cTag\` / \`eTag\` với OneDrive) vào bộ nhớ catalog IndexedDB (\`serializableCloudTrack\`) và bổ sung trường \`cTag\` trong truy vấn Microsoft Graph \`loadMicrosoftFiles\`.
- Khi quét lại thư viện (\`loadGoogleFiles\`, \`loadMicrosoftFiles\`) phát hiện kích thước (\`size\`) hoặc \`contentRev\` thay đổi (bài remaster / ghi đè mới), tự động xóa bản ghi \`firstSliceCache\` cũ trong IndexedDB, đặt lại \`firstSliceCached\` / \`metadataLoaded\` / \`moovAtTail\` / \`fullAudioError\`, hủy tác vụ nâng cấp nền đang chạy dở (trừ bài đang phát) và thu hồi URL Cloud cũ để phát đúng bản mới trên cả Web và Android APK.

#### 2. Tự phục hồi deck nạp trước \`standbyAudio\` khi gặp lỗi giải mã hoặc hết hạn URL (\`index.html\`)
- **\`recoverFailedStandbyPreload\`**: Gắn vào trình xử lý sự kiện \`error\` của \`standbyAudio\` trong \`attachDeckEvents\`; tự động dọn sạch \`standbyAudio\`, thu hồi URL \`blob:\` nội bộ hỏng (\`releaseUnusedLocalUrl\`), xóa cache lát đầu & đặt lại \`downloadUrl\` OneDrive bị hết hạn/lỗi với bài Cloud, và tự kích hoạt nạp lại tối đa 1 lần sau 1200ms trong cửa sổ 60 giây (tránh vòng lặp lỗi vô hạn).

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
