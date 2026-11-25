'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));
const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const serviceJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java'),
  'utf8'
);
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

describe('v3.9.101 R1: Android Old/New AVRCP, Headset Buttons, Becoming-Noisy & Bit-Perfect Route Recovery', () => {
  it('1. AndroidManifest, NocturnePlaybackService & MainActivity wire MEDIA_BUTTON receiver, API 33+ KeyEvent & MediaStyle token', () => {
    assert.match(
      manifest,
      /<service[\s\S]*?android:name="\.NocturnePlaybackService"[\s\S]*?<action\s+android:name="android\.intent\.action\.MEDIA_BUTTON"\s*\/>/,
      'AndroidManifest.xml must declare MEDIA_BUTTON intent-filter on NocturnePlaybackService'
    );

    assert.ok(serviceJava.includes('Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())'), 'NocturnePlaybackService must handle ACTION_MEDIA_BUTTON');
    assert.ok(serviceJava.includes('getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class)'), 'NocturnePlaybackService must guard API 33+ KeyEvent parcelable');
    assert.ok(serviceJava.includes('startForeground(NOTIFICATION_ID, fgNotif'), 'NocturnePlaybackService must call startForeground on ACTION_MEDIA_BUTTON');
    assert.ok(serviceJava.includes('MainActivity.getActiveInstance()'), 'NocturnePlaybackService must forward to active MainActivity');

    const initMsSlice = extractBetween(mainJava, 'private void initMediaSession()', 'private void createNotificationChannelIfNeeded()');
    assert.ok(initMsSlice.includes('getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class)'), 'initMediaSession must use typed getParcelableExtra on API 33+');
    assert.ok(
      initMsSlice.includes('if (ke != null && isMediaKey(ke.getKeyCode())) {\n                            if (ke.getAction() == KeyEvent.ACTION_DOWN && ke.getRepeatCount() == 0) {\n                                handleMediaKey(ke.getKeyCode());\n                            }\n                            return true;\n                        }'),
      'initMediaSession must preserve v3-9-80 KeyEvent consumption block'
    );
    assert.ok(initMsSlice.includes('mMediaSession.setMediaButtonReceiver(mbPendingIntent)'), 'initMediaSession must set MediaButtonReceiver');
    assert.ok(initMsSlice.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0'), 'MediaButtonReceiver PendingIntent must use FLAG_MUTABLE on API 31+');

    const notifSlice = extractBetween(mainJava, 'private void showMediaNotification(String title, String artist, String album, boolean isPlaying, boolean preservePrepopulated)', 'private void cancelMediaNotification()');
    assert.ok(notifSlice.includes('Notification.MediaStyle()') && notifSlice.includes('mediaStyle.setMediaSession(token)'), 'showMediaNotification must attach MediaStyle with MediaSession token');
    assert.ok(notifSlice.includes('builder.setOngoing(true);') && notifSlice.includes('builder.setOngoing(false);'), 'showMediaNotification must keep ongoing flag parity');
  });

  it('2. findPreferredBitPerfectDevice prioritizes BT/BLE ahead of speaker/earpiece, route telemetry checks isSink(), and BitPerfectAudioPlayer uses AtomicInteger flags + guarded AudioTrack calls', () => {
    const prefSlice = extractBetween(mainJava, 'public AudioDeviceInfo findPreferredBitPerfectDevice()', 'public boolean isBitPerfectSupported()');
    const usbIdx = prefSlice.indexOf('TYPE_USB_DEVICE');
    const wiredIdx = prefSlice.indexOf('TYPE_WIRED_HEADPHONES');
    const btIdx = prefSlice.indexOf('TYPE_BLUETOOTH_A2DP');
    const bleIdx = prefSlice.indexOf('TYPE_BLE_HEADSET');
    const spkIdx = prefSlice.indexOf('TYPE_BUILTIN_SPEAKER');
    const earIdx = prefSlice.indexOf('TYPE_BUILTIN_EARPIECE');
    assert.ok(usbIdx > 0 && wiredIdx > usbIdx && btIdx > wiredIdx && bleIdx > btIdx && spkIdx > bleIdx && earIdx > spkIdx,
      'findPreferredBitPerfectDevice must order USB -> Wired/Line -> BT A2DP / BLE Audio -> Built-in Speaker -> non-earpiece sinks');

    const routeSlice = extractBetween(mainJava, 'public String getAudioOutputRouteName()', 'public int getScreenBrightnessPercent()');
    assert.ok(routeSlice.includes('!d.isSink()') && routeSlice.includes('TYPE_LINE_DIGITAL') && routeSlice.includes('TYPE_AUX_LINE'), 'getAudioOutputRouteName must filter isSink() and include LINE_DIGITAL/AUX_LINE');
    assert.ok(routeSlice.includes('TYPE_BLE_HEADSET') && routeSlice.includes('Bluetooth LE Audio'), 'getAudioOutputRouteName must handle API 31+ BLE Audio');

    const extSlice = extractBetween(mainJava, 'public boolean isExternalAudioGearConnected()', 'public boolean isAudioFocusHeld()');
    assert.ok(extSlice.includes('!d.isSink()') && extSlice.includes('isExternalAudioSinkType(d.getType())'), 'isExternalAudioGearConnected must filter isSink() and delegate to isExternalAudioSinkType');

    const notifySlice = extractBetween(mainJava, 'private void notifyUsbDacChange(AudioDeviceInfo[] devices, boolean connected)', 'private void registerMediaNotificationReceiver()');
    assert.ok(notifySlice.includes('triggerAudioBecomingNoisy("DEVICE_REMOVED")') && notifySlice.includes('triggerAudioBecomingNoisy("USB_DAC_REMOVED")'), 'Must preserve v3-9-97 noisy triggers');
    assert.ok(notifySlice.includes('triggerAudioBecomingNoisy("BT_OR_WIRED_REMOVED")') && notifySlice.includes('!hasActiveUsbOrWiredHeadphoneSink()'), 'Must trigger becoming-noisy when BT/Wired disconnects leaving no USB/Wired');

    const bpClass = extractBetween(mainJava, 'public class BitPerfectAudioPlayer {', 'private final BitPerfectAudioPlayer mBitPerfectPlayer');
    assert.ok(bpClass.includes('private final AtomicInteger mRouteRefreshFlags = new AtomicInteger(0);'));
    assert.equal((bpClass.match(/mRouteRefreshFlags\.getAndSet\(0\)/g) || []).length, 2, 'Both outer and mid-buffer loops must atomically drain mRouteRefreshFlags');
    const mixerFalseWrites = bpClass.match(/^\s*mPreferredMixerAttributesSet\s*=\s*false\s*;/gm) || [];
    assert.equal(mixerFalseWrites.length, 2, 'mPreferredMixerAttributesSet = false must remain strictly inside mMixerLock');
    assert.ok(bpClass.includes('pendingErrorReason = "[ROUTE] Bit-Perfect AudioTrack play failed: "'), 'track.play() IllegalStateException must surface [ROUTE] instead of crashing');
  });

  it('3. JS onHardwarePlay/Pause inspect activeDeck/standbyAudio/dsdWorker, onAndroidAudioDeviceChanged queries remaining route, and updateMediaSession syncs Chromium 74', () => {
    const hwSlice = extractBetween(html, 'window.onHardwarePlayPause =', 'window.onHardwareNext =');
    let clicks = 0;
    let standbyPaused = 0;
    let playBtnText = '▶';
    const hwSandbox = {
      window: {},
      $: id => (id === 'play-button' ? { textContent: playBtnText, click: () => { clicks++; } } : null),
      audio: { paused: true, src: '', dataset: {} },
      standbyAudio: { paused: false, src: 'blob:sb', dataset: { trackId: 'cur' }, _upgradingFullAudio: false, pause() { standbyPaused++; this.paused = true; } },
      state: {
        currentId: 'cur',
        tracks: [{ id: 'cur', title: 'Cur' }],
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        activeDeck: null,
        corsBypassAudio: null,
        dsdWorker: null
      }
    };
    vm.runInNewContext(hwSlice, hwSandbox);

    // standbyAudio playing matching currentId while audio is paused -> onHardwarePlay is no-op, onHardwarePause clicks pause
    hwSandbox.window.onHardwarePlay();
    assert.equal(clicks, 0, 'onHardwarePlay must not toggle when standbyAudio is playing');
    hwSandbox.window.onHardwarePause();
    assert.equal(clicks, 1, 'onHardwarePause must pause when standbyAudio is playing matching track');

    // Regression 1c.1: standbyAudio playing outgoing/mismatched track -> onHardwarePause MUST pause standbyAudio directly without calling audio.play() via #play-button
    const btnPlayHandlerSlice = extractBetween(html, "$('play-button').addEventListener('click', async () => {", "$('previous-button').addEventListener");
    let audioPlayCalls = 0;
    let notifPaused = 0;
    let savedSessions = 0;
    const mismatchSandbox = {
      Date, Math, Number, String, Boolean, Promise, URL, console, setTimeout, clearTimeout,
      library,
      window: { NocturneNative: { updateMediaNotification: (_t, _a, _al, playing) => { if (playing === false) notifPaused++; } } },
      navigator: { mediaSession: { playbackState: 'playing' } },
      $: id => {
        if (!mismatchSandbox._els[id]) {
          mismatchSandbox._els[id] = {
            textContent: 'Ⅱ',
            click() { if (this._onClick) return this._onClick(); },
            addEventListener(ev, fn) { if (ev === 'click') this._onClick = fn; }
          };
        }
        return mismatchSandbox._els[id];
      },
      _els: {},
      audio: {
        paused: true,
        src: 'blob:new-track',
        dataset: { trackId: 'tB' },
        _upgradingFullAudio: false,
        _userPausedDuringUpgrade: false,
        removeAttribute() {},
        pause() { this.paused = true; },
        play() { audioPlayCalls++; this.paused = false; return Promise.resolve(); }
      },
      standbyAudio: {
        paused: false,
        src: 'blob:old-track',
        dataset: { trackId: 'tA' },
        _upgradingFullAudio: false,
        _userPausedDuringUpgrade: false,
        pause() { this.paused = true; }
      },
      state: {
        currentId: 'tB',
        tracks: [{ id: 'tA', title: 'Track A' }, { id: 'tB', title: 'Track B' }],
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        playGeneration: 0,
        activeDeck: null,
        context: { state: 'running', currentTime: 1, resume: () => Promise.resolve() },
        corsBypassAudio: null,
        dsdWorker: null
      },
      isSilentUnlockSrc: () => false,
      setupAudio: () => {},
      boundPlayButtonCtxResume: () => Promise.resolve(),
      syncPlaybackButtonsUi: p => { mismatchSandbox.$('play-button').textContent = p ? 'Ⅱ' : '▶'; },
      updatePositionState: () => {},
      savePlaybackSession: () => { savedSessions++; },
      playTrack: () => { audioPlayCalls++; },
      toast: () => {}
    };
    vm.runInNewContext(
      `${btnPlayHandlerSlice.replace(/^\s*const nativeBpActiveNow/, "$('play-button').addEventListener('click', async () => {\nconst nativeBpActiveNow")}\n${hwSlice}`,
      mismatchSandbox
    );
    mismatchSandbox.window.onHardwarePause();
    assert.equal(mismatchSandbox.standbyAudio.paused, true, '1c.1: onHardwarePause must pause mismatched standbyAudio');
    assert.equal(mismatchSandbox.audio.paused, true, '1c.1: onHardwarePause must NEVER call audio.play() when standbyAudio is mismatched');
    assert.equal(audioPlayCalls, 0, '1c.1: audio.play() must not be invoked');
    assert.equal(mismatchSandbox.navigator.mediaSession.playbackState, 'paused');
    assert.equal(notifPaused, 1);
    assert.equal(savedSessions, 1);

    // Active dsdWorker before audio.src starts -> onHardwarePlay is no-op, onHardwarePause cancels worker cleanly
    let workerCancelled = 0;
    let workerTerminated = 0;
    hwSandbox.standbyAudio.paused = true;
    hwSandbox.state.dsdWorker = { id: 'w1', postMessage() { workerCancelled++; }, terminate() { workerTerminated++; } };
    hwSandbox.state.isPlaybackLoading = true;
    hwSandbox.stopDsdWorker = () => {};
    hwSandbox.setPlaybackLoading = v => { hwSandbox.state.isPlaybackLoading = Boolean(v); };
    hwSandbox.window.onHardwarePlay();
    assert.equal(hwSandbox.state.dsdWorker !== null, true, 'onHardwarePlay must not cancel in-flight DSD worker');
    hwSandbox.window.onHardwarePause();
    assert.equal(hwSandbox.state.dsdWorker, null, 'onHardwarePause must cancel and clear in-flight DSD worker');
    assert.equal(workerCancelled, 1);
    assert.equal(workerTerminated, 1);

    // onAndroidAudioDeviceChanged queries remaining native route on disconnect and updates mini HUD
    const devSlice = extractBetween(html, 'window.onAndroidAudioDeviceChanged = (deviceName, connected) => {', '// === v2.8.0:');
    let miniHudUpdates = 0;
    let routeResponse = 'Bluetooth Hi-Res';
    const devSandbox = {
      window: { NocturneNative: { getAudioOutputRouteName: () => routeResponse } },
      audio: { paused: true },
      state: { currentId: 't1', tracks: [{ id: 't1', title: 'T1' }], androidAudioDeviceName: 'FiiO KA17', isNativeBitPerfectPlaying: false },
      toast: () => {},
      renderRoomSignal: () => {},
      syncRoomOutputText: () => {},
      updateMiniPlayerHud: () => { miniHudUpdates++; },
      refreshAudioOutputDevices: () => Promise.resolve()
    };
    vm.runInNewContext(devSlice, devSandbox);
    devSandbox.window.onAndroidAudioDeviceChanged('FiiO KA17', false);
    assert.equal(devSandbox.state.androidAudioDeviceName, 'Bluetooth Hi-Res', 'Disconnecting USB DAC while BT remains active must switch androidAudioDeviceName to Bluetooth Hi-Res');
    assert.equal(miniHudUpdates, 1, 'onAndroidAudioDeviceChanged must refresh mini player HUD');

    routeResponse = 'Phone Speaker';
    devSandbox.window.onAndroidAudioDeviceChanged('Bluetooth Hi-Res', false);
    assert.equal(devSandbox.state.androidAudioDeviceName, '', 'Phone Speaker fallback must clear androidAudioDeviceName');

    // Chromium 74 updateMediaSession & updatePositionState native PLAYBACK_POSITION_UNKNOWN sync
    const msSlice = extractBetween(html, 'function updateMediaSession(track) {', 'let isUserScrolling = false;');
    const nativePosCalls = [];
    const c74Sandbox = {
      library,
      navigator: {}, // Chromium 74 lacks navigator.mediaSession
      window: {
        NocturneNative: {
          updateMediaSessionPosition: (p, d, pl) => nativePosCalls.push({ p, d, pl })
        }
      },
      audio: { paused: false, ended: false, currentTime: 0, duration: NaN, playbackRate: 1 },
      state: { currentId: 't1', tracks: [{ id: 't1', duration: 123 }], isNativeBitPerfectPlaying: false, isNativeBitPerfectPaused: false, activeDeck: null }
    };
    vm.runInNewContext(`${msSlice}\nthis.updateMediaSession = updateMediaSession;`, c74Sandbox);
    c74Sandbox.updateMediaSession(c74Sandbox.state.tracks[0]);
    c74Sandbox.state.currentId = 't2';
    c74Sandbox.updateMediaSession({ id: 't2', duration: 0 });
    assert.deepEqual(
      nativePosCalls,
      [
        { p: 0, d: 123000, pl: true },
        { p: -1, d: 0, pl: true }
      ],
      'Chromium 74 must push known position 0 when track.duration is known and PLAYBACK_POSITION_UNKNOWN (-1) when duration is unknown'
    );
  });

  it('4. onAndroidAudioBecomingNoisy blocks speaker blast on sliceEndedEarly & mid-DSD done and avoids duplicate native pause', async () => {
    const noisySlice = extractBetween(html, 'window.onAndroidAudioBecomingNoisy = () => {', 'window.onAndroidAudioDeviceChanged =');
    const upSlice = extractBetween(html, 'async function upgradeSliceToFullAudio(', 'async function fetchCloudTrack(');
    const dsdSlice = extractBetween(html, 'async function playDsdTrack(', 'function playNext(');

    let playCalls = 0;
    let nativePauseCalls = 0;
    let nativeNotifCalls = 0;
    const deckHandlers = {};
    const track = {
      id: 'cloud_slice_1',
      source: 'google',
      name: 'HiRes.flac',
      title: 'HiRes',
      format: 'FLAC',
      url: 'blob:slice-early',
      firstSlicePlayback: true,
      sliceEndedEarly: true,
      lastSlicePosition: 2.0,
      fullAudioPromise: null
    };
    const deck = {
      src: 'blob:slice-early',
      paused: true,
      ended: true,
      currentTime: 2.0,
      duration: 200,
      dataset: { trackId: 'cloud_slice_1' },
      _upgradingFullAudio: false,
      _userPausedDuringUpgrade: false,
      addEventListener(ev, fn) { (deckHandlers[ev] = deckHandlers[ev] || []).push(fn); },
      load() { this.paused = true; },
      pause() { this.paused = true; },
      play() { playCalls++; this.paused = false; return Promise.resolve(); }
    };
    let resolveFetch;
    const sandbox = {
      Date, Math, Number, String, Boolean, Promise, Object, URL, Blob, console, setTimeout, clearTimeout,
      performance: { now: () => 500 },
      location: { href: 'https://nocturne.local/' },
      $: () => ({ textContent: '▶', classList: { add() {}, remove() {} }, setAttribute() {} }),
      navigator: { mediaSession: { playbackState: 'playing' } },
      window: {
        __androidNoisyNativeWasPlaying: true,
        NocturneNative: {
          pauseBitPerfectPlayback: () => { nativePauseCalls++; },
          updateMediaNotification: () => { nativeNotifCalls++; }
        }
      },
      audio: deck,
      standbyAudio: { src: '', paused: true, _upgradingFullAudio: false, _userPausedDuringUpgrade: false, pause() {} },
      state: {
        currentId: 'cloud_slice_1',
        tracks: [track],
        objectUrls: new Set(['blob:slice-early']),
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        playGeneration: 1,
        activeDeck: { element: deck, router: { gain: { value: 1, setTargetAtTime() {} } } },
        context: { currentTime: 1, state: 'running', resume: () => Promise.resolve() },
        corsBypassAudio: null,
        dsdWorker: null
      },
      library: {
        fetchAudioBlob: () => new Promise(r => { resolveFetch = r; }),
        normalizeAudioBlob: b => b
      },
      isGraphContentUrl: () => false,
      finishCloudMetadataInBackground: () => {},
      releaseTrackUrl: () => {},
      formatTime: s => String(Math.round(s)),
      syncSeek: () => {},
      updatePositionState: () => {},
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      stopDsdWorker: () => {},
      setPlaybackLoading: v => { sandbox.state.isPlaybackLoading = Boolean(v); },
      toast: () => {},
      mediaErrorMessage: e => String(e)
    };
    vm.runInNewContext(`${noisySlice}\n${upSlice}\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;`, sandbox);

    const upPromise = sandbox.upgradeSliceToFullAudio(track, 'blob:slice-early', 'https://drive.example/1', {}, 'Google Drive');
    // Headphones unplugged while sliceEndedEarly=true and fullAudioPromise is still downloading!
    sandbox.window.onAndroidAudioBecomingNoisy();
    assert.equal(deck._userPausedDuringUpgrade, true, 'Must stamp _userPausedDuringUpgrade during sliceEndedEarly waiting for fullAudioPromise');
    assert.equal(nativePauseCalls, 0, 'Must skip duplicate native pauseBitPerfectPlayback when __androidNoisyNativeWasPlaying is true');
    assert.equal(nativeNotifCalls, 1, 'Must sync paused notification state once via updateMediaNotification');

    sandbox.state.isNativeBitPerfectPlaying = false;
    resolveFetch(new Blob(['full-audio-bytes'], { type: 'audio/flac' }));
    await upPromise;
    for (const fn of deckHandlers.loadedmetadata || []) fn();
    await new Promise(r => setImmediate(r));
    assert.equal(playCalls, 0, 'upgradeSliceToFullAudio loadedmetadata must NOT play onto speaker after becoming-noisy during sliceEndedEarly');

    // Verify playDsdTrack !wasSlicePlaying branch also respects audio._userPausedDuringUpgrade
    assert.ok(
      dsdSlice.includes('if (!wasSlicePlaying) {\n            if (audio._userPausedDuringUpgrade)'),
      'playDsdTrack !wasSlicePlaying branch must guard against audio._userPausedDuringUpgrade'
    );
  });

  it('5. Regression 1c.2: window.onHardwarePause during firstSlicePlayback && sliceEndedEarly blocks speaker blast after fullAudioPromise resolves', async () => {
    const hwSlice = extractBetween(html, 'window.onHardwarePlayPause =', 'window.onHardwareNext =');
    const upSlice = extractBetween(html, 'async function upgradeSliceToFullAudio(', 'async function fetchCloudTrack(');

    let playCalls = 0;
    let notifPaused = 0;
    let savedSessions = 0;
    const deckHandlers = {};
    const track = {
      id: 'cloud_slice_hw_pause',
      source: 'google',
      name: 'HiRes.flac',
      title: 'HiRes',
      format: 'FLAC',
      url: 'blob:slice-hw-early',
      firstSlicePlayback: true,
      sliceEndedEarly: true,
      lastSlicePosition: 2.0,
      fullAudioPromise: null
    };
    const deck = {
      src: 'blob:slice-hw-early',
      paused: true,
      ended: true,
      currentTime: 2.0,
      duration: 200,
      dataset: { trackId: 'cloud_slice_hw_pause' },
      _upgradingFullAudio: false,
      _userPausedDuringUpgrade: false,
      addEventListener(ev, fn) { (deckHandlers[ev] = deckHandlers[ev] || []).push(fn); },
      load() { this.paused = true; },
      pause() { this.paused = true; },
      play() { playCalls++; this.paused = false; return Promise.resolve(); }
    };
    let resolveFetch;
    const sandbox = {
      Date, Math, Number, String, Boolean, Promise, Object, URL, Blob, console, setTimeout, clearTimeout,
      library,
      performance: { now: () => 500 },
      location: { href: 'https://nocturne.local/' },
      $: () => ({ textContent: '▶', classList: { add() {}, remove() {} }, setAttribute() {} }),
      navigator: { mediaSession: { playbackState: 'playing' } },
      window: {
        NocturneNative: {
          updateMediaNotification: (_t, _a, _al, playing) => { if (playing === false) notifPaused++; }
        }
      },
      audio: deck,
      standbyAudio: { src: '', paused: true, _upgradingFullAudio: false, _userPausedDuringUpgrade: false, pause() {} },
      state: {
        currentId: 'cloud_slice_hw_pause',
        tracks: [track],
        objectUrls: new Set(['blob:slice-hw-early']),
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        playGeneration: 1,
        activeDeck: { element: deck, router: { gain: { value: 1, setTargetAtTime() {} } } },
        context: { currentTime: 1, state: 'running', resume: () => Promise.resolve() },
        corsBypassAudio: null,
        dsdWorker: null
      },
      fetchAudioBlobMock: null,
      isGraphContentUrl: () => false,
      finishCloudMetadataInBackground: () => {},
      releaseTrackUrl: () => {},
      formatTime: s => String(Math.round(s)),
      syncSeek: () => {},
      updatePositionState: () => {},
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      savePlaybackSession: () => { savedSessions++; },
      stopDsdWorker: () => {},
      setPlaybackLoading: v => { sandbox.state.isPlaybackLoading = Boolean(v); },
      toast: () => {},
      mediaErrorMessage: e => String(e)
    };
    sandbox.library = Object.assign({}, library, {
      fetchAudioBlob: () => new Promise(r => { resolveFetch = r; }),
      normalizeAudioBlob: b => b
    });
    vm.runInNewContext(`${hwSlice}\n${upSlice}\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;`, sandbox);

    const upPromise = sandbox.upgradeSliceToFullAudio(track, 'blob:slice-hw-early', 'https://drive.example/1', {}, 'Google Drive');
    // Hardware Pause pressed while sliceEndedEarly=true, audio.paused=true, audio._upgradingFullAudio=false, fullAudioPromise pending
    sandbox.window.onHardwarePause();
    assert.equal(deck._userPausedDuringUpgrade, true, '1c.2: onHardwarePause must stamp _userPausedDuringUpgrade during sliceEndedEarly');
    assert.equal(sandbox.standbyAudio._userPausedDuringUpgrade, true, '1c.2: onHardwarePause must stamp standbyAudio._userPausedDuringUpgrade');
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused');
    assert.equal(notifPaused, 1);
    assert.equal(savedSessions, 1);

    resolveFetch(new Blob(['full-audio-bytes'], { type: 'audio/flac' }));
    await upPromise;
    for (const fn of deckHandlers.loadedmetadata || []) fn();
    await new Promise(r => setImmediate(r));
    assert.equal(playCalls, 0, '1c.2: upgradeSliceToFullAudio must NOT start playing after onHardwarePause during sliceEndedEarly');
    assert.equal(deck.paused, true);
  });
});
