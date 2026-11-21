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
  const tag = process.argv[2] || 'v3.9.54';
  const name = process.argv[3] || `Nocturne ${tag} (Sửa lỗi không mở được thanh Sidebar trên Android đời mới + CUE nội bộ Android & nâng cấp bản full Cloud mượt)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 108) — Sửa lỗi không mở được thanh Sidebar trên Android đời mới + CUE nội bộ Android & nâng cấp bản full Cloud mượt

#### 1. Khắc phục triệt để lỗi không mở được thanh Sidebar trên Android đời mới (\`index.html\`)
- **Chặn ghost-click tự đóng \`#sidebar-backdrop\` ngay sau khi bấm \`☰\`**: Trên Android 12–15 (Chromium WebView đời mới), click tổng hợp sau \`touchend\` rơi vào \`#sidebar-backdrop\` vừa hiện ra tại đúng tọa độ bấm làm thanh bên vừa mở đã tự đóng ngay lập tức. Nay bảo vệ 3 lớp: gắn \`attachReliableTransportTap\` + \`e.preventDefault()\` trực tiếp cho \`#sidebar-toggle\`, bổ sung khóa \`sidebarOpenedAt\` (350ms) cho \`#sidebar-backdrop\`/\`#sidebar\`, và nâng cấp bộ chống lặp Fast-Tap kiểm tra tọa độ \`lastFastTapPos\` (chặn ghost-click trên mọi ngăn kéo/hộp thoại mới mở mà vẫn tuyệt đối không nuốt thao tác bấm nút Play/Pause).

#### 2. Quét & tách album \`.cue\` nội bộ trên Android / FiiO M11S (\`MainActivity.java\`, \`index.html\`)
- **Đọc tệp \`.cue\` nội bộ an toàn (\`NocturneNative.readLocalTextFile\`)**: Bổ sung cầu đọc văn bản giới hạn 512 KB qua \`resolveReadableLocalFile\` (hỗ trợ đường dẫn Unicode \`NFC\`/\`NFD\`, ký tự \`+\`, UTF-8/UTF-16 BOM) cho \`.cue\`, \`.lrc\`, \`.m3u\`.
- **Tự động tách bài con CUE từ thẻ nhớ MicroSD (\`expandFiioScannedCueSheets\`)**: Không còn tạo mục nhạc lỗi từ tệp \`.cue\`/\`.iso\`; tự động khớp tệp FLAC/WAV/APE/WV cùng thư mục, tách thành từng bài con mang đủ \`cueStart\`, \`duration\`, \`trackNumber\`, \`discNumber\`, tên bài/nghệ sĩ/album và lưu bền vững qua \`compactFiioTrackForStorage\` / \`hydrateFiioStoredTrack\`.

#### 3. Chuyển tiếp mượt lát đầu -> bản full Cloud & giữ chính xác mốc tua sớm (\`index.html\`)
- **Chống nhấp nháy nút Play/Pause & thông báo khóa màn hình**: Gắn cờ \`deck._upgradingFullAudio\` trong \`upgradeSliceToFullAudio\` và \`resumeFullAudioFromSlice\` để bộ lắng nghe \`pause\` bỏ qua sự kiện \`pause\` tạm thời do \`deck.load()\` phát sinh.
- **Bảo toàn chính xác vị trí tua sớm (\`_pendingSeekAfterFullUpgrade\`)**: Không cộng bù độ trễ \`elapsedSec\` khi người dùng đã chọn mốc tua tường minh, hỗ trợ \`_pendingSeekAfterFullUpgrade\` trong cả \`resumeFullAudioFromSlice\` và cập nhật ngay thanh tiến độ + \`MediaSession\`.

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
