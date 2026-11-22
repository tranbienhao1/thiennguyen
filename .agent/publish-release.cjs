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
  const tag = process.argv[2] || 'v3.9.85';
  const name = process.argv[3] || `Nocturne ${tag} (Bit-Perfect Literal '+'/'%' Path Fix + Unicode NFC/NFD Multi-File CUE Matching + Instant Cloud Metadata Retry Unlock on Re-Auth)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 139) — Vá lỗi đường dẫn chứa '+'/'%' trên Bit-Perfect Android + Khớp tệp .CUE chuẩn Unicode NFC/NFD + Mở khóa tải Metadata Cloud tức thì khi đăng nhập lại

#### 1. Phát nhạc cục bộ & Tệp .CUE chứa ký tự đặc biệt (\`MainActivity.java\` + \`index.html\`)
- **Sửa lỗi Bit-Perfect làm hỏng ký tự \`+\` thành khoảng trắng (\`MainActivity.java\`)**: Chuyển bộ phân giải \`/local-media?\` trong \`BitPerfectAudioPlayer\` sang \`extractLocalMediaQueryParam(parsedLocal, "path" / "uri")\` thay vì \`Uri.getQueryParameter()\`, giúp mở trọn vẹn mọi tệp/thư mục FLAC/WAV/DSD có dấu \`+\`, \`%\`, \`#\` (VD: *Florence + The Machine*, *24-Bit + Hi-Res*).
- **Chuẩn hóa Unicode NFC khi khớp tệp \`.cue\` (\`addLocalFiles\` & \`expandFiioScannedCueSheets\`)**: Đảm bảo tệp \`.cue\` đơn hoặc nhiều tệp (\`multi-file CUE\`) có tên tiếng Việt/Nhật dạng NFD (macOS) khớp chính xác 100% với tệp âm thanh NFC trên Windows & Android/FiiO M11S.

#### 2. Mở khóa tải lại Metadata & Ảnh bìa Cloud tức thì sau khi đăng nhập lại (\`index.html\`)
- **\`resetCloudMetadataRetryForSource(source)\`**: Khi kết nối lại Google Drive hoặc OneDrive (qua OAuth, MSAL hoặc Access Token), tự động xóa thời gian chờ 60 phút (\`metadataRetryAt\`, \`thumbnailRetryAt\`, \`cloudMetadataPausedUntil\`) cho các bài chưa tải đủ tag/bìa, đồng thời lưu \`nocturne-microsoft-token\` / \`nocturne-microsoft-token-expires\` ngay trong \`getMicrosoftToken\`.

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
