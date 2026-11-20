'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. syncAlbumCoversImmediate enforces 180-entry LRU cap on FiiO M11S & saveAlbumCoversCache debounces + recovers from QuotaExceededError', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('let albumCoversSaveTimer = null;');
  const end = html.indexOf('window.saveAlbumCoversCache = saveAlbumCoversCache;', start);
  assert.ok(start !== -1 && end > start, 'album covers cache block must exist');
  const src = html.slice(start, end + 'window.saveAlbumCoversCache = saveAlbumCoversCache;'.length);

  const store = {};
  let setCalls = 0;
  let quotaLimit = 10 * 1024 * 1024;
  let scheduledCallbacks = [];

  const state = {
    fiioDapMode: true,
    albumCovers: new Map(),
    tracks: []
  };

  const ctx = {
    window: {},
    state,
    IS_LEGACY_ANDROID: true,
    localStorage: {
      setItem(k, v) {
        setCalls++;
        if (v.length > quotaLimit) {
          const e = new Error('QuotaExceededError');
          e.name = 'QuotaExceededError';
          throw e;
        }
        store[k] = v;
      }
    },
    library: {
      buildAlbumKey: (t) => `${t.artist}:::${t.album}`,
      resolveTrackCover: () => null
    },
    Map,
    Array,
    Boolean,
    String,
    Math,
    JSON,
    console,
    setTimeout: (fn) => {
      scheduledCallbacks.push(fn);
      return scheduledCallbacks.length;
    },
    clearTimeout: () => {}
  };

  vm.runInNewContext(src, ctx);

  // Insert 220 distinct albums in rapid succession
  for (let i = 0; i < 220; i++) {
    const cover = 'data:image/jpeg;base64,' + 'A'.repeat(2000) + i;
    ctx.window.syncAlbumCoversImmediate(cover, { artist: 'Artist' + i, album: 'Album' + i });
  }

  assert.equal(state.albumCovers.size, 180, 'FiiO M11S in-memory albumCovers Map must be LRU-capped at 180');
  assert.ok(!state.albumCovers.has('Artist0:::Album0'), 'Oldest album cover must be evicted');
  assert.ok(state.albumCovers.has('Artist219:::Album219'), 'Newest album cover must be retained');
  assert.equal(setCalls, 0, 'Rapid cover ingestion must debounce localStorage writes (zero sync stalls)');

  // Flush final debounced write under normal quota
  scheduledCallbacks[scheduledCallbacks.length - 1]();
  assert.equal(setCalls, 1, 'Debounced flush executes a single localStorage write');
  const saved = JSON.parse(store['nocturne-album-covers']);
  assert.ok(saved.length <= 120, 'FiiO M11S persisted covers capped at <= 120');

  // Simulate tight localStorage quota -> triggers half-trimming recovery cleanly
  quotaLimit = 60000;
  setCalls = 0;
  ctx.window.saveAlbumCoversCache(true);
  assert.ok(setCalls >= 2, 'QuotaExceededError must trigger graceful trimming retries');
  const trimmed = JSON.parse(store['nocturne-album-covers']);
  assert.ok(trimmed.length >= 10 && trimmed.length < 120, 'Trimmed cache must persist the newest fitting covers');
});

test('2. window.onAndroidLowMemory terminates DSD preload worker, frees dsdBlob, revokes stale URLs & trims albumCovers while keeping active cover', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('window.onAndroidLowMemory = function(level) {');
  const end = html.indexOf('const CLOUD_METADATA_CONCURRENCY', start);
  assert.ok(start !== -1 && end > start);
  const src = html.slice(start, end).replace(/\n\s*\}\s*$/, '');

  let terminated = 0;
  let cancelled = 0;
  const revoked = [];
  const covers = new Map();
  for (let i = 0; i < 65; i++) {
    covers.set(`A${i}:::Alb${i}`, i % 2 === 0 ? `blob:cover-${i}` : `data:image/jpeg;base64,img${i}`);
  }

  const state = {
    currentId: 't-cur',
    tracks: [{ id: 't-cur', artist: 'A0', album: 'Alb0' }],
    preloadDsdSliceWorker: {
      postMessage: (m) => { if (m && m.type === 'cancel') cancelled++; },
      terminate: () => { terminated++; }
    },
    preloadDsdSliceTrackId: 't-next',
    dsdUrl: 'blob:dsd-old',
    dsdBlob: { size: 120000000 },
    preloadReadyUrl: 'blob:next-ok',
    objectUrls: new Set(['blob:active', 'blob:dsd-old', 'blob:next-ok', 'blob:stale-1', 'blob:stale-2']),
    albumCovers: covers
  };

  const mockWindow = {};
  new Function('window', 'state', 'audio', 'URL', 'library', 'pauseCloudMetadataQueue', 'setVisualizerRunning', 'console', src)(
    mockWindow,
    state,
    { src: 'blob:active' },
    { revokeObjectURL: (u) => revoked.push(u) },
    { buildAlbumKey: (t) => `${t.artist}:::${t.album}` },
    () => {},
    () => {},
    { warn: () => {} }
  );

  mockWindow.onAndroidLowMemory(15);

  assert.equal(cancelled, 1, 'Must cancel background DSD preload worker');
  assert.equal(terminated, 1, 'Must terminate background DSD preload worker');
  assert.equal(state.preloadDsdSliceWorker, null);
  assert.equal(state.dsdBlob, null, 'Must release 120MB dsdBlob under critical memory trim');
  assert.ok(revoked.includes('blob:stale-1') && revoked.includes('blob:stale-2'), 'Must revoke stale ObjectURLs');
  assert.ok(!revoked.includes('blob:active'), 'Must keep active audio ObjectURL');
  assert.equal(state.albumCovers.size, 40, 'Critical low memory must trim albumCovers Map to 40');
  assert.ok(state.albumCovers.has('A0:::Alb0'), 'Must preserve currently playing track album cover');
});

test('3. stopDsdWorker & playDsdTrack clean up fullAudioPromise and late ObjectURLs on rapid track skip', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function stopDsdWorker(invalidate = true) {');
  const end = html.indexOf('async function playDsdFirstSlice(', start);
  assert.ok(start !== -1 && end > start);
  const src = html.slice(start, end);

  const revoked = [];
  const track = { id: 'dsd-1', url: 'blob:dsd-live', fullAudioPromise: Promise.resolve(), firstSlicePlayback: true };
  const state = {
    dsdWorker: {
      postMessage() { throw new Error('already closed'); },
      terminate() {}
    },
    dsdUrl: 'blob:dsd-live',
    dsdBlob: { size: 90000000 },
    dsdTrackId: 'dsd-1',
    objectUrls: new Set(['blob:dsd-live']),
    tracks: [track],
    playGeneration: 1
  };
  const audio = { src: 'blob:dsd-live', pause() {}, removeAttribute() {}, load() {} };
  const standbyAudio = { src: '', pause() {}, removeAttribute() {}, load() {} };

  const stopDsdWorker = new Function('state', 'audio', 'standbyAudio', 'URL', '$', src + '\nreturn stopDsdWorker;')(
    state,
    audio,
    standbyAudio,
    { revokeObjectURL: (u) => revoked.push(u) },
    () => ({ textContent: '' })
  );

  stopDsdWorker(false);

  assert.equal(state.dsdWorker, null);
  assert.equal(state.dsdUrl, null);
  assert.equal(state.dsdBlob, null);
  assert.deepEqual(revoked, ['blob:dsd-live'], 'Must still revoke dsdUrl even if worker.postMessage throws');
  assert.equal(track.fullAudioPromise, null, 'Must clear fullAudioPromise so DSD track can be replayed cleanly');
  assert.equal(track.firstSlicePlayback, false);

  assert.ok(html.includes('if (generation !== state.playGeneration) {\n            try { URL.revokeObjectURL(url); } catch (_) {}'), 'playDsdTrack must revoke newly created ObjectURL if track was skipped during AudioContext.resume');
});

test('4. Version sync v3.9.20 (versionCode 74), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const assetSw = fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.20';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.20';"));
  assert.ok(gradle.includes('versionCode = 74'));
  assert.ok(gradle.includes('versionName = "3.9.20"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.equal(html, assetHtml);
  assert.equal(sw, assetSw);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
