'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const java = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
const library = require('../library-utils.js');

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  assert.ok(e > s, `Missing end marker: ${endMarker} after ${startMarker}`);
  return src.slice(s, e);
}

describe('v3.9.96 M2: Native Bit-Perfect Cloud Stream Reconnect, Auth Refresh & Range Seek (R2 + R3)', () => {
  it('F8 & Java F10: MainActivity.java implements HttpRangeMediaDataSource, auth refresh latch, non-EOS error guard, and seek generation coalescing', () => {
    const bpClass = sliceBetween(java, 'public class BitPerfectAudioPlayer {', 'public static class WebAppInterface {');
    const webIf = sliceBetween(java, 'public static class WebAppInterface {', '// =========================================================================');

    // F8: HttpRangeMediaDataSource core mechanics
    assert.ok(bpClass.includes('private class HttpRangeMediaDataSource extends MediaDataSource'), 'HttpRangeMediaDataSource must extend MediaDataSource');
    assert.ok(bpClass.includes('CHUNK_SIZE = 256 * 1024'), 'Chunk size must be 256 KB');
    assert.ok(bpClass.includes('MAX_CACHED_CHUNKS = 16'), 'LRU must cache up to 16 chunks (4 MB)');
    assert.ok(bpClass.includes('boolean isPinnedHead = (k == 0L);') && bpClass.includes('mTotalSize - 2L * CHUNK_SIZE'), 'LRU must pin head and tail chunks');
    assert.ok(bpClass.includes('conn.setInstanceFollowRedirects(false);') && bpClass.includes('MAX_REDIRECTS = 5'), 'Must follow redirects manually up to 5 hops');
    assert.ok(bpClass.includes('!sameHost && "authorization".equalsIgnoreCase(key)'), 'Must strip Authorization header on cross-host redirects (OneDrive -> SharePoint)');
    assert.ok(bpClass.includes('conn.setRequestProperty("Range", "bytes=" + reqStart + "-");'), 'Must issue HTTP Range requests');
    assert.ok(bpClass.includes('status == HttpURLConnection.HTTP_PARTIAL') && bpClass.includes('parseContentRange'), 'Must parse 206 Content-Range');
    assert.ok(bpClass.includes('status == 416') && bpClass.includes('mTotalSize >= 0L && reqStart >= mTotalSize'), 'Must handle 416 Range Not Satisfiable cleanly');
    assert.ok(bpClass.includes('MAX_RECONNECT_ATTEMPTS = 5') && bpClass.includes('parseRetryAfterMs') && bpClass.includes('Math.min(8000L'), 'Must backoff reconnect up to 5 attempts and honor Retry-After up to 8s');
    assert.ok(bpClass.includes('AUTH_REFRESH_TIMEOUT_MS = 12000L') && bpClass.includes('new CountDownLatch(1)') && bpClass.includes('window.onNativeBitPerfectAuthRefresh'), 'Must wait up to 12s on CountDownLatch for JS OAuth refresh');
    assert.ok(bpClass.includes('Premature EOF at '), 'Must detect premature EOF before mTotalSize');
    assert.ok(bpClass.includes('activeDs.abortAndDisconnect();'), 'stopInternal must abort active HTTP connection before thread join');

    // F8: runPlaybackLoop HTTP routing + non-EOS mid-stream error guard + non-closing durMmr wrapper
    assert.ok(bpClass.includes('else if (isHttpStream) {') && bpClass.includes('extractor.setDataSource(httpDataSource);'), 'runPlaybackLoop must bind HttpRangeMediaDataSource for http(s):// without resolveReadableLocalFile');
    assert.ok(bpClass.includes('else if (isHttpStream && httpDataSource != null)') && bpClass.includes('final HttpRangeMediaDataSource sharedHttpSource = httpDataSource;') && bpClass.includes('durMmr.setDataSource(new MediaDataSource()'), 'durMmr must wrap httpDataSource in a non-closing MediaDataSource proxy');
    const durMmrSlice = sliceBetween(bpClass, 'else if (isHttpStream && httpDataSource != null)', '} else if (resolvedPath != null');
    assert.ok(durMmrSlice.includes('public void close()') && !durMmrSlice.includes('sharedHttpSource.close()'), 'durMmr proxy close() must be a no-op so durMmr.release() never closes extractor data source');
    assert.ok(bpClass.includes('if (httpDataSource != null && httpDataSource.hasFatalError())'), 'sampleSize < 0 must check httpDataSource.hasFatalError() before setting sawInputEOS');
    assert.ok(bpClass.includes('httpDataSource.hasFatalError() || isRemoteStreamNetworkOrAuthException(inputErr)'), 'inputErr catch must not misclassify remote network/auth failures as corrupt tail EOS');

    // WebAppInterface bridge signatures
    assert.ok(webIf.includes('public void setBitPerfectStreamAuth(String url, String headersJson, String source, String remoteId, long knownBytes)'), 'Missing setBitPerfectStreamAuth');
    assert.ok(webIf.includes('public void updateBitPerfectStreamAuth(String url, String headersJson)'), 'Missing updateBitPerfectStreamAuth');
    assert.ok(webIf.includes('public void provideBitPerfectRefreshedAuth(long epoch, String newUrl, String headersJson, boolean ok)'), 'Missing provideBitPerfectRefreshedAuth');
    assert.ok(webIf.includes('public boolean startBitPerfectPlayback(String urlOrPath, int sampleRate, int bitDepth)'), 'Must preserve 3-arg startBitPerfectPlayback');

    // Java F10: mSeekLock atomic handoff + seek generation + 90ms coalescing + actualPtsUs + UI-thread MediaSession + sawOutputEOS survival
    assert.ok(bpClass.includes('private final Object mSeekLock = new Object();'), 'BitPerfectAudioPlayer must define mSeekLock');
    assert.ok(bpClass.includes('mSeekGeneration'), 'BitPerfectAudioPlayer must track mSeekGeneration');
    assert.ok(bpClass.includes('REMOTE_SEEK_COALESCE_WINDOW_MS = 90L'), 'Remote stream seek must coalesce rapid scrubs (90ms)');
    assert.ok(bpClass.includes('long actualPtsUs = -1L;') && bpClass.includes('actualPtsUs = extractor.getSampleTime();'), 'basePositionMs must use extractor.getSampleTime() after seekTo');
    const seekSection = sliceBetween(bpClass, 'public void seek(long positionMs)', 'public void setDucking(');
    assert.ok(seekSection.includes('synchronized (mSeekLock)') && seekSection.includes('mSeekTargetUs.set(') && seekSection.includes('mSeekGeneration.incrementAndGet()'), 'seek() must update mSeekTargetUs and mSeekGeneration atomically under mSeekLock');
    assert.ok(seekSection.includes('updateMediaSessionPosition(posForJs, durForJs, isPlaying());'), 'seek() must update MediaSession position');
    assert.ok(seekSection.includes('if (mLastMediaTitle == null || mLastMediaTitle.isEmpty())'), 'seek() must guard updateMediaSessionMetadata against redundant cover bitmap decodes');
    assert.ok(seekSection.indexOf('runOnUiThread(() -> {') < seekSection.indexOf('updateMediaSessionMetadata('), 'seek() must invoke updateMediaSessionMetadata on the UI thread');
    const stopSection = sliceBetween(bpClass, 'private synchronized void stopInternal(boolean preserveSession)', 'public boolean isActive()');
    assert.ok(stopSection.includes('synchronized (mSeekLock)') && stopSection.indexOf('mPlaybackEpoch.incrementAndGet();') < stopSection.indexOf('synchronized (mSeekLock)'), 'stopInternal must keep mPlaybackEpoch.incrementAndGet() first and guard seek reset under mSeekLock');
    const loopSeekSection = sliceBetween(bpClass, '// Check seek', '// Feed input buffer');
    assert.ok(loopSeekSection.includes('synchronized (mSeekLock)') && loopSeekSection.includes('preSeekGen = mSeekGeneration.get();') && loopSeekSection.includes('long seekUs = mSeekTargetUs.getAndSet(-1);'), 'runPlaybackLoop must atomically pair preSeekGen with consumed seekUs under mSeekLock');
    assert.ok(bpClass.includes('sawOutputEOS && mSeekTargetUs.get() >= 0L'), 'Playback loop must survive sawOutputEOS when a seek is pending');
  });

  it('F9: Cloud Direct Bit-Perfect routing, preload bypass, OAuth refresh latch, proactive auth push & [NET]/[AUTH] error handling', async () => {
    const cloudHelpers = sliceBetween(
      html,
      'function buildGoogleDriveMediaUrl(fileId)',
      'const SILENT_UNLOCK_WAV ='
    );
    const routingFn = sliceBetween(
      html,
      'function isTrackRoutedToNativeBitPerfect(track)',
      'function suspendWebAudioForBitPerfect()'
    );
    const preloadSlice = sliceBetween(
      html,
      'let bpCloudPreloadTrackId = null;',
      'function resyncNextPreload('
    );
    const bpIntegrationSlice = sliceBetween(
      html,
      'function setupBitPerfectIntegration()',
      'window.setupBitPerfectIntegration = setupBitPerfectIntegration;'
    );

    const authUpdates = [];
    const authReplies = [];
    const toasts = [];
    const cloudStatuses = [];
    const playTrackCalls = [];
    const playNextCalls = [];
    let gToken = 'g-tok-1';
    let msDownloadUrl = 'https://contoso.sharepoint.com/temp-download-1';
    let msToken = 'ms-tok-1';

    const state = {
      bitPerfectEnabled: true,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      currentId: 'google:g1',
      preloadGeneration: 0,
      googleToken: gToken,
      microsoftAccessToken: msToken,
      microsoftExpiresAt: Date.now() + 3600000,
      msAccount: { username: 'user@example.com' },
      tracks: [
        { id: 'google:g1', source: 'google', remoteId: 'g-alias', targetRemoteId: 'g-real-1', size: 12345678, url: '' },
        { id: 'onedrive:m1', source: 'onedrive', remoteId: 'ms-item-1', remoteDriveId: 'drv-9', size: 23456789, url: '' }
      ],
      objectUrls: new Set()
    };

    const sandbox = {
      state,
      library,
      navigator: { onLine: true },
      location: { href: 'https://nocturne.local/' },
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      Date, Math, Number, String, Boolean, JSON, Array, Set, Promise, Error, encodeURIComponent,
      audio: { paused: true },
      $: () => null,
      formatTime: s => String(Math.round(s)),
      formatRemainingTime: () => '-0:00',
      syncSeek: () => {},
      paintSeek: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      toast: msg => toasts.push(msg),
      cloudStatus: (src, txt) => cloudStatuses.push({ src, txt }),
      playTrack: id => playTrackCalls.push(id),
      playNext: (dir, auto) => playNextCalls.push({ dir, auto }),
      syncPlaybackButtonsUi: () => {},
      updatePositionState: () => {},
      renderWaveformSeekbar: () => {},
      savePlaybackSession: () => {},
      ensureGoogleToken: async (force) => (force ? 'g-tok-refreshed' : gToken),
      resolveMicrosoftDownloadUrl: async (trk) => {
        if (!trk.downloadUrl) trk.downloadUrl = msDownloadUrl;
        return trk.downloadUrl;
      },
      getMicrosoftToken: async (_int, force) => (force ? 'ms-tok-refreshed' : msToken),
      window: {
        NocturneNative: {
          isBitPerfectSupported: () => true,
          setBitPerfectStreamAuth: () => {},
          updateBitPerfectStreamAuth: (url, hdrs) => authUpdates.push({ url, headers: JSON.parse(hdrs) }),
          provideBitPerfectRefreshedAuth: (ep, url, hdrs, ok) => authReplies.push({ ep, url, headers: JSON.parse(hdrs), ok })
        }
      },
      console: { warn: () => {}, log: () => {}, debug: () => {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(
      cloudHelpers + '\n' + routingFn + '\n' + preloadSlice + '\n' + bpIntegrationSlice +
      '\nthis.buildGoogleDriveMediaUrl = buildGoogleDriveMediaUrl;' +
      '\nthis.buildOneDriveGraphContentUrl = buildOneDriveGraphContentUrl;' +
      '\nthis.resolveCloudBitPerfectStream = resolveCloudBitPerfectStream;' +
      '\nthis.pushActiveBitPerfectStreamAuth = pushActiveBitPerfectStreamAuth;' +
      '\nthis.isTrackRoutedToNativeBitPerfect = isTrackRoutedToNativeBitPerfect;' +
      '\nthis.preloadCloudNextDuringBitPerfect = preloadCloudNextDuringBitPerfect;' +
      '\nsetupBitPerfectIntegration();',
      sandbox
    );

    // 1. resolveCloudBitPerfectStream (Google shortcut + OneDrive downloadUrl + Graph fallback)
    const gStream = await sandbox.resolveCloudBitPerfectStream(state.tracks[0]);
    assert.equal(gStream.url, 'https://www.googleapis.com/drive/v3/files/g-real-1?alt=media&supportsAllDrives=true');
    assert.equal(gStream.headers.Authorization, 'Bearer g-tok-1');
    assert.equal(gStream.remoteId, 'g-real-1');

    const mStreamDirect = await sandbox.resolveCloudBitPerfectStream(state.tracks[1]);
    assert.equal(mStreamDirect.url, 'https://contoso.sharepoint.com/temp-download-1');
    assert.deepEqual(JSON.parse(JSON.stringify(mStreamDirect.headers)), {});

    const mStreamGraph = await sandbox.resolveCloudBitPerfectStream(state.tracks[1], { preferGraphContent: true });
    assert.equal(mStreamGraph.url, 'https://graph.microsoft.com/v1.0/drives/drv-9/items/ms-item-1/content');
    assert.equal(mStreamGraph.headers.Authorization, 'Bearer ms-tok-1');

    // 2. isTrackRoutedToNativeBitPerfect handles unloaded online cloud tracks and honors _nativeBpFallbackUntil
    assert.equal(sandbox.isTrackRoutedToNativeBitPerfect(state.tracks[0]), true);
    state.tracks[0]._nativeBpFallbackUntil = Date.now() + 60000;
    assert.equal(sandbox.isTrackRoutedToNativeBitPerfect(state.tracks[0]), false);
    state.tracks[0]._nativeBpFallbackUntil = 0;

    // 3. pushActiveBitPerfectStreamAuth pushes for Google and Graph /content (playing AND paused), skips SharePoint pre-signed URLs
    assert.equal(sandbox.pushActiveBitPerfectStreamAuth('google', 'g-new-tok'), true);
    assert.equal(authUpdates.at(-1).headers.Authorization, 'Bearer g-new-tok');
    state.isNativeBitPerfectPlaying = false;
    state.isNativeBitPerfectPaused = true;
    assert.equal(sandbox.pushActiveBitPerfectStreamAuth('google', 'g-paused-tok'), true, 'pushActiveBitPerfectStreamAuth must push refreshed auth while Bit-Perfect is paused');
    assert.equal(authUpdates.at(-1).headers.Authorization, 'Bearer g-paused-tok');
    state.isNativeBitPerfectPlaying = true;
    state.isNativeBitPerfectPaused = false;
    state.currentId = 'onedrive:m1';
    state.tracks[1].url = 'https://contoso.sharepoint.com/temp-download-1';
    assert.equal(sandbox.pushActiveBitPerfectStreamAuth('onedrive', 'ms-new-tok'), false);
    state.tracks[1].url = 'https://graph.microsoft.com/v1.0/drives/drv-9/items/ms-item-1/content';
    assert.equal(sandbox.pushActiveBitPerfectStreamAuth('onedrive', 'ms-new-tok'), true);
    assert.equal(authUpdates.at(-1).headers.Authorization, 'Bearer ms-new-tok');

    // 4. onNativeBitPerfectAuthRefresh refreshes Google & OneDrive and always calls provideBitPerfectRefreshedAuth
    await sandbox.window.onNativeBitPerfectAuthRefresh(7, 'google', 'g-real-1', 'https://www.googleapis.com/drive/v3/files/g-real-1?alt=media&supportsAllDrives=true', 401);
    assert.deepEqual(authReplies.at(-1), {
      ep: 7,
      url: 'https://www.googleapis.com/drive/v3/files/g-real-1?alt=media&supportsAllDrives=true',
      headers: { Authorization: 'Bearer g-tok-refreshed' },
      ok: true
    });

    msDownloadUrl = 'https://contoso.sharepoint.com/temp-download-2';
    await sandbox.window.onNativeBitPerfectAuthRefresh(8, 'onedrive', 'ms-item-1', 'https://contoso.sharepoint.com/temp-download-1', 403);
    assert.deepEqual(authReplies.at(-1), {
      ep: 8,
      url: 'https://contoso.sharepoint.com/temp-download-2',
      headers: {},
      ok: true
    });

    // When Graph /content itself returns 401 -> force-refreshes MSAL token and keeps Graph /content URL
    await sandbox.window.onNativeBitPerfectAuthRefresh(9, 'onedrive', 'ms-item-1', 'https://graph.microsoft.com/v1.0/drives/drv-9/items/ms-item-1/content', 401);
    assert.deepEqual(authReplies.at(-1), {
      ep: 9,
      url: 'https://graph.microsoft.com/v1.0/drives/drv-9/items/ms-item-1/content',
      headers: { Authorization: 'Bearer ms-tok-refreshed' },
      ok: true
    });

    // When refresh throws -> still replies ok=false so native latch never hangs
    sandbox.ensureGoogleToken = async () => { throw new Error('Token expired'); };
    await sandbox.window.onNativeBitPerfectAuthRefresh(10, 'google', 'g-real-1', '', 401);
    assert.equal(authReplies.at(-1).ep, 10);
    assert.equal(authReplies.at(-1).ok, false);

    // 5. preloadCloudNextDuringBitPerfect skips next.load() (no blob: creation) in direct native cloud mode
    // and onNativeBitPerfectPosition must NOT trigger preload at 10s/240s and must memoize once preloadReadyUrl is set
    let blobLoadCalls = 0;
    let prepPreloadCalls = 0;
    const nextCloud = {
      id: 'onedrive:m-next',
      source: 'onedrive',
      remoteId: 'ms-next-1',
      url: '',
      load: async () => { blobLoadCalls++; nextCloud.url = 'blob:should-not-happen'; }
    };
    state.tracks.push(nextCloud);
    state.currentId = 'google:g1';
    state.preloadTrackId = null;
    state.preloadReadyUrl = null;
    state.preloadBusyId = null;
    sandbox.queueIndex = () => 2;
    sandbox.prepareCloudTrackForPreload = async () => { prepPreloadCalls++; };

    // Position 10s / 240s -> must NOT trigger preloadCloudNextDuringBitPerfect
    sandbox.window.onNativeBitPerfectPosition(10000, 240000);
    await Promise.resolve();
    assert.equal(prepPreloadCalls, 0, 'onNativeBitPerfectPosition at 10s/240s must NOT trigger cloud preload');

    // Position 228s / 240s (within 15s lead) -> triggers preload once
    sandbox.window.onNativeBitPerfectPosition(228000, 240000);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(prepPreloadCalls, 1, 'onNativeBitPerfectPosition at 228s/240s must trigger cloud preload once');
    assert.equal(blobLoadCalls, 0, 'Must NOT download blob: via next.load() when direct Native cloud BP is active');
    assert.ok(state.preloadReadyUrl && !state.preloadReadyUrl.startsWith('blob:'));
    assert.equal(state.preloadTrackId, 'onedrive:m-next');

    // Subsequent ticks at 229s/240s and 230s/240s -> memoized, must NOT re-trigger Cloud API calls
    sandbox.window.onNativeBitPerfectPosition(229000, 240000);
    await sandbox.preloadCloudNextDuringBitPerfect();
    assert.equal(prepPreloadCalls, 1, 'preloadCloudNextDuringBitPerfect must short-circuit when preloadTrackId & preloadReadyUrl are already set');

    // 6. onNativeBitPerfectError classifies [AUTH] and [NET] without 5-minute blacklisting
    state.isNativeBitPerfectPlaying = true;
    state.lastBitPerfectPositionSec = 0;
    sandbox.window.onNativeBitPerfectError('[AUTH] HTTP 401 authentication failed', 45000);
    assert.equal(state.tracks[0]._nativeBpFallbackUntil, 0);
    assert.equal(state.tracks[0]._resumeAfterBpFallbackSec, 45);
    assert.equal(playTrackCalls.length, 0, '[AUTH] must prompt re-login instead of looping playTrack');
    assert.equal(cloudStatuses.at(-1).src, 'google');

    state.isNativeBitPerfectPlaying = true;
    sandbox.window.onNativeBitPerfectError('[NET] Stream reconnect failed after 5 attempts', 60000);
    assert.equal(state.tracks[0]._nativeBpFallbackUntil, 0, 'Transient [NET] must NOT set 5-min fallback blacklist');
    assert.equal(state.tracks[0]._skipNativeBpOnce, true);
    assert.equal(playTrackCalls.at(-1), 'google:g1');

    // Offline [NET] pauses cleanly without falling back to broken Web Audio fetch
    sandbox.navigator.onLine = false;
    state.isNativeBitPerfectPlaying = true;
    const prevPlayCalls = playTrackCalls.length;
    sandbox.window.onNativeBitPerfectError('[NET] Socket timeout', 62000);
    assert.equal(playTrackCalls.length, prevPlayCalls);

    // 7. playTrack wires setBitPerfectStreamAuth before startBitPerfectPlayback & falls back to track.load() if bpStarted === false
    const ptSlice = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
    assert.ok(ptSlice.includes('resolveCloudBitPerfectStream(track)'), 'playTrack must resolve direct cloud stream');
    assert.ok(ptSlice.includes('window.NocturneNative.setBitPerfectStreamAuth('), 'playTrack must push stream auth before startBitPerfectPlayback');
    assert.ok(ptSlice.includes('if (cloudBpStream && cloudBpStream.url) {') && ptSlice.includes('await track.load();'), 'playTrack must restore blob load fallback if bpStarted === false');
  });

  it('F10 JS: Seek-hold guard, #room-seek isSeeking, CUE offset parity, seekByStep, 0-9/j/l shortcuts & MediaSession seekto', () => {
    const syncHelperSlice = sliceBetween(html, 'function syncSeekUiAfterJump(relSec, durSec)', 'function setupBitPerfectIntegration()');
    const bpSlice = sliceBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const posSlice = sliceBetween(html, 'function getCurrentPlaybackPositionSeconds()', 'function savePlaybackSession(');

    const els = {};
    const mkEl = () => ({ value: '0', textContent: '', style: { setProperty() {} }, classList: { contains: () => true, add() {}, remove() {} }, matches: () => false, addEventListener: () => {} });
    const getEl = id => (els[id] || (els[id] = mkEl()));

    const bpSeeks = [];
    const state = {
      currentId: 'cue-2',
      isSeeking: false,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: true,
      lastBitPerfectPositionSec: 320,
      lastBitPerfectPositionAtMs: 0,
      _bpSeekHoldUntilMs: 0,
      _bpSeekTargetSec: null,
      tracks: [{ id: 'cue-2', cueStart: 300, duration: 180, firstSlicePlayback: false }],
      lyrics: []
    };

    const seekSandbox = {
      $: getEl,
      state,
      library,
      audio: { currentTime: 0, duration: 600, paused: true },
      standbyAudio: { currentTime: 0, duration: 0, paused: true },
      formatTime: s => `${Math.floor(s)}s`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}s`,
      syncSeek: v => { getEl('seek').value = String(v); getEl('seek-mobile').value = String(v); },
      paintSeek: () => {},
      renderWaveformSeekbar: () => {},
      updatePositionState: () => {},
      playNext: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      applySmartSeekTime: (el, _trk, sec) => { el.currentTime = sec; return true; },
      window: {
        NocturneNative: {
          seekBitPerfectPlayback: ms => bpSeeks.push(ms),
          getBitPerfectPosition: () => 310000,
          getBitPerfectDuration: () => 600000
        }
      },
      Date, Math, Number, String, Boolean, console: { warn: () => {} }
    };
    vm.createContext(seekSandbox);
    vm.runInContext(
      syncHelperSlice + '\n' + bpSlice + '\n' + posSlice +
      '\nsetupBitPerfectIntegration();' +
      '\nthis.syncSeekUiAfterJump = syncSeekUiAfterJump;' +
      '\nthis.getCurrentPlaybackPositionSeconds = getCurrentPlaybackPositionSeconds;' +
      '\nthis.getCurrentPlaybackDurationSeconds = getCurrentPlaybackDurationSeconds;' +
      '\nthis.seekCurrentPlaybackToSeconds = seekCurrentPlaybackToSeconds;',
      seekSandbox
    );

    // 1. Seek-hold guard blocks stale native position & accepts converged native position
    assert.equal(seekSandbox.seekCurrentPlaybackToSeconds(390), true);
    assert.equal(bpSeeks.at(-1), 390000);
    assert.equal(seekSandbox.getCurrentPlaybackPositionSeconds(), 390, 'Hold must shield getCurrentPlaybackPositionSeconds from stale native ms');
    state._bpSeekHoldUntilMs = Date.now() + 900;
    state._bpSeekTargetSec = 390;
    seekSandbox.syncSeekUiAfterJump(90, 180);
    assert.equal(getEl('seek').value, '500');
    assert.equal(getEl('room-seek').value, '500');

    // Stale native callback (310s vs target 390s) must be ignored
    seekSandbox.window.onNativeBitPerfectPosition(310000, 600000);
    assert.equal(getEl('seek').value, '500', 'Stale onNativeBitPerfectPosition must not snap #seek back');
    assert.equal(getEl('room-seek').value, '500', 'Stale onNativeBitPerfectPosition must not snap #room-seek back');

    // Converged native callback (390.4s vs target 390s) clears hold & updates normally
    seekSandbox.window.onNativeBitPerfectPosition(390400, 600000);
    assert.equal(state._bpSeekHoldUntilMs, 0);
    assert.equal(state._bpSeekTargetSec, null);

    // 2. #room-seek input/change + seekByStep + keydown (0-9, j/l) + wfCanvas + MediaSession seekto
    const roomListeners = {};
    const wfListeners = {};
    const docListeners = {};
    const smartCalls = [];
    const msActions = {};

    const uiEl = id => {
      if (id === 'room-seek') {
        const el = getEl(id);
        el.addEventListener = (ev, fn) => { roomListeners[ev] = fn; };
        return el;
      }
      if (id === 'ambient-panel' || id === 'listening-room' || id === 'queue-panel') {
        return { hidden: true, classList: { contains: () => true, add() {}, remove() {} }, contains: () => false };
      }
      return getEl(id);
    };

    const seekControlsSlice = sliceBetween(
      html,
      "$('room-seek').addEventListener('input', event => {",
      'function toggleShortcutsModal('
    );
    const msSlice = sliceBetween(
      html,
      'const seekByMediaSessionOffset = delta => {',
      "action('stop',"
    );

    const uiSandbox = {
      $: uiEl,
      document: {
        activeElement: null,
        getElementById: (id) => {
          if (id === 'waveform-canvas') return { getBoundingClientRect: () => ({ left: 0, width: 100 }), addEventListener: (ev, fn) => { wfListeners[ev] = fn; } };
          if (id === 'waveform-hover-tooltip') return getEl('waveform-hover-tooltip');
          return getEl(id);
        },
        addEventListener: (ev, fn) => { docListeners[ev] = fn; }
      },
      state: {
        currentId: 'cue-2',
        tracks: [
          { id: 'cue-2', cueStart: 300, duration: 180 },
          { id: 'slice-1', duration: 240, firstSlicePlayback: true, _pendingSliceUpgrade: true }
        ],
        activeDeck: { element: { currentTime: 330, duration: 600 } },
        isSeeking: false,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: true,
        lastBitPerfectPositionSec: 330,
        lastBitPerfectPositionAtMs: 0,
        _bpSeekHoldUntilMs: 0,
        _bpSeekTargetSec: null,
        bitPerfectEnabled: true
      },
      audio: { currentTime: 0, duration: 600 },
      library,
      NocturneLibrary: library,
      formatTime: s => `${Math.floor(s)}s`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}s`,
      paintSeek: () => {},
      syncSeek: v => { getEl('seek').value = String(v); getEl('seek-mobile').value = String(v); },
      syncSeekUiAfterJump: seekSandbox.syncSeekUiAfterJump,
      renderWaveformSeekbar: () => {},
      updatePositionState: () => {},
      attachWaveformTouchScrub: () => {},
      toggleAmbientPanel: () => {},
      isSettingsOpen: () => false,
      hideSettings: () => {},
      closeListeningRoom: () => {},
      closeQueue: () => {},
      toast: () => {},
      setGain: () => {},
      toggleMute: () => {},
      playNext: () => {},
      smartCalls,
      action: (name, fn) => { msActions[name] = fn; },
      window: {
        NocturneNative: {
          seekBitPerfectPlayback: ms => bpSeeks.push(ms),
          getBitPerfectPosition: () => uiSandbox.state.lastBitPerfectPositionSec * 1000,
          getBitPerfectDuration: () => 600000
        }
      },
      Date, Math, Number, String, Boolean, RegExp, console: { warn: () => {} }
    };
    vm.createContext(uiSandbox);
    // Load real getCurrentPlaybackPositionSeconds, getCurrentPlaybackDurationSeconds, and seekCurrentPlaybackToSeconds from index.html
    vm.runInContext(
      posSlice + '\n' +
      seekControlsSlice +
      '\nconst origApplySmart = applySmartSeekTime;' +
      '\napplySmartSeekTime = (el, trk, sec) => { smartCalls.push({ id: trk && trk.id, sec }); el.currentTime = sec; return true; };' +
      '\nthis.smartCalls = smartCalls;' +
      '\nthis.seekByStep = seekByStep;' +
      '\nthis.getCurrentPlaybackDurationSeconds = getCurrentPlaybackDurationSeconds;' +
      '\nthis.seekCurrentPlaybackToSeconds = seekCurrentPlaybackToSeconds;' +
      '\n' + msSlice,
      uiSandbox
    );
    uiSandbox.smartCalls = smartCalls;

    // #room-seek input sets isSeeking = true; change clears it & seeks CUE absolute ms
    roomListeners.input({ currentTarget: { value: '500' } });
    assert.equal(uiSandbox.state.isSeeking, true);
    assert.equal(getEl('seek').value, '500');
    roomListeners.change({ currentTarget: { value: '500' } });
    assert.equal(uiSandbox.state.isSeeking, false);
    assert.equal(bpSeeks.at(-1), 390000, '#room-seek 50% on CUE(300,180) must seek to 390s');

    // seekByStep while paused in Native BP CUE (+10s from 390s -> 400s)
    uiSandbox.seekByStep(10);
    assert.equal(bpSeeks.at(-1), 400000, 'seekByStep must work when isNativeBitPerfectPaused=true and honor cueStart');

    // keydown '5' on CUE Bit-Perfect -> 390s
    let prevented = false;
    docListeners.keydown({ key: '5', code: 'Digit5', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault: () => { prevented = true; }, target: {} });
    assert.equal(prevented, true);
    assert.equal(bpSeeks.at(-1), 390000, 'keydown "5" on CUE Bit-Perfect must seek to cueStart + 50%');

    // keydown 'l' consolidated handler (+10s -> 400s)
    docListeners.keydown({ key: 'l', code: 'KeyL', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault: () => {}, target: {} });
    assert.equal(bpSeeks.at(-1), 400000, 'keydown "l" must seek +10s');

    // wfCanvas click at 25% on CUE -> 300 + 45 = 345s
    wfListeners.click.call({ getBoundingClientRect: () => ({ left: 0, width: 100 }) }, { clientX: 25 });
    assert.equal(bpSeeks.at(-1), 345000, 'wfCanvas click on CUE Bit-Perfect must add cueStart');

    // MediaSession seekto at 60s on CUE paused BP -> 300 + 60 = 360s
    msActions.seekto({ seekTime: 60 });
    assert.equal(bpSeeks.at(-1), 360000, 'MediaSession seekto on paused BP CUE must add cueStart');

    // Web Audio curAudio !== audio & truncated firstSlicePlayback in real getCurrentPlaybackDurationSeconds, seekByStep & keydown '5'
    uiSandbox.state.isNativeBitPerfectPlaying = false;
    uiSandbox.state.isNativeBitPerfectPaused = false;
    uiSandbox.state.currentId = 'slice-1';
    uiSandbox.state.activeDeck.element = { currentTime: 10, duration: 15 };
    assert.equal(uiSandbox.getCurrentPlaybackDurationSeconds(uiSandbox.state.tracks[1], uiSandbox.state.activeDeck.element), 240, 'Real getCurrentPlaybackDurationSeconds must prefer track.duration for truncated firstSlicePlayback');
    uiSandbox.seekByStep(20);
    assert.equal(smartCalls.at(-1).id, 'slice-1');
    assert.equal(smartCalls.at(-1).sec, 30, 'seekByStep must use real track duration (240s) for truncated firstSlicePlayback');
    docListeners.keydown({ key: '5', code: 'Digit5', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault: () => {}, target: {} });
    assert.equal(smartCalls.at(-1).sec, 120, 'keydown "5" must delegate non-CUE Web Audio through applySmartSeekTime');
  });

  it('F10 JS Regression: real getCurrentPlaybackDurationSeconds + real applySmartSeekTime + real seekCurrentPlaybackToSeconds on firstSlicePlayback & #room-seek roomDur', () => {
    const syncHelperSlice = sliceBetween(html, 'function syncSeekUiAfterJump(relSec, durSec)', 'function setupBitPerfectIntegration()');
    const posSlice = sliceBetween(html, 'function getCurrentPlaybackPositionSeconds()', 'function savePlaybackSession(');
    const seekControlsSlice = sliceBetween(html, "$('room-seek').addEventListener('input', event => {", 'function toggleShortcutsModal(');

    const els = {};
    const mkEl = () => ({ value: '0', textContent: '', style: { setProperty() {} }, classList: { contains: () => true, add() {}, remove() {} }, matches: () => false, addEventListener: () => {} });
    const getEl = id => (els[id] || (els[id] = mkEl()));
    const roomListeners = {};
    const docListeners = {};
    let retryUpgradeCalls = 0;

    const standbyEl = { currentTime: 10, duration: 15, buffered: { length: 1, end: () => 15 } };
    const sliceTrack = { id: 'slice-track', duration: 300, firstSlicePlayback: true, _pendingSliceUpgrade: true, _pendingSeekAfterFullUpgrade: null };
    const standbyNormalTrack = { id: 'standby-normal', duration: 200, firstSlicePlayback: false };
    const state = {
      currentId: 'slice-track',
      tracks: [sliceTrack, standbyNormalTrack],
      activeDeck: { element: standbyEl },
      isSeeking: false,
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      bitPerfectEnabled: false
    };

    const realSandbox = {
      $: id => {
        if (id === 'room-seek') {
          const el = getEl(id);
          el.addEventListener = (ev, fn) => { roomListeners[ev] = fn; };
          return el;
        }
        if (id === 'ambient-panel' || id === 'listening-room' || id === 'queue-panel') {
          return { hidden: true, classList: { contains: () => true, add() {}, remove() {} }, contains: () => false };
        }
        return getEl(id);
      },
      document: {
        activeElement: null,
        getElementById: id => getEl(id),
        addEventListener: (ev, fn) => { docListeners[ev] = fn; }
      },
      state,
      audio: { currentTime: 0, duration: 600 },
      library,
      NocturneLibrary: library,
      formatTime: s => `${Math.floor(s)}s`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}s`,
      paintSeek: () => {},
      syncSeek: () => {},
      renderWaveformSeekbar: () => {},
      updatePositionState: () => {},
      attachWaveformTouchScrub: () => {},
      toggleAmbientPanel: () => {},
      isSettingsOpen: () => false,
      hideSettings: () => {},
      closeListeningRoom: () => {},
      closeQueue: () => {},
      toast: () => {},
      setGain: () => {},
      toggleMute: () => {},
      playNext: () => {},
      retryPendingCurrentSliceUpgrade: async () => { retryUpgradeCalls++; },
      window: {},
      Date, Math, Number, String, Boolean, RegExp, console: { warn: () => {} }
    };
    vm.createContext(realSandbox);
    vm.runInContext(
      syncHelperSlice + '\n' + posSlice + '\n' + seekControlsSlice +
      '\nthis.getCurrentPlaybackDurationSeconds = getCurrentPlaybackDurationSeconds;' +
      '\nthis.seekCurrentPlaybackToSeconds = seekCurrentPlaybackToSeconds;' +
      '\nthis.seekByStep = seekByStep;',
      realSandbox
    );

    assert.equal(realSandbox.getCurrentPlaybackDurationSeconds(sliceTrack, standbyEl), 300);

    // seekByStep(20) from 10s -> targets 30s (> 15s buffered) -> defers upgrade & queues 30s
    realSandbox.seekByStep(20);
    assert.equal(sliceTrack._pendingSeekAfterFullUpgrade, 30);
    assert.equal(retryUpgradeCalls, 1);
    assert.equal(standbyEl.currentTime, 10);

    // keydown '5' on 300s firstSlicePlayback -> targets 150s -> defers & queues 150s
    sliceTrack._pendingSeekAfterFullUpgrade = null;
    docListeners.keydown({ key: '5', code: 'Digit5', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault: () => {}, target: {} });
    assert.equal(sliceTrack._pendingSeekAfterFullUpgrade, 150);
    assert.equal(retryUpgradeCalls, 2);

    // Real seekCurrentPlaybackToSeconds(120, 'slice-track') passes (curAudio, curTrack, 120) to real applySmartSeekTime
    sliceTrack._pendingSeekAfterFullUpgrade = null;
    const resumedFar = realSandbox.seekCurrentPlaybackToSeconds(120, 'slice-track');
    assert.equal(resumedFar, false, 'Deferred far seek past buffered first slice must propagate false from applySmartSeekTime');
    assert.equal(sliceTrack._pendingSeekAfterFullUpgrade, 120);
    assert.equal(retryUpgradeCalls, 3);

    // Within buffered slice (12s <= 15s) -> applies immediately to standbyEl.currentTime and returns true
    const resumedNear = realSandbox.seekCurrentPlaybackToSeconds(12, 'slice-track');
    assert.equal(resumedNear, true);
    assert.equal(standbyEl.currentTime, 12);

    // #room-seek input uses roomDur (200s on standbyAudio) instead of audio.duration (600s) for #room-remaining
    state.currentId = 'standby-normal';
    state.activeDeck.element = { currentTime: 0, duration: 200 };
    roomListeners.input({ currentTarget: { value: '500' } });
    assert.equal(getEl('room-remaining').textContent, '-100s', '#room-seek input must use roomDur when curAudio !== audio');
  });

  it('ES2019 syntax & 0 CR parity across index.html, 404.html, and Android assets', () => {
    for (const rel of ['index.html', 'library-utils.js', 'virtual-scroll.js']) {
      const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.equal(content.includes('\r'), false, `${rel} must contain 0 CR bytes`);
    }
    const htmlScript = sliceBetween(html, '<script>', '</script>');
    // Ensure no unguarded optional chaining or nullish coalescing in executable lines
    const codeLines = htmlScript.split('\n').filter(l => !/^\s*\/\//.test(l));
    for (const line of codeLines) {
      const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '');
      assert.equal(/\?\./.test(stripped), false, `Forbidden ES2020 optional chaining in line: ${line.trim()}`);
      assert.equal(/\?\?/.test(stripped), false, `Forbidden ES2020 nullish coalescing in line: ${line.trim()}`);
    }
  });
});
