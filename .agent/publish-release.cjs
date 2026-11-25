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
  const tag = process.argv[2] || 'v3.9.98';
  const name = process.argv[3] || `Nocturne ${tag} (CUE Auto-Crossfade & MediaSession Parity, Cloud Subtree Pruning & Metadata/LRC Queue Sync, Android Render-Recovery Bit-Perfect Rehydration)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 152) — CUE Auto-Crossfade & MediaSession Parity, Cloud Subtree Pruning & Metadata/LRC Queue Sync, Android Render-Recovery Bit-Perfect Rehydration

#### 1. Web + Android CUE Auto-Crossfade, Gapless Lookahead & MediaSession CUE Seek Parity (\`index.html\`, \`library-utils.js\`, \`MainActivity.java\`)
- Added \`library.resolveEffectiveTrackTiming()\` and guarded \`library.shouldAutoCrossfade()\` against \`options.isNativeBitPerfect\`; unified \`timeupdate\` in \`index.html\` so CUE virtual tracks evaluate \`shouldAutoCrossfade\`, \`gaplessLookaheadEligible\`, \`shouldPreloadNext\`, and \`savePlaybackSession()\` using CUE-relative track timing (\`cueStart\`/\`cueEnd\`/\`duration\`) rather than \`element.duration\`, while blocking Web triggers and \`applyCrossfade()\` whenever \`state.isNativeBitPerfectPlaying || state.isNativeBitPerfectPaused\`.
- Enabled Deck A <-> Deck B crossfade on same-parent CUE transitions when \`crossfadeSeconds > 0\`, and ensured \`playTrack()\` awaits \`loadedmetadata\` (bounded) and pre-seeks \`standbyAudio.currentTime = cueStart\` (awaiting \`seeked\`) before calling \`target.play()\` and \`applyCrossfade()\`.
- Added \`getCueWindowStartMs()\`, \`getCueWindowDurationMs()\`, \`clampCueWindowPositionMs()\`, and \`windowRelativeSeekToAbsoluteMs()\` on \`BitPerfectAudioPlayer\`, clamping fallback \`dispatchSeekToWeb()\` and \`dispatchSeekOffsetToWeb()\` inside \`[mCueWindowStartMs, mCueWindowStartMs + mCueWindowDurationMs]\`.

#### 2. Google Drive / OneDrive Nested Folder Subtree Pruning & Cloud Metadata/LRC Queue Resume Sync (\`index.html\`, \`library-utils.js\`)
- Added persistent folder parent trees (\`nocturne-google-folder-tree\`, \`nocturne-onedrive-folder-tree\`), OneDrive \`$select=...parentReference\`, recursive BFS subtree expansion on deleted/trashed ancestor folders in \`tryLoadGoogleChangesDelta()\` and \`tryLoadMicrosoftDeltaSync()\`, \`remotePath\` prefix fallback pruning, and recursive folder rename propagation.
- Extended \`serializableCloudTrack\` to persist \`replayGain*\`, \`iTunNORM\`, \`_replayGainChecked\`, \`_checkedDriveLrc\`, \`_cloudLrcChecked\`, and bounded \`lyricsText\`; added \`needsCloudMetadataEnrichment()\` and \`repopulateCloudMetadataQueue()\` across \`restoreCloudCatalog()\`, token restoration/paste, and \`online\` events with periodic \`flushQueuedCloudCatalogPersist()\` checkpointing and \`enrichCloudTrack()\` sidecar \`.lrc\` probing.
- Extended \`buildStableTrackRef()\` and \`matchTrackByStableRef()\` for \`remoteShortcutId\`/\`cueFile\`/\`parentFile\` and symmetric remote alias cross-matching, and hardened \`checkAndPromptResumeSession()\` with Native Bit-Perfect/dismiss guards and delayed Cloud/CUE re-reconciliation.

#### 3. Android WebView Render-Process Recovery Bit-Perfect Rehydration & Chrome E2E (\`MainActivity.java\`, \`index.html\`, Chrome E2E)
- Added \`setBitPerfectTrackId(String)\`, locked DAC format caching (\`mLockedSampleRate\`, \`mLockedBitDepth\`, \`mLockedMixerBitPerfect\`, \`mLockedDeviceName\`), \`getPlaybackSnapshotJson()\`, and \`@JavascriptInterface getBitPerfectPlaybackSnapshot()\` on \`NocturneNative\` while keeping \`setBitPerfectTrackWindow\` 5-arg signature intact.
- Wired \`mPendingRenderProcessRehydration\` in \`recoverWebViewAfterRenderProcessGone()\` + \`onPageFinished()\` and implemented \`window.rehydrateNativeBitPerfectPlayback()\` in \`index.html\` across startup, \`restoreFiioCatalog()\`, \`restoreCloudCatalog()\`, and \`restoreSavedLocalFolderOnStartup()\` without interrupting native audio.
- Expanded \`live-chrome-play-pause-test.cjs\` with \`#crossfade-seconds > 0\` Deck A <-> Deck B transitions (regular + CUE), natural \`cueEnd\` auto-advance, and \`#replaygain-toggle\` verification.

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
