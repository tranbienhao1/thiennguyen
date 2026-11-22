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
  const tag = process.argv[2] || 'v3.9.80';
  const name = process.argv[3] || `Nocturne ${tag} (Deep Play/Pause Overhaul: First-Slice Upgrade Pause Guard, DSD Active-Slice Pause, Suspended Context Pause Priority, Standby Playing UI & Hardware Media Key Debounce)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 134) — Đại tu toàn diện Play/Pause: Chống tự phát lại khi nâng cấp First-Slice -> Full Audio, Tạm dừng DSD khi đang giải mã nền, Ưu tiên Pause khi AudioContext suspended & Chống lặp phím cứng Media

#### 1. Triệt tiêu 5 lỗi cốt lõi của nút Play/Pause trên Web Audio, HTML5 Audio & DSD (\`index.html\`)
- **Chống cướp lệnh Pause khi nâng cấp First-Slice → Full Audio (\`upgradeSliceToFullAudio\`, \`resumeFullAudioFromSlice\`, \`playDsdTrack\`, \`recoverStalledAudioStream\`)**: Khi tệp đầy đủ tải xong ở giây thứ 1–4 và gọi \`deck.src = fullUrl; deck.load()\`, trình duyệt tạm đặt \`audio.paused = true\` trong khi \`deck._upgradingFullAudio === true\`. Nút \`#play-button\`, \`window.onHardwarePause\` và \`navigator.mediaSession\` (\`pause\`) nay nhận diện \`audio._upgradingFullAudio\` là đang phát, gắn cờ \`_userPausedDuringUpgrade = true\` khi người dùng bấm Tạm dừng và chặn hoàn toàn callback \`loadedmetadata\` tự động gọi \`deck.play()\` phát nhạc lại ngoài ý muốn.
- **Tạm dừng mượt bài DSD ngay khi đang giải mã nền (\`playDsdTrack\` & \`#play-button\`)**: Khi lát PCM DSD đầu tiên đã bắt đầu phát (\`state.dsdUrl\` hoặc \`!audio.paused\`), bấm \`#play-button\` sẽ tạm dừng/tiếp tục \`audio\` tức thì thay vì hủy \`state.dsdWorker\` và xóa trắng \`audio.src\`; đồng thời chặn thông điệp \`progress\` của worker ghi đè biểu tượng \`Ⅱ\` bằng \`%\`.
- **Ưu tiên tuyệt đối lệnh Pause khi nút đang hiển thị \`Ⅱ\` / \`⏸\` kể cả khi \`AudioContext\` đang \`suspended\`**: Khắc phục lỗi khi chuyển qua lại từ Bit-Perfect hoặc từ nền Android làm \`state.context.state === 'suspended'\` trong khi \`!audio.paused\` và nút hiện \`Ⅱ\`, bấm Pause từng bị nhánh \`wasContextSuspended\` nuốt lệnh và giữ nhạc phát tiếp.
- **Đồng bộ tức thì trạng thái \`standbyAudio\` & cách ly \`audio.dataset.trackId\` khi chuyển bài**: \`clearOptimisticLoadingUi()\` kiểm tra cả \`standbyAudio\` trước khi \`finishPlaybackStart\` hoán đổi deck để không bao giờ bật nhầm biểu tượng \`▶\` khi nhạc vừa phát; tạm dừng ngay bài cũ khi chuyển sang bài Cloud/DSD mới cần tải mạng và không ghi đè \`audio.dataset.trackId\` của deck cũ nếu người dùng bấm Pause giữa lúc đang tải bài mới.

#### 2. Chống bật tắt kép phím cứng Play/Pause trên FiiO M11S & Android (\`MainActivity.java\`)
- **\`handleMediaKey\` & \`MediaSession.Callback.onMediaButtonEvent\`**: Bổ sung bộ lọc chống dội 180ms (\`mLastHardwareMediaKeyAtMs\` / \`mLastHardwareMediaKeyCode\`) và nuốt trọn cả \`ACTION_DOWN\` lẫn \`ACTION_UP\` của phím media trong \`onMediaButtonEvent\`, ngăn phím cứng Play/Pause hoặc tai nghe Bluetooth kích hoạt kép qua cả \`dispatchKeyEvent\` và \`MediaSession\`.

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
