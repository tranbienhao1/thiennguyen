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
  const tag = process.argv[2] || 'v3.9.100';
  const name = process.argv[3] || `Nocturne ${tag} (Old/New Android Parity, Cloud Resync & Doze OAuth2 Refresh, Bit-Perfect Continuity, Overlapping Crossfade Fix & CDP E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 154) — Old/New Android Parity, Cloud Resync & Doze OAuth2 Refresh, Bit-Perfect Continuity & Overlapping Crossfade Fix

#### 1. Android Old (API 26–30 / FiiO M11S / Chromium 74) & New (API 31–35+) Playback & Sync Parity (\`MainActivity.java\`, \`index.html\`)
- Guarded \`AudioTrack.isDirectPlaybackSupported()\` with \`Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q\` (providing an explicit API 26–28 \`getMinBufferSize\` fallback), replaced deprecated \`getActiveNetworkInfo()\` with \`getNetworkCapabilities(NET_CAPABILITY_INTERNET)\` under \`SDK_INT >= M\`, simplified \`WIFI_MODE_FULL_HIGH_PERF\` initialization, and removed the redundant \`onDestroy()\` \`startService(stopIntent)\` call.
- Separated \`scopedRestrictedRoots\` from \`unreadableRoots\` in \`startAsyncStorageScan()\` / \`buildStorageScanStatsJson()\` so Android 11–15+ Scoped Storage \`File.canRead()\` denials no longer block \`pruneMissingFiioTracks()\` on MediaStore scans while keeping API 26–29 FiiO M11S SD card protection intact.
- Updated \`index.html\` CSS to wrap safe-area insets via \`var(--safe-area-top/bottom, env(safe-area-inset-*, 0px))\` across tablet/desktop views (\`#listening-room\`, \`#roon-fullscreen-view\`, \`#settings-modal\`) and added \`100vh\` / \`calc(100vh - ...)\` fallbacks before every \`100dvh\` rule for Chromium \`< 108\`.

#### 2. Cloud Large-Library Resync, Doze Background OAuth2 Refresh & Native Bit-Perfect Continuity (\`index.html\`, \`MainActivity.java\`)
- Persisted mid-delta pagination cursors, tombstones, and folder-tree updates across transient network/401/429 interruptions in \`tryLoadGoogleChangesDelta()\` and \`tryLoadMicrosoftDeltaSync()\`; replaced the \`MS_CHECKPOINT_MAX_QUEUE = 4000\` checkpoint wipe in \`loadMicrosoftFiles()\` with safe compaction, merged \`msFullFolderTree\` on resume, added a shared per-provider 429 cooldown gate across concurrent workers, and guarded expired Fast Tokens in \`scheduleOnlineCloudDeltaSync()\`.
- Committed wake/keepalive cooldowns only on settled success with in-flight locks, split \`mNetworkCallback\` \`onAvailable\` / \`NET_CAPABILITY_VALIDATED\` throttles, added a Doze-exit \`ACTION_DEVICE_IDLE_MODE_CHANGED\` receiver in \`MainActivity.java\`, invalidated \`_bpPreloadedStream\` on token refresh/reconnect, and surfaced non-blocking expired Fast-Token status at startup.
- Bounded \`mResolvedRedirectUrl\` resets in \`HttpRangeMediaDataSource.fetchChunkWithRecovery()\`, tracked \`tokenSnapshot\` inside \`_bpPreloadedStream\`, cleared \`<audio>\` \`src\` in \`suspendWebAudioForBitPerfect()\` without exempting \`track.id\` in \`abortStaleFullAudioUpgrades()\`, re-acquired WakeLock/AudioFocus & called \`savePlaybackSession(true)\` / \`audio.load()\` on DSD/Web Audio handoffs, and guarded \`isSameCueNativeParent\` transitions against stale file-EOS \`onBitPerfectPlaybackComplete()\`.

#### 3. Overlapping Crossfade \`setValueCurveAtTime\` Fix, Unit Tests & Live Chrome CDP E2E (\`index.html\`, \`test/v3-9-100-*.test.cjs\`, \`live-chrome-play-pause-test.cjs\`)
- Tracked \`state._crossfadeCleanupTimer\` in \`finishPlaybackStart()\`, cleared stale timers on overlapping transitions, scoped \`oldDeck.router.gain\` reset & URL release inside \`generation === state.playGeneration\`, guarded \`preloadNext()\` standby gain cancellation in \`try/catch\`, and preserved \`startIn\` / added \`linearRampToValueAtTime\` fallback in \`applyCrossfade()\`.
- Expanded \`test/v3-9-100-*.test.cjs\` and \`live-chrome-play-pause-test.cjs\` (Groups E–G: API 29 vs API 34+ bridge & narrow/wide viewport parity, rapid Track 1 -> Track 2 -> Track 3 overlapping crossfades, and combined render-recovery queue + persisted \`.lrc\` rehydration with \`0\` uncaught JS exceptions).

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
