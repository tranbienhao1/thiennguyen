'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. MainActivity.java distinguishes transient vs permanent AudioFocus loss for Bit-Perfect auto-resume & clears flag on manual controls', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('private volatile boolean mPausedByTransientFocusLoss = false;'), 'mPausedByTransientFocusLoss flag must exist');
  const afSlice = java.slice(java.indexOf('public boolean requestAudioFocus()'), java.indexOf('public void abandonAudioFocus()'));
  assert.match(afSlice, /case AudioManager\.AUDIOFOCUS_LOSS:\s+mHasAudioFocus = false;\s+mPausedByTransientFocusLoss = false;/, 'Permanent focus loss must clear transient flag');
  assert.match(afSlice, /case AudioManager\.AUDIOFOCUS_LOSS_TRANSIENT:[\s\S]*?mPausedByTransientFocusLoss = true;\s+mBitPerfectPlayer\.pause\(\);/, 'Transient loss must mark transient pause flag');
  assert.match(afSlice, /case AudioManager\.AUDIOFOCUS_GAIN:[\s\S]*?if \(mPausedByTransientFocusLoss && mBitPerfectPlayer\.isPaused\(\)\)[\s\S]*?mPausedByTransientFocusLoss = false;\s+mBitPerfectPlayer\.resume\(\);/, 'Regaining focus after transient loss must auto-resume');

  assert.ok(java.includes('public void dispatchPauseToWeb() {\n        mPausedByTransientFocusLoss = false;') || java.includes('public void dispatchPauseToWeb() {\r\n        mPausedByTransientFocusLoss = false;'));
  assert.ok(java.includes('public void stopBitPerfectPlayback() {\n        mPausedByTransientFocusLoss = false;') || java.includes('public void stopBitPerfectPlayback() {\r\n        mPausedByTransientFocusLoss = false;'));
});

test('2. Bit-Perfect & async Web/Cloud playback position persistence, resume seek & visibilitychange flush work accurately', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function getCurrentPlaybackPositionSeconds() {');
  const end = html.indexOf('const formatTime = seconds =>', start);
  assert.ok(start > 0 && end > start, 'playback session helpers must be extractable');

  const lsStore = {};
  const seekCalls = [];
  const listeners = {};
  const audioEl = {
    src: 'blob:web-audio',
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 240,
    readyState: 0,
    volume: 0.85,
    pause() { audioEl.paused = true; },
    addEventListener(type, fn) { listeners[type] = fn; }
  };

  const sandbox = {
    window: {
      location: { href: 'https://nocturne.local/' },
      NocturneNative: {
        getBitPerfectPosition: () => 123450,
        seekBitPerfectPlayback: (ms) => seekCalls.push(ms),
        pauseBitPerfectPlayback: () => {}
      }
    },
    state: {
      currentId: 'fiio_bp_1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lastBitPerfectPositionSec: 120,
      lastSessionSaveTime: 0,
      queueTrackIds: ['fiio_bp_2'],
      tracks: [{ id: 'fiio_bp_1', title: 'DSD Track', duration: 300 }]
    },
    audio: audioEl,
    standbyAudio: {},
    library: lib,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
      setItem: (k, v) => { lsStore[k] = String(v); },
      removeItem: (k) => { delete lsStore[k]; }
    },
    $: () => ({ addEventListener: () => {} }),
    safeOn: () => {},
    location: { protocol: 'https:', href: 'https://nocturne.local/' },
    trackById: (id) => sandbox.state.tracks.find(t => t.id === id) || null,
    playTrack: async () => {},
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
    toast: () => {},
    Number,
    Math,
    Date,
    Boolean,
    JSON,
    URL,
    console
  };

  vm.runInNewContext(html.slice(start, end) + '\nthis.isAppPlaying = isAppPlaying;', sandbox);

  // Bit-Perfect active while HTML <audio> is paused at 0s
  assert.equal(sandbox.isAppPlaying(), true, 'isAppPlaying must detect active Bit-Perfect playback');
  sandbox.window.savePlaybackSession(true);
  const savedBp = JSON.parse(lsStore['nocturne-playback-session']);
  assert.equal(savedBp.currentTime, 123.45, 'Bit-Perfect millisecond position must persist in seconds');
  assert.equal(savedBp.wasPlaying, true, 'wasPlaying must reflect active Bit-Perfect state');

  assert.equal(sandbox.window.seekCurrentPlaybackToSeconds(123.45, 'fiio_bp_1'), true);
  assert.deepEqual(seekCalls, [123450], 'Bit-Perfect resume seek must call seekBitPerfectPlayback in ms');

  // Web/Cloud deferred loadedmetadata seek when readyState === 0
  sandbox.state.isNativeBitPerfectPlaying = false;
  sandbox.state.currentId = 'web_cloud_1';
  audioEl.readyState = 0;
  audioEl.currentTime = 0;
  sandbox.window.seekCurrentPlaybackToSeconds(42.5, 'web_cloud_1');
  assert.equal(audioEl.currentTime, 0, 'Must wait for loadedmetadata when readyState === 0');
  assert.equal(typeof listeners.loadedmetadata, 'function', 'loadedmetadata listener must be attached');
  listeners.loadedmetadata();
  assert.equal(audioEl.currentTime, 42.5, 'Deferred loadedmetadata callback must apply exact resume position');

  // Fullscreen play button sync on Bit-Perfect state changes + visibilitychange save
  assert.ok(html.includes("if ($('fullscreen-play-btn')) $('fullscreen-play-btn').textContent = symbol;"));
  const visSlice = html.slice(html.indexOf("document.addEventListener('visibilitychange'"), html.indexOf("async function clearAudioSliceCacheAndMemory()"));
  assert.ok(visSlice.includes('savePlaybackSession(true)'), 'visibilitychange hidden must flush playback session');
});

test('3. window.onAndroidBackPressed closes open Lyrics Editor & Lyrics Search modals before exiting app', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('window.onAndroidBackPressed = function() {');
  const end = html.indexOf('// Tap-outside listener', start);
  assert.ok(start > 0 && end > start);

  let editorClosed = 0;
  let searchClosed = 0;
  const dom = {
    'lyrics-editor-modal': { hidden: true, classList: { contains: () => true, add() {} } },
    'lyrics-search-modal': { hidden: true, classList: { contains: () => true, add() {} } }
  };

  const sandbox = {
    window: {
      LyricsEditorUI: {
        editorState: { isOpen: false },
        searchState: { isOpen: false },
        closeEditor() { sandbox.window.LyricsEditorUI.editorState.isOpen = false; editorClosed++; },
        closeSearch() { sandbox.window.LyricsEditorUI.searchState.isOpen = false; searchClosed++; }
      }
    },
    state: {},
    document: { getElementById: (id) => dom[id] || null },
    $: (id) => dom[id] || { hidden: true, classList: { contains: () => true, add() {} } }
  };

  vm.runInNewContext(html.slice(start, end), sandbox);

  sandbox.window.LyricsEditorUI.editorState.isOpen = true;
  assert.equal(sandbox.window.onAndroidBackPressed(), true, 'Back must consume event when Lyrics Editor is open');
  assert.equal(editorClosed, 1);

  sandbox.window.LyricsEditorUI.searchState.isOpen = true;
  assert.equal(sandbox.window.onAndroidBackPressed(), true, 'Back must consume event when Lyrics Search is open');
  assert.equal(searchClosed, 1);

  assert.equal(sandbox.window.onAndroidBackPressed(), false, 'Back should return false when no modal/collection is active');
});

test('4. Version sync v3.9.38+ / versionCode >= 92, Unix LF parity & zero Chromium 74 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.match(indexHtml, /FiiO M11S · v3\.9\.(3[89]|[4-9]\d|\d{3,})/);
  assert.match(swJs, /const CACHE_VERSION = 'v3\.9\.(3[89]|[4-9]\d|\d{3,})';/);
  assert.match(swJs, /const CACHE_NAME = 'nocturne-v3\.9\.(3[89]|[4-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 92, 'versionCode must be >= 92');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(3[89]|[4-9]\d|\d{3,})"/);
  assert.match(mainActivity, /"3\.9\.(3[89]|[4-9]\d|\d{3,})"/);

  assert.ok(!fs.readFileSync(path.join(ROOT, '404.html')).includes(13), '404.html must have 0 CR bytes');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'), indexHtml, '404.html must equal index.html');

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const rel of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets', rel));
    assert.ok(!assetBuf.includes(13), `${rel} in android assets must have 0 CR bytes`);
  }
  const filesToScan = syncedFiles.filter(f => f !== 'tailwind.min.css');
  for (const rel of filesToScan) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.ok(!/[^\w$]\?\.\w|\?\.\[|\?\.\(/.test(stripped), `${rel} must not use optional chaining (?.)`);
    assert.ok(!/\?\?[^=]/.test(stripped), `${rel} must not use nullish coalescing (??)`);
    assert.ok(!/\.replaceAll\s*\(/.test(stripped), `${rel} must not use .replaceAll()`);
    assert.ok(!/\bcatch\s*\{/.test(stripped), `${rel} must not use bare catch {}`);
  }
});
