'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e !== -1, `Missing end marker: ${endMarker}`);
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

describe('v3.9.102 P0-B — Instant Google Drive Album Sync, Cross-View Search & Priority Metadata Queue', () => {
  it('R2a-1: syncGoogleFolderTree fetches id,name,parents and persists GOOGLE_FOLDER_NAMES_KEY while keeping GOOGLE_FOLDER_TREE_KEY schema', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const ls = makeMockStorage();
    const fetchedUrls = [];
    const sandbox = {
      library,
      localStorage: ls,
      URLSearchParams,
      fetchGoogleDrivePageWithRetry: async (url) => {
        fetchedUrls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              { id: 'fArtist', name: 'Pink Floyd', parents: ['root'] },
              { id: 'fAlbum', name: 'The Wall', parents: ['fArtist'] },
              { id: 'fDisc1', name: 'CD 1', parents: ['fAlbum'] }
            ]
          })
        };
      },
      Object, Array, Map, Set, String, Number, Boolean, Promise, JSON, console
    };

    vm.runInNewContext(gTreeSlice, sandbox);
    const tree = await sandbox.syncGoogleFolderTree('tok-1');

    assert.ok(decodeURIComponent(fetchedUrls[0]).includes('files(id,name,parents)'));
    const normalizedTree = JSON.parse(JSON.stringify(tree));
    assert.deepEqual(normalizedTree, {
      fArtist: ['root'],
      fAlbum: ['fArtist'],
      fDisc1: ['fAlbum']
    });
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-google-folder-tree')), normalizedTree);
    assert.deepEqual(JSON.parse(ls.getItem('nocturne-google-folder-names')), {
      fArtist: 'Pink Floyd',
      fAlbum: 'The Wall',
      fDisc1: 'CD 1'
    });
    assert.ok(html.includes("localStorage.removeItem('nocturne-google-folder-names')"), 'clearCloudSourceCatalog must remove nocturne-google-folder-names');
  });

  it('R2a-2: hydrateGoogleDriveFolderMetadata resolves Artist - Album, grandparent artist, CD 1 disc subfolders, and Vietnamese/English fallbacks', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS', 'function normalizeMicrosoftDriveItem');
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const ls = makeMockStorage();
    const folderResponses = {
      dirArtist: { id: 'dirArtist', name: 'Sơn Tùng M-TP', parents: ['root'] },
      dirAlbum: { id: 'dirAlbum', name: 'm-tp M-TP', parents: ['dirArtist'] },
      dirDisc1: { id: 'dirDisc1', name: 'CD 1', parents: ['dirAlbum'] },
      dirDash: { id: 'dirDash', name: 'Bill Evans - Waltz for Debby (1961)', parents: ['dirMusic'] },
      dirMusic: { id: 'dirMusic', name: 'Music', parents: ['root'] }
    };
    const requestedIds = [];
    const sandbox = {
      library,
      localStorage: ls,
      URLSearchParams,
      isDsdFormat: fmt => fmt === 'DSF' || fmt === 'DFF',
      audioFormat: f => String((f && f.name) || '').split('.').pop().toUpperCase(),
      filenameMetadata: name => library.parseFilenameMetadata(name),
      loadGoogleAudio: () => {},
      fetchGoogleDrivePageWithRetry: async (url) => {
        const m = url.match(/\/files\/([^?]+)/);
        const fid = m ? decodeURIComponent(m[1]) : '';
        requestedIds.push(fid);
        if (folderResponses[fid]) {
          return { ok: true, status: 200, json: async () => folderResponses[fid] };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
      Object, Array, Map, Set, String, Number, Boolean, Promise, JSON, Date, console
    };

    vm.runInNewContext(gTreeSlice + '\n' + serSlice + '\nthis.googleTrack = googleTrack;\nthis.serializableCloudTrack = serializableCloudTrack;', sandbox);

    const trackDisc = sandbox.googleTrack({ id: 'g1', name: '01 - Lạc Trôi.flac', parents: ['dirDisc1'], size: 1000 });
    const trackDash = sandbox.googleTrack({ id: 'g2', name: '02 - My Foolish Heart.flac', parents: ['dirDash'], size: 1200 });
    const trackRoot = sandbox.googleTrack({ id: 'g3', name: '03 - Loose.flac', parents: ['root'], size: 900 });

    assert.equal(trackDisc.album, '—');
    assert.equal(trackDisc.artist, 'Nghệ sĩ không xác định');

    const mutated = await sandbox.hydrateGoogleDriveFolderMetadata([trackDisc, trackDash, trackRoot], 'tok-g');
    assert.equal(mutated.length, 2);
    assert.ok(!requestedIds.includes('root'), 'Must never fetch root folder metadata');

    assert.equal(trackDisc.album, 'm-tp M-TP');
    assert.equal(trackDisc.artist, 'Sơn Tùng M-TP');
    assert.equal(trackDisc.discNumber, 1);
    assert.equal(trackDisc.folderName, 'm-tp M-TP');
    assert.equal(trackDisc.remotePath, 'Sơn Tùng M-TP/m-tp M-TP/CD 1/01 - Lạc Trôi.flac');

    assert.equal(trackDash.album, 'Waltz for Debby (1961)');
    assert.equal(trackDash.artist, 'Bill Evans');
    assert.equal(trackDash.folderName, 'Bill Evans - Waltz for Debby (1961)');
    assert.equal(trackDash.remotePath, 'Bill Evans - Waltz for Debby (1961)/02 - My Foolish Heart.flac');

    // Serialized track keeps folderName & remotePath
    const ser = sandbox.serializableCloudTrack(trackDisc);
    assert.equal(ser.folderName, 'm-tp M-TP');
    assert.equal(ser.remotePath, 'Sơn Tùng M-TP/m-tp M-TP/CD 1/01 - Lạc Trôi.flac');

    // Subsequent googleTrack() applies cached folder names synchronously
    const trackCached = sandbox.googleTrack({ id: 'g4', name: '04 - Cơn Mưa Ngang Qua.flac', parents: ['dirDisc1'], size: 800 });
    assert.equal(trackCached.album, 'm-tp M-TP');
    assert.equal(trackCached.artist, 'Sơn Tùng M-TP');
    assert.equal(trackCached.folderName, 'm-tp M-TP');
  });

  it('R2a-3: loadGoogleFiles runs syncGoogleFolderTree + hydrateGoogleDriveFolderMetadata before pruneCloudCatalog/renderTracks and delta sync hydrates before renderTracks', () => {
    const loadFn = extractBetween(html, 'async function loadGoogleFiles()', 'async function fetchCloudFile(');
    const afterLoop = loadFn.split('} while (pageToken);')[1] || '';
    const idxHydrate = afterLoop.indexOf('hydrateGoogleDriveFolderMetadata');
    const idxPrune = afterLoop.indexOf('await pruneCloudCatalog();');
    const idxRender = afterLoop.indexOf('renderTracks();');
    assert.ok(idxHydrate !== -1 && idxPrune !== -1 && idxRender !== -1);
    assert.ok(idxHydrate < idxPrune && idxPrune < idxRender, 'Full scan hydration must run BEFORE pruneCloudCatalog() and renderTracks()');

    const deltaFn = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');
    const deltaTail = deltaFn.slice(deltaFn.indexOf('if (removedFolderIds.size > 0)'));
    const dHydrate = deltaTail.indexOf('hydrateGoogleDriveFolderMetadata');
    const dFlush = deltaTail.indexOf('await flushDeltaPersistence();');
    const dRender = deltaTail.indexOf('renderTracks();');
    assert.ok(dHydrate !== -1 && dFlush !== -1 && dRender !== -1);
    assert.ok(dHydrate < dFlush && dFlush < dRender, 'Delta sync hydration must run BEFORE flushDeltaPersistence() and renderTracks()');
  });

  it('R2b-1: library-utils.js normalizedTrackMetadata/filterTracks searches filename stem, folderName, remotePath, relativePath, and albumArtist with cache invalidation', () => {
    const tr = {
      id: 'google:1',
      source: 'google',
      name: '01 - Em Của Ngày Hôm Qua (Live).flac',
      title: 'Bài hát không tên',
      artist: 'Nghệ sĩ không xác định',
      album: '—',
      metadataLoaded: false
    };
    assert.equal(library.filterTracks([tr], { query: 'em cua ngay hom qua' }).length, 1, 'Matches filename stem before metadataLoaded');

    // Mutate folderName & remotePath on same object -> cache MUST invalidate
    tr.folderName = 'Tuyển Tập Sơn Tùng';
    tr.remotePath = 'Sơn Tùng M-TP/Tuyển Tập Sơn Tùng/01 - Em Của Ngày Hôm Qua (Live).flac';
    tr.albumArtist = 'M-TP Entertainment';
    assert.equal(library.filterTracks([tr], { query: 'tuyen tap son tung' }).length, 1, 'Cache must invalidate when folderName/remotePath changes');
    assert.equal(library.filterTracks([tr], { query: 'm-tp entertainment' }).length, 1, 'Matches albumArtist');
    assert.ok(library.scoreSearchMatch(tr, 'tuyen tap') >= 150);
  });

  it('R2b-2: renderCollectionCards keeps albums matching song title & falls back to showRows when no cards match; Home search switches to songs and prioritizes untagged tracks', () => {
    const fnSrc = extractBetween(html, 'function renderCollectionCards(tracks) {', 'function trackRowsSignature(');
    const makeEl = () => {
      const classes = new Set();
      return {
        textContent: '',
        innerHTML: '',
        children: [],
        dataset: {},
        classList: {
          add: c => classes.add(c),
          remove: c => classes.delete(c),
          toggle: (c, force) => {
            if (force === undefined) {
              if (classes.has(c)) classes.delete(c); else classes.add(c);
            } else if (force) classes.add(c);
            else classes.delete(c);
          },
          contains: c => classes.has(c)
        },
        querySelectorAll: () => [],
        appendChild: ch => {}
      };
    };
    const els = {};
    const getEl = id => (els[id] || (els[id] = makeEl()));
    const tracks = [
      { id: 't1', name: 'moonlit_path.flac', title: 'Moonlit Path', artist: 'Artist A', album: 'Midnight Suite', source: 'google', format: 'FLAC' }
    ];
    const sandbox = {
      library,
      $: getEl,
      IS_LEGACY_ANDROID: false,
      LAZY_COVER_PLACEHOLDER_SRC: '',
      escapeHtml: s => String(s || ''),
      queueOnlineAlbumCover: () => {},
      queueOnlineArtistPortrait: () => {},
      observeLazyCovers: () => {},
      lastCollectionStructureKey: '',
      safeClass: (el, act, cls) => { if (el && el.classList) el.classList[act](cls); },
      isFavorite: () => false,
      failedNativeCovers: new Set(),
      document: { createDocumentFragment: () => ({ appendChild() {} }), createElement: () => makeEl() },
      state: {
        activeView: 'albums',
        query: 'moonlit',
        artist: '*',
        album: '*',
        focusOnly: false,
        collectionSort: 'title',
        collectionAscending: true,
        trackScope: null,
        albumCovers: new Map(),
        artistPortraits: new Map(),
        tracks
      },
      renderCollectionCard: () => makeEl(),
      Map, Set, Array, Object, String, Number, Boolean
    };
    vm.runInNewContext(fnSrc, sandbox);
    const res = sandbox.renderCollectionCards(tracks);
    assert.equal(sandbox.state._latestCollectionEntries.length, 1, 'Album Midnight Suite must remain visible when searching for song title Moonlit Path');
    assert.equal(sandbox.state._latestCollectionEntries[0].name, 'Midnight Suite');
    assert.equal(res.showRows, false);

    // Search handler: Home -> songs & prioritizeCloudMetadataTracks
    const searchHandlerSlice = extractBetween(html, 'function handleLibrarySearchQueryChange() {', 'function renderSearchHistoryDropdown(');
    const prioritized = [];
    const searchEls = {
      'album-hero': makeEl(),
      search: { value: 'moonlit', addEventListener() {} },
      'search-mobile': { value: '', addEventListener() {} }
    };
    const untaggedCloud = { id: 'g99', name: 'moonlit.flac', title: 'Moonlit', artist: '—', album: '—', source: 'google', metadataLoaded: false };
    const taggedLocal = { id: 'l1', name: 'moonlit_local.flac', title: 'Moonlit Local', artist: 'X', album: 'Y', source: 'local', metadataLoaded: true };
    const searchSandbox = {
      library,
      $: id => searchEls[id],
      safeClass: () => {},
      prioritizeCloudMetadataTracks: list => { prioritized.push(...list); },
      renderTracks: () => {},
      state: {
        activeView: 'home',
        query: 'moonlit',
        selectedArtistEntry: null,
        currentCollectionEntry: null,
        trackScope: null,
        tracks: [taggedLocal, untaggedCloud]
      }
    };
    vm.runInNewContext(searchHandlerSlice, searchSandbox);
    searchSandbox.handleLibrarySearchQueryChange();
    assert.equal(searchSandbox.state.activeView, 'songs', 'Searching from Home view must switch to songs view');
    assert.deepEqual(prioritized.map(t => t.id), ['g99'], 'Search must prioritize matching untagged cloud tracks');
  });

  it('R2c: cloudMetadataQueue sorts priority tiers, prioritizes urgent tracks, uses 2/1 on Legacy Android vs 3 on Modern Android, and defers .lrc during untagged backlog', async () => {
    const qSlice = extractBetween(html, 'const CLOUD_METADATA_CONCURRENCY = 3;', 'function isCloudAuthHttpError(');
    const enrSlice = extractBetween(html, 'async function enrichCloudTrack(', 'const dsdWorkerBaseUrl =');

    const tOldRgOnly = { id: 'google:old', source: 'google', metadataLoaded: true, cover: 'data:image/png;base64,A', _replayGainChecked: false };
    const tNeedCover = { id: 'google:cov', source: 'google', metadataLoaded: true, cover: null, _replayGainChecked: true };
    const tUntagged = { id: 'google:new', source: 'google', metadataLoaded: false, cover: null };
    const tUrgentSearch = { id: 'google:urg', source: 'google', metadataLoaded: false, cover: null };

    // 1. Test priority & concurrency on Legacy Android (2 for untagged, 1 for Tier 2/3) vs Modern Android (3)
    const runConcurrencies = (isLegacy, fiioDapMode, queueItems) => {
      const cloned = queueItems.map(item => Object.assign({}, item));
      const started = [];
      const sandbox = {
        library,
        IS_LEGACY_ANDROID: isLegacy,
        cloudMetadataQueue: cloned.slice(),
        cloudMetadataActive: 0,
        navigator: { onLine: true },
        document: { hidden: false, addEventListener() {} },
        window: { addEventListener() {} },
        state: {
          isPlaybackLoading: false,
          fiioDapMode,
          googleToken: 'tok',
          googleExpiresAt: Date.now() + 3600000,
          tracks: cloned.slice()
        },
        enrichCloudTrack: tr => {
          started.push(tr.id);
          return new Promise(() => {}); // keep active to measure concurrency cap
        },
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
        Map, Set, WeakSet, Array, Object, String, Number, Boolean, Date, Math, Promise, console
      };
      vm.runInNewContext(qSlice, sandbox);
      sandbox.runCloudMetadataQueue();
      return { started, sandbox };
    };

    const legacyUntagged = runConcurrencies(true, true, [tUntagged, tUrgentSearch, tNeedCover, tOldRgOnly]);
    assert.equal(legacyUntagged.started.length, 2, 'IS_LEGACY_ANDROID runs 2 concurrent untagged range tag reads');

    const legacyTier2 = runConcurrencies(true, true, [tNeedCover, tOldRgOnly, { id: 'google:cov2', source: 'google', metadataLoaded: true, cover: null }]);
    assert.equal(legacyTier2.started.length, 1, 'IS_LEGACY_ANDROID throttles Tier 2/3 to 1');

    const modernAndroid = runConcurrencies(false, true, [tUntagged, tUrgentSearch, tNeedCover, tOldRgOnly]);
    assert.equal(modernAndroid.started.length, 3, 'Modern Android (API 31-35+) runs full CLOUD_METADATA_CONCURRENCY = 3 even when fiioDapMode defaults true');

    // 2. Test queueCloudMetadata sorting & prioritizeCloudMetadataTracks
    const qSandbox = {
      library,
      IS_LEGACY_ANDROID: false,
      cloudMetadataQueue: [],
      cloudMetadataActive: 0,
      navigator: { onLine: true },
      document: { hidden: false, addEventListener() {} },
      window: { addEventListener() {} },
      state: {
        isPlaybackLoading: true, // pause drain so we can inspect queue order
        fiioDapMode: false,
        googleToken: 'tok',
        googleExpiresAt: Date.now() + 3600000,
        tracks: [tOldRgOnly, tNeedCover, tUntagged, tUrgentSearch]
      },
      enrichCloudTrack: async () => {},
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      Map, Set, WeakSet, Array, Object, String, Number, Boolean, Date, Math, Promise, console
    };
    vm.runInNewContext(qSlice, qSandbox);
    qSandbox.queueCloudMetadata([tOldRgOnly, tNeedCover, tUntagged]);
    assert.deepEqual(qSandbox.cloudMetadataQueue.map(t => t.id), ['google:new', 'google:cov', 'google:old'], 'Untagged tracks must jump ahead of Tier 2/3 tracks');

    qSandbox.queueCloudMetadata([tUrgentSearch]);
    qSandbox.prioritizeCloudMetadataTracks([tUrgentSearch]);
    assert.equal(qSandbox.cloudMetadataQueue[0].id, 'google:urg', 'prioritizeCloudMetadataTracks must move searched track to index 0');

    // 3. Test .lrc deferral during untagged backlog and Tier-3 repopulate
    const lrcCalls = [];
    const deferredTrack = { id: 'google:d1', source: 'google', name: 'D1.flac', title: 'D1', artist: 'A', album: 'B', metadataLoaded: false, cover: null };
    const backlogPeer = { id: 'google:d2', source: 'google', name: 'D2.flac', title: 'D2', artist: 'A', album: 'B', metadataLoaded: false, cover: null };
    const enrSandbox = {
      library,
      IS_LEGACY_ANDROID: false,
      cloudMetadataQueue: [backlogPeer],
      cloudMetadataActive: 0,
      cloudMetadataBackoffMs: 0,
      cloudMetadataDeferredLrc: false,
      trackMetadataRevision: 0,
      filterOptionsSignature: '',
      state: { albumCovers: new Map(), tracks: [deferredTrack, backlogPeer] },
      allSettledCompat: ps => Promise.all(ps.map(p => Promise.resolve(p).then(v => ({ status: 'fulfilled', value: v }), r => ({ status: 'rejected', reason: r })))),
      cloudTagRequest: async () => ({ title: 'D1', artist: 'A', album: 'B', cover: 'data:image/png;base64,AA==' }),
      googleThumbnail: async () => null,
      microsoftThumbnail: async () => null,
      fetchCloudSidecarLrc: async (tr) => { lrcCalls.push(tr.id); return { status: 'not_found' }; },
      normalizeCoverImage: async c => c,
      updateMetadataFilters: () => {},
      scheduleTrackRender: () => {},
      persistCloudCatalog: async () => {},
      Object, Array, Map, Set, String, Number, Boolean, Date, Promise, console
    };
    vm.runInNewContext(enrSlice, enrSandbox);
    await enrSandbox.enrichCloudTrack(deferredTrack);
    assert.equal(deferredTrack.metadataLoaded, true);
    assert.equal(lrcCalls.length, 0, 'Sidecar .lrc fetch must be deferred when untagged tracks remain in queue');
    assert.equal(deferredTrack.metadataRetryAt, undefined, 'metadataRetryAt must stay cleared for Tier-3 LRC pass');
    assert.equal(enrSandbox.cloudMetadataDeferredLrc, true);
  });

  it('R2a-4: tryLoadGoogleChangesDelta propagates folder renames (direct, CD 1 subfolder, and 2-hop artist folder) to unchanged tracks and persists them', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    const ls = makeMockStorage({
      'nocturne-google-delta-token': 'delta-1',
      'nocturne-google-folder-tree': JSON.stringify({
        fRootMusic: ['root'],
        fDirect: ['fRootMusic'],
        fAlbumParent: ['fRootMusic'],
        fDiscSub: ['fAlbumParent'],
        fArtistDir: ['fRootMusic'],
        fArtistAlbum: ['fArtistDir'],
        fArtistDisc: ['fArtistAlbum']
      }),
      'nocturne-google-folder-names': JSON.stringify({
        fRootMusic: 'Music',
        fDirect: 'Temporary Folder',
        fAlbumParent: 'Old Band - Old Album',
        fDiscSub: 'CD 1',
        fArtistDir: 'Old Artist',
        fArtistAlbum: 'Studio Works',
        fArtistDisc: 'CD 2'
      })
    });

    const directUntagged = {
      id: 'google:d1', remoteId: 'd1', source: 'google', parents: ['fDirect'],
      name: '01 - Stayed.flac', title: 'Stayed',
      artist: 'Nghệ sĩ không xác định', album: 'Temporary Folder',
      folderName: 'Temporary Folder', remotePath: 'Temporary Folder/01 - Stayed.flac',
      metadataLoaded: false
    };
    const discUntagged = {
      id: 'google:d2', remoteId: 'd2', source: 'google', parents: ['fDiscSub'],
      name: '02 - DiscTrack.flac', title: 'DiscTrack',
      artist: 'Old Band', album: 'Old Album', discNumber: 1,
      folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/CD 1/02 - DiscTrack.flac',
      metadataLoaded: false
    };
    const discFilenameArtist = {
      id: 'google:d3', remoteId: 'd3', source: 'google', parents: ['fDiscSub'],
      name: 'Solo Artist - Song.flac', title: 'Song',
      artist: 'Solo Artist', album: 'Old Album', discNumber: 1,
      folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/CD 1/Solo Artist - Song.flac',
      metadataLoaded: false
    };
    const taggedTrack = {
      id: 'google:d4', remoteId: 'd4', source: 'google', parents: ['fDirect'],
      name: '04 - Embedded.flac', title: 'Embedded Title',
      artist: 'Embedded Artist', album: 'Embedded Album',
      folderName: 'Temporary Folder', remotePath: 'Temporary Folder/04 - Embedded.flac',
      metadataLoaded: true
    };
    const artistTwoHopTrack = {
      id: 'google:d5', remoteId: 'd5', source: 'google', parents: ['fArtistDisc'],
      name: '05 - TwoHop.flac', title: 'TwoHop',
      artist: 'Old Artist', album: 'Studio Works', discNumber: 2,
      folderName: 'Studio Works', remotePath: 'Old Artist/Studio Works/CD 2/05 - TwoHop.flac',
      metadataLoaded: false
    };

    const tracks = [directUntagged, discUntagged, discFilenameArtist, taggedTrack, artistTwoHopTrack];
    const existingByRemoteId = new Map(tracks.map(t => [t.remoteId, t]));
    const knownIds = new Set(tracks.map(t => t.remoteId));
    const persisted = [];
    let renderCalls = 0;

    const sandbox = {
      localStorage: ls,
      library,
      state: { tracks, googleToken: 'g-tok', albumCovers: new Map() },
      checkedGoogleArtParents: new Set(),
      trackMetadataRevision: 0,
      filterOptionsSignature: 'sig-1',
      URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error, Promise, console, encodeURIComponent,
      ensureGoogleToken: async () => 'g-tok',
      googleConfigurationHint: () => '',
      isCloudAudio: () => false,
      googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
      invalidateCloudTrackContent: () => {},
      persistCloudCatalog: async list => { persisted.push(...list); },
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      renderTracks: () => { renderCalls++; },
      cloudStatus: () => {},
      toast: () => {},
      fetchGoogleDrivePageWithRetry: async url => {
        if (url.includes('/drive/v3/changes')) {
          return {
            ok: true, status: 200,
            json: async () => ({
              newStartPageToken: 'delta-2',
              changes: [
                { fileId: 'fDirect', file: { id: 'fDirect', name: 'Bức Tường - Tâm Hồn Của Đá', mimeType: 'application/vnd.google-apps.folder', parents: ['fRootMusic'] } },
                { fileId: 'fAlbumParent', file: { id: 'fAlbumParent', name: 'New Band - New Album', mimeType: 'application/vnd.google-apps.folder', parents: ['fRootMusic'] } },
                { fileId: 'fArtistDir', file: { id: 'fArtistDir', name: 'Renamed Artist', mimeType: 'application/vnd.google-apps.folder', parents: ['fRootMusic'] } }
              ]
            })
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
    };

    vm.runInNewContext(`${gTreeSlice}\n${gDeltaSlice}\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;\nthis.getRev = () => trackMetadataRevision;\nthis.getSig = () => filterOptionsSignature;`, sandbox);

    const res = await sandbox.tryLoadGoogleChangesDelta('g-tok', existingByRemoteId, knownIds);
    assert.equal(res.handled, true);
    assert.equal(res.updated, 5, 'All 5 affected tracks under renamed folders must be marked updated');
    assert.equal(renderCalls, 1, 'renderTracks must run after delta folder rename');
    assert.ok(sandbox.getRev() > 0, 'trackMetadataRevision must increment');
    assert.equal(sandbox.getSig(), '', 'filterOptionsSignature must be invalidated');

    assert.equal(directUntagged.album, 'Tâm Hồn Của Đá');
    assert.equal(directUntagged.artist, 'Bức Tường');
    assert.equal(directUntagged.folderName, 'Bức Tường - Tâm Hồn Của Đá');
    assert.equal(directUntagged.remotePath, 'Bức Tường - Tâm Hồn Của Đá/01 - Stayed.flac');

    assert.equal(discUntagged.album, 'New Album');
    assert.equal(discUntagged.artist, 'New Band');
    assert.equal(discUntagged.folderName, 'New Band - New Album');
    assert.equal(discUntagged.remotePath, 'New Band - New Album/CD 1/02 - DiscTrack.flac');

    assert.equal(discFilenameArtist.album, 'New Album');
    assert.equal(discFilenameArtist.artist, 'Solo Artist', 'Filename-parsed artist must NOT be wiped by folder rename');

    assert.equal(taggedTrack.album, 'Embedded Album', 'metadataLoaded=true album must never be overwritten');
    assert.equal(taggedTrack.artist, 'Embedded Artist', 'metadataLoaded=true artist must never be overwritten');
    assert.equal(taggedTrack.folderName, 'Bức Tường - Tâm Hồn Của Đá');
    assert.equal(taggedTrack.remotePath, 'Bức Tường - Tâm Hồn Của Đá/04 - Embedded.flac');

    assert.equal(artistTwoHopTrack.album, 'Studio Works');
    assert.equal(artistTwoHopTrack.artist, 'Renamed Artist', '2-hop grandparent artist folder rename must update artist');
    assert.equal(artistTwoHopTrack.remotePath, 'Renamed Artist/Studio Works/CD 2/05 - TwoHop.flac');

    const persistedIds = new Set(persisted.map(t => t.id));
    assert.deepEqual(Array.from(persistedIds).sort(), ['google:d1', 'google:d2', 'google:d3', 'google:d4', 'google:d5']);
    assert.equal(JSON.parse(ls.getItem('nocturne-google-folder-names')).fDirect, 'Bức Tường - Tâm Hồn Của Đá');
  });

  it('R2a-5: Moving untagged Google Drive tracks updates folder-derived artist alongside album while preserving filename-parsed and embedded tags', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');
    const loadFn = extractBetween(html, 'async function loadGoogleFiles()', 'async function fetchCloudFile(');

    // Part A: Delta move (syncExistingGoogleChange)
    {
      const ls = makeMockStorage({
        'nocturne-google-delta-token': 'delta-move-1',
        'nocturne-google-folder-tree': JSON.stringify({ fOld: ['root'], fNew: ['root'] }),
        'nocturne-google-folder-names': JSON.stringify({ fOld: 'Old Band - Old Album', fNew: 'New Band - New Album' })
      });
      const movedFolderArtist = {
        id: 'google:m1', remoteId: 'm1', source: 'google', parents: ['fOld'],
        name: '01 - Track.flac', title: 'Track',
        artist: 'Old Band', album: 'Old Album',
        folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/01 - Track.flac',
        metadataLoaded: false
      };
      const movedFilenameArtist = {
        id: 'google:m2', remoteId: 'm2', source: 'google', parents: ['fOld'],
        name: 'Session Player - Track2.flac', title: 'Track2',
        artist: 'Session Player', album: 'Old Album',
        folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/Session Player - Track2.flac',
        metadataLoaded: false
      };
      const movedTagged = {
        id: 'google:m3', remoteId: 'm3', source: 'google', parents: ['fOld'],
        name: '03 - Tagged.flac', title: 'Tagged',
        artist: 'Embedded Artist', album: 'Embedded Album',
        folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/03 - Tagged.flac',
        metadataLoaded: true
      };

      const tracks = [movedFolderArtist, movedFilenameArtist, movedTagged];
      const sandbox = {
        localStorage: ls,
        library,
        state: { tracks, googleToken: 'g-tok', albumCovers: new Map() },
        checkedGoogleArtParents: new Set(),
        trackMetadataRevision: 0,
        filterOptionsSignature: '',
        URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error, Promise, console, encodeURIComponent,
        ensureGoogleToken: async () => 'g-tok',
        googleConfigurationHint: () => '',
        isCloudAudio: () => true,
        googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
        invalidateCloudTrackContent: () => {},
        persistCloudCatalog: async () => {},
        pruneCloudCatalog: async () => {},
        removeCloudTracksByRemoteIds: async () => 0,
        renderTracks: () => {},
        cloudStatus: () => {},
        toast: () => {},
        fetchGoogleDrivePageWithRetry: async () => ({
          ok: true, status: 200,
          json: async () => ({
            newStartPageToken: 'delta-move-2',
            changes: [
              { fileId: 'm1', file: { id: 'm1', name: '01 - Track.flac', parents: ['fNew'] } },
              { fileId: 'm2', file: { id: 'm2', name: 'Session Player - Track2.flac', parents: ['fNew'] } },
              { fileId: 'm3', file: { id: 'm3', name: '03 - Tagged.flac', parents: ['fNew'] } }
            ]
          })
        })
      };
      vm.runInNewContext(`${gTreeSlice}\n${gDeltaSlice}\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;`, sandbox);
      const res = await sandbox.tryLoadGoogleChangesDelta(
        'g-tok',
        new Map(tracks.map(t => [t.remoteId, t])),
        new Set(tracks.map(t => t.remoteId))
      );
      assert.equal(res.handled, true);
      assert.equal(movedFolderArtist.album, 'New Album');
      assert.equal(movedFolderArtist.artist, 'New Band', 'Moving untagged file from Old Band - Old Album to New Band - New Album must update artist too');
      assert.equal(movedFilenameArtist.album, 'New Album');
      assert.equal(movedFilenameArtist.artist, 'Session Player', 'Moving untagged file must preserve filename-parsed artist');
      assert.equal(movedTagged.album, 'Embedded Album', 'Moving metadataLoaded=true file must never overwrite embedded album');
      assert.equal(movedTagged.artist, 'Embedded Artist', 'Moving metadataLoaded=true file must never overwrite embedded artist');
    }

    // Part B: Full scan move (applyGoogleScanUpdate inside loadGoogleFiles)
    {
      const ls = makeMockStorage({
        'nocturne-google-folder-tree': JSON.stringify({ fOld: ['root'], fNew: ['root'] }),
        'nocturne-google-folder-names': JSON.stringify({ fOld: 'Old Band - Old Album', fNew: 'New Band - New Album' })
      });
      const scanMoved = {
        id: 'google:s1', remoteId: 's1', source: 'google', parents: ['fOld'],
        name: '01 - ScanMoved.flac', title: 'ScanMoved',
        artist: 'Old Band', album: 'Old Album',
        folderName: 'Old Band - Old Album', remotePath: 'Old Band - Old Album/01 - ScanMoved.flac',
        metadataLoaded: false
      };
      const sandbox = {
        localStorage: ls,
        library,
        navigator: { onLine: true },
        state: { tracks: [scanMoved], googleToken: 'g-tok', albumCovers: new Map() },
        checkedGoogleArtParents: new Set(),
        GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed=false',
        trackMetadataRevision: 0,
        filterOptionsSignature: '',
        URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error, Promise, console, encodeURIComponent,
        restoreCloudCatalog: async () => {},
        ensureGoogleToken: async () => 'g-tok',
        googleConfigurationHint: () => '',
        isCloudAudio: () => true,
        googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
        invalidateCloudTrackContent: () => {},
        persistCloudCatalog: async () => {},
        pruneCloudCatalog: async () => {},
        removeDeletedCloudTracks: async () => 0,
        renderTracks: () => {},
        scheduleBackgroundRender: () => {},
        cloudStatus: () => {},
        toast: () => {},
        queueCloudMetadata: () => {},
        propagateAndBroadcastCovers: () => {},
        fetchGoogleDrivePageWithRetry: async url => {
          if (url.includes('mimeType+%3D+%27application%2Fvnd.google-apps.folder%27') || url.includes("mimeType = 'application/vnd.google-apps.folder'")) {
            return {
              ok: true, status: 200,
              json: async () => ({
                files: [
                  { id: 'fOld', name: 'Old Band - Old Album', parents: ['root'] },
                  { id: 'fNew', name: 'New Band - New Album', parents: ['root'] }
                ]
              })
            };
          }
          if (url.includes('/changes/startPageToken')) {
            return { ok: true, status: 200, json: async () => ({ startPageToken: 'start-2' }) };
          }
          return {
            ok: true, status: 200,
            json: async () => ({
              files: [{ id: 's1', name: '01 - ScanMoved.flac', parents: ['fNew'], size: '1234', modifiedTime: '2026-11-25T10:00:00Z' }]
            })
          };
        }
      };
      vm.runInNewContext(`${gTreeSlice}\n${loadFn}\nthis.loadGoogleFiles = loadGoogleFiles;`, sandbox);
      await sandbox.loadGoogleFiles({ forceFullScan: true });
      assert.equal(scanMoved.album, 'New Album');
      assert.equal(scanMoved.artist, 'New Band', 'applyGoogleScanUpdate must reset old folder artist so full-scan hydration updates both album and artist');
      assert.equal(scanMoved.folderName, 'New Band - New Album');
      assert.equal(scanMoved.remotePath, 'New Band - New Album/01 - ScanMoved.flac');
    }
  });
});
