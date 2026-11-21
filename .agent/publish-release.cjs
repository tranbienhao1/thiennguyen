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
  const tag = process.argv[2] || 'v3.9.67';
  const name = process.argv[3] || `Nocturne ${tag} (Tự xóa lát đệm lỗi khi giải mã hỏng + Dọn bài chia sẻ đã xóa trên OneDrive Delta + Giải mã tự động UTF-8/Shift-JIS/Win-1252 cho .cue/.lrc)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 121) — Tự phục hồi lát đệm lỗi + Dọn bài OneDrive chia sẻ đã xóa khi Delta Sync + Giải mã tự động UTF-8/UTF-16/Shift-JIS/Windows-1252 cho \`.cue\`/\`.lrc\`

#### 1. Tự xóa lát đệm hỏng & phát lại sạch từ Cloud (\`index.html\`)
- **Tự loại bỏ lát đầu bị hỏng/cụt (<64B hoặc lỗi giải mã)**: Bổ sung \`deleteCachedFirstSlice(track)\`, bỏ qua lát lỗi qua cờ \`_bypassSliceCacheOnce\` trong \`fetchCloudTrack\`, và tự dọn lát cache hỏng trong cả \`playTrack\` lẫn \`playDsdTrack\` khi gặp \`NotSupportedError\` trước khi tải trực tiếp từ Google Drive/OneDrive.

#### 2. Dọn sạch bài chia sẻ OneDrive đã xóa/hủy chia sẻ ngay trong chế độ Delta Sync (\`index.html\`)
- **Đồng bộ hoàn chỉnh thư mục chia sẻ (\`sharedWithMe\`)**: Đánh dấu \`_sharedScanComplete\` khi quét trọn vẹn \`enqueueMicrosoftSharedItems\` & \`scanFolderNode\` không lỗi mạng, tự dọn các bài \`remoteDriveId\` đã bị xóa/thu hồi quyền cùng cache lát đầu mồ côi.

#### 3. Giải mã thông minh UTF-8 / UTF-16 / Shift-JIS / Windows-1252 cho \`.cue\` & \`.lrc\` (\`MainActivity.java\` + \`index.html\`)
- **Hiển thị đúng tên bài & khớp đúng tên tệp âm thanh trên album CD Nhật Bản / châu Âu**: Nâng cấp \`decodeLyricsBytes\` trên Android/FiiO và thêm \`decodeTextBytesAuto\` / \`readLocalTextFileAuto\` trên Web để tự phát hiện UTF-8 nghiêm ngặt, rơi về Shift-JIS khi chứa Kana/Kanji hợp lệ hoặc Windows-1252.

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
