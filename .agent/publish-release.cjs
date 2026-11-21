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
  const tag = process.argv[2] || 'v3.9.52';
  const name = process.argv[3] || `Nocturne ${tag} (Khóa single-flight OAuth Drive/OneDrive & chuẩn hóa đường dẫn DSD/Unicode/ký tự + nội bộ)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 106) — Khóa single-flight OAuth Drive/OneDrive & chuẩn hóa đường dẫn DSD/Unicode/ký tự \`+\` nội bộ

#### 1. Khóa single-flight OAuth cho Google Drive & OneDrive (\`index.html\`)
- **Google Drive (\`ensureGoogleToken\`, \`requestGoogleToken\`)**: Bổ sung khóa đơn luồng \`googleTokenRefreshPromise\` cùng dấu thời gian \`state.googleLastRefreshAt\` và cửa sổ chống dội 8 giây khi nhiều yêu cầu \`forceRefresh\` (lỗi 401 đồng thời từ phát nhạc, tải ảnh bìa, đồng bộ) xảy ra cùng lúc.
- **OneDrive MSAL (\`getMicrosoftToken\`, \`ensureMicrosoftMsalClient\`)**: Tách khóa khởi tạo \`microsoftMsalInitPromise\`, khóa làm mới ngầm \`microsoftTokenSilentPromise\` và khóa đăng nhập tương tác \`microsoftTokenInteractivePromise\` để triệt tiêu xung đột \`interaction_in_progress\` khi nhiều luồng OneDrive chạy song song.

#### 2. Khôi phục DSD nội bộ & chuẩn hóa đường dẫn Unicode / \`+\` trên Android (\`index.html\`, \`MainActivity.java\`)
- **Web & Desktop DSD (\`preloadDsdNext\`, \`playTrack\`)**: Nhánh DSD hỗ trợ khôi phục tệp từ \`FileSystemFileHandle\` thông qua \`ensureLocalTrackPlayableUrl(track, { requestPermission: true })\` (và nạp ngầm \`fileHandle\` ở \`preloadDsdNext\` cho máy tính không ở chế độ FiiO), kiểm tra lỗi HTTP trước khi đọc blob \`/local-media\` và chuẩn hóa tên tệp/MIME qua \`library.normalizeAudioBlob\`.
- **Android Local & MediaStore (\`resolveReadableLocalFile\`, \`resolveMediaStoreContentUriForPath\`)**: Tách hàm \`resolveReadableLocalFile\` dùng chung cho \`extractCoverJpeg\`, \`handleLocalMediaStreaming\` và \`BitPerfectAudioPlayer.runPlaybackLoop\`, bảo toàn ký tự \`+\` (\`.replace("+", "%2B")\`) khi giải mã URL (\`#\`, \`%\`, \`?\`, \`+\`) và thử lần lượt dạng chuẩn hóa Unicode \`NFC\`/\`NFD\` trên thẻ nhớ FAT32/exFAT lẫn truy vấn \`MediaStore.DATA\`.

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
