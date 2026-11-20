'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadLibrary() {
  const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
  const sandbox = {
    window: {},
    globalThis: {},
    navigator: {},
    document: {},
    console,
    setTimeout,
    clearTimeout,
    URL,
    TextDecoder,
    TextEncoder
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.NocturneLibrary;
}

function createMockIndexedDb(initialRecords = {}) {
  const stores = {
    history: new Map(),
    cloudCatalog: new Map(),
    firstSliceCache: new Map(),
    folderHandles: new Map(Object.entries(initialRecords))
  };
  const db = {
    objectStoreNames: { contains: (name) => Object.prototype.hasOwnProperty.call(stores, name) },
    transaction(storeName) {
      const map = stores[storeName];
      return {
        objectStore() {
          return {
            put(val) {
              const req = {};
              queueMicrotask(() => {
                map.set(val.id, val);
                req.result = val.id;
                if (typeof req.onsuccess === 'function') req.onsuccess();
              });
              return req;
            },
            get(key) {
              const req = {};
              queueMicrotask(() => {
                req.result = map.get(key);
                if (typeof req.onsuccess === 'function') req.onsuccess();
              });
              return req;
            },
            delete(key) {
              const req = {};
              queueMicrotask(() => {
                map.delete(key);
                if (typeof req.onsuccess === 'function') req.onsuccess();
              });
              return req;
            }
          };
        }
      };
    }
  };
  return { db, stores };
}

function createFakeEl() {
  const classes = new Set(['hidden']);
  return {
    textContent: '',
    title: '',
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); }
    }
  };
}

test('1. library.scoreFolderCoverFilename ranks folder cover art deterministically and rejects non-images', () => {
  const lib = loadLibrary();
  assert.equal(typeof lib.scoreFolderCoverFilename, 'function');

  assert.equal(lib.scoreFolderCoverFilename('cover.jpg'), 100);
  assert.equal(lib.scoreFolderCoverFilename('FOLDER.PNG'), 95);
  assert.equal(lib.scoreFolderCoverFilename('Front.webp'), 90);
  assert.equal(lib.scoreFolderCoverFilename('AlbumArt.jpg'), 85);
  assert.equal(lib.scoreFolderCoverFilename('Artwork.jpeg'), 80);
  assert.equal(lib.scoreFolderCoverFilename('back_cover_scan.jpg'), 75);
  assert.equal(lib.scoreFolderCoverFilename('random_photo.jpg'), 10);
  assert.equal(lib.scoreFolderCoverFilename('01 - Track.flac'), 0);
  assert.equal(lib.scoreFolderCoverFilename(''), 0);
  assert.equal(lib.scoreFolderCoverFilename(null), 0);

  const ranked = lib.extractFolderArtCandidates([
    { name: 'scan_back.jpg', relativePath: 'Album/scan_back.jpg' },
    { name: 'folder.jpg', relativePath: 'Album/folder.jpg' },
    { name: 'cover.png', relativePath: 'Album/cover.png' },
    { name: '01.flac', relativePath: 'Album/01.flac' }
  ]);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].name, 'cover.png');
  assert.equal(ranked[1].name, 'folder.jpg');
  assert.equal(ranked[2].name, 'scan_back.jpg');
});

test('2. index.html persists FileSystemDirectoryHandle in IndexedDB folderHandles & supports 1-click reopen and NotFoundError cleanup', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.ok(html.includes("const FOLDER_HANDLES_STORE = 'folderHandles';"));
  assert.ok(html.includes('const CLOUD_CATALOG_VERSION = 5;'));
  assert.ok(html.includes("db.createObjectStore(FOLDER_HANDLES_STORE, {keyPath:'id'})"));
  assert.ok(html.includes('id="reopen-folder"'));
  assert.ok(html.includes('id="empty-reopen-folder"'));

  const helperStart = html.indexOf("const RECENT_FOLDER_HANDLE_KEY = 'recent-local-folder';");
  const helperEnd = html.indexOf('async function getCachedFirstSlice(', helperStart);
  assert.ok(helperStart !== -1 && helperEnd > helperStart, 'Folder handle helpers must exist');

  const pickerStart = html.indexOf('async function collectAudioAndCoverFilesFromDirectoryHandle(');
  const pickerEnd = html.indexOf('let googleScriptPromise = null;', pickerStart);
  assert.ok(pickerStart !== -1 && pickerEnd > pickerStart, 'Directory walker and reopenSavedFolder must exist');

  const { db, stores } = createMockIndexedDb();
  const els = {
    'reopen-folder': createFakeEl(),
    'reopen-folder-label': createFakeEl(),
    'empty-reopen-folder': createFakeEl(),
    'folder-input': { click() {} },
    'file-input': { click() {} }
  };
  const addedBatches = [];
  const toasts = [];
  const sampleDirHandle = {
    name: 'HiRes Jazz Collection',
    async queryPermission() { return 'prompt'; },
    async requestPermission() { return 'granted'; },
    async *values() {
      yield {
        kind: 'directory',
        name: 'Miles Davis - Kind of Blue',
        async *values() {
          yield { kind: 'file', name: '01 So What.flac', async getFile() { return { name: '01 So What.flac', size: 100 }; } };
          yield { kind: 'file', name: '01 So What.lrc', async getFile() { return { name: '01 So What.lrc', size: 50 }; } };
          yield { kind: 'file', name: 'cover.jpg', async getFile() { return { name: 'cover.jpg', size: 80 }; } };
          yield { kind: 'file', name: 'notes.txt', async getFile() { return { name: 'notes.txt', size: 10 }; } };
        }
      };
    }
  };

  const sandbox = {
    window: { isNativeAndroid: false, showDirectoryPicker: async () => sampleDirHandle },
    document: { createElement: () => ({ webkitdirectory: true }) },
    $: (id) => els[id] || null,
    AUDIO_TYPES: /\.(flac|wav|alac|m4a|mp3|mp2|ogg|opus|aac|aiff|aif|wma|dsf|dff)$/i,
    STREAM_AUDIO_TYPES: /\.(flac|wav|alac|m4a|mp3|mp2|ogg|opus|aac|aiff|aif|wma)$/i,
    FOLDER_HANDLES_STORE: 'folderHandles',
    openDatabase: async () => db,
    sliceCacheRequest: (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    addLocalFiles: async (files) => { addedBatches.push(files); },
    toast: (msg) => { toasts.push(msg); },
    console,
    Promise
  };
  vm.runInNewContext(
    html.slice(helperStart, helperEnd) + '\n' + html.slice(pickerStart, pickerEnd) +
    '\nwindow.__test = { saveRecentLocalFolderHandle, loadRecentLocalFolderHandle, reopenSavedFolder, restoreSavedLocalFolderOnStartup, pickFolder, updateSavedFolderButtons };',
    sandbox
  );

  // Pick folder stores handle & populates UI buttons
  await sandbox.window.__test.pickFolder();
  assert.equal(stores.folderHandles.size, 1);
  assert.equal(stores.folderHandles.get('recent-local-folder').name, 'HiRes Jazz Collection');
  assert.equal(addedBatches.length, 1);
  assert.equal(addedBatches[0].length, 3);
  assert.equal(addedBatches[0][0].relativePath, 'Miles Davis - Kind of Blue/01 So What.flac');
  assert.equal(els['reopen-folder'].classList.contains('hidden'), false);
  assert.equal(els['reopen-folder-label'].textContent, 'Mở lại: HiRes Jazz Collection');

  // Silent startup skips when queryPermission === 'prompt'
  await sandbox.window.__test.restoreSavedLocalFolderOnStartup();
  assert.equal(addedBatches.length, 1, 'Silent startup must NOT trigger interactive permission prompt');

  // Explicit 1-click reopen requests permission and reloads folder
  const ok = await sandbox.window.__test.reopenSavedFolder({ silentIfGranted: false });
  assert.equal(ok, true);
  assert.equal(addedBatches.length, 2);

  // When directory no longer exists on disk (NotFoundError), clears stale handle and hides buttons
  sampleDirHandle.queryPermission = async () => 'granted';
  sampleDirHandle.values = async function* () {
    const err = new Error('Directory gone');
    err.name = 'NotFoundError';
    throw err;
  };
  const okAfterDelete = await sandbox.window.__test.reopenSavedFolder({ silentIfGranted: false });
  assert.equal(okAfterDelete, false);
  assert.equal(stores.folderHandles.size, 0, 'NotFoundError must purge missing handle from IndexedDB');
  assert.equal(els['reopen-folder'].classList.contains('hidden'), true);
  assert.equal(els['empty-reopen-folder'].classList.contains('hidden'), true);
});

test('3. Google Drive sibling cover art discovery preserves parents & GOOGLE_DRIVE_CANDIDATE_QUERY and applies folder artwork once per folder', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lib = loadLibrary();

  assert.ok(html.includes('"not mimeType contains \'image/\'"'), 'GOOGLE_DRIVE_CANDIDATE_QUERY must still exclude images during fast track scan');

  const cloudTrackStart = html.indexOf('const serializableCloudTrack = track => ({');
  const cloudTrackEnd = html.indexOf('function mergeMicrosoftTrack(', cloudTrackStart);
  const gStart = html.indexOf('const checkedGoogleArtParents = new Set();');
  const gEnd = html.indexOf('async function loadGoogleFiles() {', gStart);
  assert.ok(cloudTrackStart !== -1 && cloudTrackEnd > cloudTrackStart);
  assert.ok(gStart !== -1 && gEnd > gStart);

  const syncedCovers = [];
  const broadcasts = [];
  const persisted = [];
  const driveCalls = [];

  const sandbox = {
    window: {},
    library: lib,
    state: { tracks: [], albumCovers: new Map() },
    trackMetadataRevision: 0,
    isDsdFormat: (f) => ['DSF', 'DFF'].includes(String(f || '').toUpperCase()),
    audioFormat: () => 'FLAC',
    filenameMetadata: () => ({ title: 'Track', artist: 'Artist', album: 'Album' }),
    coverForCatalog: (c) => c || null,
    loadGoogleAudio: () => {},
    loadMicrosoftAudio: () => {},
    ensureGoogleToken: async () => 'goog-token-1',
    fetchGoogleDrivePageWithRetry: async (url) => {
      driveCalls.push(url);
      return {
        ok: true,
        async json() {
          return {
            files: [
              { id: 'img-back', name: 'back.jpg', parents: ['folderA'], thumbnailLink: 'https://lh3.googleusercontent.com/back=s220' },
              { id: 'img-cover', name: 'Cover.JPG', parents: ['folderA'], thumbnailLink: 'https://lh3.googleusercontent.com/cover=s220' },
              { id: 'img-2', name: 'front.png', parents: ['folderB'], thumbnailLink: '' }
            ]
          };
        }
      };
    },
    fetch: async (url) => {
      if (url.includes('lh3.googleusercontent.com/cover=s512')) {
        return { ok: true, async blob() { return { size: 123, type: 'image/jpeg', _url: url }; } };
      }
      if (url.includes('/files/img-2?alt=media')) {
        return { ok: true, async blob() { return { size: 456, type: 'image/png', _url: url }; } };
      }
      return { ok: false, status: 404 };
    },
    cloudImageDataUrl: async (blob) => 'data:' + blob.type + ';base64,MOCK_' + encodeURIComponent(blob._url),
    normalizeCoverImage: async (u) => u,
    syncAlbumCoversImmediate: (cover, tr) => syncedCovers.push({ id: tr.id, cover }),
    broadcastCoverUpdate: (aKey, cover, ids) => broadcasts.push({ aKey, cover, ids }),
    propagateAndBroadcastCovers: () => {},
    scheduleTrackRender: () => {},
    persistCloudCatalog: async (tracks) => persisted.push(tracks),
    URLSearchParams,
    Map,
    Set,
    Array,
    Promise,
    console
  };

  vm.runInNewContext(
    html.slice(cloudTrackStart, cloudTrackEnd) + '\n' + html.slice(gStart, gEnd) +
    '\nwindow.__test = { googleTrack, serializableCloudTrack, discoverGoogleDriveFolderArtwork };',
    sandbox
  );

  const g1 = sandbox.window.__test.googleTrack({ id: 't1', name: '01.dsf', size: 1000, parents: ['folderA'] });
  const g2 = sandbox.window.__test.googleTrack({ id: 't2', name: '02.flac', size: 2000, parents: ['folderA'] });
  const g3 = sandbox.window.__test.googleTrack({ id: 't3', name: '03.wav', size: 3000, parents: ['folderB'] });
  const gExisting = sandbox.window.__test.googleTrack({ id: 't4', name: '04.flac', size: 1500, parents: ['folderA'] });
  gExisting.cover = 'data:image/jpeg;base64,EXISTING';

  assert.deepEqual(g1.parents, ['folderA']);
  assert.deepEqual(sandbox.window.__test.serializableCloudTrack(g1).parents, ['folderA']);

  const count = await sandbox.window.__test.discoverGoogleDriveFolderArtwork([g1, g2, g3, gExisting]);
  assert.equal(count, 3, 'Must assign folder artwork to all 3 coverless Drive tracks across both folders');
  assert.equal(driveCalls.length, 1, 'Should batch both parent IDs into a single Drive API query');
  assert.ok(decodeURIComponent(g1.cover).includes('lh3.googleusercontent.com/cover=s512'), 'Cover.JPG must outrank back.jpg and upgrade thumbnailLink to =s512');
  assert.equal(g2.cover, g1.cover);
  assert.ok(decodeURIComponent(g3.cover).includes('img-2?alt=media'), 'Must fall back to Drive alt=media with Bearer token when thumbnailLink is empty');
  assert.equal(gExisting.cover, 'data:image/jpeg;base64,EXISTING', 'Must never overwrite an existing embedded cover');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].length, 3);
});

test('4. OneDrive loadMicrosoftFiles collects sibling cover images per folder path and applies them in background', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lib = loadLibrary();

  const sharedStart = html.indexOf('async function fetchCloudImageCandidateDataUrl(');
  const sharedEnd = html.indexOf('async function discoverGoogleDriveFolderArtwork(', sharedStart);
  const msStart = html.indexOf('async function applyMicrosoftSiblingFolderCovers(');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  assert.ok(sharedStart !== -1 && sharedEnd > sharedStart);
  assert.ok(msStart !== -1 && msEnd > msStart);

  const msSrc = html.slice(msStart, msEnd);
  assert.ok(msSrc.includes('siblingCoversByDir'), 'loadMicrosoftFiles must collect siblingCoversByDir during folder traversal');
  assert.ok(msSrc.includes('applyMicrosoftSiblingFolderCovers(siblingCoversByDir)'), 'loadMicrosoftFiles finally must apply sibling covers');

  const track1 = { id: 'onedrive:1', remoteId: '1', remotePath: 'Music/Miles/01.dsf', source: 'onedrive', album: 'Miles', artist: 'Miles', cover: '' };
  const track2 = { id: 'onedrive:2', remoteId: '2', remotePath: 'Music/Miles/02.dsf', source: 'onedrive', album: 'Miles', artist: 'Miles', cover: '♫' };
  const trackOther = { id: 'onedrive:3', remoteId: '3', remotePath: 'Music/Other/01.flac', source: 'onedrive', album: 'Other', artist: 'Other', cover: '' };
  const persisted = [];

  const sandbox = {
    window: {},
    library: lib,
    state: { tracks: [track1, track2, trackOther], albumCovers: new Map(), microsoftAccessToken: 'ms-tok' },
    trackMetadataRevision: 0,
    fetch: async (url) => ({ ok: true, async blob() { return { size: 321, type: 'image/jpeg', _url: url }; } }),
    cloudImageDataUrl: async (blob) => 'data:image/jpeg;base64,MS_' + encodeURIComponent(blob._url),
    normalizeCoverImage: async (u) => u,
    graphGet: async () => ({ value: [] }),
    getMicrosoftToken: async () => 'ms-tok',
    syncAlbumCoversImmediate: () => {},
    broadcastCoverUpdate: () => {},
    propagateAndBroadcastCovers: () => {},
    scheduleTrackRender: () => {},
    persistCloudCatalog: async (tracks) => persisted.push(tracks),
    Map,
    Array,
    Promise,
    console
  };

  vm.runInNewContext(
    html.slice(sharedStart, sharedEnd) + '\n' + html.slice(msStart, msStart + msSrc.indexOf('async function loadMicrosoftFiles(')) +
    '\nwindow.__test = { applyMicrosoftSiblingFolderCovers };',
    sandbox
  );

  const siblingMap = new Map([
    ['Music/Miles', { id: 'cov1', name: 'folder.jpg', score: 95, downloadUrl: 'https://onedrive.live.com/download/folder-jpg' }]
  ]);
  const updated = await sandbox.window.__test.applyMicrosoftSiblingFolderCovers(siblingMap);
  assert.equal(updated, 2);
  assert.ok(track1.cover.includes('folder-jpg'));
  assert.equal(track2.cover, track1.cover);
  assert.equal(trackOther.cover, '');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].length, 2);
});

test('5. Version v3.9.33 / versionCode 87 sync & zero Chromium 74 ES2020+ syntax regressions', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.33'), 'index.html must display FiiO M11S · v3.9.33');
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.33';"), 'sw.js CACHE_VERSION must be v3.9.33');
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.33';"), 'sw.js CACHE_NAME must be nocturne-v3.9.33');
  assert.ok(gradle.includes('versionCode = 87'), 'build.gradle.kts versionCode must be 87');
  assert.ok(gradle.includes('versionName = "3.9.33"'), 'build.gradle.kts versionName must be 3.9.33');
  assert.ok(mainActivity.includes('"3.9.33"'), 'MainActivity.java build info fallback must be 3.9.33');

  const filesToScan = [
    'index.html',
    'library-utils.js',
    'metadata-utils.js',
    'cloud-metadata.js',
    'sw.js',
    'autoeq-cue.js',
    'dsd-worker.js',
    'library-tools.js',
    'lrclib-client.js',
    'lyrics-editor-ui.js',
    'lyrics-utils.js',
    'metadata-ui.js',
    'ui-overlay.js',
    'virtual-scroll.js'
  ];

  for (const rel of filesToScan) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Strip JS line comments & block comments for clean syntax check on executable tokens
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.ok(!/[^\w$]\?\.\w|\?\.\[|\?\.\(/.test(stripped), `${rel} must not contain optional chaining (?.)`);
    assert.ok(!/\?\?[^=]/.test(stripped), `${rel} must not contain nullish coalescing (??)`);
    assert.ok(!/\.replaceAll\s*\(/.test(stripped), `${rel} must not use ES2021 .replaceAll()`);
    assert.ok(!/\bcatch\s*\{/.test(stripped), `${rel} must not use ES2019 optional catch binding (catch {})`);
  }
});
