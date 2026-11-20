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
  const tag = process.argv[2] || 'v3.9.40';
  const name = process.argv[3] || `Nocturne ${tag} (Fix dứt điểm Play/Pause & bấm 1 lần phát ngay trên Web + APK, vuốt thanh phát cảm ứng, ảnh bìa M4A/WAV/Lockscreen)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} — Fix dứt điểm Play/Pause & bấm 1 lần phát ngay (Web + Android APK), vuốt thanh phát cảm ứng & ảnh bìa nhúng

#### 1. Fix P0 Play/Pause & hiện tượng phải bấm Play nhiều lần mới phát (cả Web và APK)
- **Triệt tiêu xung đột \`SILENT_UNLOCK_WAV\` & \`AbortError\`**: \`unlockAudioDecksOnGesture(excludeEl)\` bỏ qua trên Android WebView (\`window.NocturneNative\`), loại trừ \`standbyAudio\` khi phát ngay từ cache/local, đồng thời kiểm tra \`isSilentUnlockSrc\` và tự thử lại 1 lần khi gặp \`AbortError\`.
- **Sửa \`#play-button\` & đồng bộ đổi deck**: Kiểm tra \`isBitPerfectActive()\` thực tế trên Native Android trước khi resume/pause, khôi phục \`router.gain\` và bỏ \`muted\` khi phát lại, tạm dừng cả \`audio\` + \`standbyAudio\`, đồng bộ tức thì \`#fullscreen-play-btn\`, visualizer, \`mediaSession.playbackState\` và thời lượng ngay trong \`finishPlaybackStart\`.
- **Fast-Tap không còn đảo Play→Pause 2 lần hay nuốt User Gesture**: Miễn trừ các nút điều khiển phát (\`#play-button\`, \`#room-play\`, \`#fullscreen-play-btn\`, \`#mini-play\`, v.v.) và thanh waveform khỏi \`touchend\` tổng hợp; thêm \`button { touch-action: manipulation; }\`.
- **\`BitPerfectAudioPlayer\` (\`MainActivity.java\`)**: Bổ sung \`isActive()\` / \`isBitPerfectActive()\`, chặn \`pause()\`/\`resume()\` ảo khi luồng phát đã dừng, và không gọi \`track.play()\` nếu đã bấm tạm dừng trong lúc đang nạp bộ giải mã.

#### 2. Thanh phát nhạc & Phím tắt Bit-Perfect / Cảm ứng
- **Gỡ kẹt \`state.isSeeking\`**: Tự nhả khóa \`isSeeking\` trên \`mouseup\`/\`pointerup\`/\`touchend\`/\`touchcancel\`/\`blur\`, tránh đứng thanh tiến trình sau khi kéo thả trượt.
- **Vuốt dạng sóng cảm ứng (\`attachWaveformTouchScrub\`)** trên \`#waveform-canvas\`, \`#fullscreen-waveform\`, \`#mini-waveform\`, cùng \`seekByStep\` và phím \`0\`–\`9\` hoạt động chuẩn cả Bit-Perfect & CUE.

#### 3. Ảnh bìa M4A/ALAC/WAV nhúng & Lockscreen (\`MainActivity.java\`)
- Bổ sung tách ảnh nhúng MP4/ALAC \`covr\` và WAV \`ID3 \`/\`id3 \` \`APIC\` qua \`FileChannel\`, kèm tra cứu 3 tầng cho ảnh màn hình khóa/thông báo (\`loadCachedCoverBitmap\` + \`mCurrentSourceKey\`).

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
