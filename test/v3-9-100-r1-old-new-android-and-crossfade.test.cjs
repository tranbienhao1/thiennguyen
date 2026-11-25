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

describe('v3.9.100 R1 & R3: Old/New Android Parity (Java & CSS) + Overlapping Crossfade Cancellation', () => {
  it('1. MainActivity.java guards isDirectPlaybackSupported (API 29+), modernizes isNetworkConnected (API 23+), cleans WIFI_MODE_FULL_HIGH_PERF & onDestroy()', () => {
    const bpSupSlice = extractBetween(mainJava, 'public boolean isBitPerfectSupported()', 'private boolean hasConnectedUsbDac()');
    assert.ok(bpSupSlice.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q'), 'isBitPerfectSupported must guard AudioTrack.isDirectPlaybackSupported with SDK_INT >= Q');
    assert.ok(bpSupSlice.includes('AudioTrack.isDirectPlaybackSupported('), 'isBitPerfectSupported must keep Q+ direct playback check');
    assert.ok(bpSupSlice.includes('AudioTrack.getMinBufferSize('), 'isBitPerfectSupported must provide API 26-28 getMinBufferSize fallback');

    const netSlice = extractBetween(mainJava, 'private boolean isNetworkConnected()', '@Override\n    protected void onPause()');
    assert.ok(netSlice.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.M'), 'isNetworkConnected must branch at SDK_INT >= M');
    assert.ok(netSlice.includes('cm.getActiveNetwork()') && netSlice.includes('cm.getNetworkCapabilities(') && netSlice.includes('NetworkCapabilities.NET_CAPABILITY_INTERNET'),
      'isNetworkConnected must inspect NetworkCapabilities.NET_CAPABILITY_INTERNET');
    assert.ok(netSlice.includes('@SuppressWarnings("deprecation")') && netSlice.includes('cm.getActiveNetworkInfo()'),
      'isNetworkConnected must keep @SuppressWarnings("deprecation") fallback for < M');

    const powerSlice = extractBetween(mainJava, 'private void initPowerAndAudioManagers()', 'private void initActivityResultLaunchers()');
    assert.ok(powerSlice.includes('int wifiMode = WifiManager.WIFI_MODE_FULL_HIGH_PERF;'), 'initPowerAndAudioManagers must remove duplicate ternary');
    assert.equal(powerSlice.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q'), false, 'Duplicate WIFI_MODE ternary must be gone');

    const destroySlice = extractBetween(mainJava, 'protected void onDestroy()', 'protected void onNewIntent(');
    assert.ok(destroySlice.includes('cancelMediaNotification();') && destroySlice.includes('mMainHandler.removeCallbacksAndMessages(null);'));
    assert.equal(destroySlice.includes('ACTION_STOP'), false, 'onDestroy must not call redundant startService(stopIntent) after cancelMediaNotification()');
  });

  it('2. MainActivity.java startAsyncStorageScan() separates scopedRestrictedRoots on API 30-35 Scoped Storage while protecting API 26-29 SD cards', () => {
    const statsSlice = extractBetween(mainJava, 'private static String buildStorageScanStatsJson(', '@JavascriptInterface\n        public String getLastStorageScanStatsJson()');
    assert.ok(statsSlice.includes('List<String> scopedRestrictedRoots') && statsSlice.includes('"scopedRestrictedRoots"'));

    const scanSlice = extractBetween(mainJava, 'public boolean startAsyncStorageScan(final int maxFiles)', 'private void emitStorageScanChunk(');
    assert.ok(scanSlice.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.R') && scanSlice.includes('Environment.isExternalStorageManager()'),
      'startAsyncStorageScan must detect Scoped Storage via SDK_INT >= R && !Environment.isExternalStorageManager()');
    assert.ok(scanSlice.includes('if (!rootDir.exists())') && scanSlice.includes('unreadableRoots.add(rootPath)'),
      'Missing rootDir must always populate unreadableRoots');
    assert.ok(scanSlice.includes('if (isScopedStorage && !mediaStoreFailed)') && scanSlice.includes('scopedRestrictedRoots.add(rootPath)'),
      'Expected File.canRead() denials on Scoped Storage with healthy MediaStore must go to scopedRestrictedRoots, not unreadableRoots');
  });

  it('3. scanFiioStorage() prunes missing MediaStore tracks when scopedRestrictedRoots is non-empty (API 30-35) while still blocking on unreadableRoots (API 26-29 SD)', async () => {
    const fiioChunkSlice = extractBetween(html, 'function ingestFiioScannedFilesChunk(', 'window.ingestFiioScannedFilesChunk = ingestFiioScannedFilesChunk;');
    const fiioPruneSlice = extractBetween(html, 'function pruneMissingFiioTracks(', 'window.extractStorageRootPrefix =');
    const fiioScanSlice = extractBetween(html, 'async function scanFiioStorage(', 'function scheduleFiioHotplugScan(');

    let currentStats = {
      truncated: false,
      mediaStoreFailed: false,
      unreadableRoots: [],
      scopedRestrictedRoots: ['/storage/emulated/0', '/storage/1234-5678']
    };
    const sandbox = {
      library,
      state: {
        currentId: null,
        tracks: [
          { id: 'fiio_deleted', source: 'local', path: '/storage/emulated/0/Music/Deleted.flac', uri: 'content://media/external/audio/media/99' },
          { id: 'fiio_kept', source: 'local', path: '/storage/emulated/0/Music/Kept.flac', uri: 'content://media/external/audio/media/100' }
        ]
      },
      window: {
        isNativeAndroid: true,
        NocturneNative: {
          hasStoragePermission: () => true,
          getLastStorageScanStatsJson: () => JSON.stringify(currentStats),
          startAsyncStorageScan: () => true
        }
      },
      fiioScanInProgress: false,
      fiioScanWatchdogTimer: null,
      fiioScanUpgradedCount: 0,
      fiioScanSkippedUnchangedCount: 0,
      pendingAndroidStorageScan: false,
      activeFiioScanMaps: null,
      normalizeFiioPathKey: p => String(p || '').trim(),
      extractStorageRootPrefix: p => {
        const m = String(p || '').match(/^(\/storage\/emulated\/\d+|\/storage\/[^/]+)/i);
        return m ? m[1] : '';
      },
      buildExistingFiioTrackMaps: () => ({ existingByPath: new Map(), existingByUri: new Map() }),
      buildExistingFiioTrackSets: () => ({ existingPaths: new Set(['/storage/emulated/0/Music/Deleted.flac', '/storage/emulated/0/Music/Kept.flac']), existingUris: new Set() }),
      reconcileMovedFiioTracks: () => {},
      pruneOrphanedAlbumCovers: () => {},
      renderTracks: () => {},
      finalizeFiioScanUi: () => {},
      saveCatalog: () => {},
      toast: () => {},
      setTimeout, clearTimeout, Date, Math, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, console
    };
    vm.runInNewContext(`${fiioChunkSlice}\n${fiioPruneSlice}\n${fiioScanSlice}`, sandbox);

    // API 30-35 Scoped Storage: scopedRestrictedRoots present, unreadableRoots empty -> deleted track IS pruned
    const pScoped = sandbox.window.scanFiioStorage({ silent: true });
    sandbox.window.onAndroidStorageScanChunk(
      [{ name: 'Kept.flac', path: '/storage/emulated/0/Music/Kept.flac', uri: 'content://media/external/audio/media/100', size: 1234 }],
      1,
      'MediaStore'
    );
    sandbox.window.onAndroidStorageScanDone(1, null);
    await pScoped;
    assert.deepEqual([...sandbox.state.tracks.map(t => t.id)], ['fiio_kept'], 'API 30-35 scopedRestrictedRoots must not block MediaStore pruning');

    // API 26-29 legacy SD card unreadable -> unreadableRoots blocks pruning
    sandbox.state.tracks.push({ id: 'fiio_sd_kept', source: 'local', path: '/storage/SD1/Music/SD.flac' });
    currentStats = { truncated: false, mediaStoreFailed: false, unreadableRoots: ['/storage/SD1'], scopedRestrictedRoots: [] };
    const pLegacySd = sandbox.window.scanFiioStorage({ silent: true });
    sandbox.window.onAndroidStorageScanChunk(
      [{ name: 'Kept.flac', path: '/storage/emulated/0/Music/Kept.flac', uri: 'content://media/external/audio/media/100', size: 1234 }],
      1,
      'Storage'
    );
    sandbox.window.onAndroidStorageScanDone(1, null);
    await pLegacySd;
    assert.ok(sandbox.state.tracks.some(t => t.id === 'fiio_sd_kept'), 'API 26-29 unreadableRoots must still protect unmounted SD tracks');
  });

  it('4. index.html CSS wraps safe-area vars on tablets/desktops & overlays and puts 100vh fallbacks before every 100dvh rule', () => {
    const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
    const styleWithoutRoot = styleBlocks.replace(/:root\s*\{[^}]*\}/g, '');
    assert.equal(/\benv\(safe-area-inset-top/.test(styleWithoutRoot.replace(/var\(--safe-area-top,\s*env\(safe-area-inset-top,\s*0px\)\)/g, '')),
      false, 'No raw env(safe-area-inset-top) outside :root/var(--safe-area-top, ...)');
    assert.equal(/\benv\(safe-area-inset-bottom/.test(styleWithoutRoot.replace(/var\(--safe-area-bottom,\s*env\(safe-area-inset-bottom,\s*0px\)\)/g, '')),
      false, 'No raw env(safe-area-inset-bottom) outside :root/var(--safe-area-bottom, ...)');
    assert.ok(styleBlocks.includes('#listening-room') && styleBlocks.includes('#roon-fullscreen-view') && styleBlocks.includes('#settings-modal'));

    // Every dvh rule inside <style> must be preceded by a vh fallback in the same rule block
    const dvhMatches = [...styleBlocks.matchAll(/[^;{}]*\d+dvh[^;{}]*/g)];
    assert.ok(dvhMatches.length >= 10, 'Expected >= 10 dvh declarations');
    for (const m of dvhMatches) {
      const idx = m.index;
      const blockStart = styleBlocks.lastIndexOf('{', idx);
      const beforeInBlock = styleBlocks.slice(blockStart, idx);
      assert.ok(/\d+vh\b/.test(beforeInBlock), `Missing vh fallback before dvh rule: ${m[0].trim()}`);
    }
  });

  it('5. Overlapping crossfade: finishPlaybackStart clears prior _crossfadeCleanupTimer, preloadNext cancels standby gain, applyCrossfade preserves startIn & falls back on NotSupportedError', () => {
    const cfSlice = extractBetween(html, 'function applyCrossfade(context, oldDeck, newDeck, seconds)', 'function rebuildDeckRoute(');
    const preloadGainSlice = extractBetween(html, 'function resetStandbyDeckGainForPreload(', 'async function preloadNext(');
    const finishSlice = extractBetween(html, 'function finishPlaybackStart(track, generation, target, previousTrack)', '// Pha A — lát đầu không có khung nhạc');

    let timerSeq = 0;
    const timers = new Map();
    const clearedIds = [];
    let releasedTracks = [];
    const makeGain = (initial = 1, throwCurve = false) => {
      const log = [];
      return {
        value: initial,
        log,
        cancelAndHoldAtTime(t) { log.push(['cancelAndHoldAtTime', t]); },
        cancelScheduledValues(t) { log.push(['cancelScheduledValues', t]); },
        setValueCurveAtTime(c, s, d) {
          log.push(['setValueCurveAtTime', c[0], c[c.length - 1], s, d]);
          if (throwCurve) {
            const err = new Error('Overlapping curve at same timestamp');
            err.name = 'NotSupportedError';
            throw err;
          }
        },
        linearRampToValueAtTime(v, t) { log.push(['linearRampToValueAtTime', v, t]); },
        setTargetAtTime(v, t, tc) { log.push(['setTargetAtTime', v, t, tc]); },
        setValueAtTime(v, t) { log.push(['setValueAtTime', v, t]); }
      };
    };

    const elA = { dataset: {}, currentTime: 1, duration: 100, paused: false, src: 'blob:1', playbackRate: 1, pause() { this.paused = true; }, removeAttribute(name) { if (name === 'src') this.src = ''; }, load() {} };
    const elB = { dataset: {}, currentTime: 0, duration: 100, paused: false, src: 'blob:2', playbackRate: 1, pause() { this.paused = true; }, removeAttribute(name) { if (name === 'src') this.src = ''; }, load() {} };
    const deckA = { element: elA, router: { gain: makeGain(1, false) } };
    const deckB = { element: elB, router: { gain: makeGain(0, false) } };

    const uiEls = {
      'play-button': { textContent: '' },
      'room-play': { textContent: '' },
      'mini-play': { textContent: '' },
      'fullscreen-play-btn': { textContent: '' }
    };
    const ctx = { state: 'running', currentTime: 10 };
    const sandbox = {
      library,
      audio: elA,
      standbyAudio: elB,
      lastDisplayedPlaybackSecond: 0,
      lastPositionStateSecond: 0,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      window: {},
      location: { href: 'http://localhost/' },
      URL,
      state: {
        playGeneration: 1,
        activeDeck: deckA,
        deckA,
        deckB,
        context: ctx,
        crossfadeSeconds: 2,
        crossfadeUntil: 0,
        preloadTrackId: null,
        tracks: [],
        errorSkipCount: 0
      },
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      setVisualizerRunning: () => {},
      updatePositionState: () => {},
      updateMiniPlayerHud: () => {},
      recordHistory: () => {},
      savePlaybackSession: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      releaseUnusedCloudUrl: t => { if (t) releasedTracks.push(t.id); },
      releaseUnusedLocalUrl: () => {},
      setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms }); return id; },
      clearTimeout: id => { clearedIds.push(id); timers.delete(id); },
      Float32Array, Number, Math, String, Boolean, Error
    };
    vm.runInNewContext(`${cfSlice}\n${preloadGainSlice}\n${finishSlice}\nthis.applyCrossfade = applyCrossfade;\nthis.resetStandbyDeckGainForPreload = resetStandbyDeckGainForPreload;\nthis.finishPlaybackStart = finishPlaybackStart;`, sandbox);

    const t1 = { id: 't1', url: 'blob:1' };
    const t2 = { id: 't2', url: 'blob:2' };
    const t3 = { id: 't3', url: 'blob:3' };

    // Transition 1: t1 (deckA) -> t2 (deckB) at gen=1
    sandbox.finishPlaybackStart(t2, 1, elB, t1);
    const timer1Id = sandbox.state._crossfadeCleanupTimer;
    assert.ok(timer1Id > 0, 'finishPlaybackStart must record _crossfadeCleanupTimer');
    const savedTimer1Fn = timers.get(timer1Id).fn;

    // Overlapping Transition 2: t2 (deckB) -> t3 (deckA) at gen=2 while fade is still active
    ctx.currentTime = 10.2;
    sandbox.state.playGeneration = 2;
    elA.paused = false; elA.src = 'blob:3'; elA.currentTime = 0.1;
    elB.paused = false; elB.currentTime = 0.2;
    deckB.router.gain.value = 0.4;
    deckA.router.gain.value = 0.6; // mid-fade-out from t1 -> t2
    sandbox.finishPlaybackStart(t3, 2, elA, t2);
    assert.ok(clearedIds.includes(timer1Id), 'Overlapping transition must clear prior _crossfadeCleanupTimer');

    // Verify inCurve started near 0.6 (did not dip to 0)
    const curveInCalls = deckA.router.gain.log.filter(entry => entry[0] === 'setValueCurveAtTime');
    const curveInCall = curveInCalls[curveInCalls.length - 1];
    assert.ok(curveInCall && Math.abs(curveInCall[1] - 0.6) < 0.01, `Expected inCurve start ~0.6, got ${curveInCall && curveInCall[1]}`);

    // Even if stale timer1Fn somehow fires, it must NOT reset deckA.router.gain.value = 1 or pause/detach active elA
    deckA.router.gain.value = 0.75;
    savedTimer1Fn();
    assert.equal(deckA.router.gain.value, 0.75, 'Stale cleanup timer must not clobber gain after playGeneration changed');
    assert.equal(elA.paused, false, 'Stale cleanup timer must not pause deckA now playing t3');
    assert.equal(elA.src, 'blob:3', 'Stale cleanup timer must not detach deckA src');

    // Verify applyCrossfade falls back cleanly on NotSupportedError from setValueCurveAtTime
    const throwOld = { router: { gain: makeGain(1, true) } };
    const throwNew = { router: { gain: makeGain(0, true) } };
    assert.doesNotThrow(() => sandbox.applyCrossfade(ctx, throwOld, throwNew, 2));
    assert.ok(throwOld.router.gain.log.some(e => e[0] === 'linearRampToValueAtTime' && e[1] === 0));
    assert.ok(throwNew.router.gain.log.some(e => e[0] === 'linearRampToValueAtTime' && e[1] === 1));

    // Verify resetStandbyDeckGainForPreload cancels scheduled curve before setTargetAtTime(0)
    const sbDeck = { router: { gain: makeGain(0.5, false) } };
    sandbox.resetStandbyDeckGainForPreload(sbDeck);
    assert.equal(sbDeck.router.gain.log[0][0], 'cancelAndHoldAtTime');
    assert.equal(sbDeck.router.gain.log[1][0], 'setTargetAtTime');
    assert.equal(sbDeck.router.gain.log[1][1], 0);
  });
});
