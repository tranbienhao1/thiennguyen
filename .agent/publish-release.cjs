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
  const tag = process.argv[2] || 'v3.9.86';
  const name = process.argv[3] || `Nocturne ${tag} (Multi-Folder Saved Permission Recovery + Seamless Bit-Perfect-to-Web Position Handoff + Google Drive Full-Rescan Move/LRC Parity + Desktop & Listening Room Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 140) — Khôi phục quyền đa thư mục cục bộ + Chuyển mượt Bit-Perfect sang Web Audio giữ đúng vị trí phát + Đồng bộ di chuyển/đổi tên Google Drive khi Full Rescan

#### 1. Khôi phục quyền đa thư mục cục bộ Web (\`reopenSavedFolderRecord\` & \`reopenSavedFolder\`)
- Truyền đúng \`silentIfGranted\` cho cả các thư mục đã lưu thứ hai trở đi khi người dùng chủ động bấm **Mở lại thư mục đã lưu**, giúp mọi thư mục con đều được xin cấp lại quyền \`handle.requestPermission\` thay vì bị bỏ qua âm thầm.
- Tự động xóa cờ lỗi \`_localAccessError\` ngay khi quyền đọc được cấp lại, không làm gián đoạn hoặc kẹt bài đang phát.

#### 2. Chuyển mượt từ Native Bit-Perfect về Web Audio & Giữ đúng vị trí phát (\`applyBitPerfectMode\`)
- Khi tắt chế độ Bit-Perfect trong lúc đang phát nhạc trên FiiO/Android (\`state.isNativeBitPerfectPlaying\`), ghi lại chính xác \`lastBitPerfectPositionSec\` vào \`_resumeAfterBpFallbackSec\` và tự động nối tiếp sang Web Audio tại đúng giây hiện tại (nếu đang tạm dừng thì giữ nguyên trạng thái tạm dừng).

#### 3. Google Drive Full-Rescan Move & Rename Parity (\`applyGoogleScanUpdate\`)
- Cập nhật \`existing.parents\` mỗi khi tệp di chuyển sang thư mục mới (thay vì chỉ gán khi mảng cũ rỗng), làm mới bộ đệm ảnh bìa thư mục (\`checkedGoogleArtParents\`), mở khóa lại \`_checkedDriveLrc\` và phân tích lại \`discNumber\` / \`trackNumber\` khi tệp đổi tên.

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
