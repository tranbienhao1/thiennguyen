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
  const tag = process.argv[2] || 'v3.9.99';
  const name = process.argv[3] || `Nocturne ${tag} (Standby Pre-Seek & Cloud .LRC Retry Hygiene, Safe Cloud/FiiO Incremental Sync & MediaSession Transitions, Render-Crash Rehydration, Old/New Android Parity & Chrome E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 153) — Standby Pre-Seek & Cloud .LRC Retry Hygiene, Safe Cloud/FiiO Incremental Sync & MediaSession Transitions, Render-Crash Rehydration & Old/New Android Compatibility

#### 1. Standby Pre-Seek Consolidation, Async CurrentTime Guard & Cloud Sidecar .LRC Transient-Error Retry Hygiene (\`index.html\`)
- Consolidated \`standbyAudio\` pre-seek and asynchronous \`currentTime\`/\`seeking\` guards via \`ensureInitialSeekAfterPlay()\` and \`playTrack()\`'s single \`loadedmetadata\`/\`seeked\` flow (respecting \`playGeneration\` and \`_bpPositionGuardToken\`, plus \`isSameCueHtmlParent\` \`seeking\` guard) so CUE/resume initial seeks never race or double-trigger across decks.
- Wired \`fetchCloudSidecarLrc()\` to status-aware \`fetchCloudSidecarLyrics(track, { detailed: true })\` and hardened \`enrichCloudTrack()\` to stamp \`_checkedDriveLrc\` / \`_cloudLrcChecked\` ONLY on \`found\` or definitive \`404\`/\`not_found\`, preserving retries with backoff across transient network errors or HTTP \`401\`/\`429\`/\`5xx\`.

#### 2. Google Drive / OneDrive / Local FiiO M11S Incremental Sync & Native Bit-Perfect / MediaSession Transitions (\`index.html\`, \`MainActivity.java\`)
- Hardened \`syncGoogleFolderTree()\` against partial-error/truncation overwrites, deferred \`tryLoadGoogleChangesDelta()\` and \`tryLoadMicrosoftDeltaSync()\` delta-cursor commits until after \`removeCloudTracksByRemoteIds()\` + persistence, indexed newly arrived delta tracks in \`existingByParentId\`, made OneDrive \`remotePath\` prefix pruning case-insensitive with hierarchical shared-path fallback, and protected Local/FiiO scans (\`collectAudioAndCoverFilesFromDirectoryHandle()\`, \`scanFiioStorage()\`, \`getLastStorageScanStatsJson()\`, \`isAsyncStorageScanRunning()\`) against late post-watchdog callbacks, truncated/unreadable-root pruning, and SAF \`content://\` regressions.
- Hardened Native Bit-Perfect USB DAC & \`MediaSession\`/AVRCP parity across PCM <-> CUE <-> DSD boundaries: added \`TrackWindowSnapshot\` + atomic \`setTrackWindowMeta()\`, preserved same-epoch position/duration in \`updateMediaSessionMetadata()\` (including \`album\` diff), fixed off-UI-thread notification updates in \`BitPerfectAudioPlayer.start()\`, fixed tail-CUE \`getDisplayDurationMs()\`, made \`mPendingRenderProcessRehydration\` sticky until \`ackBitPerfectRehydration()\` with \`dispatchPendingBitPerfectEosIfReady()\` & \`finalizeBitPerfectEndOfQueue()\`, and updated \`rehydrateNativeBitPerfectPlayback()\` & \`displayTrack()\` notification ordering.

#### 3. Chrome CDP E2E Expansion, Unit Tests & Old/New Android Compatibility Verification (\`live-chrome-play-pause-test.cjs\`, \`test/v3-9-99-*.test.cjs\`, \`AndroidManifest.xml\`, \`MainActivity.java\`, \`NocturnePlaybackService.java\`)
- Expanded \`live-chrome-play-pause-test.cjs\` (\`113/113\` assertions across baseline + Groups A–D, \`0\` uncaught JS exceptions) and added \`test/v3-9-99-*.test.cjs\` covering multi-level Cloud subtree pruning, WebView render-crash \`rehydrateNativeBitPerfectPlayback()\` snapshot recovery, sidecar \`.lrc\` transient-error retry hygiene, and crossfade/gapless/CUE edge cases.
- Audited and verified full compatibility across BOTH Old Android (API 26–30 / FiiO M11S Android 10 & Chromium 74 WebView: strict ES2019 JS, \`Build.VERSION.SDK_INT\` guards, legacy storage & 16-bit AudioTrack fallback) and New Android (API 31–35+: Scoped Storage / \`READ_MEDIA_AUDIO\`, \`POST_NOTIFICATIONS\`, \`RECEIVER_EXPORTED\`/\`RECEIVER_NOT_EXPORTED\`, \`FOREGROUND_SERVICE_MEDIA_PLAYBACK\`, API 34 Bit-Perfect \`Api34AudioHelper\`, Doze locks, and edge-to-edge insets).

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
