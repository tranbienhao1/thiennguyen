'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const deckEventsStart = appCode.indexOf('function attachDeckEvents(element) {');
const deckEventsEnd = appCode.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckEventsStart);
const deckEventsSource = appCode.slice(deckEventsStart, deckEventsEnd);

test('v2.6.3: FLAC first slice widens when metadata leaves < 256 KB of audio frames', async () => {
  const ranges = [];
  const flacHeaderAndCover = 960 * 1024; // 960 KB cover inside 1 MB slice -> only 64 KB audio!
  const totalBytes = 25 * 1024 * 1024;

  function buildFakeFlacSlice(byteLen) {
    const buf = new Uint8Array(byteLen);
    // "fLaC"
    buf[0] = 0x66; buf[1] = 0x4c; buf[2] = 0x61; buf[3] = 0x43;
    // Last metadata block (0x84 = last + PICTURE) of length (flacHeaderAndCover - 8)
    const blockLen = flacHeaderAndCover - 8;
    buf[4] = 0x84;
    buf[5] = (blockLen >> 16) & 0xff;
    buf[6] = (blockLen >> 8) & 0xff;
    buf[7] = blockLen & 0xff;
    // FLAC sync code 0xFF 0xF8 at flacHeaderAndCover
    if (byteLen > flacHeaderAndCover + 1) {
      buf[flacHeaderAndCover] = 0xff;
      buf[flacHeaderAndCover + 1] = 0xf8;
    }
    return buf;
  }

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const range = opts && opts.headers && opts.headers.Range;
    ranges.push(range);
    const m = String(range).match(/bytes=0-(\d+)/);
    const len = Number(m[1]) + 1;
    const bytes = buildFakeFlacSlice(len);
    return {
      ok: true,
      status: 206,
      headers: {
        get: name => {
          const k = String(name).toLowerCase();
          if (k === 'content-type') return 'audio/flac';
          if (k === 'content-length') return String(len);
          return null;
        }
      },
      blob: async () => new Blob([bytes], { type: 'audio/flac' })
    };
  };

  try {
    const res = await library.fetchAudioFirstSlice('https://example.test/mck.flac', { expectedTotalBytes: totalBytes }, 'Google Drive');
    assert.equal(ranges.length, 2, 'Should widen range once when audio frames < 256 KB');
    assert.ok(res.blob.size >= flacHeaderAndCover + 256 * 1024, 'Widened slice must contain at least 256 KB of audio frames');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('v2.6.3: Premature first-slice EOF does NOT push seekbar to 100% or flip play button to ▶', () => {
  const dom = {};
  const makeEl = () => ({
    textContent: '',
    value: '0',
    classList: { added: [], add(c) { this.added.push(c); }, remove() {} },
    style: { setProperty() {} },
    matches: () => false
  });
  const $ = id => (dom[id] ||= makeEl());

  const seekValues = [];
  const state = {
    tracks: [{ id: 'mck-1', title: 'Anh Khong Muon No De Dang', duration: 165, firstSlicePlayback: true, lastSlicePosition: null, fullAudioPromise: new Promise(() => {}) }],
    currentId: 'mck-1',
    isPlaybackLoading: false,
    isSeeking: false,
    errorSkipCount: 0,
    preloadTrackId: null,
    preloadReadyUrl: null
  };

  const makeDeck = () => ({
    handlers: {},
    dataset: { trackId: 'mck-1' },
    src: 'blob:slice',
    currentTime: 0,
    duration: 165,
    paused: false,
    ended: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    fire(type) { (this.handlers[type] || []).forEach(fn => fn()); }
  });
  const audio = makeDeck();
  const standbyAudio = makeDeck();

  globalThis.formatTime = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
  globalThis.formatRemainingTime = () => '-2:45';
  globalThis.lastDisplayedPlaybackSecond = -1;
  globalThis.lastPositionStateSecond = -1;
  globalThis.syncSeek = v => { seekValues.push(v); $('seek').value = String(v); };
  globalThis.paintSeek = () => {};
  globalThis.updateLyricsHighlight = () => {};
  globalThis.updateMetadataFilters = () => {};
  globalThis.scheduleTrackRender = () => {};
  globalThis.library = { shouldPreloadNext: () => false, PRELOAD_LEAD_SECONDS: 10 };
  globalThis.preloadNext = () => {};
  globalThis.location = { href: 'https://example.test/' };

  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio, () => {}, () => {}, () => {}, $, {}, () => {}
  );
  attachDeckEvents(audio);

  // Simulate Chromium hitting truncated FLAC EOF -> jumps currentTime straight to 165 (2:45), ended=true
  audio.currentTime = 165;
  audio.ended = true;
  audio.paused = true;
  audio.fire('timeupdate');
  audio.fire('pause');
  audio.fire('ended');

  assert.equal($('current-time').textContent, '0:00', 'Current time must stay at 0:00, not jump to 2:45');
  assert.equal($('seek').value, '0', 'Seek bar must stay at 0, not jump to 1000 (100%)');
  assert.ok(!seekValues.includes(1000), 'syncSeek(1000) must never be called on premature slice EOF');
  assert.equal($('play-button').textContent, '…', 'Play button must stay in loading state (…), not ▶');
});

test('v2.6.3: Stale old deck timeupdate is ignored while new track is loading', () => {
  const dom = {};
  const makeEl = () => ({
    textContent: '0:00',
    value: '0',
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    matches: () => false
  });
  const $ = id => (dom[id] ||= makeEl());

  const seekValues = [];
  const state = {
    tracks: [
      { id: 'old-track', duration: 165 },
      { id: 'new-track', duration: 210 }
    ],
    currentId: 'new-track',
    isPlaybackLoading: true,
    isSeeking: false,
    errorSkipCount: 0,
    preloadTrackId: null,
    preloadReadyUrl: null
  };
  const audio = {
    handlers: {},
    dataset: { trackId: 'old-track' },
    src: 'blob:old',
    currentTime: 165,
    duration: 165,
    paused: false,
    ended: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    fire(type) { (this.handlers[type] || []).forEach(fn => fn()); }
  };
  const standbyAudio = { paused: true, src: '' };

  globalThis.formatTime = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
  globalThis.formatRemainingTime = () => '-3:30';
  globalThis.lastDisplayedPlaybackSecond = -1;
  globalThis.lastPositionStateSecond = -1;
  globalThis.syncSeek = v => { seekValues.push(v); $('seek').value = String(v); };
  globalThis.paintSeek = () => {};
  globalThis.updateLyricsHighlight = () => {};
  globalThis.updateMetadataFilters = () => {};
  globalThis.scheduleTrackRender = () => {};
  globalThis.library = { shouldPreloadNext: () => false, PRELOAD_LEAD_SECONDS: 10 };
  globalThis.preloadNext = () => {};
  globalThis.location = { href: 'https://example.test/' };

  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio, () => {}, () => {}, () => {}, $, {}, () => {}
  );
  attachDeckEvents(audio);

  audio.fire('timeupdate');
  assert.equal($('current-time').textContent, '0:00', 'Old deck timeupdate must not overwrite new track time');
  assert.equal(seekValues.length, 0, 'Old deck timeupdate must not call syncSeek');
});

test('v2.6.3: Smart album sequential playback covers all album contexts and respects repeat before radio', () => {
  assert.ok(html.includes('const isFilteredAlbum = Boolean(state.album && state.album !== \'*\');'), 'Must detect filtered album context');
  assert.ok(html.includes('const isGroupedByAlbum = Boolean(state.groupBy === \'album\' && track);'), 'Must detect album-grouped context');
  assert.ok(html.includes('rawAlbumTracks = renderedTracks;'), 'Must preserve exact sorted renderedTracks order inside album view');
  // In playNext & queueIndex, repeat === 1 must appear before roonRadio inside seqResult.isEnd
  const qiStart = html.indexOf('function queueIndex() {');
  const qiBlock = html.slice(qiStart, qiStart + 3000);
  const qiEndIdx = qiBlock.indexOf('if (seqResult && seqResult.isEnd)');
  const qiEndSection = qiBlock.slice(qiEndIdx, qiEndIdx + 900);
  assert.ok(qiEndSection.indexOf('state.repeat === 1') < qiEndSection.indexOf('state.roonRadio'), 'queueIndex must check repeat === 1 before roonRadio at album end');
  assert.ok(!qiEndSection.includes('(current + 1) % state.tracks.length'), 'queueIndex must not jump to random outside track at album end');

  const pnStart = html.indexOf('function playNext(direction = 1, auto = false) {');
  const pnBlock = html.slice(pnStart, pnStart + 8000);
  const pnEndIdx = pnBlock.indexOf('if (seqResult && seqResult.isEnd && direction > 0)');
  const pnEndSection = pnBlock.slice(pnEndIdx, pnEndIdx + 3500);
  assert.ok(pnEndSection.indexOf('state.repeat === 1') < pnEndSection.indexOf('state.roonRadio'), 'playNext must check repeat === 1 before roonRadio at album end');
  assert.ok(!pnEndSection.includes('(currentIndex + 1) % state.tracks.length'), 'playNext must not jump to random outside track at album end');
});

test('v2.6.4: clearOptimisticLoadingUi uses state.activeDeck.element (never crashes on .audio)', () => {
  assert.ok(!html.includes('state.activeDeck.audio'), 'state.activeDeck.audio typo must not exist');
  assert.ok(html.includes('state.activeDeck.element && !state.activeDeck.element.paused'), 'clearOptimisticLoadingUi must read state.activeDeck.element.paused');
});

test('v2.6.6: renderTrackRows attaches handleTrackRowActivation click listener only ONCE per row', () => {
  const start = html.indexOf('function renderTrackRows(');
  const end = html.indexOf('function renderTracks()', start);
  const fnBody = html.slice(start, end);
  const matches = fnBody.match(/list\.querySelectorAll\('\[data-track-id\]'\)\.forEach\(/g) || [];
  assert.equal(matches.length, 1, 'renderTrackRows must attach [data-track-id] click listeners exactly once (no double playTrack race)');
});

test('v2.6.8: Seamless playback engine — micro-fade slice swap, standbyAudio full-file upgrade, and 180ms gapless lookahead', () => {
  assert.ok(html.includes('standbyAudio && standbyAudio.src === sliceAbsoluteUrl && track.id === state.preloadTrackId'), 'upgradeSliceToFullAudio must upgrade preloaded standbyAudio in place');
  assert.ok(html.includes('const gaplessLookaheadEligible = Boolean('), 'timeupdate must include 180ms gapless lookahead when standbyAudio is ready');
  assert.ok(html.includes('const swapStartedAt ='), 'upgradeSliceToFullAudio must compensate for metadata load latency during live swap');
});

test('v2.6.9: First-click playback after Google Drive sync unlocks decks synchronously & never hangs on AudioContext.resume()', () => {
  assert.ok(html.includes('function unlockAudioDecksOnGesture()'), 'unlockAudioDecksOnGesture must exist');
  assert.ok(html.includes('async function safeResumeAudioContext('), 'safeResumeAudioContext must exist');
  assert.ok(html.includes('navigator.userActivation.isActive === false'), 'must not close unlocked AudioContext after async load when user gesture expired');
});

test('v2.7.0: Web DAC Output Picker, Audiophile Shortcuts (J/L/C), Android BecomingNoisy & USB DAC Hot-Plug', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('AudioManager.ACTION_AUDIO_BECOMING_NOISY'), 'MainActivity must auto-pause on headphone/DAC unplug');
  assert.ok(mainJava.includes('AudioDeviceCallback'), 'MainActivity must detect USB DAC hot-plug/unplug');
  assert.ok(html.includes('id="audio-output-device-select"'), 'Settings must include Web Audio Output Device Picker');
  assert.ok(html.includes('window.onAndroidAudioBecomingNoisy'), 'Web bridge must handle Android becoming-noisy pause');
  assert.ok(html.includes('window.onAndroidAudioDeviceChanged'), 'Web bridge must handle Android USB DAC hot-plug');
  assert.ok(html.includes('function copyNowPlayingToClipboard()'), 'Copy Now Playing shortcut must exist');
});

test('v2.8.0: Keep-Screen-On (Web WakeLock + Android FLAG_KEEP_SCREEN_ON), 1-Click Cache Cleaner & Preconnect hints', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('FLAG_KEEP_SCREEN_ON'), 'MainActivity must support FLAG_KEEP_SCREEN_ON');
  assert.ok(mainJava.includes('public void setKeepScreenOn(boolean enable)'), 'NocturneJsBridge must expose setKeepScreenOn');
  assert.ok(mainJava.includes('public String getDeviceAudioTelemetry()'), 'NocturneJsBridge must expose getDeviceAudioTelemetry');
  assert.ok(html.includes('rel="preconnect" href="https://www.googleapis.com"'), 'index.html must preconnect to googleapis.com');
  assert.ok(html.includes('async function syncScreenWakeLock('), 'index.html must include syncScreenWakeLock');
  assert.ok(html.includes('id="clear-slice-cache-btn"'), 'Settings must include 1-click slice cache cleaner button');
});

test('v2.9.0: Random Album Discovery, Smooth Android AudioFocus Ducking & Tactile Haptic Feedback', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('window.onAndroidAudioDuck(true)'), 'MainActivity must notify Web on transient audio focus duck');
  assert.ok(mainJava.includes('public void hapticTick()'), 'NocturneJsBridge must expose hapticTick');
  assert.ok(html.includes('id="random-album-btn"'), 'Toolbar must include Random Album Discovery button');
  assert.ok(html.includes('function playRandomAlbumDiscovery()'), 'playRandomAlbumDiscovery must exist');
  assert.ok(html.includes('window.onAndroidAudioDuck = (ducked) =>'), 'Web bridge must handle smooth audio ducking');
});

test('v3.0.0: Personal Listening Telemetry, Android Background Battery Saver, Hardware Volume Bridge & Scroll-to-Top', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes("window.onAndroidAppLifecycle('background')"), 'MainActivity onPause must notify Web for background battery saving');
  assert.ok(mainJava.includes('public int getSystemVolumePercent()'), 'NocturneJsBridge must expose getSystemVolumePercent');
  assert.ok(mainJava.includes('public void setSystemVolumePercent(int pct)'), 'NocturneJsBridge must expose setSystemVolumePercent');
  assert.ok(html.includes('id="scroll-top-btn"'), 'Floating Scroll-to-Top pill must exist');
  assert.ok(html.includes('function formatListeningTelemetrySummary()'), 'Personal listening telemetry summary must exist');
  assert.ok(html.includes('window.onAndroidAppLifecycle = (phase) =>'), 'Web bridge must handle Android lifecycle visualizer pause');
});

test('v3.1.0: Quick Favorites Pill, 0-9 Percentage Seek & Smart Battery-Saver Mode (Web + APK)', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('public boolean isPowerSaveMode()'), 'NocturneJsBridge must expose isPowerSaveMode');
  assert.ok(mainJava.includes('window.onAndroidPowerSaveChanged'), 'MainActivity onResume must forward PowerSaveMode');
  assert.ok(html.includes('id="quick-fav-toggle-btn"'), 'Toolbar must include 1-tap Quick Favorites button');
  assert.ok(html.includes("body.power-save-mode"), 'CSS must include lightweight power-save-mode rules');
  assert.ok(html.includes('window.onAndroidPowerSaveChanged = (enabled) =>'), 'Web bridge must handle Android power-save mode');
});

test('v3.1.2: Safe per-deck gesture unlock + setupAudio never closes running AudioContext without userActivation + play-button resumes suspended context without pausing', () => {
  const unlockStart = html.indexOf('function unlockAudioDecksOnGesture()');
  const unlockEnd = html.indexOf('async function safeResumeAudioContext(', unlockStart);
  const unlockBody = html.slice(unlockStart, unlockEnd);
  assert.ok(unlockBody.includes('el._unlockingGesture = true'), 'unlockAudioDecksOnGesture must guard decks with _unlockingGesture');
  assert.ok(unlockBody.includes('if (el.src === SILENT_UNLOCK_WAV)'), 'unlockAudioDecksOnGesture must only clear src if still SILENT_UNLOCK_WAV');

  const setupStart = html.indexOf('function setupAudio() {');
  const setupBlock = html.slice(setupStart, setupStart + 1200);
  assert.ok(setupBlock.includes('navigator.userActivation.isActive === false'), 'setupAudio must not close a running AudioContext when userActivation has expired');

  const playBtnStart = html.indexOf("$('play-button').addEventListener('click'");
  const playBtnBlock = html.slice(playBtnStart, playBtnStart + 2600);
  assert.ok(playBtnBlock.includes("const wasContextSuspended = Boolean(state.context && state.context.state === 'suspended')"), 'play-button must detect suspended AudioContext before resuming');
  assert.ok(playBtnBlock.includes('if (!audio.paused && wasContextSuspended)'), 'play-button must resume suspended AudioContext instead of pausing silent audio');

  // Behavioral check: attachDeckEvents ignores ended/pause while _unlockingGesture is true
  const state = { tracks: [{ id: 't1' }], currentId: 't1', isPlaybackLoading: false, errorSkipCount: 0 };
  let playNextCalls = 0;
  const deck = {
    _unlockingGesture: true,
    handlers: {},
    paused: false,
    ended: true,
    src: 'data:audio/wav;base64,test',
    currentTime: 0,
    duration: 0.01,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    fire(type) { (this.handlers[type] || []).forEach(fn => fn()); }
  };
  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, deck, { paused: true, src: '' }, () => {}, () => { playNextCalls++; }, () => {}, () => ({ textContent: '', classList: { add() {}, remove() {} } }), {}, () => {}
  );
  attachDeckEvents(deck);
  deck.fire('ended');
  assert.equal(playNextCalls, 0, 'ended during _unlockingGesture must NEVER trigger playNext');
});

test('v3.1.3: Next button inside an album ALWAYS advances strictly within the album (never jumps to random/Roon Radio/stale queue outside)', () => {
  const resolveSrcStart = html.indexOf('function resolveActiveAlbumTracks(lib) {');
  const resolveSrcEnd = html.indexOf('function queueIndex() {', resolveSrcStart);
  const resolveSrc = html.slice(resolveSrcStart, resolveSrcEnd);
  const pnStart = html.indexOf('function playNext(direction = 1, auto = false) {');
  const pnEnd = html.indexOf('    function handle', pnStart) > 0 ? html.indexOf('    function handle', pnStart) : html.indexOf('\n    function ', pnStart + 40);
  const pnSrc = html.slice(pnStart, pnEnd);

  const albumA1 = { id: 'a1', title: 'Track 1', album: 'Album A', trackNumber: 1 };
  const albumA2 = { id: 'a2', title: 'Track 2', album: 'Album A', trackNumber: 2 };
  const outside1 = { id: 'o1', title: 'Outside 1', album: 'Other', trackNumber: 1 };
  const outside2 = { id: 'o2', title: 'Outside 2', album: 'Other', trackNumber: 2 };

  const played = [];
  const state = {
    tracks: [albumA1, outside1, albumA2, outside2],
    currentId: 'a1',
    shuffle: true,
    repeat: 0,
    autoplay: true,
    roonRadio: true,
    activeView: 'albums',
    activeFocus: 'all',
    currentCollectionEntry: { action: 'album', key: 'album:a', name: 'Album A', tracks: [albumA1, albumA2] },
    trackScope: ['a1', 'a2'],
    playbackContext: null,
    queueTrackIds: ['o1'],
    recentHistory: [],
    favorites: new Set(),
    preloadTrackId: 'o2'
  };
  const playNext = new Function('state', 'audio', 'library', 'NocturneLibrary', 'trackById', 'queueTracks', 'playTrack', 'renderQueue', 'toast', 'location', 'navigator', `${resolveSrc}\n${pnSrc}\nreturn playNext;`)(
    state,
    { currentTime: 0, src: '', pause() {}, play() {} },
    library,
    library,
    id => state.tracks.find(x => String(x.id) === String(id)) || null,
    () => state.queueTrackIds.map(id => state.tracks.find(x => x.id === id)).filter(Boolean),
    id => { played.push(id); state.currentId = id; },
    () => {},
    () => {},
    { href: 'https://example.test/' },
    { onLine: true }
  );

  // Click Next on Track 1 -> must go to Track 2 of Album A (ignoring shuffle=true, stale queue o1, and preload o2)
  playNext(1, false);
  assert.equal(played[0], 'a2', 'Next on Track 1 inside album must advance to Track 2 of the album');

  // Click Next on last track (Track 2 of Album A) -> must switch to Track 1 of a random OTHER album (Other) and continue sequentially inside it!
  playNext(1, false);
  assert.equal(played[1], 'o1', 'Manual Next on last track of Album A must start Track 1 of a random other album');
  assert.equal(state.playbackContext.name, 'Other', 'playbackContext must switch to the new random album');
  playNext(1, false);
  assert.equal(played[2], 'o2', 'Next inside the newly picked random album must advance sequentially to Track 2');
});

test('v3.2.0: Quick 1-Tap Sleep Timer Pill, Adaptive Low-RAM GPU Guard & Native Android Share Sheet', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('public boolean isLowRamDevice()'), 'MainActivity must expose isLowRamDevice');
  assert.ok(mainJava.includes('public int getAvailableMemoryMb()'), 'MainActivity must expose getAvailableMemoryMb');
  assert.ok(mainJava.includes('public boolean shareText(final String title, final String text)'), 'MainActivity must expose native shareText');
  assert.ok(html.includes('id="quick-sleep-btn"'), 'Toolbar must include Quick 1-Tap Sleep Timer pill');
  assert.ok(html.includes('body.low-ram-mode'), 'CSS must include adaptive low-ram-mode rules');
  assert.ok(html.includes('function applyAdaptiveLowRamMode()'), 'applyAdaptiveLowRamMode must exist');
});

test('v3.3.0: Dynamic Tab Title Sync, Preferences JSON Backup/Restore & Android Battery/Sound Bridge', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('public String getBatteryInfoJson()'), 'MainActivity must expose getBatteryInfoJson');
  assert.ok(mainJava.includes('public boolean openAppAudioSettings()'), 'MainActivity must expose openAppAudioSettings');
  assert.ok(html.includes('id="export-prefs-btn"'), 'Settings must include Export JSON preferences button');
  assert.ok(html.includes('id="import-prefs-btn"'), 'Settings must include Import JSON preferences button');
  assert.ok(html.includes('function syncDynamicTabTitle()'), 'syncDynamicTabTitle must exist');
  assert.ok(html.includes('function refreshDeviceTelemetryPill()'), 'refreshDeviceTelemetryPill must exist');
});

test('v3.4.0: Night Dimmer OLED Eye-Comfort Mode + Android Audio Output Route & Window Brightness Bridge', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('public String getAudioOutputRouteName()'), 'MainActivity must expose getAudioOutputRouteName');
  assert.ok(mainJava.includes('public int getScreenBrightnessPercent()'), 'MainActivity must expose getScreenBrightnessPercent');
  assert.ok(mainJava.includes('public void setScreenBrightnessPercent(final int pct)'), 'MainActivity must expose setScreenBrightnessPercent');
  assert.ok(html.includes('id="night-dimmer-btn"'), 'Toolbar must include Night Dimmer pill');
  assert.ok(html.includes('id="night-dimmer-overlay"'), 'HTML must include non-blocking night-dimmer-overlay');
  assert.ok(html.includes('function applyNightDimmerLevel('), 'applyNightDimmerLevel must exist');
});

test('v3.5.0: Track Timestamp Bookmarks (B/Shift+B) + Android Thermal Guard & App Build Telemetry', () => {
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('public String getDeviceThermalStatus()'), 'MainActivity must expose getDeviceThermalStatus');
  assert.ok(mainJava.includes('public String getAppBuildInfoJson()'), 'MainActivity must expose getAppBuildInfoJson');
  assert.ok(html.includes('id="quick-bookmark-btn"'), 'Toolbar must include Quick Bookmark pill');
  assert.ok(html.includes('function saveOrJumpTrackBookmark('), 'saveOrJumpTrackBookmark must exist');
  assert.ok(html.includes('function checkAndroidThermalGuard()'), 'checkAndroidThermalGuard must exist');
});
