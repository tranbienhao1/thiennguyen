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
  const tag = process.argv[2] || 'v3.9.74';
  const name = process.argv[3] || `Nocturne ${tag} (Android Bit-Perfect USB DAC Hotswap Rebuild + Web Bit-Perfect DAC sinkId Preservation + Android SAF Revoked-URI 403 Detection)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 128) — Chuyển USB DAC nóng ở chế độ Bit-Perfect + Giữ \`sinkId\` DAC Web khi đổi Sample Rate + Phát hiện thu hồi quyền SAF Android 11–15

#### 1. Bit-Perfect USB DAC Hot-Swap (khi đang phát & tạm dừng) + Đồng bộ DAC \`sinkId\` Web (\`MainActivity.java\`, \`index.html\`)
- **Chuyển mạch nóng USB DAC kể cả khi đang Tạm dừng (\`BitPerfectAudioPlayer.onAudioOutputRouteChanged\`, \`notifyUsbDacChange\`)**: Khi cắm hoặc rút USB-C DAC trong lúc nhạc Bit-Perfect đang phát hoặc tạm dừng, \`runPlaybackLoop\` nhận biết thay đổi \`AudioDeviceInfo\`, giải phóng sạch mixer cũ, tái tạo \`AudioTrack\` với thiết bị đích mới, gọi \`applyApi34BitPerfectMode(track)\` (đồng bộ cả trên nhánh dựng ban đầu, đổi định dạng, \`ERROR_DEAD_OBJECT\` và đổi route), cập nhật UI via \`notifyBitPerfectFormatToWeb\` mà vẫn tôn trọng trạng thái pause/play hiện tại.
- **Giữ nguyên ngõ ra DAC (\`sinkId\`) & \`playbackRate\` khi \`AudioContext\` đổi Sample Rate (\`attachAudioElement\`)**: Khi Web Audio tạo bản sao phần tử \`<audio>\` để khớp \`sampleRate\` 44.1kHz <-> 96kHz/192kHz của từng bài Hi-Res, áp dụng lại \`sinkId\` đang chọn và tốc độ phát thay vì rớt về loa mặc định; \`window.onAndroidAudioDeviceChanged\` tự làm mới danh sách ngõ ra và khôi phục \`AudioContext\` tạm treo khi kết nối DAC mới.

#### 2. Phát hiện sớm quyền SAF Android 11–15 bị thu hồi & phản hồi rõ ràng (\`index.html\`)
- **\`probeLocalMediaAccessError\` + \`ensureLocalTrackPlayableUrl\`**: Với các URI SAF \`content://...documents...\`, kiểm tra \`window.NocturneNative.hasValidPersistedUriPermission\` trước khi phát và thăm dò \`HEAD\` trên \`/local-media\` (bắt HTTP \`403\` + header \`X-Nocturne-Storage-Error: SAF_PERMISSION_REVOKED\` hoặc \`404\`), vẫn cho phép phát mượt nếu fallback đường dẫn vật lý/MediaStore của native trả về 200 OK.
- **Xử lý lỗi \`playTrack\` chính xác theo quyền SAF**: Khi \`<audio>\` báo lỗi trên URL \`/local-media?\`, phân biệt thu hồi quyền SAF (\`403\`) để hiện thông báo hướng dẫn cấp lại quyền thay vì bỏ qua âm thầm sang hàng loạt bài lỗi kế tiếp.

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
