'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. MainActivity.java reuses single AudioFocusRequest (no self-pause on resume/skip) & non-blocking BitPerfect pause/seek/resume', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  // 1a. Single reusable AudioFocusRequest + mHasAudioFocus short-circuit + legacy listener reuse
  const afStart = java.indexOf('public boolean requestAudioFocus()');
  const afEnd = java.indexOf('public void abandonAudioFocus()', afStart);
  assert.ok(afStart > 0 && afEnd > afStart);
  const afSrc = java.slice(afStart, afEnd);
  assert.ok(afSrc.includes('if (mAudioFocusRequest == null) {'), 'Must lazily allocate and reuse a single AudioFocusRequest');
  assert.ok(afSrc.includes('if (mHasAudioFocus) {\n                return true;\n            }'), 'Must short-circuit when audio focus is already held');
  assert.ok(afSrc.includes('if (mLegacyAudioFocusListener == null) {'), 'Must reuse legacy focus listener on pre-Oreo');

  // 1b. onResume syncs native Bit-Perfect Play/Pause state in addition to position
  const onResumeStart = java.indexOf('protected void onResume()');
  const onResumeEnd = java.indexOf('public void onWindowFocusChanged(', onResumeStart);
  assert.ok(onResumeStart > 0 && onResumeEnd > onResumeStart);
  const onResumeSrc = java.slice(onResumeStart, onResumeEnd);
  assert.ok(onResumeSrc.includes('final boolean bpPlayingNow = syncBpPos && mBitPerfectPlayer.isPlaying();'));
  assert.ok(onResumeSrc.includes('window.onNativeBitPerfectStateChange'));

  // 1c. BitPerfectAudioPlayer resume, format-change guard & WRITE_NON_BLOCKING chunk loop
  const bpStart = java.indexOf('public class BitPerfectAudioPlayer {');
  const bpEnd = java.indexOf('private final BitPerfectAudioPlayer mBitPerfectPlayer', bpStart);
  assert.ok(bpStart > 0 && bpEnd > bpStart);
  const bp = java.slice(bpStart, bpEnd);
  assert.ok(bp.includes('if (track.getPlayState() != AudioTrack.PLAYSTATE_PLAYING)'), 'resume() must start PLAYSTATE_STOPPED as well as PLAYSTATE_PAUSED');
  assert.ok(bp.includes('if (!mIsPaused && track.getPlayState() != AudioTrack.PLAYSTATE_PLAYING)'), 'playback loop must resume non-playing track cleanly');
  assert.ok(bp.includes('AudioTrack.WRITE_NON_BLOCKING'), 'PCM loop must use WRITE_NON_BLOCKING for instant pause/seek/skip responsiveness');
  assert.ok(bp.includes('boolean abortedForSeek = false;'));
  assert.ok(bp.includes('if (!abortedForSeek && !mIsStopped && !mIsPaused && mPlaybackEpoch.get() == epoch)'));
  assert.ok(bp.includes('if (!mIsStopped && !mIsPaused && mWebView != null)'));
});

test('2. WebView never steals Android AudioFocus from active Bit-Perfect via unlockAudioContextOnGesture, row click or foreground lifecycle', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const unlockStart = html.indexOf('const unlockAudioContextOnGesture = () => {');
  const unlockEnd = html.indexOf("$('add-files').addEventListener('click'", unlockStart);
  assert.ok(unlockStart > 0 && unlockEnd > unlockStart);

  let resumeCalls = 0;
  let bpActiveNative = false;
  const docListeners = {};
  const sandbox = {
    state: {
      isNativeBitPerfectPlaying: true,
      context: { state: 'suspended', resume() { resumeCalls++; return Promise.resolve(); } }
    },
    window: {
      NocturneNative: { isBitPerfectActive: () => bpActiveNative }
    },
    document: {
      addEventListener(ev, fn) { docListeners[ev] = fn; }
    }
  };
  vm.runInNewContext(html.slice(unlockStart, unlockEnd), sandbox);
  assert.equal(typeof docListeners.touchend, 'function');

  // While state.isNativeBitPerfectPlaying is true -> must NOT resume AudioContext
  docListeners.pointerdown();
  docListeners.touchend();
  docListeners.click();
  assert.equal(resumeCalls, 0);

  // Even if JS flag is false, if native isBitPerfectActive() is true -> must NOT resume AudioContext
  sandbox.state.isNativeBitPerfectPlaying = false;
  bpActiveNative = true;
  docListeners.touchend();
  assert.equal(resumeCalls, 0);

  // When Native Bit-Perfect is completely inactive -> resumes suspended AudioContext normally
  bpActiveNative = false;
  docListeners.touchend();
  assert.equal(resumeCalls, 1);

  // handleTrackRowActivation & onAndroidAppLifecycle guards
  assert.ok(html.includes('const willUseNativeBpRow = Boolean(track && typeof isTrackRoutedToNativeBitPerfect === \'function\' && isTrackRoutedToNativeBitPerfect(track));'));
  assert.ok(html.includes('if (!state.isNativeBitPerfectPlaying && curAudio && !curAudio.paused) {'));
});

test('3. FiiO M11S Fast-Tap capture isolation, reliable 1-tap transport buttons & native source-of-truth play/pause', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 3a. Fast-Tap click capture must NOT swallow #play-button clicks after tapping a track row
  const ftStart = html.indexOf('let touchStartTarget = null;');
  const ftEnd = html.indexOf('const unlockAudioContextOnGesture = () => {', ftStart);
  assert.ok(ftStart > 0 && ftEnd > ftStart);

  const docEvents = {};
  const rowEl = {
    disabled: false,
    clicked: 0,
    click() { this.clicked++; },
    contains(t) { return t === this; },
    closest(sel) { return sel.includes('#play-button') ? null : this; }
  };
  const playBtnEl = {
    disabled: false,
    clicked: 0,
    click() { this.clicked++; },
    contains(t) { return t === this; },
    closest(sel) { return sel.includes('#play-button') ? this : this; }
  };
  const ftSandbox = {
    touchStartPos: null,
    touchStartTime: 0,
    Date,
    Math,
    document: {
      addEventListener(ev, fn) { docEvents[ev] = fn; }
    }
  };
  vm.runInNewContext(html.slice(ftStart, ftEnd), ftSandbox);

  // Tap track row via touch -> Fast-Tap clicks rowEl
  docEvents.touchstart({ touches: [{ clientX: 50, clientY: 100 }], target: rowEl });
  docEvents.touchend({ changedTouches: [{ clientX: 52, clientY: 101 }], target: rowEl });
  assert.equal(rowEl.clicked, 1);

  // Duplicate trusted click on rowEl IS suppressed
  let rowBlocked = false;
  docEvents.click({ isTrusted: true, target: rowEl, preventDefault() { rowBlocked = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(rowBlocked, true, 'Duplicate trusted click on fast-tapped row must be deduplicated');

  // Re-tap row, then immediately tap #play-button within 50ms -> #play-button click MUST NOT be blocked!
  docEvents.touchstart({ touches: [{ clientX: 50, clientY: 100 }], target: rowEl });
  docEvents.touchend({ changedTouches: [{ clientX: 52, clientY: 101 }], target: rowEl });
  let playBlocked = false;
  docEvents.click({ isTrusted: true, target: playBtnEl, preventDefault() { playBlocked = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(playBlocked, false, 'Trusted click on #play-button right after tapping a track row must NEVER be swallowed');

  // 3b. attachReliableTransportTap fires 1-tap on 12px thumb drift & deduplicates delayed trusted click
  const tapStart = html.indexOf('function attachReliableTransportTap(el) {');
  const tapEnd = html.indexOf("['play-button', 'room-play'", tapStart);
  assert.ok(tapStart > 0 && tapEnd > tapStart);
  const btnListeners = {};
  let btnClicks = 0;
  const transportBtn = {
    disabled: false,
    addEventListener(ev, fn) { btnListeners[ev] = fn; },
    click() { btnClicks++; }
  };
  const tapSandbox = { Date, Math };
  vm.runInNewContext(html.slice(tapStart, tapEnd), tapSandbox);
  tapSandbox.attachReliableTransportTap(transportBtn);

  btnListeners.touchstart({ touches: [{ clientX: 200, clientY: 600 }] });
  let preventedTouchEnd = false;
  btnListeners.touchend({ cancelable: true, preventDefault() { preventedTouchEnd = true; }, changedTouches: [{ clientX: 212, clientY: 608 }] });
  assert.equal(preventedTouchEnd, true);
  assert.equal(btnClicks, 1, '12px thumb drift tap must trigger transport button immediately');

  let dupClickBlocked = false;
  btnListeners.click({ isTrusted: true, preventDefault() { dupClickBlocked = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(dupClickBlocked, true, 'Delayed native trusted click right after touch tap must be suppressed');

  // 3c. handleNativeBitPerfectPlayPauseClick trusts native isBitPerfectPlaying() even if JS state drifted
  const bpHandlerStart = html.indexOf('function handleNativeBitPerfectPlayPauseClick()');
  const playBtnEnd = html.indexOf("$('previous-button').addEventListener('click'", bpHandlerStart);
  assert.ok(bpHandlerStart > 0 && playBtnEnd > bpHandlerStart);
  let pauseCalls = 0;
  let resumeCalls = 0;
  let clickFn = null;
  const bpSandbox = {
    $: (id) => (id === 'play-button' ? { addEventListener(ev, fn) { if (ev === 'click') clickFn = fn; }, textContent: '▶', classList: { remove() {} } } : null),
    state: {
      isNativeBitPerfectPlaying: false, // stale JS flag!
      isNativeBitPerfectPaused: true,   // stale JS flag!
      tracks: []
    },
    audio: { paused: true, src: '' },
    standbyAudio: { paused: true, src: '' },
    window: {
      NocturneNative: {
        isBitPerfectActive: () => true,
        isBitPerfectPlaying: () => true, // hardware is actually playing!
        pauseBitPerfectPlayback: () => { pauseCalls++; },
        resumeBitPerfectPlayback: () => { resumeCalls++; }
      },
      onNativeBitPerfectStateChange: (p) => {
        if (p) bpSandbox.state.isNativeBitPerfectPlaying = true;
        bpSandbox.state.isNativeBitPerfectPaused = !p;
      }
    },
    Boolean, Date, String, Number, console
  };
  vm.runInNewContext(html.slice(bpHandlerStart, playBtnEnd), bpSandbox);
  await clickFn();
  assert.equal(pauseCalls, 1, 'Must trust native isBitPerfectPlaying()=true and pause instead of double-resuming');
  assert.equal(resumeCalls, 0);
  assert.equal(bpSandbox.state.isNativeBitPerfectPlaying, true);
  assert.equal(bpSandbox.state.isNativeBitPerfectPaused, true);

  // 3d. Mobile footer transport z-index & CUE Bit-Perfect seek offset
  assert.ok(html.includes('z-index: 25 !important;\n        pointer-events: auto !important;'));
  assert.ok(html.includes('z-index: 26 !important;'));
  assert.ok(html.includes('const sec = Math.max(0, cueOffset + (ratio * dur));'));
  assert.ok(html.includes('const targetSec = Math.max(0, cueOffset + (ratio * dur));'));
});

test('4. Version consistency v3.9.53+ / versionCode >= 107', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const release = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[3-9]|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[3-9]|[6-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)\b/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 107, 'versionCode must be >= 107');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[3-9]|[6-9]\d|\d{3,})"/);
  assert.match(java, /"3\.9\.(5[3-9]|[6-9]\d|\d{3,})"/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[3-9]|[6-9]\d|\d{3,})/);
  assert.match(release, /'v3\.9\.(5[3-9]|[6-9]\d|\d{3,})'/);
});
