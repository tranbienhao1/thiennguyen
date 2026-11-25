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
  const tag = process.argv[2] || 'v3.9.102';
  const name = process.argv[3] || `Nocturne ${tag} (FiiO M11S & Android Play/Pause Fix, Instant Google Drive Album Sync & Search, Priority Metadata Queue)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 156) — Urgent P0 Fix: FiiO M11S & Android Play/Pause + Instant Google Drive Album Sync, Search & Priority Metadata

#### 1. P0-A: Bulletproof FiiO M11S & Android (API 26–30 + API 31–35+) Play/Pause Fix (\`index.html\`, \`MainActivity.java\`, \`NocturnePlaybackService.java\`)
- Expanded \`attachReliableTransportTap\` ghost-click suppression to \`1200\` ms, prevented Chromium 74 compatibility \`pointerdown\` from clearing \`_touchTapGhostPending\` before \`1200\` ms, and added a \`260\` ms Play/Pause \`touchend\` bounce guard (\`120\` ms for other transport buttons) with \`e.stopPropagation()\`.
- Isolated WebView \`navigator.mediaSession\` \`'pause'\` / \`'play'\` handlers when \`window.NocturneNative\` Bit-Perfect playback is active so Android \`AUDIOFOCUS_LOSS\` on WebView never stops native \`BitPerfectAudioPlayer\` while keeping Web/PWA behavior unchanged.
- Added cross-path \`KeyEvent.getDownTime()\` deduplication (\`isDuplicateMediaKeyEvent\` / \`handleMediaKeyEvent\`), \`450L\` ms Play/Pause key-group & \`MediaSession.Callback\` (\`onPlay\`/\`onPause\`/\`onStop\`) echo suppression, \`350L\` ms notification \`ACTION_PLAY_PAUSE\` debounce, screen-off & API < 26 \`mLegacyAudioFocusListener\` \`1200L\` ms self-focus guards, and \`track.play()\` timestamp refresh.

#### 2. P0-B: Instant Google Drive Album Sync, Cross-View Search & Priority Metadata Queue (\`index.html\`, \`library-utils.js\`)
- Added \`GOOGLE_FOLDER_NAMES_KEY\`, \`syncGoogleFolderTree\` \`id,name,parents\` capture, \`applyGoogleDriveFolderMetadataToTrack\` (supporting \`Artist - Album\`, grandparent artist, \`CD 1\` disc subfolders, and Vietnamese/English fallbacks), and \`hydrateGoogleDriveFolderMetadata\` in both full scan and \`tryLoadGoogleChangesDelta\` before \`renderTracks()\`.
- Expanded \`normalizedTrackMetadata\` in \`library-utils.js\` to index filename stem, \`albumArtist\`, \`folderName\`, \`remotePath\`, and \`relativePath\` with cache invalidation; fixed \`renderCollectionCards\` to keep albums/artists/genres with matching songs (and show track rows fallback when needed); fixed searching from \`Home\` view to switch to \`songs\` and prioritize matching untagged cloud tracks.
- Eliminated \`cloudMetadataQueue\` priority inversion via \`getCloudMetadataPriority\` (Tiers 0–3) & \`prioritizeCloudMetadataTracks\`, enabled \`2\`/\`1\` concurrency on \`IS_LEGACY_ANDROID\` and \`3\` on modern Android (API 31–35+) & Desktop, and deferred \`.lrc\` sidecar probes during untagged tag backlogs.

#### 3. Unit Tests, Live Chrome CDP E2E & Release Parity (\`test/v3-9-102-*.test.cjs\`, \`live-chrome-play-pause-test.cjs\`)
- Added \`test/v3-9-102-p0-fiio-play-pause.test.cjs\`, \`test/v3-9-102-p0-drive-sync-search.test.cjs\`, and Chrome CDP E2E Group K with \`0\` uncaught JS exceptions.

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
