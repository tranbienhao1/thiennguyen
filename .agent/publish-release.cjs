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
  const tag = process.argv[2] || 'v3.9.84';
  const name = process.argv[3] || `Nocturne ${tag} (Cloud First-Slice Retry Concurrency & Skip Guard + Headset/DAC Unplug Pause Safety During Slice Upgrade, DSD Decode & Native MediaSession Sync)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 138) — Chống chạy song song khi thử lại First-Slice Cloud + Bảo vệ tạm dừng hoàn hảo khi rút tai nghe / USB DAC (Web Audio, DSD & Native Bit-Perfect)

#### 1. Chống đua lệnh & tải thừa khi tua bài sâu trên mạng yếu (\`index.html\`)
- **\`retryPendingCurrentSliceUpgrade()\` & \`applySmartSeekTime()\`**: Bổ sung khóa \`_retryingSliceUpgrade\` chống gọi trùng song song trong lúc làm mới token Google Drive / URL tải OneDrive; sau khi chờ mạng xong sẽ kiểm tra lại đúng \`state.currentId\` và \`audio.src\` trước khi khởi chạy \`upgradeSliceToFullAudio\`, ngăn tải thừa tệp FLAC 60MB cho bài đã bỏ qua; đồng thời giữ đúng mốc tua đích \`_pendingSeekAfterFullUpgrade\` ngay khi đang thử lại.

#### 2. An toàn tuyệt đối khi rút tai nghe 3.5mm / USB DAC / Bluetooth (\`index.html\` + \`MainActivity.java\`)
- **\`window.onAndroidAudioBecomingNoisy()\`**: Nhận diện cả lúc đang nâng cấp \`First-Slice -> Full Audio\` (\`_upgradingFullAudio\`) và lúc đang nạp bài (\`state.isPlaybackLoading\`), gắn cờ \`_userPausedDuringUpgrade = true\` để ngăn nhạc bật ra loa ngoài sau khi rút tai nghe; bảo toàn \`state.dsdWorker\` khi lát DSD đã phát (không hủy phiên DSD khi tạm dừng); gọi \`updatePositionState(true)\` khóa đúng vị trí trên màn hình khóa/AVRCP.
- **\`MainActivity.triggerAudioBecomingNoisy()\`**: Chủ động gọi \`syncAudioFocusNativeUiAndMediaSession(false)\` khi tạm dừng Native Bit-Perfect, đảm bảo thông báo và \`MediaSession\` chuyển ngay sang \`STATE_PAUSED\` ngay cả khi tắt màn hình / WebView ở nền.

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
