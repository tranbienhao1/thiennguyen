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
  const tag = process.argv[2] || 'v3.9.87';
  const name = process.argv[3] || `Nocturne ${tag} (Web->Bit-Perfect Position Handoff + Android SAF Permission Recovery + OneDrive Full-Rescan Move/Rename Parity + Prev/Queue Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 141) — Chuyển mượt Web Audio sang Bit-Perfect giữ đúng vị trí + Tự phục hồi quyền SAF Android + Đồng bộ di chuyển/đổi tên OneDrive khi Full Rescan

#### 1. Chuyển mượt Web Audio -> Native Bit-Perfect giữ đúng vị trí phát (\`applyBitPerfectMode\` & \`playTrack\`)
- Khi bật chế độ Bit-Perfect trong lúc Web Audio đang phát bài hợp lệ trên FiiO/Android (\`isTrackRoutedToNativeBitPerfect\`), tự động ghi lại giây phát hiện tại (\`_resumeAfterBpFallbackSec\`), tạm dừng HTML5 Audio và kích hoạt Native Bit-Perfect tại đúng vị trí phát.
- Khởi tạo \`playTrack\` Native Bit-Perfect ưu tiên seek chính xác tới \`_resumeAfterBpFallbackSec\` khi chuyển từ Web Audio sang (vẫn bảo toàn hoàn toàn logic \`cueStartSec\` cho đĩa CUE).

#### 2. Tự phục hồi ảnh bìa & cờ lỗi truy cập khi cấp lại quyền SAF Android (\`onAndroidStoragePermissionGranted\`)
- Xóa bộ đệm ảnh bìa lỗi (\`failedNativeCovers.clear()\`) và gỡ bỏ cờ \`_localAccessError\` / \`_pathFallbackRetriedGen\` trên các bài \`fiio\` / \`local\` ngay khi người dùng cấp lại quyền lưu trữ Android.

#### 3. Đồng bộ di chuyển/đổi tên OneDrive khi Full Rescan (\`loadMicrosoftFiles\`)
- Cập nhật \`remoteParentId\`, xóa \`remoteDriveId\` cũ khi tệp chuyển từ thư mục chia sẻ về OneDrive cá nhân, đánh dấu \`_needsFolderCoverRefresh\` khi đổi đường dẫn và trích xuất lại \`discNumber\` / \`trackNumber\` khi di chuyển hoặc đổi tên tệp (không làm thay đổi truy vấn \`$select\`).

#### 4. Mở rộng kiểm thử Chrome thực (CDP E2E)
- Kiểm chứng thêm nút Previous (\`#previous-button\`) quay lại Track 1 và đóng/mở bảng Hàng đợi phát (\`#queue-button\`) không phát sinh lỗi JS.

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
