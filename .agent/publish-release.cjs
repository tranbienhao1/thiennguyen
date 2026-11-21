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
  const tag = process.argv[2] || 'v3.9.70';
  const name = process.argv[3] || `Nocturne ${tag} (Tua thông minh trên lát đầu Cloud & tự tải lại bản đầy đủ + Đọc đầy đủ WAV/AIFF/FLAC 12MB & SYNCEDLYRICS + Dọn sạch bộ đệm Cloud khi reset)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 124) — Tua thông minh trên lát đầu Cloud + Đọc chuẩn WAV/AIFF/FLAC + Dọn triệt để bộ đệm Cloud

#### 1. Tua thông minh trên lát đầu Cloud & Tự kích hoạt tải lại bản đầy đủ (\`index.html\`)
- **Không còn bị kẹp mốc tua bởi độ dài 15s của lát đầu**: \`applySmartSeekTime\` và thanh tua \`#room-seek\` sử dụng thời lượng thực của bài (\`curTrack.duration\`) khi đang ở \`firstSlicePlayback\`, đồng thời tự động gọi \`retryPendingCurrentSliceUpgrade()\` nếu lượt tải nền trước đó gặp rớt mạng tạm thời.
- **Đồng bộ thanh tua khóa màn hình sau khi nâng cấp**: \`resumeFullAudioFromSlice\` cập nhật \`updatePositionState(true)\` ngay sau khi chuyển sang tệp đầy đủ.

#### 2. Đọc chuẩn metadata WAV/RF64/AIFF/AIFC & Ảnh bìa FLAC Hi-Res tới 12MB (\`index.html\` + \`MainActivity.java\`)
- **Web nội bộ (\`readAudioMetadata\`)**: Tính chính xác thời lượng (\`duration\`) và đọc tag \`LIST/INFO\` (title/artist/album/track) cho tệp WAV/RF64, đồng thời bổ sung bộ phân tích chuẩn AIFF/AIFC (\`COMM\` 80-bit IEEE-754 sampleRate, bitDepth, channels, duration).
- **Android / FiiO MicroSD (\`MainActivity.java\`)**: Nâng trần ảnh bìa nhúng FLAC lên 12 MB trong \`extractFlacPictureFromStream\` (downscale an toàn chống tràn RAM), hỗ trợ thêm thẻ \`SYNCEDLYRICS\` và tự lọc BOM UTF-8 trong \`extractFlacVorbisLyricsFromFile\`.

#### 3. Dọn sạch bộ đệm lát Cloud & ảnh bìa mồ côi khi xóa danh mục Cloud (\`index.html\`)
- **\`clearCloudCatalog\`**: Bổ sung \`purgeCloudSliceCacheAndOrphanedCovers()\` xóa toàn bộ lát \`google:*\`/\`onedrive:*\` trong \`firstSliceCache\`, đặt lại \`checkedGoogleArtParents\` và dọn các khóa \`albumCovers\` mồ côi không còn thuộc thư viện nội bộ.

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
