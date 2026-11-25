'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const library = require('../library-utils.js');

const ROOT = path.resolve(__dirname, '..');

function makeElementStub() {
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    src: '',
    value: '',
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    removeAttribute() {},
    setAttribute() {}
  };
}

test('1. displayTrack computes dynamic isNotifPlaying (false when paused, true when playing/loading)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function displayTrack(track) {');
  const end = html.indexOf('function syncCanvasDimensions(', start);
  assert.ok(start > 0 && end > start, 'displayTrack slice must be extractable');
  const displayTrackSrc = html.slice(start, end);

  const notifCalls = [];
  const fakeDeck = { paused: true, src: '' };
  const elements = {};
  const sandbox = {
    state: {
      currentId: 't1',
      tracks: [{ id: 't1', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', source: 'fiio', format: 'FLAC', cover: 'cover.jpg', duration: 200 }],
      albumCovers: new Map(),
      zones: [],
      roonZones: [],
      activeZoneId: null,
      bitPerfectEnabled: false,
      stereoBalance: 0,
      crossfeed: 0,
      dsdOutputRate: 88200,
      dsdOutputDepth: 24,
      context: { sampleRate: 48000 },
      isPlaybackLoading: false,
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: true,
      activeDeck: { element: fakeDeck }
    },
    audio: fakeDeck,
    library,
    localStorage: { getItem: () => null },
    $: (id) => (elements[id] ||= makeElementStub()),
    sourceLabel: () => 'FiiO',
    signalDescription: () => ({ title: 'Track 1', artist: 'Artist 1', album: 'Album 1', sourceName: 'FiiO' }),
    quality: () => ({ label: 'FLAC', tone: 'text-zinc-300' }),
    escapeHtml: (s) => String(s || ''),
    formatTime: (s) => `${Math.round(s || 0)}s`,
    formatRemainingTime: () => '-0:00',
    paintSeek: () => {},
    updateMediaSession: () => {},
    renderRoomSignal: () => {},
    isFavorite: () => false,
    updateRoomRating: () => {},
    updateListeningRoomAnnotations: () => {},
    updateMiniPlayerHud: () => {},
    renderQueueCurrent: () => {},
    syncAutoplayButton: () => {},
    updateSleepStatus: () => {},
    renderLyrics: () => {},
    scheduleTrackRender: () => {},
    renderRecentTracks: () => {},
    updateCurrentTrackIndicator: () => {},
    applyReplayGain: () => {},
    generateTrackWaveform: () => {},
    renderSignalPathPopover: () => {},
    sendListenBrainzScrobble: () => {},
    renderRoonFullscreen: () => {},
    updateRoonFullscreenUI: () => {},
    applyAmbientGlow: () => {},
    syncFullscreenPlayBtnState: () => {},
    document: { body: { classList: { contains: () => false } } },
    window: {
      NocturneNative: {
        updateMediaNotification: (title, artist, album, isPlaying) => {
          notifCalls.push({ title, artist, album, isPlaying });
        }
      }
    },
    Date,
    Number,
    Boolean,
    String,
    console
  };
  vm.runInNewContext(displayTrackSrc + '\nthis.displayTrack = displayTrack;', sandbox);

  const tr = sandbox.state.tracks[0];

  // Paused Web Audio & not loading -> isPlaying MUST be false
  sandbox.displayTrack(tr);
  assert.equal(notifCalls[0].isPlaying, false, 'Paused displayTrack must pass isPlaying=false');

  // Native Bit-Perfect paused -> isPlaying MUST be false
  sandbox.state.isNativeBitPerfectPlaying = true;
  sandbox.state.isNativeBitPerfectPaused = true;
  sandbox.displayTrack(tr);
  assert.equal(notifCalls[1].isPlaying, false, 'Paused Bit-Perfect displayTrack must pass isPlaying=false');

  // Native Bit-Perfect actively playing -> isPlaying MUST be true
  sandbox.state.isNativeBitPerfectPaused = false;
  sandbox.displayTrack(tr);
  assert.equal(notifCalls[2].isPlaying, true, 'Active Bit-Perfect displayTrack must pass isPlaying=true');

  // Loading -> isPlaying MUST be true
  sandbox.state.isNativeBitPerfectPlaying = false;
  sandbox.state.isNativeBitPerfectPaused = true;
  sandbox.state.isPlaybackLoading = true;
  sandbox.displayTrack(tr);
  assert.equal(notifCalls[3].isPlaying, true, 'Loading displayTrack must pass isPlaying=true');
});

test('2. updateMediaSession and updatePositionState reflect Native Bit-Perfect state & position', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function updateMediaSession(track) {');
  const end = html.indexOf('let isUserScrolling = false;', start);
  assert.ok(start > 0 && end > start);
  const src = html.slice(start, end);

  assert.ok(src.includes('library.resolveMediaSessionPositionState'), 'Must retain library.resolveMediaSessionPositionState');

  let lastPosState = null;
  const fakeTrack = { id: 'bp1', title: 'DSD Hi-Res', artist: 'Soloist', album: 'Masterpiece', duration: 240 };
  const pausedHtmlAudio = { duration: NaN, currentTime: 0, playbackRate: 1, paused: true };
  const sandbox = {
    state: {
      currentId: 'bp1',
      tracks: [fakeTrack],
      activeDeck: { element: pausedHtmlAudio },
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lastBitPerfectPositionSec: 84
    },
    audio: pausedHtmlAudio,
    trackById: (id) => (id === 'bp1' ? fakeTrack : null),
    library,
    getCurrentPlaybackDurationSeconds: () => 240,
    getCurrentPlaybackPositionSeconds: () => 84,
    window: { location: { href: 'https://nocturne.local/' } },
    MediaMetadata: function MediaMetadata(o) { return o; },
    navigator: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setPositionState: (p) => { lastPosState = p; }
      }
    },
    performance: { now: () => 5000 },
    URL,
    Boolean,
    Number,
    console
  };
  vm.runInNewContext(src + '\nthis.updateMediaSession = updateMediaSession; this.updatePositionState = updatePositionState;', sandbox);

  sandbox.updateMediaSession(fakeTrack);
  assert.equal(sandbox.navigator.mediaSession.playbackState, 'playing', 'Bit-Perfect active must set mediaSession.playbackState = playing');
  assert.deepEqual(lastPosState, { duration: 240, playbackRate: 1, position: 84 }, 'updatePositionState must report Bit-Perfect duration & position');

  sandbox.state.isNativeBitPerfectPaused = true;
  sandbox.updateMediaSession(fakeTrack);
  assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused', 'Bit-Perfect paused must set mediaSession.playbackState = paused');
});

test('3. playNext Repeat-One & Previous (>3s) work identically in Native Bit-Perfect and CUE sub-tracks', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function playNext(direction = 1, auto = false) {');
  const end = html.indexOf('async function pickLocalFiles', start);
  assert.ok(start > 0 && end > start);
  const playNextSrc = html.slice(start, end);

  const bpSeeks = [];
  const playedIds = [];
  let htmlPlayCalls = 0;
  let waveformRefreshes = 0;
  let posStateRefreshes = 0;
  const syncSeekValues = [];
  let unifiedPos = 0;

  const fakeAudio = { currentTime: 0, pause() {}, play: () => { htmlPlayCalls++; return Promise.resolve(); } };
  const sandbox = {
    state: {
      tracks: [
        { id: 'c1', cueStart: 0, duration: 100 },
        { id: 'c2', cueStart: 100, duration: 150 },
        { id: 'bp1', duration: 200 }
      ],
      currentId: 'bp1',
      autoplay: true,
      repeat: 2,
      bitPerfectEnabled: true,
      isNativeBitPerfectPlaying: false,
      sleepAtTrackEnd: false,
      lastBitPerfectPositionSec: 0,
      preloadTrackId: null,
      dsdWorker: null,
      dsdUrl: null,
      activeFocus: 'all',
      playbackContext: null
    },
    audio: fakeAudio,
    standbyAudio: { paused: true, pause() {} },
    window: { NocturneNative: { seekBitPerfectPlayback: (ms) => bpSeeks.push(ms) } },
    getCurrentPlaybackPositionSeconds: () => unifiedPos,
    queueTracks: () => [],
    stopDsdWorker: () => {},
    clearSleepTimer: () => {},
    toast: () => {},
    syncSeek: (v) => syncSeekValues.push(v),
    renderWaveformSeekbar: () => { waveformRefreshes++; },
    updatePositionState: () => { posStateRefreshes++; },
    playTrack: (id) => playedIds.push(id),
    trackById: (id) => sandbox.state.tracks.find(t => t.id === id) || null
  };
  vm.runInNewContext(playNextSrc, sandbox);

  // 3a. Native Bit-Perfect Repeat-One restarts via playTrack(currentId), NOT empty audio.play()
  sandbox.playNext(1, true);
  assert.deepEqual(playedIds, ['bp1']);
  assert.equal(htmlPlayCalls, 0);

  // 3b. Web Audio CUE sub-track Repeat-One restarts at cueStart (100), not 0
  sandbox.state.bitPerfectEnabled = false;
  sandbox.state.currentId = 'c2';
  fakeAudio.currentTime = 249;
  sandbox.playNext(1, true);
  assert.equal(fakeAudio.currentTime, 100);
  assert.equal(htmlPlayCalls, 1);

  // 3c. CUE sub-track Previous within first 3s of sub-track (101.5s vs cueStart 100s = 1.5s) goes to previous track c1
  unifiedPos = 101.5;
  sandbox.state.currentId = 'c2';
  playedIds.length = 0;
  sandbox.playNext(-1, false);
  assert.deepEqual(playedIds, ['c1'], 'Previous within first 3s of CUE sub-track must go to previous track');

  // 3d. Native Bit-Perfect CUE sub-track Previous > 3s (105s vs cueStart 100s = 5s) seeks to cueStart*1000 and syncs UI
  unifiedPos = 105;
  sandbox.state.currentId = 'c2';
  sandbox.state.isNativeBitPerfectPlaying = true;
  bpSeeks.length = 0;
  sandbox.playNext(-1, false);
  assert.deepEqual(bpSeeks, [100000]);
  assert.equal(sandbox.state.lastBitPerfectPositionSec, 100);
  assert.equal(waveformRefreshes, 1);
  assert.equal(posStateRefreshes, 1);
  assert.deepEqual(syncSeekValues, [0]);
});

test('4. BitPerfectAudioPlayer.seek (paused sync) & onHardwareSeekOffset/onHardwareSeekTo CUE parity', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const seekIdx = java.indexOf('public void seek(long positionMs)');
  const seekEnd = java.indexOf('public void setDucking(', seekIdx);
  assert.ok(seekIdx > 0 && seekEnd > seekIdx);
  const seekSrc = java.slice(seekIdx, seekEnd);

  assert.ok(seekSrc.includes('mCurrentPositionMs.set(clampedMs);'), 'seek must update mCurrentPositionMs immediately even when paused');
  assert.ok(seekSrc.includes('updateMediaSessionMetadata('), 'seek must immediately refresh MediaSession PlaybackState');
  assert.ok(seekSrc.includes('window.onNativeBitPerfectPosition'), 'seek must immediately post onNativeBitPerfectPosition to WebView');

  // Test window.onHardwareSeekOffset & window.onHardwareSeekTo in VM
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hwStart = html.indexOf('window.onHardwareSeekOffset = (deltaSeconds) => {');
  const hwEnd = html.indexOf('const openListeningRoom = (preferredMode) => {', hwStart);
  assert.ok(hwStart > 0 && hwEnd > hwStart);
  const hwSrc = html.slice(hwStart, hwEnd);

  const nativeSeeks = [];
  const syncVals = [];
  const timeTexts = [];
  let smartSeeks = [];
  let wfDraws = 0;
  let posDraws = 0;
  const deckEl = { currentTime: 110, duration: 500 };
  const cueTrack = { id: 'c2', cueStart: 100, duration: 80 };
  const elements = { 'current-time': { set textContent(v) { timeTexts.push(v); } } };

  const sandbox = {
    state: {
      currentId: 'c2',
      tracks: [cueTrack],
      activeDeck: { element: deckEl },
      isNativeBitPerfectPlaying: true,
      lastBitPerfectPositionSec: 110
    },
    audio: deckEl,
    $: (id) => elements[id] || null,
    getCurrentPlaybackDurationSeconds: () => 500,
    getCurrentPlaybackPositionSeconds: () => sandbox.state.lastBitPerfectPositionSec,
    applySmartSeekTime: (el, tr, sec) => { smartSeeks.push(sec); el.currentTime = sec; },
    syncSeek: (v) => syncVals.push(Math.round(v)),
    formatTime: (s) => `${Math.round(s)}s`,
    renderWaveformSeekbar: () => { wfDraws++; },
    updatePositionState: () => { posDraws++; },
    window: { NocturneNative: { seekBitPerfectPlayback: (ms) => nativeSeeks.push(ms) } }
  };
  vm.runInNewContext(hwSrc, sandbox);

  // Bit-Perfect CUE offset forward 10s (from 110s -> 120s)
  sandbox.window.onHardwareSeekOffset(10);
  assert.equal(nativeSeeks[0], 120000);
  assert.equal(sandbox.state.lastBitPerfectPositionSec, 120);
  assert.equal(syncVals[0], 250); // (20/80)*1000
  assert.equal(timeTexts[0], '20s');

  // Web Audio CUE seek-to 30s (abs 130s) uses applySmartSeekTime
  sandbox.state.isNativeBitPerfectPlaying = false;
  sandbox.window.onHardwareSeekTo(30000);
  assert.deepEqual(smartSeeks, [130]);
  assert.equal(wfDraws, 2);
  assert.equal(posDraws, 2);
});

test('5. DSD playback handlers sync all transport surfaces via syncPlaybackButtonsUi', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dsdStart = html.indexOf('function stopDsdWorker(invalidate = true) {');
  const dsdEnd = html.indexOf('function playNext(', dsdStart);
  assert.ok(dsdStart > 0 && dsdEnd > dsdStart);
  const dsdSrc = html.slice(dsdStart, dsdEnd);

  assert.ok(dsdSrc.includes("syncPlaybackButtonsUi(true)"), 'DSD playback start/resume must sync all 4 buttons true');
  assert.ok(dsdSrc.includes("syncPlaybackButtonsUi(false)"), 'DSD stop/error/pause must sync all 4 buttons false');

  const stopStart = html.indexOf('function stopDsdWorker(invalidate = true) {');
  const stopEnd = html.indexOf('async function playDsdFirstSlice(', stopStart);
  const stopSrc = html.slice(stopStart, stopEnd);
  const uiStates = [];
  const playBtn = { textContent: 'Ⅱ' };
  const stopSandbox = {
    state: { dsdWorker: null, dsdUrl: 'blob:dsd', dsdBlob: {}, dsdTrackId: 'd1', objectUrls: new Set(['blob:dsd']), tracks: [{ id: 'd1', url: 'blob:dsd', fullAudioPromise: null, firstSlicePlayback: true }], playGeneration: 1, isNativeBitPerfectPlaying: false },
    audio: { src: 'blob:dsd', paused: true, pause() {}, removeAttribute() {}, load() {} },
    standbyAudio: { src: '', paused: true, pause() {}, removeAttribute() {}, load() {} },
    $: () => playBtn,
    syncPlaybackButtonsUi: (playing) => uiStates.push(playing),
    clearOptimisticLoadingUi: () => {},
    URL: { revokeObjectURL() {} }
  };
  vm.runInNewContext(stopSrc, stopSandbox);
  stopSandbox.stopDsdWorker(true);
  assert.equal(playBtn.textContent, '▶');
  assert.deepEqual(uiStates, [false]);
});

test('6. Version sync v3.9.41+ / versionCode >= 95, 0 CR bytes in assets & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.match(indexHtml, /FiiO M11S · v3\.9\.(4[1-9]|[5-9]\d|\d{3,})/);
  assert.match(swJs, /const CACHE_VERSION = 'v3\.9\.(4[1-9]|[5-9]\d|\d{3,})';/);
  assert.match(swJs, /const CACHE_NAME = 'nocturne-v3\.9\.(4[1-9]|[5-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)\b/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 95, 'versionCode must be >= 95');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(4[1-9]|[5-9]\d|\d{3,})"/);
  assert.match(mainActivity, /"3\.9\.(4[1-9]|[5-9]\d|\d{3,})"/);
  assert.match(publishRelease, /'v3\.9\.(4[1-9]|[5-9]\d|\d{3,})'/);

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
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
