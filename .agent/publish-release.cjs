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
  const tag = process.argv[2] || 'v3.9.81';
  const name = process.argv[3] || `Nocturne ${tag} (Critical Playback & Boot Hotfix: Fix 5 Fatal Live-Chrome Crashes in displayTrack, setupAudio Sub-Bass DSP, Boot IIFE, Pre-Body Script + Hybrid Touch/Mouse Play/Pause & Cloud Token Persistence)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 135) — Vá khẩn 5 lỗi Runtime chí mạng khiến nhạc không phát được / kẹt nút Play-Pause (kiểm chứng trực tiếp trên Chrome thực)

#### 1. Vá triệt để 5 lỗi JavaScript Runtime chặn phát nhạc ngay lần bấm đầu tiên (\`index.html\`)
- **Sửa lỗi \`displayTrack()\` ném \`TypeError: Cannot read properties of null (reading 'sampleRate')\`**: Biểu thức \`(state.context ? state.context.sampleRate : 48000) ? state.context.sampleRate ...\` luôn đánh giá truthy khi \`state.context === null\`, làm sập \`playTrack()\` ngay trước khi \`setupAudio()\` và \`audio.play()\` kịp chạy — nguyên nhân trực tiếp khiến bấm Play hoặc chạm bài hát hoàn toàn không bật được nhạc.
- **Sửa lỗi \`applySubBassPunch()\` & \`applySubBassPhaseProfile()\` làm sập \`setupAudio()\`**: \`calculateSubBassPunchParams()\` trả về \`{ frequency, gain, q }\` và \`calculateSubBassPhaseParams()\` trả về \`{ cutoffHz, mixGain, isActive }\`, nhưng \`index.html\` gọi \`setTargetAtTime(params.centerFreq / params.qFactor / params.gainDb / params.centerFreqHz)\` là \`undefined\` / \`NaN\`, khiến Chrome ném \`TypeError: Failed to execute 'setTargetAtTime' on 'AudioParam': The provided float value is non-finite\` ngay cú bấm Play đầu tiên, làm kẹt nút ở trạng thái \`…\` và đứt nửa đồ thị Web Audio.
- **Sửa lỗi \`ReferenceError: quick is not defined\` tại \`syncQuickSleepPill()\`**: Bọc đầy đủ dấu nháy cho \`'quick-sleep-btn'\`, \`'text-indigo-300'\`, \`'border-indigo-400/50'\`, \`'aria-pressed'\`, giúp toàn bộ khối khởi động cuối app (khôi phục thư viện FiiO/Cloud, khôi phục phiên nghe, bật Bit-Perfect) chạy trọn vẹn với 0 lỗi.
- **Di chuyển inline script thu gọn sidebar vào sau thẻ \`<body>\`**: Tránh lỗi \`Cannot read properties of null (reading 'classList')\` khi mở app trên mobile/FiiO M11S.

#### 2. Vá chạm/chuột lai cho nút Play/Pause & Giữ phiên đăng nhập Cloud khi tải lại
- **\`attachReliableTransportTap\`**: Xóa cờ \`_touchTapGhostPending\` khi nhận \`pointerdown\` từ chuột/bút và rút ngắn cửa sổ lọc ghost-click từ 900ms xuống 450ms, đảm bảo bấm cảm ứng liên tiếp hay chuyển giữa cảm ứng và chuột đều nhận ngay cú bấm đầu tiên.
- **Lưu & khôi phục Access Token Google Drive / OneDrive còn hạn**: Lưu thêm mốc hết hạn \`nocturne-google-token-expires\` & \`nocturne-microsoft-token-expires\` và tự động khôi phục vào \`state\` khi khởi động lại app/OTA.

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
