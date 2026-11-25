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
  const tag = process.argv[2] || 'v3.9.103';
  const name = process.argv[3] || `Nocturne ${tag} (AVRCP 1.6 & USB DAC Bit-Perfect Recovery, Cloud & FiiO SAF Delta/CUE Hot-Swap, Queue Persistence & Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 157) — AVRCP 1.6 Position Sync, USB DAC Bit-Perfect Mixer Recovery, Queue Persistence & Cloud/Local/SAF Delta + CUE Hot-Swap

#### 1. R1: Android Old (API 26–30 / FiiO M11S / Chromium 74) & New (API 31–35+) AVRCP 1.6, USB DAC Recovery & Queue Persistence (\`MainActivity.java\`, \`index.html\`)
- Guarded \`runPlaybackLoop\` 1000ms \`updateMediaSessionPosition\` with \`mSeekGeneration\`, \`mSeekTargetUs\`, and \`mTrackWindow.seq\`; pushed immediate post-seek PTS to \`MediaSession\` (both playing and paused); clamped backward CUE \`setTrackWindowMeta\` switches; isolated Android WebView \`navigator.mediaSession\` during Native Bit-Perfect playback; fixed \`seekCurrentPlaybackToSeconds(0)\` and duration UI sync.
- Upgraded \`Api34AudioHelper\` on API 34+ to query \`getSupportedMixerAttributes\` for integer PCM (\`24BIT_PACKED\`/\`32BIT\`/\`16BIT\`) with float-to-int PCM conversion fallback, cleared stale \`mPreferredMixerAttributesSet\` on \`fallbackAttrs\`, added bounded settle/retry on rapid consecutive-track switches (\`44.1/16 -> 96/24 -> 192/24 -> 44.1/16\`) across API 26–30 and API 31–35+, and cleared \`bitPerfectLockedFormat\` before \`startBitPerfectPlayback\`.
- Flushed \`savePlaybackSession(true)\` on all queue mutations and \`onAndroidAppLifecycle('background')\`/\`visibilitychange\`, merged pending \`queueTrackIds\` cleanly across async Cloud/Local rehydration, and fixed \`onNativeBitPerfectAuthRefresh\` to rebuild Google Drive URLs and invalidate stale \`_bpPreloadedStream\`.

#### 2. R2: Cloud (Google Drive / OneDrive) & Local/FiiO/SAF Incremental Sidecars & CUE Hot-Swap (\`index.html\`, \`library-utils.js\`, \`MainActivity.java\`)
- Hardened Google Drive & OneDrive delta reconciliation for added, updated, and permanently removed \`.lrc\` and \`folder.jpg\` files (including disc subfolders, \`/drive/root:/\` prefix stripping, NFC filename matching, and \`metadataRetryAt\` clearing) while preserving ReplayGain, \`rating\`, \`playCount\`, \`isFavorite\`, and \`trackAnnotations\`.
- Upgraded Web Local & FiiO/Android SAF (\`DocumentsContract\`) incremental sync for in-place CUE hot-swap (refreshing metadata/timing/duration/LRC without losing user fields), deleted \`.cue\`/\`.lrc\`/\`folder.jpg\` cleanup, \`&v=\` cover cache-busting, and ReplayGain compaction.

#### 3. R3 & R4: Unit Tests, Live Chrome CDP E2E Group L & Release Parity (\`test/v3-9-103-*.test.cjs\`, \`live-chrome-play-pause-test.cjs\`)
- Added \`test/v3-9-103-r1-avrcp-dac-queue.test.cjs\`, \`test/v3-9-103-r2-delta-cue-saf.test.cjs\`, \`test/v3-9-103-r3-oauth-seek-parity.test.cjs\`, and Chrome CDP E2E Group L verifying cross-deck seek parity (\`#seek\` <-> \`#seek-mobile\` <-> \`#room-seek\`) and mid-session queue persistence with \`0\` uncaught JS exceptions.

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
