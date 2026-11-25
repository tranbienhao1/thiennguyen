'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const svcJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java'),
  'utf8'
);
const library = require(path.join(ROOT, 'library-utils.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

function extractFn(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find ${signature}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTpl = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (!inDouble && !inTpl && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTpl && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTpl = !inTpl; continue; }
    if (inSingle || inDouble || inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated function ${signature}`);
}

function makeMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map.entries()); }
  };
}

describe('v3.9.104 R1 — Gapless Bit-Perfect Drain/Ramp, DSD-to-PCM, Doze FGS/WakeLock Continuity & USB DAC Parity', () => {
  it('1. [R1-Contract] BitPerfectAudioPlayer tail-frame drain (getPlaybackHeadPosition / written frames), clickless ramp, 2-step USB DAC settle (55ms + 95ms) & API 26–30 INFO_OUTPUT_FORMAT_CHANGED guard', () => {
    const bpClassSlice = extractBetween(mainJava, 'public class BitPerfectAudioPlayer {', 'private class HttpRangeMediaDataSource');
    const loopSlice = extractBetween(mainJava, 'private void runPlaybackLoop(', 'private class HttpRangeMediaDataSource');
    const buildSlice = extractBetween(mainJava, 'private AudioTrack createAndConfigureBitPerfectAudioTrack(', 'private void notifyBitPerfectFormatToWeb(');

    // 1. Natural EOS tail-frame drain using getPlaybackHeadPosition() against written frames with abort & stall bounds
    assert.ok(
      bpClassSlice.includes('getPlaybackHeadPosition()') &&
      /(?:currentTrackWrittenFrames|writtenFramesSinceBase|drainedFrames|drainStart)/i.test(bpClassSlice),
      'BitPerfectAudioPlayer must drain AudioTrack tail frames using getPlaybackHeadPosition() vs written frames on natural EOS'
    );
    assert.ok(
      loopSlice.includes('sawOutputEOS') &&
      /(?:drainAudioTrackTail|getPlaybackHeadPosition)/.test(loopSlice) &&
      loopSlice.includes('mIsStopped') &&
      loopSlice.includes('mSeekTargetUs') &&
      loopSlice.includes('mRouteRefreshFlags'),
      'runPlaybackLoop natural EOS drain must check mIsStopped, mSeekTargetUs, and mRouteRefreshFlags so stop/seek/route switches never block'
    );

    // 2. Clickless ramp/mute on abrupt stop/seek/format change before AudioTrack flush()/stop()
    assert.ok(
      /setVolume\(\s*0(?:f|\.0f)?\s*\)|ramp(?:AudioTrack)?(?:Volume)?ToZero/i.test(bpClassSlice),
      'BitPerfectAudioPlayer must perform a clickless zero-volume ramp/mute before flushing/stopping AudioTrack on abrupt stop, seek, or format switch'
    );

    // 3. 2-step USB DAC settle retry (55ms + 95ms) guarded by epoch & !mIsStopped before 16-bit fallback
    const sleep55Idx = loopSlice.indexOf('Thread.sleep(55)');
    const sleep95Idx = loopSlice.indexOf('Thread.sleep(95)');
    const fallbackIdx = loopSlice.indexOf('rebuildAudioTrackWith16BitFallback(');
    assert.ok(
      sleep55Idx !== -1 && sleep95Idx !== -1 && fallbackIdx !== -1 &&
      sleep55Idx < sleep95Idx && sleep95Idx < fallbackIdx,
      'runPlaybackLoop must perform 2-step USB DAC settle (55ms then 95ms) before rebuildAudioTrackWith16BitFallback'
    );
    assert.ok(
      loopSlice.slice(sleep55Idx, fallbackIdx).includes('!mIsStopped && mPlaybackEpoch.get() == epoch'),
      '2-step USB DAC settle retry must be guarded by !mIsStopped && mPlaybackEpoch.get() == epoch'
    );

    // 4. API 26-30 INFO_OUTPUT_FORMAT_CHANGED guard: preserve freshly built AudioTrack when writtenFramesSinceBase == 0 & rate/channels match (or safe PCM_ENCODING handling)
    const fmtChangedIdx = loopSlice.indexOf('MediaCodec.INFO_OUTPUT_FORMAT_CHANGED');
    assert.ok(fmtChangedIdx !== -1, 'runPlaybackLoop must handle INFO_OUTPUT_FORMAT_CHANGED');
    const fmtBlock = loopSlice.slice(fmtChangedIdx, loopSlice.indexOf('MediaCodec.INFO_TRY_AGAIN_LATER', fmtChangedIdx));
    assert.ok(
      fmtBlock.includes('writtenFramesSinceBase == 0') ||
      fmtBlock.includes('writtenFramesSinceBase <= 0') ||
      fmtBlock.includes('initialOutFmt'),
      'INFO_OUTPUT_FORMAT_CHANGED must guard initial API 26-30 format events when writtenFramesSinceBase == 0'
    );
    assert.ok(buildSlice.includes('AudioTrack.getMinBufferSize('), 'API 26-30 getMinBufferSize fallback must remain intact');
  });

  it('2. [R1-Contract] Doze survivability: mTransitionHoldUntilElapsedMs, stopBitPerfectPlaybackForHandoff(), setPlaybackLoadingWakeLock(), FGS EOS->next hold & START_STICKY null-intent zombie guard', () => {
    // 1. @JavascriptInterface bridge methods per PROJECT.md § Interface Contracts
    assert.ok(
      mainJava.includes('@JavascriptInterface') &&
      mainJava.includes('public void stopBitPerfectPlaybackForHandoff()') &&
      mainJava.includes('public void setPlaybackLoadingWakeLock(boolean'),
      'MainActivity.java WebAppInterface must expose stopBitPerfectPlaybackForHandoff() and setPlaybackLoadingWakeLock(boolean)'
    );

    // 2. stopBitPerfectPlayback() keeps full teardown; stopBitPerfectPlaybackForHandoff() preserves FGS/WakeLock/AudioFocus across mTransitionHoldUntilElapsedMs
    const stopBpSlice = extractFn(mainJava, 'public void stopBitPerfectPlayback()');
    const bpPlayerStopSlice = extractFn(mainJava, 'public synchronized void stop()');
    const stopHandoffSlice = extractFn(mainJava, 'public void stopBitPerfectPlaybackForHandoff()');
    assert.ok(stopBpSlice.includes('clearTrackTransitionHold()') && stopBpSlice.includes('mBitPerfectPlayer.stop()'), 'stopBitPerfectPlayback() must clear transition hold and call mBitPerfectPlayer.stop()');
    assert.ok(bpPlayerStopSlice.includes('stopInternal(false'), 'BitPerfectAudioPlayer.stop() must preserve full teardown via stopInternal(false)');
    assert.ok(
      mainJava.includes('mTransitionHoldUntilElapsedMs') &&
      stopHandoffSlice.includes('beginTrackTransitionHold(') &&
      stopHandoffSlice.includes('stopForHandoff()'),
      'MainActivity.java must maintain mTransitionHoldUntilElapsedMs across stopBitPerfectPlaybackForHandoff()'
    );

    // 3. runPlaybackLoop finally & scheduleNaturalEosUiSync must respect active transition hold before dropping WakeLock/AudioFocus/FGS
    const loopSlice = extractBetween(mainJava, 'private void runPlaybackLoop(', 'private class HttpRangeMediaDataSource');
    const finallySlice = loopSlice.slice(loopSlice.lastIndexOf('} finally {'));
    assert.ok(
      finallySlice.includes('mTransitionHoldUntilElapsedMs') ||
      finallySlice.includes('isTransitionHoldActive'),
      'runPlaybackLoop finally must defer WakeLock/AudioFocus teardown when transition hold is active on natural EOS'
    );
    const eosUiSlice = extractFn(mainJava, 'private void scheduleNaturalEosUiSync(');
    assert.ok(
      eosUiSlice.includes('mTransitionHoldUntilElapsedMs') ||
      eosUiSlice.includes('isTransitionHoldActive'),
      'scheduleNaturalEosUiSync must guard against prematurely dropping foreground notification during active EOS transition hold'
    );

    // 4. onPause() must respect playback-loading / transition wake lock before releasing WakeLock
    const onPauseSlice = extractFn(mainJava, 'protected void onPause()');
    assert.ok(
      onPauseSlice.includes('mIsPlaybackTransitioning') &&
      onPauseSlice.includes('isTransitionHoldActive'),
      'MainActivity.onPause() must check both mIsPlaybackTransitioning and isTransitionHoldActive before releasing WakeLock'
    );

    // 5. NocturnePlaybackService START_STICKY null-intent zombie guard
    const onStartSlice = extractFn(svcJava, 'public int onStartCommand(');
    assert.ok(
      onStartSlice.includes('intent == null') &&
      onStartSlice.includes('MainActivity.getActiveInstance()') &&
      onStartSlice.includes('START_NOT_STICKY') &&
      onStartSlice.includes('stopSelf()'),
      'NocturnePlaybackService.onStartCommand must guard null START_STICKY restarts when MainActivity.getActiveInstance() == null without leaving zombie isPlaying=true notification'
    );

    // 6. index.html invokes stopBitPerfectPlaybackForHandoff (with fallback) & setPlaybackLoadingWakeLock
    assert.ok(
      html.includes('stopBitPerfectPlaybackForHandoff'),
      'index.html must invoke NocturneNative.stopBitPerfectPlaybackForHandoff during Bit-Perfect -> DSD/WebAudio handoff'
    );
    assert.ok(
      html.includes('setPlaybackLoadingWakeLock'),
      'index.html must invoke NocturneNative.setPlaybackLoadingWakeLock during WebAudio/DSD track loading'
    );
  });

  it('3. [R1-Contract] Behavioral VM: HTML5 <audio> pause-on-ended guard prevents premature Native FGS/WakeLock drop during autoplay/repeat', () => {
    const attachFn = extractFn(html, 'function attachDeckEvents(element)');
    const listeners = {};
    const notifCalls = [];
    const els = {};
    const mkEl = id => (els[id] || (els[id] = {
      id, textContent: '', value: '0',
      classList: { add() {}, remove() {}, toggle() {} },
      matches: () => false,
      setAttribute() {}
    }));
    const element = {
      id: 'audio',
      src: 'blob:track-1',
      paused: true,
      ended: true,
      currentTime: 180,
      duration: 180,
      dataset: { trackId: 't1' },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    };
    const standbyAudio = { id: 'preload-audio', src: '', paused: true, readyState: 0 };
    const sandbox = {
      library,
      Date, Math, Number, String, Boolean, URL, Array, Set, Map,
      location: { href: 'https://nocturne.local/' },
      $: mkEl,
      audio: element,
      standbyAudio,
      isSilentUnlockSrc: () => false,
      setVisualizerRunning: () => {},
      savePlaybackSession: () => {},
      updatePositionState: () => {},
      updateBufferPipelineTelemetry: () => {},
      updateLyricsHighlight: () => {},
      lastDisplayedPlaybackSecond: -1,
      lastPositionStateSecond: -1,
      navigator: { mediaSession: { playbackState: 'playing' } },
      window: {
        NocturneNative: {
          updateMediaNotification: (t, a, al, isPlaying) => notifCalls.push({ t, a, al, isPlaying })
        }
      },
      state: {
        currentId: 't1',
        tracks: [
          { id: 't1', title: 'Song One', artist: 'Artist A', album: 'Album X', duration: 180 },
          { id: 't2', title: 'Song Two', artist: 'Artist A', album: 'Album X', duration: 200 }
        ],
        autoplay: true,
        repeat: 0,
        isNativeBitPerfectPlaying: false,
        isPlaybackLoading: false,
        isFullscreen: false,
        fullscreenViewMode: 'art'
      },
      queueIndex: () => 1
    };

    vm.runInNewContext(`${attachFn}\nattachDeckEvents(audio);`, sandbox);
    assert.ok(Array.isArray(listeners.pause) && listeners.pause.length > 0, 'attachDeckEvents must bind pause listener');

    // Case A: Natural end (element.ended === true) with autoplay & queued next track -> must NOT drop FGS/notification or pause mediaSession
    listeners.pause.forEach(fn => fn());
    assert.equal(notifCalls.filter(c => c.isPlaying === false).length, 0, 'Natural track end (ended=true, autoplay=true) must NOT send isPlaying=false notification');
    assert.notEqual(sandbox.navigator.mediaSession.playbackState, 'paused', 'Natural track end must NOT flip mediaSession.playbackState to paused');

    // Case B: Natural end with repeat === 2 (single repeat) and queueIndex() === -1 -> must NOT drop FGS/notification
    sandbox.state.autoplay = false;
    sandbox.state.repeat = 2;
    sandbox.queueIndex = () => -1;
    listeners.pause.forEach(fn => fn());
    assert.equal(notifCalls.filter(c => c.isPlaying === false).length, 0, 'Natural track end with repeat=2 must NOT send isPlaying=false notification');

    // Case C: Explicit user pause (element.ended === false) -> MUST still pause UI, mediaSession, and Native notification
    element.ended = false;
    sandbox.state.autoplay = true;
    sandbox.state.repeat = 0;
    listeners.pause.forEach(fn => fn());
    assert.equal(notifCalls.filter(c => c.isPlaying === false).length, 1, 'Explicit user pause (!element.ended) must still call updateMediaNotification(..., false)');
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused', 'Explicit user pause must set mediaSession.playbackState = "paused"');
    assert.equal(els['play-button'].textContent, '▶');
  });

  it('4. [R1-Contract] Behavioral VM & Contract: finishPlaybackStart 65ms deferred fadeSeconds===0 cleanup (!wasOldPlaying sync), gaplessLookaheadEligible preserved, DSD safeResumeAudioContext(350), stopDsdWorker ordering, crossfade clear & fiio_ DSD file release', () => {
    const applyCrossfadeFn = extractFn(html, 'function applyCrossfade(context, oldDeck, newDeck, seconds)');
    const finishFn = extractFn(html, 'function finishPlaybackStart(track, generation, target, previousTrack)');

    function runFinishVm({ crossfadeSeconds = 0, oldPaused = false, oldSrc = 'blob:https://nocturne.local/old', preloadUrl = '' } = {}) {
      const timeouts = [];
      const cleared = [];
      let preloadCalls = 0;
      const mkGain = () => ({
        value: 1,
        setTargetAtTime() {},
        cancelScheduledValues() {},
        setValueAtTime(v) { this.value = v; },
        setValueCurveAtTime() {}
      });
      const mkEl = (id, src, paused) => ({
        id, src, paused, muted: false, defaultMuted: false, removed: [], loads: 0, pauseCalls: 0, dataset: {},
        pause() { this.pauseCalls++; this.paused = true; },
        removeAttribute(n) { this.removed.push(n); if (n === 'src') this.src = ''; },
        load() { this.loads++; }
      });
      const oldEl = mkEl('audio', oldSrc, oldPaused);
      const newEl = mkEl('preload-audio', 'blob:https://nocturne.local/new', false);
      const deckA = { element: oldEl, router: { gain: mkGain() } };
      const deckB = { element: newEl, router: { gain: mkGain() } };
      const prevTrack = { id: 'old', title: 'Old Track', url: oldSrc };
      const curTrack = { id: 'now', title: 'New Track' };
      const nextTrack = { id: 'next', title: 'Next Track', url: preloadUrl || null };
      const sandbox = {
        library,
        URL, Number, Math, String, Boolean, Object, Array,
        location: { href: 'https://nocturne.local/' },
        $: () => ({ textContent: '' }),
        audio: oldEl,
        standbyAudio: newEl,
        lastDisplayedPlaybackSecond: -1,
        lastPositionStateSecond: -1,
        recordHistory: () => {},
        scheduleTrackRender: () => {},
        preloadNext: () => { preloadCalls++; },
        releaseUnusedCloudUrl: () => {},
        releaseUnusedLocalUrl: () => {},
        setTimeout: (fn, ms) => { timeouts.push({ fn, ms, id: timeouts.length + 1 }); return timeouts.length; },
        clearTimeout: id => cleared.push(id),
        state: {
          tracks: [prevTrack, curTrack, nextTrack],
          currentId: 'now',
          playGeneration: 7,
          crossfadeSeconds,
          crossfadeUntil: 0,
          context: { currentTime: 50, state: 'running' },
          deckA, deckB, activeDeck: deckA,
          preloadTrackId: null, preloadReadyUrl: null
        }
      };
      vm.runInNewContext(`${applyCrossfadeFn}\n${finishFn}`, sandbox);
      const ok = sandbox.finishPlaybackStart(curTrack, 7, newEl, prevTrack);
      return { ok, timeouts, cleared, oldEl, newEl, sandbox, getPreloadCalls: () => preloadCalls };
    }

    // A. M1 Option A: fadeSeconds === 0 && wasOldPlaying === true -> 65ms deferred cleanup + preloadNext(true) after timer
    const deferRun = runFinishVm({ crossfadeSeconds: 0, oldPaused: false });
    assert.equal(deferRun.ok, true);
    assert.equal(deferRun.timeouts.length, 1, 'fadeSeconds === 0 with wasOldPlaying must schedule 1 deferred cleanup timer');
    assert.equal(deferRun.timeouts[0].ms, 65, 'Deferred clickless cleanup must be 65ms');
    assert.equal(deferRun.oldEl.pauseCalls, 0, 'Before 65ms timer fires, previous must NOT be paused yet so the 18ms Web Audio ramp completes clicklessly');
    assert.equal(deferRun.oldEl.src, 'blob:https://nocturne.local/old', 'Before 65ms timer fires, previous.src must stay intact for 18ms ramp');
    assert.equal(deferRun.getPreloadCalls(), 0, 'Before 65ms timer fires, preloadNext(true) waits for deferred cleanup');
    deferRun.timeouts[0].fn();
    assert.equal(deferRun.oldEl.pauseCalls, 2);
    assert.equal(deferRun.oldEl.src, '');
    assert.equal(deferRun.getPreloadCalls(), 1, 'preloadNext(true) must run once deferred cleanup completes');

    // B. Stale generation guard on 65ms timer
    const staleRun = runFinishVm({ crossfadeSeconds: 0, oldPaused: false });
    staleRun.sandbox.state.playGeneration = 8;
    staleRun.timeouts[0].fn();
    assert.equal(staleRun.oldEl.pauseCalls, 0, 'Stale generation must prevent 65ms timer from pausing/clearing a newly active deck');
    assert.equal(staleRun.oldEl.src, 'blob:https://nocturne.local/old');

    // C. Cold start (!wasOldPlaying): synchronous cleanup with 0 timeouts
    const coldRun = runFinishVm({ crossfadeSeconds: 0, oldPaused: true });
    assert.equal(coldRun.ok, true);
    assert.equal(coldRun.timeouts.length, 0, 'Cold start (!wasOldPlaying) must clean up synchronously without scheduling a timer');
    assert.equal(coldRun.oldEl.src, '');
    assert.equal(coldRun.oldEl.pauseCalls, 2);
    assert.equal(coldRun.getPreloadCalls(), 1, 'Cold start (!wasOldPlaying) must run preloadNext(true) synchronously');

    // D. gaplessLookaheadEligible preserved (M1 Option A keeps 0.18s without requiring 0.07s)
    const attachFn = extractFn(html, 'function attachDeckEvents(element)');
    assert.ok(attachFn.includes('gaplessLookaheadEligible') && attachFn.includes('cueGaplessLookaheadEligible'), 'gaplessLookaheadEligible must remain intact in attachDeckEvents');

    // E. DSD-to-PCM hardening: safeResumeAudioContext(350), stopDsdWorker(false) before setupAudio(), crossfade clear, fiio_ DSD file release
    const playTrackFn = extractBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
    const playDsdSliceFn = extractFn(html, 'async function playDsdFirstSlice(track, sliceBlob, generation, playRequestedAt)');
    const playDsdTrackFn = extractFn(html, 'async function playDsdTrack(track, generation, playRequestedAt)');

    assert.equal(/await\s+state\.context\.resume\(\)/.test(playDsdSliceFn), false, 'playDsdFirstSlice must use safeResumeAudioContext(350), not unbounded state.context.resume()');
    assert.equal(/await\s+state\.context\.resume\(\)/.test(playDsdTrackFn), false, 'playDsdTrack must use safeResumeAudioContext(350), not unbounded state.context.resume()');
    assert.ok(playDsdSliceFn.includes('safeResumeAudioContext(350)'), 'playDsdFirstSlice must call safeResumeAudioContext(350)');
    assert.ok(playDsdTrackFn.includes('safeResumeAudioContext(350)'), 'playDsdTrack must call safeResumeAudioContext(350)');

    assert.ok(
      playDsdTrackFn.includes('_crossfadeCleanupTimer') && playDsdTrackFn.includes('state.crossfadeUntil = 0'),
      'playDsdTrack must clear state._crossfadeCleanupTimer and reset state.crossfadeUntil = 0'
    );

    const stopDsdIdx = playTrackFn.indexOf('stopDsdWorker(');
    const setupAudioIdx = playTrackFn.indexOf('setupAudio()');
    assert.ok(
      stopDsdIdx !== -1 && setupAudioIdx !== -1 && stopDsdIdx < setupAudioIdx,
      'playTrack must call stopDsdWorker(false) BEFORE setupAudio() when leaving DSD'
    );

    // fiio_ DSD previousTrack.file release must run on DSD -> PCM transitions (not gated solely inside if (track.isDsd))
    const dsdBranchStart = playTrackFn.indexOf('if (track.isDsd) {');
    const nonDsdArea = playTrackFn.slice(0, dsdBranchStart) + playTrackFn.slice(playTrackFn.indexOf('const cachedCloudUrl =', dsdBranchStart));
    assert.ok(
      nonDsdArea.includes('previousTrack.file = null') ||
      nonDsdArea.includes('releaseUnusedFiioDsdFile'),
      'playTrack must release fiio_ DSD previousTrack.file on DSD -> PCM transitions as well as DSD -> DSD'
    );
  });

  it('5. [Preserved] Run #85/#89/#90 Native & Web Audio invariants remain intact', () => {
    // Run #85/#90: recoverWebViewAfterRenderProcessGone must NOT stop Bit-Perfect playback
    const recFn = extractFn(mainJava, 'private boolean recoverWebViewAfterRenderProcessGone(final WebView deadView)');
    assert.equal(recFn.includes('stopBitPerfectPlayback'), false, 'recoverWebViewAfterRenderProcessGone must NOT call stopBitPerfectPlayback');
    assert.equal(recFn.includes('mBitPerfectPlayer.stop'), false, 'recoverWebViewAfterRenderProcessGone must NOT call mBitPerfectPlayer.stop');
    assert.ok(mainJava.includes('public void setBitPerfectTrackWindow(long cueStartMs, long cueDurationMs, String title, String artist, String album)'), '5-arg setBitPerfectTrackWindow signature must be preserved');

    // Web Audio crossfeed invariant
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'crossfeedNodes.output -> context.destination invariant must be preserved');

    // Run #89 P0 Play/Pause & Run #90 AVRCP 1.6 / Api34AudioHelper / session flush invariants
    assert.ok(html.includes('function attachReliableTransportTap(el)'), 'Run #89 attachReliableTransportTap must be preserved');
    assert.ok(mainJava.includes('isDuplicateMediaKeyEvent(@Nullable KeyEvent ke)'), 'Run #89 isDuplicateMediaKeyEvent must be preserved');
    assert.ok(mainJava.includes('mLastPlayPauseTransportAtMs') && mainJava.includes('< 450L'), 'Run #89 mLastPlayPauseTransportAtMs < 450L guard must be preserved');
    assert.ok(mainJava.includes('mLastBitPerfectStartOrResumeElapsedMs'), 'Run #89 AudioFocus guard must be preserved');
    assert.ok(mainJava.includes('mSeekGeneration') && mainJava.includes('Api34AudioHelper'), 'Run #90 AVRCP 1.6 mSeekGeneration & Api34AudioHelper must be preserved');
    assert.ok(html.includes('savePlaybackSession(true)'), 'Run #90 savePlaybackSession(true) must be preserved');
  });

  it('6. [Tier5-Gap1] BitPerfectAudioPlayer pause/resume synchronization & every non-init track.play() sets volume (including runPlaybackLoop mid-buffer resume)', () => {
    const bpClassSlice = extractBetween(mainJava, 'public class BitPerfectAudioPlayer {', 'private class HttpRangeMediaDataSource');
    const pauseFn = extractFn(bpClassSlice, 'public void pause()');
    const resumeFn = extractFn(bpClassSlice, 'public void resume()');

    // 1. pause() re-checks mIsPaused && !mIsStopped inside synchronized (mPauseLock) after rampDownAudioTrackBeforeStop before calling track.pause()
    const rampIdx = pauseFn.indexOf('rampDownAudioTrackBeforeStop(track, true);');
    const trackPauseIdx = pauseFn.indexOf('track.pause();');
    assert.ok(rampIdx !== -1 && trackPauseIdx > rampIdx, 'pause() must ramp before track.pause()');
    const betweenRampAndPause = pauseFn.slice(rampIdx, trackPauseIdx);
    assert.ok(
      betweenRampAndPause.includes('synchronized (mPauseLock)') &&
      betweenRampAndPause.includes('mIsPaused && !mIsStopped'),
      'pause() must re-check mIsPaused && !mIsStopped inside mPauseLock after 8ms ramp before calling track.pause()'
    );
    assert.ok(
      pauseFn.includes('!mIsPaused && !mIsStopped') && pauseFn.includes('AudioTrack.getMaxVolume()'),
      'pause() must restore volume if resume() intervened during rampDownAudioTrackBeforeStop'
    );

    // 2. resume() synchronizes mIsPaused = false and AudioTrack volume/play under mPauseLock even if already PLAYSTATE_PLAYING
    assert.ok(
      resumeFn.includes('synchronized (mPauseLock)') &&
      resumeFn.includes('!mPreferredMixerAttributesSet') &&
      resumeFn.includes('track.setVolume(mIsDucked ? 0.25f : AudioTrack.getMaxVolume())'),
      'resume() must restore volume under mPauseLock when !mPreferredMixerAttributesSet even if AudioTrack is still PLAYSTATE_PLAYING'
    );

    // 3. Every track.play() in BitPerfectAudioPlayer (except the fresh createAndConfigureBitPerfectAudioTrack init site) restores volume immediately prior
    const playMatches = [...bpClassSlice.matchAll(/track\.play\(\)/g)];
    assert.ok(playMatches.length >= 8, `Expected >= 8 track.play() sites in BitPerfectAudioPlayer, found ${playMatches.length}`);
    let nonInitWithVolume = 0;
    let initSiteCount = 0;
    for (const m of playMatches) {
      const ctx = bpClassSlice.slice(Math.max(0, m.index - 260), m.index);
      const ctxLong = bpClassSlice.slice(Math.max(0, m.index - 2600), m.index);
      if (ctxLong.includes('createAndConfigureBitPerfectAudioTrack(') && ctx.includes('mLastBitPerfectStartOrResumeElapsedMs')) {
        initSiteCount++;
        continue;
      }
      assert.ok(
        ctx.includes('track.setVolume(mIsDucked ? 0.25f : AudioTrack.getMaxVolume())'),
        `track.play() site missing volume restore in context:\n${ctx}`
      );
      nonInitWithVolume++;
    }
    assert.equal(initSiteCount, 1, 'Expected exactly 1 fresh init track.play() after createAndConfigureBitPerfectAudioTrack');
    assert.ok(nonInitWithVolume >= 7, 'All non-init track.play() sites must restore volume');
  });

  it('7. [Tier5-Gap2] Post-hold abort clears stuck WakeLock/mIsMediaPlaying in MainActivity.java & calls updateMediaNotification(..., false) in index.html playTrack', async () => {
    // 1. MainActivity.java mHoldExpiredWhileTransitioning lifecycle
    assert.ok(
      mainJava.includes('private volatile boolean mHoldExpiredWhileTransitioning = false;'),
      'MainActivity must declare volatile mHoldExpiredWhileTransitioning'
    );
    const onExpiredFn = extractFn(mainJava, 'private void onTransitionHoldExpired()');
    assert.ok(
      onExpiredFn.includes('mHoldExpiredWhileTransitioning = true;'),
      'onTransitionHoldExpired must record mHoldExpiredWhileTransitioning = true when hold expires during active loading transition'
    );
    const setLoadWakeFn = extractFn(mainJava, 'public void setPlaybackLoadingWakeLock(boolean active)');
    assert.ok(
      setLoadWakeFn.includes('mHoldExpiredWhileTransitioning') &&
      setLoadWakeFn.includes('mIsMediaPlaying = false;') &&
      setLoadWakeFn.includes('NocturnePlaybackService.syncBackgroundPauseIfRunning(') &&
      setLoadWakeFn.includes('releaseWakeLock();') &&
      setLoadWakeFn.includes('abandonAudioFocus();'),
      'setPlaybackLoadingWakeLock(false) must clean up mIsMediaPlaying, NocturnePlaybackService, WakeLock, and AudioFocus if hold expired while transitioning'
    );
    const updNotifFn = extractFn(mainJava, 'private void updateMediaNotificationInternal(');
    assert.ok(updNotifFn.includes('mHoldExpiredWhileTransitioning = false;'), 'updateMediaNotificationInternal must clear mHoldExpiredWhileTransitioning');

    // 2. index.html playTrack early abort returns notify NocturneNative.updateMediaNotification(..., false)
    const resolveEntryFn = extractFn(html, 'function resolvePlayTrackEntry(trackId)');
    const playTrackFn = extractBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
    const notifCalls = [];
    const wakeLockCalls = [];
    const mkEl = () => ({ textContent: '', classList: { add() {}, remove() {} } });
    const ptSandbox = {
      library,
      Date, Math, Number, String, Boolean, Object, Array, URL, Set, Map, Promise,
      performance: { now: () => 100 },
      location: { href: 'https://nocturne.local/' },
      navigator: { onLine: false },
      $: () => mkEl(),
      toast: () => {},
      console,
      audio: { paused: false, pause() {}, src: '', dataset: {} },
      standbyAudio: { paused: true, pause() {}, src: '', dataset: {} },
      isTrackRoutedToNativeBitPerfect: () => false,
      abortStaleFullAudioUpgrades: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      skipFailedTrack: () => false,
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      clearOptimisticLoadingUi: () => {},
      setupAudio: () => { ptSandbox.state.context = { state: 'running', resume: async () => {} }; },
      unlockAudioDecksOnGesture: () => {},
      setPlaybackLoading: v => wakeLockCalls.push(Boolean(v)),
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      resetBitPerfectModeBadge: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      window: {
        NocturneNative: {
          stopBitPerfectPlaybackForHandoff: () => {},
          acquireWakeLock: () => {},
          requestAudioFocus: () => {},
          updateMediaNotification: (t, a, al, isPlaying) => notifCalls.push({ t, a, al, isPlaying })
        }
      },
      state: {
        currentId: 'bp-old',
        playGeneration: 1,
        preloadGeneration: 0,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        bitPerfectEnabled: true,
        objectUrls: new Set(),
        tracks: [
          { id: 'bp-old', title: 'Old BP', artist: 'A', album: 'Alb' },
          { id: 'cloud-next', source: 'google', remoteId: 'g1', title: 'Cloud Next', artist: 'B', album: 'Alb2', load: async () => {} },
          { id: 'local-perm', source: 'local', isDsd: true, title: 'Denied DSD', artist: 'C', album: 'Alb3', _localAccessError: 'permission_denied' }
        ]
      }
    };
    vm.runInNewContext(`${resolveEntryFn}\n${playTrackFn}`, ptSandbox);

    // Case A: Offline cloud PCM abort after Native BP handoff -> must call updateMediaNotification(..., false)
    await ptSandbox.playTrack('cloud-next');
    assert.deepEqual(wakeLockCalls, [true, false]);
    assert.ok(notifCalls.some(c => c.isPlaying === false), 'playTrack offline abort must call updateMediaNotification(..., false)');

    // Case B: DSD permission_denied abort -> must call updateMediaNotification(..., false)
    notifCalls.length = 0;
    await ptSandbox.playTrack('local-perm');
    assert.ok(notifCalls.some(c => c.isPlaying === false), 'playTrack DSD permission_denied abort must call updateMediaNotification(..., false)');
  });

  it('8. [Tier5-NewGapA] notifyAbortMediaPaused guards active audio decks/engines (SubA SAF permission_denied, SubB missing URL, SubC crossfadeSeconds > 0, silent-unlock & stale generation)', async () => {
    const resolveEntryFn = extractFn(html, 'function resolvePlayTrackEntry(trackId)');
    const silentUnlockSlice = extractBetween(html, 'const SILENT_UNLOCK_WAV =', 'function unlockAudioDecksOnGesture(');
    const playTrackFn = extractBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');

    function createGapASandbox({
      audioSrc = 'blob:https://nocturne.local/track-1',
      audioPaused = false,
      audioEnded = false,
      standbyPaused = true,
      standbySrc = '',
      crossfadeSeconds = 0,
      onLine = true,
      probeResult = 'permission_denied',
      isNativeBpPlaying = false,
      bumpGenInProbe = false
    } = {}) {
      const notifCalls = [];
      const toasts = [];
      const mkEl = () => ({ textContent: '', classList: { add() {}, remove() {} } });
      const mkDeckEl = (id, src, paused, ended) => ({
        id,
        src,
        paused,
        ended,
        muted: false,
        defaultMuted: false,
        volume: 0.8,
        readyState: 0,
        networkState: 0,
        dataset: {},
        pause() { this.paused = true; },
        removeAttribute(n) { if (n === 'src') this.src = ''; },
        load() {},
        addEventListener() {},
        removeEventListener() {},
        async play() {
          const err = new Error('NotSupported');
          err.name = 'NotSupportedError';
          throw err;
        }
      });
      const audioEl = mkDeckEl('audio', audioSrc, audioPaused, audioEnded);
      const standbyEl = mkDeckEl('preload-audio', standbySrc, standbyPaused, false);
      const sb = {
        library,
        Date, Math, Number, String, Boolean, Object, Array, URL, Set, Map, Promise,
        performance: { now: () => 100 },
        location: { href: 'https://nocturne.local/' },
        navigator: { onLine },
        $: () => mkEl(),
        toast: msg => toasts.push(msg),
        console,
        audio: audioEl,
        standbyAudio: standbyEl,
        isTrackRoutedToNativeBitPerfect: () => false,
        abortStaleFullAudioUpgrades: () => {},
        stopPrefetchDsdSlice: () => {},
        stopDsdWorker: () => {},
        clearStalePreload: () => {},
        abortPlayCleanup: () => {},
        retryPlayOnAbort: async err => { throw err; },
        skipFailedTrack: () => false,
        displayTrack: () => {},
        applyOptimisticPlaybackUi: () => {},
        clearOptimisticLoadingUi: () => {},
        setupAudio: () => { sb.state.context = { state: 'running', resume: async () => {} }; },
        unlockAudioDecksOnGesture: () => {},
        setPlaybackLoading: () => {},
        invalidateStaleStandbyPreload: () => false,
        syncPendingNextCloudWifiLock: () => {},
        deferRenderQueue: () => {},
        resetBitPerfectModeBadge: () => {},
        releaseUnusedCloudUrl: () => {},
        releaseUnusedLocalUrl: () => {},
        isExternalNonAppAssetsHttpUrl: () => false,
        mediaErrorMessage: e => String((e && e.message) || e),
        probeLocalMediaAccessError: async () => {
          if (bumpGenInProbe) sb.state.playGeneration++;
          return probeResult;
        },
        window: {
          NocturneNative: {
            stopBitPerfectPlaybackForHandoff: () => {},
            acquireWakeLock: () => {},
            requestAudioFocus: () => {},
            updateMediaNotification: (t, a, al, isPlaying) => notifCalls.push({ t, a, al, isPlaying })
          }
        },
        state: {
          currentId: 't1',
          playGeneration: 1,
          preloadGeneration: 0,
          crossfadeSeconds,
          isNativeBitPerfectPlaying: isNativeBpPlaying,
          isNativeBitPerfectPaused: false,
          bitPerfectEnabled: false,
          objectUrls: new Set(),
          tracks: [
            { id: 't1', source: 'local', title: 'Playing Track', artist: 'A1', album: 'Alb1', url: audioSrc },
            { id: 'saf-denied', source: 'local', title: 'SAF Denied', artist: 'A2', album: 'Alb2', url: 'https://appassets.androidplatform.net/local-media?uri=content%3A%2F%2Ffoo' },
            { id: 'missing-url', source: 'local', title: 'Missing URL', artist: 'A3', album: 'Alb3', url: '' },
            { id: 'cloud-offline', source: 'google', remoteId: 'g2', title: 'Cloud Offline', artist: 'A4', album: 'Alb4', load: async () => {} }
          ]
        }
      };
      vm.runInNewContext(`${silentUnlockSlice}\n${resolveEntryFn}\n${playTrackFn}`, sb);
      return { sb, notifCalls, audioEl, standbyEl, toasts };
    }

    // SubA: Local SAF permission_denied while Track 1 is actively playing -> MUST NOT drop FGS/notification
    const subA = createGapASandbox({ audioPaused: false, audioEnded: false });
    await subA.sb.playTrack('saf-denied');
    assert.equal(subA.audioEl.paused, false, 'SubA: Track 1 audio element must stay playing');
    assert.equal(subA.notifCalls.length, 0, 'SubA: SAF permission_denied must NOT call updateMediaNotification(..., false) while Track 1 is playing');

    // SubB: Missing track.url while Track 1 is actively playing -> MUST NOT drop FGS/notification
    const subB = createGapASandbox({ audioPaused: false, audioEnded: false });
    await subB.sb.playTrack('missing-url');
    assert.equal(subB.audioEl.paused, false, 'SubB: Track 1 audio element must stay playing');
    assert.equal(subB.notifCalls.length, 0, 'SubB: missing track.url must NOT call updateMediaNotification(..., false) while Track 1 is playing');

    // SubC: crossfadeSeconds = 4 offline cloud abort while Track 1 is actively playing -> MUST NOT drop FGS/notification
    const subC = createGapASandbox({ audioPaused: false, audioEnded: false, crossfadeSeconds: 4, onLine: false });
    await subC.sb.playTrack('cloud-offline');
    assert.equal(subC.audioEl.paused, false, 'SubC: Track 1 audio element must stay playing during crossfade abort');
    assert.equal(subC.notifCalls.length, 0, 'SubC: crossfade offline abort must NOT call updateMediaNotification(..., false) while Track 1 is playing');

    // SubD: standbyAudio actively playing -> MUST NOT drop FGS/notification
    const subD = createGapASandbox({ audioPaused: true, audioSrc: '', standbyPaused: false, standbySrc: 'blob:https://nocturne.local/standby' });
    await subD.sb.playTrack('missing-url');
    assert.equal(subD.notifCalls.length, 0, 'SubD: active standbyAudio must prevent updateMediaNotification(..., false)');

    // SubE: Stale generation during async probeLocalMediaAccessError -> MUST NOT drop FGS/notification
    const subE = createGapASandbox({ audioPaused: true, audioSrc: '', bumpGenInProbe: true });
    await subE.sb.playTrack('saf-denied');
    assert.equal(subE.notifCalls.length, 0, 'SubE: stale generation must prevent notifyAbortMediaPaused from pausing newer track');

    // Positive controls: SILENT_UNLOCK_WAV or paused/ended audio MUST still call updateMediaNotification(..., false)
    const silentCtrl = createGapASandbox({ audioPaused: false, audioEnded: false });
    silentCtrl.audioEl.src = silentCtrl.sb.SILENT_UNLOCK_WAV;
    await silentCtrl.sb.playTrack('missing-url');
    assert.equal(silentCtrl.notifCalls.filter(c => c.isPlaying === false).length, 1, 'SILENT_UNLOCK_WAV must not block updateMediaNotification(..., false)');

    const endedCtrl = createGapASandbox({ audioPaused: false, audioEnded: true });
    await endedCtrl.sb.playTrack('missing-url');
    assert.equal(endedCtrl.notifCalls.filter(c => c.isPlaying === false).length, 1, 'Ended deck must not block updateMediaNotification(..., false)');
  });

  it('9. [Tier5-NewGapB/D] Web Audio playTrack calls finishPlaybackStart (updateMediaNotification true) BEFORE setPlaybackLoading(false), and MainActivity.updateMediaNotificationInternal(..., true) guards requestAudioFocus() for active BitPerfect only', async () => {
    const resolveEntryFn = extractFn(html, 'function resolvePlayTrackEntry(trackId)');
    const silentUnlockSlice = extractBetween(html, 'const SILENT_UNLOCK_WAV =', 'function unlockAudioDecksOnGesture(');
    const applyCrossfadeFn = extractFn(html, 'function applyCrossfade(context, oldDeck, newDeck, seconds)');
    const finishFn = extractFn(html, 'function finishPlaybackStart(track, generation, target, previousTrack)');
    const playTrackFn = extractBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');

    const events = [];
    const mkGain = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; } });
    const mkEl = () => ({ textContent: '', classList: { add() {}, remove() {} } });
    const deckAEl = { id: 'audio', src: '', paused: true, muted: false, defaultMuted: false, volume: 0.8, dataset: {}, pause() { this.paused = true; }, removeAttribute(n) { if (n === 'src') this.src = ''; }, load() {}, addEventListener() {}, removeEventListener() {} };
    const deckBEl = {
      id: 'preload-audio', src: '', paused: true, muted: false, defaultMuted: false, volume: 0.8, duration: 240, currentTime: 0, readyState: 4, networkState: 1, dataset: {},
      pause() { this.paused = true; },
      removeAttribute(n) { if (n === 'src') this.src = ''; },
      load() {},
      addEventListener() {},
      removeEventListener() {},
      async play() { this.paused = false; events.push('target.play'); }
    };
    const deckA = { element: deckAEl, router: { gain: mkGain() }, replayGain: { gain: mkGain() } };
    const deckB = { element: deckBEl, router: { gain: mkGain() }, replayGain: { gain: mkGain() } };
    const sb = {
      library,
      Date, Math, Number, String, Boolean, Object, Array, URL, Set, Map, Promise,
      performance: { now: () => 100 },
      location: { href: 'https://nocturne.local/' },
      navigator: { onLine: true, mediaSession: { playbackState: 'none' } },
      $: () => mkEl(),
      toast: () => {},
      console,
      audio: deckAEl,
      standbyAudio: deckBEl,
      lastDisplayedPlaybackSecond: -1,
      lastPositionStateSecond: -1,
      isTrackRoutedToNativeBitPerfect: () => false,
      abortStaleFullAudioUpgrades: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      clearOptimisticLoadingUi: () => {},
      setupAudio: () => { sb.state.context = { currentTime: 10, state: 'running', resume: async () => {} }; },
      unlockAudioDecksOnGesture: () => {},
      setPlaybackLoading: v => events.push(`setPlaybackLoading:${Boolean(v)}`),
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      resetBitPerfectModeBadge: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      recordHistory: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      setGain: () => {},
      updatePositionState: () => {},
      savePlaybackSession: () => {},
      setVisualizerRunning: () => {},
      formatTime: s => String(s),
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      window: {
        NocturneNative: {
          updateMediaNotification: (t, a, al, isPlaying) => events.push(`updateMediaNotification:${Boolean(isPlaying)}`)
        }
      },
      state: {
        currentId: null,
        playGeneration: 1,
        preloadGeneration: 0,
        crossfadeSeconds: 0,
        crossfadeUntil: 0,
        bitPerfectEnabled: false,
        replayGainEnabled: false,
        deckA,
        deckB,
        activeDeck: deckA,
        objectUrls: new Set(),
        tracks: [{ id: 'pcm-ok', source: 'local', title: 'PCM OK', artist: 'A', album: 'Alb', url: 'blob:https://nocturne.local/pcm-ok' }]
      }
    };
    vm.runInNewContext(`${silentUnlockSlice}\n${resolveEntryFn}\n${applyCrossfadeFn}\n${finishFn}\n${playTrackFn}`, sb);
    await sb.playTrack('pcm-ok');

    const notifTrueIdx = events.indexOf('updateMediaNotification:true');
    const loadFalseIdx = events.indexOf('setPlaybackLoading:false');
    assert.ok(notifTrueIdx !== -1 && loadFalseIdx !== -1 && notifTrueIdx < loadFalseIdx,
      `updateMediaNotification(true) must run BEFORE setPlaybackLoading(false) to preserve post-hold AudioFocus/FGS; got ${JSON.stringify(events)}`);

    // Native check: updateMediaNotificationInternal(..., true) must NEVER steal WebView AudioFocus unconditionally;
    // requestAudioFocus() must be strictly guarded by (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying())
    const updNotifFn = extractFn(mainJava, 'private void updateMediaNotificationInternal(');
    const isPlayingBranch = extractBetween(updNotifFn, 'if (isPlaying) {', '} else {');
    assert.match(
      isPlayingBranch,
      /if\s*\(\s*mBitPerfectPlayer\s*!=\s*null\s*&&\s*mBitPerfectPlayer\.isPlaying\(\)\s*\)\s*\{\s*requestAudioFocus\(\);\s*\}/,
      'updateMediaNotificationInternal if (isPlaying) must strictly guard requestAudioFocus() with mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()'
    );
    const withoutGuardedFocus = isPlayingBranch.replace(
      /if\s*\(\s*mBitPerfectPlayer\s*!=\s*null\s*&&\s*mBitPerfectPlayer\.isPlaying\(\)\s*\)\s*\{\s*requestAudioFocus\(\);\s*\}/g,
      ''
    );
    assert.ok(
      !withoutGuardedFocus.includes('requestAudioFocus('),
      'updateMediaNotificationInternal if (isPlaying) must not invoke requestAudioFocus() outside the active BitPerfect guard'
    );
    assert.ok(isPlayingBranch.includes('clearTrackTransitionHold();') && isPlayingBranch.includes('acquireWakeLock('), 'updateMediaNotificationInternal must preserve clearTrackTransitionHold and acquireWakeLock');
  });

  it('10. [Tier5-NewGapC] playTrack error catch blocks call notifyAbortMediaPaused() when skipFailedTrack returns false or on toast branch, while preserving skipFailedTrack contracts', async () => {
    const resolveEntryFn = extractFn(html, 'function resolvePlayTrackEntry(trackId)');
    const silentUnlockSlice = extractBetween(html, 'const SILENT_UNLOCK_WAV =', 'function unlockAudioDecksOnGesture(');
    const playTrackFn = extractBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');

    async function runCatchCase({ track, playErrName = 'NotSupportedError', skipReturns = false, audioPlaying = false } = {}) {
      const notifCalls = [];
      const toasts = [];
      const skipCalls = [];
      const mkEl = () => ({ textContent: '', classList: { add() {}, remove() {} } });
      const sb = {
        library,
        Date, Math, Number, String, Boolean, Object, Array, URL, Set, Map, Promise,
        performance: { now: () => 100 },
        location: { href: 'https://nocturne.local/' },
        navigator: { onLine: true },
        $: () => mkEl(),
        toast: m => toasts.push(m),
        console,
        audio: {
          id: 'audio',
          src: audioPlaying ? 'blob:https://nocturne.local/playing' : '',
          paused: !audioPlaying,
          ended: false,
          volume: 0.8,
          pause() { this.paused = true; },
          removeAttribute() {},
          load() {},
          addEventListener() {},
          removeEventListener() {},
          dataset: {}
        },
        standbyAudio: {
          id: 'preload-audio',
          src: '',
          paused: true,
          ended: false,
          readyState: 0,
          networkState: 0,
          volume: 0.8,
          dataset: {},
          pause() {},
          removeAttribute() {},
          load() {},
          addEventListener() {},
          removeEventListener() {},
          async play() {
            const err = new Error(playErrName);
            err.name = playErrName;
            throw err;
          }
        },
        isTrackRoutedToNativeBitPerfect: () => false,
        abortStaleFullAudioUpgrades: () => {},
        stopPrefetchDsdSlice: () => {},
        stopDsdWorker: () => {},
        clearStalePreload: () => {},
        abortPlayCleanup: () => {},
        retryPlayOnAbort: async err => { throw err; },
        skipFailedTrack: (gen, msg) => { skipCalls.push({ gen, msg }); return skipReturns; },
        displayTrack: () => {},
        applyOptimisticPlaybackUi: () => {},
        clearOptimisticLoadingUi: () => {},
        setupAudio: () => { sb.state.context = { state: 'running', resume: async () => {} }; },
        unlockAudioDecksOnGesture: () => {},
        setPlaybackLoading: () => {},
        invalidateStaleStandbyPreload: () => false,
        syncPendingNextCloudWifiLock: () => {},
        deferRenderQueue: () => {},
        resetBitPerfectModeBadge: () => {},
        releaseUnusedCloudUrl: () => {},
        releaseUnusedLocalUrl: () => {},
        isExternalNonAppAssetsHttpUrl: () => false,
        mediaErrorMessage: e => String((e && e.message) || e),
        window: {
          NocturneNative: {
            updateMediaNotification: (t, a, al, isPlaying) => notifCalls.push({ t, a, al, isPlaying })
          }
        },
        state: {
          currentId: null,
          playGeneration: 1,
          preloadGeneration: 0,
          crossfadeSeconds: 0,
          isNativeBitPerfectPlaying: false,
          isNativeBitPerfectPaused: false,
          bitPerfectEnabled: false,
          objectUrls: new Set(),
          tracks: [track]
        }
      };
      vm.runInNewContext(`${silentUnlockSlice}\n${resolveEntryFn}\n${playTrackFn}`, sb);
      await sb.playTrack(track.id);
      return { notifCalls, toasts, skipCalls };
    }

    // Case 1: track.load() throws & skipFailedTrack returns false -> notifyAbortMediaPaused must fire
    const loadFailFalse = await runCatchCase({
      track: { id: 'c1', source: 'google', remoteId: 'g1', title: 'Load Fail', load: async () => { throw new Error('network'); } },
      skipReturns: false
    });
    assert.equal(loadFailFalse.skipCalls.length, 1);
    assert.equal(loadFailFalse.notifCalls.filter(c => c.isPlaying === false).length, 1, 'track.load() failure with skipFailedTrack()===false must call updateMediaNotification(..., false)');

    // Case 2: track.load() throws & skipFailedTrack returns true -> notifyAbortMediaPaused must NOT fire
    const loadFailTrue = await runCatchCase({
      track: { id: 'c2', source: 'google', remoteId: 'g2', title: 'Load Skip', load: async () => { throw new Error('network'); } },
      skipReturns: true
    });
    assert.equal(loadFailTrue.skipCalls.length, 1);
    assert.equal(loadFailTrue.notifCalls.length, 0, 'track.load() failure with skipFailedTrack()===true must NOT call updateMediaNotification(..., false)');

    // Case 3: target.play() NotSupportedError & skipFailedTrack returns false -> notifyAbortMediaPaused must fire
    const playNotSupp = await runCatchCase({
      track: { id: 'c3', source: 'local', title: 'Play NotSupp', url: 'blob:https://nocturne.local/bad' },
      playErrName: 'NotSupportedError',
      skipReturns: false
    });
    assert.equal(playNotSupp.skipCalls.length, 1);
    assert.equal(playNotSupp.notifCalls.filter(c => c.isPlaying === false).length, 1, 'NotSupportedError with skipFailedTrack()===false must call updateMediaNotification(..., false)');

    // Case 4: target.play() NotAllowedError (toast branch) with no active deck -> notifyAbortMediaPaused must fire
    const playNotAllowed = await runCatchCase({
      track: { id: 'c4', source: 'local', title: 'Autoplay Blocked', url: 'blob:https://nocturne.local/blocked' },
      playErrName: 'NotAllowedError',
      skipReturns: false,
      audioPlaying: false
    });
    assert.equal(playNotAllowed.skipCalls.length, 0);
    assert.equal(playNotAllowed.toasts.length, 1);
    assert.equal(playNotAllowed.notifCalls.filter(c => c.isPlaying === false).length, 1, 'NotAllowedError toast branch with idle decks must call updateMediaNotification(..., false)');

    // Case 5: target.play() NotAllowedError while Track 1 is still actively playing -> Gap A guard suppresses updateMediaNotification(..., false)
    const playNotAllowedActive = await runCatchCase({
      track: { id: 'c5', source: 'local', title: 'Autoplay Blocked Active', url: 'blob:https://nocturne.local/blocked2' },
      playErrName: 'NotAllowedError',
      skipReturns: false,
      audioPlaying: true
    });
    assert.equal(playNotAllowedActive.notifCalls.length, 0, 'NotAllowedError while another track is playing must NOT drop active notification');
  });
});
