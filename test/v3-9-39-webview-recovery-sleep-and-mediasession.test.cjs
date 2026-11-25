'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. MainActivity.java handles WebView onRenderProcessGone for main WebView (3/60s rate limit, Bit-Perfect intact) and OAuth popupWebView', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('private int mRendererRecoveryCount = 0;'), 'mRendererRecoveryCount field must exist');
  assert.ok(java.includes('private long mRendererRecoveryWindowStartMs = 0L;'), 'mRendererRecoveryWindowStartMs field must exist');

  const cfgStart = java.indexOf('private void configureHighPerformanceWebView()');
  const cfgEnd = java.indexOf('private void injectAndroidEnvironmentBridge(', cfgStart);
  assert.ok(cfgStart > 0 && cfgEnd > cfgStart, 'configureHighPerformanceWebView bounds must be locatable');
  const cfgSlice = java.slice(cfgStart, cfgEnd);

  const popupMarker = cfgSlice.indexOf('popupWebView.setWebViewClient');
  assert.ok(popupMarker > 0, 'popupWebView.setWebViewClient must exist');
  const mainClientSlice = cfgSlice.slice(0, popupMarker);
  const popupClientSlice = cfgSlice.slice(popupMarker);

  assert.match(mainClientSlice, /public boolean onRenderProcessGone\(WebView view,\s*android\.webkit\.RenderProcessGoneDetail detail\)[\s\S]*?return recoverWebViewAfterRenderProcessGone\(view\);/);
  assert.match(popupClientSlice, /public boolean onRenderProcessGone\(WebView view,\s*android\.webkit\.RenderProcessGoneDetail detail\)[\s\S]*?popupDialog\.dismiss\(\)[\s\S]*?popupWebView\.destroy\(\)[\s\S]*?return true;/);

  const recStart = java.indexOf('private boolean recoverWebViewAfterRenderProcessGone(final WebView deadView)');
  const recEnd = java.indexOf('public void acquireWakeLock()', recStart);
  assert.ok(recStart > 0 && recEnd > recStart, 'recoverWebViewAfterRenderProcessGone bounds must exist');
  const recSlice = java.slice(recStart, recEnd);

  assert.match(recSlice, /60_000L/);
  assert.match(recSlice, /mRendererRecoveryCount > 3/);
  assert.match(recSlice, /removeView\(deadView\)/);
  assert.match(recSlice, /deadView\.destroy\(\)/);
  assert.match(recSlice, /new WebView\(MainActivity\.this\)/);
  assert.match(recSlice, /setId\(R\.id\.web_view\)/);
  assert.match(recSlice, /configureHighPerformanceWebView\(\)/);
  assert.match(recSlice, /loadAppEntrypoint\(\)/);
  assert.equal(recSlice.includes('stopBitPerfectPlayback'), false, 'Recovery must NOT stop Bit-Perfect playback');
  assert.equal(recSlice.includes('mBitPerfectPlayer.stop'), false, 'Recovery must NOT stop mBitPerfectPlayer');
});

test('2. setSleepTimer pauses Bit-Perfect + standbyAudio, preserves fade-out 30s literal & formats custom fade-out duration', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function setSleepTimer(');
  const end = html.indexOf('function clearSleepTimer(', start);
  assert.ok(start > 0 && end > start, 'setSleepTimer bounds must be extractable');

  const elements = {
    'sleep-fadeout': { checked: true },
    'sleep-fade-duration': { value: '60000' },
    'sleep-ambient-scene': { checked: false },
    'sleep-panel': { classList: { add() {}, remove() {}, toggle() {} }, hidden: false }
  };

  let scheduledExpiry = null;
  const scheduledIntervals = [];
  const toastMsgs = [];
  let pauseAudioCount = 0;
  let pauseStandbyCount = 0;
  let pauseBpCount = 0;
  const bpStateChanges = [];
  let clearedCount = 0;

  const sandbox = {
    $: (id) => elements[id] || null,
    clearSleepTimer: () => { clearedCount++; },
    updateSleepStatus: () => {},
    toast: (m) => toastMsgs.push(m),
    stopDsdWorker: () => {},
    toggleAmbientRain: () => {},
    setupAmbientAudio: () => {},
    setGain: () => {},
    library: {
      calculateSleepFadeGain: (rem, total) => Math.max(0, Math.min(1, rem / total)),
      calculateAdaptiveSleepStage: () => ({ musicGain: 1, ambientGain: 0 })
    },
    audio: {
      volume: 0.9,
      pause() { pauseAudioCount++; }
    },
    standbyAudio: {
      paused: false,
      pause() { pauseStandbyCount++; }
    },
    state: {
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      sleepOriginalVolume: 0.9,
      sleepOriginalGain: null,
      sleepDeadline: 0,
      sleepTimer: null,
      sleepFadeTimer: null,
      sleepFadeInterval: null,
      sleepCountdownInterval: null,
      bands: [],
      preamp: null,
      ambientMasterGain: null,
      ambientNodes: null,
      context: null,
      dsdWorker: null,
      dsdUrl: null
    },
    window: {
      NocturneNative: {
        pauseBitPerfectPlayback() { pauseBpCount++; }
      },
      onNativeBitPerfectStateChange(playing) { bpStateChanges.push(playing); }
    },
    setTimeout(fn, delay) {
      if (delay >= 600000) scheduledExpiry = fn;
      return delay;
    },
    clearTimeout() {},
    setInterval(fn, ms) {
      scheduledIntervals.push(ms);
      return scheduledIntervals.length;
    },
    clearInterval() {},
    Date,
    Math,
    Number,
    Boolean,
    String
  };

  vm.runInNewContext(html.slice(start, end), sandbox);

  // Run with custom 60s fade
  sandbox.setSleepTimer(15, {});
  assert.ok(toastMsgs.some(m => m.includes('(fade-out 60s cuối)')), 'Custom 60s fade toast must format dynamically');
  assert.equal(typeof scheduledExpiry, 'function', 'Sleep expiry timer must be scheduled');

  // Fire timer expiry -> must pause HTML audio, standbyAudio, Bit-Perfect & notify UI state change
  scheduledExpiry();
  assert.equal(pauseAudioCount, 1);
  assert.equal(pauseStandbyCount, 1);
  assert.equal(pauseBpCount, 1);
  assert.deepEqual(bpStateChanges, [false]);
  assert.equal(clearedCount, 1, 'clearSleepTimer must be called on sleep timer expiry');

  // Run with default 30s fade -> preserves exact Vietnamese label
  elements['sleep-fade-duration'].value = '30000';
  toastMsgs.length = 0;
  sandbox.setSleepTimer(15, {});
  assert.ok(toastMsgs.some(m => m.includes('(fade-out 30s cuối)')), 'Default 30s fade toast must keep exact literal');
});

test('3. playNext(-1), sleepAtTrackEnd, and #sleep-album-end support Native Bit-Perfect position & pause', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const playNextStart = html.indexOf('function playNext(direction = 1, auto = false) {');
  const playNextEnd = html.indexOf('async function pickLocalFiles', playNextStart);
  assert.ok(playNextStart > 0 && playNextEnd > playNextStart, 'playNext bounds must be extractable');
  const playNextSlice = html.slice(playNextStart, playNextEnd);

  const bpSeeks = [];
  let bpPauses = 0;
  let standbyPauses = 0;
  const bpStates = [];
  const playedIds = [];
  const vmSandbox = {
    state: {
      tracks: [{ id: 't1' }, { id: 't2' }],
      currentId: 't2',
      autoplay: true,
      repeat: 0,
      sleepAtTrackEnd: false,
      shuffle: false,
      preloadTrackId: null,
      dsdWorker: null,
      dsdUrl: null,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false
    },
    audio: { currentTime: 0, pause() {}, play: async () => {} },
    standbyAudio: { paused: false, pause() { standbyPauses++; } },
    window: {
      NocturneNative: {
        seekBitPerfectPlayback: (ms) => bpSeeks.push(ms),
        pauseBitPerfectPlayback: () => { bpPauses++; }
      },
      onNativeBitPerfectStateChange: (playing) => bpStates.push(playing)
    },
    getCurrentPlaybackPositionSeconds: () => 42,
    queueTracks: () => [],
    stopDsdWorker: () => {},
    clearSleepTimer: () => {},
    toast: () => {},
    playTrack: (id) => playedIds.push(id)
  };
  vm.runInNewContext(playNextSlice, vmSandbox);

  // Previous when Bit-Perfect is >3s in must seek Bit-Perfect to 0 instead of switching track
  vmSandbox.playNext(-1, false);
  assert.deepEqual(bpSeeks, [0]);
  assert.deepEqual(playedIds, []);

  // End-of-track sleep stops Bit-Perfect & standbyAudio cleanly
  vmSandbox.state.sleepAtTrackEnd = true;
  vmSandbox.playNext(1, true);
  assert.equal(bpPauses, 1);
  assert.equal(standbyPauses, 1);
  assert.deepEqual(bpStates, [false]);

  const albumEndIdx = html.indexOf("safeOn($('sleep-album-end'), 'click'");
  assert.ok(albumEndIdx > 0);
  const albumEndSlice = html.slice(albumEndIdx, albumEndIdx + 650);
  assert.match(albumEndSlice, /getCurrentPlaybackPositionSeconds/);
  assert.match(albumEndSlice, /calculateAlbumRemainingSeconds\(state\.tracks,\s*state\.currentId,\s*curPos\)/);
});

test('4. navigator.mediaSession actions update Bit-Perfect UI state and seekbackward/seekforward work for Bit-Perfect & Web Audio', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf("action('play', async () => {");
  const end = html.indexOf("action('stop', () => {", start);
  assert.ok(start > 0 && end > start, 'MediaSession action block must be extractable');

  const handlers = {};
  const nativeCalls = [];
  const stateChanges = [];
  const smartSeeks = [];
  let posUpdateCount = 0;

  const sandbox = {
    action: (name, fn) => { handlers[name] = fn; },
    $: () => ({ textContent: '' }),
    state: {
      currentId: 't1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: true,
      tracks: [{ id: 't1', title: 'Track 1', duration: 240, cueStart: 100, cueEnd: 340 }]
    },
    audio: { currentTime: 150, duration: 500, paused: false, play: async () => {}, pause() {} },
    library: lib,
    window: {
      NocturneNative: {
        resumeBitPerfectPlayback() { nativeCalls.push('resume'); },
        pauseBitPerfectPlayback() { nativeCalls.push('pause'); },
        seekBitPerfectPlayback(ms) { nativeCalls.push(['seek', ms]); },
        getBitPerfectDuration() { return 240000; }
      },
      onNativeBitPerfectStateChange(playing) { stateChanges.push(playing); }
    },
    getCurrentPlaybackPositionSeconds: () => 45,
    applySmartSeekTime: (el, trk, targetSec) => smartSeeks.push(targetSec),
    updatePositionState: () => { posUpdateCount++; },
    playNext: () => {},
    Math,
    Number,
    Boolean
  };

  vm.runInNewContext(html.slice(start, end), sandbox);

  // Bit-Perfect play & pause notify onNativeBitPerfectStateChange
  handlers.play();
  assert.deepEqual(nativeCalls, ['resume']);
  assert.deepEqual(stateChanges, [true]);

  sandbox.state.isNativeBitPerfectPaused = false;
  handlers.pause();
  assert.deepEqual(nativeCalls, ['resume', 'pause']);
  assert.deepEqual(stateChanges, [true, false]);

  // Bit-Perfect seekbackward & seekforward using normal track (raw sec 45, dur 240s) -> exact ms targets
  nativeCalls.length = 0;
  sandbox.state.tracks = [{ id: 't1', title: 'Track 1', duration: 240 }];
  handlers.seekbackward({ seekOffset: 10 });
  handlers.seekforward({ seekOffset: 15 });
  assert.deepEqual(nativeCalls, [['seek', 35000], ['seek', 60000]]);
  assert.ok(posUpdateCount >= 2);

  // Web Audio CUE track seekbackward uses applySmartSeekTime (parity with seekforward)
  sandbox.state.tracks = [{ id: 't1', title: 'Track 1', duration: 240, cueStart: 100, cueEnd: 340 }];
  sandbox.state.isNativeBitPerfectPlaying = false;
  handlers.seekbackward({ seekOffset: 10 });
  assert.equal(smartSeeks.length, 1);
  assert.equal(smartSeeks[0], 140);
});

test('5. Version sync v3.9.39+ / versionCode >= 93, Unix LF parity & zero Chromium 74 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.match(indexHtml, /FiiO M11S · v3\.9\.(39|[4-9]\d|\d{3,})/);
  assert.match(swJs, /const CACHE_VERSION = 'v3\.9\.(39|[4-9]\d|\d{3,})';/);
  assert.match(swJs, /const CACHE_NAME = 'nocturne-v3\.9\.(39|[4-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)\b/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 93, 'versionCode must be >= 93');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(39|[4-9]\d|\d{3,})"/);
  assert.match(mainActivity, /"3\.9\.(39|[4-9]\d|\d{3,})"/);
  assert.match(publishRelease, /'v3\.9\.(39|[4-9]\d|\d{3,})'/);

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

test('6. FiiO M11S Artwork & Progress Bar fixes in MainActivity.java and index.html work accurately', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 6a. Native cover response headers & per-source negative .none cache
  assert.ok(java.includes('COVER_NONE_TTL_MS = 2L * 60L * 1000L'));
  const coverRespSlice = java.slice(java.indexOf('private WebResourceResponse buildCoverResponse('), java.indexOf('private WebResourceResponse handleLocalCoverArt('));
  assert.ok(coverRespSlice.includes('headers.put("Content-Type", "image/jpeg");'));
  assert.ok(coverRespSlice.includes('headers.put("Content-Length", String.valueOf(body.length));'));
  assert.ok(coverRespSlice.includes('headers.put("Cache-Control", "no-store");'));
  const coverHandlerSlice = java.slice(java.indexOf('private WebResourceResponse handleLocalCoverArt('), java.indexOf('private WebResourceResponse handleLocalMediaStreaming('));
  assert.ok(coverHandlerSlice.includes('coverSha1Hex("v3src:" + source + "|" + size)'));
  assert.ok(coverHandlerSlice.includes('new File(dir, sourceHash + ".none")'));

  // 6b. BitPerfectAudioPlayer duration fallback & PCM frame-counter fallback
  assert.match(java, /private static int pcmBytesPerFrame\(int channels, int pcmEncoding\)/);
  assert.ok(java.includes('METADATA_KEY_DURATION'));
  assert.ok(java.includes('writtenFramesSinceBase'));
  assert.ok(java.includes('pcmPosMs'));

  // 6c. Chromium 74 seekbar -webkit-appearance CSS
  assert.match(html, /\.seek-range,\s*#seek,\s*#seek-mobile,\s*#room-seek\s*\{[^}]*-webkit-appearance:\s*none;/);
  assert.match(html, /\.seek-range::-webkit-slider-thumb\s*\{[^}]*-webkit-appearance:\s*none;/);
  assert.match(html, /#seek-mobile\s*\{[^}]*-webkit-appearance:\s*none\s*!important;/);

  // 6d. onNativeBitPerfectPosition syncs footer, mobile, room & fullscreen UI
  const bpStart = html.indexOf('function setupBitPerfectIntegration()');
  const bpEnd = html.indexOf('window.setupBitPerfectIntegration = setupBitPerfectIntegration;', bpStart);
  assert.ok(bpStart > 0 && bpEnd > bpStart);

  const elements = {};
  const mkEl = () => ({ textContent: '', value: '0', checked: false, matches: () => false, addEventListener: () => {}, style: { setProperty(k, v) { this[k] = v; } } });
  const getEl = (id) => (elements[id] || (elements[id] = mkEl()));
  const syncCalls = [];
  const bpSandbox = {
    $: getEl,
    state: {
      currentId: 't_bp',
      tracks: [{ id: 't_bp', title: 'HiRes FLAC', duration: 0 }],
      isSeeking: false,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lyrics: [{ time: 30, text: 'Current synced line' }],
      fiioDapMode: true
    },
    library: lib,
    window: { NocturneNative: { getBitPerfectPosition: () => 45000, getBitPerfectDuration: () => 180000 } },
    document: { hidden: false },
    syncSeek: (r) => {
      syncCalls.push(r);
      getEl('seek').value = String(r);
      getEl('seek-mobile').value = String(r);
    },
    paintSeek: (el, v) => { el.painted = v; },
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
    formatRemainingTime: (c, d) => `-${Math.floor((d - c) / 60)}:${String(Math.floor((d - c) % 60)).padStart(2, '0')}`,
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
    Math,
    Number,
    String,
    Boolean
  };
  vm.runInNewContext(html.slice(bpStart, bpEnd) + '\nsetupBitPerfectIntegration();', bpSandbox);
  bpSandbox.window.onNativeBitPerfectPosition(45000, 180000);
  assert.deepEqual(syncCalls, [250]);
  assert.equal(getEl('current-time').textContent, '0:45');
  assert.equal(getEl('current-time-mobile').textContent, '0:45');
  assert.equal(getEl('room-current-time').textContent, '0:45');
  assert.equal(getEl('fullscreen-time-cur').textContent, '0:45');
  assert.equal(getEl('fullscreen-time-dur').textContent, '3:00');
  assert.equal(getEl('room-seek').value, '250');
  assert.equal(getEl('room-seek').painted, 250);
  assert.equal(getEl('fullscreen-lyric-line').textContent, 'Current synced line');

  // 6e. handleFailedLocalCoverElement preserves <img id="room-cover"> and error listener retries with _r=1
  const errStart = html.indexOf('const failedNativeCovers = new Set();');
  const errEnd = html.indexOf('function normalizeCoverImage(', errStart);
  assert.ok(errStart > 0 && errEnd > errStart);
  const queuedOnline = [];
  let scheduledRetryFn = null;
  let roomImgRemoved = false;
  const roomEmptyClasses = new Set(['hidden']);
  const roomCoverEl = {
    id: 'room-cover',
    tagName: 'IMG',
    hidden: false,
    dataset: {},
    isConnected: true,
    attributes: { src: 'https://appassets.androidplatform.net/local-cover?path=%2Fsdcard%2Fsong.flac&size=320' },
    getAttribute(k) { return this.attributes[k] || ''; },
    removeAttribute(k) { delete this.attributes[k]; if (k === 'src') this.src = ''; },
    set src(v) { this.attributes.src = v; },
    get src() { return this.attributes.src || ''; },
    parentNode: { replaceChild() { roomImgRemoved = true; } }
  };
  const winListeners = {};
  const errSandbox = {
    $: (id) => id === 'room-cover-empty'
      ? { classList: { remove: (c) => roomEmptyClasses.delete(c), add: (c) => roomEmptyClasses.add(c) } }
      : null,
    state: {
      currentId: 't1',
      tracks: [{ id: 't1', album: 'Kind of Blue', artist: 'Miles Davis', cover: roomCoverEl.src }],
      albumCovers: new Map()
    },
    queueOnlineAlbumCover: (alb, art) => queuedOnline.push([alb, art]),
    window: { addEventListener: (t, fn) => { winListeners[t] = fn; } },
    document: { createElement: () => ({ style: {} }) },
    setTimeout: (fn) => { scheduledRetryFn = fn; return 1; },
    Set,
    Array,
    Number,
    String
  };
  vm.runInNewContext(html.slice(errStart, errEnd), errSandbox);

  // Trigger transient error on roomCoverEl -> schedules cache-bust retry _r=1 without removing node
  winListeners.error({ target: roomCoverEl });
  assert.equal(typeof scheduledRetryFn, 'function');
  scheduledRetryFn();
  assert.match(roomCoverEl.src, /_r=1$/);
  assert.equal(roomImgRemoved, false);

  // Exhaust retries -> handleFailedLocalCoverElement hides roomCoverEl without replaceChild and queues online cover
  errSandbox.handleFailedLocalCoverElement(roomCoverEl);
  assert.equal(roomCoverEl.hidden, true);
  assert.equal(roomImgRemoved, false, '<img id="room-cover"> must never be replaced out of DOM');
  assert.equal(roomEmptyClasses.has('hidden'), false);
  assert.deepEqual(queuedOnline, [['Kind of Blue', 'Miles Davis']]);

  // 6f. renderWaveformSeekbar uses getCurrentPlaybackPositionSeconds() for Bit-Perfect progress
  const wfStart = html.indexOf('function renderWaveformSeekbar()');
  const wfEnd = html.indexOf('function renderQueueCurrent(', wfStart);
  assert.ok(wfStart > 0 && wfEnd > wfStart);
  const renderedFractions = [];
  const wfSandbox = {
    state: {
      currentId: 't_bp',
      tracks: [{ id: 't_bp', duration: 200 }],
      waveformPeaks: new Float32Array([0.2, 0.8]),
      isFullscreen: false,
      waveformHoverFraction: null,
      miniHudHoverFraction: null
    },
    audio: { currentTime: 0, duration: NaN },
    library: { renderWaveformCanvas: (_c, _p, frac) => renderedFractions.push(frac) },
    document: { getElementById: (id) => (id === 'waveform-canvas' ? { id } : null) },
    syncCanvasDimensions: () => {},
    getCurrentPlaybackPositionSeconds: () => 50,
    getCurrentPlaybackDurationSeconds: () => 200,
    Math
  };
  vm.runInNewContext(html.slice(wfStart, wfEnd) + '\nrenderWaveformSeekbar();', wfSandbox);
  assert.deepEqual(renderedFractions, [0.25], 'renderWaveformSeekbar must use unified Bit-Perfect position & duration');
});
