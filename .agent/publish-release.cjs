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
  const tag = process.argv[2] || 'v3.9.64';
  const name = process.argv[3] || `Nocturne ${tag} (Tự động nối lại luồng phát khi rớt mạng/lỗi giải mã giữa bài + Hỗ trợ đầy đủ CUE đa tệp cho Web & Android/FiiO MicroSD)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 118) — Tự động nối lại luồng phát khi gặp lỗi mạng/giải mã giữa bài & Hỗ trợ đầy đủ tệp CUE đa tệp (Web + Android/FiiO MicroSD)

#### 1. Tự động nối lại luồng phát giữa bài khi gặp \`MEDIA_ERR_NETWORK\` / \`MEDIA_ERR_DECODE\` / \`MEDIA_ERR_SRC_NOT_SUPPORTED\` (\`index.html\`)
- **Nối lại đúng giây đang nghe trước khi bỏ bài**: Khi deck đang phát gặp lỗi mạng/giải mã/nguồn giữa bài trên Google Drive, OneDrive hoặc \`/local-media\`, \`attachDeckEvents\` tự động thử nối lại 1 lần qua \`recoverStalledAudioStream\` tại đúng mốc \`_lastKnownPlayPosition\` (cưỡng chế làm mới Google OAuth token hoặc OneDrive \`downloadUrl\` mới, hoặc thêm \`_sr\` cho Local) thay vì bỏ bài ngay lập tức.
- **Chống nhấp nháy UI & bảo vệ thời lượng CUE**: Đặt cờ \`_upgradingFullAudio\` có timeout an toàn trong lúc nối lại luồng để không nháy nút Play/Pause, đồng thời bảo vệ \`loadedmetadata\` không ghi đè thời lượng album gốc lên sub-track CUE.

#### 2. Hỗ trợ trọn vẹn tệp \`.cue\` đa tệp (\`library-utils.js\` + \`index.html\`)
- **Phân tích chính xác CUE đa tệp & EAC pre-gap (\`parseCueSheet\`)**: Bỏ UTF-8 BOM \`\\uFEFF\`, gắn đúng \`FILE\` cho \`INDEX 01\` theo chuẩn EAC noncompliant, không trừ nhầm offset chéo giữa 2 tệp khác nhau, và xuất \`files\` / \`isMultiFile\` / \`hasNextInFile\`.
- **Khớp từng tệp âm thanh trên Web Local Folder & Android/FiiO MicroSD**: \`addLocalFiles\` và \`expandFiioScannedCueSheets\` ánh xạ từng mục \`FILE "01.flac"\`, \`FILE "02.flac"\` tới đúng tệp audio tương ứng, ghi và lưu bền vững \`cueEnd\` (sửa lỗi CUE trên FiiO HTML5 Audio không tự chuyển bài khi hết track), và loại sạch toàn bộ tệp gốc trùng lặp.

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
