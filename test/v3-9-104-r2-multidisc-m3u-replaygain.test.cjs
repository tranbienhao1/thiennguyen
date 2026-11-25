'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));
const libraryTools = require(path.join(ROOT, 'library-tools.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

function extractFn(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find ${signature}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTpl = false;
  let escaped = false;
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

function makeMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map.entries()); }
  };
}

describe('v3.9.104 R2 — Multi-Disc Album Merge, Cloud/SAF Relative Paths, M3U8 Sync & ReplayGain/Bit-Perfect Parity', () => {
  it('1. [R2-Contract] library-utils.js exports parseDiscSubfolderInfo, stripAlbumDiscSuffix, decodeSafDocRelativePath & createFiioTrack.relativePath', () => {
    assert.equal(typeof library.parseDiscSubfolderInfo, 'function', 'library-utils must export parseDiscSubfolderInfo');
    assert.equal(typeof library.stripAlbumDiscSuffix, 'function', 'library-utils must export stripAlbumDiscSuffix');
    assert.equal(typeof library.decodeSafDocRelativePath, 'function', 'library-utils must export decodeSafDocRelativePath');

    // Category-partition tests for parseDiscSubfolderInfo
    const discCases = [
      ['CD 1', true, 1],
      ['Disc B', true, 2],
      ['Side 2', true, 2],
      ['Vol. IV', true, 4],
      ['SACD 1', true, 1],
      ['Part 3', true, 3],
      ['Disc A - Bonus', true, 1],
      ['Coldplay', false, null],
      ['', false, null],
      [null, false, null]
    ];
    for (const [input, expIsDisc, expNum] of discCases) {
      const info = library.parseDiscSubfolderInfo(input);
      assert.equal(info.isDiscFolder, expIsDisc, `parseDiscSubfolderInfo(${JSON.stringify(input)}).isDiscFolder`);
      assert.equal(info.discNumber, expNum, `parseDiscSubfolderInfo(${JSON.stringify(input)}).discNumber`);
    }

    // Boundary tests for stripAlbumDiscSuffix
    assert.equal(library.stripAlbumDiscSuffix('The Wall (Disc 1)'), 'The Wall');
    assert.equal(library.stripAlbumDiscSuffix('Abbey Road [CD 2]'), 'Abbey Road');
    assert.equal(library.stripAlbumDiscSuffix('Greatest Hits - Vol. 3'), 'Greatest Hits');
    assert.equal(library.stripAlbumDiscSuffix('Discotheque'), 'Discotheque');
    assert.equal(library.stripAlbumDiscSuffix(''), '');

    // Boundary tests for decodeSafDocRelativePath
    const safUri1 = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FArtist%2FAlbum%2FCD%201%2F01.flac';
    assert.equal(library.decodeSafDocRelativePath(safUri1), 'Music/Artist/Album/CD 1/01.flac');
    assert.equal(library.decodeSafDocRelativePath('https://example.com/01.flac'), '');
    assert.equal(library.decodeSafDocRelativePath(''), '');
    assert.equal(library.decodeSafDocRelativePath(null), '');

    // createFiioTrack extracts relativePath & discNumber from SAF document URI
    const safUri2 = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FArtist%2FAlbum%2FCD%202%2F03.flac';
    const fiioTrack = library.createFiioTrack({ uri: safUri2, name: '03.flac', size: 1024, lastModified: 1700000000 });
    assert.ok(fiioTrack && typeof fiioTrack.relativePath === 'string' && fiioTrack.relativePath.includes('CD 2'), 'createFiioTrack must populate relativePath from SAF docId');
    assert.equal(fiioTrack.discNumber, 2, 'createFiioTrack must extract discNumber=2 from SAF CD 2 path');
  });

  it('2. [R2-Contract] buildLibraryCollections merges multi-disc subfolders & (Disc N) titles + Various Artists compilations across Google Drive, OneDrive & Local/SAF', async () => {
    // A. Local/Web tracks with (Disc 1)/(Disc 2) album suffixes + CD 1 / Disc B subfolders
    const localD1 = {
      id: 'loc1', source: 'local',
      relativePath: 'Pink Floyd/The Wall/CD 1/01 - In the Flesh.flac',
      title: 'In the Flesh', artist: 'Pink Floyd', album: 'The Wall (Disc 1)', trackNumber: 1
    };
    const localD2 = {
      id: 'loc2', source: 'local',
      relativePath: 'Pink Floyd/The Wall/Disc B/02 - Another Brick.flac',
      title: 'Another Brick', artist: 'Pink Floyd', album: 'The Wall (Disc 2)', trackNumber: 2
    };
    const localCols = library.buildLibraryCollections([localD2, localD1]);
    assert.equal(localCols.albums.size, 1, 'Local CD 1 + Disc B with (Disc 1)/(Disc 2) suffixes must merge into 1 album card');
    const [mergedLocalAlbum] = Array.from(localCols.albums.values());
    const sortedLocal = library.sortAlbumTracks(mergedLocalAlbum.tracks, { groupByAlbum: false });
    assert.deepEqual(sortedLocal.map(t => t.id), ['loc1', 'loc2'], 'Disc 1 (CD 1) must sort before Disc 2 (Disc B)');

    // B. OneDrive compilation across Side 1 / Side 2 with distinct artists -> Various Artists single album card
    const msTracks = [
      { id: 'od1', source: 'onedrive', remotePath: '/drive/root:/Music/Nocturne Comp/Side 1/01.flac', title: 'Overture', artist: 'Artist Alpha', album: 'Nocturne Comp (Disc 1)', trackNumber: 1 },
      { id: 'od2', source: 'onedrive', remotePath: '/drive/root:/Music/Nocturne Comp/Side 2/02.flac', title: 'Interlude', artist: 'Artist Beta', album: 'Nocturne Comp (Disc 2)', trackNumber: 1 },
      { id: 'od3', source: 'onedrive', remotePath: '/drive/root:/Music/Nocturne Comp/Side 2/03.flac', title: 'Finale', artist: 'Artist Gamma', album: 'Nocturne Comp (Disc 2)', trackNumber: 2 }
    ];
    const msCols = library.buildLibraryCollections(msTracks);
    assert.equal(msCols.albums.size, 1, 'OneDrive Side 1 + Side 2 compilation must merge into 1 album card');
    const [msAlbum] = Array.from(msCols.albums.values());
    assert.equal(msAlbum.artist, 'Various Artists', 'Multi-artist compilation across Side 1/Side 2 must resolve to Various Artists');

    // C. Google Drive 3-hop hydrateGoogleDriveFolderMetadata -> resolves remotePath & discNumber & merges CD 1 + Disc B
    const gTreeConstSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function resetCachedGoogleFolderMaps()');
    const gMapHelperSlice = extractBetween(html, 'function readCloudFolderTree(key) {', 'function isGenericDriveFolderName(name)');
    const gHelperSlice = extractBetween(html, 'function isGenericDriveFolderName(name) {', 'function buildChildFolderIndex(');
    const ls = makeMockStorage();
    const driveFolders = {
      gCd1: { id: 'gCd1', name: 'CD 1', parents: ['gAlb'] },
      gCd2: { id: 'gCd2', name: 'Disc B', parents: ['gAlb'] },
      gAlb: { id: 'gAlb', name: 'Symphony No. 9', parents: ['gArt'] },
      gArt: { id: 'gArt', name: 'Symphony Ensemble', parents: ['gRoot'] },
      gRoot: { id: 'gRoot', name: 'Music', parents: [] }
    };
    const gTracks = [
      { id: 'google:g1', remoteId: 'g1', source: 'google', name: '01 - Allegro.flac', parents: ['gCd1'], artist: 'Unknown Artist', album: 'Unknown Album' },
      { id: 'google:g2', remoteId: 'g2', source: 'google', name: '02 - Adagio.flac', parents: ['gCd2'], artist: 'Unknown Artist', album: 'Unknown Album' }
    ];
    const gSandbox = {
      library,
      localStorage: ls,
      Map, Set, Array, Object, String, Number, Boolean, JSON, Promise, encodeURIComponent,
      fetchGoogleDrivePageWithRetry: async url => {
        const m = url.match(/\/drive\/v3\/files\/([^?]+)/);
        const fid = m ? decodeURIComponent(m[1]) : '';
        const folder = driveFolders[fid];
        return folder ? { ok: true, status: 200, json: async () => folder } : { ok: false, status: 404 };
      }
    };
    vm.runInNewContext(`${gTreeConstSlice}\n${gMapHelperSlice}\n${gHelperSlice}\nthis.hydrateGoogleDriveFolderMetadata = hydrateGoogleDriveFolderMetadata;`, gSandbox);
    await gSandbox.hydrateGoogleDriveFolderMetadata(gTracks, 'tok');
    assert.equal(gTracks[0].discNumber, 1, 'Google Drive CD 1 subfolder must resolve discNumber=1');
    assert.equal(gTracks[1].discNumber, 2, 'Google Drive Disc B subfolder must resolve discNumber=2');
    assert.ok(gTracks[0].remotePath.includes('CD 1') && gTracks[1].remotePath.includes('Disc B'), 'Google Drive 3-hop hydration must preserve disc folder in remotePath');
    const gCols = library.buildLibraryCollections(gTracks);
    assert.equal(gCols.albums.size, 1, 'Hydrated Google Drive CD 1 + Disc B tracks must merge into 1 album card');

    // D. SAF content://.../document/... tracks without explicit relativePath still merge CD 1 + CD 2
    const safTracks = [
      { id: 'saf1', source: 'local', uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FEnsemble%2FSAF%20Suite%2FCD%201%2F01.flac', name: '01.flac', artist: 'Ensemble', album: 'SAF Suite' },
      { id: 'saf2', source: 'local', uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FEnsemble%2FSAF%20Suite%2FCD%202%2F02.flac', name: '02.flac', artist: 'Ensemble', album: 'SAF Suite' }
    ];
    const safCols = library.buildLibraryCollections(safTracks);
    assert.equal(safCols.albums.size, 1, 'SAF CD 1 + CD 2 tracks without explicit relativePath must merge into 1 album card');
  });

  it('3. [R2-Contract] M3U/M3U8 relative-path export (no blob:/data:/appassets leaks) & collision-safe matchPlaylistWithLibrary (CD 1 vs CD 2, #EXTDISC:, SAF docId)', () => {
    const tracksToExport = [
      {
        id: 't_loc', title: 'Dawn', artist: 'Ensemble', album: 'Nocturne Suite', discNumber: 1, format: 'FLAC', duration: 210,
        url: 'blob:http://localhost/deadbeef-1',
        relativePath: 'Ensemble/Nocturne Suite/CD 1/01 - Dawn.flac'
      },
      {
        id: 't_saf', title: 'Dusk', artist: 'Ensemble', album: 'Nocturne Suite', discNumber: 2, format: 'FLAC', duration: 225,
        url: 'https://appassets.androidplatform.net/local-media?uri=content%3A%2F%2Fcom.android.externalstorage.documents%2Ftree%2Fprimary%253AMusic%2Fdocument%2Fprimary%253AMusic%252FEnsemble%252FNocturne%2520Suite%252FDisc%2520B%252F02%2520-%2520Dusk.flac',
        uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FEnsemble%2FNocturne%20Suite%2FDisc%20B%2F02%20-%20Dusk.flac',
        relativePath: 'Music/Ensemble/Nocturne Suite/Disc B/02 - Dusk.flac'
      },
      {
        id: 't_gdrive', title: 'Starlight', artist: 'Ensemble', album: 'Nocturne Suite', discNumber: 2, format: 'WAV', duration: 190,
        url: 'data:audio/wav;base64,UklGRg==',
        remotePath: 'Ensemble/Nocturne Suite/Disc B/03 - Starlight.wav'
      }
    ];

    const m3u8 = library.exportPlaylistM3u8('Nocturne Suite', tracksToExport);
    assert.ok(m3u8.includes('#EXTM3U') && m3u8.includes('#EXTENC:UTF-8'), 'M3U8 must include #EXTM3U & #EXTENC:UTF-8');
    assert.ok(m3u8.includes('#EXTALBUM:Nocturne Suite'), 'M3U8 must include #EXTALBUM:');
    assert.ok(m3u8.includes('#EXTDISC:1') && m3u8.includes('#EXTDISC:2'), 'M3U8 must include #EXTDISC:');
    assert.ok(m3u8.includes('#EXTFORMAT:FLAC') && m3u8.includes('#EXTID:t_loc'), 'M3U8 must include #EXTFORMAT: and #EXTID:');
    assert.ok(m3u8.includes('Ensemble/Nocturne Suite/CD 1/01 - Dawn.flac'), 'M3U8 must export relativePath');
    assert.ok(m3u8.includes('Ensemble/Nocturne Suite/Disc B/03 - Starlight.wav'), 'M3U8 must export remotePath');
    assert.equal(/(?:blob:|data:|appassets\.androidplatform\.net)/i.test(m3u8), false, 'exportPlaylistM3u8 must NEVER leak blob:, data:, or appassets URLs');

    const m3uLegacy = libraryTools.exportPlaylistM3U('Test', [
      { id: 't1', title: 'S', artist: 'A', url: 'blob:http://localhost/123', relativePath: 'Music/Album/CD 1/01.flac' }
    ]);
    assert.ok(m3uLegacy.includes('Music/Album/CD 1/01.flac') && !m3uLegacy.includes('blob:http://localhost/123'), 'LibraryTools.exportPlaylistM3U must prefer relativePath over blob: URL');

    // UI export buttons in index.html must route through exportPlaylistM3u8
    const albumHeroSlice = extractFn(html, 'function showAlbumHero(');
    const plExportSlice = extractBetween(html, "safeOn($('playlist-export-m3u-btn'), 'click'", "safeOn($('queue-export-m3u-btn'), 'click'");
    const qExportSlice = extractBetween(html, "safeOn($('queue-export-m3u-btn'), 'click'", "safeOn($('playlist-import-m3u-btn'), 'click'");
    assert.ok(albumHeroSlice.includes('exportPlaylistM3u8('), '#album-hero-m3u8 must route through library.exportPlaylistM3u8');
    assert.ok(plExportSlice.includes('exportPlaylistM3u8('), '#playlist-export-m3u-btn must route through library.exportPlaylistM3u8');
    assert.ok(qExportSlice.includes('exportPlaylistM3u8('), '#queue-export-m3u-btn must route through library.exportPlaylistM3u8');

    // parseM3u8Playlist parses #EXTDISC:
    const parsedM3u = library.parseM3u8Playlist('#EXTM3U\n#EXTENC:UTF-8\n#EXTINF:120,Artist - Intro\n#EXTALBUM:Album A\n#EXTDISC:2\nAlbum A/CD 2/01 - Intro.flac\n');
    assert.equal(parsedM3u.isValid, true);
    assert.equal(parsedM3u.tracks[0].discNumber, 2, 'parseM3u8Playlist must parse #EXTDISC: onto track.discNumber');

    // Collision Test A: CD 2 requested when library ONLY has CD 1 -> MUST NOT false-match CD 1
    const libOnlyCd1 = [
      { id: 'd1_01', source: 'local', relativePath: 'Album A/CD 1/01 - Intro.flac', name: '01 - Intro.flac', album: 'Album A', discNumber: 1 }
    ];
    const colA = library.matchPlaylistWithLibrary(parsedM3u.tracks, libOnlyCd1, {});
    assert.equal(colA.matchedCount, 0, 'Missing CD 2/01 - Intro.flac must NOT false-match CD 1/01 - Intro.flac');

    // Collision Test B: Library has BOTH CD 1 and CD 2 -> matches CD 2 accurately
    const libBothDiscs = [
      { id: 'd1_01', source: 'local', relativePath: 'Album A/CD 1/01 - Intro.flac', name: '01 - Intro.flac', album: 'Album A', discNumber: 1 },
      { id: 'd2_01', source: 'local', relativePath: 'Album A/CD 2/01 - Intro.flac', name: '01 - Intro.flac', album: 'Album A', discNumber: 2 }
    ];
    const colB = library.matchPlaylistWithLibrary(parsedM3u.tracks, libBothDiscs, {});
    assert.equal(colB.matchedCount, 1);
    assert.equal(colB.matchedTracks[0].local.id, 'd2_01', 'Must disambiguate CD 2 over CD 1');

    // SAF docId URI matching exported relative path
    const safLib = [
      { id: 'saf_d1', source: 'local', uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FAlbum%2FCD%201%2F01.flac', name: '01.flac' }
    ];
    const safM3u = library.parseM3u8Playlist('#EXTM3U\n#EXTINF:100,A - S\nMusic/Album/CD 1/01.flac\n');
    const safMatch = library.matchPlaylistWithLibrary(safM3u.tracks, safLib, {});
    assert.equal(safMatch.matchedCount, 1);
    assert.equal(safMatch.matchedTracks[0].local.id, 'saf_d1', 'SAF docId library track must match exported relativePath');
  });

  it('4. [R2-Contract] ReplayGain Track/Album parity (albumPeak, activeTruePeak fix, formatReplayGain, per-deck deck.replayGain GainNode & applyBitPerfectMode unity bypass)', () => {
    // A. albumPeak selection in album mode when measuredTruePeakDb is omitted
    const rgTrack = {
      replayGainTrackGain: -3.0,
      replayGainTrackPeak: 1.0, // 0 dBTP
      replayGainAlbumGain: 6.0,
      replayGainAlbumPeak: 0.5  // -6.02 dBTP -> projected +6 - 6.02 = -0.02 dBTP -> guarded to -1.0 dBTP => +5.0 dB (NOT -1.0 dB from trackPeak=1.0!)
    };
    const dynAlb = library.calculateDynamicReplayGain(rgTrack, {
      enabled: true,
      standard: 'audiophile-album',
      mode: 'album',
      preampDb: 0,
      truePeakAutoGuard: true
    });
    assert.ok(dynAlb.appliedGainDb > 4.0, `Album mode must use albumPeak (0.5 -> ~+5.0 dB), not trackPeak/0 (got ${dynAlb.appliedGainDb} dB)`);

    // B. formatReplayGain accepts calculateDynamicReplayGain shape while preserving existing contracts
    const fmtDyn = library.formatReplayGain(dynAlb);
    assert.ok(typeof fmtDyn === 'string' && fmtDyn.includes('dB') && fmtDyn !== 'Không có tag', `formatReplayGain must format calculateDynamicReplayGain output (got ${fmtDyn})`);
    assert.equal(library.formatReplayGain(null), 'Bypass');
    assert.equal(library.formatReplayGain({ hasReplayGain: false }), 'Không có tag');

    // C. index.html applyReplayGain must NOT pass state.activeTruePeak || 0
    const applyRgFn = extractFn(html, 'function applyReplayGain(track)');
    assert.equal(applyRgFn.includes('state.activeTruePeak || 0'), false, 'applyReplayGain must NOT mask peaks with state.activeTruePeak || 0');

    // D. Behavioral VM test: setupAudio/attachAudioElement creates deck.replayGain GainNode; applyBitPerfectMode(true/false) enforces strict 1.0 unity gain & preserves crossfeedNodes.output -> destination
    const attachElFn = extractFn(html, 'function attachAudioElement(element)');
    const rebuildDeckFn = extractFn(html, 'function rebuildDeckRoute(deck)');
    const rebuildRoutesFn = extractFn(html, 'function rebuildAudioRoutes()');
    const setGainFn = extractFn(html, 'function setGain(value)');
    const updRgUiFn = extractFn(html, 'function updateReplayGainUi(result = state.currentReplayGainResult)');
    const bpBadgeFn = extractFn(html, 'function resetBitPerfectModeBadge()');
    const bpModeFn = extractFn(html, 'function applyBitPerfectMode(enabled)');

    const mkGain = (init = 1) => ({
      gain: {
        value: init,
        setTargetAtTime(v) { this.value = v; },
        cancelScheduledValues() {},
        setValueAtTime(v) { this.value = v; }
      },
      _outs: [],
      connect(dest) { this._outs.push(dest); return dest; },
      disconnect() { this._outs = []; }
    });
    const ctxDest = { _isDest: true };
    const createdCrossfeedOut = mkGain(1);
    const createdCrossfeedIn = mkGain(1);
    const audioEl = { id: 'audio', src: 'blob:a', paused: true, ended: false, volume: 0.72, currentTime: 0, pause() {} };
    const standbyEl = { id: 'preload-audio', src: 'blob:b', paused: true, ended: false, volume: 0.72, currentTime: 0, pause() {} };
    const domEls = {
      'volume': { value: '72' },
      'volume-mobile': { value: '72' },
      'eq-preamp': { value: '0' },
      'eq-enabled': { checked: false },
      'bitperfect-mode-toggle': { checked: false },
      'bitperfect-mode-badge': { textContent: 'OFF', title: '', className: '' },
      'replaygain-badge': { textContent: '', className: '' },
      'replaygain-toggle': { checked: true },
      'replaygain-mode': { value: 'track' },
      'quality-badge': { textContent: '', className: '' }
    };
    const ls = makeMockStorage();
    const rgSandbox = {
      library,
      localStorage: ls,
      Math, Number, String, Boolean, Object, Array,
      $: id => domEls[id] || null,
      audio: audioEl,
      standbyAudio: standbyEl,
      isSilentUnlockSrc: () => false,
      isTrackRoutedToNativeBitPerfect: () => false,
      displayTrack: () => {},
      renderSignalPathChain: () => {},
      syncPlaybackButtonsUi: () => {},
      window: {},
      state: {
        currentId: 'tA',
        tracks: [
          { id: 'tA', title: 'Track A', replayGainTrackGain: -6.0, replayGainTrackPeak: 0.9, replayGainAlbumGain: -3.0, replayGainAlbumPeak: 0.5 },
          { id: 'tB', title: 'Track B', replayGainTrackGain: -4.0, replayGainTrackPeak: 0.8, replayGainAlbumGain: -3.0, replayGainAlbumPeak: 0.5 }
        ],
        bands: [],
        phaseInvert: false,
        roomAcousticProfile: 'bypass',
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        replayGainEnabled: true,
        replayGainMode: 'track',
        replayGainPreamp: 0,
        loudnessStandard: 'audiophile-album',
        loudnessAutoGuard: true,
        replayGainMultiplier: 1,
        currentReplayGainResult: null,
        analyser: mkGain(1),
        directAnalyser: mkGain(1),
        preLimiterAnalyser: mkGain(1),
        panner: mkGain(1),
        roomAcousticNodes: null,
        context: {
          currentTime: 10,
          sampleRate: 48000,
          destination: ctxDest,
          createMediaElementSource: el => ({ _el: el, _outs: [], connect(d) { this._outs.push(d); return d; } }),
          createGain: () => mkGain(1),
          createBiquadFilter: () => mkGain(0)
        },
        crossfeedNodes: { input: createdCrossfeedIn, output: createdCrossfeedOut },
        deckA: null,
        deckB: null,
        activeDeck: null
      }
    };
    vm.runInNewContext(`${attachElFn}\n${rebuildDeckFn}\n${rebuildRoutesFn}\n${setGainFn}\n${updRgUiFn}\n${applyRgFn}\n${bpBadgeFn}\n${bpModeFn}`, rgSandbox);

    rgSandbox.state.deckA = rgSandbox.attachAudioElement(audioEl);
    rgSandbox.state.deckB = rgSandbox.attachAudioElement(standbyEl);
    rgSandbox.state.activeDeck = rgSandbox.state.deckA;
    rgSandbox.rebuildAudioRoutes();

    assert.ok(rgSandbox.state.deckA.replayGain && rgSandbox.state.deckB.replayGain, 'attachAudioElement must create per-deck deck.replayGain GainNode');
    assert.notEqual(rgSandbox.state.deckA.replayGain, rgSandbox.state.deckB.replayGain, 'Deck A and Deck B must have distinct replayGain GainNodes');
    assert.ok(rgSandbox.state.deckA.replayGain._outs.includes(rgSandbox.state.deckA.router), 'deck.source -> deck.replayGain -> deck.router routing required');

    // Apply Track RG on Deck A (-6 dB ≈ 0.5012) while Deck B stays unaffected
    rgSandbox.applyReplayGain(rgSandbox.state.tracks[0]);
    assert.ok(Math.abs(rgSandbox.state.deckA.replayGain.gain.value - Math.pow(10, -6 / 20)) < 0.02, 'Active deckA.replayGain must track -6 dB');

    // Switch activeDeck to Deck B & apply Track B RG (-4 dB ≈ 0.631) -> Deck A gain must remain isolated
    rgSandbox.audio = standbyEl;
    rgSandbox.standbyAudio = audioEl;
    rgSandbox.state.activeDeck = rgSandbox.state.deckB;
    rgSandbox.state.currentId = 'tB';
    rgSandbox.applyReplayGain(rgSandbox.state.tracks[1]);
    assert.ok(Math.abs(rgSandbox.state.deckB.replayGain.gain.value - Math.pow(10, -4 / 20)) < 0.02, 'Active deckB.replayGain must track -4 dB');
    assert.ok(Math.abs(rgSandbox.state.deckA.replayGain.gain.value - Math.pow(10, -6 / 20)) < 0.02, 'Inactive deckA.replayGain must stay isolated during Deck A <-> Deck B swap');

    // Bit-Perfect ON -> strict unity gain (1.0) across audio/standbyAudio & both deck.replayGain nodes
    rgSandbox.applyBitPerfectMode(true);
    assert.equal(audioEl.volume, 1.0, 'Bit-Perfect ON must force audio.volume === 1.0');
    assert.equal(standbyEl.volume, 1.0, 'Bit-Perfect ON must force standbyAudio.volume === 1.0');
    assert.equal(rgSandbox.state.replayGainMultiplier, 1, 'Bit-Perfect ON must force replayGainMultiplier === 1');
    assert.equal(rgSandbox.state.deckA.replayGain.gain.value, 1, 'Bit-Perfect ON must force deckA.replayGain === 1.0');
    assert.equal(rgSandbox.state.deckB.replayGain.gain.value, 1, 'Bit-Perfect ON must force deckB.replayGain === 1.0');

    // Bit-Perfect OFF -> restores ReplayGain & preserves crossfeedNodes.output.connect(context.destination)
    rgSandbox.applyBitPerfectMode(false);
    assert.ok(Math.abs(rgSandbox.state.deckB.replayGain.gain.value - Math.pow(10, -4 / 20)) < 0.02, 'Bit-Perfect OFF must restore ReplayGain on active deck');
    assert.ok(createdCrossfeedOut._outs.includes(ctxDest), 'Bit-Perfect OFF must preserve crossfeedNodes.output.connect(context.destination)');
  });

  it('5. [Preserved] Run #88/#89/#90 Google Drive instant sync, search, delta sidecar, CUE & crossfeed invariants remain intact', () => {
    assert.ok(html.includes('GOOGLE_FOLDER_NAMES_KEY') && html.includes('GOOGLE_FOLDER_TREE_KEY'), 'Google Drive folder name/tree keys must be preserved');
    assert.ok(html.includes('function renderCollectionCards(') && html.includes('function getCloudMetadataPriority('), 'renderCollectionCards & 4-tier getCloudMetadataPriority must be preserved');
    const loadGoogleFn = extractFn(html, 'async function loadGoogleFiles()');
    const firstFinallyPos = loadGoogleFn.indexOf('} finally {');
    const secondFinallyPos = loadGoogleFn.indexOf('} finally {', firstFinallyPos + 1);
    const innerFinallySlice = (firstFinallyPos !== -1 && secondFinallyPos > firstFinallyPos)
      ? loadGoogleFn.slice(firstFinallyPos, secondFinallyPos)
      : '';
    assert.ok(innerFinallySlice.includes('queueCloudMetadata(pendingMeta)'), 'loadGoogleFiles must keep queueCloudMetadata(pendingMeta) inside finally {');

    // Run #88 mount-path matching
    const m3u88 = library.parseM3u8Playlist('#EXTM3U\n#EXTINF:240,A - S\n../Music/Jazz/01.flac\n');
    const m88 = library.matchPlaylistWithLibrary(m3u88.tracks, [
      { id: 't88', source: 'fiio', path: '/mnt/media_rw/SD/Music/Jazz/01.flac', name: '01.flac' }
    ], { playlistDir: '/storage/emulated/0/Playlists' });
    assert.equal(m88.matchedCount, 1);

    // Run #89 playlistName/folderHint disambiguation
    const m3u89 = library.parseM3u8Playlist('#EXTM3U\n#PLAYLIST:Dark Side\n#EXTINF:120,X - Intro\n./01 - Intro.flac\n');
    const lib89 = [
      { id: 'a1', source: 'local', path: 'Music/Dark Side/01 - Intro.flac', name: '01 - Intro.flac', album: 'Dark Side' },
      { id: 'b1', source: 'local', path: 'Music/Other Album/01 - Intro.flac', name: '01 - Intro.flac', album: 'Other Album' }
    ];
    assert.equal(library.matchPlaylistWithLibrary(m3u89.tracks, lib89, {}).matchedCount, 0);
    assert.equal(library.matchPlaylistWithLibrary(m3u89.tracks, lib89, { playlistName: 'Dark Side' }).matchedTracks[0].local.id, 'a1');

    // Crossfeed invariant
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  });

  it('6. [Tier5-Gap3/Gap5/Gap6] Un-treed Google Drive CD 1 isolation, Greatest Hits (Vol. 1)/(Vol. 2) distinct albums & Side B-Sides false-positive guard', () => {
    // A. Gap 3: Un-treed Google Drive 'CD 1' folders must NOT collide across unrelated albums
    const prevLs = global.localStorage;
    global.localStorage = makeMockStorage({
      'nocturne-google-folder-names': JSON.stringify({ gCd1_A: 'CD 1', gCd1_B: 'CD 1' }),
      'nocturne-google-folder-tree': JSON.stringify({})
    });
    try {
      const tAlpha = {
        id: 'google:a1', source: 'google', remoteId: 'a1', parents: ['gCd1_A'],
        title: 'Alpha 01', artist: 'Artist A', album: 'Unknown Album', cover: 'data:image/jpeg;base64,ALPHA'
      };
      const tBeta = {
        id: 'google:b1', source: 'google', remoteId: 'b1', parents: ['gCd1_B'],
        title: 'Beta 01', artist: 'Artist B', album: 'Unknown Album', cover: null
      };
      const dirA = library.extractTrackDirectory(tAlpha);
      const dirB = library.extractTrackDirectory(tBeta);
      assert.notEqual(dirA, dirB, 'Un-treed Google Drive CD 1 folders must stay anchored by parentId');
      assert.ok(dirA.includes('google::parent::gCd1_A') && dirB.includes('google::parent::gCd1_B'));
      assert.equal(library.buildLibraryCollections([tAlpha, tBeta]).albums.size, 2, 'Un-treed Google Drive CD 1 folders must remain 2 distinct albums');
      library.instantPropagateCovers([tAlpha, tBeta], new Map());
      assert.equal(tBeta.cover, null, 'Album Alpha cover must NOT leak onto unrelated un-treed Album Beta CD 1');
    } finally {
      if (prevLs === undefined) delete global.localStorage;
      else global.localStorage = prevLs;
    }

    // B. Gap 5: Separate Greatest Hits (Vol. 1)/ vs (Vol. 2)/ folders stay 2 cards; subfolders Artist/Greatest Hits/Vol. 1/ + Vol. 2/ still merge
    const sepVolCols = library.buildLibraryCollections([
      { id: 'v1', source: 'local', relativePath: 'Artist X/Greatest Hits (Vol. 1)/01.flac', title: 'Track 1', artist: 'Artist X', album: 'Greatest Hits (Vol. 1)' },
      { id: 'v2', source: 'local', relativePath: 'Artist X/Greatest Hits (Vol. 2)/01.flac', title: 'Track 2', artist: 'Artist X', album: 'Greatest Hits (Vol. 2)' }
    ]);
    assert.equal(sepVolCols.albums.size, 2, 'Separate Greatest Hits (Vol. 1)/ and (Vol. 2)/ folders must remain 2 distinct album cards');

    const subVolCols = library.buildLibraryCollections([
      { id: 'sv1', source: 'local', relativePath: 'Artist X/Greatest Hits/Vol. 1/01.flac', title: 'Track 1', artist: 'Artist X', album: 'Greatest Hits (Vol. 1)' },
      { id: 'sv2', source: 'local', relativePath: 'Artist X/Greatest Hits/Vol. 2/01.flac', title: 'Track 2', artist: 'Artist X', album: 'Greatest Hits (Vol. 2)' }
    ]);
    assert.equal(subVolCols.albums.size, 1, 'Artist X/Greatest Hits/Vol. 1/ + Vol. 2/ disc subfolders must merge into 1 album card');

    // C. Gap 6: 'Side B-Sides' must NOT parse as disc 2, while genuine Side labels still pass
    const bSides = library.parseDiscSubfolderInfo('Side B-Sides');
    assert.equal(bSides.isDiscFolder, false, 'Side B-Sides must not match as disc 2');
    assert.equal(bSides.discNumber, null);
    for (const [label, expNum] of [['Side A', 1], ['Side B', 2], ['Side 1', 1], ['Side 2', 2], ['Side A - Part 1', 1]]) {
      const info = library.parseDiscSubfolderInfo(label);
      assert.equal(info.isDiscFolder, true, `${label} must remain valid disc folder`);
      assert.equal(info.discNumber, expNum, `${label} discNumber`);
    }
  });

  it('7. [Tier5-Gap4] playViaDirectCorsBypassAudio preserves ReplayGain (and enforces 1.0 in Bit-Perfect mode)', async () => {
    const setGainFn = extractFn(html, 'function setGain(value)');
    const corsBypassFn = extractFn(html, 'async function playViaDirectCorsBypassAudio(track, playUrl, generation, playRequestedAt, prevTrackItem)');

    const bypassEl = {
      id: 'cors-fallback-audio',
      volume: 1,
      muted: false,
      playbackRate: 1,
      src: '',
      dataset: {},
      removeAttribute() {},
      load() {},
      addEventListener() {},
      pause() {},
      async play() {}
    };
    const domEls = {
      'volume': { value: '100' },
      'volume-mobile': { value: '100' },
      'play-button': { textContent: '▶' },
      'room-play': { textContent: '▶' },
      'mini-play': { textContent: '▶' },
      'fullscreen-play-btn': { textContent: '▶' }
    };
    const deckA = { element: { volume: 1.0, pause() {} }, replayGain: { gain: { value: 1.0 } } };
    const deckB = { element: { volume: 1.0, pause() {} }, replayGain: { gain: { value: 1.0 } } };
    const sandbox = {
      library,
      Math, Number, String, Boolean, Object, Array, Promise, console,
      performance: { now: () => 100 },
      $: id => domEls[id] || null,
      audio: deckA.element,
      standbyAudio: deckB.element,
      volumeBeforeMute: 100,
      getOrCreateDirectCorsBypassAudio: () => bypassEl,
      clearOptimisticLoadingUi: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      updateMiniPlayerHud: () => {},
      recordHistory: () => {},
      scheduleTrackRender: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      window: {},
      state: {
        currentId: 'ext1',
        playGeneration: 1,
        bitPerfectEnabled: false,
        usingCorsBypassAudio: false,
        corsBypassAudio: bypassEl,
        replayGainEnabled: true,
        replayGainMultiplier: Math.pow(10, -6 / 20), // -6 dB ≈ 0.5012
        context: { sampleRate: 48000 },
        deckA,
        deckB,
        activeDeck: deckA
      }
    };
    vm.runInNewContext(`${setGainFn}\n${corsBypassFn}`, sandbox);

    const ok = await sandbox.playViaDirectCorsBypassAudio(
      { id: 'ext1', title: 'External Stream', artist: 'A', album: 'B' },
      'https://stream.example.com/audio.flac',
      1,
      50,
      null
    );
    assert.equal(ok, true);
    assert.equal(sandbox.state.usingCorsBypassAudio, true);
    assert.ok(Math.abs(bypassEl.volume - Math.pow(10, -6 / 20)) < 0.01, `CORS bypass audio must apply -6 dB ReplayGain (~0.5012), got ${bypassEl.volume}`);

    // Bit-Perfect ON -> strictly 1.0 unity gain
    sandbox.state.bitPerfectEnabled = true;
    sandbox.state.usingCorsBypassAudio = false;
    sandbox.audio = deckA.element;
    await sandbox.playViaDirectCorsBypassAudio(
      { id: 'ext1', title: 'External Stream', artist: 'A', album: 'B' },
      'https://stream.example.com/audio.flac',
      1,
      50,
      null
    );
    assert.equal(bypassEl.volume, 1.0, 'CORS bypass audio in Bit-Perfect mode must remain strictly 1.0');
  });
});
