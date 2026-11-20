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

test('1. primaryArtistName strips featured/guest collaborators (Vietnamese & international) while preserving hyphen/acronym band names', () => {
  const lib = loadLibrary();
  assert.equal(typeof lib.primaryArtistName, 'function');

  assert.equal(lib.primaryArtistName('Đen Vâu ft.Min'), 'Đen Vâu');
  assert.equal(lib.primaryArtistName('Sơn Tùng feat. Snoop Dogg'), 'Sơn Tùng');
  assert.equal(lib.primaryArtistName('HIEUTHUHAI X Negav'), 'HIEUTHUHAI');
  assert.equal(lib.primaryArtistName('Sơn Tùng M-TP / Onionn'), 'Sơn Tùng M-TP');
  assert.equal(lib.primaryArtistName('Miles Davis/John Coltrane'), 'Miles Davis');
  assert.equal(lib.primaryArtistName('Lệ Quyên - Quang Lê'), 'Lệ Quyên');
  assert.equal(lib.primaryArtistName('Hà Anh Tuấn cùng Phương Linh'), 'Hà Anh Tuấn');
  assert.equal(lib.primaryArtistName('Mỹ Tâm cùng với Phan Mạnh Quỳnh'), 'Mỹ Tâm');
  assert.equal(lib.primaryArtistName('Bằng Kiều · Minh Tuyết'), 'Bằng Kiều');
  assert.equal(lib.primaryArtistName('Adele (with Sam Smith)'), 'Adele');
  assert.equal(lib.primaryArtistName('Vũ. [feat. Hà Anh Tuấn]'), 'Vũ.');
  assert.equal(lib.primaryArtistName('Bùi Anh Tuấn、Hiền Hồ'), 'Bùi Anh Tuấn');
  assert.equal(lib.primaryArtistName('Karik hợp tác cùng OnlyC'), 'Karik');

  // Preserve legitimate acronyms & hyphenated artist names
  assert.equal(lib.primaryArtistName('AC/DC'), 'AC/DC');
  assert.equal(lib.primaryArtistName('Sơn Tùng M-TP'), 'Sơn Tùng M-TP');
  assert.equal(lib.primaryArtistName('Jay-Z'), 'Jay-Z');
});

test('2. buildLibraryCollections consolidates albumArtist, majority folder album owner, and Various Artists compilations cleanly', () => {
  const lib = loadLibrary();
  assert.equal(typeof lib.buildLibraryCollections, 'function');

  // Case A: Explicit albumArtist keeps 1 Album & 1 Artist even across guest-heavy tracks
  const daftTracks = [
    { id: 'd1', title: 'Give Life Back to Music', artist: 'Daft Punk feat. Nile Rodgers', album: 'Random Access Memories', albumArtist: 'Daft Punk' },
    { id: 'd2', title: 'Giorgio by Moroder', artist: 'Giorgio Moroder', album: 'Random Access Memories', albumArtist: 'Daft Punk' },
    { id: 'd3', title: 'Get Lucky', artist: 'Daft Punk ft. Pharrell Williams & Nile Rodgers', album: 'Random Access Memories', albumArtist: 'Daft Punk' },
    { id: 'd4', title: 'Instant Crush', artist: 'Julian Casablancas', album: 'Random Access Memories', albumArtist: 'Daft Punk' }
  ];
  const daftCol = lib.buildLibraryCollections(daftTracks);
  assert.equal(daftCol.albums.size, 1, 'Explicit albumArtist album must stay 1 album card');
  assert.equal(daftCol.artists.size, 1, 'Guest singers must NOT spawn extra top-level artist cards');
  assert.equal([...daftCol.artists.values()][0].name, 'Daft Punk');
  assert.equal(lib.buildFiioCoverUrl({ path: '/sd/1.flac', ...daftTracks[0] }), lib.buildFiioCoverUrl({ path: '/sd/1.flac', ...daftTracks[1] }).replace(/1\.flac/g, '1.flac'));

  // Verify shared album key for /local-cover regardless of guest artist
  const covUrl1 = lib.buildFiioCoverUrl({ path: '/sd/a.flac', album: 'Random Access Memories', artist: 'Giorgio Moroder', albumArtist: 'Daft Punk' });
  const covUrl2 = lib.buildFiioCoverUrl({ path: '/sd/b.flac', album: 'Random Access Memories', artist: 'Julian Casablancas', albumArtist: 'Daft Punk' });
  assert.ok(covUrl1.includes('key=random%20access%20memories%7Cdaft%20punk'));
  assert.ok(covUrl2.includes('key=random%20access%20memories%7Cdaft%20punk'));

  // Case B: Album folder without albumArtist consolidates minor guest tracks under majority singer
  const folderAlbumTracks = [
    { id: 'f1', title: 'Track 1', artist: 'Mỹ Tâm', album: 'Tâm 9', path: '/storage/SD/Music/Mỹ Tâm/Tâm 9/01.flac' },
    { id: 'f2', title: 'Track 2', artist: 'Mỹ Tâm feat. Phan Mạnh Quỳnh', album: 'Tâm 9', path: '/storage/SD/Music/Mỹ Tâm/Tâm 9/02.flac' },
    { id: 'f3', title: 'Track 3', artist: 'Mỹ Tâm', album: 'Tâm 9', path: '/storage/SD/Music/Mỹ Tâm/Tâm 9/CD 1/03.flac' },
    { id: 'f4', title: 'Track 4', artist: 'Khắc Hưng', album: 'Tâm 9', path: '/storage/SD/Music/Mỹ Tâm/Tâm 9/04.flac' }
  ];
  const myTamCol = lib.buildLibraryCollections(folderAlbumTracks);
  assert.equal(myTamCol.albums.size, 1, 'Majority folder album + CD subfolder must merge into 1 album');
  assert.equal(myTamCol.artists.size, 1, 'Guest composer/singer track in album folder must not split artist view');
  assert.equal([...myTamCol.albums.values()][0].artist, 'Mỹ Tâm');

  // Case C: Multi-artist compilation folder consolidates into 1 Various Artists album
  const compTracks = [
    { id: 'c1', title: 'A', artist: 'Lệ Quyên', album: 'Tuyển Tập Bolero', path: '/storage/SD/Bolero/01.flac' },
    { id: 'c2', title: 'B', artist: 'Quang Lê', album: 'Tuyển Tập Bolero', path: '/storage/SD/Bolero/02.flac' },
    { id: 'c3', title: 'C', artist: 'Quang Dũng', album: 'Tuyển Tập Bolero', path: '/storage/SD/Bolero/03.flac' },
    { id: 'c4', title: 'D', artist: 'Như Quỳnh', album: 'Tuyển Tập Bolero', path: '/storage/SD/Bolero/04.flac' }
  ];
  const compCol = lib.buildLibraryCollections(compTracks);
  assert.equal(compCol.albums.size, 1, 'Multi-singer compilation folder must fold into 1 album card');
  assert.equal([...compCol.albums.values()][0].artist, 'Various Artists');

  // Case D: Unrelated homonym albums without folder or albumArtist stay separate
  const sameNameDifferentArtists = [
    { id: 'u1', title: 'Hello', artist: 'Adele', album: '25' },
    { id: 'u2', title: 'Song', artist: 'Other', album: '25' }
  ];
  const homonymCol = lib.buildLibraryCollections(sameNameDifferentArtists);
  assert.equal(homonymCol.albums.size, 2);
});

test('3. MainActivity.java exposes persistent FiiO storage bridge, MicroSD remount receiver, and safe album_artist MediaStore projection', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('public boolean saveFiioCatalogNative(String catalogJson)'), 'Must expose native catalog backup');
  assert.ok(java.includes('public String loadFiioCatalogNative()'), 'Must expose native catalog restore');
  assert.ok(java.includes('public String getFiioStorageLinkStateJson()'), 'Must expose persistent storage link state getter');
  assert.ok(java.includes('public boolean setFiioStorageLinkState('), 'Must expose persistent storage link state setter');
  assert.ok(java.includes('PREF_FIIO_STORAGE_LINKED'), 'Must persist storage link flag in SharedPreferences');
  assert.ok(java.includes('Intent.ACTION_MEDIA_MOUNTED'), 'Must listen for MicroSD mount events');
  assert.ok(java.includes("window.onAndroidStorageStateChanged('mounted')"), 'Must notify WebView on storage mount');
  assert.ok(java.includes("window.onAndroidStorageStateChanged('resume')"), 'Must notify WebView on resume');
  assert.ok(java.includes('"album_artist"') && java.includes('obj.put("albumArtist"'), 'MediaStore scan must safely extract album_artist');
});

test('4. index.html persists FiiO catalog & storage link cleanly across WebView clear and auto-reconnects even alongside Cloud tracks', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lib = loadLibrary();

  const fiioStart = html.indexOf('function compactFiioTrackForStorage(t, ultraLean)');
  const fiioEnd = html.indexOf('function setupFiioIntegration()', fiioStart);
  assert.ok(fiioStart !== -1 && fiioEnd > fiioStart, 'FiiO catalog & storage link block must exist');

  const statusEl = {
    textContent: '',
    classes: new Set(['hidden']),
    classList: {
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  };
  statusEl.classList.classes = statusEl.classes;
  const headerBtn = { title: '' };

  let nativeSavedJson = '';
  let linkState = { linked: true, hasPermission: true, linkedRoots: ['/storage/AAAA-1111/Music'], lastTrackCount: 2, lastScanTs: 12345 };
  const lsStore = {};
  let nativeScanCalls = 0;

  const sampleSaved = [
    { id: 'fiio_1', title: 'Track 1', path: '/storage/AAAA-1111/Music/Artist/Album/01.flac', artist: 'Artist ft. Guest', album: 'Album', albumArtist: 'Artist' },
    { id: 'fiio_2', title: 'Track 2', path: '/storage/AAAA-1111/Music/Artist/Album/02.flac', artist: 'Artist', album: 'Album', albumArtist: 'Artist' }
  ];

  const sandbox = {
    window: {
      isNativeAndroid: true,
      NocturneNative: {
        hasStoragePermission: () => true,
        saveFiioCatalogNative(json) { nativeSavedJson = json; return true; },
        loadFiioCatalogNative() { return nativeSavedJson; },
        getFiioStorageLinkStateJson() { return JSON.stringify(linkState); },
        setFiioStorageLinkState(linked, roots, count) {
          linkState.linked = Boolean(linked);
          linkState.lastTrackCount = Number(count) || 0;
          return true;
        },
        startAsyncStorageScan() {
          nativeScanCalls++;
          queueMicrotask(() => {
            if (typeof sandbox.window.onAndroidStorageScanDone === 'function') {
              sandbox.window.onAndroidStorageScanDone(2, null);
            }
          });
          return true;
        }
      }
    },
    library: lib,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
      setItem: (k, v) => { lsStore[k] = String(v); },
      removeItem: (k) => { delete lsStore[k]; }
    },
    $: (id) => (id === 'fiio-storage-link-status' ? statusEl : id === 'fiio-scan-header-btn' ? headerBtn : null),
    state: {
      tracks: [
        { id: 'google:999', source: 'google', title: 'Cloud Track' }
      ],
      albumCovers: new Map()
    },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => {},
    renderCollectionCards: () => {},
    renderRecentArtists: () => {},
    scheduleTrackRender: () => {},
    toast: () => {},
    URL,
    Set,
    Map,
    Array,
    Promise,
    Date,
    console,
    btoa: (s) => Buffer.from(s).toString('base64')
  };

  vm.runInNewContext(html.slice(fiioStart, fiioEnd), sandbox);

  // Seed native backup only (simulating WebView localStorage cleared / OTA reinstall)
  nativeSavedJson = JSON.stringify(sampleSaved);
  sandbox.window.restoreFiioCatalog();
  const fiioRestored = sandbox.state.tracks.filter(t => String(t.id).startsWith('fiio_'));
  assert.equal(fiioRestored.length, 2, 'restoreFiioCatalog must recover tracks from loadFiioCatalogNative when localStorage is empty');
  assert.equal(fiioRestored[0].albumArtist, 'Artist', 'albumArtist must survive compaction/hydration');
  assert.ok(lsStore['nocturne-fiio-catalog'], 'Must repair localStorage after recovering from native backup');

  // Even when state.tracks already has Cloud + restored tracks, startup MUST auto-sync when linked === true
  sandbox.window.ensureFiioStorageConnectedOnStartup();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(nativeScanCalls, 1, 'Linked storage must auto-sync in background even when Cloud tracks exist');
  assert.equal(statusEl.classList.contains('hidden'), false, 'Status pill must confirm active FiiO persistent link');
  assert.ok(statusEl.textContent.includes('2 bài'));

  // Mounted event triggers silent rescan
  sandbox.window.onAndroidStorageStateChanged('mounted');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(nativeScanCalls, 2, 'MicroSD mount event must trigger silent background rescan');
});

test('5. Version sync v3.9.35 / versionCode 89 & zero Chromium 74 ES2020+ syntax violations', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(indexHtml.includes('library.buildLibraryCollections(tracks)'), 'renderCollectionCards must use buildLibraryCollections');
  assert.ok(indexHtml.includes('id="fiio-storage-link-status"'));
  assert.ok(indexHtml.includes('FiiO M11S · v3.9.35'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.35';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.35';"));
  assert.ok(/versionCode\s*=\s*89\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.35"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.35"'));

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
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.ok(!/[^\w$]\?\.\w|\?\.\[|\?\.\(/.test(stripped), `${rel} must not use optional chaining (?.)`);
    assert.ok(!/\?\?[^=]/.test(stripped), `${rel} must not use nullish coalescing (??)`);
    assert.ok(!/\.replaceAll\s*\(/.test(stripped), `${rel} must not use .replaceAll()`);
    assert.ok(!/\bcatch\s*\{/.test(stripped), `${rel} must not use bare catch {}`);
  }
});
