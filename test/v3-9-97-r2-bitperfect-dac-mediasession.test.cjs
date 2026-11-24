'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const serviceJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java'),
  'utf8'
);

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, 'Missing start marker: ' + startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, 'Missing end marker: ' + endMarker);
  return src.slice(s, e);
}

describe('v3.9.97 R2 — Bit-Perfect USB DAC Hot-Swap, Cross-Format Transitions, MediaSession & HUD Telemetry', () => {
  it('R2-1: USB DAC hot-swap multi-sink scan, becoming-noisy, mAudioTrack nulling, sample-rate fallback, downmix preservation & paused route fallback', () => {
    // 1. Java: notifyUsbDacChange multi-sink scan & USB removal noisy trigger
    const notifyDacSlice = sliceBetween(
      mainJava,
      'private void notifyUsbDacChange(AudioDeviceInfo[] devices, boolean connected)',
      'private void registerMediaNotificationReceiver()'
    );
    assert.ok(notifyDacSlice.includes('boolean hasUsbDacChange = false;'), 'notifyUsbDacChange must scan all devices instead of breaking on first sink');
    assert.ok(notifyDacSlice.includes('TYPE_USB_DEVICE') && notifyDacSlice.includes('TYPE_USB_HEADSET'), 'notifyUsbDacChange must prioritize USB DAC devices');
    assert.ok(notifyDacSlice.includes('triggerAudioBecomingNoisy("DEVICE_REMOVED")'), 'Must keep DEVICE_REMOVED becoming-noisy trigger');
    assert.ok(notifyDacSlice.includes('else if (!connected && hasUsbDacChange)') && notifyDacSlice.includes('triggerAudioBecomingNoisy("USB_DAC_REMOVED")'), 'Must trigger becoming-noisy on USB DAC removal even if other sinks remain');

    // 2. Java: immediate mAudioTrack = null on release, sample-rate fallback, format16 mixer & downmixOutBuf preservation
    const bpClass = sliceBetween(mainJava, 'public class BitPerfectAudioPlayer {', 'private final BitPerfectAudioPlayer mBitPerfectPlayer');
    assert.ok(bpClass.includes('targetDevice.getSampleRates()'), 'rebuildAudioTrackWith16BitFallback must inspect targetDevice.getSampleRates()');
    assert.ok(bpClass.includes('convertPcmChunkTo16BitResampled('), 'Must resample decoded PCM when AudioTrack falls back to a lower sample rate');
    assert.ok(bpClass.includes('transcodeCarryBuffer('), 'Must preserve and transcode downmixOutBuf across encoding/rate switches');
    assert.ok(bpClass.includes('applyPreferredMixerLocked(epoch, audioAttributes, targetDevice, format16)'), 'Must pass format16 to API 34 preferred mixer on 16-bit fallback');
    assert.ok(bpClass.includes('track.getPlayState() != AudioTrack.PLAYSTATE_PLAYING') && bpClass.includes('zeroWriteStallCount'), 'Must verify PLAYSTATE_PLAYING before track.write and break bounded stalls');
    assert.ok(bpClass.includes('pendingErrorReason = "[ROUTE] Bit-Perfect route switch AudioTrack uninitialized"'), 'Route rebuild failure must tag [ROUTE]');
    assert.ok(bpClass.includes('if (pendingErrorReason == null && !mIsStopped && mPlaybackEpoch.get() == epoch) {\n                                    pendingErrorReason = "AudioTrack write error (" + written + ")";') || bpClass.includes('if (pendingErrorReason == null && !mIsStopped && mPlaybackEpoch.get() == epoch) {'), 'Post-write error must guard pendingErrorReason == null so [ROUTE] is never overwritten');
    assert.ok(bpClass.includes('private volatile boolean mPreferredMixerAttributesSet = false;'), 'mPreferredMixerAttributesSet must be volatile');
    const mixerFalseWrites = bpClass.match(/^\s*mPreferredMixerAttributesSet\s*=\s*false\s*;/gm) || [];
    assert.equal(mixerFalseWrites.length, 2, 'mPreferredMixerAttributesSet = false must only occur inside mMixerLock (applyPreferredMixerLocked & clearPreferredMixerIfMatches); got ' + mixerFalseWrites.length);
    assert.ok(bpClass.includes('winStartMs + winDurMs - 140L'), 'cueBoundaryCrossed must use 140L margin to avoid sub-ms Math.round delay');

    const routeNullMatches = bpClass.match(/if\s*\(mAudioTrack\s*==\s*track(?:\s*\|\|\s*sessionCurrent)?\)\s*\{\s*mAudioTrack\s*=\s*null;\s*\}/g) || [];
    assert.ok(routeNullMatches.length >= 5, 'Expected immediate mAudioTrack = null across outer, format-change, inner, dead-object, and finally paths; got ' + routeNullMatches.length);

    // 3. JS: onNativeBitPerfectError skips 5-min blacklist for paused route teardown while keeping non-paused decode blacklist
    const bpSlice = sliceBetween(html, 'function resetBitPerfectModeBadge()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const els = {};
    const mkEl = () => ({ textContent: '', title: '', className: '', value: '0', checked: true, matches: () => false, addEventListener: () => {}, classList: { remove() {}, add() {} }, setAttribute() {}, style: { setProperty() {} } });
    const getEl = id => (els[id] || (els[id] = mkEl()));

    const pausedTrack = { id: 't-hi', title: 'HiRes Track', source: 'local' };
    const activeTrack = { id: 't-err', title: 'Corrupt Track', source: 'local' };
    const sandbox = {
      $: getEl,
      window: {},
      console,
      Date,
      Number,
      Boolean,
      Math,
      String,
      audio: { paused: true },
      state: {
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: true,
        lastBitPerfectPositionSec: 42.5,
        bitPerfectLockedFormat: { sampleRate: 192000, bitDepth: 24, mixerBitPerfect: true, deviceName: 'FiiO KA17' },
        currentId: 't-hi',
        tracks: [pausedTrack, activeTrack],
        lyrics: []
      },
      syncPlaybackButtonsUi: () => {},
      renderQueueCurrent: () => {},
      syncAutoplayButton: () => {},
      updateSleepStatus: () => {},
      renderLyrics: () => {},
      formatTime: s => String(Math.floor(Number(s) || 0)),
      formatRemainingTime: () => '-0:00',
      paintSeek: () => {},
      scheduleTrackRender: () => {},
      renderRecentTracks: () => {},
      updateCurrentTrackIndicator: () => {},
      updatePositionState: () => {},
      playTrack: () => {},
      playNext: () => {},
      toast: () => {},
      setInterval: () => 0,
      clearInterval: () => {}
    };
    vm.runInNewContext(bpSlice + '\nsetupBitPerfectIntegration();', sandbox);

    sandbox.window.onNativeBitPerfectError('[ROUTE] Bit-Perfect route switch AudioTrack uninitialized', 42500);
    assert.equal(pausedTrack._nativeBpFallbackUntil, 0, 'Paused [ROUTE] teardown must NOT set 5-min Bit-Perfect blacklist');
    assert.equal(pausedTrack._skipNativeBpOnce, undefined, 'Paused [ROUTE] teardown must allow immediate Bit-Perfect resume when DAC reconnects');
    assert.equal(pausedTrack._resumeAfterBpFallbackSec, 42.5);
    assert.equal(sandbox.state.bitPerfectLockedFormat, null);
    assert.equal(getEl('bitperfect-mode-badge').textContent, 'DIRECT ON');
    assert.equal(getEl('bitperfect-mode-badge').title, '');

    // Active non-route decode error still blacklists for 5 minutes
    sandbox.state.currentId = 't-err';
    sandbox.state.isNativeBitPerfectPlaying = true;
    sandbox.state.isNativeBitPerfectPaused = false;
    const beforeErr = Date.now();
    sandbox.window.onNativeBitPerfectError('MediaCodec decode error', 10000);
    assert.ok(activeTrack._nativeBpFallbackUntil >= beforeErr + 4 * 60 * 1000, 'Active decode error must still apply 5-min fallback window');
  });

  it('R2-2: Cross-format CUE transitions, async playTrack position-bleed guard, DSD rate/CUE parity, MediaCodec PCM & HttpRange serialization', async () => {
    // 1. Java assertions: StreamLaunchParams, KEY_PCM_ENCODING alignment, no 0-byte non-EOS queue, mStreamIoLock, durMmr cap, clearPreferredMixerIfMatches
    const bpClass = sliceBetween(mainJava, 'public class BitPerfectAudioPlayer {', 'private final BitPerfectAudioPlayer mBitPerfectPlayer');
    assert.ok(bpClass.includes('private static final class StreamLaunchParams') && bpClass.includes('mEpochLaunchParams'), 'Must isolate stream params per epoch');
    assert.ok(bpClass.includes('runPlaybackLoop(trimmedUrl, sampleRate, bitDepth, playbackEpoch);'), 'Must preserve 4-arg runPlaybackLoop call');
    assert.ok(bpClass.includes('clearPreferredMixerIfMatches(0);') && bpClass.includes('clearPreferredMixerIfMatches(epoch);'), 'Must clear API 34 preferred mixer attributes in both stopInternal and finally');
    assert.ok(bpClass.includes('decoder.getOutputFormat()') && bpClass.includes('boolean codecForced16Bit = false;'), 'Must align initial AudioTrack encoding with post-configure MediaCodec output format');
    assert.ok(bpClass.includes('int pendingInputIndex = -1;') && !bpClass.includes('decoder.queueInputBuffer(inIndex, 0, 0, 0, 0)'), 'Must never queue 0-byte non-EOS buffers into MediaCodec');
    assert.ok(bpClass.includes('private final Object mStreamIoLock = new Object();') && bpClass.includes('synchronized (mStreamIoLock) {'), 'HttpRangeMediaDataSource must serialize fetchChunkWithRecovery under mStreamIoLock');
    assert.ok(bpClass.includes('durMmr budget exceeded') && bpClass.includes('streamKnownDurationMs'), 'durMmr must skip when duration known and bound HTTP probes');

    // 2. JS behavioral tests: CUE auto-advance, same-parent reuse, repeat=2, async await position bleed, CUE->DSD rate adaptation & CUE offsets
    const bpSlice = sliceBetween(html, 'function resetBitPerfectModeBadge()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const setupAudioSlice = sliceBetween(html, 'function setupAudio() {', 'state.limiter = createSoftLimiter(state.context);') + '\n}';
    const playTrackSlice = sliceBetween(html, 'function resolvePlayTrackEntry(trackId) {', 'function stopDsdWorker(');
    const playDsdSlice = sliceBetween(html, 'async function playDsdFirstSlice(', 'async function pickLocalFiles()');

    const els = {};
    const mkEl = id => ({
      id,
      textContent: '',
      value: id === 'volume' ? '100' : '0',
      checked: true,
      dataset: {},
      matches: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
      removeAttribute: () => {},
      setAttribute: () => {},
      classList: { add() {}, remove() {}, toggle() {} },
      style: { setProperty() {} }
    });
    const getEl = id => (els[id] || (els[id] = mkEl(id)));

    const nativeCalls = [];
    let bpActive = true;
    const fakeAudio = {
      src: '',
      currentTime: 0,
      duration: 600,
      paused: true,
      ended: false,
      readyState: 2,
      volume: 1,
      muted: false,
      dataset: {},
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      load() {},
      removeAttribute() {},
      addEventListener() {}
    };
    const fakeStandby = { ...fakeAudio, dataset: {}, addEventListener() {} };
    const createdCtxRates = [];
    class FakeAudioContext {
      constructor(opts) {
        this.sampleRate = (opts && opts.sampleRate) || 48000;
        createdCtxRates.push(this.sampleRate);
        this.state = 'running';
        this.currentTime = 0;
      }
      createAnalyser() { return { fftSize: 256, smoothingTimeConstant: 0.82, connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }

    const cue1 = { id: 'cue-1', title: 'Track 1', isCue: true, cueStart: 0, cueEnd: 120, duration: 120, source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2Falbum.flac', sampleRate: 96000, bitDepth: 24, format: 'FLAC' };
    const cue2 = { id: 'cue-2', title: 'Track 2', isCue: true, cueStart: 120, cueEnd: 240, duration: 120, source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2Falbum.flac', sampleRate: 96000, format: 'FLAC' };
    const dsdCue = { id: 'dsd-cue-2', title: 'DSD Track 2', isDsd: true, isCue: true, cueStart: 65, cueEnd: 185, duration: 120, source: 'local', file: { size: 1024 }, sampleRate: 2822400, format: 'DSF' };
    const webTrack = { id: 'web-1', title: 'Web Blob', source: 'local', url: 'blob:http://localhost/abc', sampleRate: 44100, bitDepth: 16, format: 'FLAC', duration: 180 };

    let releaseLocalPerm = null;
    let fakeWorkerInstance = null;
    class FakeWorker {
      constructor() { fakeWorkerInstance = this; }
      postMessage() {}
      terminate() {}
    }

    class FakeURL extends URL {}
    FakeURL.createObjectURL = () => 'blob:http://localhost/dsd-out';
    FakeURL.revokeObjectURL = () => {};

    const sandbox = {
      $: getEl,
      library,
      URL: FakeURL,
      Worker: FakeWorker,
      dsdWorkerBaseUrl: 'http://localhost/',
      location: { href: 'http://localhost/index.html', protocol: 'http:' },
      navigator: { onLine: true },
      document: { hidden: false },
      audio: fakeAudio,
      standbyAudio: fakeStandby,
      AudioContext: FakeAudioContext,
      window: {
        AudioContext: FakeAudioContext,
        NocturneNative: {
          isBitPerfectSupported: () => true,
          isBitPerfectActive: () => bpActive,
          setBitPerfectKnownDuration: ms => nativeCalls.push({ fn: 'knownDur', ms }),
          setBitPerfectTrackWindow: (s, d, t, a, al) => nativeCalls.push({ fn: 'win', s, d, t, a, al }),
          startBitPerfectPlayback: (u, r, b) => { bpActive = true; nativeCalls.push({ fn: 'start', u, r, b }); return true; },
          seekBitPerfectPlayback: ms => nativeCalls.push({ fn: 'seek', ms }),
          resumeBitPerfectPlayback: () => nativeCalls.push({ fn: 'resume' }),
          pauseBitPerfectPlayback: () => nativeCalls.push({ fn: 'pause' }),
          stopBitPerfectPlayback: () => { bpActive = false; nativeCalls.push({ fn: 'stop' }); },
          getBitPerfectDuration: () => 600000
        }
      },
      state: {
        currentId: 'cue-1',
        tracks: [cue1, cue2, dsdCue, webTrack],
        queueTrackIds: [],
        objectUrls: new Set(['blob:http://localhost/abc']),
        isSeeking: false,
        isPlaybackLoading: false,
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        lastBitPerfectPositionSec: 119.9,
        dsdOutputRate: 176400,
        dsdOutputDepth: 24,
        playGeneration: 0,
        preloadGeneration: 0,
        lyrics: [],
        repeat: 0,
        autoplay: true,
        roonRadio: false,
        zones: [{ id: 'zone_dsp', name: 'DSP' }],
        roonZones: [],
        activeZoneId: 'zone_dsp'
      },
      isTrackRoutedToNativeBitPerfect: t => Boolean(t && !t.isDsd && t.url && !t.url.startsWith('blob:')),
      suspendWebAudioForBitPerfect: () => {},
      abortStaleFullAudioUpgrades: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      unlockAudioDecksOnGesture: () => {},
      setPlaybackLoading: v => { sandbox.state.isPlaybackLoading = Boolean(v); },
      ensureLocalTrackPlayableUrl: () => new Promise(res => { releaseLocalPerm = res; }),
      resetAbLoop: () => {},
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      renderQueue: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      renderQueueCurrent: () => {},
      syncAutoplayButton: () => {},
      updateSleepStatus: () => {},
      renderLyrics: () => {},
      renderRecentTracks: () => {},
      updateCurrentTrackIndicator: () => {},
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      updatePositionState: () => {},
      recordHistory: () => {},
      pruneExcessObjectUrls: () => {},
      scheduleTrackRender: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      renderWaveformSeekbar: () => {},
      savePlaybackSession: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor((d - c) / 60)}:${String(Math.floor((d - c) % 60)).padStart(2, '0')}`,
      isSilentUnlockSrc: () => false,
      createSoftLimiter: () => ({ connect() {}, disconnect() {} }),
      createSubBassPunchNodes: () => null,
      createTubeEmulationNodes: () => null,
      createDsdUltrasonicNodes: () => null,
      createSubBassPhaseNodes: () => null,
      dsdSourceInfo: r => (r === 2822400 ? { baseRate: 44100, multiplier: 64 } : null),
      getCachedFirstSlice: async () => { throw new Error('Should not read first-slice cache when cueStart > 0.5'); },
      cacheFirstSlice: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      preloadNext: () => {},
      queueTracks: () => [],
      trackById: id => sandbox.state.tracks.find(t => t.id === id) || null,
      resolveActiveAlbumTracks: () => null,
      safeResumeAudioContext: async () => {},
      finishPlaybackStart: () => {},
      releaseTrackUrl: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      toast: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      performance: { now: () => 100 },
      localStorage: { setItem() {}, getItem() { return null; } },
      console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
      Date, Math, Number, String, Boolean, Promise, URLSearchParams, Set, Map, JSON
    };
    vm.runInNewContext(
      bpSlice + '\n' + setupAudioSlice + '\n' + playTrackSlice + '\n' + playDsdSlice + '\nsetupBitPerfectIntegration();',
      sandbox
    );

    // 2a. CUE1 -> CUE2 auto-advance at 119.9s: playTrack starts, holds position bleed during await, reuses same-parent native session
    sandbox.window.onNativeBitPerfectPosition(119900, 600000);
    assert.equal(sandbox.state.currentId, 'cue-2', 'Auto-advance should switch currentId to cue-2');
    assert.equal(sandbox.state._bpAwaitingStart, true, 'playTrack must guard against position bleed while awaiting');

    // Outgoing thread fires a stale end-of-cue1 callback while playTrack is suspended on await: must be ignored!
    const preBleedTrackDur = cue2.duration;
    sandbox.window.onNativeBitPerfectPosition(120000, 600000);
    assert.equal(sandbox.state.currentId, 'cue-2', 'Position bleed during async await must NOT prematurely re-advance cue-2');
    assert.equal(cue2.duration, preBleedTrackDur);

    // Resolve await -> completes same-parent CUE transition without calling stopBitPerfectPlayback!
    releaseLocalPerm();
    await new Promise(r => setImmediate(r));
    assert.equal(sandbox.state._bpAwaitingStart, false);
    assert.equal(nativeCalls.some(c => c.fn === 'stop'), false, 'Same-parent CUE -> CUE must NOT call stopBitPerfectPlayback');
    assert.equal(nativeCalls.some(c => c.fn === 'seek'), false, 'Gapless CUE -> CUE auto-advance within 1.5s skips unnecessary seek');
    assert.ok(nativeCalls.some(c => c.fn === 'win' && c.s === 120000 && c.d === 120000 && c.t === 'Track 2'), 'Same-parent CUE transition must update native CUE window metadata');

    // 2b. Repeat-one (repeat === 2) on CUE2 reuses native session and seeks back to 120s
    nativeCalls.length = 0;
    sandbox.state.repeat = 2;
    sandbox.state.lastBitPerfectPositionSec = 239.9;
    sandbox.window.onNativeBitPerfectPosition(239900, 600000);
    assert.equal(sandbox.state.currentId, 'cue-2');
    releaseLocalPerm();
    await new Promise(r => setImmediate(r));
    assert.equal(nativeCalls.some(c => c.fn === 'stop'), false, 'repeat===2 CUE must stay in native session');
    assert.ok(nativeCalls.some(c => c.fn === 'seek' && c.ms === 120000), 'repeat===2 CUE must seek back to cueStart');

    // 2c. CUE2 -> DSD+CUE stops native Bit-Perfect, adapts AudioContext to dsdOutputRate (176400, NOT 2822400), skips 0..2s slice, preserves CUE duration & seeks to 65s
    nativeCalls.length = 0;
    sandbox.state.repeat = 0;
    const playDsdPromise = sandbox.playTrack('dsd-cue-2');
    releaseLocalPerm();
    await new Promise(r => setImmediate(r));
    assert.ok(nativeCalls.some(c => c.fn === 'stop'), 'CUE -> DSD transition MUST call stopBitPerfectPlayback');
    assert.equal(sandbox.state.isNativeBitPerfectPlaying, false);
    assert.ok(createdCtxRates.length > 0 && !createdCtxRates.includes(2822400), 'setupAudio must NEVER pass raw 2.8MHz DSD rate to AudioContext');
    assert.ok(createdCtxRates.includes(176400), 'setupAudio must adapt AudioContext sampleRate to dsdOutputRate (176400)');

    // Worker emits first-slice (must be ignored for cueStart > 0.5) and then done with parent duration 300s
    await fakeWorkerInstance.onmessage({ data: { type: 'first-slice', blob: { size: 100 }, duration: 2, sliceDecodeMs: 10 } });
    assert.equal(fakeAudio.src, '', 'DSD+CUE with cueStart > 0.5 must skip 0..2s first-slice');
    await fakeWorkerInstance.onmessage({ data: { type: 'done', blob: { size: 5000 }, duration: 300, rate: 2822400, channels: 2, multiplier: 64, targetRate: 176400, decimation: 16, bitDepth: 24 } });
    await playDsdPromise;
    assert.equal(dsdCue.duration, 120, 'DSD+CUE done message must preserve CUE subtrack duration (120s), not overwrite with parent 300s');
    assert.equal(fakeAudio.currentTime, 65, 'DSD+CUE done must seek audio.currentTime to cueStart (65s)');
  });

  it('R2-3: MediaSession periodic sync, CUE-relative coords, placeholder suppression & unified notification cleanup', () => {
    // 1. JS: updatePositionState throttling during onNativeBitPerfectPosition + CUE-relative coords
    const bpSlice = sliceBetween(html, 'function resetBitPerfectModeBadge()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const posSlice = sliceBetween(html, 'function getCurrentPlaybackPositionSeconds()', 'function savePlaybackSession(');
    const msSlice = sliceBetween(html, 'let lastPositionStateSecond = -1;', 'let isUserScrolling = false;');

    const els = {};
    const mkEl = () => ({ textContent: '', value: '0', matches: () => false, addEventListener: () => {}, style: { setProperty() {} } });
    const getEl = id => (els[id] || (els[id] = mkEl()));

    const webMsStates = [];
    const nativeMsCalls = [];
    let livePosMs = 165100;
    const sandbox = {
      $: getEl,
      library,
      audio: { paused: true, currentTime: 0, duration: 0 },
      navigator: {
        mediaSession: {
          setPositionState: st => webMsStates.push(st)
        }
      },
      window: {
        NocturneNative: {
          getBitPerfectPosition: () => livePosMs,
          getBitPerfectDuration: () => 600000,
          updateMediaSessionPosition: (p, d, pl) => nativeMsCalls.push({ p, d, pl })
        }
      },
      state: {
        currentId: 'cue-2',
        tracks: [{ id: 'cue-2', title: 'Track 2', cueStart: 120, cueEnd: 240, duration: 120 }],
        isSeeking: false,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        lyrics: []
      },
      syncSeek: () => {},
      paintSeek: () => {},
      formatTime: s => String(Math.floor(s)),
      formatRemainingTime: () => '-0',
      setInterval: () => 0,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean
    };
    vm.runInNewContext(
      bpSlice + '\n' + posSlice + '\n' + msSlice + '\nsetupBitPerfectIntegration();',
      sandbox
    );

    // 165.1s and 165.6s (both floor to 45s relative) -> only 1 MediaSession update
    sandbox.window.onNativeBitPerfectPosition(165100, 600000);
    livePosMs = 165600;
    sandbox.window.onNativeBitPerfectPosition(165600, 600000);
    assert.equal(nativeMsCalls.length, 1, 'MediaSession position sync must throttle within the same integer second');
    assert.deepEqual(nativeMsCalls[0], { p: 45100, d: 120000, pl: true }, 'MediaSession must receive CUE-relative position and duration');

    // 166.1s (46s relative) -> triggers next throttled update
    livePosMs = 166100;
    sandbox.window.onNativeBitPerfectPosition(166100, 600000);
    assert.equal(nativeMsCalls.length, 2);
    assert.equal(nativeMsCalls[1].p, 46100);

    // 2. Java: MainActivity & NocturnePlaybackService notification unification + CUE window + periodic sync
    assert.ok(mainJava.includes('NOTIFICATION_CHANNEL_ID = NocturnePlaybackService.CHANNEL_ID'), 'MainActivity must share NocturnePlaybackService.CHANNEL_ID');
    assert.ok(mainJava.includes('NOTIFICATION_ID = NocturnePlaybackService.NOTIFICATION_ID'), 'MainActivity must share NocturnePlaybackService.NOTIFICATION_ID');
    assert.ok(mainJava.includes('builder.setOngoing(true);') && mainJava.includes('builder.setOngoing(false);'), 'showMediaNotification must set ongoing based on isPlaying');
    assert.ok(mainJava.includes('NocturnePlaybackService.syncBackgroundPauseIfRunning('), 'MainActivity must sync NocturnePlaybackService when background pause falls back');
    assert.ok(mainJava.includes('NocturnePlaybackService.stopIfRunning()'), 'cancelMediaNotification must stop NocturnePlaybackService cleanly');
    assert.ok(serviceJava.includes('syncBackgroundPauseIfRunning(') && serviceJava.includes('STOP_FOREGROUND_DETACH'), 'NocturnePlaybackService must support background pause detach');
    assert.ok(mainJava.includes('public void setBitPerfectTrackWindow(long cueStartMs, long cueDurationMs, String title, String artist, String album)'), 'WebAppInterface must expose setBitPerfectTrackWindow');
    assert.ok(mainJava.includes('if (!winTitle.isEmpty())'), 'BitPerfectAudioPlayer.start must use JS metadata when supplied to avoid placeholder flashes');
    assert.ok(mainJava.includes('cueBoundaryCrossed') && mainJava.includes('lastMediaSessionSyncElapsedMs'), 'runPlaybackLoop must enforce CUE boundary even in background and periodically sync MediaSession');
  });

  it('R2-4: Bit-Perfect HUD badge resets, computeSignalPath Native/USB DAC telemetry & DSD non-bit-perfect accuracy', () => {
    // 1. library.computeSignalPath backwards compatibility + Native Bit-Perfect + DSD
    const flacTrack = { id: 'f1', title: 'Test FLAC', format: 'FLAC', source: 'local', sampleRate: 192000, bitDepth: 24, channels: 2 };
    const legacyPath = library.computeSignalPath(flacTrack, { contextRate: 48000, eqEnabled: true, eqPreset: 'jazz', eqPreamp: -2 });
    assert.equal(legacyPath.hasDsp, true);
    assert.equal(legacyPath.qualityLabel, 'HI-RES · ENHANCED');
    assert.ok(legacyPath.steps[3].description.includes('AudioContext Destination · 48.0 kHz'));

    const nativeBpPath = library.computeSignalPath(flacTrack, {
      contextRate: 48000,
      eqEnabled: true,
      isNativeBitPerfect: true,
      bitPerfectEnabled: true,
      bitPerfectLockedFormat: { sampleRate: 192000, bitDepth: 24, mixerBitPerfect: true, deviceName: 'FiiO KA17' }
    });
    assert.equal(nativeBpPath.hasDsp, false, 'Native Bit-Perfect must report DSP bypassed even if EQ toggle is checked');
    assert.equal(nativeBpPath.isNativeBitPerfect, true);
    assert.equal(nativeBpPath.qualityLabel, 'BIT-PERFECT');
    assert.equal(nativeBpPath.steps[1].badge, 'Bit-Perfect Direct');
    assert.equal(nativeBpPath.steps[2].badge, 'Bit-perfect');
    assert.ok(nativeBpPath.steps[3].description.includes('FiiO KA17') && nativeBpPath.steps[3].description.includes('192 kHz') && nativeBpPath.steps[3].description.includes('24-bit'));

    const dsdTrack = { id: 'd1', title: 'DSD64', format: 'DSF', isDsd: true, dsdMultiplier: 64, sampleRate: 2822400, pcmRate: 176400, pcmBitDepth: 24, source: 'local' };
    const dsdPath = library.computeSignalPath(dsdTrack, { isNativeBitPerfect: false, bitPerfectEnabled: true, dsdOutputRate: 176400, dsdOutputDepth: 24 });
    assert.equal(dsdPath.qualityTier, 'dsd');
    assert.equal(dsdPath.steps[1].badge, 'DSD → PCM');

    // 2. JS sandbox: displayTrack, updateRoonFullscreenUI, onBitPerfectFormatLocked, resetBitPerfectModeBadge, onAndroidAudioDeviceChanged
    const bpSlice = sliceBetween(html, 'function resetBitPerfectModeBadge()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const sigSlice = sliceBetween(html, 'function renderRoomSignal(track) {', 'const _ambientCanvas =');
    const dispSlice = sliceBetween(html, 'function formatRoomOutputText(track, room) {', 'function syncCanvasDimensions(');
    const fsSlice = sliceBetween(html, 'function updateRoonFullscreenUI() {', 'window.updateRoonFullscreenUI = updateRoonFullscreenUI;');
    const lockSlice = sliceBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', "const speedBtnEl = $('speed-btn');");
    const devSlice = sliceBetween(html, 'window.onAndroidAudioDeviceChanged = (deviceName, connected) => {', '// === v2.8.0:');

    const els = {};
    const mkEl = id => ({
      id,
      textContent: '',
      innerHTML: '',
      title: '',
      value: '100',
      checked: id === 'bitperfect-mode-toggle',
      hidden: false,
      src: '',
      className: '',
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, f) { if (f === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (f) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      },
      removeAttribute() {},
      setAttribute() {},
      addEventListener() {},
      style: { setProperty() {} }
    });
    const getEl = id => (els[id] || (els[id] = mkEl(id)));

    const sandbox = {
      $: getEl,
      window: {},
      library,
      escapeHtml: s => String(s || ''),
      safeChecked: () => false,
      safeVal: () => '',
      safeClass: () => {},
      audio: { paused: false },
      state: {
        currentId: 'f1',
        tracks: [flacTrack, dsdTrack],
        albumCovers: new Map(),
        zones: [{ id: 'zone_direct', name: 'Ngõ ra Trực tiếp (Bit-Perfect Direct)' }],
        roonZones: [],
        activeZoneId: 'zone_direct',
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        bitPerfectLockedFormat: null,
        androidAudioDeviceName: '',
        dsdOutputRate: 176400,
        dsdOutputDepth: 24,
        context: { sampleRate: 48000, state: 'running' },
        visualizerFpsMonitor: null
      },
      trackById: id => sandbox.state.tracks.find(t => t.id === id) || null,
      quality: t => t.isDsd
        ? { label: 'DSD64', tone: 'text-fuchsia-300 border-fuchsia-300/20 bg-fuchsia-300/5' }
        : { label: 'HI-RES', tone: 'text-amber-300 border-amber-300/20 bg-amber-300/5' },
      dsdSourceInfo: () => ({ baseRate: 44100, multiplier: 64 }),
      sourceLabel: s => s,
      formatDecodeAudit: () => '',
      usesFirstSliceCache: () => false,
      firstSliceCacheText: () => '',
      timeToFirstAudioText: () => '',
      trackRowsPerfText: () => '',
      refreshFirstSliceCacheStatus: () => {},
      updateMediaSession: () => {},
      isFavorite: () => false,
      updateRoomRating: () => {},
      updateListeningRoomAnnotations: () => {},
      updateMiniPlayerHud: () => {},
      syncTransportModesUI: () => {},
      refreshAudioOutputDevices: () => Promise.resolve(),
      syncPlaybackButtonsUi: () => {},
      renderQueueCurrent: () => {},
      syncAutoplayButton: () => {},
      updateSleepStatus: () => {},
      renderLyrics: () => {},
      formatTime: s => String(Math.floor(Number(s) || 0)),
      formatRemainingTime: () => '-0:00',
      paintSeek: () => {},
      scheduleTrackRender: () => {},
      renderRecentTracks: () => {},
      updateCurrentTrackIndicator: () => {},
      updatePositionState: () => {},
      playNext: () => {},
      toast: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      localStorage: { setItem() {}, getItem() { return null; } },
      Date, Math, Number, String, Boolean, Promise, Set, Map
    };
    vm.runInNewContext(
      bpSlice + '\n' + sigSlice + '\n' + dispSlice + '\n' + fsSlice + '\n' + lockSlice + '\n' + devSlice + '\nsetupBitPerfectIntegration();',
      sandbox
    );

    // Format locked updates HUD, #room-output, #fs-room-output, and signal path chain
    sandbox.window.onBitPerfectFormatLocked(192000, 24, true, 'FiiO KA17');
    assert.ok(getEl('bitperfect-mode-badge').textContent.includes('BIT-PERFECT LOCKED') && getEl('bitperfect-mode-badge').textContent.includes('FiiO KA17'));
    assert.equal(getEl('quality-badge').textContent, '⚡ BIT-PERFECT LOCKED · 192 kHz / 24-bit');
    assert.ok(getEl('room-output').textContent.includes('Android Bit-Perfect Direct') && getEl('room-output').textContent.includes('FiiO KA17'));
    assert.ok(getEl('fs-room-output').textContent.includes('FiiO KA17'));
    assert.equal(getEl('signal-path-badge').textContent, 'BIT-PERFECT');
    assert.ok(getEl('room-signal-chain').innerHTML.includes('FiiO KA17'));

    // Switching to DSD must NEVER display BIT-PERFECT DIRECT on quality badges or fullscreen
    sandbox.state.isNativeBitPerfectPlaying = false;
    sandbox.state.bitPerfectLockedFormat = null;
    sandbox.resetBitPerfectModeBadge();
    assert.equal(getEl('bitperfect-mode-badge').textContent, 'DIRECT ON');
    assert.equal(getEl('bitperfect-mode-badge').title, '');
    sandbox.state.currentId = 'd1';
    sandbox.displayTrack(dsdTrack);
    sandbox.updateRoonFullscreenUI();
    assert.ok(!getEl('quality-badge').textContent.includes('BIT-PERFECT DIRECT'), 'DSD must NEVER show BIT-PERFECT DIRECT');
    assert.ok(getEl('quality-badge').textContent.startsWith('DSD → PCM'), 'DSD badge should indicate DSD -> PCM');
    assert.ok(getEl('fs-room-quality-badge').textContent.startsWith('DSD → PCM'), 'Fullscreen DSD badge must update even when bitPerfectEnabled is true');

    // Playback complete resets #bitperfect-mode-badge
    sandbox.window.onBitPerfectFormatLocked(192000, 24, true, 'FiiO KA17');
    sandbox.window.onBitPerfectPlaybackComplete();
    assert.equal(getEl('bitperfect-mode-badge').textContent, 'DIRECT ON');
    assert.equal(getEl('bitperfect-mode-badge').title, '');

    // USB device disconnect clears androidAudioDeviceName
    sandbox.window.onAndroidAudioDeviceChanged('FiiO KA17', false);
    assert.equal(sandbox.state.androidAudioDeviceName, '');
  });

  it('R2 Iteration 2 regressions: overlapping playTrack race, Native BP -> DSD HUD flash & empty deviceName clearing', async () => {
    // 1. Overlapping async playTrack('t2') + short CUE playTrack('t3') race
    const bpSlice = sliceBetween(html, 'function resetBitPerfectModeBadge()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const playTrackSlice = sliceBetween(html, 'function resolvePlayTrackEntry(trackId) {', 'function stopDsdWorker(');
    const dispSlice = sliceBetween(html, 'function formatRoomOutputText(track, room) {', 'function syncCanvasDimensions(');
    const fsSlice = sliceBetween(html, 'function updateRoonFullscreenUI() {', 'window.updateRoonFullscreenUI = updateRoonFullscreenUI;');
    const lockSlice = sliceBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', "const speedBtnEl = $('speed-btn');");

    const els = {};
    const mkEl = id => ({
      id,
      textContent: '',
      innerHTML: '',
      title: '',
      value: id === 'volume' ? '100' : '0',
      checked: true,
      dataset: {},
      matches: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
      removeAttribute: () => {},
      setAttribute: () => {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: { setProperty() {} }
    });
    const getEl = id => (els[id] || (els[id] = mkEl(id)));

    const startedUrls = [];
    const permResolvers = new Map();
    let suspendResolvers = [];
    let bpActive = true;
    const fakeAudio = {
      src: '',
      currentTime: 0,
      duration: 600,
      paused: true,
      ended: false,
      readyState: 2,
      volume: 1,
      muted: false,
      dataset: {},
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      load() {},
      removeAttribute() {},
      addEventListener() {}
    };
    const fakeStandby = { ...fakeAudio, dataset: {}, addEventListener() {} };

    const t2 = { id: 't2', title: 'Track 2', source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2F2.flac', sampleRate: 96000, bitDepth: 24, format: 'FLAC', duration: 240 };
    const t3 = { id: 't3', title: 'Short CUE 3', isCue: true, cueStart: 200, cueEnd: 205, duration: 5, source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2Fcue3.flac', sampleRate: 44100, bitDepth: 16, format: 'FLAC' };
    const t4 = { id: 't4', title: 'Track 4', source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2F4.flac', sampleRate: 44100, bitDepth: 16, format: 'FLAC', duration: 180 };
    let resolveDsdLoad = null;
    const dsdTrack = { id: 'd1', title: 'DSD64', format: 'DSF', isDsd: true, dsdMultiplier: 64, sampleRate: 2822400, pcmRate: 176400, pcmBitDepth: 24, source: 'local', load: () => new Promise(r => { resolveDsdLoad = r; }) };

    const sandbox = {
      $: getEl,
      library,
      URL,
      location: { href: 'http://localhost/index.html', protocol: 'http:' },
      navigator: { onLine: true },
      document: { hidden: false },
      audio: fakeAudio,
      standbyAudio: fakeStandby,
      escapeHtml: s => String(s || ''),
      safeChecked: () => false,
      safeVal: () => '',
      safeClass: () => {},
      window: {
        NocturneNative: {
          isBitPerfectSupported: () => true,
          isBitPerfectActive: () => bpActive,
          setBitPerfectKnownDuration: () => {},
          setBitPerfectTrackWindow: () => {},
          startBitPerfectPlayback: (u) => { bpActive = true; startedUrls.push(u); return true; },
          seekBitPerfectPlayback: () => {},
          resumeBitPerfectPlayback: () => {},
          pauseBitPerfectPlayback: () => {},
          stopBitPerfectPlayback: () => { bpActive = false; },
          getBitPerfectDuration: () => 600000
        }
      },
      state: {
        currentId: 't2',
        tracks: [t2, t3, t4, dsdTrack],
        queueTrackIds: [],
        albumCovers: new Map(),
        objectUrls: new Set(),
        isSeeking: false,
        isPlaybackLoading: false,
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        lastBitPerfectPositionSec: 0,
        bitPerfectLockedFormat: null,
        androidAudioDeviceName: '',
        dsdOutputRate: 176400,
        dsdOutputDepth: 24,
        context: {
          sampleRate: 48000,
          state: 'running',
          suspend: () => new Promise(r => suspendResolvers.push(r)),
          resume: () => Promise.resolve()
        },
        playGeneration: 0,
        preloadGeneration: 0,
        lyrics: [],
        repeat: 0,
        autoplay: true,
        roonRadio: false,
        zones: [{ id: 'zone_direct', name: 'Bit-Perfect Direct' }],
        roonZones: [],
        activeZoneId: 'zone_direct'
      },
      isTrackRoutedToNativeBitPerfect: t => Boolean(t && !t.isDsd && t.url && !t.url.startsWith('blob:')),
      suspendWebAudioForBitPerfect: () => {},
      abortStaleFullAudioUpgrades: () => {},
      applyOptimisticPlaybackUi: () => {},
      unlockAudioDecksOnGesture: () => {},
      setPlaybackLoading: v => { sandbox.state.isPlaybackLoading = Boolean(v); },
      ensureLocalTrackPlayableUrl: tr => new Promise(res => { permResolvers.set(tr.id, res); }),
      resetAbLoop: () => {},
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      renderQueue: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      renderQueueCurrent: () => {},
      syncAutoplayButton: () => {},
      updateSleepStatus: () => {},
      renderLyrics: () => {},
      renderRecentTracks: () => {},
      updateCurrentTrackIndicator: () => {},
      updateMiniPlayerHud: () => {},
      updatePositionState: () => {},
      recordHistory: () => {},
      pruneExcessObjectUrls: () => {},
      scheduleTrackRender: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      formatTime: s => String(Math.floor(Number(s) || 0)),
      formatRemainingTime: () => '-0:00',
      quality: t => t.isDsd
        ? { label: 'DSD64', tone: 'text-fuchsia-300 border-fuchsia-300/20 bg-fuchsia-300/5' }
        : { label: 'HI-RES', tone: 'text-amber-300 border-amber-300/20 bg-amber-300/5' },
      dsdSourceInfo: () => ({ baseRate: 44100, multiplier: 64 }),
      sourceLabel: s => s,
      signalDescription: () => ({ sourceName: 'File local trên thiết bị' }),
      formatDecodeAudit: () => '',
      usesFirstSliceCache: () => false,
      firstSliceCacheText: () => '',
      timeToFirstAudioText: () => '',
      trackRowsPerfText: () => '',
      refreshFirstSliceCacheStatus: () => {},
      updateMediaSession: () => {},
      isFavorite: () => false,
      updateRoomRating: () => {},
      updateListeningRoomAnnotations: () => {},
      syncTransportModesUI: () => {},
      refreshAudioOutputDevices: () => Promise.resolve(),
      renderRoomSignal: () => {},
      trackById: id => sandbox.state.tracks.find(t => t.id === id) || null,
      skipFailedTrack: () => {},
      playNext: () => {},
      toast: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: fn => { fn(); return 1; },
      clearTimeout: () => {},
      performance: { now: () => 100 },
      localStorage: { setItem() {}, getItem() { return null; } },
      console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
      Date, Math, Number, String, Boolean, Promise, URLSearchParams, Set, Map, JSON
    };
    vm.runInNewContext(
      bpSlice + '\n' + dispSlice + '\n' + fsSlice + '\n' + lockSlice + '\n' + playTrackSlice + '\nsetupBitPerfectIntegration();',
      sandbox
    );

    // 1a. Start t2 (suspends at ensureLocalTrackPlayableUrl), then start short CUE t3
    const pT2 = sandbox.playTrack('t2');
    const pT3 = sandbox.playTrack('t3');
    assert.equal(sandbox.state.currentId, 't3');
    assert.equal(sandbox.state._bpAwaitingStart, true);

    // Resolve t2 first while t3 is still awaiting ensureLocalTrackPlayableUrl
    permResolvers.get('t2')();
    await pT2;
    assert.equal(startedUrls.length, 0, 'Superseded playTrack(t2) must NOT call startBitPerfectPlayback');
    assert.equal(sandbox.state._bpAwaitingStart, true, 'Superseded playTrack(t2) must NOT clear _bpAwaitingStart');

    // Outgoing native position callback must be ignored while t3 is awaiting
    sandbox.window.onNativeBitPerfectPosition(205000, 600000);
    assert.equal(sandbox.state.currentId, 't3', 'Position bleed must NOT skip incoming short CUE t3');

    // Now let t3 pass ensureLocalTrackPlayableUrl and suspend at context.suspend(), then supersede with t4
    permResolvers.get('t3')();
    await new Promise(r => setImmediate(r));
    assert.equal(suspendResolvers.length, 1);
    const pT4 = sandbox.playTrack('t4');
    suspendResolvers[0]();
    await pT3;
    assert.equal(startedUrls.length, 0, 'playTrack(t3) superseded during context.suspend() must abort cleanly');
    assert.equal(sandbox.state._bpAwaitingStart, true);

    permResolvers.get('t4')();
    await new Promise(r => setImmediate(r));
    suspendResolvers[1]();
    await pT4;
    assert.deepEqual(startedUrls, [t4.url]);
    assert.equal(sandbox.state._bpAwaitingStart, false);

    // 2. Native BP FLAC -> DSD playTrack(dsdTrack) while isNativeBitPerfectPlaying=true and track.load() pending
    sandbox.state.isNativeBitPerfectPlaying = true;
    sandbox.state.bitPerfectEnabled = true;
    const pDsd = sandbox.playTrack('d1');
    permResolvers.get('d1')();
    await new Promise(r => setImmediate(r));
    sandbox.updateRoonFullscreenUI();
    for (const badgeId of ['quality-badge', 'mobile-quality', 'room-quality', 'fs-room-quality-badge', 'fullscreen-quality-badge']) {
      assert.ok(!getEl(badgeId).textContent.includes('BIT-PERFECT DIRECT'), badgeId + ' must NEVER show BIT-PERFECT DIRECT for DSD during Native BP -> DSD transition; got ' + getEl(badgeId).textContent);
    }
    assert.ok(getEl('quality-badge').textContent.startsWith('DSD → PCM'));
    assert.ok(getEl('fs-room-quality-badge').textContent.startsWith('DSD → PCM'));
    if (resolveDsdLoad) resolveDsdLoad();
    await pDsd.catch(() => {});

    // 3. onBitPerfectFormatLocked(48000, 16, false, '') after FiiO KA17 clears stale DAC name everywhere
    sandbox.state.isNativeBitPerfectPlaying = true;
    sandbox.state.isNativeBitPerfectPaused = false;
    sandbox.state.currentId = 't4';
    sandbox.window.onBitPerfectFormatLocked(192000, 24, true, 'FiiO KA17');
    assert.equal(sandbox.state.androidAudioDeviceName, 'FiiO KA17');

    sandbox.window.onBitPerfectFormatLocked(48000, 16, false, '');
    assert.equal(sandbox.state.androidAudioDeviceName, '', 'Empty deviceName must clear stale androidAudioDeviceName');
    sandbox.syncRoomOutputText(t4);
    assert.ok(!getEl('room-output').textContent.includes('FiiO KA17'), '#room-output must not retain stale FiiO KA17');
    assert.ok(!getEl('fs-room-output').textContent.includes('FiiO KA17'), '#fs-room-output must not retain stale FiiO KA17');

    const sp = library.computeSignalPath(t4, {
      isNativeBitPerfect: true,
      bitPerfectEnabled: true,
      bitPerfectLockedFormat: sandbox.state.bitPerfectLockedFormat,
      androidAudioDeviceName: 'FiiO KA17'
    });
    assert.ok(!sp.steps[3].description.includes('FiiO KA17'), 'computeSignalPath must prefer locked.deviceName even when empty');
    const roonStages = library.buildRoonSignalPathStages(t4, {
      isNativeBitPerfect: true,
      bitPerfectLockedFormat: sandbox.state.bitPerfectLockedFormat,
      androidAudioDeviceName: 'FiiO KA17',
      zoneName: 'Speaker'
    });
    assert.ok(!roonStages[3].description.includes('FiiO KA17'), 'buildRoonSignalPathStages must prefer locked.deviceName even when empty');
  });

  it('R2 Iteration 3 regressions: synchronous playGeneration & superseded loading state across Local/Cloud/DSD/WebAudio races', async () => {
    const loadingSlice = sliceBetween(html, 'let playbackLoadingTimeout = null;', 'let cloudMetadataPausedUntil = 0;');
    const skipSlice = sliceBetween(html, 'function skipFailedTrack(generation, message) {', 'function finishPlaybackStart(');
    const playTrackSlice = sliceBetween(html, 'function resolvePlayTrackEntry(trackId) {', 'function stopDsdWorker(');

    const els = {};
    const mkEl = id => ({
      id,
      textContent: '',
      value: '0',
      checked: true,
      dataset: {},
      matches: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
      removeAttribute: () => {},
      setAttribute: () => {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: { setProperty() {} }
    });
    const getEl = id => (els[id] || (els[id] = mkEl(id)));

    const permResolvers = new Map();
    const startedUrls = [];
    const clearOptimisticCalls = [];
    const playNextCalls = [];
    const finishStartCalls = [];
    let cloudMetaQueueRuns = 0;
    let rejectCloudLoad = null;
    let rejectDsdLoad = null;
    let resolveWebPlay = null;
    let rejectWebPlay = null;
    let bpActive = false;

    const fakeAudio = {
      src: '',
      currentTime: 0,
      duration: 240,
      paused: true,
      ended: false,
      readyState: 2,
      volume: 1,
      muted: false,
      error: null,
      dataset: {},
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      load() {},
      removeAttribute() {},
      addEventListener() {}
    };
    const fakeStandby = {
      ...fakeAudio,
      dataset: {},
      addEventListener() {},
      removeEventListener() {},
      play() {
        this.paused = false;
        return new Promise((res, rej) => {
          resolveWebPlay = res;
          rejectWebPlay = rej;
        });
      }
    };

    const t2 = { id: 't2', title: 'Local 2', source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2F2.flac', sampleRate: 96000, bitDepth: 24, format: 'FLAC', duration: 240 };
    const t3 = { id: 't3', title: 'Short CUE 3', isCue: true, cueStart: 200, cueEnd: 205, duration: 5, source: 'local', url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2Fcue3.flac', sampleRate: 44100, bitDepth: 16, format: 'FLAC' };
    const c2 = { id: 'c2', title: 'Cloud 2', source: 'google', remoteId: 'g-2', format: 'FLAC', load: () => new Promise((_, rej) => { rejectCloudLoad = rej; }) };
    const d2 = { id: 'd2', title: 'DSD 2', isDsd: true, source: 'google', remoteId: 'g-dsd', format: 'DSF', sampleRate: 2822400, load: () => new Promise((_, rej) => { rejectDsdLoad = rej; }) };
    const w2 = { id: 'w2', title: 'WebAudio 2', source: 'local', url: 'blob:http://localhost/w2', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 180 };

    const sandbox = {
      $: getEl,
      library,
      URL,
      location: { href: 'http://localhost/index.html', protocol: 'http:' },
      navigator: { onLine: true },
      document: { hidden: false },
      audio: fakeAudio,
      standbyAudio: fakeStandby,
      window: {
        NocturneNative: {
          isBitPerfectSupported: () => true,
          isBitPerfectActive: () => bpActive,
          setBitPerfectKnownDuration: () => {},
          setBitPerfectTrackWindow: () => {},
          setBitPerfectStreamAuth: () => {},
          startBitPerfectPlayback: u => { bpActive = true; startedUrls.push(u); return true; },
          seekBitPerfectPlayback: () => {},
          resumeBitPerfectPlayback: () => {},
          pauseBitPerfectPlayback: () => {},
          stopBitPerfectPlayback: () => { bpActive = false; },
          getBitPerfectDuration: () => 600000
        }
      },
      state: {
        currentId: null,
        tracks: [t2, t3, c2, d2, w2],
        queueTrackIds: [],
        objectUrls: new Set(['blob:http://localhost/w2']),
        isSeeking: false,
        isPlaybackLoading: false,
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        lastBitPerfectPositionSec: 0,
        playGeneration: 0,
        preloadGeneration: 0,
        errorSkipCount: 0,
        lyrics: [],
        repeat: 0,
        autoplay: true,
        context: {
          sampleRate: 48000,
          state: 'running',
          suspend: () => Promise.resolve(),
          resume: () => Promise.resolve(),
          close: () => Promise.resolve()
        }
      },
      isTrackRoutedToNativeBitPerfect: t => Boolean(t && !t.isDsd && ((t.source === 'google') || (t.url && !t.url.startsWith('blob:')))),
      suspendWebAudioForBitPerfect: () => {},
      setupAudio: () => {
        if (!sandbox.state.context) {
          sandbox.state.context = {
            sampleRate: 44100,
            state: 'running',
            suspend: () => Promise.resolve(),
            resume: () => Promise.resolve(),
            close: () => Promise.resolve()
          };
        }
      },
      abortStaleFullAudioUpgrades: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      unlockAudioDecksOnGesture: () => {},
      runCloudMetadataQueue: () => { cloudMetaQueueRuns++; },
      pauseCloudMetadataQueue: () => {},
      resumeCloudMetadataQueue: () => {},
      ensureLocalTrackPlayableUrl: tr => new Promise(res => { permResolvers.set(tr.id, res); }),
      resetAbLoop: () => {},
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      renderQueue: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      clearOptimisticLoadingUi: () => { clearOptimisticCalls.push(sandbox.state.currentId); },
      syncPlaybackButtonsUi: () => {},
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      updatePositionState: () => {},
      recordHistory: () => {},
      pruneExcessObjectUrls: () => {},
      scheduleTrackRender: () => {},
      isSilentUnlockSrc: () => false,
      isExternalNonAppAssetsHttpUrl: () => false,
      resetBitPerfectModeBadge: () => {},
      resolveCloudBitPerfectStream: async () => null,
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      mediaErrorMessage: e => (e && e.message) || String(e),
      playNext: (d, a) => { playNextCalls.push({ d, a, cur: sandbox.state.currentId }); },
      finishPlaybackStart: (tr) => { finishStartCalls.push(tr.id); },
      retryPlayOnAbort: async () => false,
      safeResumeAudioContext: async () => {},
      toast: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      performance: { now: () => 100 },
      console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
      Date, Math, Number, String, Boolean, Promise, URLSearchParams, Set, Map, JSON
    };
    vm.runInNewContext(loadingSlice + '\n' + skipSlice + '\n' + playTrackSlice, sandbox);

    // Scenario 1: t2 superseded by t3 across await ensureLocalTrackPlayableUrl
    const pT2 = sandbox.playTrack('t2');
    const genAfterT2 = sandbox.state.playGeneration;
    const pT3 = sandbox.playTrack('t3');
    assert.equal(sandbox.state.playGeneration, genAfterT2 + 1, 'playGeneration must increment synchronously before await ensureLocalTrackPlayableUrl');
    assert.equal(sandbox.state.isPlaybackLoading, true);

    permResolvers.get('t2')();
    await pT2;
    assert.equal(sandbox.state.isPlaybackLoading, true, 'Superseded t2 must NOT clear state.isPlaybackLoading while t3 is awaiting');
    assert.equal(cloudMetaQueueRuns, 0, 'Superseded t2 must NOT trigger runCloudMetadataQueue while t3 is awaiting');
    assert.equal(startedUrls.length, 0);

    permResolvers.get('t3')();
    await pT3;
    assert.equal(sandbox.state.isPlaybackLoading, false, 'Active t3 completion transitions state.isPlaybackLoading to false');
    assert.equal(cloudMetaQueueRuns, 1);
    assert.deepEqual(startedUrls, [t3.url]);

    // Scenario 2: Cloud c2.load() rejecting while t3 awaits ensureLocalTrackPlayableUrl
    startedUrls.length = 0;
    clearOptimisticCalls.length = 0;
    playNextCalls.length = 0;
    cloudMetaQueueRuns = 0;
    permResolvers.clear();

    const pC2 = sandbox.playTrack('c2');
    permResolvers.get('c2')();
    await new Promise(r => setImmediate(r));
    assert.equal(typeof rejectCloudLoad, 'function');

    const pT3_c = sandbox.playTrack('t3');
    assert.equal(sandbox.state.isPlaybackLoading, true);
    rejectCloudLoad(new Error('401 Unauthorized'));
    await pC2;
    assert.equal(sandbox.state.currentId, 't3');
    assert.equal(sandbox.state.isPlaybackLoading, true, 'Superseded c2.load() error must NOT clear state.isPlaybackLoading');
    assert.equal(cloudMetaQueueRuns, 0, 'Superseded c2.load() error must NOT trigger runCloudMetadataQueue');
    assert.deepEqual(clearOptimisticCalls, [], 'Superseded c2.load() error must NOT call clearOptimisticLoadingUi');
    assert.deepEqual(playNextCalls, [], 'Superseded c2.load() error must NOT call playNext');

    permResolvers.get('t3')();
    await pT3_c;
    assert.equal(sandbox.state.isPlaybackLoading, false);
    assert.deepEqual(startedUrls, [t3.url]);

    // Scenario 3: DSD d2.load() rejecting while t3 awaits ensureLocalTrackPlayableUrl
    startedUrls.length = 0;
    clearOptimisticCalls.length = 0;
    playNextCalls.length = 0;
    cloudMetaQueueRuns = 0;
    permResolvers.clear();

    const pD2 = sandbox.playTrack('d2');
    permResolvers.get('d2')();
    await new Promise(r => setImmediate(r));
    assert.equal(typeof rejectDsdLoad, 'function');

    const pT3_d = sandbox.playTrack('t3');
    assert.equal(sandbox.state.isPlaybackLoading, true);
    rejectDsdLoad(new Error('DSD fetch failed'));
    await pD2;
    assert.equal(sandbox.state.currentId, 't3');
    assert.equal(sandbox.state.isPlaybackLoading, true, 'Superseded d2.load() error must NOT clear state.isPlaybackLoading');
    assert.equal(cloudMetaQueueRuns, 0, 'Superseded d2.load() error must NOT trigger runCloudMetadataQueue');
    assert.deepEqual(clearOptimisticCalls, [], 'Superseded d2.load() error must NOT call clearOptimisticLoadingUi');
    assert.deepEqual(playNextCalls, [], 'Superseded d2.load() error must NOT call playNext');

    permResolvers.get('t3')();
    await pT3_d;
    assert.equal(sandbox.state.isPlaybackLoading, false);
    assert.deepEqual(startedUrls, [t3.url]);

    // Scenario 4: WebAudio w2 target.play() resolving (and rejecting) while t3 awaits ensureLocalTrackPlayableUrl
    startedUrls.length = 0;
    clearOptimisticCalls.length = 0;
    playNextCalls.length = 0;
    finishStartCalls.length = 0;
    cloudMetaQueueRuns = 0;
    permResolvers.clear();

    const pW2 = sandbox.playTrack('w2');
    permResolvers.get('w2')();
    await new Promise(r => setImmediate(r));
    assert.equal(typeof resolveWebPlay, 'function');

    const pT3_w = sandbox.playTrack('t3');
    assert.equal(sandbox.state.isPlaybackLoading, true);
    resolveWebPlay();
    await pW2;
    assert.equal(sandbox.state.currentId, 't3');
    assert.deepEqual(finishStartCalls, [], 'Superseded w2 target.play() must NOT call finishPlaybackStart');
    assert.equal(sandbox.state.isPlaybackLoading, true, 'Superseded w2 target.play() must NOT clear state.isPlaybackLoading');
    assert.equal(cloudMetaQueueRuns, 0, 'Superseded w2 target.play() must NOT trigger runCloudMetadataQueue');

    permResolvers.get('t3')();
    await pT3_w;
    assert.equal(sandbox.state.isPlaybackLoading, false);
    assert.deepEqual(startedUrls, [t3.url]);

    // Also verify superseded WebAudio target.play() rejection does NOT clobber incoming t3
    startedUrls.length = 0;
    clearOptimisticCalls.length = 0;
    playNextCalls.length = 0;
    finishStartCalls.length = 0;
    cloudMetaQueueRuns = 0;
    permResolvers.clear();

    const pW2Err = sandbox.playTrack('w2');
    permResolvers.get('w2')();
    await new Promise(r => setImmediate(r));
    const pT3_wErr = sandbox.playTrack('t3');
    rejectWebPlay({ name: 'NotSupportedError', message: 'decode failed' });
    await pW2Err;
    assert.equal(sandbox.state.isPlaybackLoading, true, 'Superseded w2 target.play() catch must NOT clear state.isPlaybackLoading');
    assert.deepEqual(clearOptimisticCalls, [], 'Superseded w2 target.play() catch must NOT call clearOptimisticLoadingUi');
    assert.deepEqual(playNextCalls, [], 'Superseded w2 target.play() catch must NOT call playNext');

    permResolvers.get('t3')();
    await pT3_wErr;
    assert.equal(sandbox.state.isPlaybackLoading, false);
    assert.deepEqual(startedUrls, [t3.url]);
  });
});
