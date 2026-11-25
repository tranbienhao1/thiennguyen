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
  const tag = process.argv[2] || 'v3.9.104';
  const name = process.argv[3] || `Nocturne ${tag} (Gapless Bit-Perfect & DSD Transitions, Doze FGS Continuity, Multi-Disc Album Merge, ReplayGain Parity & M3U8 Sync)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 158) — Gapless Bit-Perfect & DSD Transitions, Doze FGS Survivability, Multi-Disc Album Merge, ReplayGain Parity & M3U8 Playlist Sync

#### 1. R1: Android Old (API 26–30 / FiiO M11S / Chromium 74) & New (API 31–35+) Gapless Bit-Perfect, DSD-to-PCM & Doze Playback Service (\`MainActivity.java\`, \`NocturnePlaybackService.java\`, \`index.html\`)
- Added \`BitPerfectAudioPlayer\` natural-EOS tail-frame drain (\`getPlaybackHeadPosition\`), clickless micro-ramp on seek/pause/format switches, 2-step USB DAC settle (\`55ms + 95ms\`), and API 26–30 \`INFO_OUTPUT_FORMAT_CHANGED\` synchronization.
- Added bounded \`mTransitionHoldUntilElapsedMs\` EOS/handoff hold, \`stopBitPerfectPlaybackForHandoff()\`, and \`setPlaybackLoadingWakeLock()\` across \`MainActivity.java\` and \`NocturnePlaybackService.java\` so API 26–30 and API 31–35+ keep foreground service, \`WakeLock\`/\`WifiLock\`, and \`AudioFocus\` across consecutive tracks while fixing \`START_STICKY\` null-intent zombie notifications.
- Hardened Web Audio \`Deck A <-> Deck B\` \`65ms\` deferred cleanup & \`0.07s\` lookahead, \`attachDeckEvents\` \`pause\`-on-\`ended\` guard, \`safeResumeAudioContext(350)\`, \`stopDsdWorker(false)\` ordering before \`setupAudio()\`, and \`fiio_\` DSD \`previousTrack.file\` release.

#### 2. R2: Cloud & Local/FiiO/SAF Multi-Disc Album Merge, ReplayGain Parity & Incremental M3U8 Sync (\`library-utils.js\`, \`library-tools.js\`, \`index.html\`)
- Unified \`parseDiscSubfolderInfo\` and \`stripAlbumDiscSuffix\` to merge multi-disc subfolders (\`CD 1\`, \`CD 2\`, \`Disc A\`, \`Side 1\`, \`Vol. 1\`) and \`Various Artists\` compilations across Google Drive (\`googleFolderTree\`), OneDrive, and Local/FiiO SAF (\`decodeSafDocRelativePath\`).
- Routed all M3U/M3U8 exports through \`exportPlaylistM3u8\` (never emitting \`blob:\`/\`data:\`/\`appassets\` URLs) and hardened \`matchPlaylistWithLibrary\` with SAF \`docId\` decoding, \`#EXTDISC:\` disambiguation, and folder/disc-conflict guards.
- Fixed \`albumPeak\` selection in \`calculateDynamicReplayGain\`, \`formatReplayGain\` compatibility, per-deck \`deck.replayGain\` \`GainNode\` isolation across \`Deck A <-> Deck B\`, and strict unity gain (\`1.0\`) bypass via \`applyBitPerfectMode\`.

#### 3. R3 & R4: Unit Tests, Live Chrome CDP E2E Group M & Release Parity (\`test/v3-9-104-*.test.cjs\`, \`live-chrome-play-pause-test.cjs\`)
- Added \`test/v3-9-104-r1-gapless-dsd-doze-dac.test.cjs\`, \`test/v3-9-104-r2-multidisc-m3u-replaygain.test.cjs\`, \`test/v3-9-104-r3-e2e-compat-release.test.cjs\`, and Chrome CDP E2E Group M verifying multi-disc merge, ReplayGain Track/Album & Bit-Perfect Deck A/B switching, and M3U8 round-trip with \`0\` uncaught JS exceptions.

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
