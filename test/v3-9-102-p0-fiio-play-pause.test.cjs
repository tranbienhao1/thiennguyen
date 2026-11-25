'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
const svcJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java'), 'utf8');
const releaseScript = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e !== -1, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

describe('v3.9.102 P0-A — FiiO M11S & Android (Old API 26–30 + New API 31–35+) Play/Pause', () => {
  it('R1a: attachReliableTransportTap suppresses 650ms/1050ms ghost clicks after Chromium 74 pointerdown and guards 260ms Play/Pause bounce', () => {
    const fnSrc = extractBetween(html, 'function attachReliableTransportTap(el) {', "['play-button', 'room-play'");
    const createMockBtn = id => {
      const listeners = {};
      return {
        id,
        disabled: false,
        clicks: 0,
        listeners,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        click() { this.clicks += 1; }
      };
    };

    let nowMs = 5000;
    const sandbox = { Date: { now: () => nowMs } };
    vm.runInNewContext(fnSrc, sandbox);

    // 1. Play button: delayed ghost clicks at 650ms & 1050ms after Chromium 74 compatibility pointerdown
    const playBtn = createMockBtn('play-button');
    sandbox.attachReliableTransportTap(playBtn);

    let touchEndStopped = false;
    playBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 40, clientY: 40 }] }));
    playBtn.listeners.touchend.forEach(fn => fn({
      cancelable: true,
      preventDefault() {},
      stopPropagation() { touchEndStopped = true; },
      changedTouches: [{ clientX: 40, clientY: 40 }]
    }));
    assert.equal(playBtn.clicks, 1);
    assert.equal(touchEndStopped, true, 'touchend must call e.stopPropagation() when available');
    assert.equal(playBtn._touchTapGhostPending, true);

    // Chromium 74 compatibility pointerdown 50ms later must NOT clear _touchTapGhostPending
    nowMs = 5050;
    playBtn.listeners.pointerdown.forEach(fn => fn({ pointerType: 'mouse' }));
    assert.equal(playBtn._touchTapGhostPending, true);

    // 650ms ghost click is swallowed
    nowMs = 5650;
    let stopped650 = false;
    playBtn.listeners.click.forEach(fn => fn({
      isTrusted: true,
      preventDefault() { stopped650 = true; },
      stopPropagation() { stopped650 = true; },
      stopImmediatePropagation() { stopped650 = true; }
    }));
    assert.equal(stopped650, true, '650ms ghost click must be swallowed');

    // Re-tap at t=8000ms and test 1050ms ghost click
    nowMs = 8000;
    playBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 40, clientY: 40 }] }));
    playBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 40, clientY: 40 }] }));
    assert.equal(playBtn.clicks, 2);
    nowMs = 9050;
    let stopped1050 = false;
    playBtn.listeners.click.forEach(fn => fn({
      isTrusted: true,
      preventDefault() { stopped1050 = true; },
      stopPropagation() { stopped1050 = true; },
      stopImmediatePropagation() { stopped1050 = true; }
    }));
    assert.equal(stopped1050, true, '1050ms ghost click must be swallowed within 1200ms window');

    // 2. Bounce guard: 260ms for Play/Pause buttons vs 120ms for other buttons
    const roomPlayBtn = createMockBtn('room-play');
    sandbox.attachReliableTransportTap(roomPlayBtn);
    nowMs = 12000;
    roomPlayBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 10, clientY: 10 }] }));
    roomPlayBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 10, clientY: 10 }] }));
    assert.equal(roomPlayBtn.clicks, 1);

    nowMs = 12200; // 200ms later -> blocked by 260ms Play/Pause guard
    roomPlayBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 10, clientY: 10 }] }));
    roomPlayBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 10, clientY: 10 }] }));
    assert.equal(roomPlayBtn.clicks, 1, 'Play/Pause finger bounce within 260ms must be ignored');

    nowMs = 12270; // 270ms later -> allowed
    roomPlayBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 10, clientY: 10 }] }));
    roomPlayBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 10, clientY: 10 }] }));
    assert.equal(roomPlayBtn.clicks, 2, 'Play/Pause tap >= 260ms later must work');

    const nextBtn = createMockBtn('next-button');
    sandbox.attachReliableTransportTap(nextBtn);
    nowMs = 15000;
    nextBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 10, clientY: 10 }] }));
    nextBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 10, clientY: 10 }] }));
    nowMs = 15150; // 150ms later -> allowed (>120ms)
    nextBtn.listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 10, clientY: 10 }] }));
    nextBtn.listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 10, clientY: 10 }] }));
    assert.equal(nextBtn.clicks, 2, 'Non-Play/Pause button retains 120ms bounce threshold');

    // 3. Real mouse pointerdown >= 1200ms clears ghost pending cleanly
    nowMs = 17000;
    playBtn.listeners.pointerdown.forEach(fn => fn({ pointerType: 'mouse' }));
    assert.equal(playBtn._touchTapGhostPending, false);
    let stoppedRealMouse = false;
    playBtn.listeners.click.forEach(fn => fn({
      isTrusted: true,
      preventDefault() { stoppedRealMouse = true; },
      stopPropagation() { stoppedRealMouse = true; },
      stopImmediatePropagation() { stoppedRealMouse = true; }
    }));
    assert.equal(stoppedRealMouse, false);
  });

  it('R1b: WebView navigator.mediaSession pause/play ignores Android AudioFocus self-pause while preserving Web/PWA behavior', async () => {
    const msSlice = extractBetween(
      html,
      "        action('play', async () => {",
      "        action('previoustrack', () => playNext(-1));"
    );

    const runWithEnv = (hasNative) => {
      const handlers = {};
      const nativeCalls = [];
      const stateChanges = [];
      let webPaused = false;
      const sandbox = {
        action: (name, fn) => { handlers[name] = fn; },
        $: () => ({ textContent: '' }),
        state: {
          currentId: 't1',
          isNativeBitPerfectPlaying: true,
          isNativeBitPerfectPaused: false,
          tracks: [{ id: 't1', title: 'Track 1', duration: 240 }]
        },
        audio: {
          currentTime: 20,
          duration: 240,
          paused: false,
          play: async () => {},
          pause: () => { webPaused = true; }
        },
        library,
        window: hasNative ? {
          NocturneNative: {
            resumeBitPerfectPlayback: () => nativeCalls.push('resume'),
            pauseBitPerfectPlayback: () => nativeCalls.push('pause')
          },
          onNativeBitPerfectStateChange: v => stateChanges.push(v)
        } : {},
        Math, Number, Boolean
      };
      vm.runInNewContext(msSlice, sandbox);
      return { handlers, nativeCalls, stateChanges, sandbox, getWebPaused: () => webPaused };
    };

    // Android APK: Bit-Perfect active -> WebView navigator.mediaSession 'pause' & duplicate 'play' must NOT kill Native playback
    const androidEnv = runWithEnv(true);
    await androidEnv.handlers.play();
    androidEnv.handlers.pause();
    assert.deepEqual(androidEnv.nativeCalls, [], 'WebView navigator.mediaSession pause/play must not stop or double-resume active NocturneNative Bit-Perfect');
    assert.deepEqual(androidEnv.stateChanges, []);

    // Android APK: when paused, 'play' still resumes
    androidEnv.sandbox.state.isNativeBitPerfectPaused = true;
    await androidEnv.handlers.play();
    assert.deepEqual(androidEnv.nativeCalls, ['resume']);
    assert.deepEqual(androidEnv.stateChanges, [true]);

    // Web/PWA (no NocturneNative): audio.pause() runs normally
    const webEnv = runWithEnv(false);
    webEnv.sandbox.state.isNativeBitPerfectPlaying = false;
    webEnv.handlers.pause();
    assert.equal(webEnv.getWebPaused(), true, 'Non-Android Web/PWA must still pause HTML5 audio');
  });

  it('R1c: MainActivity.java & NocturnePlaybackService.java deduplicate KeyEvent.getDownTime(), Play/Pause key-group, MediaSession callbacks, and notification intents', () => {
    assert.ok(mainJava.includes('private static boolean isPlayPauseMediaKey(int keyCode)'));
    assert.ok(mainJava.includes('private volatile long mLastPlayPauseTransportAtMs = 0L;'));
    assert.ok(mainJava.includes('private volatile long mLastHardwareKeyDownTimeMs = -1L;'));
    assert.ok(mainJava.includes('private volatile int mLastHardwareKeyDownCode = -1;'));
    assert.ok(mainJava.includes('private volatile long mLastNotifPlayPauseAtMs = 0L;'));
    assert.ok(mainJava.includes('public boolean isDuplicateMediaKeyEvent(@Nullable KeyEvent ke)'));
    assert.ok(mainJava.includes('public void handleMediaKeyEvent(@Nullable KeyEvent ke)'));
    assert.ok(mainJava.includes('if (isPlayPauseMediaKey(keyCode))') && mainJava.includes('< 450L'));
    assert.ok(mainJava.includes('if (keyCode == mLastHardwareMediaKeyCode && (nowKeyElapsed - mLastHardwareMediaKeyAtMs) < 180L)'));

    // Wired across all entry points
    const dispatchSlice = extractBetween(mainJava, 'public boolean dispatchKeyEvent(KeyEvent event)', 'public boolean onKeyUp(');
    assert.ok(dispatchSlice.includes('handleMediaKeyEvent(event);'));
    const newIntentSlice = extractBetween(mainJava, 'protected void onNewIntent(Intent intent)', 'public static class BoundedFileInputStream');
    assert.ok(newIntentSlice.includes('handleMediaKeyEvent(ke);'));
    assert.ok(newIntentSlice.includes('mLastNotifPlayPauseAtMs') && newIntentSlice.includes('>= 350L'));
    assert.ok(svcJava.includes('active.handleMediaKeyEvent(ke);'));

    const initMsSlice = extractBetween(mainJava, 'private void initMediaSession()', 'mMediaSession.setPlaybackState');
    assert.ok(initMsSlice.includes('if (isDuplicateMediaKeyEvent(ke))'));
    assert.ok(initMsSlice.includes('public void onPlay()') && initMsSlice.includes('public void onPause()') && initMsSlice.includes('public void onStop()'));
    const dispatchPlaySlice = extractBetween(mainJava, 'public void dispatchPlayToWeb()', 'public void dispatchPauseToWeb()');
    const dispatchPauseSlice = extractBetween(mainJava, 'public void dispatchPauseToWeb()', 'public void dispatchNextToWeb()');
    assert.ok(dispatchPlaySlice.includes('mLastPlayPauseTransportAtMs') && dispatchPlaySlice.includes('< 450L') && dispatchPlaySlice.includes('mInMediaKeyTransportDispatch'));
    assert.ok(dispatchPauseSlice.includes('mLastPlayPauseTransportAtMs') && dispatchPauseSlice.includes('< 450L') && dispatchPauseSlice.includes('mInMediaKeyTransportDispatch'));

    const notifRxSlice = extractBetween(mainJava, 'private final BroadcastReceiver mMediaNotificationReceiver', 'private boolean mIsBecomingNoisyRegistered');
    assert.ok(notifRxSlice.includes('mLastNotifPlayPauseAtMs') && notifRxSlice.includes('>= 350L') && notifRxSlice.includes('mLastPlayPauseTransportAtMs = nowNotif;'));
  });

  it('R1d: MainActivity.java protects screen-off AudioFocus, legacy API < 26 listener, and slow cloud AudioTrack.play()', () => {
    const afSlice = extractBetween(mainJava, 'public boolean requestAudioFocus()', 'public void abandonAudioFocus()');
    assert.ok(afSlice.includes('(!mIsInBackground && (android.os.SystemClock.elapsedRealtime() - mLastBitPerfectStartOrResumeElapsedMs) < 1500L) || (android.os.SystemClock.elapsedRealtime() - mLastBitPerfectStartOrResumeElapsedMs) < 1200L'));
    const legacySlice = afSlice.slice(afSlice.indexOf('if (mLegacyAudioFocusListener == null)'));
    const legacy1200Matches = legacySlice.match(/mLastBitPerfectStartOrResumeElapsedMs\) < 1200L/g) || [];
    assert.equal(legacy1200Matches.length, 2, 'mLegacyAudioFocusListener must guard both AUDIOFOCUS_LOSS and AUDIOFOCUS_LOSS_TRANSIENT within 1200L ms');

    const loopSlice = extractBetween(mainJava, '// 8. Playback loop', 'MediaCodec.BufferInfo info =');
    const tsIdx = loopSlice.indexOf('mLastBitPerfectStartOrResumeElapsedMs = android.os.SystemClock.elapsedRealtime();');
    const playIdx = loopSlice.indexOf('track.play();');
    assert.ok(tsIdx !== -1 && playIdx !== -1 && tsIdx < playIdx, 'runPlaybackLoop must refresh mLastBitPerfectStartOrResumeElapsedMs immediately before track.play()');
  });

  it('R3: Version bump v3.9.102 / versionCode 156 parity across all files', () => {
    assert.ok(html.includes('FiiO M11S · v3.9.102'));
    assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.102';"));
    assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.102';"));
    assert.ok(gradle.includes('versionCode = 156'));
    assert.ok(gradle.includes('versionName = "3.9.102"'));
    assert.ok(mainJava.includes('"3.9.102"'));
    assert.ok(releaseScript.includes("'v3.9.102'") && releaseScript.includes('(versionCode 156)'));
  });
});
