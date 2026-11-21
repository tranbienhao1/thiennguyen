'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. library.fetchAudioFirstSlice & fetchAudioBlob abort stalled fetches/streams on timeout and retry cleanly', async () => {
  const origFetch = global.fetch;
  try {
    // 1.1 fetchAudioFirstSlice hangs on attempt 1 (triggers timeout), succeeds on attempt 2
    let sliceCalls = 0;
    let firstAborted = false;
    global.fetch = async (url, opts) => {
      sliceCalls++;
      if (sliceCalls === 1) {
        return new Promise((resolve, reject) => {
          if (opts && opts.signal) {
            opts.signal.addEventListener('abort', () => {
              firstAborted = true;
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            }, { once: true });
          }
        });
      }
      return {
        ok: true,
        status: 206,
        headers: { get: (k) => ({ 'content-type': 'audio/flac', 'content-range': 'bytes 0-1048575/5000000' }[String(k).toLowerCase()] || '') },
        blob: async () => ({ size: 1048576, type: 'audio/flac' })
      };
    };

    const sliceRes = await lib.fetchAudioFirstSlice('https://cloud.example/track.flac', { timeoutMs: 40, retryDelayMs: 0 }, 'Google Drive');
    assert.equal(sliceCalls, 2, 'fetchAudioFirstSlice must retry once after a timeout');
    assert.equal(firstAborted, true, 'timeout must abort the underlying fetch signal');
    assert.equal(sliceRes.blob.size, 1048576);

    // 1.2 fetchAudioBlob stalls mid-body (response.blob() never resolves), cancels body, retries and succeeds
    let blobCalls = 0;
    let bodyCanceled = false;
    global.fetch = async () => {
      blobCalls++;
      if (blobCalls === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'audio/flac' : '') },
          body: { cancel: () => { bodyCanceled = true; } },
          blob: () => new Promise(() => {})
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'audio/flac' : '') },
        blob: async () => ({ size: 4096, type: 'audio/flac' })
      };
    };

    const fullBlob = await lib.fetchAudioBlob('https://cloud.example/full.flac', { timeoutMs: 40, retryDelayMs: 0 }, 'OneDrive');
    assert.equal(blobCalls, 2, 'fetchAudioBlob must retry when response.blob() stalls past timeoutMs');
    assert.equal(bodyCanceled, true, 'stalled response.body must be canceled on timeout');
    assert.equal(fullBlob.size, 4096);

    // 1.3 External user AbortController aborts immediately WITHOUT retrying
    let abortCalls = 0;
    const extAc = new AbortController();
    global.fetch = async (url, opts) => {
      abortCalls++;
      return new Promise((resolve, reject) => {
        setTimeout(() => extAc.abort(), 15);
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('user aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }
      });
    };
    await assert.rejects(
      () => lib.fetchAudioBlob('https://cloud.example/cancel.flac', { signal: extAc.signal, timeoutMs: 500, retryDelayMs: 0 }, 'Google Drive'),
      (err) => err && err.name === 'AbortError' && err.aborted === true
    );
    assert.equal(abortCalls, 1, 'External user abort must NOT retry');

    // 1.4 isFetchAudioRetryable recognizes TimeoutError as retryable
    assert.equal(lib.isFetchAudioRetryable({ name: 'TimeoutError', isTimeout: true }), true);
    assert.equal(lib.isFetchAudioRetryable({ name: 'AbortError', aborted: true }), false);
    assert.equal(lib.FETCH_AUDIO_SLICE_TIMEOUT_MS, 25000);
    assert.equal(lib.FETCH_AUDIO_FULL_TIMEOUT_MS, 90000);
    assert.equal(lib.FETCH_AUDIO_TAIL_PROBE_TIMEOUT_MS, 15000);
  } finally {
    if (origFetch === undefined) delete global.fetch;
    else global.fetch = origFetch;
  }
});

test('2. Cross-session playback session, queue, CUE resume & favorites matching across rescans', () => {
  // 2.1 Local Web folder track gets a brand new volatile ID after reopening folder
  const oldLocalTrack = {
    id: 'local-1001-old',
    source: 'local',
    name: '02 - Autumn Leaves.flac',
    relativePath: 'Jazz/Autumn Leaves/02 - Autumn Leaves.flac',
    size: 38451200,
    duration: 320,
    title: 'Autumn Leaves',
    artist: 'Bill Evans',
    album: 'Portrait in Jazz'
  };
  const oldQueueCloud = {
    id: 'od-legacy-id-99',
    source: 'onedrive',
    remoteId: 'ITEM_OD_99',
    remoteDriveId: 'DRV_SHARED_1',
    name: '03 - Blue in Green.flac',
    duration: 337,
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: 'Kind of Blue'
  };
  const rawSession = lib.savePlaybackSession(oldLocalTrack.id, 145.5, [oldQueueCloud.id], {
    wasPlaying: true,
    track: oldLocalTrack,
    queueTracks: [oldQueueCloud]
  });

  const rescannedTracks = [
    {
      id: 'local-9999-new',
      source: 'local',
      name: '02 - Autumn Leaves.flac',
      relativePath: 'Jazz/Autumn Leaves/02 - Autumn Leaves.flac',
      size: 38451200,
      duration: 320,
      title: 'Autumn Leaves',
      artist: 'Bill Evans',
      album: 'Portrait in Jazz'
    },
    {
      id: 'onedrive-new-id-99',
      source: 'onedrive',
      remoteId: 'ITEM_OD_99',
      remoteDriveId: 'DRV_SHARED_1',
      name: '03 - Blue in Green.flac',
      duration: 337,
      title: 'Blue in Green',
      artist: 'Miles Davis',
      album: 'Kind of Blue'
    }
  ];

  const restored = lib.restorePlaybackSession(rawSession, rescannedTracks);
  assert.equal(restored.isValid, true, 'Must restore session via stable ref after local ID changes');
  assert.equal(restored.track.id, 'local-9999-new');
  assert.equal(restored.trackId, 'local-9999-new');
  assert.equal(restored.remapped, true);
  assert.equal(restored.currentTime, 145.5);
  assert.deepEqual(restored.queueTrackIds, ['onedrive-new-id-99'], 'Queue IDs must remap via stable ref');

  // 2.2 CUE sub-track resume preserves absolute position inside [cueStart, cueStart + duration]
  const cueTrackOld = {
    id: 'fiio_cue_old_3',
    source: 'local',
    isCue: true,
    cueStart: 420,
    duration: 240,
    cueDedupKey: '/storage/sd/Album/disc.flac::420',
    path: '/storage/sd/Album/disc.flac',
    name: 'disc.flac',
    size: 420000000,
    title: 'Track 3',
    artist: 'Pink Floyd',
    album: 'DSOTM'
  };
  const cueRaw = lib.savePlaybackSession(cueTrackOld.id, 510, [], { track: cueTrackOld });
  const cueTrackNew = Object.assign({}, cueTrackOld, { id: 'fiio_cue_new_3' });
  const cueRestored = lib.restorePlaybackSession(cueRaw, [cueTrackNew]);
  assert.equal(cueRestored.isValid, true);
  assert.equal(cueRestored.track.id, 'fiio_cue_new_3');
  assert.equal(cueRestored.currentTime, 510, 'CUE track position 510s (420 + 90) must NOT reset to 0');
  const promptText = lib.formatResumePrompt(cueTrackNew, cueRestored.currentTime);
  assert.ok(promptText.includes('1:30'), `Expected CUE relative time 1:30 in prompt, got: ${promptText}`);

  // 2.3 Stable favorite keys survive local rescan & onedrive tracks count as cloud
  const favSet = new Set([lib.stableFavoriteKey(oldLocalTrack), lib.stableFavoriteKey(oldQueueCloud)]);
  assert.equal(lib.isTrackInFavorites(rescannedTracks[0], favSet), true, 'Rescanned local track must stay favorite');
  assert.equal(lib.isTrackInFavorites(rescannedTracks[1], favSet), true, 'Rescanned OneDrive track must stay favorite');
  const focusCounts = lib.countFocusCategories(rescannedTracks, favSet);
  assert.equal(focusCounts.favorite, 2);
  assert.equal(focusCounts.cloud, 1, 'OneDrive track must be counted in cloud focus category');
  assert.equal(focusCounts.local, 1);
  assert.equal(lib.filterTracksByFocus(rescannedTracks, 'cloud').length, 1);
  assert.equal(lib.filterTracksByFocus(rescannedTracks, 'favorite', { favorites: favSet }).length, 2);
});

test('3. reconcileMovedFiioTracks migrates queueTrackIds, favorites & playback session on move', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function reconcileMovedFiioTracks(removedTracks, keptTracks) {');
  const end = html.indexOf('function pruneMissingFiioTracks(', start);
  assert.ok(start > 0 && end > start);

  const oldTrack = {
    id: 'fiio_old_55',
    source: 'local',
    name: '01 - Nocturne.flac',
    path: '/storage/sd/OldDir/01 - Nocturne.flac',
    size: 55000000,
    title: 'Nocturne',
    artist: 'Chopin'
  };
  const newTrack = {
    id: 'fiio_new_88',
    source: 'local',
    name: '01 - Nocturne.flac',
    path: '/storage/sd/NewDir/01 - Nocturne.flac',
    size: 55000000,
    title: 'Nocturne',
    artist: 'Chopin'
  };
  const lsStore = {
    'nocturne-playback-session': JSON.stringify({
      trackId: 'fiio_old_55',
      currentTime: 88,
      queueTrackIds: ['fiio_other_1', 'fiio_old_55']
    })
  };
  let savedFavCalls = 0;
  const sandbox = {
    library: lib,
    fiioScanUpgradedCount: 0,
    state: {
      recentHistory: [],
      queueTrackIds: ['fiio_other_1', 'fiio_old_55'],
      favorites: new Set(['fiio_old_55'])
    },
    isFavorite: (t) => sandbox.state.favorites.has(t.id),
    getFavoriteKey: (t) => lib.stableFavoriteKey(t),
    saveFavorites: () => { savedFavCalls++; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
      setItem: (k, v) => { lsStore[k] = String(v); }
    },
    Set, Number, String, Array, JSON, Math, Boolean
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.reconcileMovedFiioTracks = reconcileMovedFiioTracks;', sandbox);

  const migrated = sandbox.reconcileMovedFiioTracks([oldTrack], [newTrack]);
  assert.equal(migrated, 1);
  assert.deepEqual(Array.from(sandbox.state.queueTrackIds), ['fiio_other_1', 'fiio_new_88']);
  assert.equal(sandbox.state.favorites.has('fiio_old_55'), false);
  assert.equal(lib.isTrackInFavorites(newTrack, sandbox.state.favorites), true);
  assert.equal(savedFavCalls, 1);
  const updatedSess = JSON.parse(lsStore['nocturne-playback-session']);
  assert.equal(updatedSess.trackId, 'fiio_new_88');
  assert.deepEqual(Array.from(updatedSess.queueTrackIds), ['fiio_other_1', 'fiio_new_88']);
});

test('4. Android OTA downloadUrlBytes enforces total deadline & 16 MB cap + v3.9.59+ version alignment', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

  assert.ok(java.includes('MAX_OTA_ASSET_BYTES = 16 * 1024 * 1024;'));
  assert.ok(java.includes('if (total > MAX_OTA_ASSET_BYTES) return null;'));
  assert.ok(java.includes('if (android.os.SystemClock.elapsedRealtime() > deadlineMs) return null;'));

  assert.match(html, /FiiO M11S · v3\.9\.(59|[6-9]\d|\d{3,})/);
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(59|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(59|[6-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 113, `Expected versionCode >= 113, got ${vcMatch && vcMatch[1]}`);
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(59|[6-9]\d|\d{3,})"/);
});
