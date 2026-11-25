'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

const DEFAULT_E2E_PATH = 'C:\\Users\\thien\\.gemini\\antigravity\\brain\\7f662af1-69d0-48ce-a25e-4f41c5fcd848\\scratch\\live-chrome-play-pause-test.cjs';
const E2E_PATH = process.env.NOCTURNE_E2E_PATH || DEFAULT_E2E_PATH;

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

function makeStorage(seed = {}) {
  const store = Object.assign({}, seed);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
}

function makeEl(extra = {}) {
  return Object.assign({
    textContent: '',
    title: '',
    value: '0',
    checked: false,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    matches: () => false,
    addEventListener() {},
    setAttribute() {}
  }, extra);
}

describe('v3.9.99 R3: Chrome CDP E2E Verification & Render-Crash Rehydration / Group A-D Parity', () => {
  it('1. live-chrome-play-pause-test.cjs passes node --check, is LF-only, enforces errors.length === 0, and has >= 113 non-trivial assertions across baseline + Groups A-D', () => {
    assert.ok(fs.existsSync(E2E_PATH), `E2E script not found at ${E2E_PATH}`);
    execFileSync(process.execPath, ['--check', E2E_PATH], { stdio: 'pipe' });

    const e2eBuf = fs.readFileSync(E2E_PATH);
    assert.equal(e2eBuf.includes(13), false, 'live-chrome-play-pause-test.cjs must be LF-only (0 CR bytes)');
    const e2eSrc = e2eBuf.toString('utf8');

    // NOCTURNE_E2E_BASELINE_ONLY gate wraps Groups A-D
    assert.ok(e2eSrc.includes("if (process.env.NOCTURNE_E2E_BASELINE_ONLY !== '1')"),
      'Run #86 Groups A-D must be gated by NOCTURNE_E2E_BASELINE_ONLY');

    // errors.length === 0 enforced at boot and final step
    assert.ok(e2eSrc.includes("assertCheck(errors.length === 0, 'Boot: 0 uncaught JS exceptions'"),
      'Must enforce errors.length === 0 at boot');
    assert.ok(e2eSrc.includes("assertCheck(errors.length === 0, 'ALL STEPS COMPLETED WITH 0 UNCAUGHT EXCEPTIONS'"),
      'Must enforce errors.length === 0 at final step');

    // Count all assertCheck(...) call sites excluding function assertCheck(
    const callMatches = e2eSrc.match(/\bassertCheck\s*\(/g) || [];
    const declMatches = e2eSrc.match(/function\s+assertCheck\s*\(/g) || [];
    const callCount = callMatches.length - declMatches.length;
    assert.ok(callCount >= 113, `Expected >= 113 assertCheck calls (88 baseline + 25 Run #86), found ${callCount}`);

    // Verify Group A (6), Group B (7), Group C (6), Group D (6) structure and contract parity with index.html / MainActivity.java
    const groupASlice = extractBetween(e2eSrc, '// Group A —', '// Shared Pre-Boot Mock Bootstrap');
    const groupBSlice = extractBetween(e2eSrc, '// Group B —', '// Group C —');
    const groupCSlice = extractBetween(e2eSrc, '// Group C —', '// Group D —');
    const groupDSlice = extractBetween(e2eSrc, '// Group D —', "assertCheck(errors.length === 0, 'ALL STEPS COMPLETED");

    assert.equal((groupASlice.match(/\bassertCheck\s*\(/g) || []).length, 6, 'Group A must contain 6 assertions');
    assert.equal((groupBSlice.match(/\bassertCheck\s*\(/g) || []).length, 7, 'Group B must contain 7 assertions');
    assert.equal((groupCSlice.match(/\bassertCheck\s*\(/g) || []).length, 6, 'Group C must contain 6 assertions');
    assert.equal((groupDSlice.match(/\bassertCheck\s*\(/g) || []).length, 6, 'Group D must contain 6 assertions');

    // Contract parity checks
    assert.ok(groupASlice.includes('/cue-long.wav') && groupASlice.includes('/cue-long.cue') && groupASlice.includes('postPlaySeeks <= 1 && !cfSeekAnalysis.backwardJump'));
    assert.ok(
      groupBSlice.includes('nocturne-google-folder-tree') &&
      groupBSlice.includes('nocturne-onedrive-folder-tree') &&
      groupBSlice.includes('Google Drive · 1 bài') &&
      groupBSlice.includes('OneDrive · 1 bài') &&
      html.includes('nocturne-google-folder-tree') &&
      html.includes('nocturne-onedrive-folder-tree')
    );
    assert.ok(
      groupCSlice.includes('needsCloudMetadataEnrichment') &&
      groupCSlice.includes('repopulateCloudMetadataQueue') &&
      groupCSlice.includes('_checkedDriveLrc') &&
      groupCSlice.includes('_cloudLrcChecked') &&
      html.includes('window.needsCloudMetadataEnrichment = needsCloudMetadataEnrichment') &&
      html.includes('window.repopulateCloudMetadataQueue = repopulateCloudMetadataQueue')
    );
    for (const method of [
      'getBitPerfectPlaybackSnapshot',
      'ackBitPerfectRehydration',
      'isBitPerfectActive',
      'getBitPerfectPosition',
      'getBitPerfectDuration'
    ]) {
      assert.ok(e2eSrc.includes(method) && mainJava.includes(`public `) && mainJava.includes(method),
        `E2E and MainActivity.java must share NocturneNative.${method} contract`);
    }
  });

  it('2. Group D Phase 1 parity: unmatched CUE snapshot & cueDurationMs=0 fallback render CUE-relative times, lock badge, hide resume banner, and never start playback', () => {
    const applyBpSlice = extractBetween(html, 'function applyBitPerfectMode(enabled)', 'window.applyBitPerfectMode = applyBitPerfectMode;');
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const fmtSlice = extractBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', 'const speedBtnEl =');

    let currentSnap = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: 'unmatched_cue_1',
      sourceKey: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2Funmatched.flac',
      cueStartMs: 120000,
      cueDurationMs: 180000,
      positionMs: 165500,
      durationMs: 600000,
      displayPositionMs: 45500,
      displayDurationMs: 180000,
      title: 'Unmatched CUE Adagio',
      artist: 'FiiO Philharmonia',
      album: 'Synthetic Hi-Res CUE',
      recoveredFromRenderCrash: true,
      bitPerfectLockedFormat: {
        sampleRate: 192000,
        bitDepth: 24,
        mixerBitPerfect: true,
        deviceName: 'FiiO M11S'
      }
    };

    const uiEls = {
      'resume-session-banner': makeEl({ classList: { _set: new Set(['flex']), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } } }),
      'bitperfect-mode-toggle': makeEl(),
      'bitperfect-mode-badge': makeEl(),
      'quality-badge': makeEl(),
      'play-button': makeEl({ textContent: '▶' }),
      'room-play': makeEl({ textContent: '▶' }),
      'current-time': makeEl(),
      'room-current-time': makeEl(),
      'duration': makeEl(),
      'room-duration': makeEl(),
      'now-title': makeEl({ textContent: 'Chưa chọn bài hát' }),
      'room-title': makeEl()
    };
    let ackCount = 0;
    let startCount = 0;

    const sandbox = {
      library,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      audio: { paused: true, src: '' },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(currentSnap),
          getBitPerfectPosition: () => currentSnap.positionMs,
          getBitPerfectDuration: () => currentSnap.durationMs,
          ackBitPerfectRehydration: () => { ackCount++; },
          startBitPerfectPlayback: () => { startCount++; return true; }
        }
      },
      document: { hidden: false },
      state: {
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        bitPerfectLockedFormat: null,
        currentId: null,
        isSeeking: false,
        lyrics: [],
        tracks: []
      },
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      renderRoomSignal: () => {},
      syncRoomOutputText: () => {},
      updatePositionState: () => {},
      savePlaybackSession: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      updateLyricsHighlight: () => {},
      renderWaveformSeekbar: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}`,
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean, JSON, console
    };
    vm.runInNewContext(`${applyBpSlice}\n${bpSlice}\n${fmtSlice}\nthis.applyBitPerfectMode = applyBitPerfectMode;\nsetupBitPerfectIntegration();`, sandbox);

    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(uiEls['now-title'].textContent, 'Unmatched CUE Adagio');
    assert.equal(uiEls['room-title'].textContent, 'Unmatched CUE Adagio');
    assert.equal(uiEls['play-button'].textContent, 'Ⅱ');
    assert.equal(uiEls['current-time'].textContent, '0:45');
    assert.equal(uiEls['room-current-time'].textContent, '0:45');
    assert.equal(uiEls['duration'].textContent, '3:00');
    assert.equal(uiEls['room-duration'].textContent, '3:00');
    assert.equal(uiEls['bitperfect-mode-toggle'].checked, true);
    assert.ok(uiEls['bitperfect-mode-badge'].textContent.includes('BIT-PERFECT LOCKED'));
    assert.equal(uiEls['resume-session-banner'].classList.contains('hidden'), true);
    assert.equal(ackCount, 0, 'Phase 1 unmatched must not ack rehydration before track match');
    assert.equal(startCount, 0, 'Rehydration must never call startBitPerfectPlayback');

    // Subcase: cueDurationMs = 0 tail-CUE fallback (durSec - rwCueStart = 600 - 480 = 120s -> 2:00)
    currentSnap = Object.assign({}, currentSnap, {
      cueStartMs: 480000,
      cueDurationMs: 0,
      positionMs: 510000,
      durationMs: 600000
    });
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(uiEls['current-time'].textContent, '0:30');
    assert.equal(uiEls['duration'].textContent, '2:00');
  });

  it('3. Group D Phase 2 parity: FiiO /local-media?... sourceKey fallback with empty currentId restores 2-item queue and calls one-shot ackBitPerfectRehydration()', () => {
    const applyBpSlice = extractBetween(html, 'function applyBitPerfectMode(enabled)', 'window.applyBitPerfectMode = applyBitPerfectMode;');
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const fmtSlice = extractBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', 'const speedBtnEl =');

    const snapshot = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: '',
      sourceKey: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2Fsuite.flac',
      cueStartMs: 120000,
      cueDurationMs: 180000,
      positionMs: 165500,
      durationMs: 600000,
      title: 'Snapshot Fallback Title',
      artist: 'Vienna Ensemble',
      album: 'Suite in D',
      bitPerfectLockedFormat: { sampleRate: 192000, bitDepth: 24, mixerBitPerfect: true, deviceName: 'FiiO M11S' }
    };

    const ls = makeStorage({
      'nocturne-playback-session': JSON.stringify({
        trackId: 'fiio_cue_2',
        currentTime: 45,
        queueTrackIds: ['fiio_next_1', 'fiio_next_2'],
        updatedAt: Date.now()
      })
    });
    const uiEls = {
      'resume-session-banner': makeEl(),
      'bitperfect-mode-toggle': makeEl(),
      'bitperfect-mode-badge': makeEl(),
      'quality-badge': makeEl(),
      'play-button': makeEl(),
      'current-time': makeEl(),
      'room-current-time': makeEl(),
      'duration': makeEl(),
      'room-duration': makeEl(),
      'now-title': makeEl(),
      'room-title': makeEl(),
      'room-album': makeEl()
    };
    let ackCount = 0;
    let startCount = 0;
    let queueRenderCount = 0;

    const sandbox = {
      library,
      localStorage: ls,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      audio: { paused: true, src: '' },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snapshot),
          getBitPerfectPosition: () => snapshot.positionMs,
          getBitPerfectDuration: () => snapshot.durationMs,
          ackBitPerfectRehydration: () => { ackCount++; },
          startBitPerfectPlayback: () => { startCount++; return true; }
        }
      },
      document: { hidden: false },
      state: {
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        bitPerfectLockedFormat: null,
        currentId: null,
        queueTrackIds: [],
        isSeeking: false,
        lyrics: [],
        tracks: [
          {
            id: 'fiio_cue_2', source: 'local', title: 'Matched Suite II',
            artist: 'Vienna Ensemble', album: 'Suite in D',
            url: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2Fsuite.flac',
            path: '/sdcard/Music/suite.flac', isCue: true, cueStart: 120, cueEnd: 300, duration: 180
          },
          { id: 'fiio_next_1', source: 'local', title: 'Next Track One', path: '/sdcard/Music/next1.flac', duration: 200 },
          { id: 'fiio_next_2', source: 'local', title: 'Next Track Two', path: '/sdcard/Music/next2.flac', duration: 210 }
        ]
      },
      displayTrack: t => {
        uiEls['now-title'].textContent = t.title;
        uiEls['room-title'].textContent = t.title;
        uiEls['room-album'].textContent = t.album;
      },
      deferRenderQueue: () => { queueRenderCount++; },
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      renderRoomSignal: () => {},
      syncRoomOutputText: () => {},
      updatePositionState: () => {},
      savePlaybackSession: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      updateLyricsHighlight: () => {},
      renderWaveformSeekbar: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}`,
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean, JSON, console
    };

    vm.runInNewContext(`${applyBpSlice}\n${bpSlice}\n${fmtSlice}\nthis.applyBitPerfectMode = applyBitPerfectMode;\nsetupBitPerfectIntegration();`, sandbox);
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(sandbox.state.currentId, 'fiio_cue_2');
    assert.equal(uiEls['now-title'].textContent, 'Matched Suite II');
    assert.equal(uiEls['room-album'].textContent, 'Suite in D');
    assert.equal(uiEls['current-time'].textContent, '0:45');
    assert.equal(uiEls['duration'].textContent, '3:00');
    assert.deepEqual(Array.from(sandbox.state.queueTrackIds), ['fiio_next_1', 'fiio_next_2']);
    assert.equal(queueRenderCount, 1);
    assert.equal(ackCount, 1);
    assert.equal(startCount, 0);

    // Phase 3 redundant call keeps ackCount at 1
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(ackCount, 1);
  });

  it('4. Group D Phase 3 parity: Cloud PCM paused recovery, { active: false } state reset, onBitPerfectPlaybackComplete EOS cleanup, and full _bpRehydrationUnmatched reset lifecycle', async () => {
    const applyBpSlice = extractBetween(html, 'function applyBitPerfectMode(enabled)', 'window.applyBitPerfectMode = applyBitPerfectMode;');
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const fmtSlice = extractBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', 'const speedBtnEl =');

    let snap = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: false,
      isPaused: true,
      currentId: 'google:bp_cloud_pcm',
      sourceKey: '',
      cueStartMs: 0,
      cueDurationMs: 0,
      positionMs: 42000,
      durationMs: 180000,
      title: 'Cloud HiRes PCM',
      artist: 'Cloud Orchestra',
      album: 'Cloud Master',
      bitPerfectLockedFormat: { sampleRate: 96000, bitDepth: 24, mixerBitPerfect: true, deviceName: 'FiiO KA17' }
    };

    const uiEls = {
      'resume-session-banner': makeEl(),
      'bitperfect-mode-toggle': makeEl(),
      'bitperfect-mode-badge': makeEl(),
      'quality-badge': makeEl(),
      'play-button': makeEl(),
      'current-time': makeEl(),
      'room-current-time': makeEl(),
      'duration': makeEl(),
      'now-title': makeEl()
    };
    const notifCalls = [];
    const syncButtonsCalls = [];
    let ackCount = 0;
    let playTrackCalls = [];
    let observedUnmatchedInsidePlayTrack = null;

    const sandbox = {
      library,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      audio: { paused: true, src: '' },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snap),
          getBitPerfectPosition: () => snap.positionMs,
          getBitPerfectDuration: () => snap.durationMs,
          ackBitPerfectRehydration: () => { ackCount++; },
          updateMediaNotification: (t, a, al, p) => { notifCalls.push({ t, a, al, p }); }
        }
      },
      document: { hidden: false },
      state: {
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        bitPerfectLockedFormat: null,
        currentId: null,
        isSeeking: false,
        lyrics: [],
        tracks: [{
          id: 'google:bp_cloud_pcm', source: 'google',
          title: 'Cloud HiRes PCM', artist: 'Cloud Orchestra', album: 'Cloud Master', duration: 180
        }]
      },
      displayTrack: t => { uiEls['now-title'].textContent = t.title; },
      playTrack: id => {
        observedUnmatchedInsidePlayTrack = sandbox.state._bpRehydrationUnmatched;
        playTrackCalls.push(id);
      },
      playNext: () => {},
      resetBitPerfectModeBadge: () => {},
      syncPlaybackButtonsUi: p => { syncButtonsCalls.push(p); },
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      renderRoomSignal: () => {},
      syncRoomOutputText: () => {},
      updatePositionState: () => {},
      savePlaybackSession: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      updateLyricsHighlight: () => {},
      renderWaveformSeekbar: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}`,
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean, JSON, console
    };
    vm.runInNewContext(`${applyBpSlice}\n${bpSlice}\n${fmtSlice}\nthis.applyBitPerfectMode = applyBitPerfectMode;\nsetupBitPerfectIntegration();`, sandbox);

    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(uiEls['play-button'].textContent, '▶');
    assert.equal(uiEls['current-time'].textContent, '0:42');
    assert.equal(uiEls['room-current-time'].textContent, '0:42');
    assert.equal(uiEls['duration'].textContent, '3:00');
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused');
    assert.equal(ackCount, 1);

    // EOS cleanup when queue has no next track
    sandbox.window.onBitPerfectPlaybackComplete();
    assert.equal(sandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused');
    assert.ok(syncButtonsCalls.includes(false));
    assert.ok(notifCalls.some(n => n.p === false));

    // Rehydration reset on { active: false }
    snap = { active: false };
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), false);
    assert.equal(sandbox.state._bpRehydratedMatchedId, null);
    assert.equal(sandbox.state._bpRehydratedCueWindow, null);
    assert.equal(sandbox.state._bpRehydratedQueueRestored, false);
    assert.equal(sandbox.state._bpAckedRehydrationId, null);
    assert.equal(sandbox.state._bpRehydrationUnmatched, false);

    // Clear _bpRehydrationUnmatched on applyBitPerfectMode(false) inside active unpaused branch BEFORE playTrack (kills M_4517)
    sandbox.state.isNativeBitPerfectPlaying = true;
    sandbox.state.isNativeBitPerfectPaused = false;
    sandbox.state.currentId = 'google:bp_cloud_pcm';
    sandbox.state._bpRehydrationUnmatched = true;
    playTrackCalls = [];
    observedUnmatchedInsidePlayTrack = null;
    sandbox.applyBitPerfectMode(false);
    assert.deepEqual(playTrackCalls, ['google:bp_cloud_pcm']);
    assert.equal(observedUnmatchedInsidePlayTrack, false, 'applyBitPerfectMode(false) must clear _bpRehydrationUnmatched BEFORE synchronous playTrack handoff');
    assert.equal(sandbox.state._bpRehydrationUnmatched, false);

    // Clear _bpRehydrationUnmatched on applyBitPerfectMode(false) outer else branch when isNativeBitPerfectPlaying === false (kills M_4528)
    sandbox.state.isNativeBitPerfectPlaying = false;
    sandbox.state.isNativeBitPerfectPaused = false;
    sandbox.state._bpRehydrationUnmatched = true;
    sandbox.applyBitPerfectMode(false);
    assert.equal(sandbox.state._bpRehydrationUnmatched, false, 'applyBitPerfectMode(false) must clear _bpRehydrationUnmatched when native BP is inactive');

    // Clear _bpRehydrationUnmatched on onNativeBitPerfectPosition CUE EOS (!state.isPlaybackLoading)
    sandbox.state.tracks.push({
      id: 'cue_eos_1', source: 'local', title: 'CUE EOS', isCue: true, cueStart: 100, duration: 60
    });
    sandbox.state.currentId = 'cue_eos_1';
    sandbox.state.isNativeBitPerfectPlaying = true;
    sandbox.state.isNativeBitPerfectPaused = false;
    sandbox.state.isPlaybackLoading = false;
    sandbox.state._bpCueAdvancingId = null;
    sandbox.state._bpRehydrationUnmatched = true;
    sandbox.window.onNativeBitPerfectPosition(159900, 240000);
    assert.equal(sandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(sandbox.state._bpRehydrationUnmatched, false, 'onNativeBitPerfectPosition CUE EOS must clear _bpRehydrationUnmatched');

    // Clear _bpRehydrationUnmatched on onNativeBitPerfectError
    sandbox.state.currentId = null;
    sandbox.state._bpRehydrationUnmatched = true;
    sandbox.window.onNativeBitPerfectError('test_err', 0);
    assert.equal(sandbox.state._bpRehydrationUnmatched, false, 'onNativeBitPerfectError must clear _bpRehydrationUnmatched');

    // Clear _bpRehydrationUnmatched on clearCloudSourceCatalog() when current native BP track belongs to cleared source
    const clearCloudSlice = extractBetween(html, 'async function clearCloudSourceCatalog(source)', 'async function disconnectCloudSource(');
    let clearStopCount = 0;
    const clearSandbox = {
      $: () => null,
      audio: { pause() {} },
      standbyAudio: { pause() {} },
      window: { NocturneNative: { stopBitPerfectPlayback: () => { clearStopCount++; } } },
      state: {
        currentId: 'google:clr_1',
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        bitPerfectLockedFormat: { sampleRate: 96000 },
        _bpRehydratedMatchedId: 'google:clr_1',
        _bpRehydrationUnmatched: true,
        playGeneration: 0,
        queueTrackIds: ['google:clr_1'],
        tracks: [{ id: 'google:clr_1', source: 'google', title: 'Cleared Track' }]
      },
      resetBitPerfectModeBadge: () => {},
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      Set, Array, String, Number, Boolean, JSON, Promise, console
    };
    vm.runInNewContext(`${clearCloudSlice}\nthis.clearCloudSourceCatalog = clearCloudSourceCatalog;`, clearSandbox);
    const removedCount = await clearSandbox.clearCloudSourceCatalog('google');
    assert.equal(removedCount, 1);
    assert.equal(clearStopCount, 1);
    assert.equal(clearSandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(clearSandbox.state._bpRehydrationUnmatched, false, 'clearCloudSourceCatalog must clear _bpRehydrationUnmatched');

    // Clear _bpRehydrationUnmatched on handleNativeBitPerfectPlayPauseClick() inactive fallback
    const playPauseSlice = extractBetween(html, 'function handleNativeBitPerfectPlayPauseClick()', 'function boundPlayButtonCtxResume(');
    const ppSandbox = {
      window: { NocturneNative: { isBitPerfectActive: () => false } },
      state: {
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: true,
        _bpRehydratedMatchedId: 'stale_id',
        _bpRehydrationUnmatched: true
      },
      Boolean
    };
    vm.runInNewContext(`${playPauseSlice}\nthis.handleNativeBitPerfectPlayPauseClick = handleNativeBitPerfectPlayPauseClick;`, ppSandbox);
    assert.equal(ppSandbox.handleNativeBitPerfectPlayPauseClick(), false);
    assert.equal(ppSandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(ppSandbox.state._bpRehydrationUnmatched, false, 'handleNativeBitPerfectPlayPauseClick inactive fallback must clear _bpRehydrationUnmatched');

    // Behavioral node:vm verification of playTrack() DSD, Cloud PCM fallback (offline early return), and isSameCueNativeParent branches
    const playTrackSlice = extractBetween(html, 'function isTrackRoutedToNativeBitPerfect(track)', 'function stopDsdWorker(');
    const sharedCueUrl = 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2Fcue_parent.flac';
    let playStopBpCount = 0;
    let observedUnmatchedInSameCueStateChange = null;
    const playUi = {
      'play-button': makeEl(),
      'room-play': makeEl(),
      'mini-play': makeEl(),
      'fullscreen-play-btn': makeEl()
    };
    const playSandbox = {
      library,
      $: id => playUi[id] || null,
      navigator: { onLine: false },
      location: { href: 'https://appassets.androidplatform.net/index.html' },
      URL,
      performance: { now: () => 1000 },
      audio: { paused: true, src: '', pause() {}, removeAttribute() {}, load() {} },
      standbyAudio: { paused: true, src: '', pause() {}, removeAttribute() {}, load() {} },
      window: {
        NocturneNative: {
          isBitPerfectSupported: () => true,
          isBitPerfectActive: () => true,
          stopBitPerfectPlayback: () => { playStopBpCount++; },
          setBitPerfectTrackId: () => {},
          setBitPerfectTrackWindow: () => {},
          seekBitPerfectPlayback: () => {},
          resumeBitPerfectPlayback: () => {},
          setBitPerfectStreamAuth: () => {}
        },
        onNativeBitPerfectStateChange: () => {
          observedUnmatchedInSameCueStateChange = playSandbox.state._bpRehydrationUnmatched;
        }
      },
      state: {
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        bitPerfectLockedFormat: { sampleRate: 192000 },
        _bpRehydratedMatchedId: null,
        _bpRehydrationUnmatched: true,
        _bpCueAdvancingId: null,
        _bpCueAdvancingWasNative: false,
        _bpPositionGuardToken: 0,
        _bpAwaitingStart: false,
        lastBitPerfectPositionSec: 0,
        playGeneration: 0,
        preloadGeneration: 0,
        preloadTrackId: null,
        objectUrls: new Set(),
        queueTrackIds: [],
        bpmEnergyHistory: [],
        currentId: null,
        previousTrackId: null,
        tracks: [
          { id: 'dsd_offline_1', source: 'google', isDsd: true, load: async () => {} },
          { id: 'google:pcm_offline_1', source: 'google', remoteId: 'r_pcm_1', load: async () => {} },
          { id: 'cue_parent_1', source: 'local', isCue: true, cueStart: 0, duration: 120, url: sharedCueUrl },
          { id: 'cue_parent_2', source: 'local', isCue: true, cueStart: 120, duration: 120, url: sharedCueUrl }
        ]
      },
      abortStaleFullAudioUpgrades: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      setupAudio: () => {},
      unlockAudioDecksOnGesture: () => {},
      setPlaybackLoading: v => { playSandbox.state.isPlaybackLoading = v; },
      clearOptimisticLoadingUi: () => {},
      ensureLocalTrackPlayableUrl: async () => {},
      resetAbLoop: () => {},
      invalidateStaleStandbyPreload: () => false,
      syncPendingNextCloudWifiLock: () => {},
      deferRenderQueue: () => {},
      renderQueue: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      toast: () => {},
      resetBitPerfectModeBadge: () => {},
      syncPlaybackButtonsUi: () => {},
      updateMiniPlayerHud: () => {},
      updateRoonFullscreenUI: () => {},
      updatePositionState: () => {},
      recordHistory: () => {},
      pruneExcessObjectUrls: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      dsdSourceInfo: () => null,
      Date, Math, Number, String, Boolean, JSON, Set, Array, console, encodeURIComponent
    };
    vm.runInNewContext(`${playTrackSlice}\nthis.playTrack = playTrack;`, playSandbox);

    // 4a. DSD branch (offline early return after stopping native BP)
    await playSandbox.playTrack('dsd_offline_1');
    assert.equal(playStopBpCount, 1);
    assert.equal(playSandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(playSandbox.state._bpRehydrationUnmatched, false, 'playTrack DSD branch must clear _bpRehydrationUnmatched');

    // 4b. Cloud PCM fallback (offline early return after stopping native BP)
    playSandbox.state.isNativeBitPerfectPlaying = true;
    playSandbox.state._bpRehydrationUnmatched = true;
    await playSandbox.playTrack('google:pcm_offline_1');
    assert.equal(playStopBpCount, 2);
    assert.equal(playSandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(playSandbox.state._bpRehydrationUnmatched, false, 'playTrack Cloud PCM fallback must clear _bpRehydrationUnmatched');

    // 4c. isSameCueNativeParent branch (must clear BEFORE onNativeBitPerfectStateChange(true))
    playSandbox.state.currentId = 'cue_parent_1';
    playSandbox.state.isNativeBitPerfectPlaying = true;
    playSandbox.state.isNativeBitPerfectPaused = false;
    playSandbox.state._bpRehydrationUnmatched = true;
    observedUnmatchedInSameCueStateChange = null;
    await playSandbox.playTrack('cue_parent_2');
    assert.equal(observedUnmatchedInSameCueStateChange, false, 'playTrack isSameCueNativeParent must clear _bpRehydrationUnmatched BEFORE onNativeBitPerfectStateChange(true)');
    assert.equal(playSandbox.state._bpRehydrationUnmatched, false);
  });

  it('5. Group A parity: seekPreloadedCueStandby pre-seeks standby CUE deck near cueStart (6.0s) and honors shouldAutoCrossfade thresholds', () => {
    const preseekSlice = extractBetween(html, 'function seekPreloadedCueStandby(', 'function isPreloadedStandbyStaleOrErrored(');
    const standbyEl = {
      src: 'blob:cue-long',
      readyState: 4,
      duration: 18,
      currentTime: 0,
      seeking: false,
      addEventListener() {}
    };
    const sandbox = {
      standbyAudio: standbyEl,
      state: {
        currentId: 'pcm-1',
        preloadGeneration: 5,
        preloadTrackId: 'cue-2'
      },
      Math, Number, String
    };
    vm.runInNewContext(`${preseekSlice}\nthis.seekPreloadedCueStandby = seekPreloadedCueStandby;`, sandbox);

    const nextCue = { id: 'cue-2', isCue: true, cueStart: 6.0, duration: 6.0 };
    sandbox.seekPreloadedCueStandby(nextCue, 'blob:cue-long', 5);
    assert.equal(standbyEl.currentTime, 6.0, 'seekPreloadedCueStandby must pre-seek standby deck to cueStart=6.0s');

    // Group A threshold: >5s CUE tracks trigger crossfade when crossfadeSeconds=2, return false when crossfadeSeconds=0 (gapless) or Native BP is active
    assert.equal(library.shouldAutoCrossfade(4.1, 6.0, 2, { isNativeBitPerfect: false, hasNextTrack: true, leadMargin: 0.5 }), true);
    assert.equal(library.shouldAutoCrossfade(5.85, 6.0, 0, { isNativeBitPerfect: false, hasNextTrack: true, leadMargin: 0.25 }), false);
    assert.equal(library.shouldAutoCrossfade(4.1, 6.0, 2, { isNativeBitPerfect: true, hasNextTrack: true, leadMargin: 0.5 }), false);
    const cueTiming = library.resolveEffectiveTrackTiming({ id: 'cue-2', isCue: true, cueStart: 6.0, cueEnd: 12.0, duration: 6.0 }, 11.85, 18.0);
    assert.equal(cueTiming.isCue, true);
    assert.ok(Math.abs(cueTiming.currentTime - 5.85) < 1e-6);
    assert.equal(cueTiming.duration, 6.0);
  });
});
