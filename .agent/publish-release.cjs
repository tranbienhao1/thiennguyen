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
  const tag = process.argv[2] || 'v3.9.43';
  const name = process.argv[3] || `Nocturne ${tag} (Tự phục hồi luồng phát Nội bộ / CUE / FileHandle, chống nhân đôi thư mục & tối ưu fallback OneDrive/Drive)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 97) — Tự phục hồi luồng phát Nội bộ / CUE / FileHandle, chống nhân đôi thư mục & tối ưu fallback OneDrive/Drive

#### 1. Tự phục hồi URL phát nhạc Nội bộ, CUE & \`FileSystemFileHandle\` trên Web + APK (\`index.html\`)
- **\`restoreLocalTrackUrlSync\` & \`ensureLocalTrackPlayableUrl\`**: Phát hiện và tái tạo tức thì \`blob:\` URL đã bị thu hồi (không còn trong \`state.objectUrls\`), tự động đồng bộ \`blob:\` URL mới cho toàn bộ các bài CUE sub-track dùng chung cùng một file gốc (\`track.file\`), tự nạp lại \`File\` từ \`track.fileHandle.getFile()\` khi bộ nhớ bị giải phóng, và tự khôi phục URL \`/local-media?uri=...\` / \`/local-media?path=...\` trên FiiO M11S & Android APK trong cả \`playTrack\` lẫn \`preloadNext\`.
- **Chống nhân đôi bài hát & CUE khi mở lại thư mục nội bộ (\`localTrack\` & \`addLocalFiles\`)**: Lưu \`relativePath\` và \`fileHandle\` ngay trên mỗi track nội bộ, làm mới \`file\`/\`fileHandle\`/\`url\` cho mọi định dạng khi quét lại thư mục, và chống nhân đôi các bài cắt từ file \`.cue\`.

#### 2. Tối ưu tốc độ fallback OneDrive \`directUrl\` trong \`fetchCloudTrack\` (\`index.html\`)
- Khi \`fetchAudioFirstSlice\` trên \`@microsoft.graph.downloadUrl\` gặp lỗi \`401\`/\`403\`, chuyển thẳng về \`loadMicrosoftAudio\` để phát Range slice qua Microsoft Graph \`/content\` ngay lập tức (không tốn thêm lượt tải toàn bộ file vô ích vào link tạm đã hết hạn), đồng thời hỗ trợ fallback Graph \`/content\` ngay trong nhánh tải full file M4A/ALAC (\`moovAtTail\`).

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
