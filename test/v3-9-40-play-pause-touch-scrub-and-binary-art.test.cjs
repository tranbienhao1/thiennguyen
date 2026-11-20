'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Web + APK Play/Pause & 1-Tap Playback: unlockAudioDecksOnGesture, isSilentUnlockSrc, retryPlayOnAbort & playTrack suspension', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const unlockStart = html.indexOf('const SILENT_UNLOCK_WAV =');
  const playTrackStart = html.indexOf('async function playTrack(trackId)');
  assert.ok(unlockStart > 0 && playTrackStart > unlockStart);
  const unlockBlock = html.slice(unlockStart, playTrackStart);

  // 1a. On native Android WebView (window.NocturneNative), unlockAudioDecksOnGesture skips SILENT_UNLOCK_WAV completely
  let playCalled = 0;
  const nativeDeck = { src: '', muted: false, play() { playCalled++; return Promise.resolve(); } };
  const nativeSandbox = {
    window: { NocturneNative: {} },
    state: { _decksUnlockedByGesture: false, context: null },
    standbyAudio: nativeDeck,
    audio: nativeDeck,
    setTimeout,
    Promise
  };
  vm.runInNewContext(unlockBlock + '\nunlockAudioDecksOnGesture();', nativeSandbox);
  assert.equal(nativeSandbox.state._decksUnlockedByGesture, true);
  assert.equal(playCalled, 0, 'Must skip silent unlock WAV when running inside Nocturne Android WebView');

  // 1b. On Web, excludeEl is skipped while inactive deck is unlocked and reset cleanly to ""
  const standbyDeck = { src: '', muted: false, attrs: {}, removeAttribute(k) { if (k === 'src') this.src = ''; }, load() {}, pause() { this.paused = true; }, play() { playCalled++; return Promise.resolve(); } };
  const activeDeckEl = { src: '', muted: false, attrs: {}, paused: true, removeAttribute(k) { if (k === 'src') this.src = ''; }, load() { this.loadCalls = (this.loadCalls || 0) + 1; }, pause() { this.paused = true; }, play() { playCalled++; return Promise.resolve(); } };
  const webSandbox = {
    window: {},
    state: { _decksUnlockedByGesture: false, bitPerfectEnabled: false, playGeneration: 3, context: { state: 'suspended', resumeCalled: 0, resume() { this.resumeCalled++; return Promise.resolve(); } } },
    standbyAudio: standbyDeck,
    audio: activeDeckEl,
    safeResumeAudioContext: async () => {},
    setTimeout: (fn) => { fn(); return 1; },
    Promise
  };
  vm.runInNewContext(unlockBlock, webSandbox);
  webSandbox.unlockAudioDecksOnGesture(standbyDeck);
  assert.equal(standbyDeck.src, '', 'Excluded target deck must never be touched by SILENT_UNLOCK_WAV');
  assert.equal(playCalled, 1, 'Only non-excluded deck should run silent unlock');
  const detectedSilent = vm.runInNewContext(unlockBlock + '\nisSilentUnlockSrc({ src: SILENT_UNLOCK_WAV })', { window: {}, state: {}, standbyAudio: {}, audio: {} });
  assert.equal(detectedSilent, true);
  assert.equal(webSandbox.isSilentUnlockSrc({ src: 'https://example.com/song.flac' }), false);

  // 1c. retryPlayOnAbort retries once on AbortError and restores gain/mute/context
  const abortDeck = {
    _unlockingGesture: true,
    defaultMuted: true,
    muted: true,
    volume: 0,
    attempts: 0,
    removeAttribute(k) { if (k === 'muted') this.muted = false; },
    async play() {
      this.attempts++;
      if (this.attempts === 1) throw { name: 'AbortError' };
      return undefined;
    }
  };
  webSandbox.audio.volume = 0.85;
  try {
    await abortDeck.play();
  } catch (err) {
    await webSandbox.retryPlayOnAbort(err, abortDeck, 3);
  }
  assert.equal(abortDeck.attempts, 2, 'retryPlayOnAbort should retry once after initial AbortError and succeed');
  assert.equal(abortDeck.muted, false);
  assert.equal(abortDeck.volume, 0.85);

  // 1d. playTrack suspends active WebView AudioContext before Native Bit-Perfect playback and retries AbortError on Web Audio
  const suspendHelperIdx = html.indexOf('function suspendWebAudioForBitPerfect()');
  assert.ok(suspendHelperIdx > 0 && html.slice(suspendHelperIdx, playTrackStart).includes('state.context.suspend()'));
  const playTrackEnd = html.indexOf('function stopDsdWorker(', playTrackStart);
  assert.ok(playTrackEnd > playTrackStart);
  const playTrackSrc = html.slice(playTrackStart, playTrackEnd);
  assert.match(playTrackSrc, /willUseNativeBp[\s\S]*suspendWebAudioForBitPerfect\(\)/);
  assert.match(playTrackSrc, /target\.play\(\)[\s\S]{0,950}finishPlaybackStart\(track, generation, target, previousTrack\);/);
  assert.match(playTrackSrc, /retryPlayOnAbort\(playErr, target, generation\)/);
});

test('2. #play-button, handleNativeBitPerfectPlayPauseClick, finishPlaybackStart & attachDeckEvents pause guard work accurately', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 2a. Test handleNativeBitPerfectPlayPauseClick checks isBitPerfectActive() and syncs UI state
  const bpHandlerStart = html.indexOf('function handleNativeBitPerfectPlayPauseClick()');
  const playBtnStart = html.indexOf("$('play-button').addEventListener('click'", bpHandlerStart);
  const playBtnEnd = html.indexOf("$('previous-button').addEventListener('click'", playBtnStart);
  assert.ok(bpHandlerStart > 0 && playBtnStart > bpHandlerStart && playBtnEnd > playBtnStart);

  const bpEvents = [];
  let nativeActive = true;
  let resumeCalls = 0;
  let pauseCalls = 0;
  let clickListeners = {};
  const makeEl = (id) => ({
    id,
    textContent: '▶',
    classList: { remove() {}, add() {} },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(ev, fn) { clickListeners[id + ':' + ev] = fn; }
  });
  const elements = {
    'play-button': makeEl('play-button'),
    'room-play': makeEl('room-play'),
    'mini-play': makeEl('mini-play'),
    'fullscreen-play-btn': makeEl('fullscreen-play-btn')
  };
  let playTrackCalls = [];
  const mainAudio = {
    src: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA',
    paused: true,
    muted: true,
    defaultMuted: true,
    error: null,
    dataset: { trackId: 't1' },
    removeAttribute(k) { if (k === 'muted') this.muted = false; },
    async play() { this.paused = false; },
    pause() { this.paused = true; }
  };
  const standbyAudio = {
    src: 'https://example.com/old.flac',
    paused: false,
    pause() { this.paused = true; },
    muted: false
  };
  const playBtnSandbox = {
    $: (id) => elements[id] || null,
    state: {
      tracks: [{ id: 't1', title: 'Track 1' }, { id: 't2', title: 'Track 2' }],
      currentId: 't1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: true,
      isPlaybackLoading: false,
      context: { state: 'suspended', currentTime: 5, resume: async () => { playBtnSandbox.state.context.state = 'running'; } },
      activeDeck: { router: { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; } } } }
    },
    audio: mainAudio,
    standbyAudio,
    location: { href: 'https://nocturne.local/' },
    setupAudio: () => {},
    isSilentUnlockSrc: (el) => Boolean(el && el.src && el.src.indexOf('data:audio/wav;base64,UklGRigAAABXQVZF') === 0),
    playTrack: (id) => playTrackCalls.push(id),
    syncPlaybackButtonsUi: (playing) => {
      elements['play-button'].textContent = playing ? 'Ⅱ' : '▶';
      elements['room-play'].textContent = playing ? 'Ⅱ' : '▶';
      elements['mini-play'].textContent = playing ? 'Ⅱ' : '▶';
      elements['fullscreen-play-btn'].textContent = playing ? '⏸' : '▶';
    },
    stopDsdWorker: () => {},
    toast: () => {},
    mediaErrorMessage: (e) => String(e),
    console,
    Date,
    Number,
    Boolean,
    String,
    window: {
      NocturneNative: {
        isBitPerfectActive: () => nativeActive,
        resumeBitPerfectPlayback: () => { resumeCalls++; },
        pauseBitPerfectPlayback: () => { pauseCalls++; }
      },
      onNativeBitPerfectStateChange: (p) => {
        bpEvents.push(p);
        playBtnSandbox.state.isNativeBitPerfectPaused = !p;
        playBtnSandbox.syncPlaybackButtonsUi(p);
      }
    }
  };
  playBtnSandbox.global = playBtnSandbox;
  vm.runInNewContext(html.slice(bpHandlerStart, playBtnEnd), playBtnSandbox);

  // Active Native Bit-Perfect toggles Resume -> Pause -> Dead Fallback
  const playClick = clickListeners['play-button:click'];
  assert.equal(typeof playClick, 'function');
  await playClick();
  assert.equal(resumeCalls, 1);
  assert.deepEqual(bpEvents, [true]);
  assert.equal(elements['play-button'].textContent, 'Ⅱ');

  await playClick();
  assert.equal(pauseCalls, 1);
  assert.deepEqual(bpEvents, [true, false]);

  // Dead Bit-Perfect + SILENT_UNLOCK_WAV falls through to playTrack('t1')!
  nativeActive = false;
  await playClick();
  assert.equal(playBtnSandbox.state.isNativeBitPerfectPlaying, false);
  assert.deepEqual(playTrackCalls, ['t1'], 'Dead Bit-Perfect + silent unlock src must restart track via playTrack');

  // Mismatched trackId on audio.src also restarts current track via playTrack!
  mainAudio.src = 'https://example.com/t1.flac';
  playBtnSandbox.state.currentId = 't2';
  await playClick();
  assert.deepEqual(playTrackCalls, ['t1', 't2'], 'Mismatched audio.dataset.trackId must restart current track t2');

  // Valid track on pause pauses BOTH audio and standbyAudio and clears gain/mute on resume
  playBtnSandbox.state.currentId = 't1';
  mainAudio.paused = true;
  await playClick();
  assert.equal(mainAudio.paused, false);
  assert.equal(mainAudio.muted, false);
  assert.equal(standbyAudio.paused, true);
  assert.equal(playBtnSandbox.state.activeDeck.router.gain.value, 1);

  standbyAudio.paused = false;
  await playClick();
  assert.equal(mainAudio.paused, true);
  assert.equal(standbyAudio.paused, true);

  // 2b. finishPlaybackStart syncs #fullscreen-play-btn, visualizer & mediaSession
  const finishStart = html.indexOf('function finishPlaybackStart(track, generation, target, previousTrack)');
  const finishEnd = html.indexOf('async function retrySlicePlaybackFromFullAudio', finishStart);
  const finishSrc = html.slice(finishStart, finishEnd);
  assert.ok(finishSrc.includes("if ($('fullscreen-play-btn')) $('fullscreen-play-btn').textContent = '⏸';"));
  assert.ok(finishSrc.includes("if (typeof setVisualizerRunning === 'function') setVisualizerRunning(true);"));
  assert.ok(finishSrc.includes("navigator.mediaSession.playbackState = 'playing'"));

  // 2c. attachDeckEvents pause guard does NOT ignore real pause when standby holds SILENT_UNLOCK_WAV
  const deckStart = html.indexOf('function attachDeckEvents(element)');
  const deckEnd = html.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckStart);
  assert.ok(html.slice(deckStart, deckEnd).includes('const standbyActivelyPlaying = Boolean(standbyAudio && !standbyAudio.paused && !standbyAudio._unlockingGesture && !(typeof isSilentUnlockSrc === \'function\' && isSilentUnlockSrc(standbyAudio)) && standbyAudio.src);'));
});

test('3. Fast-Tap exempts transport buttons & waveforms, releaseSeekLock clears stuck isSeeking, attachWaveformTouchScrub & seekByStep Bit-Perfect parity', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 3a. Fast-Tap exemption + CSS button touch-action
  assert.ok(html.includes('button { touch-action: manipulation; }'));
  for (const id of ['#play-button', '#room-play', '#fullscreen-play-btn', '#mini-play', '#previous-button', '#next-button', '#waveform-canvas', '#fullscreen-waveform', '#mini-waveform']) {
    assert.ok(html.includes(id), `Fast-Tap native control exemption must include ${id}`);
  }
  assert.ok(html.includes('const releaseSeekLock = () => { if (state.isSeeking) state.isSeeking = false; };'));

  // 3b. attachWaveformTouchScrub attached to all 3 waveforms + Bit-Perfect touch scrub test
  assert.ok(html.includes('attachWaveformTouchScrub(wfCanvas, wfTooltip'));
  assert.ok(html.includes("attachWaveformTouchScrub(fsWaveform, fsTooltip, { hoverKey: 'fullscreenWaveformHoverFraction', fullscreen: true });"));
  assert.ok(html.includes("attachWaveformTouchScrub(miniWf, null, { hoverKey: 'miniHudHoverFraction' });"));

  const scrubStart = html.indexOf('function attachWaveformTouchScrub(canvasEl, tooltipEl, options)');
  const scrubEnd = html.indexOf("const wfCanvas = document.getElementById('waveform-canvas');", scrubStart);
  assert.ok(scrubStart > 0 && scrubEnd > scrubStart);
  const canvasListeners = {};
  const seekCalls = [];
  const fakeCanvas = {
    getBoundingClientRect: () => ({ left: 100, width: 200 }),
    addEventListener(type, fn) { canvasListeners[type] = fn; }
  };
  const fakeTooltip = { textContent: '', style: {}, classList: { hidden: true, remove(c) { if (c === 'hidden') this.hidden = false; }, add(c) { if (c === 'hidden') this.hidden = true; } } };
  const scrubSandbox = {
    state: {
      currentId: 'bp1',
      tracks: [{ id: 'bp1', duration: 200 }],
      isNativeBitPerfectPlaying: true,
      isSeeking: false,
      lastBitPerfectPositionSec: 0
    },
    audio: {},
    library: { formatHoverTime: (s) => `${Math.round(s)}s` },
    formatTime: (s) => `${Math.round(s)}s`,
    getCurrentPlaybackDurationSeconds: () => 200,
    syncSeek: () => {},
    updatePositionState: () => {},
    renderWaveformSeekbar: () => {},
    window: { NocturneNative: { seekBitPerfectPlayback: (ms) => seekCalls.push(ms) } }
  };
  vm.runInNewContext(html.slice(scrubStart, scrubEnd), scrubSandbox);
  scrubSandbox.attachWaveformTouchScrub(fakeCanvas, fakeTooltip, { hoverKey: 'waveformHoverFraction' });

  canvasListeners.touchstart({ touches: [{ clientX: 150 }] });
  assert.equal(scrubSandbox.state.isSeeking, true);
  let prevented = false;
  canvasListeners.touchmove({ cancelable: true, preventDefault() { prevented = true; }, touches: [{ clientX: 200 }] });
  assert.equal(prevented, true, 'touchmove on waveform must preventDefault to avoid scrolling');
  assert.equal(seekCalls[0], 100000);
  canvasListeners.touchend({ changedTouches: [{ clientX: 250 }] });
  assert.equal(scrubSandbox.state.isSeeking, false);
  assert.equal(seekCalls[1], 150000);
  assert.equal(scrubSandbox.state.lastBitPerfectPositionSec, 150);

  // 3c. seekByStep & becoming-noisy hardening
  const seekStepStart = html.indexOf('const seekByStep = delta =>');
  const keydownIdx = html.indexOf("document.addEventListener('keydown'", seekStepStart);
  assert.ok(html.slice(seekStepStart, keydownIdx).includes('seekBitPerfectPlayback'));
  const noisyStart = html.indexOf('window.onAndroidAudioBecomingNoisy = () =>');
  const noisyEnd = html.indexOf('window.onAndroidAudioDeviceChanged =', noisyStart);
  const noisySrc = html.slice(noisyStart, noisyEnd);
  assert.ok(noisySrc.includes('standbyAudio.pause()') && noisySrc.includes('onNativeBitPerfectStateChange(false)'));
});

test('4. MainActivity.java: BitPerfectAudioPlayer isActive/guards, mCurrentSourceKey, MP4/WAV binary art & 3-tier lockscreen cover', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('private volatile String mCurrentSourceKey = "";'));
  assert.ok(java.includes('public boolean isActive() {'));
  assert.ok(java.includes('public String getCurrentSourceKey() {'));
  assert.ok(java.includes('public boolean isBitPerfectActive() {'));
  assert.match(java, /public void pause\(\) \{\s*if \(!isActive\(\)\) return;/);
  assert.match(java, /public void resume\(\) \{[\s\S]{0,120}if \(!isActive\(\)\) \{[\s\S]*?return;/);
  assert.ok(java.includes('if (!mIsPaused && !mIsStopped) {\n                    track.play();'));
  assert.ok(java.includes('private static long[] findMp4BoxRange('));
  assert.ok(java.includes('private static byte[] extractMp4CovrFromChannel('));
  assert.ok(java.includes('private static byte[] extractWavId3ApicFromChannel('));
  assert.ok(java.includes('extractMp4CovrFromChannel(ch)'));
  assert.ok(java.includes('extractWavId3ApicFromChannel(ch)'));
  assert.ok(java.includes('private static String stripFeaturedArtistForCoverKey('));
  assert.ok(java.includes('decodeCachedCoverHash(coverSha1Hex("v3s:" + activeSrc + "|320"))'));
});

test('5. Version sync v3.9.40 / versionCode 94, 404.html & android assets LF parity, zero ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.40'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.40';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.40';"));
  assert.ok(/versionCode\s*=\s*94\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.40"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.40"'));
  assert.ok(publishRelease.includes("'v3.9.40'"));

  const html404Buf = fs.readFileSync(path.join(ROOT, '404.html'));
  assert.ok(!html404Buf.includes(13), '404.html must have 0 CR bytes');
  assert.equal(html404Buf.toString('utf8'), indexHtml, '404.html must equal index.html');

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
