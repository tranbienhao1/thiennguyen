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
  const tag = process.argv[2] || 'v3.9.101';
  const name = process.argv[3] || `Nocturne ${tag} (Android AVRCP & Bit-Perfect Route Recovery, Cloud/Local Delta Cover & .LRC Reconciliation, Leak Fixes & CDP E2E)`;
  const notesFile = process.argv[4];
  const bodyText = (notesFile && fs.existsSync(notesFile))
    ? fs.readFileSync(notesFile, 'utf8')
    : `### Nocturne ${tag} (versionCode 155) — Android Old/New AVRCP & USB DAC Route Recovery, Cloud & Local/FiiO Delta Cover/ReplayGain/.LRC Reconciliation + Leak Fixes

#### 1. Android Old (API 26–30 / FiiO M11S / Chromium 74) & New (API 31–35+) AVRCP, Headset Button & Bit-Perfect USB DAC Route Recovery (\`AndroidManifest.xml\`, \`NocturnePlaybackService.java\`, \`MainActivity.java\`, \`index.html\`)
- Added \`android.intent.action.MEDIA_BUTTON\` intent-filter and \`onStartCommand\` forwarding on \`NocturnePlaybackService\` plus \`mMediaSession.setMediaButtonReceiver()\` (\`FLAG_MUTABLE\` on API 31+ / \`0\` on API 26–30), API 33+ typed \`getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class)\` in \`initMediaSession()\`, and \`Notification.MediaStyle\` with \`MediaSession.Token\` in \`showMediaNotification()\`.
- Updated \`findPreferredBitPerfectDevice()\` to prioritize Bluetooth A2DP / API 31+ BLE Audio (\`TYPE_BLE_HEADSET\`, \`TYPE_BLE_SPEAKER\`) and \`TYPE_BUILTIN_SPEAKER\` ahead of earpiece/telephony sinks; updated \`getAudioOutputRouteName()\` and \`isExternalAudioGearConnected()\` to check \`d.isSink()\`, \`TYPE_LINE_DIGITAL\`, \`TYPE_AUX_LINE\`, and BLE Audio; hardened \`notifyUsbDacChange()\` for BT/Wired headphone disconnects.
- Replaced non-atomic \`BitPerfectAudioPlayer\` route refresh booleans with \`AtomicInteger mRouteRefreshFlags\` (\`getAndSet(0)\`), guarded \`track.play()\`/\`pause()\`/\`flush()\` with \`try/catch (IllegalStateException)\`, hardened JS \`onHardwarePlay\`/\`onHardwarePause\`, \`onAndroidAudioBecomingNoisy\` (mid-DSD and \`firstSlice\`/\`sliceEndedEarly\` speaker-blast prevention), \`onAndroidAudioDeviceChanged\`, and Chromium 74 \`updateMediaSession\`/\`updatePositionState\` native \`PLAYBACK_POSITION_UNKNOWN\` sync.

#### 2. Cloud (Google Drive / OneDrive) & Local/FiiO Incremental Metadata, Cover Art, ReplayGain & Sidecar \`.lrc\` Reconciliation + Leak Fixes (\`index.html\`, \`library-utils.js\`, \`MainActivity.java\`)
- Tracked \`hasEmbeddedCover\` across \`serializableCloudTrack\`, \`enrichCloudTrack\`, \`loadCloudMetadata\`, \`writeLocalFileMetaCache\`, and \`makeLocalTrack\` so non-embedded folder art refreshes cleanly even when \`metadataLoaded === true\` while embedded art remains protected.
- Hardened Google Drive (\`tryLoadGoogleChangesDelta\`) and OneDrive (\`tryLoadMicrosoftDeltaSync\`, \`applyMicrosoftSiblingLrcLinks\`) delta sync for track moves/renames, trashed/deleted \`folder.jpg\` and \`.lrc\`, \`cTag\` persistence, capped destination \`/children\` lookup, \`needsCloudMetadataEnrichment\` / \`enrichCloudTrack\` sidecar re-fetch, and \`invalidateCloudTrackContent\` ReplayGain reset.
- Preserved full ReplayGain (\`rg\`, \`rgp\`, \`rga\`, \`rgap\`, \`itn\`) across Web local cache & \`reconcileMovedFiioTracks\`, added \`reconcileMovedLocalTracks\` and existing-track folder art/\`.lrc\` refresh in \`addLocalFiles\`/\`refreshModifiedLocalTrack\`, busted \`/local-cover\` with \`&v=\` on moves/edits, added pure-framework \`DocumentsContract\` SAF tree sibling fallback (\`resolveSafSiblingUri\`) on API 30–35+, and fixed \`onAndroidLowMemory\` / \`upgradeSliceToFullAudio\` / \`pruneOrphanedSliceCacheEntries\` leaks.

#### 3. Chrome CDP E2E & Unit Test Expansion (\`live-chrome-play-pause-test.cjs\`, \`test/v3-9-101-*.test.cjs\`)
- Added Chrome CDP E2E Groups H–J (multi-source Local ↔ Google Drive ↔ OneDrive ↔ CUE ↔ DSD queue handoff, \`AudioFocus\` ducking & \`ACTION_AUDIO_BECOMING_NOISY\` recovery across Web Audio & Bit-Perfect, and cloud move/rename \`.lrc\` & folder cover delta reconciliation with \`0\` uncaught JS exceptions).
- Added \`test/v3-9-101-r1-android-avrcp-noisy-dac.test.cjs\`, \`test/v3-9-101-r2-delta-lrc-cover-replaygain-cache.test.cjs\`, and \`test/v3-9-101-r3-e2e-compat-and-release.test.cjs\` verifying R1, R2, R3, ES2019, asset parity, and API 26–35+ contracts.

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
