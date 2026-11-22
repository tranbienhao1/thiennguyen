'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradleKts = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainActivityJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

test('v3.9.80+ version synchronization across sw.js, index.html, and build.gradle.kts (versionCode >= 134)', () => {
  const swMatch = swJs.match(/const CACHE_VERSION = 'v3\.9\.(\d+)';/);
  assert.ok(swMatch && Number(swMatch[1]) >= 80);
  const nameMatch = swJs.match(/const CACHE_NAME = 'nocturne-v3\.9\.(\d+)';/);
  assert.ok(nameMatch && Number(nameMatch[1]) >= 80);
  assert.ok(indexHtml.includes('FiiO M11S · v3.9.' + swMatch[1]), 'FiiO badge should match CACHE_VERSION');
  const codeMatch = gradleKts.match(/versionCode = (\d+)\b/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 134);
  assert.ok(gradleKts.includes('versionName = "3.9.' + swMatch[1] + '"'));
});

test('v3.9.80 pausing during upgradeSliceToFullAudio (deck._upgradingFullAudio while deck.paused=true from deck.load()) pauses instead of calling play() and blocks loadedmetadata auto-resume', async () => {
  // 1. Extract upgradeSliceToFullAudio and play-button click handler
  const upStart = indexHtml.indexOf('async function upgradeSliceToFullAudio(');
  const upEnd = indexHtml.indexOf('async function fetchCloudTrack(', upStart);
  assert.ok(upStart > 0 && upEnd > upStart);
  const upgradeSrc = indexHtml.slice(upStart, upEnd);

  const pbStart = indexHtml.indexOf('function handleNativeBitPerfectPlayPauseClick()');
  const pbEnd = indexHtml.indexOf("$('previous-button').addEventListener('click'", pbStart);
  assert.ok(pbStart > 0 && pbEnd > pbStart);
  const playBtnSrc = indexHtml.slice(pbStart, pbEnd);

  let playButtonClick = null;
  const deckHandlers = {};
  let playCalls = 0;
  let pauseCalls = 0;

  const btns = {
    'play-button': {
      textContent: 'Ⅱ',
      classList: { remove() {}, add() {} },
      setAttribute() {},
      addEventListener(type, fn) {
        if (type === 'click') playButtonClick = fn;
      }
    }
  };

  const deck = {
    src: 'blob:slice-1',
    currentTime: 3.2,
    duration: 210,
    paused: false,
    ended: false,
    error: null,
    muted: false,
    defaultMuted: false,
    dataset: { trackId: 'cloud_1' },
    _upgradingFullAudio: false,
    _userPausedDuringUpgrade: false,
    addEventListener(ev, fn) { (deckHandlers[ev] = deckHandlers[ev] || []).push(fn); },
    removeAttribute() {},
    load() {
      // Real HTML5 <audio>.load() immediately sets paused = true while metadata parses
      this.paused = true;
    },
    pause() {
      pauseCalls++;
      this.paused = true;
    },
    play() {
      playCalls++;
      this.paused = false;
      return Promise.resolve();
    }
  };

  const track = {
    id: 'cloud_1',
    source: 'google',
    name: 'Song.flac',
    title: 'Song',
    format: 'FLAC',
    url: 'blob:slice-1',
    firstSlicePlayback: true
  };

  const sandbox = {
    Date,
    Promise,
    Number,
    String,
    Boolean,
    Math,
    Object,
    URL,
    Blob,
    console,
    setTimeout,
    clearTimeout,
    performance: { now: () => 2000 },
    location: { href: 'https://nocturne.local/' },
    window: { NocturneNative: null },
    $: (id) => btns[id] || null,
    state: {
      currentId: 'cloud_1',
      tracks: [track],
      objectUrls: new Set(['blob:slice-1']),
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      isPlaybackLoading: false,
      playGeneration: 1,
      activeDeck: { element: deck, router: { gain: { value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} } } },
      context: { currentTime: 10, state: 'running', resume: () => Promise.resolve() },
      corsBypassAudio: null,
      dsdWorker: null
    },
    audio: deck,
    standbyAudio: { src: '', paused: true, pause() {} },
    library: {
      fetchAudioBlob: async () => new Blob(['full-flac-bytes'], { type: 'audio/flac' }),
      normalizeAudioBlob: (b) => b
    },
    isGraphContentUrl: () => false,
    finishCloudMetadataInBackground: () => {},
    releaseTrackUrl: () => {},
    formatTime: (s) => String(Math.round(s)),
    syncSeek: () => {},
    updatePositionState: () => {},
    clearOptimisticLoadingUi: () => {},
    setupAudio: () => {},
    isSilentUnlockSrc: () => false,
    playTrack: () => {},
    setPlaybackLoading: (v) => { sandbox.state.isPlaybackLoading = Boolean(v); },
    syncPlaybackButtonsUi: (playing) => { btns['play-button'].textContent = playing ? 'Ⅱ' : '▶'; },
    stopDsdWorker: () => {},
    toast: () => {},
    mediaErrorMessage: (e) => String(e)
  };

  vm.createContext(sandbox);
  vm.runInContext(upgradeSrc + '\n' + playBtnSrc + '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;', sandbox);

  // Start slice -> full audio upgrade while playing
  await sandbox.upgradeSliceToFullAudio(track, 'blob:slice-1', 'https://drive.example/file', {}, 'Google Drive');
  assert.equal(deck._upgradingFullAudio, true, 'Deck must mark _upgradingFullAudio during full-file swap');
  assert.equal(deck.paused, true, 'Browser deck.load() sets deck.paused = true while waiting for loadedmetadata');

  // User clicks #play-button (showing Ⅱ) during the _upgradingFullAudio window to PAUSE!
  await playButtonClick();
  assert.equal(playCalls, 0, 'Clicking Pause during _upgradingFullAudio must NEVER call deck.play()');
  assert.equal(deck._userPausedDuringUpgrade, true, 'Must record _userPausedDuringUpgrade so loadedmetadata stays paused');
  assert.equal(deck._upgradingFullAudio, false, 'Must clear _upgradingFullAudio on explicit user pause');
  assert.equal(btns['play-button'].textContent, '▶', 'Button must switch to ▶ immediately');

  // Now loadedmetadata fires 100ms later
  for (const fn of deckHandlers.loadedmetadata || []) fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(playCalls, 0, 'loadedmetadata must NOT auto-play when user paused during upgrade');
  assert.equal(deck._userPausedDuringUpgrade, false, 'Flag must be consumed cleanly by loadedmetadata');
  assert.equal(btns['play-button'].textContent, '▶', 'Button must remain ▶');
});

test('v3.9.80 #play-button honors Pause when displaying Ⅱ even if AudioContext is suspended, splits DSD active-slice pause from worker cancel, and preserves mismatched trackId on mid-load pause', async () => {
  const pbStart = indexHtml.indexOf('function handleNativeBitPerfectPlayPauseClick()');
  const pbEnd = indexHtml.indexOf("$('previous-button').addEventListener('click'", pbStart);
  const playBtnSrc = indexHtml.slice(pbStart, pbEnd);

  let playButtonClick = null;
  let playTrackCalls = [];
  let workerTerminated = 0;

  const btns = {
    'play-button': {
      textContent: 'Ⅱ',
      addEventListener(type, fn) {
        if (type === 'click') playButtonClick = fn;
      }
    }
  };

  const sandbox = {
    Date,
    Promise,
    Number,
    String,
    Boolean,
    Math,
    URL,
    console,
    setTimeout,
    clearTimeout,
    location: { href: 'https://nocturne.local/' },
    window: { NocturneNative: null },
    $: (id) => btns[id] || null,
    state: {
      currentId: 't1',
      tracks: [{ id: 't1', title: 'Track 1' }, { id: 't2', title: 'Track 2' }],
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      isPlaybackLoading: false,
      playGeneration: 5,
      context: {
        state: 'suspended',
        currentTime: 10,
        resume() { this.state = 'running'; return Promise.resolve(); }
      },
      activeDeck: null,
      corsBypassAudio: null,
      dsdWorker: null,
      dsdUrl: null
    },
    audio: {
      src: 'blob:t1-audio',
      paused: false,
      ended: false,
      error: null,
      muted: false,
      defaultMuted: false,
      currentTime: 18,
      dataset: { trackId: 't1' },
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      removeAttribute() {}
    },
    standbyAudio: { src: '', paused: true, pause() {} },
    setupAudio: () => {},
    isSilentUnlockSrc: () => false,
    playTrack: (id) => { playTrackCalls.push(id); },
    setPlaybackLoading: (v) => { sandbox.state.isPlaybackLoading = Boolean(v); },
    clearOptimisticLoadingUi: () => {},
    syncPlaybackButtonsUi: (playing) => { btns['play-button'].textContent = playing ? 'Ⅱ' : '▶'; },
    stopDsdWorker: () => {},
    toast: () => {},
    mediaErrorMessage: (e) => String(e)
  };

  vm.createContext(sandbox);
  vm.runInContext(playBtnSrc, sandbox);

  // 1. Button shows 'Ⅱ', audio is playing (!audio.paused), but state.context.state === 'suspended':
  // Clicking #play-button MUST pause audio (not resume context and keep playing!)
  await playButtonClick();
  assert.equal(sandbox.audio.paused, true, 'Clicking Ⅱ must pause audio even when AudioContext was suspended');
  assert.equal(btns['play-button'].textContent, '▶');

  // 2. DSD track whose first slice is already playing while state.dsdWorker decodes full DSD in background:
  // Clicking #play-button MUST pause audio WITHOUT killing state.dsdWorker!
  sandbox.audio.paused = false;
  sandbox.audio.src = 'blob:dsd-first-slice';
  sandbox.state.dsdUrl = 'blob:dsd-first-slice';
  sandbox.state.dsdWorker = {
    postMessage() {},
    terminate() { workerTerminated++; }
  };
  btns['play-button'].textContent = 'Ⅱ';

  await playButtonClick();
  assert.equal(sandbox.audio.paused, true, 'Must pause DSD first-slice audio');
  assert.equal(workerTerminated, 0, 'Must NOT terminate background dsdWorker when pausing active DSD slice');
  assert.ok(sandbox.state.dsdWorker, 'state.dsdWorker must remain active in background');

  // 3. Mid-load pause while Track 1 is still on audio.dataset.trackId and Track 2 is loading (state.currentId = 't2'):
  // Pausing must NOT overwrite audio.dataset.trackId with 't2', so subsequent Play calls playTrack('t2')!
  sandbox.state.dsdWorker = null;
  sandbox.state.dsdUrl = null;
  sandbox.state.currentId = 't2';
  sandbox.state.isPlaybackLoading = true;
  sandbox.audio.paused = false;
  sandbox.audio.src = 'blob:t1-audio';
  sandbox.audio.dataset.trackId = 't1';
  btns['play-button'].textContent = '…';

  await playButtonClick();
  assert.equal(sandbox.audio.paused, true, 'Old track audio must pause');
  assert.equal(sandbox.state.isPlaybackLoading, false, 'In-flight load must be cancelled');
  assert.equal(sandbox.audio.dataset.trackId, 't1', 'Must NOT stamp t2 onto audio.dataset.trackId when audio still holds t1 src');

  // Clicking Play now detects mismatched trackId ('t1' !== 't2') and starts playTrack('t2')!
  await playButtonClick();
  assert.deepEqual(playTrackCalls, ['t2'], 'Resuming after mid-load cancel must load Track 2 instead of playing Track 1 audio');
});

test('v3.9.80 clearOptimisticLoadingUi detects standbyAudio playing before finishPlaybackStart and MainActivity debounces duplicate hardware media keys', () => {
  const clearStart = indexHtml.indexOf('function clearOptimisticLoadingUi()');
  assert.ok(clearStart > 0);
  const clearBlock = indexHtml.slice(clearStart, clearStart + 1400);
  assert.ok(
    clearBlock.includes('standbyAudio && (!standbyAudio.paused || standbyAudio._upgradingFullAudio)'),
    'clearOptimisticLoadingUi must treat playing standbyAudio as playing so button becomes Ⅱ instead of ▶'
  );

  // MainActivity.java hardware media key 180ms debounce & onMediaButtonEvent ACTION_UP consumption
  assert.ok(
    mainActivityJava.includes('private volatile long mLastHardwareMediaKeyAtMs = 0L;') &&
    mainActivityJava.includes('if (keyCode == mLastHardwareMediaKeyCode && (nowKeyElapsed - mLastHardwareMediaKeyAtMs) < 180L)'),
    'MainActivity.handleMediaKey must debounce duplicate hardware key events within 180ms'
  );
  assert.ok(
    mainActivityJava.includes('if (ke != null && isMediaKey(ke.getKeyCode())) {\n                            if (ke.getAction() == KeyEvent.ACTION_DOWN && ke.getRepeatCount() == 0) {\n                                handleMediaKey(ke.getKeyCode());\n                            }\n                            return true;\n                        }'),
    'MediaSession.Callback.onMediaButtonEvent must consume both ACTION_DOWN and ACTION_UP for media keys'
  );
});
