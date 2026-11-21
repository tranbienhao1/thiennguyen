'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));

test('1. cacheFirstSlice recovers from QuotaExceededError via LRU eviction while pinning current track & FiiO tightens prune limits', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cacheStart = html.indexOf('function sliceCacheTransaction(mode) {');
  const cacheEnd = html.indexOf('function persistCloudCatalog(tracks) {', cacheStart);
  assert.ok(cacheStart > 0 && cacheEnd > cacheStart);

  function fakeReq(result, err) {
    const req = {};
    queueMicrotask(() => {
      if (err) {
        req.error = err;
        if (typeof req.onerror === 'function') req.onerror();
      } else {
        req.result = result;
        if (typeof req.onsuccess === 'function') req.onsuccess();
      }
    });
    return req;
  }

  const rows = new Map();
  let failNextPutWithQuota = true;
  const store = {
    get: k => fakeReq(rows.get(k)),
    put: entry => {
      if (failNextPutWithQuota) {
        failNextPutWithQuota = false;
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        return fakeReq(undefined, err);
      }
      rows.set(entry.key, entry);
      return fakeReq(entry.key);
    },
    delete: k => { rows.delete(k); return fakeReq(undefined); },
    getAll: () => fakeReq(Array.from(rows.values()))
  };

  const tracks = [];
  for (let i = 0; i < 8; i++) {
    const tr = { id: 'google:t' + i, source: 'google', remoteId: 't' + i, name: 't' + i + '.flac', size: 10000000, firstSliceCached: true };
    tracks.push(tr);
    const key = library.historyTrackKey(tr);
    rows.set(key, { key, blob: { size: 512000 }, size: 512000, savedAt: 1000 + i * 10, lastAccessedAt: 1000 + i * 10 });
  }
  const newTrack = { id: 'google:tnew', source: 'google', remoteId: 'tnew', name: 'new.flac', size: 12000000, firstSliceCached: false };
  tracks.push(newTrack);

  // Pin t0 as the currently playing track -> must survive eviction even though it is oldest!
  const state = {
    currentId: 'google:t0',
    tracks,
    fiioDapMode: false,
    db: {
      objectStoreNames: { contains: () => true },
      transaction: () => ({ objectStore: () => store })
    }
  };

  const cache = new Function('library', 'state', 'FIRST_SLICE_CACHE_STORE',
    html.slice(cacheStart, cacheEnd) + '\nreturn { cacheFirstSlice, pruneSliceCache, isSliceCacheQuotaError };'
  )(library, state, 'firstSliceCache');

  const ok = await cache.cacheFirstSlice(newTrack, { size: 524288 }, 12000000);
  assert.equal(ok, true, 'cacheFirstSlice must recover from QuotaExceededError by evicting oldest slices and retrying once');
  assert.equal(newTrack.firstSliceCached, true);
  const pinnedKey = library.historyTrackKey(tracks[0]);
  const newKey = library.historyTrackKey(newTrack);
  assert.equal(rows.has(pinnedKey), true, 'Currently playing track slice must be pinned and never evicted on quota recovery');
  assert.equal(rows.has(newKey), true, 'New slice must be persisted on retry');
  assert.ok(rows.get(newKey).lastAccessedAt > 0, 'New slice must record lastAccessedAt for LRU');
  // t1..t4 (oldest 4 unpinned entries) should have been evicted and their firstSliceCached cleared
  assert.equal(rows.has(library.historyTrackKey(tracks[1])), false);
  assert.equal(tracks[1].firstSliceCached, false, 'Evicted track must have firstSliceCached cleared');

  // Verify FiiO constrained device caps pruneSliceCache to 16 entries
  state.fiioDapMode = true;
  rows.clear();
  for (let i = 0; i < 20; i++) {
    rows.set('k' + i, { key: 'k' + i, blob: { size: 500000 }, size: 500000, savedAt: 100 + i, lastAccessedAt: 100 + i });
  }
  cache.pruneSliceCache();
  await new Promise(r => setImmediate(r));
  assert.equal(rows.size, 16, 'FiiO DAP mode must cap firstSliceCache to at most 16 entries');
});

test('2. updatePositionState pushes CUE-relative position & duration to NocturneNative even on Chromium 74 without navigator.mediaSession.setPositionState', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('let lastPositionStateSecond = -1;');
  const end = html.indexOf('let isUserScrolling = false;', start);
  assert.ok(start > 0 && end > start);

  const nativePosCalls = [];
  const cueTrack = { id: 'fiio_cue_2', source: 'local', isCue: true, cueStart: 300, duration: 240 };
  const audioEl = { currentTime: 345.6, duration: 3600, paused: false, ended: false, playbackRate: 1 };

  const sandbox = {
    navigator: {}, // Simulate Chromium 74 / FiiO M11S without navigator.mediaSession.setPositionState
    window: {
      NocturneNative: {
        updateMediaSessionPosition: (posMs, durMs, isPlaying) => nativePosCalls.push({ posMs, durMs, isPlaying })
      }
    },
    state: {
      currentId: 'fiio_cue_2',
      tracks: [cueTrack],
      activeDeck: { element: audioEl },
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false
    },
    audio: audioEl,
    library,
    Math, Number, Boolean,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end) + '\nthis.updatePositionState = updatePositionState;', sandbox);

  sandbox.updatePositionState(true);
  assert.equal(nativePosCalls.length, 1, 'updatePositionState must push position to NocturneNative even when Web setPositionState is absent');
  assert.equal(nativePosCalls[0].posMs, 45600, 'CUE sub-track lockscreen position must be relative to cueStart (345.6 - 300 = 45.6s)');
  assert.equal(nativePosCalls[0].durMs, 240000, 'CUE sub-track lockscreen duration must be track duration (240s), not 3600s album');
  assert.equal(nativePosCalls[0].isPlaying, true);
});

test('3. MainActivity.java exposes updateMediaSessionPosition, fixes showMediaNotification MediaSession overwrite, and routes lockscreen seek via JS for CUE parity', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('public void updateMediaSessionPosition(long positionMs, long durationMs, boolean isPlaying)'), 'MainActivity & NocturneJsBridge must expose updateMediaSessionPosition');
  assert.ok(java.includes('private static final long MEDIA_SESSION_ACTIONS ='), 'MainActivity must share full MEDIA_SESSION_ACTIONS including ACTION_SEEK_TO');

  const showNotifStart = java.indexOf('private void showMediaNotification(');
  const showNotifEnd = java.indexOf('private void cancelMediaNotification(', showNotifStart);
  assert.ok(showNotifStart > 0 && showNotifEnd > showNotifStart);
  const showNotifSrc = java.slice(showNotifStart, showNotifEnd);
  assert.ok(showNotifSrc.includes('updateMediaSessionMetadata(displayTitle, displayArtist, displayAlbum, isPlaying);'), 'showMediaNotification must delegate to updateMediaSessionMetadata instead of clobbering ACTION_SEEK_TO');
  assert.ok(!showNotifSrc.includes('PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f'), 'showMediaNotification must no longer hardcode 1.0f speed when paused');

  const seekToStart = java.indexOf('public void dispatchSeekToWeb(final long positionMs)');
  const seekToEnd = java.indexOf('private final BroadcastReceiver mMediaNotificationReceiver', seekToStart);
  assert.ok(seekToStart > 0 && seekToEnd > seekToStart);
  const seekToSrc = java.slice(seekToStart, seekToEnd);
  assert.ok(seekToSrc.includes("window.onHardwareSeekTo(") && seekToSrc.includes('!"\\"ok\\"".equals(value)'), 'dispatchSeekToWeb must route through CUE-aware window.onHardwareSeekTo first with native BitPerfect fallback');
});
