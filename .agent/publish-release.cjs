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
  const tag = process.argv[2] || 'v3.9.68';
  const name = process.argv[3] || `Nocturne ${tag} (Preload Gapless Cloud chuẩn hóa Token/URL & CUE cùng tệp + Lời .lrc đa bảng mã & bài con CUE + Khóa đồng bộ đơn luồng Drive/OneDrive)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 122) — Gapless Preload Cloud & CUE cùng tệp + Lời \`.lrc\` đa bảng mã/CUE (Web & Android) + Khóa đồng bộ đơn luồng Google Drive/OneDrive

#### 1. Preload Gapless Cloud làm mới Token/URL & không tải trùng tệp cha \`.cue\` (\`index.html\`)
- **Làm mới chủ động trước khi chuyển bài dài (>25 phút)**: Nâng cấp \`prepareCloudTrackForPreload\` với cửa sổ làm mới 5 phút cho Google Drive (\`ensureGoogleToken(true)\`) và OneDrive (\`getMicrosoftToken(false)\` + \`resolveMicrosoftDownloadUrl\`), đồng thời vẫn làm mới trước khi chuyển sang bài đã có lát đệm (\`firstSlicePlayback\`) để \`upgradeSliceToFullAudio\` không bị 401.
- **Bỏ qua preload trùng \`standbyAudio\` cho 2 bài con \`.cue\` cùng tệp âm thanh**: Thêm \`isSameCueParentTrack(curTrack, nextTrack)\` giúp tiết kiệm RAM & băng thông đọc thẻ nhớ MicroSD/FiiO M11S.

#### 2. Nạp lời \`.lrc\` đa bảng mã (Shift-JIS/UTF-16/Win-1252) & lời bài con \`.cue\` (\`index.html\` + \`MainActivity.java\`)
- **Web nội bộ**: Chuyển \`addLocalFiles\` sang \`readLocalTextFileAuto\` (tránh lỗi vỡ chữ Nhật/châu Âu từ \`.text()\` UTF-8 cứng), chuẩn hóa NFC đường dẫn, và tự động khớp \`.lrc\` theo tên/số thứ tự bài con \`.cue\` qua \`findLocalCueLrcFile\`.
- **Android / FiiO MicroSD**: Bổ sung \`NocturneNative.readLocalCueLyrics(filePath, contentUri, trackTitle, trackNumber)\` tìm tệp \`.lrc\`/\`.lyricsfile\`/\`.txt\` trùng tên bài con trong cùng thư mục album thay vì nạp nhầm lời tệp album lớn.

#### 3. Khóa đồng bộ đơn luồng theo từng nguồn Cloud & Ngoại tuyến an toàn (\`index.html\`)
- **Chống chạy chồng 2 luồng quét cùng lúc**: Bổ sung mutex \`state._googleSyncPromise\` và \`state._microsoftSyncPromise\` trong \`loadGoogleFiles\` / \`loadMicrosoftFiles\` và đồng bộ với \`scheduleOnlineCloudDeltaSync\` để đồng bộ thủ công và đồng bộ nền khi có mạng trở lại tự động gộp vào cùng 1 tiến trình, tránh ghi trùng IndexedDB và đua token; giữ nguyên bộ đệm cục bộ an toàn khi \`navigator.onLine === false\`.

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
