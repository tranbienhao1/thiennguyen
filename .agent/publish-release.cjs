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
  const tag = process.argv[2] || 'v3.9.44';
  const name = process.argv[3] || `Nocturne ${tag} (Tự thử lại luồng nhạc Cloud bị đứt giữa chừng, đồng bộ đa luồng OneDrive & khôi phục DSD directUrl)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 98) — Tự thử lại luồng nhạc Cloud bị đứt giữa chừng, đồng bộ đa luồng OneDrive & khôi phục DSD directUrl

#### 1. Tự thử lại luồng tải nhạc Google Drive / OneDrive khi đứt mạng giữa thân file & hỗ trợ \`Retry-After\` (\`library-utils.js\` + \`index.html\`)
- **\`readAudioResponseBlob\` & \`fetchAudioResponse\`**: Gắn cờ \`retryable = true\` khi \`response.blob()\` bị ngắt kết nối giữa chừng trong lúc đang tải thân file FLAC/ALAC/WAV/DSD dung lượng lớn (cả trong \`fetchAudioBlob\` lẫn \`fetchAudioFirstSlice\`), đồng thời đọc header \`Retry-After\` trên mã \`429\`/\`5xx\` để tự động thử lại mượt mà mà không làm ngắt bài.
- **\`fetchCloudFile\` OneDrive \`directUrl\` Recovery**: Khi tải bài DSD/full-file từ OneDrive gặp \`401\`/\`403\` do link tạm \`@microsoft.graph.downloadUrl\` hết hạn, tự động xóa \`track.downloadUrl\`, xin lại \`resolveMicrosoftDownloadUrl(track)\` mới hoặc chuyển sang Microsoft Graph \`/content\` kèm \`Bearer token\`.

#### 2. Đồng bộ thư mục OneDrive đa luồng theo lô & chống lỗi giới hạn Graph API (\`index.html\`)
- **\`graphGet\` Resilient Retry**: Tự động thử lại tối đa 3 lần khi Microsoft Graph trả về \`429\` / \`500..504\` hoặc lỗi mạng ngắn hạn (tôn trọng \`Retry-After\` + exponential backoff) và làm mới \`state.microsoftAccessToken\` khi gặp \`401\`.
- **\`loadMicrosoftFiles\` Parallel Folder Batching**: Quét đồng thời theo lô tối đa 3 thư mục OneDrive mỗi đợt (\`FOLDER_BATCH_CONCURRENCY = 3\`) và lưu bền các bài hiện có được cập nhật (\`downloadUrl\`, \`remotePath\`, \`size\`, \`audio\`) xuống IndexedDB \`catalog\`.

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
