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

function makeMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map.entries()); }
  };
}

describe('v3.9.103 R1 — AVRCP 1.6 Position Drift, USB DAC Mixer Recovery (Old API 26–30 & New API 31–35+) & Queue Persistence', () => {
  it('1. AVRCP 1.6 MediaSession rapid seek, paused seek & backward CUE/DSD position drift guards in MainActivity.java & index.html', () => {
    const loopSlice = extractBetween(mainJava, 'private void runPlaybackLoop(', 'private class HttpRangeMediaDataSource');
    const setWinSlice = extractBetween(mainJava, 'public void setTrackWindowMeta(', 'public void updateActiveStreamAuth(');
    const seekSlice = extractBetween(mainJava, 'public void seek(long positionMs)', 'public void setDucking(');

    // 1000ms MediaSession sync lambda must guard with epoch, mSeekGeneration, mSeekTargetUs, and mTrackWindow.seq
    const msSyncIdx = loopSlice.indexOf('if (lastMediaSessionSyncElapsedMs == 0L || (nowElapsed - lastMediaSessionSyncElapsedMs >= 1000L))');
    assert.ok(msSyncIdx !== -1, 'runPlaybackLoop must have 1000ms MediaSession sync block');
    const msSyncBlock = loopSlice.slice(msSyncIdx, msSyncIdx + 1200);
    assert.ok(
      msSyncBlock.includes('mPlaybackEpoch.get() == epoch') &&
      msSyncBlock.includes('mSeekGeneration.get() == mediaSeekGen') &&
      msSyncBlock.includes('mSeekTargetUs.get() < 0L') &&
      msSyncBlock.includes('mTrackWindow.seq == mediaWinSeq') &&
      msSyncBlock.includes('updateMediaSessionPosition(mediaPosMs, mediaDurMs, true)'),
      '1000ms MediaSession sync must guard against stale seek/window/epoch before pushing position'
    );

    // Immediate post-seek MediaSession PTS sync (for both playing AND paused!)
    const postSeekIdx = loopSlice.indexOf('final boolean seekStillCurrent;');
    assert.ok(postSeekIdx !== -1, 'runPlaybackLoop post-seek must compute seekStillCurrent');
    const postSeekBlock = loopSlice.slice(postSeekIdx, loopSlice.indexOf('// Feed input buffer', postSeekIdx));
    assert.ok(
      postSeekBlock.includes('lastMediaSessionSyncElapsedMs = 0L;') &&
      postSeekBlock.includes('mSeekGeneration.get() == seekReportGen') &&
      postSeekBlock.includes('mSeekTargetUs.get() < 0L') &&
      postSeekBlock.includes('mTrackWindow.seq == seekWinSeq') &&
      postSeekBlock.includes('updateMediaSessionPosition(seekMediaPosMs, seekMediaDurMs, !mIsPaused);') &&
      /if \(mIsPaused && !mIsStopped && mPlaybackEpoch\.get\(\) == epoch\) \{\s+continue;\s+\}/.test(postSeekBlock),
      'Post-seek must reset lastMediaSessionSyncElapsedMs and immediately update MediaSession with !mIsPaused even when paused'
    );

    // Duration update push after MediaMetadataRetriever / bitrate resolution
    assert.ok(
      loopSlice.includes('final long resolvedDisplayDurMs = getDisplayDurationMs(mDurationMs.get(), mTrackWindow);') &&
      loopSlice.includes('updateMediaSessionPosition(resolvedDisplayPosMs, resolvedDisplayDurMs, !mIsPaused);'),
      'runPlaybackLoop must push resolvedDisplayDurMs to MediaSession when MMR updates duration'
    );

    // setTrackWindowMeta backward CUE switch clamp & mLastMediaDurationMs reset
    assert.ok(
      setWinSlice.includes('final boolean isBackwardWindowSwitch = (safeStartMs < prevStartMs);') &&
      setWinSlice.includes('final boolean isOutOfWindow = (rawPos < safeStartMs) || (safeDurMs > 0L && rawPos >= safeStartMs + safeDurMs);') &&
      setWinSlice.includes('(isBackwardWindowSwitch || isOutOfWindow)\n                            ? 0L') &&
      setWinSlice.includes('if (dispDur <= 0L) {\n                                mLastMediaDurationMs = 0L;\n                            }'),
      'setTrackWindowMeta must clamp dispPos to 0L on backward CUE switch or out-of-window position'
    );

    // BitPerfectAudioPlayer.seek updates MediaSession immediately with seekGen guard
    assert.ok(
      seekSlice.includes('seekGen = mSeekGeneration.incrementAndGet();') &&
      seekSlice.includes('mSeekGeneration.get() == seekGen') &&
      seekSlice.includes('updateMediaSessionPosition('),
      'BitPerfectAudioPlayer.seek must increment mSeekGeneration and guard UI MediaSession update'
    );

    // index.html isSameCueNativeParent seeks BEFORE updating track window metadata
    const sameCueSlice = extractBetween(html, 'const isSameCueNativeParent = Boolean(', 'if (typeof window.NocturneNative.setBitPerfectStreamAuth');
    const seekCallIdx = sameCueSlice.indexOf('window.NocturneNative.seekBitPerfectPlayback(');
    const winCallIdx = sameCueSlice.indexOf('window.NocturneNative.setBitPerfectTrackWindow(');
    assert.ok(seekCallIdx !== -1 && winCallIdx !== -1 && seekCallIdx < winCallIdx, 'isSameCueNativeParent must seekBitPerfectPlayback before setBitPerfectTrackWindow');
  });

  it('2. JS navigator.mediaSession Bit-Perfect isolation, playbackRate=0 when paused & seekCurrentPlaybackToSeconds(0) work cleanly', () => {
    const msSlice = extractBetween(html, 'function updateMediaSession(track) {', 'let isUserScrolling = false;');
    const seekJumpSlice = extractBetween(html, 'function syncSeekUiAfterJump(relSec, durSec) {', 'function setupBitPerfectIntegration() {');
    const seekSecSlice = extractBetween(html, 'function getCurrentPlaybackPositionSeconds() {', 'function savePlaybackSession(');

    const makeEls = () => {
      const els = {};
      const mk = id => ({ id, textContent: '', value: '0', style: {} });
      ['current-time', 'current-time-mobile', 'room-current-time', 'fullscreen-time-cur',
       'duration', 'duration-mobile', 'room-duration', 'fullscreen-time-dur',
       'room-remaining', 'seek', 'seek-mobile', 'room-seek'].forEach(id => { els[id] = mk(id); });
      return els;
    };

    // A. Android Native Bit-Perfect: isolates WebView navigator.mediaSession & skips non-forced native position ticks
    const nativePosCalls = [];
    const bpSeekCalls = [];
    let webSetPositionCalls = 0;
    const elsA = makeEls();
    const sandboxAndroid = {
      library,
      Date, Math, Number, String, Boolean, URL,
      MediaMetadata: function (m) { Object.assign(this, m); },
      location: { href: 'https://nocturne.local/' },
      $: id => elsA[id] || null,
      formatTime: s => {
        const sec = Math.max(0, Math.floor(Number(s) || 0));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      },
      formatRemainingTime: (c, d) => `-${Math.max(0, Math.floor(d - c))}s`,
      paintSeek: () => {},
      renderWaveformSeekbar: () => {},
      navigator: {
        mediaSession: {
          metadata: { title: 'Stale WebView Title' },
          playbackState: 'playing',
          setPositionState: () => { webSetPositionCalls++; }
        }
      },
      window: {
        isNativeAndroid: true,
        location: { href: 'https://nocturne.local/' },
        NocturneNative: {
          isNativeAndroid: () => true,
          updateMediaSessionPosition: (p, d, pl) => nativePosCalls.push({ p, d, pl }),
          seekBitPerfectPlayback: ms => bpSeekCalls.push(ms)
        }
      },
      audio: { paused: true, ended: false, currentTime: 50, duration: 200, playbackRate: 1, readyState: 2 },
      state: {
        currentId: 'bp1',
        tracks: [{ id: 'bp1', title: 'HiRes Song', artist: 'Artist', album: 'Album', duration: 200 }],
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: true,
        lastBitPerfectPositionSec: 45,
        activeDeck: null
      }
    };
    vm.runInNewContext(`${seekJumpSlice}\n${msSlice}\n${seekSecSlice}\nthis.updateMediaSession = updateMediaSession;\nthis.updatePositionState = updatePositionState;`, sandboxAndroid);

    sandboxAndroid.updateMediaSession(sandboxAndroid.state.tracks[0]);
    assert.equal(sandboxAndroid.navigator.mediaSession.metadata, null, 'Android Native Bit-Perfect must clear WebView navigator.mediaSession.metadata');
    assert.equal(sandboxAndroid.navigator.mediaSession.playbackState, 'none', 'Android Native Bit-Perfect must set WebView navigator.mediaSession.playbackState="none"');
    assert.equal(webSetPositionCalls, 0, 'Android Native Bit-Perfect must NOT call WebView navigator.mediaSession.setPositionState');

    // Non-forced updatePositionState(false) must not spam NocturneNative during Android Bit-Perfect (native loop handles it)
    const countAfterForced = nativePosCalls.length;
    assert.equal(countAfterForced, 1, 'updateMediaSession calls forced updatePositionState(true) once');
    assert.deepEqual(nativePosCalls[0], { p: 45000, d: 200000, pl: false }, 'Paused Bit-Perfect must push pl=false');
    sandboxAndroid.updatePositionState(false);
    assert.equal(nativePosCalls.length, countAfterForced, 'updatePositionState(false) must NOT race native runPlaybackLoop during Android Bit-Perfect');

    // seekCurrentPlaybackToSeconds(0) MUST be allowed (regression: sec <= 0 used to return false)
    assert.equal(sandboxAndroid.seekCurrentPlaybackToSeconds(-1, 'bp1'), false, 'Negative seek must return false');
    assert.equal(sandboxAndroid.seekCurrentPlaybackToSeconds(NaN, 'bp1'), false, 'NaN seek must return false');
    const seek0Ok = sandboxAndroid.seekCurrentPlaybackToSeconds(0, 'bp1');
    assert.equal(seek0Ok, true, 'seekCurrentPlaybackToSeconds(0) must return true');
    assert.deepEqual(bpSeekCalls, [0], 'seekCurrentPlaybackToSeconds(0) must call seekBitPerfectPlayback(0)');
    assert.equal(elsA['current-time'].textContent, '0:00');
    assert.equal(elsA['room-current-time'].textContent, '0:00');
    assert.equal(elsA['duration'].textContent, '3:20');
    assert.equal(elsA['room-duration'].textContent, '3:20');
    assert.equal(elsA['fullscreen-time-dur'].textContent, '3:20');
    assert.equal(elsA['seek'].value, '0');
    assert.equal(elsA['room-seek'].value, '0');

    // B. Non-Android Web/PWA must STILL populate navigator.mediaSession normally
    const webPosStates = [];
    const sandboxWeb = {
      library,
      Date, Math, Number, String, Boolean, URL,
      MediaMetadata: function (m) { Object.assign(this, m); },
      location: { href: 'https://nocturne.local/' },
      $: () => null,
      navigator: {
        mediaSession: {
          metadata: null,
          playbackState: 'none',
          setPositionState: s => webPosStates.push(s)
        }
      },
      window: { location: { href: 'https://nocturne.local/' } },
      audio: { paused: false, ended: false, currentTime: 12, duration: 120, playbackRate: 1, readyState: 2 },
      state: {
        currentId: 'w1',
        tracks: [{ id: 'w1', title: 'Web Song', artist: 'Web Artist', album: 'Web Album', duration: 120 }],
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        activeDeck: null
      }
    };
    vm.runInNewContext(`${msSlice}\n${seekSecSlice}\nthis.updateMediaSession = updateMediaSession;`, sandboxWeb);
    sandboxWeb.updateMediaSession(sandboxWeb.state.tracks[0]);
    assert.equal(sandboxWeb.navigator.mediaSession.metadata.title, 'Web Song');
    assert.equal(sandboxWeb.navigator.mediaSession.playbackState, 'playing');
    assert.equal(webPosStates.length, 1);
    assert.equal(sandboxWeb.seekCurrentPlaybackToSeconds(0, 'w1'), true);
    assert.equal(sandboxWeb.audio.currentTime, 0);
  });

  it('3. USB DAC consecutive-track mixer & bit-depth recovery (44.1/16 -> 96/24 -> 192/24 -> 44.1/16) on Old (API 26–30) & New (API 31–35+) Android', () => {
    const api34Slice = extractBetween(mainJava, '@androidx.annotation.RequiresApi(34)', 'public class BitPerfectAudioPlayer {');
    const pcmConvSlice = extractBetween(mainJava, 'private static float readSampleNormalized(', 'private AudioTrack createAndConfigureBitPerfectAudioTrack(');
    const buildSlice = extractBetween(mainJava, 'private AudioTrack createAndConfigureBitPerfectAudioTrack(', 'private void notifyBitPerfectFormatToWeb(');
    const loopSlice = extractBetween(mainJava, 'private void runPlaybackLoop(', 'private class HttpRangeMediaDataSource');

    // New Android (API 34+): query getSupportedMixerAttributes & select integer PCM ahead of PCM_FLOAT
    assert.ok(
      api34Slice.includes('@androidx.annotation.RequiresApi(34)') &&
      api34Slice.includes('am.getSupportedMixerAttributes(device)') &&
      api34Slice.includes('AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT') &&
      api34Slice.includes('AudioFormat.ENCODING_PCM_24BIT_PACKED') &&
      api34Slice.includes('AudioFormat.ENCODING_PCM_32BIT') &&
      api34Slice.includes('preferredEncoding == AudioFormat.ENCODING_PCM_16BIT'),
      'Api34AudioHelper must query getSupportedMixerAttributes and prioritize integer PCM encodings matching track rate/bitDepth'
    );

    // Float -> Int24 / Int32 / Int16 conversion when MediaCodec outputs PCM_FLOAT while DAC locks integer PCM
    assert.ok(
      pcmConvSlice.includes('convertPcmChunk(') &&
      pcmConvSlice.includes('else if (dstEncoding == 21)') &&
      pcmConvSlice.includes('else if (dstEncoding == 22)') &&
      pcmConvSlice.includes('Float.floatToRawIntBits(interp)'),
      'BitPerfectAudioPlayer must convert PCM_FLOAT cleanly to 24-bit/32-bit/16-bit PCM for USB DAC integer mixer attributes'
    );

    // fallbackAttrs clears stale mPreferredMixerAttributesSet before & on failure
    assert.ok(
      buildSlice.includes('clearPreferredMixerIfMatches(epoch);') &&
      buildSlice.includes('AudioAttributes fallbackAttrs = new AudioAttributes.Builder()') &&
      buildSlice.includes('applyPreferredMixerLocked(epoch, fallbackAttrs, targetDevice, audioFormat);') &&
      buildSlice.includes('if (built == null || built.getState() != AudioTrack.STATE_INITIALIZED) {\n                        clearPreferredMixerIfMatches(epoch);'),
      'createAndConfigureBitPerfectAudioTrack must clear stale mixer attributes before fallbackAttrs and if fallback build fails'
    );

    // Consecutive-track settle retry (55ms) + Old Android (API 26-30) FLAG_AUDIOTRACK_DIRECT & 24/32->16bit fallback
    assert.ok(
      loopSlice.includes('Thread.sleep(55)') &&
      loopSlice.includes('FLAG_AUDIOTRACK_DIRECT') &&
      loopSlice.includes('AudioTrack.getMinBufferSize('),
      'runPlaybackLoop must perform bounded settle retry on consecutive-track USB HAL transitions while preserving API 26-30 direct/getMinBufferSize fallbacks'
    );
    const rebuildOnly = buildSlice.slice(buildSlice.indexOf('private AudioTrack rebuildAudioTrackWith16BitFallback('));
    assert.ok(
      rebuildOnly.includes('hiResEncs.add(AudioFormat.ENCODING_PCM_24BIT_PACKED);') &&
      rebuildOnly.includes('hiResEncs.add(AudioFormat.ENCODING_PCM_32BIT);') &&
      rebuildOnly.indexOf('for (int candEnc : hiResEncs)') !== -1 &&
      rebuildOnly.indexOf('AudioFormat format16 = new AudioFormat.Builder()') !== -1 &&
      rebuildOnly.indexOf('for (int candEnc : hiResEncs)') < rebuildOnly.indexOf('AudioFormat format16 = new AudioFormat.Builder()'),
      'rebuildAudioTrackWith16BitFallback must attempt 24-bit/32-bit integer PCM before falling back to 16-bit'
    );

    // JS clears state.bitPerfectLockedFormat BEFORE startBitPerfectPlayback & tracks consecutive 44.1/16 -> 96/24 -> 192/24 -> 44.1/16 locks
    const startBpSlice = extractBetween(html, 'const winDurMs = (track.isCue', 'if (bpStarted !== false)');
    const clearIdx = startBpSlice.indexOf('state.bitPerfectLockedFormat = null;');
    const startIdx = startBpSlice.indexOf('window.NocturneNative.startBitPerfectPlayback(');
    assert.ok(clearIdx !== -1 && startIdx !== -1 && clearIdx < startIdx, 'JS must clear state.bitPerfectLockedFormat BEFORE startBitPerfectPlayback');

    const lockSlice = extractBetween(html, 'window.onBitPerfectFormatLocked = function(sampleRate, bitDepth, mixerBitPerfect, deviceName) {', 'window.getBitPerfectTelemetry = function() {');
    const els = {};
    const lockSandbox = {
      Date, Number, String, Boolean, Array,
      window: {},
      $: id => (els[id] || (els[id] = { textContent: '', title: '', className: '' })),
      state: { bitPerfectEnabled: true, isNativeBitPerfectPlaying: true, currentId: 't1', tracks: [{ id: 't1', format: 'FLAC', sampleRate: 44100, bitDepth: 16 }], bitPerfectLockedFormat: { sampleRate: 192000, bitDepth: 24 } },
      renderRoomSignal: () => {},
      syncRoomOutputText: () => {},
      updateMiniPlayerHud: () => {}
    };
    vm.runInNewContext(lockSlice, lockSandbox);
    for (const [sr, bd, mixer] of [[44100, 16, true], [96000, 24, true], [192000, 24, true], [44100, 16, true]]) {
      lockSandbox.window.onBitPerfectFormatLocked(sr, bd, mixer, 'FiiO KA17');
      assert.equal(lockSandbox.state.bitPerfectLockedFormat.sampleRate, sr);
      assert.equal(lockSandbox.state.bitPerfectLockedFormat.bitDepth, bd);
      assert.equal(lockSandbox.state.bitPerfectLockedFormat.mixerBitPerfect, mixer);
      assert.equal(lockSandbox.state.bitPerfectLockedFormat.deviceName, 'FiiO KA17');
    }
  });

  it('4. Queue persistence flushes savePlaybackSession(true) on all mutators/backgrounding & rehydrateNativeBitPerfectPlayback merges async Cloud/Local stages', async () => {
    const sessSlice = extractBetween(html, 'function savePlaybackSession(force = false) {', 'function checkAndPromptResumeSession() {');
    const rehySlice = extractBetween(html, 'window.rehydrateNativeBitPerfectPlayback = () => {', 'window.rehydrateBitPerfectFromNativeSnapshot =');
    const qMutSlice = extractBetween(html, 'function addToQueue(trackId) {', 'function syncAutoplayButton() {');
    const qMenuSlice = extractBetween(html, 'function handlePlayNext(trackId) {', 'async function syncBlackCandySongs() {');
    const lifecycleSlice = extractBetween(html, 'window.onAndroidAppLifecycle = (phase) => {', 'if (typeof window !== \'undefined\') {\n      window.onAndroidNetworkAvailable');
    const bpmSortSlice = extractBetween(html, "safeOn($('queue-bpm-sort-btn'), 'click', () => {", "safeOn($('queue-share-btn'), 'click'");
    const playNextSlice = extractBetween(html, 'function playNext(direction = 1, auto = false) {', 'function playFallbackRandomAlbum(');

    // Structural check on visibilitychange & #queue-clear & playNext(!auto)
    const visSlice = html.slice(html.indexOf("document.addEventListener('visibilitychange', () => {\n        if (document.hidden)"), html.indexOf('async function clearAudioSliceCacheAndMemory()'));
    assert.ok(visSlice.includes("if (typeof savePlaybackSession === 'function') savePlaybackSession(true);"), 'visibilitychange hidden must flush savePlaybackSession(true)');
    assert.ok(html.includes("$('queue-clear').addEventListener('click'") && extractBetween(html, "$('queue-clear').addEventListener('click',", "$('queue-add-library').addEventListener").includes('savePlaybackSession(true)'), '#queue-clear must flush savePlaybackSession(true)');
    assert.ok(playNextSlice.includes('if (!auto && typeof markUserMutatedQueue === \'function\') markUserMutatedQueue(false);'), 'playNext must only call markUserMutatedQueue when !auto');

    // A. Behavioral flush test across addToQueue, moveQueueTrack, removeFromQueue, handlePlayNext, handleAppendQueue, #queue-bpm-sort-btn, onAndroidAppLifecycle('background')
    const ls = makeMockStorage();
    let nowMs = 10000;
    const mockDate = { now: () => nowMs };
    const els = {};
    const mkEl = id => (els[id] || (els[id] = { id, textContent: '', checked: false, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(ev, fn) { this['on_' + ev] = fn; } }));
    const tracks = [
      { id: 'cur', title: 'Current', bpm: 100 },
      { id: 't1', title: 'One', bpm: 128 },
      { id: 't2', title: 'Two', bpm: 92 },
      { id: 't3', title: 'Three', bpm: 110 }
    ];
    const qSandbox = {
      library,
      localStorage: ls,
      Date: mockDate,
      Math, Array, Set, Map, JSON, String, Number, Boolean, Object,
      window: {},
      $: mkEl,
      safeOn: (el, ev, fn) => { if (el) el.addEventListener(ev, fn); },
      audio: { src: 'blob:cur', paused: false, volume: 0.9, currentTime: 15 },
      state: {
        currentId: 'cur',
        tracks,
        queueTrackIds: [],
        queue: [],
        lastSessionSaveTime: nowMs, // within 3000ms throttle window!
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false
      },
      trackById: id => qSandbox.state.tracks.find(t => t && String(t.id) === String(id)) || null,
      queueTracks: () => qSandbox.state.queueTrackIds.map(id => qSandbox.trackById(id)).filter(Boolean),
      getCurrentPlaybackPositionSeconds: () => 15,
      refreshQueueRows: () => {},
      renderQueue: () => {},
      preloadNext: () => {},
      toast: () => {},
      syncPendingNextCloudWifiLock: () => {},
      setVisualizerRunning: () => {}
    };
    vm.runInNewContext(`${sessSlice}\n${qMutSlice}\n${qMenuSlice}\n${lifecycleSlice}\n${bpmSortSlice}`, qSandbox);

    // Every mutator must bypass the 3000ms throttle via savePlaybackSession(true)
    qSandbox.addToQueue('t1');
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, ['t1']);
    qSandbox.handleAppendQueue('t2');
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, ['t1', 't2']);
    qSandbox.handlePlayNext('t3');
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, ['t3', 't1', 't2']);
    qSandbox.moveQueueTrack('t1', -1);
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, ['t1', 't3', 't2']);
    els['queue-bpm-sort-btn'].on_click();
    assert.equal(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds.length, 3);
    qSandbox.removeFromQueue('t2');
    assert.equal(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds.includes('t2'), false);

    // handlePlayNext/handleAppendQueue on currentId must be a no-op
    const beforeSelf = JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds.slice();
    qSandbox.handlePlayNext('cur');
    qSandbox.handleAppendQueue('cur');
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, beforeSelf);

    // Paused background lifecycle flushes session immediately
    qSandbox.audio.paused = true;
    qSandbox.state.queueTrackIds.push('t2');
    qSandbox.state.lastSessionSaveTime = nowMs;
    qSandbox.window.onAndroidAppLifecycle('background');
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-playback-session')).queueTrackIds, qSandbox.state.queueTrackIds);

    // B. Multi-stage rehydration (FiiO sync -> Cloud async -> Local async)
    const snap = {
      active: true, isPlaying: true, isPaused: false,
      currentId: 'fiio_cur', sourceKey: '/sdcard/cur.flac',
      positionMs: 12000, durationMs: 240000,
      title: 'Current FiiO', artist: 'Artist', album: 'Album'
    };
    const origSess = JSON.stringify({
      trackId: 'fiio_cur',
      currentTime: 12,
      queueTrackIds: ['fiio_1', 'google:g2', 'loc_3'],
      updatedAt: 50000,
      wasPlaying: true
    });
    const rehyLs = makeMockStorage({ 'nocturne-playback-session': origSess });
    const rehyEls = {};
    const mkRehyEl = id => (rehyEls[id] || (rehyEls[id] = { id, textContent: '', checked: false, classList: { add() {}, remove() {}, toggle() {} } }));
    const rehySandbox = {
      library,
      localStorage: rehyLs,
      Date: { now: () => 55000 },
      Math, Array, Set, Map, JSON, String, Number, Boolean, Object,
      $: mkRehyEl,
      audio: { paused: true, volume: 1, currentTime: 0 },
      window: {
        isNativeAndroid: true,
        NocturneNative: {
          isNativeAndroid: () => true,
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snap),
          ackBitPerfectRehydration: () => { rehySandbox._acks += 1; }
        },
        onBitPerfectFormatLocked: () => {},
        onNativeBitPerfectStateChange: () => {},
        onNativeBitPerfectPosition: () => {}
      },
      _acks: 0,
      state: {
        currentId: null,
        tracks: [
          { id: 'fiio_cur', title: 'Current FiiO', path: '/sdcard/cur.flac', duration: 240 },
          { id: 'fiio_1', title: 'FiiO Next' }
        ],
        queueTrackIds: [],
        _startupCatalogRestorePending: true,
        lastSessionSaveTime: 0
      },
      trackById: id => rehySandbox.state.tracks.find(t => t && String(t.id) === String(id)) || null,
      getCurrentPlaybackPositionSeconds: () => 12,
      displayTrack: () => {},
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      renderQueue: () => {},
      updatePositionState: () => {},
      console: { warn: () => {} }
    };
    vm.runInNewContext(`${sessSlice}\n${rehySlice}`, rehySandbox);

    // Stage 1: only fiio_1 is loaded -> restores fiio_1, keeps google:g2 & loc_3 pending, and throttled savePlaybackSession does NOT truncate persisted session!
    assert.equal(rehySandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(Array.from(rehySandbox.state.queueTrackIds), ['fiio_1']);
    assert.deepEqual(Array.from(rehySandbox.state._bpPendingRehydratedQueueIds), ['google:g2', 'loc_3']);
    assert.equal(rehySandbox.state._bpRehydratedQueueRestored, false);
    rehySandbox.savePlaybackSession(false);
    assert.deepEqual(JSON.parse(rehyLs.getItem('nocturne-playback-session')).queueTrackIds, ['fiio_1', 'google:g2', 'loc_3']);

    // Stage 2: Cloud catalog resolves asynchronously
    rehySandbox.state.tracks.push({ id: 'google:g2', title: 'Cloud Next' });
    assert.equal(rehySandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(Array.from(rehySandbox.state.queueTrackIds), ['fiio_1', 'google:g2']);
    assert.deepEqual(Array.from(rehySandbox.state._bpPendingRehydratedQueueIds), ['loc_3']);
    assert.equal(rehySandbox.state._bpRehydratedQueueRestored, false);

    // Stage 3: Local folder resolves asynchronously -> complete merge in exact original order
    rehySandbox.state.tracks.push({ id: 'loc_3', title: 'Local Next' });
    rehySandbox.state._startupCatalogRestorePending = false;
    assert.equal(rehySandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(Array.from(rehySandbox.state.queueTrackIds), ['fiio_1', 'google:g2', 'loc_3']);
    assert.equal(rehySandbox.state._bpPendingRehydratedQueueIds, null);
    assert.equal(rehySandbox.state._bpRehydratedQueueRestored, true);

    // C. Verify Run #89 P0 Play/Pause invariants preserved in MainActivity & Service
    assert.ok(mainJava.includes('isDuplicateMediaKeyEvent(@Nullable KeyEvent ke)') && svcJava.includes('active.handleMediaKeyEvent(ke);'));
    assert.ok(mainJava.includes('mLastPlayPauseTransportAtMs') && mainJava.includes('< 450L'));
  });
});
