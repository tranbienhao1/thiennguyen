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

test('1. stopDsdWorker & playDsdTrack cancel stale DSD workers, resolve pending fullAudioPromise, and guard aborted DSD fetch catches', async () => {
  const html = readFile(INDEX_HTML);
  const stopSrc = sliceBetween(html, 'function stopDsdWorker(invalidate = true) {', 'async function playDsdFirstSlice(');
  const dsdSrc = sliceBetween(html, 'async function playDsdTrack(track, generation, playRequestedAt) {', 'function playNext(');
  const playTrackSrc = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');

  // 1a. playTrack source invariants for fast source switching away from DSD
  assert.ok(
    playTrackSrc.includes('if (previousTrack && previousTrack.id !== track.id && previousTrack._dsdFetchAbort && track.id !== state.preloadTrackId)'),
    'playTrack must immediately abort previousTrack._dsdFetchAbort on track switch'
  );
  assert.ok(
    playTrackSrc.includes('if (state.dsdTrackId || state.dsdBlob || state.dsdUrl) stopDsdWorker(false);'),
    'playTrack must call stopDsdWorker(false) even before state.dsdUrl exists (preserving state.dsdUrl) invariant'
  );
  assert.ok(
    /catch\s*\(error\)\s*\{\s*if\s*\(generation\s*!==\s*state\.playGeneration\)\s*return;/.test(playTrackSrc),
    'DSD playback setup catch must exit early when generation !== state.playGeneration'
  );

  // 1b. stopDsdWorker cleans pre-slice state & resolves pending _dsdFullResolve
  let resolvedPromise = false;
  const track = {
    id: 'dsd-active',
    url: '',
    firstSlicePlayback: true,
    sliceEndedEarly: true,
    lastSlicePosition: 1.4,
    _pendingSeekAfterFullUpgrade: 95.5
  };
  track.fullAudioPromise = new Promise((res) => {
    track._dsdFullResolve = () => {
      resolvedPromise = true;
      res();
    };
  });
  let workerCancelled = 0;
  let workerTerminated = 0;
  const state = {
    dsdWorker: { postMessage: () => { workerCancelled++; }, terminate: () => { workerTerminated++; } },
    dsdUrl: null,
    dsdBlob: null,
    dsdTrackId: 'dsd-active',
    tracks: [track],
    objectUrls: new Set(),
    playGeneration: 2,
    isNativeBitPerfectPlaying: false
  };
  const stopSandbox = {
    state,
    audio: { src: '', pause() {}, removeAttribute() {}, load() {} },
    standbyAudio: { src: '', pause() {}, removeAttribute() {}, load() {} },
    URL: { revokeObjectURL() {} },
    $: () => ({ textContent: '' })
  };
  vm.createContext(stopSandbox);
  vm.runInContext(stopSrc + '\nthis.stopDsdWorker = stopDsdWorker;', stopSandbox);
  stopSandbox.stopDsdWorker(false);
  await track.fullAudioPromise;

  assert.equal(resolvedPromise, true, 'stopDsdWorker must resolve dangling _dsdFullResolve promise');
  assert.equal(workerCancelled, 1);
  assert.equal(workerTerminated, 1);
  assert.equal(state.dsdTrackId, null);
  assert.equal(track.fullAudioPromise, null);
  assert.equal(track._dsdFullResolve, null);
  assert.equal(track._pendingSeekAfterFullUpgrade, null);
  assert.equal(track.sliceEndedEarly, false);
  assert.equal(track.lastSlicePosition, null);

  // 1c. playDsdTrack terminates stale worker if generation changes mid-decode
  let lateWorkerTerminated = 0;
  let lateWorkerInstance = null;
  class FakeWorker {
    constructor() {
      lateWorkerInstance = this;
    }
    postMessage(msg) {
      if (msg && msg.type === 'cancel') return;
      // Simulate user skipping track right before worker posts progress/done
      dsdSandbox.state.playGeneration++;
      this.onmessage({ data: { type: 'progress', progress: 0.5 } });
    }
    terminate() {
      lateWorkerTerminated++;
    }
  }
  const staleTrack = { id: 'dsd-stale', format: 'DSF', sampleRate: 2822400, size: 10000000, file: new Blob(['dsd']) };
  const dsdSandbox = {
    Worker: FakeWorker,
    URL,
    Blob,
    Number,
    Math,
    Date,
    location: { protocol: 'https:' },
    dsdWorkerBaseUrl: 'https://app.example/',
    library: { DSD_FIRST_SLICE_CACHE_MAX_BYTES: 3 * 1024 * 1024 },
    audio: { src: '', paused: true, pause() {}, removeAttribute() {}, load() {}, volume: 1 },
    standbyAudio: { src: '', muted: false, paused: true, pause() {}, removeAttribute() {}, load() {} },
    state: {
      currentId: 'dsd-stale',
      playGeneration: 10,
      dsdOutputRate: 88200,
      dsdOutputDepth: 24,
      dsdWorker: null,
      dsdUrl: null,
      dsdTrackId: null,
      context: { state: 'running', resume: async () => {} },
      objectUrls: new Set(),
      tracks: [staleTrack]
    },
    stopDsdWorker: () => {},
    dsdSourceInfo: () => ({ baseRate: 44100, multiplier: 64 }),
    getCachedFirstSlice: async () => null,
    cacheFirstSlice: async () => {},
    displayTrack: () => {},
    scheduleTrackRender: () => {},
    toast: () => {},
    $: () => ({ textContent: '', value: '88200' }),
    console
  };
  vm.createContext(dsdSandbox);
  vm.runInContext(dsdSrc + '\nthis.playDsdTrack = playDsdTrack;', dsdSandbox);
  await dsdSandbox.playDsdTrack(staleTrack, 10, 0);
  await staleTrack.fullAudioPromise;

  assert.ok(lateWorkerInstance);
  assert.equal(lateWorkerTerminated, 1, 'Stale DSD worker firing after playGeneration bump must be terminated cleanly');
  assert.equal(dsdSandbox.state.dsdWorker, null);
  assert.equal(staleTrack.fullAudioPromise, null);
  assert.equal(staleTrack._dsdFullResolve, null);
});

test('2. MainActivity BoundedContentUriInputStream survives channel/skip errors & 416 responses include Content-Length: 0 + Accept-Ranges', () => {
  const java = readFile(MAIN_JAVA);
  const boundedUriSrc = sliceBetween(java, 'public static class BoundedContentUriInputStream extends InputStream {', 'public static String getAudioMimeType(');
  assert.ok(
    boundedUriSrc.includes('catch (Exception ignored) {\n                        // Pipe-backed or FUSE-wrapped ContentProvider may reject FileChannel/position()'),
    'BoundedContentUriInputStream constructor must catch Exception around FileChannel operations'
  );
  assert.ok(
    boundedUriSrc.includes('catch (Exception ignored) {}\n                long skipped = 0;'),
    'BoundedContentUriInputStream.skip must catch Exception around FileChannel.size/position'
  );
  assert.ok(
    boundedUriSrc.includes('s = mFis.skip(toSkip - skipped);\n                    } catch (IOException ignored)'),
    'BoundedContentUriInputStream.skip must fall back to read() if skip() throws IOException/ESPIPE'
  );

  const mediaSrc = sliceBetween(java, 'private WebResourceResponse handleLocalMediaStreaming(', 'public boolean isMediaKey(');
  const matches416 = mediaSrc.match(/respHeaders\.put\("Content-Range", "bytes \*\/" \+ (?:fileLength|totalLength)\);\s*respHeaders\.put\("Content-Length", "0"\);\s*respHeaders\.put\("Accept-Ranges", "bytes"\);/g) || [];
  assert.equal(matches416.length, 2, 'Both File and ContentUri 416 Range Not Satisfiable responses must set Content-Length: 0 and Accept-Ranges: bytes');
});

test('3. FiiO local scan normalizes /sdcard <-> /storage/emulated/0 across ingest & pruneMissingFiioTracks without duplicating tracks', () => {
  const html = readFile(INDEX_HTML);
  const scanHelpersSrc = sliceBetween(html, 'function normalizeFiioPathKey(rawPath) {', 'window.pruneMissingFiioTracks = pruneMissingFiioTracks;');
  const legacyScanSlice = sliceBetween(html, '// 2. Legacy bridge fallback', 'window.scanFiioStorage = scanFiioStorage;');

  const legacyTrack = {
    id: 'fiio_legacy_1',
    isCue: false,
    name: 'Sonata',
    title: 'Sonata',
    artist: 'Artist A',
    album: 'Album A',
    path: '/sdcard/Music/Sonata.flac',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2FSonata.flac',
    size: 42000000,
    lastModified: 1700000000000
  };
  const missingInternalTrack = {
    id: 'fiio_deleted_2',
    isCue: false,
    name: 'Gone',
    title: 'Gone',
    artist: 'Artist A',
    album: 'Album A',
    path: '/sdcard/Music/Gone.flac',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2FGone.flac',
    size: 31000000
  };
  const unmountedSdTrack = {
    id: 'fiio_sd_keep',
    isCue: false,
    name: 'KeepSD',
    path: '/storage/ABCD-1234/Lossless/KeepSD.flac',
    size: 51000000
  };

  const sandbox = {
    window: {},
    URL,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    encodeURIComponent,
    activeFiioScanMaps: null,
    fiioScanUpgradedCount: 0,
    fiioScanSkippedUnchangedCount: 0,
    state: {
      currentId: null,
      tracks: [legacyTrack, missingInternalTrack, unmountedSdTrack],
      recentHistory: [],
      queueTrackIds: [],
      favorites: new Set()
    },
    library: {
      createFiioTrack: (f) => ({ id: 'fiio_new_' + f.name, path: f.path, name: f.name, size: f.size, source: 'local' }),
      enrichFiioTrackMetadata: () => {}
    },
    restoreLocalTrackUrlSync: () => {},
    fiioTrackDisplayMeta: (f) => ({ title: f.title || f.name, name: f.name, artist: f.artist || 'Unknown Artist', album: f.album || 'FiiO Internal & SD Card' }),
    isFavorite: () => false
  };

  vm.createContext(sandbox);
  vm.runInContext(
    scanHelpersSrc +
      '\nthis.normalizeFiioPathKey = normalizeFiioPathKey; this.buildExistingFiioTrackSets = buildExistingFiioTrackSets; this.ingestFiioScannedFilesChunk = ingestFiioScannedFilesChunk; this.pruneMissingFiioTracks = pruneMissingFiioTracks;',
    sandbox
  );

  assert.equal(sandbox.normalizeFiioPathKey('\\sdcard\\Music//HiRes\\'), '/storage/emulated/0/music/hires');
  assert.equal(sandbox.normalizeFiioPathKey('/storage/ABCD-1234/Album/01.flac'), '/storage/abcd-1234/album/01.flac');

  const sets = sandbox.buildExistingFiioTrackSets();
  assert.ok(sets.existingPaths.has('/storage/emulated/0/music/sonata.flac'), 'existingPaths must include normalized /sdcard -> /storage/emulated/0 key');

  const added = sandbox.ingestFiioScannedFilesChunk(
    [{ name: 'Sonata.flac', path: '/storage/emulated/0/Music/Sonata.flac', uri: 'content://media/external/audio/media/99', size: 42000000 }],
    sets.existingPaths,
    sets.existingUris,
    []
  );
  assert.equal(added, 0, 'MediaStore /storage/emulated/0 scan must update legacy /sdcard track in-place without inserting a duplicate');
  assert.equal(legacyTrack.path, '/storage/emulated/0/Music/Sonata.flac');
  assert.equal(legacyTrack.uri, 'content://media/external/audio/media/99');

  const removed = sandbox.pruneMissingFiioTracks(new Set(['/storage/emulated/0/Music/Sonata.flac']), new Set());
  assert.equal(removed, 1, 'Should prune only /sdcard/Music/Gone.flac while keeping Sonata (alias matched) and unmounted SD track');
  assert.ok(sandbox.state.tracks.some((t) => t.id === 'fiio_legacy_1'));
  assert.ok(!sandbox.state.tracks.some((t) => t.id === 'fiio_deleted_2'));
  assert.ok(sandbox.state.tracks.some((t) => t.id === 'fiio_sd_keep'));

  assert.ok(
    legacyScanSlice.includes('{ allowEmptyPrune: allowEmptyPrune, cueParentFilesByPath: legacyCueParentFiles }'),
    'Legacy fallback scan must pass cueParentFilesByPath & allowEmptyPrune to pruneMissingFiioTracks'
  );
});

test('4. Version v3.9.77+ / versionCode 131+, 404.html parity, Web Audio invariants, 0 ES2020+ syntax & 0 CR bytes', () => {
  const html = readFile(INDEX_HTML);
  const html404 = fs.readFileSync(HTML_404);
  const sw = readFile(SW_JS);
  const gradle = readFile(BUILD_GRADLE);
  const java = readFile(MAIN_JAVA);
  const pub = readFile(PUBLISH_JS);

  assert.equal(html404.toString('utf8'), html, '404.html must match index.html');
  assert.equal(html404.includes(0x0d), false, '404.html must contain 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:7[7-9]|[89]\d|\d{3,})/.test(html), 'index.html FiiO badge must be >= v3.9.77');
  assert.ok(/const CACHE_VERSION = 'v3\.9\.(?:7[7-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_VERSION must be >= v3.9.77');
  assert.ok(/const CACHE_NAME = 'nocturne-v3\.9\.(?:7[7-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_NAME must be >= nocturne-v3.9.77');
  assert.ok(/versionCode\s*=\s*(?:13[1-9]|1[4-9]\d|[2-9]\d{2,})\b/.test(gradle), 'build.gradle.kts versionCode must be >= 131');
  assert.ok(/versionName = "3\.9\.(?:7[7-9]|[89]\d|\d{3,})"/.test(gradle), 'build.gradle.kts versionName must be >= 3.9.77');
  assert.ok(/"3\.9\.(?:7[7-9]|[89]\d|\d{3,})"/.test(java), 'MainActivity.java fallback versionName must be >= 3.9.77');
  assert.ok(/v3\.9\.(?:7[7-9]|[89]\d|\d{3,})/.test(pub) && /versionCode\s+(?:13[1-9]|1[4-9]\d|[2-9]\d{2,})/.test(pub), 'publish-release.cjs must target >= v3.9.77 / versionCode >= 131');

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
