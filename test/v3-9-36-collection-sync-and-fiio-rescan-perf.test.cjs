'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. metadataOptions, filterTracks & groupTracks match Album/Artist consolidation without merging unrelated homonym albums', () => {
  const tracks = [
    { id: '1', title: 'Song A', artist: 'Hà Anh Tuấn ft. Mỹ Tâm', album: 'Chuyện Mùa Thu', albumArtist: 'Hà Anh Tuấn', path: '/Music/HAT/01.flac' },
    { id: '2', title: 'Song B', artist: 'Hà Anh Tuấn cùng Phương Linh', album: 'Chuyện Mùa Thu', albumArtist: 'Hà Anh Tuấn', path: '/Music/HAT/02.flac' },
    { id: '3', title: 'Jazz 1', artist: 'Singer One', album: 'Late Night Jazz', path: '/Music/LateNight/01.flac' },
    { id: '4', title: 'Jazz 2', artist: 'Singer Two', album: 'Late Night Jazz', path: '/Music/LateNight/02.flac' },
    { id: '5', title: 'Jazz 3', artist: 'Singer Three', album: 'Late Night Jazz', path: '/Music/LateNight/03.flac' },
    { id: '6', title: 'Home 1', artist: 'Adele', album: '25' },
    { id: '7', title: 'Home 2', artist: 'Other Artist', album: '25' }
  ];

  const albumOpts = lib.metadataOptions(tracks, 'album', lib.UNKNOWN_ALBUM);
  const hatAlbums = albumOpts.filter(o => o.label === 'Chuyện Mùa Thu');
  const jazzAlbums = albumOpts.filter(o => o.label === 'Late Night Jazz');
  const homonym25 = albumOpts.filter(o => o.label === '25');
  assert.equal(hatAlbums.length, 1, 'albumArtist album should produce 1 dropdown option');
  assert.equal(jazzAlbums.length, 1, 'folder compilation album should produce 1 dropdown option');
  assert.equal(homonym25.length, 2, 'unrelated homonym albums without folder/albumArtist must remain separate');

  const artistOpts = lib.metadataOptions(tracks, 'artist', lib.UNKNOWN_ARTIST);
  assert.equal(artistOpts.filter(o => o.label.includes('Hà Anh Tuấn')).length, 1, 'featured credits should collapse under primary artist');

  const jazzFiltered = lib.filterTracks(tracks, { album: jazzAlbums[0].key });
  assert.equal(jazzFiltered.length, 3, 'filtering by consolidated compilation albumKey must return all tracks in that album');

  const hatFiltered = lib.filterTracks(tracks, { artist: lib.normalizeSearchKey('Hà Anh Tuấn') });
  assert.equal(hatFiltered.length, 2, 'filtering by primary artist must match featured tracks');

  const groupedAlbums = lib.groupTracks(tracks, 'album');
  assert.equal(groupedAlbums.filter(g => g.label === 'Late Night Jazz').length, 1, 'groupTracks album must keep compilation together');
  assert.equal(groupedAlbums.filter(g => g.label === 'Chuyện Mùa Thu').length, 1, 'groupTracks album must keep albumArtist together');
  assert.equal(groupedAlbums.filter(g => g.label === '25').length, 2, 'groupTracks album must keep distinct homonyms separate');
});

test('2. Artist drill-down resets lastCollectionStructureKey & canPatchInPlace verifies card action/key parity', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gridFn = html.slice(html.indexOf('function renderArtistAlbumGrid('), html.indexOf('function showArtistAlbumsView('));
  const viewFn = html.slice(html.indexOf('function showArtistAlbumsView('), html.indexOf('function handleCollectionBack('));
  assert.ok(gridFn.includes("lastCollectionStructureKey = '';"), 'renderArtistAlbumGrid must invalidate lastCollectionStructureKey');
  assert.ok(viewFn.includes("lastCollectionStructureKey = '';"), 'showArtistAlbumsView must invalidate lastCollectionStructureKey');

  const colFn = html.slice(html.indexOf('function renderCollectionCards('), html.indexOf('function trackRowsSignature('));
  assert.ok(colFn.includes('canPatchInPlace = currentStructureKey === lastCollectionStructureKey && grid.children.length === entries.length'), 'legacy canPatchInPlace invariant preserved');
  assert.ok(colFn.includes('existingCards[k].dataset.collectionAction !== expectedAction'), 'canPatchInPlace must reject mismatched card action such as artist-album');
});

test('3. FiiO rescan skips redundant DOM/disk work on zero-diff startup, upgrades albumArtist, and safely prunes only mounted roots', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fiioStart = html.indexOf('function compactFiioTrackForStorage(');
  const fiioEnd = html.indexOf('function setupFiioIntegration(');
  assert.ok(fiioStart > 0 && fiioEnd > fiioStart, 'FiiO storage section should exist');

  let renderTracksCalls = 0;
  let renderCollectionCalls = 0;
  let saveCatalogCalls = 0;
  const lsStore = {};
  const statusEl = {
    textContent: '',
    classes: new Set(['hidden']),
    classList: {
      add(c) { statusEl.classes.add(c); },
      remove(c) { statusEl.classes.delete(c); },
      contains(c) { return statusEl.classes.has(c); }
    }
  };
  const linkState = { linked: true, hasPermission: true, linkedRoots: ['/storage/emulated/0'], lastTrackCount: 3, lastScanTs: 100 };

  const sandbox = {
    window: {
      isNativeAndroid: true,
      NocturneNative: {
        hasStoragePermission: () => true,
        saveFiioCatalogNative: () => { saveCatalogCalls++; return true; },
        loadFiioCatalogNative: () => '',
        getFiioStorageLinkStateJson: () => JSON.stringify(linkState),
        setFiioStorageLinkState: (linked, roots, count) => { linkState.linked = Boolean(linked); linkState.lastTrackCount = Number(count) || 0; return true; }
      }
    },
    library: lib,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
      setItem: (k, v) => { lsStore[k] = String(v); },
      removeItem: (k) => { delete lsStore[k]; }
    },
    $: (id) => (id === 'fiio-storage-link-status' ? statusEl : null),
    state: {
      currentId: 'fiio_playing',
      tracks: [
        { id: 'fiio_int_keep', source: 'local', path: '/storage/emulated/0/Music/keep.flac', artist: 'Artist ft. Guest', album: 'Album' },
        { id: 'fiio_int_del', source: 'local', path: '/storage/emulated/0/Music/deleted.flac', artist: 'Artist', album: 'Album' },
        { id: 'fiio_sd_unmounted', source: 'local', path: '/storage/AAAA-1111/Music/sd.flac', artist: 'SD Artist', album: 'SD Album' },
        { id: 'fiio_playing', source: 'local', path: '/storage/emulated/0/Music/playing.flac', artist: 'Artist', album: 'Album' },
        { id: 'google:1', source: 'google', title: 'Cloud' }
      ],
      albumCovers: new Map()
    },
    setTimeout,
    clearTimeout,
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => { renderTracksCalls++; },
    renderCollectionCards: () => { renderCollectionCalls++; },
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

  // Zero-diff startup finish: updates link state without redrawing track list or saving catalog
  sandbox.window.finalizeFiioScanUi(4, 0, true, true, 0);
  assert.equal(renderTracksCalls, 0, 'zero-diff scan must not re-render tracks list');
  assert.equal(renderCollectionCalls, 0, 'zero-diff scan must not re-render collection grid');
  assert.equal(saveCatalogCalls, 0, 'zero-diff scan must not re-serialize catalog natively');
  assert.ok(statusEl.textContent.includes('4 bài'), 'zero-diff scan must still refresh storage link status');

  // Upgraded metadata (e.g. albumArtist newly filled on rescan) MUST trigger UI + catalog save
  sandbox.window.ingestFiioScannedFilesChunk(
    [{ path: '/storage/emulated/0/Music/keep.flac', artist: 'Artist ft. Guest', album: 'Album', albumArtist: 'Artist' }],
    new Set(['/storage/emulated/0/Music/keep.flac']),
    new Set()
  );
  const upgradedKeep = sandbox.state.tracks.find(t => t.id === 'fiio_int_keep');
  assert.equal(upgradedKeep.albumArtist, 'Artist', 'albumArtist must be applied on rescan');
  sandbox.window.finalizeFiioScanUi(4, 0, true, true, 0);
  assert.equal(renderTracksCalls, 1, 'albumArtist upgrade must trigger UI refresh');
  assert.equal(saveCatalogCalls, 1, 'albumArtist upgrade must persist updated catalog');

  // Prune missing files ONLY within mounted storage root (/storage/emulated/0/) while protecting unmounted SD (/storage/AAAA-1111/) and currentId
  const removedInternalOnly = sandbox.window.pruneMissingFiioTracks(
    new Set(['/storage/emulated/0/Music/keep.flac']),
    new Set()
  );
  assert.equal(removedInternalOnly, 1, 'should remove only deleted internal track while keeping currentId, Cloud, and unmounted SD');
  const idsAfter1 = sandbox.state.tracks.map(t => t.id);
  assert.ok(idsAfter1.includes('fiio_int_keep'));
  assert.ok(!idsAfter1.includes('fiio_int_del'));
  assert.ok(idsAfter1.includes('fiio_sd_unmounted'), 'unmounted SD tracks must survive internal-only scan');
  assert.ok(idsAfter1.includes('fiio_playing'), 'currently playing track must never be pruned mid-playback');
  assert.ok(idsAfter1.includes('google:1'), 'cloud tracks must remain untouched');

  // Once SD card root IS present in scannedPaths, deleted files on SD are pruned cleanly
  const removedWhenSdMounted = sandbox.window.pruneMissingFiioTracks(
    new Set(['/storage/emulated/0/Music/keep.flac', '/storage/AAAA-1111/Music/other.flac']),
    new Set()
  );
  assert.equal(removedWhenSdMounted, 1, 'should prune missing SD track once SD root is mounted and scanned');
  assert.ok(!sandbox.state.tracks.some(t => t.id === 'fiio_sd_unmounted'));
});

test('4. Version sync v3.9.36 / versionCode 90, Unix LF asset parity & zero Chromium 74 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.36'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.36';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.36';"));
  assert.ok(/versionCode\s*=\s*90\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.36"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.36"'));

  assert.ok(!fs.readFileSync(path.join(ROOT, '404.html')).includes(13), '404.html must have 0 CR bytes (Unix LF)');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'), indexHtml, '404.html must match index.html');

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const rel of syncedFiles) {
    const assetPath = path.join(ROOT, 'android/app/src/main/assets', rel);
    const assetBuf = fs.readFileSync(assetPath);
    assert.ok(!assetBuf.includes(13), `${rel} in android assets must have 0 CR bytes (Unix LF)`);
  }
  const filesToScan = syncedFiles.filter(f => f !== 'tailwind.min.css');
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
