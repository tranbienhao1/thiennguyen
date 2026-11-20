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

function extractFiioScanBlock(html) {
  const startMarker = 'let pendingAndroidStorageScan = false;';
  const endMarker = 'window.scanFiioStorage = scanFiioStorage;';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start !== -1 && end !== -1, 'Could not locate scanFiioStorage block in index.html');
  return html.slice(start, end + endMarker.length);
}

test('1. MainActivity exposes non-blocking startAsyncStorageScan with chunked streaming & preserves scanDirectory', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('AtomicBoolean mStorageScanRunning = new java.util.concurrent.atomic.AtomicBoolean(false)') && java.includes('mStorageScanRunning.compareAndSet(false, true)'), 'MainActivity must guard concurrent scans via AtomicBoolean');
  assert.ok(java.includes('@JavascriptInterface') && java.includes('public boolean startAsyncStorageScan(final int maxFiles)'), 'MainActivity must expose @JavascriptInterface startAsyncStorageScan');
  assert.ok(java.includes('Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)'), 'Async storage scanner must run at THREAD_PRIORITY_BACKGROUND');
  assert.ok(java.includes('final int CHUNK_SIZE = 250;'), 'Async storage scanner must emit 250-track chunks');
  assert.ok(java.includes('window.onAndroidStorageScanChunk'), 'Async scanner must push chunks to window.onAndroidStorageScanChunk');
  assert.ok(java.includes('window.onAndroidStorageScanDone'), 'Async scanner must notify window.onAndroidStorageScanDone');
  assert.ok(java.includes('candidate.startsWith(parent + "/")'), 'Async scanner must deduplicate overlapping storage sub-roots');
  assert.ok(java.includes('public String scanDirectory(String dirPath, int maxFiles) {'), 'Legacy scanDirectory @JavascriptInterface signature must stay intact');
  assert.ok(java.includes('public String scanMediaStoreAudio(int maxFiles) {'), 'scanMediaStoreAudio @JavascriptInterface must stay intact');
  assert.ok(java.includes(': "3.9.16";') && java.includes('\\"versionName\\":\\"3.9.16\\"'), 'MainActivity fallback versionName must be 3.9.16');
});

test('2. scanFiioStorage runtime behavior: async chunk streaming, deduplication, and double-tap lock', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const snippet = extractFiioScanBlock(html);
  assert.ok(!snippet.includes('.push(...'), 'scanFiioStorage must never use .push(... spread (Chromium 74 / stack overflow safety)');

  const toasts = [];
  let renderCalls = 0;
  let scheduleRenderCalls = 0;
  let collectionRenderCalls = 0;
  let saveCatalogCalls = 0;
  let startAsyncCalls = 0;

  const sandboxWindow = {
    isNativeAndroid: true,
    NocturneNative: {
      hasStoragePermission: () => true,
      startAsyncStorageScan: (maxFiles) => {
        startAsyncCalls++;
        assert.equal(maxFiles, 10000);
        setTimeout(() => {
          sandboxWindow.onAndroidStorageScanChunk([
            { name: '01-Track.flac', path: '/storage/SD/Album/01-Track.flac', size: 42000000, artist: 'Miles', album: 'Kind of Blue' },
            { name: '02-Track.dsf', path: '/storage/SD/Album/02-Track.dsf', size: 180000000, artist: 'Miles', album: 'Kind of Blue' }
          ], 2, 'MediaStore');
          setTimeout(() => {
            // Second chunk includes a duplicate path that must be ignored
            sandboxWindow.onAndroidStorageScanChunk([
              { name: '01-Track.flac', path: '/storage/SD/Album/01-Track.flac', size: 42000000 },
              { name: '03-Bonus.wav', path: '/storage/SD/Album/03-Bonus.wav', size: 60000000 }
            ], 3, 'MicroSD');
            sandboxWindow.onAndroidStorageScanDone(3, null);
          }, 10);
        }, 10);
        return true;
      }
    }
  };

  const state = { tracks: [] };
  const ctx = {
    window: sandboxWindow,
    state,
    URL,
    Set,
    Array,
    Math,
    Number,
    String,
    Boolean,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    encodeURIComponent,
    console,
    toast: (msg) => toasts.push(msg),
    scheduleTrackRender: () => { scheduleRenderCalls++; },
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => { renderCalls++; },
    renderCollectionCards: () => { collectionRenderCalls++; },
    saveCatalog: () => { saveCatalogCalls++; },
    library: undefined
  };

  vm.runInNewContext(snippet, ctx);

  // Trigger concurrent double-tap: second call must be rejected while scan is in progress
  const firstRun = sandboxWindow.scanFiioStorage();
  const secondRun = sandboxWindow.scanFiioStorage();
  await Promise.all([firstRun, secondRun]);

  assert.equal(startAsyncCalls, 1, 'Double-tap while scanning must not launch duplicate native scan');
  assert.equal(state.tracks.length, 3, 'Must ingest 3 unique tracks across 2 chunks');
  assert.equal(state.tracks[1].isDsd, true, 'DSF track must be flagged as DSD');
  assert.ok(scheduleRenderCalls >= 2, 'Each chunk must trigger debounced scheduleTrackRender');
  assert.equal(renderCalls, 1, 'Completion must render tracks once');
  assert.equal(collectionRenderCalls, 1, 'Completion must refresh collection cards once');
  assert.equal(saveCatalogCalls, 1, 'Completion must persist catalog once');
  assert.ok(toasts.some((m) => m.includes('Đang quét bộ nhớ FiiO')), 'Double-tap must inform user scan is already running');
  assert.ok(toasts.some((m) => m.includes('tìm thấy 3 bài hát')), 'Completion toast must report found tracks');
});

test('3. Legacy fallback deduplicates overlapping parent/child storage roots and yields cleanly', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const snippet = extractFiioScanBlock(html);

  const scannedDirs = [];
  const sandboxWindow = {
    isNativeAndroid: true,
    NocturneNative: {
      hasStoragePermission: () => true,
      scanMediaStoreAudio: () => JSON.stringify([
        { name: 'ms.flac', path: '/storage/emulated/0/Music/ms.flac', uri: 'content://media/external/audio/media/1', size: 10000 }
      ]),
      getStoragePaths: () => JSON.stringify([
        '/storage/emulated/0/Music',
        '/storage/emulated/0',
        '/storage/1234-5678/Music',
        '/storage/1234-5678/'
      ]),
      scanDirectory: (dirPath) => {
        scannedDirs.push(dirPath);
        if (dirPath === '/storage/1234-5678') {
          return JSON.stringify([
            { name: 'sd.dsf', path: '/storage/1234-5678/Music/sd.dsf', size: 200000 }
          ]);
        }
        return '[]';
      }
    }
  };

  const state = { tracks: [] };
  const ctx = {
    window: sandboxWindow,
    state,
    URL,
    Set,
    Array,
    Math,
    Number,
    String,
    Boolean,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    encodeURIComponent,
    console,
    toast: () => {},
    scheduleTrackRender: () => {},
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => {},
    renderCollectionCards: () => {},
    saveCatalog: () => {},
    library: undefined
  };

  vm.runInNewContext(snippet, ctx);
  await sandboxWindow.scanFiioStorage({ silent: true });

  assert.deepEqual(scannedDirs, ['/storage/1234-5678', '/storage/emulated/0'], 'Must skip redundant child directories covered by parent roots');
  assert.equal(state.tracks.length, 2, 'Must combine MediaStore + deduplicated SD tracks');
});

test('4. Version sync v3.9.16 (versionCode 70), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const assetSw = fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.16';"), 'sw.js CACHE_VERSION must be v3.9.16');
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.16';"), 'sw.js CACHE_NAME must be nocturne-v3.9.16');
  assert.ok(gradle.includes('versionCode = 70'), 'build.gradle.kts versionCode must be 70');
  assert.ok(gradle.includes('versionName = "3.9.16"'), 'build.gradle.kts versionName must be 3.9.16');
  assert.ok(html.includes('FiiO M11S · v3.9.16'), 'Settings #fiio-dap-badge must show v3.9.16');
  assert.equal(html, assetHtml, 'index.html must match android assets/index.html');
  assert.equal(sw, assetSw, 'sw.js must match android assets/sw.js');
  assert.ok(!assetHtml.includes('\r'), 'android assets/index.html must have 0 CR bytes');
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio destination invariant preserved');
});
