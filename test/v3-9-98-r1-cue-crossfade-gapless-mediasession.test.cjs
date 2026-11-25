'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

describe('v3.9.98 R1: CUE Auto-Crossfade, Gapless Lookahead, Standby Pre-Seek & Android MediaSession CUE Seek Parity', () => {
  it('1. library.shouldAutoCrossfade blocks when options.isNativeBitPerfect is truthy and resolves CUE timing cleanly', () => {
    assert.equal(
      library.shouldAutoCrossfade(118.5, 120, 2, { isNativeBitPerfect: false, hasNextTrack: true, leadMargin: 0.5 }),
      true
    );
    assert.equal(
      library.shouldAutoCrossfade(118.5, 120, 2, { isNativeBitPerfect: true, hasNextTrack: true, leadMargin: 0.5 }),
      false,
      'shouldAutoCrossfade must return false when options.isNativeBitPerfect is true'
    );

    const cueTimed = library.resolveEffectiveTrackTiming(
      { id: 'c1', cueStart: 120, cueEnd: 240, duration: 120 },
      238,
      600
    );
    assert.equal(cueTimed.isCue, true);
    assert.equal(cueTimed.currentTime, 118);
    assert.equal(cueTimed.duration, 120);

    const finalCueTimed = library.resolveEffectiveTrackTiming(
      { id: 'c3', cueStart: 480, cueEnd: 0, duration: 120 },
      599.85,
      600
    );
    assert.equal(finalCueTimed.isCue, true);
    assert.ok(Math.abs(finalCueTimed.currentTime - 119.85) < 1e-6);
    assert.equal(finalCueTimed.duration, 120);

    const regularTimed = library.resolveEffectiveTrackTiming({ id: 'r1', duration: 200 }, 50, 210);
    assert.equal(regularTimed.isCue, false);
    assert.equal(regularTimed.currentTime, 50);
    assert.equal(regularTimed.duration, 210);
  });

  it('2. timeupdate handles CUE crossfade (cueEnd-relative), final-CUE gapless lookahead, savePlaybackSession & Native BP blocking', () => {
    const tuStart = html.indexOf("element.addEventListener('timeupdate', () => {");
    const tuEnd = html.indexOf("element.addEventListener('progress',", tuStart);
    assert.ok(tuStart > 0 && tuEnd > tuStart, 'timeupdate listener bounds must be locatable');
    const tuSlice = html.slice(tuStart, tuEnd);

    const handlers = {};
    const audioEl = {
      currentTime: 0,
      duration: 600,
      paused: false,
      ended: false,
      readyState: 4,
      buffered: { length: 1, start: () => 0, end: () => 600 },
      dataset: { trackId: 'cue-1' },
      pause() { this.paused = true; },
      addEventListener(ev, fn) { handlers[ev] = fn; }
    };
    const standbyEl = {
      src: 'blob:cue-parent',
      readyState: 3
    };
    const elStub = () => ({
      textContent: '',
      value: '0',
      className: '',
      style: { setProperty() {} },
      matches: () => false
    });
    const playNextCalls = [];
    let saveCalls = 0;
    let preloadCalls = 0;

    const sandbox = {
      element: audioEl,
      audio: audioEl,
      standbyAudio: standbyEl,
      library,
      location: { href: 'https://nocturne.local/' },
      document: { hidden: false },
      $: elStub,
      formatTime: s => String(Math.floor(s)),
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}`,
      syncSeek: () => {},
      paintSeek: () => {},
      renderWaveformSeekbar: () => {},
      updatePositionState: () => {},
      updateBufferPipelineTelemetry: () => {},
      updateLyricsHighlight: () => {},
      syncPlaybackButtonsUi: () => {},
      checkScrobbleEligibility: () => {},
      preloadNext: () => { preloadCalls++; },
      savePlaybackSession: () => { saveCalls++; },
      queueIndex: () => 1,
      playNext: (dir, auto) => { playNextCalls.push({ dir, auto, id: sandbox.state.currentId }); },
      lastDisplayedPlaybackSecond: -1,
      state: {
        currentId: 'cue-1',
        playGeneration: 10,
        autoCrossfadeGeneration: 0,
        crossfadeSeconds: 2,
        repeat: 0,
        isSeeking: false,
        isPlaybackLoading: false,
        sleepAtTrackEnd: false,
        preloadReadyUrl: 'blob:cue-parent',
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        tracks: [
          { id: 'cue-1', isCue: true, cueStart: 120, cueEnd: 240, duration: 120 },
          { id: 'cue-2', isCue: true, cueStart: 240, cueEnd: 360, duration: 120 },
          { id: 'cue-3', isCue: true, cueStart: 480, cueEnd: 0, duration: 120 }
        ]
      },
      Math, Number, String, Boolean, Date
    };

    vm.runInNewContext(tuSlice, sandbox);
    assert.equal(typeof handlers.timeupdate, 'function');

    // Mid-CUE track (125s -> trackCurrentTime=5s): does not crossfade, still saves session
    audioEl.currentTime = 125;
    handlers.timeupdate();
    assert.equal(playNextCalls.length, 0);
    assert.equal(saveCalls, 1, 'CUE timeupdate must invoke savePlaybackSession');

    // Native Bit-Perfect playing or paused MUST block CUE boundary / autoFade triggers
    sandbox.state.isNativeBitPerfectPlaying = true;
    audioEl.currentTime = 239.9;
    handlers.timeupdate();
    assert.equal(playNextCalls.length, 0, 'isNativeBitPerfectPlaying must block Web timeupdate playNext');
    sandbox.state.isNativeBitPerfectPlaying = false;
    sandbox.state.isNativeBitPerfectPaused = true;
    handlers.timeupdate();
    assert.equal(playNextCalls.length, 0, 'isNativeBitPerfectPaused must block Web timeupdate playNext');
    sandbox.state.isNativeBitPerfectPaused = false;

    // CUE auto-crossfade at trackCurrentTime=118s (238s) with cueTrackDuration=120s and crossfadeSeconds=2s
    audioEl.currentTime = 238;
    handlers.timeupdate();
    assert.equal(playNextCalls.length, 1, 'CUE track must trigger autoFadeEligible 2.5s before cueEnd');
    assert.equal(sandbox.state.autoCrossfadeGeneration, 10);

    // Final CUE subtrack (cueEnd=0, duration=120s, cueStart=480s) gapless lookahead at 599.85s when crossfadeSeconds=0
    sandbox.state.currentId = 'cue-3';
    sandbox.state.playGeneration = 11;
    sandbox.state.crossfadeSeconds = 0;
    audioEl.dataset.trackId = 'cue-3';
    audioEl.currentTime = 599.85;
    handlers.timeupdate();
    assert.equal(playNextCalls.length, 2, 'Final CUE subtrack must trigger gaplessLookaheadEligible before 600s end');
  });

  it('3. trySkipSameCueStandbyPreload, applyCrossfade & playTrack enable CUE Deck A<->B crossfade and pre-seek standbyAudio before play()', () => {
    const crossfadeSlice = extractBetween(html, 'function applyCrossfade(', 'const steps = 32');
    assert.ok(
      crossfadeSlice.includes('state.isNativeBitPerfectPlaying || state.isNativeBitPerfectPaused'),
      'applyCrossfade must guard both isNativeBitPerfectPlaying and isNativeBitPerfectPaused'
    );

    const skipSlice = extractBetween(html, 'function trySkipSameCueStandbyPreload(', 'function seekPreloadedCueStandby(');
    const skipSandbox = {
      state: {
        currentId: 'c1',
        crossfadeSeconds: 2,
        preloadTrackId: null,
        preloadReadyUrl: null,
        tracks: [
          { id: 'c1', isCue: true, url: 'blob:cue' },
          { id: 'c2', isCue: true, url: 'blob:cue' }
        ]
      },
      isSameCueParentTrack: (a, b) => Boolean(a && b && a.url === b.url),
      clearStalePreload: () => {},
      Number
    };
    vm.runInNewContext(skipSlice + '\nthis.trySkipSameCueStandbyPreload = trySkipSameCueStandbyPreload;', skipSandbox);
    assert.equal(
      skipSandbox.trySkipSameCueStandbyPreload(skipSandbox.state.tracks[1]),
      false,
      'trySkipSameCueStandbyPreload must NOT skip standbyAudio preload when crossfadeSeconds > 0'
    );
    skipSandbox.state.crossfadeSeconds = 0;
    assert.equal(
      skipSandbox.trySkipSameCueStandbyPreload(skipSandbox.state.tracks[1]),
      true,
      'trySkipSameCueStandbyPreload still reuses same audio element when crossfadeSeconds === 0'
    );

    const playSlice = extractBetween(html, 'const allowSameParentCueCrossfade =', 'let playedOk = true;');
    assert.ok(playSlice.includes('!allowSameParentCueCrossfade'), 'isSameCueHtmlParent must yield to Deck A<->B crossfade');
    assert.ok(
      playSlice.includes("target.addEventListener('loadedmetadata'") &&
      playSlice.includes("target.addEventListener('seeked'") &&
      playSlice.indexOf("target.addEventListener('seeked'") < playSlice.length,
      'playTrack must await loadedmetadata + seeked on standbyAudio before target.play() and applyCrossfade()'
    );
  });

  it('4. MainActivity.java BitPerfectAudioPlayer exposes CUE window getters/helpers and clamps fallback MediaSession seeks', () => {
    const bpStart = mainJava.indexOf('public class BitPerfectAudioPlayer');
    assert.ok(bpStart > 0);
    const bpSlice = mainJava.slice(bpStart);

    assert.ok(bpSlice.includes('public long getCueWindowStartMs()'));
    assert.ok(bpSlice.includes('public long getCueWindowDurationMs()'));
    assert.ok(bpSlice.includes('public long clampCueWindowPositionMs(long absTargetMs)'));
    assert.ok(bpSlice.includes('public long windowRelativeSeekToAbsoluteMs(long relPosMs)'));

    const seekOffSlice = extractBetween(mainJava, 'public void dispatchSeekOffsetToWeb(', 'public void dispatchSeekToWeb(');
    const seekToSlice = extractBetween(mainJava, 'public void dispatchSeekToWeb(', 'private final BroadcastReceiver mMediaNotificationReceiver');

    assert.ok(seekOffSlice.includes('mBitPerfectPlayer.clampCueWindowPositionMs('), 'dispatchSeekOffsetToWeb fallback must clamp via clampCueWindowPositionMs');
    assert.ok(seekToSlice.includes('mBitPerfectPlayer.windowRelativeSeekToAbsoluteMs('), 'dispatchSeekToWeb fallback must convert window-relative seek via windowRelativeSeekToAbsoluteMs');
    assert.ok(seekToSlice.includes('window.onHardwareSeekTo(') && seekToSlice.includes('!"\\"ok\\"".equals(value)'), 'Preserve v3-9-66 test invariants verbatim');
  });

  it('5. standbyAudio pre-seek awaits seeked when currentTime updates synchronously while target.seeking === true', async () => {
    const playSlice = extractBetween(
      html,
      'const allowSameParentCueCrossfade =',
      '} catch (error) {'
    );

    const events = [];
    function makeDeck(name) {
      const listeners = new Map();
      const deck = {
        _name: name,
        src: '',
        readyState: 0,
        networkState: 0,
        duration: 0,
        _currentTime: 0,
        seeking: false,
        paused: true,
        volume: 1,
        defaultMuted: false,
        muted: false,
        dataset: {},
        error: null,
        get currentTime() { return this._currentTime; },
        set currentTime(val) {
          this._currentTime = Number(val);
          this.seeking = true;
          events.push(`${name}:setCurrentTime(${this._currentTime})`);
          setTimeout(() => {
            this.seeking = false;
            events.push(`${name}:seeked`);
            deck._emit('seeked');
          }, 15);
        },
        addEventListener(type, fn, opts) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push({ fn, once: Boolean(opts && opts.once) });
        },
        removeEventListener(type, fn) {
          const arr = listeners.get(type);
          if (!arr) return;
          listeners.set(type, arr.filter(x => x.fn !== fn));
        },
        _emit(type, evt) {
          const arr = (listeners.get(type) || []).slice();
          for (const item of arr) {
            if (item.once) deck.removeEventListener(type, item.fn);
            item.fn(evt || { type });
          }
        },
        load() {
          events.push(`${name}:load`);
          setTimeout(() => {
            this.readyState = 1;
            this.duration = 600;
            events.push(`${name}:loadedmetadata`);
            this._emit('loadedmetadata');
          }, 5);
        },
        async play() {
          events.push(`${name}:play@t=${this._currentTime},seeking=${this.seeking}`);
          assert.equal(this.seeking, false, 'target.play() must NOT run while target.seeking === true');
          this.paused = false;
        }
      };
      return deck;
    }

    const deckA = makeDeck('deckA');
    deckA.src = 'http://localhost/album.flac';
    deckA.readyState = 4;
    deckA.duration = 600;
    deckA.paused = false;
    const deckB = makeDeck('deckB');

    const sandbox = {
      audio: deckA,
      standbyAudio: deckB,
      target: deckB,
      track: { id: 'cue-2', isCue: true, cueStart: 240, cueEnd: 480, duration: 240, source: 'local' },
      previousTrack: { id: 'cue-1', isCue: true, cueStart: 0, cueEnd: 240, duration: 240, source: 'local' },
      playUrl: 'http://localhost/album.flac',
      initialTargetSeekSec: 240,
      generation: 1,
      bpGuardToken: 1,
      wasPreloaded: false,
      playRequestedAt: 0,
      state: {
        playGeneration: 1,
        _bpPositionGuardToken: 1,
        crossfadeSeconds: 3,
        bitPerfectEnabled: false,
        activeDeck: { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } },
        deckA: null,
        deckB: null,
        context: { currentTime: 10 },
        crossfadeUntil: 0,
        isPlaybackLoading: true
      },
      isSilentUnlockSrc: () => false,
      isExternalNonAppAssetsHttpUrl: () => false,
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      resumeCloudMetadataQueue: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      cleanupAborted: () => { throw new Error('unexpected cleanupAborted'); },
      retryPlayOnAbort: async () => false,
      finishPlaybackStart: (_tr, _gen, _tgt, _prev) => {
        events.push(`applyCrossfade(${sandbox.state.crossfadeSeconds})`);
      },
      $: () => null,
      performance: { now: () => 1 },
      setTimeout, clearTimeout, Math, Number, String, Boolean, Promise
    };
    sandbox.state.deckA = sandbox.state.activeDeck;
    sandbox.state.deckB = { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 0 } } };

    const wrapped = `(async function runStandbySlice() {\n${playSlice}\n} catch (err) { throw err; }\n})()`;
    await vm.runInNewContext(wrapped, sandbox);

    const setIdx = events.indexOf('deckB:setCurrentTime(240)');
    const seekedIdx = events.indexOf('deckB:seeked');
    const playIdx = events.indexOf('deckB:play@t=240,seeking=false');
    const fadeIdx = events.indexOf('applyCrossfade(3)');
    assert.ok(setIdx >= 0, 'must assign currentTime=240');
    assert.ok(seekedIdx > setIdx, 'seeked must happen after setCurrentTime');
    assert.ok(playIdx > seekedIdx, `play() must await seeked even when currentTime updates synchronously; events=${JSON.stringify(events)}`);
    assert.ok(fadeIdx > playIdx, 'applyCrossfade must happen after play()');
  });

  it('6. finishPlaybackStart formats CUE virtual track duration instead of parent element.duration', () => {
    const finishSlice = extractBetween(
      html,
      'function finishPlaybackStart(track, generation, target, previousTrack) {',
      '// Pha A — lát đầu không có khung nhạc'
    );
    const uiEls = {
      'play-button': { textContent: '' },
      'room-play': { textContent: '' },
      'mini-play': { textContent: '' },
      'fullscreen-play-btn': { textContent: '' },
      'duration': { textContent: '' },
      'duration-mobile': { textContent: '' },
      'room-duration': { textContent: '' },
      'fullscreen-time-dur': { textContent: '' },
      'room-remaining': { textContent: '' }
    };
    const prevEl = { paused: false, src: 'blob:cue-parent', currentTime: 2.8, pause() {}, removeAttribute() {}, load() {} };
    const tgtEl = { dataset: {}, currentTime: 4.0, duration: 12.0, playbackRate: 1, removeAttribute() {} };
    const deckA = { element: prevEl, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, value: 1 } } };
    const deckB = { element: tgtEl, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, value: 0 } } };
    const sandbox = {
      library,
      audio: prevEl,
      standbyAudio: tgtEl,
      lastDisplayedPlaybackSecond: 0,
      lastPositionStateSecond: 0,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      window: {},
      location: { href: 'http://localhost/' },
      URL,
      state: {
        playGeneration: 5,
        activeDeck: deckA,
        deckA,
        deckB,
        context: { state: 'running', currentTime: 10 },
        crossfadeSeconds: 1,
        crossfadeUntil: 0,
        preloadTrackId: 'cue-2',
        preloadReadyUrl: 'blob:cue-parent',
        tracks: [],
        errorSkipCount: 0
      },
      applyCrossfade: (_ctx, _oldD, _newD, sec) => sec,
      clearOptimisticLoadingUi: () => {},
      syncPlaybackButtonsUi: () => {},
      setVisualizerRunning: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor(Math.max(0, d - c))}`,
      updatePositionState: () => {},
      updateMiniPlayerHud: () => {},
      recordHistory: () => {},
      savePlaybackSession: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      setTimeout: () => 1,
      Number, Math, String, Boolean
    };
    vm.runInNewContext(finishSlice, sandbox);
    const cueTrack2 = { id: 'cue-2', isCue: true, cueStart: 4, cueEnd: 8, duration: 4, title: '02 - Cue Movement II' };
    const cueTrack1 = { id: 'cue-1', isCue: true, cueStart: 0, cueEnd: 4, duration: 4, title: '01 - Cue Movement I' };
    assert.equal(sandbox.finishPlaybackStart(cueTrack2, 5, tgtEl, cueTrack1), true);
    assert.equal(uiEls['duration'].textContent, '0:04');
    assert.equal(uiEls['room-duration'].textContent, '0:04');
    assert.equal(uiEls['room-remaining'].textContent, '-4');
  });
});
