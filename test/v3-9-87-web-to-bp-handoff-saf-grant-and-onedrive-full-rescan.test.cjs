'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const libraryUtils = require(path.join(ROOT, 'library-utils.js'));

function extractFn(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find ${signature}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0, inSingle = false, inDouble = false, inTpl = false, escaped = false;
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

test('v3.9.87: applyBitPerfectMode(true) hands off playing Web Audio track to Native Bit-Perfect at exact timestamp', () => {
  const bpFn = extractFn(html, 'function applyBitPerfectMode(enabled)');
  const playedIds = [];
  let audioPauseCount = 0;
  const track = { id: 'web-to-bp-1', title: 'HiRes Track' };
  const fakeAudio = {
    src: 'http://127.0.0.1/local-media?path=test.flac',
    paused: false,
    ended: false,
    currentTime: 64.25,
    pause() { audioPauseCount++; this.paused = true; }
  };
  let routedFlag = true;
  const sandbox = {
    localStorage: { setItem() {} },
    $: () => null,
    audio: fakeAudio,
    isSilentUnlockSrc: () => false,
    isTrackRoutedToNativeBitPerfect: () => routedFlag,
    setGain() {},
    rebuildAudioRoutes() {},
    playTrack(id) { playedIds.push(id); },
    state: {
      bitPerfectEnabled: false,
      isNativeBitPerfectPlaying: false,
      currentId: 'web-to-bp-1',
      tracks: [track],
      context: { destination: {} },
      crossfeedNodes: { output: { disconnect() {}, connect() {} } }
    }
  };
  vm.runInNewContext(bpFn, sandbox);

  // Case 1: Web Audio actively playing & Native BP supported -> pause HTML5 & trigger playTrack with handoff sec
  sandbox.applyBitPerfectMode(true);
  assert.equal(audioPauseCount, 1);
  assert.equal(track._resumeAfterBpFallbackSec, 64.25);
  assert.deepEqual(playedIds, ['web-to-bp-1']);

  // Case 2: Web Audio paused -> no auto-play handoff
  delete track._resumeAfterBpFallbackSec;
  fakeAudio.paused = true;
  playedIds.length = 0;
  sandbox.applyBitPerfectMode(true);
  assert.deepEqual(playedIds, [], 'Paused Web Audio must stay paused when toggling Bit-Perfect ON');

  // Case 3: Playing Web Audio but track not routed to Native Bit-Perfect (e.g., Web desktop) -> stays Web Audio
  fakeAudio.paused = false;
  routedFlag = false;
  sandbox.applyBitPerfectMode(true);
  assert.deepEqual(playedIds, [], 'Desktop/non-native tracks must stay on Web Audio graph');
});

test('v3.9.87: playTrack Native Bit-Perfect startup honors _resumeAfterBpFallbackSec handoff seek while preserving cueStartSec', () => {
  const ptStart = html.indexOf('async function playTrack(trackId) {');
  assert.notEqual(ptStart, -1);
  const bpBlockStart = html.indexOf('const bpStarted = window.NocturneNative.startBitPerfectPlayback(', ptStart);
  assert.notEqual(bpBlockStart, -1);
  const bpBlockRec = html.indexOf('recordHistory(track);', bpBlockStart);
  assert.notEqual(bpBlockRec, -1);
  const bpBlockEnd = html.indexOf('          }', bpBlockRec);
  assert.notEqual(bpBlockEnd, -1);
  const bpBlock = html.slice(bpBlockStart, bpBlockEnd + '          }'.length);

  assert.ok(bpBlock.includes('const cueStartSec = (Number.isFinite(track.cueStart) && track.cueStart > 0) ? track.cueStart : 0;'));
  assert.ok(bpBlock.includes('window.NocturneNative.seekBitPerfectPlayback(Math.round(cueStartSec * 1000));'));
  assert.ok(bpBlock.includes('bpHandoffSec'));

  const seekCalls = [];
  const wrapped = `
    function runTest(track) {
      ${bpBlock}
    }
  `;
  const noop = () => {};
  const sandbox = {
    window: {
      NocturneNative: {
        startBitPerfectPlayback: () => true,
        seekBitPerfectPlayback: (ms) => seekCalls.push(ms)
      },
      onNativeBitPerfectStateChange: noop
    },
    audio: { pause: noop },
    standbyAudio: { pause: noop },
    state: {},
    $: () => ({}),
    displayTrack: noop,
    clearOptimisticLoadingUi: noop,
    setPlaybackLoading: noop,
    syncPlaybackButtonsUi: noop,
    updateMiniPlayerHud: noop,
    updateRoonFullscreenUI: noop,
    updatePositionState: noop,
    recordHistory: noop,
    pruneExcessObjectUrls: noop,
    scheduleTrackRender: noop
  };
  vm.runInNewContext(wrapped, sandbox);

  // Case 1: Handoff from Web Audio at 64.25s on a CUE track starting at 10.0s
  const t1 = { id: 'cue-1', url: 'file:///music/album.flac', sampleRate: 96000, bitDepth: 24, cueStart: 10.0, _resumeAfterBpFallbackSec: 64.25 };
  sandbox.runTest(t1);
  assert.deepEqual(seekCalls, [64250]);
  assert.equal(sandbox.state.lastBitPerfectPositionSec, 64.25);
  assert.equal(t1._resumeAfterBpFallbackSec, undefined);

  // Case 2: Normal CUE start without handoff -> seeks cueStartSec
  seekCalls.length = 0;
  const t2 = { id: 'cue-2', url: 'file:///music/album.flac', sampleRate: 96000, bitDepth: 24, cueStart: 120.5 };
  sandbox.runTest(t2);
  assert.deepEqual(seekCalls, [120500]);
  assert.equal(sandbox.state.lastBitPerfectPositionSec, 120.5);
});

test('v3.9.87: window.onAndroidStoragePermissionGranted clears failedNativeCovers & local access error flags cleanly', () => {
  const permStart = html.indexOf('window.onAndroidStoragePermissionGranted =');
  assert.notEqual(permStart, -1);
  const permFn = extractFn(html.slice(permStart), 'window.onAndroidStoragePermissionGranted =');

  let scanCalls = 0;
  const clearedSet = new Set(['cover-a', 'cover-b']);
  const tracks = [
    { id: 'f1', source: 'fiio', _localAccessError: 'permission_denied', _pathFallbackRetriedGen: 3 },
    { id: 'l1', source: 'local', _localAccessError: 'not_found', _pathFallbackRetriedGen: 2 },
    { id: 'c1', source: 'google', _localAccessError: 'keep' }
  ];
  const sandbox = {
    window: {},
    failedNativeCovers: clearedSet,
    state: { tracks },
    pendingAndroidStorageScan: true,
    readFiioStorageLinkInfo: () => ({ linked: true }),
    getFiioTrackCount: () => 2,
    scanFiioStorage: () => { scanCalls++; }
  };
  vm.runInNewContext(permFn, sandbox);
  sandbox.window.onAndroidStoragePermissionGranted();

  assert.equal(clearedSet.size, 0, 'failedNativeCovers must be cleared on permission grant');
  assert.equal(tracks[0]._localAccessError, undefined);
  assert.equal(tracks[0]._pathFallbackRetriedGen, undefined);
  assert.equal(tracks[1]._localAccessError, undefined);
  assert.equal(tracks[2]._localAccessError, 'keep', 'Non-local tracks should remain untouched');
  assert.equal(scanCalls, 1);

  // Minimal VM without state must not throw
  const minSandbox = {
    window: {},
    pendingAndroidStorageScan: false,
    readFiioStorageLinkInfo: () => ({ linked: false }),
    getFiioTrackCount: () => 0,
    scanFiioStorage: () => { scanCalls++; }
  };
  vm.runInNewContext(permFn, minSandbox);
  minSandbox.window.onAndroidStoragePermissionGranted();
  assert.equal(scanCalls, 2);
});

test('v3.9.87: loadMicrosoftFiles updates remoteParentId, clears stale remoteDriveId, marks cover refresh, and updates disc/track numbers on move/rename', () => {
  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  assert.notEqual(msStart, -1);
  const msEnd = html.indexOf('let msResumedFromCheckpoint = false;', msStart);
  assert.notEqual(msEnd, -1);
  const msSlice = html.slice(msStart, msEnd);

  // Ensure $select strings required by v3-9-46 and v3-9-50 remain strictly intact
  assert.equal((msSlice.match(/\$select=id,name,file,folder,cTag,size,audio&\$top=500/g) || []).length, 2);
  assert.ok(msSlice.includes('$select=id,name,file,folder,cTag,size,audio,remoteItem&$top=500'));

  const loopStart = msSlice.indexOf('if (existing) {');
  const loopPush = msSlice.indexOf('if (touched) updatedExistingTracks.push(existing);', loopStart);
  const loopEnd = msSlice.indexOf('\n                }', loopPush);
  assert.notEqual(loopStart, -1);
  assert.notEqual(loopEnd, -1);
  const updateBlock = msSlice.slice(loopStart, loopEnd + '\n                }'.length);

  const existing = {
    id: 'od-1',
    remoteId: 'item-1',
    remoteDriveId: 'old-shared-drive',
    remoteParentId: 'old-parent',
    remotePath: 'Music/OldAlbum/01 - Old.flac',
    name: '01 - Old.flac',
    size: 5000,
    contentRev: 'ctag-1',
    metadataLoaded: false,
    discNumber: null,
    trackNumber: null
  };
  const updatedExistingTracks = [];
  const sandbox = {
    existing,
    item: {
      id: 'item-1',
      name: 'CD2 - 07 - Renamed Track.flac',
      size: 5000,
      cTag: 'ctag-1',
      parentReference: { id: 'new-parent' }
    },
    rawWrapperId: '',
    itemDriveId: '',
    itemPath: 'Music/CD2/CD2 - 07 - Renamed Track.flac',
    seenRemoteIds: new Set(),
    byShortcutId: new Map(),
    updatedExistingTracks,
    library: libraryUtils,
    filenameMetadata: () => ({ title: 'Renamed Track', artist: 'Singer', album: 'CD2' }),
    invalidateCloudTrackContent() {},
    mergeMicrosoftTrack() {}
  };
  vm.runInNewContext(updateBlock, sandbox);

  assert.equal(existing.remoteDriveId, '', 'Stale remoteDriveId must clear when item moves to personal drive');
  assert.equal(existing.remoteParentId, 'new-parent');
  assert.equal(existing._needsFolderCoverRefresh, true);
  assert.equal(existing.discNumber, 2);
  assert.equal(existing.trackNumber, 7);
  assert.equal(updatedExistingTracks.length, 1);
});

test('v3.9.87: Monotonic version alignment across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.87';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.87';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30987);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 141);
  assert.ok(gradle.includes('versionName = "3.9.87"'));
});
