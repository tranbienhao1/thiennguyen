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

test('v3.9.86: reopenSavedFolder prompts permission on secondary saved folders & clears _localAccessError', async () => {
  const recFn = extractFn(html, 'async function reopenSavedFolderRecord(record, opts)');
  const openFn = extractFn(html, 'async function reopenSavedFolder(options)');

  let reqCountPrimary = 0, reqCountSecondary = 0;
  const tracks = [
    { id: 't1', source: 'local', folderRootKey: 'dir:album-a', _localAccessError: 'permission_denied' },
    { id: 't2', source: 'local', folderRootKey: 'dir:album-b', _localAccessError: 'permission_denied' }
  ];
  const primaryRec = {
    name: 'Album-A',
    handle: {
      name: 'Album-A',
      queryPermission: async () => 'prompt',
      requestPermission: async () => { reqCountPrimary++; return 'granted'; }
    }
  };
  const secondaryRec = {
    name: 'Album-B',
    handle: {
      name: 'Album-B',
      queryPermission: async () => 'prompt',
      requestPermission: async () => { reqCountSecondary++; return 'granted'; }
    }
  };

  const sandbox = {
    window: { showDirectoryPicker() {} },
    state: { tracks },
    savedLocalFolderRecord: primaryRec,
    loadSavedLocalFolderHandles: async () => [primaryRec, secondaryRec],
    loadRecentLocalFolderHandle: async () => primaryRec,
    updateSavedFolderButtons() {},
    collectAudioAndCoverFilesFromDirectoryHandle: async (h) => [{ name: h.name + '.flac', size: 1024 }],
    addLocalFiles: async () => ({ added: 1, removed: 0 }),
    pruneRemovedLocalFolderTracks: () => 0,
    clearRecentLocalFolderHandle: async () => {},
    renderTracks() {},
    toast() {},
    console
  };
  vm.runInNewContext(`${recFn}\n${openFn}`, sandbox);

  const ok = await sandbox.reopenSavedFolder({ silentIfGranted: false });
  assert.equal(ok, true);
  assert.equal(reqCountPrimary, 1);
  assert.equal(reqCountSecondary, 1, 'Secondary saved folder must also call requestPermission when silentIfGranted is false');
  assert.equal(tracks[0]._localAccessError, null);
  assert.equal(tracks[1]._localAccessError, null);
});

test('v3.9.86: applyBitPerfectMode(false) hands off position smoothly to Web Audio or stays paused when paused', () => {
  const bpFn = extractFn(html, 'function applyBitPerfectMode(enabled)');
  let stoppedCount = 0;
  let playedTrackId = null;
  const track = { id: 'bp-1', title: 'HiRes FLAC' };
  const fakeWindow = {
    NocturneNative: { stopBitPerfectPlayback() { stoppedCount++; } }
  };
  const sandbox = {
    window: fakeWindow,
    localStorage: { setItem() {} },
    $: () => null,
    audio: { paused: true, src: '' },
    isSilentUnlockSrc: () => false,
    setGain() {},
    rebuildAudioRoutes() {},
    displayTrack() {},
    syncPlaybackButtonsUi() {},
    playTrack(id) { playedTrackId = id; },
    state: {
      bitPerfectEnabled: true,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lastBitPerfectPositionSec: 87.4,
      currentId: 'bp-1',
      tracks: [track],
      context: { destination: {} },
      crossfeedNodes: { output: { disconnect() {}, connect() {} } }
    }
  };
  vm.runInNewContext(bpFn, sandbox);

  // Case 1: Actively playing Bit-Perfect -> hands off to Web Audio at 87.4s
  sandbox.applyBitPerfectMode(false);
  assert.equal(stoppedCount, 1);
  assert.equal(sandbox.state.isNativeBitPerfectPlaying, false);
  assert.equal(track._resumeAfterBpFallbackSec, 87.4);
  assert.equal(playedTrackId, 'bp-1');

  // Case 2: Paused Bit-Perfect -> stays paused at preserved position without calling playTrack
  playedTrackId = null;
  track._resumeAfterBpFallbackSec = 0;
  sandbox.state.isNativeBitPerfectPlaying = true;
  sandbox.state.isNativeBitPerfectPaused = true;
  sandbox.state.lastBitPerfectPositionSec = 112.5;
  sandbox.applyBitPerfectMode(false);
  assert.equal(track._resumeAfterBpFallbackSec, 112.5);
  assert.equal(playedTrackId, null, 'Must stay paused when Bit-Perfect was paused');
});

test('v3.9.86: applyGoogleScanUpdate tracks moved parents, resets LRC/art caches, and updates track/disc numbers on rename', () => {
  const gStart = html.indexOf('const applyGoogleScanUpdate = (existing, file) => {');
  assert.notEqual(gStart, -1);
  const gEnd = html.indexOf('let sawIncompleteSearch = false;', gStart);
  assert.notEqual(gEnd, -1);
  const snippet = html.slice(gStart, gEnd);

  const existing = {
    id: 'g1',
    remoteId: 'r1',
    parents: ['old-dir'],
    name: 'Track A.flac',
    _checkedDriveLrc: true,
    metadataLoaded: false,
    discNumber: null,
    trackNumber: null,
    size: 1000,
    contentRev: 'md5-1'
  };
  const checkedGoogleArtParents = new Set(['old-dir', 'new-dir']);
  const updatedExistingTracks = [];
  const sandbox = {
    library: libraryUtils,
    checkedGoogleArtParents,
    existingByTargetId: new Map(),
    updatedExistingTracks,
    filenameMetadata: () => ({ title: 'New Song', artist: 'Artist', album: 'Album' }),
    invalidateCloudTrackContent() {}
  };
  vm.runInNewContext(`${snippet}\nglobalThis.__fn = applyGoogleScanUpdate;`, sandbox);
  sandbox.__fn(existing, {
    id: 'r1',
    parents: ['new-dir'],
    name: 'CD2 - 03 - New Song.flac',
    size: 1000,
    md5Checksum: 'md5-1'
  });

  assert.deepEqual(existing.parents, ['new-dir']);
  assert.equal(checkedGoogleArtParents.has('new-dir'), false, 'New parent art cache invalidated');
  assert.equal(existing._checkedDriveLrc, false, 'Sidecar LRC flag reset on move');
  assert.equal(existing.discNumber, 2);
  assert.equal(existing.trackNumber, 3);
  assert.equal(updatedExistingTracks.length, 1);
});

test('v3.9.86: Monotonic version alignment across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.86';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.86';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30986);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 140);
  assert.ok(gradle.includes('versionName = "3.9.86"'));
});
