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
  const tag = process.argv[2] || 'v3.9.56';
  const name = process.argv[3] || `Nocturne ${tag} (Tự phục hồi nâng cấp bản full Cloud khi có mạng lại + chống rò rỉ blob URL + Bit-Perfect tự hồi khi đổi USB DAC & CUE liền mạch)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 110) — Phục hồi nâng cấp bản full Cloud khi có mạng lại + chống rò rỉ bộ nhớ blob URL + Bit-Perfect tự hồi khi đổi USB DAC & chuyển bài CUE liền mạch

#### 1. Tự phục hồi nâng cấp bản full Google Drive / OneDrive khi mạng chập chờn (\`index.html\`)
- **Không còn đứt bài ở cuối lát đầu khi chuyển Wi-Fi ↔ 4G**: Khi \`upgradeSliceToFullAudio\` bị rớt mạng trong lúc bài hát đang phát từ lát đầu (\`firstSlicePlayback\`), ứng dụng lưu lại \`_pendingSliceUpgrade\`. Ngay khi có mạng trở lại (\`online\`), \`retryPendingCurrentSliceUpgrade\` tự làm mới token Google Drive hoặc \`downloadUrl\` OneDrive và tải tiếp bản full ở nền trước khi lát đầu kết thúc.

#### 2. Kiểm soát trần bộ nhớ \`state.objectUrls\` khi chuyển nguồn liên tục (\`index.html\`)
- **Thu hồi blob URL dư thừa an toàn (\`pruneExcessObjectUrls\`)**: Giới hạn trần 12 URL trên FiiO/Android cũ (32 URL trên Web/Desktop), tự thu hồi blob audio cũ không còn dùng khi chuyển qua lại giữa Google Drive, OneDrive và Nội bộ mà tuyệt đối không đụng vào deck đang phát, bài chờ preload, DSD hay ảnh bìa đang hiển thị.

#### 3. Chuyển bài \`.cue\` cùng tệp gốc liền mạch 0ms & tự phục hồi Android Bit-Perfect khi đổi ngõ ra (\`MainActivity.java\`, \`index.html\`)
- **\`BitPerfectAudioPlayer\` tự dựng lại \`AudioTrack\` khi gặp \`ERROR_DEAD_OBJECT\`**: Khi cắm/rút USB DAC, chuyển Bluetooth hoặc Line-Out giữa bài, \`BitPerfectAudioPlayer\` tự phát hiện \`AudioTrack.ERROR_DEAD_OBJECT\` (-6), chọn lại thiết bị ưu tiên (\`findPreferredBitPerfectDevice\`) và dựng lại \`AudioTrack\` (tối đa 2 lần) mà không rớt khỏi Bit-Perfect hay khởi động lại bài từ 0:00.
- **Nhận diện mở rộng ngõ ra âm thanh Android/FiiO**: Nhận diện thêm \`TYPE_LINE_ANALOG\`, \`TYPE_LINE_DIGITAL\`, \`TYPE_AUX_LINE\` (Line-Out/Balanced/Coax trên DAP) và \`TYPE_BLE_HEADSET\`/\`TYPE_BLE_SPEAKER\` (Bluetooth LE Audio trên Android 12–15).
- **Chuyển bài \`.cue\` liền mạch cùng tệp FLAC/WAV (Web + Android Bit-Perfect)**: Khi chuyển tuần tự giữa các bài con \`.cue\` chung tệp gốc, không còn hủy/tạo lại \`AudioTrack\` hay gọi \`standbyAudio.load()\`, giúp album live/concert liền mạch không vấp tiếng.

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
