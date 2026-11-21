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
  const tag = process.argv[2] || 'v3.9.47';
  const name = process.argv[3] || `Nocturne ${tag} (Đồng bộ nhanh Delta Cursor Google Drive/OneDrive & dự phòng Bit-Perfect -> Web Audio giữ vị trí)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 101) — Đồng bộ nhanh Delta Cursor Google Drive/OneDrive & dự phòng Bit-Perfect -> Web Audio giữ vị trí

#### 1. Đồng bộ tăng trưởng Delta Cursor cho Google Drive & OneDrive (\`index.html\`)
- **Google Drive Changes Delta (\`tryLoadGoogleChangesDelta\`, \`fetchGoogleStartPageToken\`)**: Lưu \`startPageToken\` vào \`localStorage\` (\`nocturne-google-delta-token\`); các lần đồng bộ kế tiếp chỉ đọc phần thay đổi (thêm mới, đổi kích thước/\`contentRev\` kích hoạt \`invalidateCloudTrackContent\`, hoặc xóa/thùng rác qua \`removeCloudTracksByRemoteIds\`), tự rơi về quét đầy đủ an toàn khi token hết hạn (\`400\`/\`404\`/\`410 Gone\`).
- **OneDrive Graph Delta (\`tryLoadMicrosoftDeltaSync\`, \`saveMicrosoftLatestDeltaLink\`)**: Lưu \`@odata.deltaLink\` (\`nocturne-microsoft-delta-link\`) bằng \`/me/drive/root/delta?token=latest\` sau khi quét đầy đủ, đồng bộ tăng trưởng các mục thêm/sửa/xóa (\`deleted\`) và gom ảnh bìa thư mục lân cận, tự đặt lại cursor về full scan khi gặp \`410 Gone\`/\`resyncRequired\`.

#### 2. Dự phòng mượt Native Bit-Perfect -> HTML5/Web Audio & Gia cố luồng OneDrive \`directUrl\` (\`MainActivity.java\` + \`index.html\`)
- **Dọn AudioTrack/AudioFocus trước fallback (\`MainActivity.java\`)**: \`BitPerfectAudioPlayer.runPlaybackLoop\` ghi nhận \`pendingErrorReason\` trong \`catch\` và chỉ gọi \`notifyBitPerfectErrorToWeb\` sau khi khối \`finally\` đã giải phóng \`mAudioTrack\`, \`decoder\`, \`extractor\` và \`abandonAudioFocus()\`.
- **Giữ vị trí phát & chống lặp lỗi (\`index.html\`)**: \`window.onNativeBitPerfectError\` lưu \`_resumeAfterBpFallbackSec\`, mở lại \`state.context.resume()\`, đánh dấu \`_nativeBpFallbackUntil\` 5 phút, giới hạn vòng lặp lỗi (2 lần/30s -> chuyển bài kế), và \`playTrack\` tự seek tới \`initialTargetSeekSec\` kể cả khi metadata nạp trễ.
- **\`upgradeSliceToFullAudio\` (\`index.html\`)**: Link tải trước SharePoint OneDrive hết hạn/lỗi (\`404\`/\`410\`/rớt mạng) tự động chuyển sang link mới hoặc \`/content\` kèm Bearer token.

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
