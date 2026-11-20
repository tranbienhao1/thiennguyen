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
  const tag = process.argv[2] || 'v3.9.35';
  const name = process.argv[3] || `Nocturne ${tag} (FiiO M11S tự giữ kết nối bộ nhớ vĩnh viễn + Gộp Album/Nghệ sĩ chỉ giữ Ca sĩ chính)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} — Giữ kết nối bộ nhớ FiiO M11S & Sửa lỗi tách Nghệ sĩ phụ

#### 1. FiiO M11S tự động giữ kết nối bộ nhớ vĩnh viễn (không phải bấm quét/kết nối lại)
- **Lưu kép danh mục & trạng thái kết nối ở tầng Native Android (\`MainActivity.java\`)**: Ngay khi quét được nhạc trên bộ nhớ máy/thẻ MicroSD, APK tự lưu lại trạng thái đã kết nối (\`PREF_FIIO_STORAGE_LINKED\`, danh sách thư mục gốc MicroSD) vào \`SharedPreferences\` và sao lưu danh mục \`fiio_library_cache.json\` trong \`filesDir\` (an toàn kể cả khi xóa cache WebView hoặc cập nhật OTA).
- **Tự khôi phục & lắng nghe gắn lại thẻ MicroSD (\`ACTION_MEDIA_MOUNTED\`)**: Tự động khôi phục danh mục khi mở app, tự động đồng bộ nền ngay cả khi đã có danh sách nhạc Cloud, và tự thử lại nếu thẻ MicroSD vừa khởi động xong.

#### 2. Sửa triệt để lỗi đọc Album & Nghệ sĩ tách quá nhiều ca sĩ phụ
- **Đọc \`ALBUM_ARTIST\` từ MediaStore & thẻ nhạc**: \`scanMediaStoreAudio\` tự động đọc thêm cột \`album_artist\` (có fallback an toàn cho Android 10 FiiO M11S) và truyền sang \`library-utils.js\`.
- **Nâng cấp \`primaryArtistName\` & gom nhóm thông minh (\`buildLibraryCollections\`)**: Lọc sạch nghệ sĩ phụ (\`ft.Min\`, \`feat.\`, \`HIEUTHUHAI X Negav\`, \`Sơn Tùng M-TP / Onionn\`, \`A - B\`, \`cùng\`, \`với\`, \`·\`, \`、\`, trong ngoặc \`(...)\`), đồng thời gom các bài cùng thư mục album/nghệ sĩ album về 1 Nghệ sĩ chính duy nhất (hoặc \`Various Artists\` cho album tổng hợp nhiều ca sĩ).

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
