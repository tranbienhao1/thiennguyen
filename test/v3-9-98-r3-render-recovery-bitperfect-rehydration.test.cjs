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

describe('v3.9.98 R3: Android Render-Process Recovery Bit-Perfect Snapshot & Web Rehydration', () => {
  it('1. MainActivity.java exposes setBitPerfectTrackId, caches locked DAC format, builds snapshot JSON, and flags render-process recovery', () => {
    assert.ok(
      mainJava.includes('public void setBitPerfectTrackWindow(long cueStartMs, long cueDurationMs, String title, String artist, String album)'),
      'setBitPerfectTrackWindow 5-arg signature must remain unchanged for v3-9-97 test compatibility'
    );
    assert.ok(mainJava.includes('@JavascriptInterface\n        public void setBitPerfectTrackId(String trackId)'));
    assert.ok(mainJava.includes('@JavascriptInterface\n        public String getBitPerfectPlaybackSnapshot()'));

    const recSlice = extractBetween(mainJava, 'private boolean recoverWebViewAfterRenderProcessGone(final WebView deadView)', 'public void acquireWakeLock()');
    assert.ok(recSlice.includes('mPendingRenderProcessRehydration = (mBitPerfectPlayer != null && mBitPerfectPlayer.isActive());'));
    assert.equal(recSlice.includes('stopBitPerfectPlayback'), false);
    assert.equal(recSlice.includes('mBitPerfectPlayer.stop'), false);

    const pageFinSlice = extractBetween(mainJava, 'public void onPageFinished(WebView view, String url)', 'public void onReceivedError(');
    assert.ok(pageFinSlice.includes('mPendingRenderProcessRehydration') && pageFinSlice.includes('window.rehydrateNativeBitPerfectPlayback'));

    const fmtSlice = extractBetween(mainJava, 'private void notifyBitPerfectFormatToWeb(', 'private void notifyBitPerfectErrorToWeb(');
    assert.ok(
      fmtSlice.includes('mLockedSampleRate = actualRate;') &&
      fmtSlice.includes('mLockedBitDepth = bits;') &&
      fmtSlice.includes('mLockedMixerBitPerfect = mixerBitPerfect;') &&
      fmtSlice.includes('mLockedDeviceName = devName;')
    );

    const snapSlice = extractBetween(mainJava, 'public String getPlaybackSnapshotJson(boolean recoveredFromCrash)', 'private static int pcmBytesPerFrame(');
    for (const key of [
      '"active"', '"isNativeBitPerfectPlaying"', '"isPlaying"', '"isPaused"',
      '"currentId"', '"sourceKey"', '"cueStartMs"', '"cueDurationMs"',
      '"positionMs"', '"durationMs"', '"displayPositionMs"', '"displayDurationMs"',
      '"title"', '"artist"', '"album"', '"recoveredFromRenderCrash"', '"bitPerfectLockedFormat"'
    ]) {
      assert.ok(snapSlice.includes(key), `Snapshot JSON must populate ${key}`);
    }
  });

  it('2. window.rehydrateNativeBitPerfectPlayback restores Native Bit-Perfect state, locked DAC format, CUE window & UI without restarting audio', () => {
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const fmtSlice = extractBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', 'const speedBtnEl =');

    const snapshotPayload = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: 'fiio_cue_2',
      sourceKey: 'https://appassets.androidplatform.net/local-media?path=%2Fsdcard%2FMusic%2Fsuite.flac',
      cueStartMs: 120000,
      cueDurationMs: 180000,
      positionMs: 165500,
      durationMs: 600000,
      displayPositionMs: 45500,
      displayDurationMs: 180000,
      title: 'Movement II',
      artist: 'Mahler',
      album: 'Symphony 5',
      recoveredFromRenderCrash: true,
      bitPerfectLockedFormat: {
        sampleRate: 192000,
        bitDepth: 24,
        mixerBitPerfect: true,
        deviceName: 'FiiO M11S'
      }
    };

    const banner = {
      classList: {
        _set: new Set(['flex']),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      }
    };
    const uiEls = {
      'resume-session-banner': banner,
      'bitperfect-mode-toggle': { checked: false, addEventListener() {} },
      'bitperfect-mode-badge': { textContent: '', title: '' },
      'quality-badge': { textContent: '' },
      'play-button': { textContent: '▶', classList: { remove() {} }, setAttribute() {} },
      'current-time': { textContent: '' },
      'duration': { textContent: '' },
      'now-title': { textContent: 'Chưa chọn bài hát' }
    };
    const displayedIds = [];
    let startCalled = 0;
    let playTrackCalled = 0;

    const sandbox = {
      library,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snapshotPayload),
          startBitPerfectPlayback: () => { startCalled++; return true; },
          getBitPerfectPosition: () => 165500,
          getBitPerfectDuration: () => 600000
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
        tracks: [
          {
            id: 'fiio_cue_1',
            isCue: true,
            cueStart: 0,
            duration: 120,
            url: snapshotPayload.sourceKey,
            title: 'Movement I'
          },
          {
            id: 'fiio_cue_2',
            isCue: true,
            cueStart: 120,
            duration: 180,
            url: snapshotPayload.sourceKey,
            title: 'Movement II',
            artist: 'Mahler',
            album: 'Symphony 5'
          }
        ]
      },
      displayTrack: t => { displayedIds.push(t.id); uiEls['now-title'].textContent = t.title; },
      playTrack: () => { playTrackCalled++; },
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

    vm.runInNewContext(bpSlice + '\n' + fmtSlice + '\nsetupBitPerfectIntegration();', sandbox);
    assert.equal(typeof sandbox.window.rehydrateNativeBitPerfectPlayback, 'function');
    assert.equal(sandbox.window.rehydrateBitPerfectFromNativeSnapshot, sandbox.window.rehydrateNativeBitPerfectPlayback);

    const ok = sandbox.window.rehydrateNativeBitPerfectPlayback();
    assert.equal(ok, true);
    assert.equal(sandbox.state.bitPerfectEnabled, true);
    assert.equal(sandbox.state.isNativeBitPerfectPlaying, true);
    assert.equal(sandbox.state.isNativeBitPerfectPaused, false);
    assert.equal(sandbox.state.currentId, 'fiio_cue_2');
    assert.deepEqual(displayedIds, ['fiio_cue_2']);
    assert.equal(sandbox.state.bitPerfectLockedFormat.sampleRate, 192000);
    assert.equal(sandbox.state.bitPerfectLockedFormat.bitDepth, 24);
    assert.equal(sandbox.state.bitPerfectLockedFormat.deviceName, 'FiiO M11S');
    assert.equal(uiEls['play-button'].textContent, 'Ⅱ');
    assert.equal(uiEls['current-time'].textContent, '0:45');
    assert.equal(uiEls['duration'].textContent, '3:00');
    assert.equal(banner.classList.contains('hidden'), true, 'Resume banner must stay hidden during Native Bit-Perfect rehydration');
    assert.equal(startCalled, 0, 'Rehydration must NOT call startBitPerfectPlayback');
    assert.equal(playTrackCalled, 0, 'Rehydration must NOT call playTrack');
  });

  it('3. index.html invokes setBitPerfectTrackId alongside setBitPerfectTrackWindow and calls rehydrateNativeBitPerfectPlayback on startup/catalog restore', () => {
    assert.ok(html.includes('window.NocturneNative.setBitPerfectTrackId(String(track.id'));
    const startupSlice = html.slice(html.indexOf('applyBitPerfectMode(state.bitPerfectEnabled);'));
    const rehydrateIdx = startupSlice.indexOf('rehydrateNativeBitPerfectPlayback');
    const resumeIdx = startupSlice.indexOf('checkAndPromptResumeSession');
    assert.ok(rehydrateIdx > 0 && resumeIdx > rehydrateIdx, 'Rehydration must run before checkAndPromptResumeSession on startup');
  });

  it('4. Two-phase startup rehydration calls displayTrack(matched) after early unmatched snapshot prefill and resets on stop/inactive', () => {
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const fmtSlice = extractBetween(html, '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge', 'const speedBtnEl =');

    let snapActive = true;
    const snapshotPayload = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: 'google:g1',
      sourceKey: 'https://www.googleapis.com/drive/v3/files/g1?alt=media',
      cueStartMs: 0,
      cueDurationMs: 0,
      positionMs: 42000,
      durationMs: 240000,
      title: 'Cloud Track 1',
      artist: 'Cloud Artist',
      album: 'Cloud Album',
      recoveredFromRenderCrash: true,
      bitPerfectLockedFormat: { sampleRate: 96000, bitDepth: 24, mixerBitPerfect: true, deviceName: 'FiiO M11S' }
    };

    const uiEls = {
      'resume-session-banner': { classList: { add() {}, remove() {} } },
      'bitperfect-mode-toggle': { checked: false, addEventListener() {} },
      'bitperfect-mode-badge': { textContent: '', title: '' },
      'quality-badge': { textContent: '' },
      'play-button': { textContent: '▶', classList: { remove() {} }, setAttribute() {} },
      'current-time': { textContent: '' },
      'duration': { textContent: '' },
      'now-title': { textContent: 'Chưa chọn bài hát' },
      'now-artist': { textContent: '' }
    };
    const displayedIds = [];

    const sandbox = {
      library,
      $: id => uiEls[id] || null,
      navigator: { mediaSession: { playbackState: 'none' } },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snapActive ? snapshotPayload : { active: false }),
          getBitPerfectPosition: () => 42000,
          getBitPerfectDuration: () => 240000
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
      displayTrack: t => { displayedIds.push(t.id); uiEls['now-title'].textContent = t.title; },
      playNext: () => {},
      resetBitPerfectModeBadge: () => {},
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

    vm.runInNewContext(bpSlice + '\n' + fmtSlice + '\nsetupBitPerfectIntegration();', sandbox);

    // Phase 1: early startup before restoreCloudCatalog() / restoreSavedLocalFolderOnStartup()
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(sandbox.state.currentId, 'google:g1');
    assert.equal(uiEls['now-title'].textContent, 'Cloud Track 1');
    assert.deepEqual(displayedIds, [], 'Unmatched Phase 1 must not call displayTrack');

    // Phase 2: catalog restored, matched track now exists in state.tracks
    sandbox.state.tracks.push({
      id: 'google:g1',
      source: 'google',
      title: 'Cloud Track 1',
      artist: 'Cloud Artist',
      album: 'Cloud Album',
      sampleRate: 96000,
      bitDepth: 24,
      duration: 240
    });
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(displayedIds, ['google:g1'], 'Phase 2 MUST call displayTrack(matched) even though Phase 1 prefilled currentId and #now-title');

    // Phase 3: redundant rehydrate for same matched track does not duplicate displayTrack
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(displayedIds, ['google:g1']);

    // Inactive/complete resets _bpRehydratedMatchedId so future rehydration hydrates again
    snapActive = false;
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), false);
    assert.equal(sandbox.state._bpRehydratedMatchedId, null);
    snapActive = true;
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.deepEqual(displayedIds, ['google:g1', 'google:g1']);
  });
});
