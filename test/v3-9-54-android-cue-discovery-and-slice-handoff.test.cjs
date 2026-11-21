'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. MainActivity.java exposes safe readLocalTextFile(@JavascriptInterface) with 512KB cap, extension whitelist & NFC/NFD/+ path resolution', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const start = java.indexOf('public String readLocalTextFile(@Nullable String filePath)');
  const end = java.indexOf('private static String extractFlacVorbisLyricsFromFile(', start);
  assert.ok(start > 0 && end > start, 'readLocalTextFile must exist inside NocturneNativeBridge');
  const src = java.slice(start, end);
  assert.ok(src.includes('resolveReadableLocalFile(filePath.trim())'));
  assert.ok(src.includes('lower.endsWith(".cue")'));
  assert.ok(src.includes('MAX_LOCAL_TEXT_FILE_BYTES'));
  assert.ok(src.includes('decodeLyricsBytes(bos.toByteArray())'));
});

test('2. Android / FiiO MicroSD CUE sheet discovery expands multi-disc CUE sub-tracks, skips broken raw .cue/.iso tracks & persists CUE fields', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const library = require(path.join(ROOT, 'library-utils.js'));

  const compactStart = html.indexOf('function compactFiioTrackForStorage(t, ultraLean) {');
  const compactEnd = html.indexOf('function saveFiioCatalog(tracks) {', compactStart);
  const cueStart = html.indexOf('function fiioCueHash(str) {');
  const cueEnd = html.indexOf('function deduplicateStorageRoots(rawPaths) {', cueStart);
  const pruneStart = html.indexOf('function extractStorageRootPrefix(rawPath) {');
  const pruneEnd = html.indexOf('window.extractStorageRootPrefix = extractStorageRootPrefix;', pruneStart);
  assert.ok(compactStart > 0 && compactEnd > compactStart);
  assert.ok(cueStart > 0 && cueEnd > cueStart);
  assert.ok(pruneStart > 0 && pruneEnd > pruneStart);

  const sampleCue = [
    'REM GENRE Jazz',
    'PERFORMER "Miles Davis"',
    'TITLE "Kind of Blue (Disc 2)"',
    'FILE "Kind of Blue.wav" WAVE',
    '  TRACK 01 AUDIO',
    '    TITLE "So What"',
    '    PERFORMER "Miles Davis"',
    '    INDEX 01 00:00:00',
    '  TRACK 02 AUDIO',
    '    TITLE "Freddie Freeloader"',
    '    PERFORMER "Miles Davis"',
    '    INDEX 01 09:22:00',
    '  TRACK 03 AUDIO',
    '    TITLE "Blue in Green"',
    '    INDEX 01 19:08:37'
  ].join('\n');

  const cueFilePath = '/storage/1234-5678/Music/Miles Davis/Disc 2/Kind of Blue.cue';
  const flacFilePath = '/storage/1234-5678/Music/Miles Davis/Disc 2/Kind of Blue.flac';

  const state = {
    tracks: [
      // Legacy broken raw .cue track from an older version must be pruned
      { id: 'fiio_old_broken_cue', source: 'local', path: '/storage/1234-5678/Music/Old.cue', name: 'Old.cue' }
    ],
    currentId: null,
    recentHistory: []
  };

  const sandbox = {
    library,
    state,
    fiioScanUpgradedCount: 0,
    window: {
      NocturneNative: {
        readLocalTextFile: p => (p === cueFilePath ? sampleCue : '')
      }
    },
    buildExistingFiioTrackMaps: () => {
      const existingByPath = new Map();
      const existingByUri = new Map();
      for (const tr of state.tracks) {
        if (tr && tr.path) existingByPath.set(tr.path, tr);
        if (tr && tr.uri) existingByUri.set(tr.uri, tr);
      }
      return { existingByPath, existingByUri };
    },
    applyFiioRescanFields: () => {},
    createFiioFallbackTrack: f => ({
      id: 'fiio_' + f.name,
      source: 'local',
      name: f.name,
      title: f.name,
      path: f.path,
      duration: f.duration || 0,
      format: 'FLAC',
      size: f.size || 0,
      url: 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(f.path)
    }),
    restoreLocalTrackUrlSync: tr => {
      if (!tr.url && tr.path) tr.url = 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(tr.path);
    },
    encodeURIComponent,
    Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(compactStart, compactEnd) + '\n' +
    html.slice(cueStart, cueEnd) + '\n' +
    html.slice(pruneStart, pruneEnd) +
    '\nthis.__exports = { compactFiioTrackForStorage, hydrateFiioStoredTrack, ingestFiioScannedFilesChunk, expandFiioScannedCueSheets, pruneMissingFiioTracks };',
    sandbox
  );

  const existingPaths = new Set();
  const existingUris = new Set();
  const collectedCueFiles = [];
  const addedAudio = sandbox.__exports.ingestFiioScannedFilesChunk([
    { name: 'Kind of Blue.flac', path: flacFilePath, size: 350000000, duration: 1800 },
    { name: 'Kind of Blue.cue', path: cueFilePath, size: 512 },
    { name: 'SACD.iso', path: '/storage/1234-5678/Music/SACD.iso', size: 2000000000 }
  ], existingPaths, existingUris, collectedCueFiles);

  assert.equal(addedAudio, 1, 'Only real playable audio track should be ingested directly (not raw .cue or .iso)');
  assert.equal(collectedCueFiles.length, 1);

  const addedCue = sandbox.__exports.expandFiioScannedCueSheets(collectedCueFiles);
  assert.equal(addedCue, 3, 'Should expand all 3 CUE sub-tracks matching Kind of Blue.flac (converted .wav -> .flac)');
  const cueTracks = state.tracks.filter(t => t.isCue);
  assert.equal(cueTracks.length, 3);
  assert.equal(cueTracks[0].title, 'So What');
  assert.equal(cueTracks[0].cueStart, 0);
  assert.equal(cueTracks[0].discNumber, 2, 'Should infer Disc 2 from folder path');
  assert.equal(cueTracks[1].title, 'Freddie Freeloader');
  assert.equal(cueTracks[1].cueStart, 562);
  assert.equal(cueTracks[2].title, 'Blue in Green');
  assert.ok(cueTracks[2].cueStart > 1148);
  assert.equal(state.tracks.some(t => !t.isCue && t.path === flacFilePath), false, 'Unsplit parent FLAC image should be replaced by CUE sub-tracks');

  // Re-expanding the same CUE sheet must NOT duplicate sub-tracks
  const addedAgain = sandbox.__exports.expandFiioScannedCueSheets(collectedCueFiles);
  assert.equal(addedAgain, 0);
  assert.equal(state.tracks.filter(t => t.isCue).length, 3);

  // Storage roundtrip preserves isCue, cueStart, cueFilePath, cueDedupKey & discNumber even in ultraLean mode
  const compactedLean = sandbox.__exports.compactFiioTrackForStorage(cueTracks[1], true);
  const hydratedLean = sandbox.__exports.hydrateFiioStoredTrack(compactedLean);
  assert.equal(hydratedLean.isCue, true);
  assert.equal(hydratedLean.cueStart, 562);
  assert.equal(hydratedLean.cueFilePath, cueFilePath);
  assert.equal(hydratedLean.discNumber, 2);
  assert.ok(hydratedLean.url.includes('/local-media?path='));

  // Pruning removes legacy broken raw .cue track while keeping valid CUE sub-tracks
  const removed = sandbox.__exports.pruneMissingFiioTracks(new Set([flacFilePath, cueFilePath]), new Set());
  assert.equal(removed, 1);
  assert.equal(state.tracks.some(t => t.id === 'fiio_old_broken_cue'), false);
  assert.equal(state.tracks.filter(t => t.isCue).length, 3);
});

test('3. Cloud first-slice -> full upgrade suppresses transient pause flicker & preserves exact early-seek target', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const upgradeStart = html.indexOf('async function upgradeSliceToFullAudio(track, sliceUrl, url, options, provider) {');
  const upgradeEnd = html.indexOf('async function fetchCloudTrack(track, url, options, provider) {', upgradeStart);
  assert.ok(upgradeStart > 0 && upgradeEnd > upgradeStart);
  const upgradeSrc = html.slice(upgradeStart, upgradeEnd);

  let playCalls = 0;
  let pauseUiFlipped = false;
  let syncSeekValues = [];
  const handlers = {};
  const deck = {
    src: 'blob:slice-1',
    currentTime: 8,
    duration: 240,
    paused: false,
    _upgradingFullAudio: false,
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    load() {
      // Simulate real HTML5 <audio>.load() emitting synchronous 'pause' event during src swap
      if (!this._upgradingFullAudio) pauseUiFlipped = true;
    },
    async play() { playCalls++; this.paused = false; }
  };

  const state = {
    currentId: 'cloud_t1',
    objectUrls: new Set(['blob:slice-1']),
    activeDeck: { element: deck, router: { gain: { value: 1, setTargetAtTime() {} } } },
    context: { currentTime: 10, state: 'running', resume: async () => {} }
  };
  const track = {
    id: 'cloud_t1',
    source: 'google',
    name: 'Test.flac',
    title: 'Test',
    format: 'FLAC',
    url: 'blob:slice-1',
    firstSlicePlayback: true,
    _pendingSeekAfterFullUpgrade: 150.5
  };

  const sandbox = {
    state,
    audio: deck,
    standbyAudio: { src: '' },
    library: {
      fetchAudioBlob: async () => new Blob(['full-flac'], { type: 'audio/flac' }),
      normalizeAudioBlob: b => b
    },
    isGraphContentUrl: () => false,
    finishCloudMetadataInBackground: () => {},
    releaseTrackUrl: () => {},
    formatTime: s => String(Math.round(s)),
    $: () => ({ textContent: '' }),
    syncSeek: v => syncSeekValues.push(v),
    updatePositionState: () => {},
    clearOptimisticLoadingUi: () => {},
    URL, Blob,
    location: { href: 'https://nocturne.local/' },
    performance: { now: () => 5000 },
    setTimeout, clearTimeout, Date, Number, Math, Object, console
  };
  vm.createContext(sandbox);
  vm.runInContext(upgradeSrc + '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;', sandbox);

  await sandbox.upgradeSliceToFullAudio(track, 'blob:slice-1', 'https://drive.example/file', {}, 'Google Drive');
  assert.equal(pauseUiFlipped, false, 'deck._upgradingFullAudio must be true before deck.load() so transient pause does not flicker Play/Pause UI');
  assert.equal(deck._upgradingFullAudio, true);

  // Simulate loadedmetadata arriving 400ms later
  sandbox.performance.now = () => 5400;
  for (const fn of handlers.loadedmetadata || []) fn();
  await new Promise(r => setImmediate(r));

  assert.equal(deck.currentTime, 150.5, 'Explicit early-seek target must NOT be shifted forward by elapsedSec compensation');
  assert.equal(playCalls, 1);
  assert.equal(deck._upgradingFullAudio, false, 'Upgrade flag must clear cleanly after play() resolves');
  assert.ok(syncSeekValues.length >= 1, 'Seekbar must refresh immediately after early-seek handoff');

  // Verify attachDeckEvents pause guard and resumeFullAudioFromSlice also honor _upgradingFullAudio & _pendingSeekAfterFullUpgrade
  assert.ok(html.includes('if (element._upgradingFullAudio) return;'));
  assert.ok(html.includes('const pendingSeekPos = Number.isFinite(track._pendingSeekAfterFullUpgrade) ? track._pendingSeekAfterFullUpgrade : null;'));
});

test('4. Modern Android sidebar toggle & ghost-click immunity on #sidebar-backdrop while keeping #play-button unblocked', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 4a. #sidebar-toggle is bound to attachReliableTransportTap and exempted from generic passive Fast-Tap
  assert.ok(html.includes("'fullscreen-next-btn', 'sidebar-toggle'"), 'sidebar-toggle must use attachReliableTransportTap');
  assert.ok(html.includes('#playlist-import-m3u-btn, #sidebar-toggle, #play-button'), 'sidebar-toggle must be in isNativeControl');

  // 4b. Behavioral VM test: sidebar stays open when ghost click hits #sidebar-backdrop right after setSidebarOpen(true)
  const sbStart = html.indexOf('let sidebarOpenedAt = 0;');
  const sbEnd = html.indexOf("document.querySelectorAll('.source-btn').forEach", sbStart);
  assert.ok(sbStart > 0 && sbEnd > sbStart);

  let collapsed = true;
  const listeners = {};
  const makeEl = (id) => ({
    id,
    hidden: true,
    classList: {
      toggle(c, force) { if (id === 'body' && c === 'sidebar-collapsed') collapsed = Boolean(force); },
      contains(c) { return id === 'body' && c === 'sidebar-collapsed' ? collapsed : false; }
    },
    setAttribute() {},
    addEventListener(ev, fn) { listeners[id + ':' + ev] = fn; }
  });
  const bodyEl = makeEl('body');
  const els = {
    'sidebar-toggle': makeEl('sidebar-toggle'),
    'sidebar-toggle-icon': makeEl('sidebar-toggle-icon'),
    'sidebar-close': makeEl('sidebar-close'),
    'sidebar-backdrop': makeEl('sidebar-backdrop'),
    'sidebar': makeEl('sidebar')
  };
  const sbSandbox = {
    $: id => els[id] || null,
    safeOn: (el, ev, fn) => { if (el) el.addEventListener(ev, fn); },
    isMobileViewport: () => true,
    document: { body: bodyEl },
    window: { addEventListener() {} },
    Date, String, Boolean, setTimeout
  };
  vm.createContext(sbSandbox);
  vm.runInContext(html.slice(sbStart, sbEnd), sbSandbox);

  // Tap #sidebar-toggle -> opens sidebar
  listeners['sidebar-toggle:click']();
  assert.equal(collapsed, false, 'Tapping #sidebar-toggle must open sidebar');
  assert.equal(els['sidebar-backdrop'].hidden, false);

  // Ghost click hits #sidebar-backdrop 15ms later -> MUST be ignored (sidebar stays open!)
  listeners['sidebar-backdrop:click']();
  assert.equal(collapsed, false, 'Ghost click on #sidebar-backdrop within 350ms must NOT close newly opened sidebar');

  // 4c. Fast-Tap spatial coordinate dedup suppresses ghost click on newly opened overlay at same (x,y),
  // while still letting trusted clicks on #play-button or distant targets through
  const ftStart = html.indexOf('let touchStartPos = null;');
  const ftEnd = html.indexOf('const unlockAudioContextOnGesture = () => {', ftStart);
  assert.ok(ftStart > 0 && ftEnd > ftStart);
  const docEvents = {};
  const triggerBtn = {
    disabled: false, clicked: 0,
    click() { this.clicked++; },
    contains(t) { return t === this; },
    closest(sel) { return sel.includes('#play-button') ? null : this; }
  };
  const backdropEl = {
    contains(t) { return t === this; },
    closest() { return null; }
  };
  const playEl = {
    contains(t) { return t === this; },
    closest(sel) { return sel.includes('#play-button') ? this : null; }
  };
  const ftSandbox = { Date, Math, Boolean, document: { addEventListener(ev, fn) { docEvents[ev] = fn; } } };
  vm.createContext(ftSandbox);
  vm.runInContext(html.slice(ftStart, ftEnd), ftSandbox);

  docEvents.touchstart({ touches: [{ clientX: 30, clientY: 40 }], target: triggerBtn });
  docEvents.touchend({ changedTouches: [{ clientX: 31, clientY: 41 }], target: triggerBtn });
  assert.equal(triggerBtn.clicked, 1);

  let ghostBlocked = false;
  docEvents.click({ isTrusted: true, target: backdropEl, clientX: 31, clientY: 41, preventDefault() { ghostBlocked = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(ghostBlocked, true, 'Ghost click landing on newly appeared backdrop at same (x,y) must be suppressed');

  let playBlocked = false;
  docEvents.click({ isTrusted: true, target: playEl, clientX: 31, clientY: 41, preventDefault() { playBlocked = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(playBlocked, false, 'Transport button click must NEVER be blocked by Fast-Tap dedup');
});

test('5. Version consistency v3.9.54+ / versionCode >= 108', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const release = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[4-9]|[6-9]\d)';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[4-9]|[6-9]\d)';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)\b/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 108, 'versionCode must be >= 108');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[4-9]|[6-9]\d)"/);
  assert.match(java, /"3\.9\.(5[4-9]|[6-9]\d)"/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[4-9]|[6-9]\d)/);
  assert.match(release, /'v3\.9\.(5[4-9]|[6-9]\d)'/);
});
