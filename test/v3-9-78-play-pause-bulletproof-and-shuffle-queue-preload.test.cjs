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

test('v3.9.78 version synchronization across sw.js, index.html, and build.gradle.kts (versionCode 132)', () => {
  assert.match(swJs, /const CACHE_VERSION = 'v3\.9\.78';/);
  assert.match(swJs, /const CACHE_NAME = 'nocturne-v3\.9\.78';/);
  assert.ok(indexHtml.includes('FiiO M11S · v3.9.78'), 'FiiO badge should display v3.9.78');
  assert.match(gradleKts, /versionCode = 132\b/);
  assert.match(gradleKts, /versionName = "3\.9\.78"/);
});

test('v3.9.78 #play-button pauses active audio immediately even with mismatched dataset.trackId and cancels mid-load playback after 250ms', async () => {
  const startIdx = indexHtml.indexOf("function handleNativeBitPerfectPlayPauseClick()");
  const endIdx = indexHtml.indexOf("$('previous-button').addEventListener('click'", startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'Should locate play-button click handler block');
  const snippet = indexHtml.slice(startIdx, endIdx);

  let playButtonClickHandler = null;
  let playTrackCalls = [];
  let syncUiCalls = [];
  let setupAudioCalls = 0;

  const btns = {
    'play-button': {
      textContent: 'Ⅱ',
      addEventListener(type, fn) {
        if (type === 'click') playButtonClickHandler = fn;
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
    location: { href: 'https://appassets.androidplatform.net/assets/index.html' },
    window: {
      NocturneNative: null
    },
    $: (id) => btns[id] || null,
    state: {
      currentId: 'dsd_track_2',
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      isPlaybackLoading: false,
      playGeneration: 10,
      _lastPlayTrackId: 'dsd_track_2',
      _lastPlayTrackAt: 0,
      tracks: [
        { id: 'flac_track_1', title: 'Track 1' },
        { id: 'dsd_track_2', title: 'Track 2', isDsd: true }
      ],
      context: {
        state: 'running',
        currentTime: 5,
        resume: () => Promise.resolve()
      },
      activeDeck: null,
      corsBypassAudio: null,
      dsdWorker: null
    },
    audio: {
      src: 'blob:https://appassets.androidplatform.net/decoded-dsd-2',
      paused: false,
      ended: false,
      error: null,
      muted: false,
      defaultMuted: false,
      currentTime: 42.5,
      dataset: { trackId: 'flac_track_1' }, // Mismatched dataset.trackId from prior track
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      removeAttribute() {}
    },
    standbyAudio: {
      src: '',
      paused: true,
      muted: true,
      pause() { this.paused = true; }
    },
    setupAudio: () => { setupAudioCalls++; },
    isSilentUnlockSrc: () => false,
    playTrack: (id) => { playTrackCalls.push(id); },
    setPlaybackLoading: (flag) => { sandbox.state.isPlaybackLoading = Boolean(flag); },
    clearOptimisticLoadingUi: () => {},
    syncPlaybackButtonsUi: (playing) => {
      syncUiCalls.push(Boolean(playing));
      btns['play-button'].textContent = playing ? 'Ⅱ' : '▶';
    },
    stopDsdWorker: () => {},
    toast: () => {},
    mediaErrorMessage: (e) => String(e)
  };

  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  assert.equal(typeof playButtonClickHandler, 'function');

  // 1. Clicking #play-button while audio is actively playing (!audio.paused) with stale dataset.trackId MUST PAUSE, not call playTrack!
  await playButtonClickHandler();
  assert.equal(sandbox.audio.paused, true, 'Audio must pause immediately');
  assert.equal(playTrackCalls.length, 0, 'Must NOT restart playTrack when pausing active audio');
  assert.equal(sandbox.audio.dataset.trackId, 'dsd_track_2', 'Must sync dataset.trackId to currentId on pause');
  assert.equal(btns['play-button'].textContent, '▶');
  assert.equal(setupAudioCalls, 0, 'Must not call setupAudio when pausing');

  // 2. Clicking #play-button again while paused MUST resume from currentTime (42.5s), not restart playTrack!
  await playButtonClickHandler();
  assert.equal(sandbox.audio.paused, false, 'Audio must resume playing');
  assert.equal(sandbox.audio.currentTime, 42.5, 'Must preserve playback position on resume');
  assert.equal(playTrackCalls.length, 0, 'Must NOT call playTrack when resuming paused track');
  assert.equal(btns['play-button'].textContent, 'Ⅱ');

  // 3. Clicking #play-button mid-load (state.isPlaybackLoading === true after >250ms) MUST cancel loading and pause!
  sandbox.audio.paused = true;
  sandbox.audio.src = '';
  sandbox.state.isPlaybackLoading = true;
  sandbox.state._lastPlayTrackId = 'dsd_track_2';
  sandbox.state._lastPlayTrackAt = Date.now() - 400;
  let abortedFetch = false;
  sandbox.state.tracks[1]._dsdFetchAbort = { abort() { abortedFetch = true; } };
  const genBeforeCancel = sandbox.state.playGeneration;

  await playButtonClickHandler();
  assert.equal(sandbox.state.isPlaybackLoading, false, 'Should clear isPlaybackLoading on mid-load cancel');
  assert.equal(sandbox.state.playGeneration, genBeforeCancel + 1, 'Should bump playGeneration to cancel in-flight load');
  assert.equal(abortedFetch, true, 'Should abort in-flight DSD fetch');
  assert.equal(playTrackCalls.length, 0, 'Should NOT restart playTrack when user cancels in-flight load');
  assert.equal(btns['play-button'].textContent, '▶');
});

test('v3.9.78 resolveEventElement and document capture click listener never swallow transport clicks on Text node children', () => {
  const startIdx = indexHtml.indexOf('let lastFastTapPos = null;');
  const endIdx = indexHtml.indexOf("document.addEventListener('pointerdown', unlockAudioContextOnGesture", startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'Should locate fast-tap & unlockAudioContextOnGesture block');
  const snippet = indexHtml.slice(startIdx, endIdx);

  const docListeners = {};
  const sandbox = {
    Date,
    Math,
    Boolean,
    touchStartPos: null,
    touchStartTime: 0,
    touchStartTarget: null,
    lastFastTapClickTs: Date.now(), // Just tapped a track row < 450ms ago!
    lastFastTapEl: { contains: () => false },
    lastFastTapPos: { x: 200, y: 700 },
    state: {
      isNativeBitPerfectPlaying: false,
      bitPerfectEnabled: true,
      currentId: 't1',
      tracks: [{ id: 't1', url: '/local-media?path=%2Fsdcard%2FMusic%2Fa.flac' }],
      context: {
        state: 'suspended',
        resumeCalled: 0,
        resume() { this.resumeCalled++; return Promise.resolve(); }
      }
    },
    window: {
      NocturneNative: {
        isBitPerfectSupported: () => true,
        isBitPerfectActive: () => false
      }
    },
    isTrackRoutedToNativeBitPerfect: () => true,
    document: {
      addEventListener(type, fn) {
        docListeners[type] = fn;
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(snippet + '\nthis.unlockAudioContextOnGesture = unlockAudioContextOnGesture;', sandbox);

  const playButtonEl = {
    nodeType: 1,
    closest(sel) {
      return sel.includes('#play-button') ? playButtonEl : null;
    }
  };
  const textNodeInsidePlayBtn = {
    nodeType: 3, // Text node ('▶' or 'Ⅱ') without .closest
    parentElement: playButtonEl
  };

  let stopped = false;
  docListeners.click({
    isTrusted: true,
    target: textNodeInsidePlayBtn,
    clientX: 202,
    clientY: 702,
    preventDefault() { stopped = true; },
    stopPropagation() { stopped = true; },
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(stopped, false, 'Document capture click listener must NEVER swallow a click on #play-button or its Text node child');

  // Also verify unlockAudioContextOnGesture does NOT resume WebView AudioContext when track routes to Native Bit-Perfect
  sandbox.unlockAudioContextOnGesture();
  assert.equal(sandbox.state.context.resumeCalled, 0, 'Must not resume WebView AudioContext when Native Bit-Perfect is enabled and routed');
});

test('v3.9.78 MainActivity AudioFocus guard, pause listener guard, DSD dataset.trackId assignment, and shuffle/queue preload re-sync', () => {
  // 1. MainActivity guards BitPerfectAudioPlayer against self-WebView AudioFocus steal within 1500ms of start/resume
  assert.ok(
    mainActivityJava.includes('private volatile long mLastBitPerfectStartOrResumeElapsedMs = 0L;'),
    'MainActivity should track mLastBitPerfectStartOrResumeElapsedMs'
  );
  assert.ok(
    mainActivityJava.includes('(android.os.SystemClock.elapsedRealtime() - mLastBitPerfectStartOrResumeElapsedMs) < 1500L'),
    'MainActivity AUDIOFOCUS_LOSS handler should guard 1500ms foreground start/resume window against WebView self-pause'
  );

  // 2. attachDeckEvents pause listener checks if (!element.paused) return;
  assert.ok(
    indexHtml.includes("element.addEventListener('pause', () => {\n        if (element._unlockingGesture) return;\n        if (!element.paused) return;"),
    'Deck pause event listener must ignore stale queued pause events when element.paused is false'
  );

  // 3. playDsdTrack assigns audio.dataset.trackId = String(track.id) before audio.src = url
  assert.ok(
    indexHtml.includes('if (audio.dataset && track && track.id != null) audio.dataset.trackId = String(track.id);\n          audio.src = url;'),
    'playDsdTrack must stamp audio.dataset.trackId on full decoded DSD playback'
  );

  // 4. #shuffle-button clears state.preloadTrackId and state.preloadReadyUrl before preloadNext(true)
  assert.ok(
    indexHtml.includes("state.shuffle = !state.shuffle; state.preloadTrackId = null; state.preloadReadyUrl = null;"),
    '#shuffle-button should reset preloadTrackId and preloadReadyUrl before preloadNext(true)'
  );

  // 5. triggerRoonAction passes track.id to playTrack and triggers preloadNext(true) on play_next / add_queue
  const roonStart = indexHtml.indexOf('function triggerRoonAction(');
  const roonBlock = indexHtml.slice(roonStart, roonStart + 1800);
  assert.ok(roonBlock.includes('playTrack(track.id != null ? track.id : track);'));
  assert.ok(roonBlock.includes('if (state.currentId && (audio.src || state.isNativeBitPerfectPlaying)) preloadNext(true);'));
});
