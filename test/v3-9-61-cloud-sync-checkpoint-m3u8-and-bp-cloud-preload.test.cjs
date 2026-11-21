'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. parseM3u8Playlist & matchPlaylistWithLibrary handle UTF-8 BOM, bare M3U, relative paths, Windows separators & NFC/NFD Unicode', () => {
  // 1.1 UTF-8 BOM + Windows backslashes + file:// URI + stray % / literal +
  const bomM3u = '\uFEFF#EXTM3U\r\n#PLAYLIST:FiiO MicroSD Mix\r\n..\\Jazz\\Bill Evans\\02 - Autumn Leaves.flac\r\nfile:///storage/sd/R+B/100%25%20Hits/01%20-%20Love+Song.flac\r\n';
  const parsedBom = lib.parseM3u8Playlist(bomM3u);
  assert.equal(parsedBom.isValid, true);
  assert.equal(parsedBom.name, 'FiiO MicroSD Mix');
  assert.equal(parsedBom.tracks.length, 2);
  assert.equal(parsedBom.tracks[0].file, '../Jazz/Bill Evans/02 - Autumn Leaves.flac');
  assert.equal(parsedBom.tracks[0].format, 'FLAC');
  assert.equal(parsedBom.tracks[1].file, '/storage/sd/R+B/100% Hits/01 - Love+Song.flac');

  // 1.2 Bare M3U (no #EXTM3U header, common on FiiO/Foobar2000) with NFD Vietnamese text
  const nfdName = '01 - M\u1ed9t \u0110\u1eddi.flac'.normalize('NFD');
  const bareM3u = `../Vietnam/${nfdName}\n`;
  const parsedBare = lib.parseM3u8Playlist(bareM3u);
  assert.equal(parsedBare.isValid, true);
  assert.equal(parsedBare.tracks.length, 1);

  // 1.3 resolveM3uRelativePath resolves .. and . cleanly
  assert.equal(
    lib.resolveM3uRelativePath('../Jazz/Bill Evans/02 - Autumn Leaves.flac', '/storage/sd/Playlists'),
    '/storage/sd/Jazz/Bill Evans/02 - Autumn Leaves.flac'
  );

  // 1.4 matchPlaylistWithLibrary matches relative path, path suffix & NFD/NFC Unicode against Local/FiiO & Cloud
  const libraryTracks = [
    {
      id: 'fiio_1',
      source: 'local',
      path: '/storage/sd/Jazz/Bill Evans/02 - Autumn Leaves.flac',
      name: '02 - Autumn Leaves.flac',
      title: 'Different Embedded Tag Title',
      artist: 'Bill Evans Trio'
    },
    {
      id: 'fiio_2',
      source: 'local',
      path: '/storage/sd/R+B/100% Hits/01 - Love+Song.flac',
      name: '01 - Love+Song.flac',
      title: 'Love Song',
      artist: 'Someone'
    },
    {
      id: 'od_3',
      source: 'onedrive',
      remotePath: 'Music/Vietnam/' + '01 - M\u1ed9t \u0110\u1eddi.flac'.normalize('NFC'),
      name: '01 - M\u1ed9t \u0110\u1eddi.flac'.normalize('NFC'),
      title: 'M\u1ed9t \u0110\u1eddi',
      artist: '14 Casper'
    }
  ];

  const matched = lib.matchPlaylistWithLibrary(
    parsedBom.tracks.concat(parsedBare.tracks),
    libraryTracks,
    { playlistDir: '/storage/sd/Playlists' }
  );
  assert.equal(matched.matchedCount, 3, 'All 3 tracks (relative .., file:// +/% and NFC/NFD suffix) must match');
  assert.equal(matched.matchedTracks[0].local.id, 'fiio_1');
  assert.equal(matched.matchedTracks[1].local.id, 'fiio_2');
  assert.equal(matched.matchedTracks[2].local.id, 'od_3');
});

test('2. Google Drive & OneDrive checkpoint resume saves progress on drop, resumes from checkpoint, and protects prior pages from deletion', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cpStart = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
  const cpEnd = html.indexOf('function removeCloudTracksByRemoteIds(', cpStart);
  const gStart = html.indexOf('async function loadGoogleFiles() {');
  const gEnd = html.indexOf('async function loadGoogleAudio(', gStart);
  const mStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const mEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', mStart);
  assert.ok(cpStart > 0 && cpEnd > cpStart);
  assert.ok(gStart > 0 && gEnd > gStart);
  assert.ok(mStart > 0 && mEnd > mStart);

  const ls = {};
  let gCalls = 0;
  let gDeletedCalled = 0;
  let deltaCalled = 0;

  const gSandbox = {
    GOOGLE_DRIVE_CANDIDATE_QUERY: "trashed = false",
    state: { tracks: [] },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; }
    },
    restoreCloudCatalog: async () => {},
    ensureGoogleToken: async () => 'tok_g',
    tryLoadGoogleChangesDelta: async () => { deltaCalled++; return { handled: true }; },
    fetchGoogleDrivePageWithRetry: async (url) => {
      gCalls++;
      if (gCalls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            nextPageToken: 'PAGE_2_TOK',
            files: [{ id: 'g_1', name: '01.flac', mimeType: 'audio/flac', size: '1000' }]
          })
        };
      }
      if (gCalls === 2) {
        throw new Error('Network dropped on page 2');
      }
      assert.ok(url.includes('pageToken=PAGE_2_TOK'), `Resumed Drive sync must request PAGE_2_TOK, got: ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nextPageToken: '',
          files: [{ id: 'g_2', name: '02.flac', mimeType: 'audio/flac', size: '2000' }]
        })
      };
    },
    isCloudAudio: () => true,
    googleTrack: (f) => ({ id: 'g_' + f.id, remoteId: f.id, source: 'google', name: f.name, title: f.name, size: Number(f.size), metadataLoaded: true, cover: 'https://x/c.jpg' }),
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    removeDeletedCloudTracks: async () => { gDeletedCalled++; return 0; },
    fetchGoogleStartPageToken: async () => 'START_TOK_NEW',
    renderTracks: () => {},
    scheduleBackgroundRender: () => {},
    cloudStatus: () => {},
    toast: () => {},
    propagateAndBroadcastCovers: () => {},
    queueCloudMetadata: () => {},
    URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
  };

  vm.runInNewContext(html.slice(cpStart, cpEnd) + '\n' + html.slice(gStart, gEnd) + '\nthis.loadGoogleFiles = loadGoogleFiles;', gSandbox);

  // First sync fails on page 2 -> saves PAGE_2_TOK checkpoint
  await assert.rejects(() => gSandbox.loadGoogleFiles(), /Network dropped/);
  assert.ok(ls['nocturne-google-sync-checkpoint'], 'Drive checkpoint must be saved after page 1');
  assert.equal(JSON.parse(ls['nocturne-google-sync-checkpoint']).pageToken, 'PAGE_2_TOK');

  // Second sync resumes directly from PAGE_2_TOK, skips delta, clears checkpoint, and does NOT delete page 1 tracks
  await gSandbox.loadGoogleFiles();
  assert.equal(deltaCalled, 0, 'Resumed checkpoint sync must skip delta sync until initial scan finishes');
  assert.equal(gDeletedCalled, 0, 'Resumed partial scan must NOT run removeDeletedCloudTracks on incomplete seenRemoteIds');
  assert.equal(ls['nocturne-google-sync-checkpoint'], undefined, 'Drive checkpoint must be cleared upon clean completion');
  assert.equal(gSandbox.state.tracks.length, 2);

  // OneDrive checkpoint: fails on Folder B -> saves Folder B -> resumes directly at Folder B
  const msLs = {};
  let msCalls = 0;
  let msDeletedCalled = 0;
  const msSandbox = {
    state: { tracks: [], microsoftAccessToken: '' },
    library: lib,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(msLs, k) ? msLs[k] : null),
      setItem: (k, v) => { msLs[k] = String(v); },
      removeItem: (k) => { delete msLs[k]; }
    },
    restoreCloudCatalog: async () => {},
    graphGet: async (url) => {
      msCalls++;
      if (url.includes('/root/children')) {
        return {
          value: [
            { id: 'f_audio_1', name: 'root.flac', file: { mimeType: 'audio/flac' }, size: 1000 },
            { id: 'dir_b', name: 'AlbumB', folder: { childCount: 1 } }
          ]
        };
      }
      if (msCalls === 2) throw new Error('OneDrive dropped mid-folder');
      assert.ok(url.includes('dir_b'), `Resumed OneDrive sync must fetch dir_b, got: ${url}`);
      return {
        value: [{ id: 'f_audio_2', name: 'b1.flac', file: { mimeType: 'audio/flac' }, size: 2000 }]
      };
    },
    isCloudAudio: (it) => Boolean(it && it.file),
    microsoftTrack: (it, p) => ({ id: 'od_' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p, size: it.size, metadataLoaded: true, cover: 'https://x/c.jpg' }),
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    removeDeletedCloudTracks: async () => { msDeletedCalled++; return 0; },
    renderTracks: () => {},
    scheduleTrackRender: () => {},
    cloudStatus: () => {},
    toast: () => {},
    propagateAndBroadcastCovers: () => {},
    queueCloudMetadata: () => {},
    encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
  };
  vm.runInNewContext(html.slice(cpStart, cpEnd) + '\n' + html.slice(mStart, mEnd) + '\nthis.loadMicrosoftFiles = loadMicrosoftFiles;', msSandbox);

  await assert.rejects(() => msSandbox.loadMicrosoftFiles('tok_ms'), /OneDrive dropped/);
  assert.ok(msLs['nocturne-microsoft-sync-checkpoint'], 'OneDrive checkpoint must save failed active batch');
  assert.ok(JSON.parse(msLs['nocturne-microsoft-sync-checkpoint']).queue.some(q => q.url.includes('dir_b')));

  await msSandbox.loadMicrosoftFiles('tok_ms');
  assert.equal(msDeletedCalled, 0, 'Resumed OneDrive scan must NOT prune tracks from earlier folders');
  assert.equal(msLs['nocturne-microsoft-sync-checkpoint'], undefined, 'OneDrive checkpoint must clear upon completion');
  assert.equal(msSandbox.state.tracks.length, 2);
});

test('3. preloadCloudNextDuringBitPerfect pre-warms upcoming Cloud track without touching AudioContext + v3.9.61+ alignment', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

  const pStart = html.indexOf('let bpCloudPreloadTrackId = null;');
  const pEnd = html.indexOf('async function preloadNext(', pStart);
  assert.ok(pStart > 0 && pEnd > pStart);

  let prepped = 0;
  let loaded = 0;
  const nextCloud = {
    id: 'gd_next_1',
    source: 'google',
    isDsd: false,
    url: '',
    load: async () => { loaded++; nextCloud.url = 'blob:https://nocturne.local/cloud-1'; }
  };
  const sandbox = {
    state: {
      isNativeBitPerfectPlaying: true,
      context: null, // Intentionally null during Native Bit-Perfect!
      activeFocus: 'all',
      currentId: 'fiio_local_1',
      tracks: [{ id: 'fiio_local_1', source: 'local' }, nextCloud],
      objectUrls: new Set(),
      preloadGeneration: 0,
      preloadTrackId: null,
      preloadBusyId: null,
      preloadReadyUrl: null
    },
    navigator: { onLine: true },
    queueIndex: () => 1,
    prepareCloudTrackForPreload: async () => { prepped++; },
    Set, Date, Promise
  };
  vm.runInNewContext(html.slice(pStart, pEnd) + '\nthis.preloadCloudNextDuringBitPerfect = preloadCloudNextDuringBitPerfect;', sandbox);

  await sandbox.preloadCloudNextDuringBitPerfect();
  assert.equal(prepped, 1, 'Must refresh cloud token/downloadUrl before loading');
  assert.equal(loaded, 1, 'Must load next cloud track even when state.context is null');
  assert.equal(sandbox.state.preloadReadyUrl, 'blob:https://nocturne.local/cloud-1');
  assert.ok(html.includes('preloadCloudNextDuringBitPerfect();'), 'onNativeBitPerfectPosition must trigger Bit-Perfect cloud pre-warm');

  assert.match(html, /FiiO M11S · v3\.9\.(6[1-9]|[7-9]\d|\d{3,})/);
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(6[1-9]|[7-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(6[1-9]|[7-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 115, `Expected versionCode >= 115, got ${vcMatch && vcMatch[1]}`);
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(6[1-9]|[7-9]\d|\d{3,})"/);
});
