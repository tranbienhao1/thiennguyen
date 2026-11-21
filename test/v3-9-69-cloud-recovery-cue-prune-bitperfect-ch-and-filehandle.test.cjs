'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Cloud sidecar LRC supports multi-encoding, OneDrive remoteDriveId fallback & Google Drive shortcut target parent, and upgradeSliceToFullAudio has 2-layer OneDrive Shared fallback', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const decStart = html.indexOf('function decodeTextBytesAuto(rawBuf) {');
  const decEnd = html.indexOf('function readLocalTextFileAuto(', decStart);
  const lrcStart = html.indexOf('async function fetchCloudSidecarLyrics(track) {');
  const lrcEnd = html.indexOf('async function triggerLyricsFetch(track)', lrcStart);
  const upStart = html.indexOf('const isGraphContentUrl =');
  const upEnd = html.indexOf('async function retryPendingCurrentSliceUpgrade()', upStart);
  assert.ok(decStart > 0 && decEnd > decStart);
  assert.ok(lrcStart > 0 && lrcEnd > lrcStart);
  assert.ok(upStart > 0 && upEnd > upStart);

  // Shift-JIS bytes for "[00:05.00]夢の途中"
  const sjisBuf = Uint8Array.from([0x5B, 0x30, 0x30, 0x3A, 0x30, 0x35, 0x2E, 0x30, 0x30, 0x5D, 0x96, 0xB2, 0x82, 0xCC, 0x93, 0x72, 0x92, 0x86]).buffer;
  const fetchedUrls = [];

  const lrcSandbox = {
    Uint8Array,
    TextDecoder,
    URLSearchParams,
    String,
    Number,
    Array,
    Boolean,
    navigator: { onLine: true },
    state: { microsoftAccessToken: 'ms-tok', googleToken: 'g-tok' },
    ensureGoogleToken: async () => 'g-tok',
    getMicrosoftToken: async () => 'ms-tok',
    fetch: async (url) => {
      fetchedUrls.push(url);
      // OneDrive shared drive content (using track.remoteDriveId fallback)
      if (url.includes('/drives/shared-drv-7/items/lrc-item-1/content')) {
        return { ok: true, status: 200, arrayBuffer: async () => sjisBuf };
      }
      // Google Drive shortcut: primary folder has no .lrc
      if (url.includes('shortcut-parent-1')) {
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
      // Google Drive shortcut target metadata lookup
      if (url.includes('/files/target-audio-99?fields=parents,name')) {
        return { ok: true, status: 200, json: async () => ({ parents: ['real-album-dir'], name: '01 - Original.flac' }) };
      }
      // Google Drive target folder .lrc search
      if (url.includes('real-album-dir') && url.includes('Original.lrc')) {
        return { ok: true, status: 200, json: async () => ({ files: [{ id: 'lrc-drive-77', name: '01 - Original.lrc', size: '120' }] }) };
      }
      // Google Drive .lrc download
      if (url.includes('/files/lrc-drive-77?alt=media')) {
        return { ok: true, status: 200, arrayBuffer: async () => sjisBuf };
      }
      return { ok: false, status: 404 };
    }
  };

  vm.createContext(lrcSandbox);
  vm.runInContext(
    html.slice(decStart, decEnd) + '\n' + html.slice(lrcStart, lrcEnd) + '\nthis.fetchCloudSidecarLyrics = fetchCloudSidecarLyrics;',
    lrcSandbox
  );

  // 1.1 OneDrive shared track missing remoteLrc.driveId falls back to track.remoteDriveId + decodes Shift-JIS
  const odRes = await lrcSandbox.fetchCloudSidecarLyrics({
    source: 'onedrive',
    remoteDriveId: 'shared-drv-7',
    remoteLrc: { id: 'lrc-item-1', driveId: '', name: '01.lrc' }
  });
  assert.ok(odRes && odRes.text.includes('[00:05.00]') && !odRes.text.includes('\uFFFD'), 'OneDrive shared LRC must inherit remoteDriveId and decode Shift-JIS cleanly');

  // 1.2 Google Drive shortcut locates .lrc in targetRemoteId parent folder and decodes Shift-JIS
  const gShortcutRes = await lrcSandbox.fetchCloudSidecarLyrics({
    source: 'google',
    remoteId: 'sc-1',
    targetRemoteId: 'target-audio-99',
    parents: ['shortcut-parent-1'],
    name: 'Shortcut Copy.flac'
  });
  assert.ok(gShortcutRes && gShortcutRes.text.includes('[00:05.00]') && !gShortcutRes.text.includes('\uFFFD'), 'Google Drive shortcut must fall back to targetRemoteId parent folder for .lrc');

  // 1.3 upgradeSliceToFullAudio 2-layer OneDrive Shared fallback: expired direct -> fresh direct fails CORS/403 -> Graph /drives/{remoteDriveId}/items/{remoteId}/content succeeds
  const fetchAttempts = [];
  const upSandbox = {
    AbortController,
    URL,
    Date,
    Number,
    Object,
    String,
    Boolean,
    Promise,
    Error,
    location: { href: 'https://app.example/' },
    audio: { src: 'blob:https://app/other', paused: false, currentTime: 0 },
    standbyAudio: { src: '' },
    state: { currentId: 'od_shared_1', preloadTrackId: null, objectUrls: new Set() },
    library: {
      fetchAudioBlob: async (url) => {
        fetchAttempts.push(url);
        if (url.includes('old-direct')) {
          const e = new Error('403 expired'); e.status = 403; throw e;
        }
        if (url.includes('fresh-direct-blocked')) {
          const e = new Error('403 CORS blocked'); e.status = 403; throw e;
        }
        if (url.includes('/drives/drv-shared-88/items/item-shared-9/content')) {
          return { size: 4096, type: 'audio/flac' };
        }
        throw new Error('Unexpected URL: ' + url);
      },
      normalizeAudioBlob: (b) => b
    },
    resolveMicrosoftDownloadUrl: async (tr) => {
      tr.downloadUrl = 'https://sharepoint.example/fresh-direct-blocked';
      tr.downloadUrlAt = Date.now();
      return tr.downloadUrl;
    },
    getMicrosoftToken: async () => 'ms-bearer-tok',
    finishCloudMetadataInBackground: () => {},
    releaseTrackUrl: () => {},
    console
  };
  upSandbox.URL = class FakeURL extends URL {
    static createObjectURL() { return 'blob:https://app/full-recovered'; }
  };

  vm.createContext(upSandbox);
  vm.runInContext(html.slice(upStart, upEnd) + '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;', upSandbox);

  const odTrack = {
    id: 'od_shared_1',
    source: 'onedrive',
    remoteId: 'item-shared-9',
    remoteDriveId: 'drv-shared-88',
    name: '01.flac',
    title: 'Track 1',
    format: 'FLAC',
    firstSlicePlayback: true
  };
  const fullUrl = await upSandbox.upgradeSliceToFullAudio(odTrack, 'blob:https://app/slice1', 'https://sharepoint.example/old-direct', {}, 'OneDrive');
  assert.equal(fullUrl, 'blob:https://app/full-recovered', 'upgradeSliceToFullAudio must recover via Graph /drives/{remoteDriveId}/items/{remoteId}/content when freshDirectUrl also fails');
  assert.equal(fetchAttempts.length, 3, 'Must attempt old direct -> fresh direct -> Graph /drives/{remoteDriveId}/content');
});

test('2. MicroSD CUE orphan pruning (edited/deleted CUE restores parent FLAC, allowEmptyPrune) & MainActivity Bit-Perfect multi-channel mask', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lib = require(path.join(ROOT, 'library-utils.js'));

  const cueStart = html.indexOf('function fiioCueHash(');
  const cueEnd = html.indexOf('window.expandFiioScannedCueSheets =', cueStart);
  const pruneStart = html.indexOf('function extractStorageRootPrefix(');
  const pruneEnd = html.indexOf('window.extractStorageRootPrefix =', pruneStart);
  assert.ok(cueStart > 0 && cueEnd > cueStart);
  assert.ok(pruneStart > 0 && pruneEnd > pruneStart);

  const editedCueText = [
    'PERFORMER "Artist"',
    'TITLE "Album"',
    'FILE "Album.flac" WAVE',
    '  TRACK 01 AUDIO',
    '    TITLE "Track 1"',
    '    INDEX 01 00:00:00',
    '  TRACK 02 AUDIO',
    '    TITLE "Track 2"',
    '    INDEX 01 03:00:00'
  ].join('\n');

  const cuePath = '/storage/1234-5678/Music/Album/Album.cue';
  const flacPath = '/storage/1234-5678/Music/Album/Album.flac';

  const sandbox = {
    Map, Set, Array, Number, String, Boolean, Math, Object, JSON,
    library: {
      parseCueSheet: lib.parseCueSheet,
      extractDiscAndTrackFromPath: lib.extractDiscAndTrackFromPath,
      enrichFiioTrackMetadata: () => {},
      createFiioTrack: (f) => ({ id: 'fiio_restored_parent', source: 'local', path: f.path, name: f.name, title: f.name, size: f.size })
    },
    window: {
      NocturneNative: {
        readLocalTextFile: () => editedCueText
      }
    },
    fiioScanUpgradedCount: 0,
    state: {
      currentId: null,
      tracks: [
        { id: 'fiio_parent', source: 'local', path: flacPath, name: 'Album.flac', duration: 600, format: 'FLAC', size: 100000 },
        { id: 'fiio_cue_stale3', source: 'local', isCue: true, cueFilePath: cuePath, cueDedupKey: cuePath + '::cue::3-36000', path: flacPath, title: 'Removed Track 3' },
        { id: 'google_keep', source: 'google', remoteId: 'g1', title: 'Cloud Song' }
      ]
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(cueStart, cueEnd) + '\n' + html.slice(pruneStart, pruneEnd) +
    '\nthis.expandFiioScannedCueSheets = expandFiioScannedCueSheets; this.pruneMissingFiioTracks = pruneMissingFiioTracks;',
    sandbox
  );

  // 2.1 Edited .cue sheet prunes stale Track 3 sub-track while keeping Tracks 1-2
  const added = sandbox.expandFiioScannedCueSheets([{ path: cuePath }]);
  assert.equal(added, 2);
  assert.equal(sandbox.state.tracks.some(t => t.id === 'fiio_cue_stale3'), false, 'Stale sub-track from edited CUE must be pruned');
  assert.equal(sandbox.state.tracks.filter(t => t.isCue).length, 2);

  // 2.2 Deleted .cue sheet prunes CUE sub-tracks AND immediately restores unsplit Album.flac parent on the same scan
  const cueParentMap = new Map([[flacPath, { path: flacPath, name: 'Album.flac', size: 100000 }]]);
  const prunedDelCue = sandbox.pruneMissingFiioTracks(
    new Set([flacPath]),
    new Set(),
    { cueParentFilesByPath: cueParentMap }
  );
  assert.equal(prunedDelCue, 2, 'Both CUE sub-tracks must be pruned when Album.cue is deleted');
  assert.ok(sandbox.state.tracks.some(t => t.id === 'fiio_restored_parent' && !t.isCue && t.path === flacPath), 'Surviving parent Album.flac must be restored immediately when Album.cue is deleted');

  // 2.3 Clean SD unmount with allowEmptyPrune=true removes local fiio_* tracks while preserving Cloud tracks
  const prunedUnmount = sandbox.pruneMissingFiioTracks(new Set(), new Set(), { allowEmptyPrune: true });
  assert.equal(prunedUnmount, 1, 'allowEmptyPrune must remove unmounted FiiO tracks');
  assert.equal(sandbox.state.tracks.length, 1);
  assert.equal(sandbox.state.tracks[0].id, 'google_keep');

  // 2.4 MainActivity.java multi-channel Bit-Perfect channel mask & fallback
  const javaSrc = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
  assert.ok(javaSrc.includes('private static int resolveBitPerfectChannelMask(int channels)'), 'MainActivity must define resolveBitPerfectChannelMask');
  assert.ok(javaSrc.includes('AudioFormat.CHANNEL_OUT_5POINT1') && javaSrc.includes('AudioFormat.CHANNEL_OUT_7POINT1_SURROUND'), 'resolveBitPerfectChannelMask must support 5.1 & 7.1 surround FLAC');
  assert.ok(javaSrc.includes('Unsupported Bit-Perfect channel count'), 'Unsupported channel count must set pendingErrorReason for WebView fallback');
});

test('3. Web FileSystemFileHandle stale cleanup, permission error tagging, empty saved-folder pruning & v3.9.69 version alignment', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const urlStart = html.indexOf('async function ensureLocalTrackPlayableUrl(track, options) {');
  const urlEnd = html.indexOf('function clearStalePreload()', urlStart);
  const reStart = html.indexOf('async function reopenSavedFolderRecord(record, opts) {');
  const reEnd = html.indexOf('async function reopenSavedFolder(options) {', reStart);
  assert.ok(urlStart > 0 && urlEnd > urlStart);
  assert.ok(reStart > 0 && reEnd > reStart);

  const revoked = [];
  const prunedFolders = [];
  let rendered = 0;

  const missingHandle = {
    queryPermission: async () => 'granted',
    getFile: async () => { const e = new Error('Not found'); e.name = 'NotFoundError'; throw e; }
  };
  const deniedHandle = {
    queryPermission: async () => 'prompt',
    requestPermission: async () => 'denied',
    getFile: async () => { throw new Error('Should not read when denied'); }
  };

  const cueSib1 = { id: 'c1', source: 'local', isCue: true, fileHandle: missingHandle, url: 'blob:https://app/dead1' };
  const cueSib2 = { id: 'c2', source: 'local', isCue: true, fileHandle: missingHandle, url: '' };
  const deniedTrack = { id: 'd1', source: 'local', fileHandle: deniedHandle, url: '' };

  const sandbox = {
    Set, String, Boolean,
    URL: { revokeObjectURL: (u) => revoked.push(u) },
    state: { tracks: [cueSib1, cueSib2, deniedTrack], objectUrls: new Set(['blob:https://app/dead1']) },
    restoreLocalTrackUrlSync: () => '',
    collectAudioAndCoverFilesFromDirectoryHandle: async () => [],
    pruneRemovedLocalFolderTracks: (folderKey) => { prunedFolders.push(folderKey); return 3; },
    renderTracks: () => { rendered++; },
    toast: () => {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(urlStart, urlEnd) + '\n' + html.slice(reStart, reEnd) +
    '\nthis.ensureLocalTrackPlayableUrl = ensureLocalTrackPlayableUrl; this.reopenSavedFolderRecord = reopenSavedFolderRecord;',
    sandbox
  );

  // 3.1 NotFoundError clears stale fileHandle across CUE siblings, revokes dead blob URL & tags not_found
  await sandbox.ensureLocalTrackPlayableUrl(cueSib1, { requestPermission: true });
  assert.equal(cueSib1.fileHandle, null);
  assert.equal(cueSib2.fileHandle, null);
  assert.equal(cueSib1._localAccessError, 'not_found');
  assert.equal(cueSib2._localAccessError, 'not_found');
  assert.deepEqual(revoked, ['blob:https://app/dead1']);

  // 3.2 Denied permission tags permission_denied
  await sandbox.ensureLocalTrackPlayableUrl(deniedTrack, { requestPermission: true });
  assert.equal(deniedTrack._localAccessError, 'permission_denied');

  // 3.3 Empty saved folder still prunes deleted tracks and renders
  const emptyRes = await sandbox.reopenSavedFolderRecord({ name: 'MyMusic', handle: { name: 'MyMusic', queryPermission: async () => 'granted' } }, { silentIfGranted: true });
  assert.equal(emptyRes.removed, 3);
  assert.deepEqual(prunedFolders, ['dir:mymusic']);
  assert.equal(rendered, 1);

  // 3.4 Version sync v3.9.69+ / versionCode >= 123
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.69';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.69';"));
  assert.ok(gradle.includes('versionCode = 123'));
  assert.ok(gradle.includes('versionName = "3.9.69"'));
  assert.ok(/FiiO M11S · v3\.9\.(?:69|[7-9]\d|\d{3,})/.test(html));
});
