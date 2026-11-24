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
  const tag = process.argv[2] || 'v3.9.97';
  const name = process.argv[3] || `Nocturne ${tag} (Cloud Doze OAuth Refresh & Mixed-Queue Preload, Bit-Perfect USB DAC Hot-Swap & Cross-Format MediaSession, CUE Quota & ObjectURL Hygiene)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 151) — Cloud Doze OAuth Refresh & Mixed-Queue Preload, Bit-Perfect USB DAC Hot-Swap & MediaSession, CUE Quota & ObjectURL Hygiene

#### 1. Cloud Doze OAuth2 Refresh & Mixed-Queue Preload Continuity (\`index.html\`, \`MainActivity.java\`)
- Wired \`microsoftOAuthRefreshScheduler.scheduleRefresh(state.microsoftExpiresAt)\` at startup and in \`restoreMicrosoftSession()\` with lazy \`ensureMicrosoftMsalClient()\`, and added pre-expiry token checks in \`resolveMicrosoftDownloadUrl()\`.
- Decoupled periodic \`runGoogleTokenKeepAliveTick()\` cooldowns from wake \`runCloudWakeTokenRefresh()\`, re-running \`retryPendingCurrentSliceUpgrade()\` and \`resyncNextPreload(false)\` after async token refresh resolves, invalidating stale \`https://\` preloads on expired rejection, bounding silent \`requestGoogleToken\` (\`9000ms\`) and \`onNativeBitPerfectAuthRefresh\` (\`<9500ms\`), and clearing source-matched \`state._bpPreloadedStream\` on refresh.
- Added \`ConnectivityManager.NetworkCallback\`, \`ACTION_SCREEN_ON\` receiver, lifecycle-safe \`postJsToWebView()\`, wake token refresh on \`focus\`/\`mediaSession\` \`play\`/\`onHardwarePlay\`/\`onAndroidNetworkAvailable\`/\`AUDIOFOCUS_GAIN\`, and mixed-queue \`WifiLock\` retention via \`setPendingNextCloudWifiLock()\` / \`syncPendingNextCloudWifiLock()\`.
- Hardened \`preloadCloudNextDuringBitPerfect()\`, \`preloadNext()\`, \`isPreloadedStandbyStaleOrErrored()\`, \`invalidateStaleStandbyPreload()\`, and \`playTrack()\` to reuse \`state._bpPreloadedStream\`, allow DSD/Local preload without \`state.context\`, invalidate errored/pending-upgrade \`blob:\` slices, and detach \`standbyAudio\` before revoking Cloud \`blob:\` URLs.

#### 2. Android Bit-Perfect USB DAC Hot-Swap, Cross-Format Transitions & MediaSession (\`MainActivity.java\`, \`NocturnePlaybackService.java\`, \`index.html\`, \`library-utils.js\`)
- Upgraded \`notifyUsbDacChange()\` to scan all sinks prioritizing USB DACs and trigger \`USB_DAC_REMOVED\` becoming-noisy; nulled \`mAudioTrack\` immediately on release, added \`targetDevice.getSampleRates()\` + \`convertPcmChunkTo16BitResampled()\` + \`transcodeCarryBuffer()\` in \`rebuildAudioTrackWith16BitFallback()\`, passed \`format16\` to \`applyPreferredMixerLocked()\`, guarded \`PLAYSTATE_PLAYING\` writes, isolated \`mPreferredMixerAttributesSet\` under \`mMixerLock\`, and skipped the 5-min fallback blacklist on paused \`[ROUTE]\` teardown.
- Isolated per-epoch \`StreamLaunchParams\`, aligned \`MediaCodec\` PCM encoding via \`decoder.getOutputFormat()\` without 0-byte non-EOS input buffers, serialized \`HttpRangeMediaDataSource.fetchChunkWithRecovery()\` under \`mStreamIoLock\`, bounded \`durMmr\` probes, guarded \`playTrack()\` against async \`playGeneration\`/\`_bpAwaitingStart\` position bleed across Local/Cloud/DSD/WebAudio transitions, kept gapless same-parent CUE transitions in native Bit-Perfect, and adapted \`AudioContext\` sample rate to \`dsdOutputRate\` in \`playDsdTrack()\`.
- Unified \`MainActivity\` and \`NocturnePlaybackService\` notification channel/ID (\`syncBackgroundPauseIfRunning()\`, \`stopIfRunning()\`), added \`setBitPerfectTrackWindow()\` for CUE-relative \`MediaSession\` coordinates and placeholder suppression, and synced \`computeSignalPath()\`, \`buildRoonSignalPathStages()\`, \`resetBitPerfectModeBadge()\`, and DSD/USB DAC HUD badges.

#### 3. IndexedDB Quota Resilience, Multi-Folder CUE Sheets & ObjectURL Hygiene (\`index.html\`, \`library-utils.js\`, \`sw.js\`, \`MainActivity.java\`)
- Hardened \`persistCloudCatalog()\` (\`onabort\`, cover-strip, \`0.5 -> 1.0\` slice eviction), two-transaction \`pruneCloudCatalog()\`, \`evictOldestFirstSlicesForQuota()\` \`tx.oncomplete\`, \`pruneSliceCache()\` pinned keys & real \`lastStorageEstimate\`, \`sliceCacheTransaction()\` \`InvalidStateError\` DB reset, \`computeLruCacheEviction()\` pin protection, \`defragmentCacheDatabase()\` \`lastAccessedAt || savedAt\`, and \`sw.js\` \`pruneShellCache()\` on \`QuotaExceededError\`.
- Added \`assignUniqueFolderKey()\`, targeted \`clearRecentLocalFolderHandle()\`, startup permission warning, unified multi-folder \`reopenSavedFolder()\` with cross-folder/subpath \`.cue\` & \`.lrc\` matching, DSD CUE \`createObjectURL\` skip, \`fileHandle.queryPermission()\` guard before cached \`track.file\`, Android SAF sibling recovery + \`content://\` \`.cue\` reading, shared CUE rescan \`blob:\` URLs, \`releaseOrphanedCoverBlobUrl()\`, \`abortPlayCleanup()\`, \`pruneExcessObjectUrls()\` protections, and CUE \`cueEnd\` boundary pause/seek fixes.

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
