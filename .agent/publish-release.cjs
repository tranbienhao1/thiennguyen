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
  const tag = process.argv[2] || 'v3.9.78';
  const name = process.argv[3] || `Nocturne ${tag} (Bulletproof Play/Pause State Machine, Touch/Fast-Tap Capture Isolation, Android Bit-Perfect AudioFocus Guard & Shuffle/Queue Preload Re-Sync)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 132) — Sửa triệt để nút Play/Pause trên Web & Android/FiiO M11S + Chống tự dừng Bit-Perfect do WebView AudioFocus + Đồng bộ Preload Shuffle/Queue

#### 1. Sửa triệt để các luồng lỗi nút Play/Pause trên Web, Android WebView & FiiO M11S (\`index.html\`, \`MainActivity.java\`)
- **Ưu tiên tạm dừng khi đang phát & chống khởi động lại bài (\`#play-button\`)**: Khi bất kỳ deck nào (\`audio\`, \`standbyAudio\`, \`activeDeck.element\`, \`corsBypassAudio\`) đang phát thực tế hoặc sau khi giải mã DSD đầy đủ (\`playDsdTrack\` gắn \`audio.dataset.trackId = String(track.id)\`), bấm \`#play-button\` / \`#room-play\` / \`#mini-play\` / \`#fullscreen-play-btn\` sẽ tạm dừng ngay lập tức thay vì rơi vào nhánh \`hasMismatchedTrack\` gọi lại \`playTrack\` từ đầu; đồng thời cho phép bấm Play/Pause sau 250ms khi đang nạp bài (\`state.isPlaybackLoading\`) để hủy nạp và về trạng thái tạm dừng (\`▶\`).
- **Cách ly cảm ứng & chống nuốt click trên màn hình cảm ứng (\`resolveEventElement\`, \`attachReliableTransportTap\`)**: Giải quyết đích sự kiện kể cả khi chạm vào Text node (\`▶\`/\`Ⅱ\`) bên trong nút, tách hoàn toàn các nút điều khiển phát nhạc khỏi bộ chặn ghost-click toàn cục \`document.addEventListener('click', ..., true)\`, và chốt lại mốc \`_touchTapHandledAt\` sau khi \`el.click()\` thực thi xong để chặn ghost click trễ mà không nuốt lần chạm kế tiếp.
- **Chống WebView tự cướp \`AudioFocus\` làm tự dừng \`BitPerfectAudioPlayer\` (\`MainActivity.java\`, \`index.html\`)**: Không tự gọi \`setupAudio()\` / \`state.context.resume()\` trước khi phân nhánh \`playTrack\` hoặc khi đang định tuyến sang Native Bit-Perfect, đồng thời bảo vệ \`BitPerfectAudioPlayer\` trước xung đột \`AUDIOFOCUS_LOSS\` nội bộ từ Chromium WebView trong cửa sổ 1.5 giây sau khi bấm Play/Resume ở tiền cảnh.

#### 2. Đồng bộ lại \`preloadNext\` khi bật/tắt Trộn bài (Shuffle) & thao tác Hàng đợi (\`index.html\`)
- **\`#shuffle-button\` & \`triggerRoonAction\`**: Xóa \`state.preloadTrackId\` / \`state.preloadReadyUrl\` cũ trước khi gọi \`preloadNext(true)\` khi đổi chế độ Shuffle, đồng thời kích hoạt \`preloadNext(true)\` ngay khi chèn bài qua \`play_next\` / \`add_queue\` / \`start_radio\`.

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
