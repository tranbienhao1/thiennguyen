'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const HTML_404 = path.join(ROOT, '404.html');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android/app/build.gradle.kts');
const MAIN_JAVA = path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java');
const PUBLISH_JS = path.join(ROOT, '.agent/publish-release.cjs');
const ASSETS_DIR = path.join(ROOT, 'android/app/src/main/assets');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

test('1. deleteCachedFirstSlice & invalidateCloudTrackContent evict stale slice via openDatabase fallback & clear OneDrive downloadUrl', async () => {
  const html = readFile(INDEX_HTML);
  const delSrc = sliceBetween(html, 'function deleteCachedFirstSlice(track) {', 'function persistCloudCatalog(');
  const invSrc = sliceBetween(html, 'function invalidateCloudTrackContent(track) {', 'function releaseUnusedCloudUrl(');

  const deletedKeys = [];
  const released = [];
  const fakeStore = {
    delete: (k) => {
      deletedKeys.push(k);
      return { ok: true, key: k };
    }
  };
  let openDbCalls = 0;

  const odTrack = {
    id: 'onedrive:rev2',
    remoteId: 'od-2',
    source: 'onedrive',
    firstSliceCached: true,
    _loadedFromSliceCache: true,
    sliceEndedEarly: true,
    metadataLoaded: true,
    moovAtTail: true,
    fullAudioError: new Error('stale'),
    _pendingSliceUpgrade: true,
    downloadUrl: 'https://sharepoint.example/stale-token',
    downloadUrlAt: 1700000000000,
    url: 'blob:stale-od',
    file: { byteLength: 512 }
  };

  const sandbox = {
    library: { historyTrackKey: (tr) => `key:${tr.id}` },
    FIRST_SLICE_CACHE_STORE: 'firstSliceCache',
    state: { currentId: 'google:other', preloadTrackId: 'google:next' },
    sliceCacheTransaction: () => {
      throw new Error('IndexedDB slice cache chưa sẵn sàng.');
    },
    sliceCacheRequest: (req) => Promise.resolve(req),
    openDatabase: async () => {
      openDbCalls++;
      return {
        objectStoreNames: { contains: (name) => name === 'firstSliceCache' },
        transaction: () => ({
          objectStore: () => fakeStore
        })
      };
    },
    releaseUnusedCloudUrl: (tr) => {
      released.push(tr.id);
      tr.url = '';
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    delSrc + '\n' + invSrc + '\nthis.deleteCachedFirstSlice = deleteCachedFirstSlice; this.invalidateCloudTrackContent = invalidateCloudTrackContent;',
    sandbox
  );

  const ok = sandbox.invalidateCloudTrackContent(odTrack);
  assert.equal(ok, true);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(openDbCalls, 1, 'Must fall back to openDatabase() when sliceCacheTransaction throws while state.db is unavailable');
  assert.deepEqual(deletedKeys, ['key:onedrive:rev2'], 'Must delete stale firstSliceCache entry through opened DB');
  assert.equal(odTrack.firstSliceCached, false);
  assert.equal(odTrack._loadedFromSliceCache, false);
  assert.equal(odTrack.sliceEndedEarly, false);
  assert.equal(odTrack.downloadUrl, '', 'OneDrive downloadUrl must clear on content invalidation');
  assert.equal(odTrack.downloadUrlAt, 0);
  assert.deepEqual(released, ['onedrive:rev2']);
});

test('2. attachAudioElement clone reloads preloaded standbyAudio on sampleRate rebuild & playTrack guards unloaded clones', async () => {
  const html = readFile(INDEX_HTML);
  const attachSrc = sliceBetween(html, 'function attachAudioElement(element) {', 'function createSoftLimiter(');

  let cloneLoadCalls = 0;
  let attachEventsCalls = 0;
  let createCalls = 0;
  const cloneStandby = {
    src: 'blob:https://app.example/next-96k',
    readyState: 0,
    defaultMuted: true,
    playbackRate: 1.0,
    removeAttribute: () => {},
    load: () => { cloneLoadCalls++; },
    setSinkId: async () => {}
  };
  const oldStandby = {
    src: 'blob:https://app.example/next-96k',
    sinkId: '',
    pause: () => {},
    parentNode: { replaceChild: () => {} },
    cloneNode: () => cloneStandby
  };

  const sandbox = {
    audio: { src: 'blob:current' },
    standbyAudio: oldStandby,
    state: {
      playbackRate: 1.0,
      preloadReadyUrl: 'blob:https://app.example/next-96k',
      context: {
        createMediaElementSource: () => {
          createCalls++;
          if (createCalls === 1) throw new Error('InvalidStateError');
          return { connect: () => {} };
        },
        createGain: () => ({ gain: { value: 1 }, connect: () => {} })
      }
    },
    localStorage: { getItem: () => '' },
    isSilentUnlockSrc: () => false,
    attachDeckEvents: () => { attachEventsCalls++; }
  };

  vm.createContext(sandbox);
  vm.runInContext(attachSrc + '\nthis.attachAudioElement = attachAudioElement;', sandbox);
  const deck = sandbox.attachAudioElement(oldStandby);

  assert.equal(deck.element, cloneStandby);
  assert.equal(sandbox.standbyAudio, cloneStandby);
  assert.equal(attachEventsCalls, 1);
  assert.equal(cloneLoadCalls, 1, 'Cloned standbyAudio with active src must call load() instead of sitting at HAVE_NOTHING');
  assert.equal(sandbox.state.preloadReadyUrl, null, 'Stale preloadReadyUrl must clear after cloning until canplay fires');

  const playTrackSrc = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
  assert.ok(
    playTrackSrc.includes('(target.readyState === 0 && target.networkState === 0)'),
    'playTrack must call load() when cloned deck shares matching src at readyState === 0 && networkState === 0'
  );
});

test('3. preloadNext preserves healthy standby buffers on forced calls & pre-seeks cross-file CUE sub-tracks to cueStart', async () => {
  const html = readFile(INDEX_HTML);
  const prepSrc = sliceBetween(html, 'async function prepareCloudTrackForPreload(track) {', 'async function prepareLocalDsdNext(');
  const preloadBlockSrc = sliceBetween(html, 'function isSameCueParentTrack(curTrack, nextTrack) {', 'function skipFailedTrack(');

  let standbyLoads = 0;
  let tokenRefreshes = 0;
  const eventListeners = new Map();

  const standbyAudio = {
    src: 'blob:https://app.example/slice-1',
    volume: 1,
    muted: true,
    error: null,
    readyState: 4,
    duration: 240,
    currentTime: 0,
    pause: () => {},
    removeAttribute: (a) => { if (a === 'src') standbyAudio.src = ''; },
    load: () => { standbyLoads++; },
    addEventListener: (ev, cb) => { eventListeners.set(ev, cb); }
  };

  const trackNow = { id: 't0', source: 'local', url: 'blob:https://app.example/t0' };
  const trackCloudSlice = {
    id: 'g1',
    remoteId: 'r1',
    source: 'google',
    url: 'blob:https://app.example/slice-1',
    firstSlicePlayback: true,
    load: async () => { throw new Error('Should not re-download already buffered slice'); }
  };
  const trackCrossCue = {
    id: 'cue-disc2-t2',
    isCue: true,
    source: 'local',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2Fdisc2.flac',
    cueStart: 125.5,
    cueEnd: 310
  };

  let currentNext = trackCloudSlice;
  const sandbox = {
    MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
    URL,
    Date,
    Set,
    navigator: { onLine: true },
    library: {},
    location: { href: 'https://app.example/' },
    audio: { volume: 1 },
    standbyAudio,
    state: {
      context: { currentTime: 20 },
      deckA: { router: { gain: { setTargetAtTime: () => {} } } },
      deckB: { router: { gain: { setTargetAtTime: () => {} } } },
      activeDeck: null,
      crossfadeUntil: 0,
      currentId: 't0',
      tracks: [trackNow, trackCloudSlice, trackCrossCue],
      preloadTrackId: 'g1',
      preloadBusyId: null,
      preloadReadyUrl: null,
      preloadGeneration: 3,
      objectUrls: new Set(['blob:https://app.example/slice-1']),
      googleToken: 'tok-old',
      googleExpiresAt: Date.now() + 2 * 60 * 1000
    },
    queueIndex: () => (currentNext === trackCloudSlice ? 1 : 2),
    clearStalePreload: () => {},
    releaseUnusedCloudUrl: () => {},
    ensureLocalTrackPlayableUrl: async () => {},
    ensureGoogleToken: async (force) => {
      if (force) tokenRefreshes++;
      sandbox.state.googleExpiresAt = Date.now() + 3600 * 1000;
      return 'tok-new';
    },
    console
  };
  sandbox.state.activeDeck = sandbox.state.deckA;

  vm.createContext(sandbox);
  vm.runInContext(
    prepSrc + '\n' + preloadBlockSrc + '\nthis.preloadNext = preloadNext;',
    sandbox
  );

  // 3a. Forced preloadNext(true) while healthy slice is already buffered on standbyAudio preserves buffer & refreshes token
  await sandbox.preloadNext(true);
  assert.equal(standbyLoads, 0, 'Healthy standbyAudio buffer for same preloadTrackId must NOT be wiped by preloadNext(true)');
  assert.equal(tokenRefreshes, 1, 'Near-expiry Cloud token must still refresh during healthy standby reuse');
  assert.equal(sandbox.state.preloadReadyUrl, trackCloudSlice.url);

  // 3b. Preloading cross-file CUE sub-track with cueStart > 0 pre-seeks standbyAudio once loadedmetadata fires
  currentNext = trackCrossCue;
  standbyAudio.readyState = 0;
  standbyAudio.duration = 600;
  standbyAudio.currentTime = 0;
  await sandbox.preloadNext(true);
  assert.equal(standbyAudio.src, trackCrossCue.url);
  assert.equal(standbyLoads, 2, 'Switching to new CUE track resets old standby src (1 load) then loads new CUE URL (1 load)');
  assert.equal(standbyAudio.currentTime, 0);
  const metaCb = eventListeners.get('loadedmetadata');
  assert.equal(typeof metaCb, 'function', 'Must attach once loadedmetadata listener to pre-seek CUE standbyAudio');
  standbyAudio.readyState = 2;
  metaCb();
  assert.equal(standbyAudio.currentTime, 125.5, 'Cross-file CUE preload must pre-seek standbyAudio to cueStart');
});

test('4. reconcileMovedFiioTracks guards CUE vs unsplit parent match & MainActivity normalizeStorageScanPathKey deduplicates scan paths', () => {
  const html = readFile(INDEX_HTML);
  const recSrc = sliceBetween(html, 'function reconcileMovedFiioTracks(removedTracks, keptTracks) {', 'function pruneMissingFiioTracks(');

  const oldCue = {
    id: 'fiio_cue_1',
    isCue: true,
    size: 400000000,
    name: 'Album.flac',
    discNumber: 2,
    trackNumber: 5,
    year: 2022
  };
  const oldSaf = {
    id: 'fiio_saf_9',
    isCue: false,
    size: 55000000,
    name: '07 - Sonata',
    title: 'Sonata',
    artist: 'Performer',
    discNumber: 2,
    trackNumber: 7,
    year: 2021,
    rating: 5
  };
  const keptUnsplitParent = {
    id: 'fiio_parent_1',
    isCue: false,
    size: 400000000,
    name: 'Album.flac',
    discNumber: 0,
    trackNumber: 0,
    year: 0
  };
  const keptMediaStore = {
    id: 'fiio_ms_9',
    isCue: false,
    size: 55000000,
    name: '07 - Sonata',
    title: 'Sonata',
    artist: 'Performer',
    discNumber: 0,
    trackNumber: 0,
    year: 0
  };

  const sandbox = {
    fiioScanUpgradedCount: 0,
    state: { recentHistory: [], queueTrackIds: [], favorites: new Set() },
    library: {},
    Set,
    Number,
    String,
    Array,
    Boolean
  };

  vm.createContext(sandbox);
  vm.runInContext(recSrc + '\nthis.reconcileMovedFiioTracks = reconcileMovedFiioTracks;', sandbox);
  const migrated = sandbox.reconcileMovedFiioTracks([oldCue, oldSaf], [keptUnsplitParent, keptMediaStore]);

  assert.equal(migrated, 1, 'Only non-CUE track should reconcile; CUE sub-track must never merge into unsplit parent FLAC');
  assert.equal(keptUnsplitParent.discNumber, 0, 'Unsplit parent FLAC must remain untouched');
  assert.equal(keptMediaStore.discNumber, 2);
  assert.equal(keptMediaStore.trackNumber, 7);
  assert.equal(keptMediaStore.year, 2021);
  assert.equal(keptMediaStore.rating, 5);

  const java = readFile(MAIN_JAVA);
  assert.ok(java.includes('private static String normalizeStorageScanPathKey(@Nullable String rawPath)'), 'Must define normalizeStorageScanPathKey');
  assert.ok(java.includes('"/storage/emulated/0"'), 'normalizeStorageScanPathKey must alias /sdcard to /storage/emulated/0');
  assert.ok(java.includes('String normP = normalizeStorageScanPathKey(p);') && java.includes('String normCanon = "";'), 'startAsyncStorageScan must deduplicate using normalized and canonical keys');
});

test('5. Version v3.9.76+ / versionCode 130+, 404.html parity, Web Audio invariants, 0 ES2020+ syntax & 0 CR bytes', () => {
  const html = readFile(INDEX_HTML);
  const html404 = fs.readFileSync(HTML_404);
  const sw = readFile(SW_JS);
  const gradle = readFile(BUILD_GRADLE);
  const java = readFile(MAIN_JAVA);
  const pub = readFile(PUBLISH_JS);

  assert.equal(html404.toString('utf8'), html, '404.html must match index.html');
  assert.equal(html404.includes(0x0d), false, '404.html must contain 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:7[6-9]|[89]\d|\d{3,})/.test(html), 'index.html FiiO badge must be >= v3.9.76');
  assert.ok(/const CACHE_VERSION = 'v3\.9\.(?:7[6-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_VERSION must be >= v3.9.76');
  assert.ok(/const CACHE_NAME = 'nocturne-v3\.9\.(?:7[6-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_NAME must be >= nocturne-v3.9.76');
  assert.ok(/versionCode\s*=\s*(?:13\d|1[4-9]\d|[2-9]\d{2,})\b/.test(gradle), 'build.gradle.kts versionCode must be >= 130');
  assert.ok(/versionName = "3\.9\.(?:7[6-9]|[89]\d|\d{3,})"/.test(gradle), 'build.gradle.kts versionName must be >= 3.9.76');
  assert.ok(/"3\.9\.(?:7[6-9]|[89]\d|\d{3,})"/.test(java), 'MainActivity.java fallback versionName must be >= 3.9.76');
  assert.ok(/v3\.9\.(?:7[6-9]|[89]\d|\d{3,})/.test(pub) && /versionCode\s+(?:13\d|1[4-9]\d|[2-9]\d{2,})/.test(pub), 'publish-release.cjs must target >= v3.9.76 / versionCode >= 130');

  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(html.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'));

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ASSETS_DIR, f));
    assert.equal(assetBuf.includes(0x0d), false, `${f} in android assets must have 0 CR bytes (Unix LF)`);
  }

  const scriptStart = html.lastIndexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  const codeFiles = [['index.html <script>', html.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter((name) => name.endsWith('.js'))) {
    codeFiles.push([f, readFile(path.join(ROOT, f))]);
  }
  for (const [label, src] of codeFiles) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const stripped = lines[i]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain bare catch {}`);
    }
  }
});
