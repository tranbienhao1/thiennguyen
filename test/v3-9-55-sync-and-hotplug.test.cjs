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
const mainActivity = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'),
  'utf8'
);
const library = require(path.join(ROOT, 'library-utils.js'));

function extractFn(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Could not find marker: ${startMarker}`);
  let braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && (inSingle || inDouble || inBacktick)) { escaped = true; continue; }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '`') { inBacktick = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          let end = i + 1;
          if (source[end] === ';') end++;
          return source.slice(start, end);
        }
      }
    } else if (inSingle && ch === "'") inSingle = false;
    else if (inDouble && ch === '"') inDouble = false;
    else if (inBacktick && ch === '`') inBacktick = false;
  }
  throw new Error(`Unbalanced braces for marker: ${startMarker}`);
}

test('v3.9.55: library-utils extracts disc/track from OneDrive remotePath and inherits multi-disc parent covers', () => {
  const parsed = library.extractDiscAndTrackFromPath({
    remotePath: 'Music/Pink Floyd/The Wall/Disc 2/03 - Hey You.flac',
    name: '03 - Hey You.flac'
  });
  assert.equal(parsed.discNumber, 2);
  assert.equal(parsed.trackNumber, 3);

  const sorted = library.sortAlbumTracks([
    { id: 'd2t1', remotePath: 'Album/CD 2/01 - Opening D2.flac', name: '01 - Opening D2.flac' },
    { id: 'd1t2', remotePath: 'Album/CD 1/02 - Second D1.flac', name: '02 - Second D1.flac' },
    { id: 'd1t1', remotePath: 'Album/CD 1/01 - First D1.flac', name: '01 - First D1.flac' }
  ]);
  assert.deepEqual(sorted.map(t => t.id), ['d1t1', 'd1t2', 'd2t1']);

  const covers = new Map([
    ['Music/AlbumA', 'cover-album-a'],
    ['Music/AlbumB/Disc 1', 'cover-album-b-d1']
  ]);
  assert.equal(library.resolveFolderCoverWithDiscFallback(covers, 'Music/AlbumA/Disc 2'), 'cover-album-a');
  assert.equal(library.resolveFolderCoverWithDiscFallback(covers, 'Music/AlbumB/Disc 1'), 'cover-album-b-d1');
  assert.equal(library.resolveFolderCoverWithDiscFallback(covers, 'Music/AlbumA/UnrelatedSubfolder'), null);

  assert.equal(library.isSkippableLocalDirectoryName('.git'), true);
  assert.equal(library.isSkippableLocalDirectoryName('$RECYCLE.BIN'), true);
  assert.equal(library.isSkippableLocalDirectoryName('System Volume Information'), true);
  assert.equal(library.isSkippableLocalDirectoryName('@eaDir'), true);
  assert.equal(library.isSkippableLocalDirectoryName('__MACOSX'), true);
  assert.equal(library.isSkippableLocalDirectoryName('.thumbnails'), true);
  assert.equal(library.isSkippableLocalDirectoryName('Disc 1'), false);
  assert.equal(library.isSkippableLocalDirectoryName('Hi-Res FLAC'), false);
});

test('v3.9.55: collectAudioAndCoverFilesFromDirectoryHandle skips system dirs and survives unreadable files', async () => {
  const fnSrc = extractFn(html, 'async function collectAudioAndCoverFilesFromDirectoryHandle(dirHandle)');
  const sandbox = {
    library,
    AUDIO_TYPES: /\.(flac|wav|mp3|m4a|dsf|dff)$/i,
    STREAM_AUDIO_TYPES: /\.(flac|wav|mp3|m4a)$/i,
    console: { debug: () => {}, warn: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);

  const makeFileEntry = (name, fail) => ({
    kind: 'file',
    name,
    async getFile() {
      if (fail) throw new Error('EACCES');
      return { name, size: 1024 };
    }
  });
  const makeDirEntry = (name, entries, failIter) => ({
    kind: 'directory',
    name,
    values() {
      if (failIter) throw new Error('NotAllowedError');
      return (async function* () {
        for (const e of entries) yield e;
      })();
    }
  });

  const root = makeDirEntry('Music', [
    makeDirEntry('.git', [makeFileEntry('should-skip.flac', false)]),
    makeDirEntry('$RECYCLE.BIN', [makeFileEntry('trashed.flac', false)]),
    makeDirEntry('LockedSubdir', [], true),
    makeFileEntry('corrupt-locked.flac', true),
    makeDirEntry('Album', [
      makeFileEntry('cover.jpg', false),
      makeDirEntry('Disc 1', [makeFileEntry('01 - Track.flac', false)])
    ])
  ]);

  const files = await sandbox.collectAudioAndCoverFilesFromDirectoryHandle(root);
  const paths = Array.from(files, f => f.relativePath);
  assert.deepEqual(paths, ['Album/cover.jpg', 'Album/Disc 1/01 - Track.flac']);
});

test('v3.9.55: addLocalFiles inherits multi-disc parent covers and prunes deleted tracks safely', async () => {
  const helperSrc = extractFn(html, 'function lookupLocalFolderCover(folderCoverByDir, dir)');
  const pruneSrc = extractFn(html, 'function pruneRemovedLocalFolderTracks(folderRootKey, seenFolderTrackKeys)');
  const fnSrc = extractFn(html, 'async function addLocalFiles(files) {');
  const revokedUrls = [];
  let urlSeq = 0;
  const state = {
    tracks: [
      {
        id: 'playing-track',
        source: 'local',
        name: '01 - KeepPlaying.flac',
        relativePath: 'Album/Disc 1/01 - KeepPlaying.flac',
        size: 100,
        localFolderKey: 'dir:music',
        url: 'blob:playing'
      },
      {
        id: 'deleted-track',
        source: 'local',
        name: '02 - DeletedOnDisk.flac',
        relativePath: 'Album/Disc 1/02 - DeletedOnDisk.flac',
        size: 200,
        localFolderKey: 'dir:music',
        url: 'blob:deleted'
      },
      {
        id: 'other-folder-track',
        source: 'local',
        name: '01 - OtherRoot.flac',
        relativePath: 'Other/01 - OtherRoot.flac',
        size: 300,
        localFolderKey: 'dir:other',
        url: 'blob:other'
      }
    ],
    currentId: 'playing-track',
    objectUrls: new Set(['blob:playing', 'blob:deleted', 'blob:other']),
    albumCovers: new Map()
  };

  const sandbox = {
    library,
    state,
    AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
    STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
    localFileKey: file => `${file.relativePath || file.webkitRelativePath || file.name}-${file.size}`,
    URL: {
      createObjectURL: () => `blob:gen-${++urlSeq}`,
      revokeObjectURL: u => revokedUrls.push(u)
    },
    makeLocalTrack: async file => ({
      id: `new-${file.name}`,
      source: 'local',
      name: file.name,
      title: file.name,
      artist: 'Artist',
      album: 'Album',
      size: file.size,
      url: `blob:audio-${++urlSeq}`,
      cover: ''
    }),
    restoreLocalTrackUrlSync: () => {},
    syncAlbumCoversImmediate: () => {},
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => {},
    toast: () => {},
    console: { warn: () => {}, debug: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${helperSrc}\n${pruneSrc}\n${fnSrc}`, sandbox);

  const files = [
    { name: 'cover.jpg', relativePath: 'AlbumA/cover.jpg', size: 500 },
    { name: 'cover.jpg', relativePath: 'AlbumB/cover.jpg', size: 600 },
    { name: '01 - Disc2Song.flac', relativePath: 'AlbumA/Disc 2/01 - Disc2Song.flac', size: 400 }
  ];

  const res = await sandbox.addLocalFiles(files, { folderRootKey: 'dir:music', pruneMissing: true });
  assert.equal(res.added, 1);
  assert.equal(res.removed, 1);

  const ids = state.tracks.map(t => t.id);
  assert.equal(ids.includes('playing-track'), true, 'currently playing track must never be pruned');
  assert.equal(ids.includes('deleted-track'), false, 'deleted track from rescanned folder must be pruned');
  assert.equal(ids.includes('other-folder-track'), true, 'tracks from other folder roots must not be touched');
  assert.deepEqual(revokedUrls, ['blob:deleted']);

  const addedTrack = state.tracks.find(t => t.name === '01 - Disc2Song.flac');
  assert.ok(addedTrack);
  assert.equal(addedTrack.cover, 'blob:gen-1', 'Disc 2 track must inherit parent AlbumA/cover.jpg even with multiple albums');
  assert.equal(addedTrack.localFolderKey, 'dir:music');
});

test('v3.9.55: googleTrack, microsoftTrack, mergeMicrosoftTrack and applyMicrosoftSiblingFolderCovers handle multi-disc & covers', async () => {
  const normSrc = extractFn(html, 'function normalizeMicrosoftDriveItem(rawItem, inheritedDriveId)');
  const googleSrc = extractFn(html, 'const googleTrack = file =>');
  const msSrc = extractFn(html, 'const microsoftTrack = (rawItem, remotePath = \'\', existing = null) =>');
  const mergeSrc = extractFn(html, 'function mergeMicrosoftTrack(track, item, remotePath = \'\')');
  const coverSrc = extractFn(html, 'async function applyMicrosoftSiblingFolderCovers(siblingCoversByDir)');

  const fetchedCovers = [];
  const state = { tracks: [], microsoftAccessToken: 'tok' };
  const sandbox = {
    library,
    state,
    audioFormat: () => 'FLAC',
    filenameMetadata: name => ({ title: name, artist: 'Unknown Artist', album: 'Unknown Album' }),
    isDsdFormat: () => false,
    loadGoogleAudio: () => {},
    loadMicrosoftAudio: () => {},
    trackMetadataRevision: 0,
    fetchCloudImageCandidateDataUrl: async (thumbUrl) => {
      fetchedCovers.push(thumbUrl);
      return 'data:image/jpeg;base64,abc';
    },
    applyDiscoveredCloudFolderCover: (tracks, cover) => {
      tracks.forEach(t => { t.cover = cover; });
      return tracks;
    },
    propagateAndBroadcastCovers: () => {},
    scheduleTrackRender: () => {},
    persistCloudCatalog: async () => {},
    console: { warn: () => {}, debug: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${normSrc}\n${googleSrc}\n${msSrc}\n${mergeSrc}\n${coverSrc}\nthis.googleTrack = googleTrack; this.microsoftTrack = microsoftTrack;`, sandbox);

  const gTrack = sandbox.googleTrack({ id: 'g1', name: '2-04 - Time.flac', size: 1234 });
  assert.equal(gTrack.discNumber, 2);
  assert.equal(gTrack.trackNumber, 4);

  const msFromGraph = sandbox.microsoftTrack(
    { id: 'm1', name: 'Song.m4a', size: 5000, audio: { title: 'Echoes', artist: 'Pink Floyd', album: 'Meddle', disc: 2, track: 6, duration: 120000 } },
    'Music/Pink Floyd/Meddle/Song.m4a'
  );
  assert.equal(msFromGraph.discNumber, 2);
  assert.equal(msFromGraph.trackNumber, 6);

  const msFromPath = sandbox.microsoftTrack(
    { id: 'm2', name: '05 - Comfortably Numb.flac', size: 9000 },
    'Music/Pink Floyd/The Wall/Disc 2/05 - Comfortably Numb.flac'
  );
  assert.equal(msFromPath.discNumber, 2);
  assert.equal(msFromPath.trackNumber, 5);

  const msDisc1 = sandbox.microsoftTrack(
    { id: 'm3', name: '01 - In The Flesh.flac', size: 8000 },
    'Music/Pink Floyd/The Wall/Disc 1/01 - In The Flesh.flac'
  );
  state.tracks.push(msDisc1, msFromPath);

  const siblingCoversByDir = new Map([
    ['Music/Pink Floyd/The Wall', { id: 'cov1', name: 'folder.jpg', score: 100, downloadUrl: 'https://cdn.example/wall-cover.jpg', driveId: '' }]
  ]);
  const applied = await sandbox.applyMicrosoftSiblingFolderCovers(siblingCoversByDir);
  assert.equal(applied, 2);
  assert.equal(msDisc1.cover, 'data:image/jpeg;base64,abc');
  assert.equal(msFromPath.cover, 'data:image/jpeg;base64,abc');
  assert.equal(fetchedCovers.length, 1, 'Disc 1 and Disc 2 sharing parent cover.jpg must fetch image only once');
});

test('v3.9.55: Android storage hot-plug debounces bursts and queues rescans while scan is active', () => {
  const schedSrc = extractFn(html, 'function scheduleFiioHotplugScan(reason, delayMs)');
  const flushSrc = extractFn(html, 'function flushPendingFiioHotplugRescan()');
  const handlerStart = html.indexOf('window.onAndroidStorageStateChanged = function (reason)');
  assert.notEqual(handlerStart, -1);
  const handlerSrc = extractFn(html.slice(handlerStart), 'window.onAndroidStorageStateChanged = function (reason)');

  const scanCalls = [];
  const timers = [];
  const sandbox = {
    window: {},
    fiioScanInProgress: false,
    lastFiioStorageSyncAt: 0,
    fiioStorageHotplugTimer: null,
    pendingFiioHotplugReason: null,
    readFiioStorageLinkInfo: () => ({ hasPermission: true, linked: true, count: 5 }),
    updateFiioStorageLinkUi: () => {},
    getFiioTrackCount: () => 5,
    scanFiioStorage: opts => scanCalls.push(opts),
    setTimeout: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: id => {
      const t = timers.find(item => item.id === id);
      if (t) t.cleared = true;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${schedSrc}\n${flushSrc}\n${handlerSrc}`, sandbox);

  // Rapid mounted burst collapses into 1 debounced scan
  sandbox.window.onAndroidStorageStateChanged('mounted');
  sandbox.window.onAndroidStorageStateChanged('mounted');
  const activeTimers1 = timers.filter(t => !t.cleared);
  assert.equal(activeTimers1.length, 1);
  activeTimers1[0].fn();
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0].allowEmptyPrune, false);

  // Unmount arriving mid-scan queues follow-up scan with allowEmptyPrune: true
  sandbox.fiioScanInProgress = true;
  sandbox.window.onAndroidStorageStateChanged('unmounted');
  assert.equal(sandbox.pendingFiioHotplugReason, 'unmounted');
  sandbox.fiioScanInProgress = false;
  sandbox.flushPendingFiioHotplugRescan();
  const activeTimers2 = timers.filter(t => !t.cleared).slice(-1);
  assert.equal(activeTimers2.length, 1);
  activeTimers2[0].fn();
  assert.equal(scanCalls.length, 2);
  assert.equal(scanCalls[1].allowEmptyPrune, true);
});

test('v3.9.55: MainActivity storage receiver handles unmount broadcasts and Android 13+ RECEIVER_EXPORTED', () => {
  assert.match(mainActivity, /Intent\.ACTION_MEDIA_UNMOUNTED/);
  assert.match(mainActivity, /Intent\.ACTION_MEDIA_EJECT/);
  assert.match(mainActivity, /Intent\.ACTION_MEDIA_REMOVED/);
  assert.match(mainActivity, /Intent\.ACTION_MEDIA_BAD_REMOVAL/);
  assert.match(mainActivity, /registerReceiver\(mStorageMountReceiver,\s*filter,\s*Context\.RECEIVER_EXPORTED\)/);
});

test('v3.9.55+: monotonic version alignment across web, service worker, and Android Gradle', () => {
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[5-9]|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[5-9]|[6-9]\d|\d{3,})';/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[5-9]|[6-9]\d|\d{3,})/);
  const codeMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 109, 'versionCode must be >= 109');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[5-9]|[6-9]\d|\d{3,})"/);
});
