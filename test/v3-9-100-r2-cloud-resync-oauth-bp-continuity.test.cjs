'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

function makeStorage(seed = {}) {
  const store = Object.assign({}, seed);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store
  };
}

describe('v3.9.100 R2: Cloud Resync, Background OAuth2 Refresh & Bit-Perfect Stream Continuity', () => {
  it('1. tryLoadGoogleChangesDelta & tryLoadMicrosoftDeltaSync persist mid-delta cursors + tombstones across transient errors and resume cleanly', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    const lsG = makeStorage({
      'nocturne-google-delta-token': 'g-start-1',
      'nocturne-google-folder-tree': JSON.stringify({ fDel: ['root'] })
    });
    const tKeep = { id: 'google:k1', remoteId: 'k1', source: 'google', parents: ['root'], name: 'Keep.flac' };
    const tGone = { id: 'google:g1', remoteId: 'g1', source: 'google', parents: ['root'], name: 'Gone.flac' };
    const requestedTokens = [];
    let gPage = 0;

    const gSandbox = {
      localStorage: lsG,
      library,
      state: { tracks: [tKeep, tGone], googleToken: 'g-tok' },
      checkedGoogleArtParents: new Set(),
      URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error,
      ensureGoogleToken: async () => 'g-tok',
      googleConfigurationHint: () => '',
      isCloudAudio: f => Boolean(f && /\.flac$/i.test(f.name || '')),
      googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
      invalidateCloudTrackContent: () => {},
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (_src, ids) => {
        let count = 0;
        for (let i = gSandbox.state.tracks.length - 1; i >= 0; i--) {
          if (ids.has(gSandbox.state.tracks[i].remoteId)) {
            gSandbox.state.tracks.splice(i, 1);
            count++;
          }
        }
        return count;
      },
      fetchGoogleDrivePageWithRetry: async (url) => {
        const u = new URL('https://x.test/?' + url.split('?')[1]);
        requestedTokens.push(u.searchParams.get('pageToken'));
        gPage++;
        if (gPage === 1) {
          return {
            ok: true, status: 200,
            json: async () => ({
              nextPageToken: 'g-page-2',
              changes: [{ fileId: 'g1', removed: true }]
            })
          };
        }
        if (gPage === 2) {
          throw new Error('Transient 429/network drop on page 2');
        }
        return {
          ok: true, status: 200,
          json: async () => ({
            newStartPageToken: 'g-start-2',
            changes: [{ fileId: 'gAdd', removed: false, file: { id: 'gAdd', name: 'Added.flac', parents: ['root'] } }]
          })
        };
      },
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {}
    };
    vm.runInNewContext(`${gTreeSlice}\n${gDeltaSlice}\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;`, gSandbox);

    await assert.rejects(() => gSandbox.tryLoadGoogleChangesDelta('g-tok', new Map([['k1', tKeep], ['g1', tGone]]), new Set(['k1', 'g1'])), /Transient/);
    const gResume = JSON.parse(lsG.getItem('nocturne-google-delta-resume'));
    assert.equal(gResume.cursor, 'g-page-2');
    assert.deepEqual(gResume.deletedRemoteIds, ['g1']);

    const resG = await gSandbox.tryLoadGoogleChangesDelta('g-tok', new Map([['k1', tKeep], ['g1', tGone]]), new Set(['k1', 'g1']));
    assert.equal(resG.handled, true);
    assert.equal(resG.removed, 1, 'Tombstone g1 from interrupted page 1 must be applied on resume');
    assert.deepEqual(requestedTokens, ['g-start-1', 'g-page-2', 'g-page-2']);
    assert.equal(lsG.getItem('nocturne-google-delta-token'), 'g-start-2');
    assert.equal(lsG.getItem('nocturne-google-delta-resume'), null, 'Mid-delta resume checkpoint must clear on completion');

    // OneDrive mid-delta checkpoint resume
    const msDeltaSlice = extractBetween(html, 'async function tryLoadMicrosoftDeltaSync(', 'async function verifyMicrosoftAccountSwitch(');
    const lsMs = makeStorage({ 'nocturne-microsoft-delta-link': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=1' });
    const msKeep = { id: 'onedrive:mk1', remoteId: 'mk1', source: 'onedrive', name: 'MsKeep.flac' };
    const msDel = { id: 'onedrive:md1', remoteId: 'md1', source: 'onedrive', name: 'MsDel.flac' };
    const msUrls = [];
    let msPage = 0;

    const msSandbox = {
      localStorage: lsMs,
      library,
      state: { tracks: [msKeep, msDel], microsoftAccessToken: 'ms-tok' },
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error,
      isCloudAudio: it => Boolean(it && it.file),
      microsoftTrack: (it, p) => ({ id: `onedrive:${it.id}`, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p }),
      mergeMicrosoftTrack: () => {},
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (_src, ids) => {
        let count = 0;
        for (let i = msSandbox.state.tracks.length - 1; i >= 0; i--) {
          if (ids.has(msSandbox.state.tracks[i].remoteId)) {
            msSandbox.state.tracks.splice(i, 1);
            count++;
          }
        }
        return count;
      },
      graphGet: async (url) => {
        msUrls.push(url);
        msPage++;
        if (msPage === 1) {
          return {
            value: [{ id: 'md1', deleted: { state: 'deleted' } }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?next=p2'
          };
        }
        if (msPage === 2) {
          const e = new Error('Microsoft Graph 429: Throttled');
          e.status = 429;
          throw e;
        }
        return {
          value: [{ id: 'mAdd', name: 'MsAdd.flac', file: { mimeType: 'audio/flac' }, size: 123 }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=2'
        };
      },
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {}
    };
    vm.runInNewContext(`${gTreeSlice}\n${msDeltaSlice}\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;`, msSandbox);

    await assert.rejects(() => msSandbox.tryLoadMicrosoftDeltaSync('ms-tok', new Map([['mk1', msKeep], ['md1', msDel]]), new Set(['mk1', 'md1'])), /429/);
    const msResume = JSON.parse(lsMs.getItem('nocturne-microsoft-delta-resume'));
    assert.ok(msResume.nextUrl.includes('next=p2'));
    assert.deepEqual(msResume.deletedRemoteIds, ['md1']);

    const resMs = await msSandbox.tryLoadMicrosoftDeltaSync('ms-tok', new Map([['mk1', msKeep], ['md1', msDel]]), new Set(['mk1', 'md1']));
    assert.equal(resMs.handled, true);
    assert.equal(resMs.removed, 1);
    assert.equal(msUrls[2], 'https://graph.microsoft.com/v1.0/me/drive/root/delta?next=p2');
    assert.equal(lsMs.getItem('nocturne-microsoft-delta-link'), 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=2');
    assert.equal(lsMs.getItem('nocturne-microsoft-delta-resume'), null);
  });

  it('2. loadMicrosoftFiles compacts >4000-node checkpoints, merges msFullFolderTree on resume, shares 429 cooldown across workers, and scheduleOnlineCloudDeltaSync guards expired Fast Token', async () => {
    // Shared 429 cooldown gate
    const cooldownSlice = extractBetween(html, 'let googleRateLimitUntilMs = 0;', 'function parseCloudRetryAfterMs(');
    const cdWaits = [];
    const cdSandbox = {
      Date, Math, Promise, Number,
      setTimeout: (fn, ms) => { cdWaits.push(ms); fn(); return 0; }
    };
    vm.runInNewContext(cooldownSlice, cdSandbox);
    cdSandbox.noteCloudProviderCooldown('onedrive', 2500);
    await cdSandbox.waitCloudProviderCooldown('onedrive');
    assert.ok(cdWaits.length === 1 && cdWaits[0] > 0 && cdWaits[0] <= 2500, 'Concurrent worker must await shared 429 cooldown');

    // loadMicrosoftFiles >4000 checkpoint compaction + msFullFolderTree merge
    const cpBlock = extractBetween(html, "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';", 'function removeCloudTracksByRemoteIds(');
    const wakeBlock = extractBetween(html, 'let lastNativeCloudSyncLock = null;', 'async function verifyGoogleDriveAccountSwitch(');
    const mBlock = extractBetween(html, 'async function loadMicrosoftFiles(token) {', 'const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS');

    const lsHuge = makeStorage();
    const hugeFolders = Array.from({ length: 4200 }, (_, i) => ({ id: `hf_${i}`, name: `H${i}`, folder: { childCount: 0 } }));
    let failHugeOnce = true;
    const hugeSandbox = {
      state: { tracks: [], microsoftAccessToken: 'tok' },
      library,
      navigator: { onLine: true },
      localStorage: lsHuge,
      restoreCloudCatalog: async () => {},
      graphGet: async (url) => {
        if (url.includes('/root/children')) return { value: hugeFolders };
        if (url.includes('hf_0') && failHugeOnce) { failHugeOnce = false; throw new Error('Drop >4000'); }
        return { value: [] };
      },
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => 0,
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.runInNewContext(`${cpBlock}\n${wakeBlock}\n${mBlock}\nthis.loadMicrosoftFiles = loadMicrosoftFiles;`, hugeSandbox);

    await assert.rejects(() => hugeSandbox.loadMicrosoftFiles('tok'), /Drop >4000/);
    const hugeCp = JSON.parse(lsHuge.getItem('nocturne-microsoft-sync-checkpoint'));
    assert.ok(hugeCp && Array.isArray(hugeCp.queue) && hugeCp.queue.length === 4000, 'Checkpoint >4000 nodes must compact cleanly instead of wiping');

    // Resumed checkpoint scan merges msFullFolderTree with prior tree
    assert.ok(mBlock.includes('mergedMsTree') && mBlock.includes('prevMsTree'), 'loadMicrosoftFiles must merge msFullFolderTree on resumed checkpoint scans');

    // scheduleOnlineCloudDeltaSync expired Fast Token guard
    const schedSlice = extractBetween(html, 'const ONLINE_CLOUD_RESYNC_COOLDOWN_MS = 45000;', "window.addEventListener('online'");
    let loadedMs = 0;
    const schedSandbox = {
      navigator: { onLine: true },
      cloudSyncPromise: null,
      state: {
        msAccount: null,
        microsoftAccessToken: 'expired-fast-tok',
        microsoftExpiresAt: Date.now() - 10000,
        googleToken: null,
        tracks: []
      },
      loadMicrosoftFiles: async () => { loadedMs++; },
      restoreMicrosoftSession: async () => {},
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      Date, Number, Boolean, Promise, console
    };
    vm.runInNewContext(`${schedSlice}\nthis.scheduleOnlineCloudDeltaSync = scheduleOnlineCloudDeltaSync;`, schedSandbox);
    schedSandbox.scheduleOnlineCloudDeltaSync(0);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(loadedMs, 0, 'Expired Fast-Token microsoftExpiresAt without msAccount must not spin 401 delta resync');
  });

  it('3. Proactive OAuth2 wake refresh commits cooldown ONLY on settled success, MainActivity separates NetworkCallback throttles & adds Doze receiver', async () => {
    const wakeSlice = extractBetween(html, 'let lastTokenKeepAliveAt = 0;', "const LONG_TRACK_POS_KEY = 'nocturne-long-track-positions';");
    let nowMs = 2000000;
    let shouldFailGoogle = true;
    let googleCalls = 0;
    const wakeSandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      navigator: { onLine: true },
      Date: { now: () => nowMs },
      Array, Object, Number, Boolean, String, RegExp, Promise,
      state: {
        currentId: null,
        googleToken: 'g-exp',
        googleExpiresAt: nowMs - 1000,
        msAccount: null,
        microsoftAccessToken: null,
        tracks: []
      },
      ensureGoogleToken: async () => {
        googleCalls++;
        if (shouldFailGoogle) throw new Error('Doze DNS error');
        return 'g-ok';
      },
      pushActiveBitPerfectStreamAuth: () => {},
      clearStalePreload: () => {}
    };
    vm.runInNewContext(wakeSlice, wakeSandbox);

    // First wake fails during Doze -> must NOT poison the 60s cooldown for immediate retry
    wakeSandbox.runCloudWakeTokenRefresh();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(googleCalls, 1);

    nowMs += 500; // only 0.5s later when network validates
    shouldFailGoogle = false;
    wakeSandbox.runCloudWakeTokenRefresh();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(googleCalls, 2, 'Failed Doze wake must not block immediate retry on network validation');

    // Now that it succeeded, another call 500ms later IS throttled by 60s cooldown
    nowMs += 500;
    wakeSandbox.runCloudWakeTokenRefresh();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(googleCalls, 2, 'Successful wake must enforce 60s cooldown');

    // MainActivity.java separate NetworkCallback throttles & Doze ACTION_DEVICE_IDLE_MODE_CHANGED receiver
    const wakeObsSlice = extractBetween(mainJava, 'private final BroadcastReceiver mScreenOnReceiver =', 'protected void onDestroy()');
    assert.ok(wakeObsSlice.includes('PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED'), 'MainActivity must register Doze exit receiver');
    assert.ok(wakeObsSlice.includes('mIsDozeReceiverRegistered') && wakeObsSlice.includes('unregisterReceiver(mDozeReceiver)'), 'Doze receiver must unregister in onDestroy');
    assert.ok(wakeObsSlice.includes('mLastNetworkAvailableNotifyAtMs') && wakeObsSlice.includes('mLastNetworkValidatedNotifyAtMs'),
      'onAvailable and NET_CAPABILITY_VALIDATED must use separate throttle timestamps');
    assert.ok(wakeObsSlice.includes('scheduleOnlineCloudDeltaSync') && wakeObsSlice.includes('retryPendingCurrentSliceUpgrade'),
      'Wake observers must trigger online delta sync and pending slice upgrade retry');
  });

  it('4. Bit-Perfect continuity: bounded redirect reset in MainActivity, tokenSnapshot invalidation, slice-upgrade abortion on BP entry, DSD/WebAudio WakeLock+AudioFocus, and CUE epoch guard', async () => {
    // MainActivity.java contracts
    const rangeSlice = extractBetween(mainJava, 'private byte[] fetchChunkWithRecovery(long chunkStart)', 'private void sleepInterruptibly(');
    assert.ok(rangeSlice.includes('int redirectResetCount = 0;') && rangeSlice.includes('redirectResetCount < 2'),
      'HttpRangeMediaDataSource.fetchChunkWithRecovery must bound mResolvedRedirectUrl resets');

    const eosPostSlice = extractBetween(mainJava, 'private void postBitPerfectPlaybackCompleteToWeb(', 'private void dispatchPendingBitPerfectEosIfReady(');
    assert.ok(eosPostSlice.includes('mTrackWindow.seq == expectedWindowSeq'),
      'postBitPerfectPlaybackCompleteToWeb must verify expectedWindowSeq');
    const isActiveSlice = extractBetween(mainJava, 'public boolean isActive()', 'public String getCurrentSourceKey()');
    assert.ok(isActiveSlice.includes('!mExitedDecodeLoop'), 'isActive() must return false once decode loop exited');

    // index.html suspendWebAudioForBitPerfect clears src
    const suspendSlice = extractBetween(html, 'function suspendWebAudioForBitPerfect()', 'function abortPlayCleanup(');
    assert.ok(suspendSlice.includes("audio.removeAttribute('src')") && suspendSlice.includes('audio.load()'));

    // playTrack: abortStaleFullAudioUpgrades does NOT exempt track.id when willUseNativeBp, and re-acquires WakeLock/AudioFocus on BP -> WebAudio
    const playTrackSlice = extractBetween(html, 'function isTrackRoutedToNativeBitPerfect(track)', 'function stopDsdWorker(');
    assert.ok(
      playTrackSlice.includes('if (willUseNativeBp) abortStaleFullAudioUpgrades([state.preloadTrackId]);') &&
      playTrackSlice.includes('else abortStaleFullAudioUpgrades([track.id, state.preloadTrackId]);')
    );
    assert.ok(playTrackSlice.includes('window.NocturneNative.acquireWakeLock') && playTrackSlice.includes('window.NocturneNative.requestAudioFocus'));
    assert.ok(playTrackSlice.includes('state._bpCueEpoch ='));

    // DSD savePlaybackSession(true) & audio.load()
    const dsdSlice = extractBetween(html, 'async function playDsdFirstSlice(', 'async function playDsdTrack(');
    assert.ok(dsdSlice.includes('savePlaybackSession(true)'), 'playDsdFirstSlice must persist playback session');
    const dsdTrackSlice = extractBetween(html, 'async function playDsdTrack(', 'function playNext(');
    assert.ok(dsdTrackSlice.includes('audio.load()') && dsdTrackSlice.includes('savePlaybackSession(true)'),
      'playDsdTrack must call audio.load() after setting audio.src and savePlaybackSession(true)');

    // _bpPreloadedStream tokenSnapshot invalidation in pushActiveBitPerfectStreamAuth
    const pushAuthSlice = extractBetween(html, 'function pushActiveBitPerfectStreamAuth(', 'const SILENT_UNLOCK_WAV');
    const sandbox = {
      state: {
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        _bpPreloadedStream: { trackId: 'g1', source: 'google', tokenSnapshot: 'old-tok', url: 'https://x' }
      },
      window: {}
    };
    vm.runInNewContext(`${pushAuthSlice}\nthis.pushActiveBitPerfectStreamAuth = pushActiveBitPerfectStreamAuth;`, sandbox);
    sandbox.pushActiveBitPerfectStreamAuth('google', 'new-tok');
    assert.equal(sandbox.state._bpPreloadedStream, null, 'Token rotation must invalidate _bpPreloadedStream');

    // Late onBitPerfectPlaybackComplete ignored when isSameCueNativeParent seek hold is active
    const bpIntSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    let nextCalls = 0;
    const eosSandbox = {
      library,
      $: () => null,
      navigator: { mediaSession: { playbackState: 'playing' } },
      audio: { paused: true },
      window: { NocturneNative: { isBitPerfectActive: () => true } },
      state: {
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        _bpSeekHoldUntilMs: Date.now() + 1000,
        tracks: []
      },
      playNext: () => { nextCalls++; },
      resetBitPerfectModeBadge: () => {},
      syncPlaybackButtonsUi: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Number, Boolean, String, JSON
    };
    vm.runInNewContext(`${bpIntSlice}\nsetupBitPerfectIntegration();`, eosSandbox);
    eosSandbox.window.onBitPerfectPlaybackComplete();
    assert.equal(nextCalls, 0, 'Late file-EOS completion during active same-parent CUE seek hold must be ignored');
    assert.equal(eosSandbox.state.isNativeBitPerfectPlaying, true);
  });
});
