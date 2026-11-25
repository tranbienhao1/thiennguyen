'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const library = require(path.join(ROOT, 'library-utils.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
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

describe('v3.9.103 R2 — Google/OneDrive Delta Sidecars, CUE Hot-Swap, Android SAF & User Field Preservation', () => {
  it('1. Google Drive Delta: .lrc metadataRetryAt clear + NFC trash, disc-subfolder folder.jpg propagation, & permanent change.removed sidecar cleanup', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS =', 'let cloudMetadataQueue =');
    const gArtSlice = extractBetween(html, 'function applyDiscoveredCloudFolderCover(', 'const GOOGLE_DRIVE_SHORTCUT_QUERY =');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    const ls = makeMockStorage({
      'nocturne-google-folder-tree': JSON.stringify({
        gAlbum: ['root'],
        gCd1: ['gAlbum']
      }),
      'nocturne-google-folder-names': JSON.stringify({
        gAlbum: 'Dark Side',
        gCd1: 'CD 1'
      })
    });

    const cdTrack = {
      id: 'google:cd1_tr', remoteId: 'cd1_tr', source: 'google',
      parents: ['gCd1'], name: '01 - Speak.flac', title: 'Speak', artist: 'Floyd', album: 'Dark Side',
      metadataLoaded: true, // hasEmbeddedCover === undefined!
      cover: 'data:image/jpeg;base64,OLD_CD_ART',
      folderCoverId: 'gOldCov',
      lyricsText: '[00:01.00] Old CD1 LRC', lyricsSource: 'cloud-sidecar',
      _checkedDriveLrc: true,
      metadataRetryAt: Date.now() + 3600000,
      replayGainTrackGain: -4.1, rating: 5, playCount: 7, isFavorite: true
    };
    const permDelTrack = {
      id: 'google:perm_tr', remoteId: 'perm_tr', source: 'google',
      parents: ['gPermDir'], name: 'NFDTrack.flac', title: 'Perm Track', artist: 'Artist', album: 'Perm Album',
      metadataLoaded: true, hasEmbeddedCover: false,
      cover: 'data:image/jpeg;base64,PERM_OLD_ART',
      folderCoverId: 'gPermCovId',
      driveLrcId: 'gPermLrcId',
      lyricsText: '[00:01.00] Perm LRC', lyricsSource: 'cloud-sidecar',
      _checkedDriveLrc: true,
      metadataRetryAt: Date.now() + 3600000,
      replayGainAlbumGain: -6.0
    };
    const nfcTrack = {
      id: 'google:nfc_tr', remoteId: 'nfc_tr', source: 'google',
      parents: ['gNfcDir'], name: 'Ba\u0300i Ha\u0301t.flac', // NFD!
      metadataLoaded: true, hasEmbeddedCover: true, cover: 'data:image/jpeg;base64,EMB_KEEP',
      lyricsText: '[00:01.00] NFC LRC', lyricsSource: 'cloud-sidecar', _checkedDriveLrc: true,
      metadataRetryAt: Date.now() + 3600000
    };

    const albumCovers = new Map([
      [library.buildAlbumKey(permDelTrack), 'data:image/jpeg;base64,PERM_OLD_ART']
    ]);
    const checkedGoogleArtParents = new Set(['gAlbum', 'gCd1', 'gPermDir', 'gNfcDir']);
    const sandbox = {
      library,
      localStorage: ls,
      state: { tracks: [cdTrack, permDelTrack, nfcTrack], albumCovers, googleToken: 'g-tok' },
      checkedGoogleArtParents,
      GOOGLE_DELTA_TOKEN_KEY: 'nocturne-google-delta-token',
      GOOGLE_FOLDER_TREE_KEY: 'nocturne-google-folder-tree',
      GOOGLE_FOLDER_NAMES_KEY: 'nocturne-google-folder-names',
      trackMetadataRevision: 0,
      URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, RegExp, JSON, Error, Promise, console, encodeURIComponent,
      readCloudDeltaCursor: () => 'g-cur-1',
      writeCloudDeltaCursor: () => {},
      readCloudFolderTree: k => { try { return JSON.parse(ls.getItem(k) || '{}'); } catch (_) { return {}; } },
      writeCloudFolderTree: (k, v) => ls.setItem(k, JSON.stringify(v)),
      buildChildFolderIndex: (tree, getParents) => {
        const m = new Map();
        for (const [fid, entry] of Object.entries(tree || {})) {
          for (const pid of getParents(entry)) {
            if (!m.has(pid)) m.set(pid, new Set());
            m.get(pid).add(String(fid));
          }
        }
        return m;
      },
      ensureGoogleToken: async () => 'g-tok',
      isCloudAudio: f => /\.(flac|wav|mp3)$/i.test(String((f && f.name) || '')),
      googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      releaseUnusedCloudUrl: () => {},
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      propagateAndBroadcastCovers: () => {},
      syncAlbumCoversImmediate: () => {},
      broadcastCoverUpdate: () => {},
      saveAlbumCoversCache: () => {},
      cloudStatus: () => {},
      toast: () => {},
      fetchCloudImageCandidateDataUrl: async () => 'data:image/jpeg;base64,NEW_ALBUM_ART',
      fetchGoogleDrivePageWithRetry: async url => {
        if (url.includes('/drive/v3/changes')) {
          return {
            ok: true, status: 200,
            json: async () => ({
              newStartPageToken: 'g-cur-2',
              changes: [
                // folder.jpg updated in parent album folder gAlbum -> must propagate to disc subfolder gCd1!
                { fileId: 'gNewArt', removed: false, file: { id: 'gNewArt', name: 'folder.jpg', parents: ['gAlbum'] } },
                // .lrc updated in parent gAlbum -> must propagate to gCd1, clear metadataRetryAt, mark _lrcDirty!
                { fileId: 'gNewLrc', removed: false, file: { id: 'gNewLrc', name: '01 - Speak.lrc', parents: ['gAlbum'] } },
                // Permanent delete (removed:true with NO file object) of gPermCovId & gPermLrcId
                { fileId: 'gPermCovId', removed: true },
                { fileId: 'gPermLrcId', removed: true },
                // NFC-vs-NFD trashed .lrc
                { fileId: 'gNfcDeadLrc', removed: false, file: { id: 'gNfcDeadLrc', name: 'Bài Hát.lrc', parents: ['gNfcDir'], trashed: true } }
              ]
            })
          };
        }
        return {
          ok: true, status: 200,
          json: async () => ({ files: [{ id: 'gNewArt', name: 'folder.jpg', parents: ['gAlbum'], thumbnailLink: 'https://lh3/new=s220' }] })
        };
      }
    };
    vm.runInNewContext(
      `${serSlice}\n${gArtSlice}\n${gDeltaSlice}\nthis.serializableCloudTrack = serializableCloudTrack;\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;\nthis.discoverGoogleDriveFolderArtwork = discoverGoogleDriveFolderArtwork;`,
      sandbox
    );

    const ser = sandbox.serializableCloudTrack(permDelTrack);
    assert.equal(ser.driveLrcId, 'gPermLrcId');
    assert.equal(ser.folderCoverId, 'gPermCovId');

    const deltaRes = await sandbox.tryLoadGoogleChangesDelta(
      'g-tok',
      new Map([['cd1_tr', cdTrack], ['perm_tr', permDelTrack], ['nfc_tr', nfcTrack]]),
      new Set(['cd1_tr', 'perm_tr', 'nfc_tr'])
    );
    assert.equal(deltaRes.handled, true);
    assert.equal(cdTrack._checkedDriveLrc, false, 'Disc-subfolder track must re-check .lrc when parent .lrc changes');
    assert.equal(cdTrack.metadataRetryAt, undefined, '.lrc delta must clear 1-hour metadataRetryAt throttle');
    assert.equal(cdTrack._lrcDirty, true, '.lrc delta must mark _lrcDirty when cloud-sidecar lyrics existed');
    assert.equal(cdTrack._needsFolderCoverRefresh, true, 'folder.jpg delta in album parent must mark CD 1 subfolder track _needsFolderCoverRefresh');
    assert.equal(cdTrack.rating, 5);
    assert.equal(cdTrack.playCount, 7);
    assert.equal(cdTrack.isFavorite, true);
    assert.equal(cdTrack.replayGainTrackGain, -4.1);

    // Permanent delete (change.removed without change.file)
    assert.equal(permDelTrack.cover, null, 'Permanent change.removed on folderCoverId must clear non-embedded cover');
    assert.equal(permDelTrack.folderCoverId, undefined);
    assert.equal(permDelTrack.lyricsText, '', 'Permanent change.removed on driveLrcId must clear cloud-sidecar lyrics');
    assert.equal(permDelTrack.driveLrcId, undefined);
    assert.equal(permDelTrack.metadataRetryAt, undefined);
    assert.equal(permDelTrack.replayGainAlbumGain, -6.0);

    // NFC vs NFD trashed .lrc
    assert.equal(nfcTrack.lyricsText, '', 'Trashed NFC .lrc must match NFD track name');
    assert.equal(nfcTrack.cover, 'data:image/jpeg;base64,EMB_KEEP', 'Embedded cover must stay untouched');
  });

  it('2. OneDrive Delta: /drive/root:/ strip, metadataRetryAt clear, loadMicrosoftFiles finally await ordering, msLrcId serialization & deleted folder.jpg', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS =', 'let cloudMetadataQueue =');
    const msArtSlice = extractBetween(html, 'async function applyMicrosoftSiblingFolderCovers(', 'async function enqueueMicrosoftSharedItems(');
    const msDeltaSlice = extractBetween(html, 'async function tryLoadMicrosoftDeltaSync(', 'async function verifyMicrosoftAccountSwitch(');
    const loadMsSlice = extractBetween(html, 'async function loadMicrosoftFiles(token) {', 'const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS =');

    // A. Verify loadMicrosoftFiles finally awaits sibling cover & lrc links BEFORE queueCloudMetadata
    const finallyStart = loadMsSlice.indexOf('} finally {', loadMsSlice.indexOf('} catch (error) {'));
    const finallyBlock = loadMsSlice.slice(finallyStart, loadMsSlice.indexOf('} finally {', finallyStart + 10));
    const lrcIdx = finallyBlock.indexOf('await applyMicrosoftSiblingLrcLinks(siblingLrcByBase)');
    const covIdx = finallyBlock.indexOf('await applyMicrosoftSiblingFolderCovers(siblingCoversByDir)');
    const qIdx = finallyBlock.indexOf('queueCloudMetadata(pendingMsMeta)');
    assert.ok(covIdx !== -1 && lrcIdx !== -1 && qIdx !== -1 && covIdx < qIdx && lrcIdx < qIdx,
      'loadMicrosoftFiles finally must await applyMicrosoftSiblingFolderCovers & applyMicrosoftSiblingLrcLinks before queueCloudMetadata');

    // B. Behavioral test: OneDrive delta deleted folderCoverId across disc subfolder + /drive/root:/ strip in applyMicrosoftSiblingLrcLinks + msLrcId serialization
    const ls = makeMockStorage({
      'nocturne-onedrive-folder-tree': JSON.stringify({
        msAlbum: { parentId: '', path: 'Music/AlbumA', driveId: '', folderCoverId: 'msCov1' },
        msCd1: { parentId: 'msAlbum', path: 'Music/AlbumA/CD 1', driveId: '' }
      })
    });
    const msTrack = {
      id: 'onedrive:m1', remoteId: 'm1', source: 'onedrive',
      remoteParentId: 'msCd1',
      remotePath: '/drive/root:/Music/AlbumA/CD 1/01 - Song.flac',
      name: '01 - Song.flac',
      artist: 'MS Artist', album: 'AlbumA',
      metadataLoaded: true, hasEmbeddedCover: false,
      cover: 'data:image/jpeg;base64,OLD_MS_COV',
      folderCoverId: 'msCov1',
      lyricsText: '[00:01.00] Old LRC', lyricsSource: 'cloud-sidecar',
      _cloudLrcChecked: true,
      metadataRetryAt: Date.now() + 3600000,
      replayGainTrackGain: -3.5, rating: 4, playCount: 9
    };
    const siblingCoversByDir = new Map();
    const siblingLrcByBase = new Map();
    const sandbox = {
      library,
      localStorage: ls,
      state: { tracks: [msTrack], albumCovers: new Map([[library.buildAlbumKey(msTrack), 'data:image/jpeg;base64,OLD_MS_COV']]), microsoftAccessToken: 'ms-tok' },
      MICROSOFT_DELTA_LINK_KEY: 'nocturne-microsoft-delta-link',
      MICROSOFT_FOLDER_TREE_KEY: 'nocturne-onedrive-folder-tree',
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error, Promise, console, encodeURIComponent,
      readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=1',
      writeCloudDeltaCursor: () => {},
      readCloudFolderTree: k => { try { return JSON.parse(ls.getItem(k) || '{}'); } catch (_) { return {}; } },
      writeCloudFolderTree: (k, v) => ls.setItem(k, JSON.stringify(v)),
      buildChildFolderIndex: (tree, getParents) => {
        const m = new Map();
        for (const [fid, entry] of Object.entries(tree || {})) {
          for (const pid of getParents(entry)) {
            if (!m.has(pid)) m.set(pid, new Set());
            m.get(pid).add(String(fid));
          }
        }
        return m;
      },
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      releaseUnusedCloudUrl: () => {},
      propagateAndBroadcastCovers: () => {},
      syncAlbumCoversImmediate: () => {},
      broadcastCoverUpdate: () => {},
      saveAlbumCoversCache: () => {},
      scheduleTrackRender: () => {},
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {},
      isCloudAudio: () => false,
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p }),
      mergeMicrosoftTrack: () => {},
      graphGet: async () => ({
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=2',
        value: [
          { id: 'msCov1', deleted: { state: 'deleted' } },
          { id: 'msNewLrc1', name: '01 - Song.lrc', cTag: 'c-new', parentReference: { id: 'msCd1', path: '/drive/root:/Music/AlbumA/CD 1' }, '@microsoft.graph.downloadUrl': 'https://1drv.ms/lrc-new' }
        ]
      })
    };
    vm.runInNewContext(
      `${serSlice}\n${msArtSlice}\n${msDeltaSlice}\nthis.serializableCloudTrack = serializableCloudTrack;\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;\nthis.applyMicrosoftSiblingLrcLinks = applyMicrosoftSiblingLrcLinks;`,
      sandbox
    );

    const msRes = await sandbox.tryLoadMicrosoftDeltaSync(
      'ms-tok',
      new Map([['m1', msTrack]]),
      new Set(['m1']),
      siblingCoversByDir,
      siblingLrcByBase
    );
    assert.equal(msRes.handled, true);
    assert.equal(msTrack.cover, null, 'Deleted folderCoverId must invalidate non-embedded cover even in CD 1 subfolder');
    assert.equal(sandbox.state.albumCovers.size, 0, 'Deleted folderCoverId must prune orphaned state.albumCovers');
    assert.equal(msTrack.replayGainTrackGain, -3.5);
    assert.equal(msTrack.rating, 4);
    assert.equal(msTrack.playCount, 9);

    // applyMicrosoftSiblingLrcLinks strips /drive/root:/ from msTrack.remotePath, clears metadataRetryAt, sets msLrcId
    const linked = await sandbox.applyMicrosoftSiblingLrcLinks(siblingLrcByBase);
    assert.equal(linked, 1);
    assert.equal(msTrack.msLrcId, 'msNewLrc1');
    assert.equal(msTrack.metadataRetryAt, undefined, 'applyMicrosoftSiblingLrcLinks must clear metadataRetryAt');
    assert.equal(msTrack._cloudLrcChecked, false);
    assert.equal(msTrack._lrcDirty, true);

    const serMs = sandbox.serializableCloudTrack(msTrack);
    assert.equal(serMs.msLrcId, 'msNewLrc1', 'serializableCloudTrack must persist msLrcId');
  });

  it('3. FiiO & Android SAF: DocumentsContract art signature, CUE Scan #2 virtual parent, &v= busting, SAF .cue pruning, ReplayGain compaction & deleted .lrc clearing', async () => {
    // A. MainActivity.java SAF DocumentsContract art signature & /local-cover &v= cache busting
    assert.ok(
      mainJava.includes('private String computeSafDirArtSignature(Uri treeUri, String dirDocId, boolean checkArtworkSubdirs)') &&
      mainJava.includes('DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId)') &&
      mainJava.includes('private String computeFolderArtVersionSignature(@Nullable String pathOrUri)') &&
      mainJava.includes('public String getFolderArtVersionSignature(@Nullable String pathOrUri)') &&
      mainJava.includes('extractLocalMediaQueryParam(uri, "v")'),
      'MainActivity.java must expose DocumentsContract SAF art signature & &v= cache busting'
    );

    // B. library.buildFiioCoverUrl varies &v= when _coverVersion changes even if audio lastModified is identical
    const cov1 = library.buildFiioCoverUrl({ path: '/storage/SD/Album/album.flac', lastModified: 1000, _coverVersion: 'art:folder.jpg:123:5000' });
    const cov2 = library.buildFiioCoverUrl({ path: '/storage/SD/Album/album.flac', lastModified: 1000, _coverVersion: 'art:folder.jpg:456:6000' });
    const covNone = library.buildFiioCoverUrl({ path: '/storage/SD/Album/album.flac', lastModified: 1000, _coverVersion: 'none' });
    assert.notEqual(cov1, cov2);
    assert.notEqual(cov2, covNone);

    // C. FiiO Scan #2 CUE rescan (standalone parent pruned on Scan #1), _coverVersion propagation across all CUE siblings, compaction, & SAF .cue pruning
    const fiioSlice = extractBetween(html, 'let fiioScanWatchdogTimer = null;', 'function deduplicateStorageRoots(');
    const fiioCompactSlice = extractBetween(html, 'function compactFiioTrackForStorage(t, ultraLean) {', 'function saveFiioCatalog(');
    const fiioPruneSlice = extractBetween(html, 'function extractStorageRootPrefix(rawPath) {', 'function finalizeFiioScanUi(');
    const triggerLyricsSlice = extractBetween(html, 'async function triggerLyricsFetch(track) {', 'function updateLyricsHighlight(');

    const cueContent = [
      'PERFORMER "FiiO Artist"',
      'TITLE "FiiO CUE Album Renamed"',
      'FILE "album.flac" WAVE',
      '  TRACK 01 AUDIO',
      '    TITLE "Track One Remastered"',
      '    INDEX 01 00:00:00',
      '  TRACK 02 AUDIO',
      '    TITLE "Track Two Shifted"',
      '    INDEX 01 03:10:00',
      ''
    ].join('\n');

    const sub1 = {
      id: 'fiio_cue_s1', source: 'local', isCue: true,
      cueFilePath: '/storage/SD/Album/album.cue',
      cueDedupKey: '/storage/SD/Album/album.cue::cue::1-0',
      cueStart: 0, cueEnd: 180, duration: 180, _cueParentDuration: 420,
      trackNumber: 1, title: 'Track One Old', name: 'Track One Old',
      artist: 'FiiO Artist', album: 'FiiO CUE Album',
      path: '/storage/SD/Album/album.flac',
      url: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2FSD%2FAlbum%2Falbum.flac',
      cover: cov1, _coverVersion: 'art:folder.jpg:123:5000',
      size: 50000000, lastModified: 1000,
      replayGainTrackGain: -5.1, replayGainTrackPeak: 0.92, replayGainAlbumGain: -6.2, replayGainAlbumPeak: 0.96,
      iTunNORM: '0000F110', hasReplayGain: true, rating: 5
    };
    const sub2 = {
      id: 'fiio_cue_s2', source: 'local', isCue: true,
      cueFilePath: '/storage/SD/Album/album.cue',
      cueDedupKey: '/storage/SD/Album/album.cue::cue::2-18000', // shifted from 180s -> 190s!
      cueStart: 180, cueEnd: 0, duration: 240, _cueParentDuration: 420,
      trackNumber: 2, title: 'Track Two Old', name: 'Track Two Old',
      artist: 'FiiO Artist', album: 'FiiO CUE Album',
      path: '/storage/SD/Album/album.flac',
      url: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2FSD%2FAlbum%2Falbum.flac',
      cover: cov1, _coverVersion: 'art:folder.jpg:123:5000',
      size: 50000000, lastModified: 1000,
      replayGainTrackGain: -4.8, iTunNORM: '0000F220', hasReplayGain: true, rating: 4
    };

    const sandbox = {
      library,
      URL, Map, Set, Array, Object, String, Number, Boolean, Math, JSON, Date, Promise, encodeURIComponent,
      state: {
        tracks: [sub1, sub2],
        currentId: null,
        queueTrackIds: [],
        recentHistory: [],
        favorites: new Set(),
        lyricsPreloadLifecycle: { isOnline: () => false }
      },
      window: {
        NocturneNative: {
          getFolderArtVersionSignature: () => 'art:folder.jpg:456:6000',
          readLocalTextFile: p => (p === '/storage/SD/Album/album.cue' ? cueContent : ''),
          hasValidPersistedUriPermission: () => true,
          readLocalLyrics: () => ''
        }
      },
      $: () => null,
      renderLyrics: () => {},
      toast: () => {},
      restoreLocalTrackUrlSync: () => {},
      pruneOrphanedAlbumCovers: () => {},
      localStorage: makeMockStorage()
    };
    vm.runInNewContext(
      `${fiioSlice}\n${fiioCompactSlice}\n${fiioPruneSlice}\n${triggerLyricsSlice}\nthis.compactFiioTrackForStorage = compactFiioTrackForStorage;\nthis.hydrateFiioStoredTrack = hydrateFiioStoredTrack;\nthis.triggerLyricsFetch = triggerLyricsFetch;`,
      sandbox
    );

    // 1. compactFiioTrackForStorage persists ReplayGain & _cueParentDuration
    const compact = sandbox.compactFiioTrackForStorage(sub1, false);
    assert.equal(compact._cueParentDuration, 420);
    assert.equal(compact.replayGainTrackGain, -5.1);
    assert.equal(compact.replayGainAlbumGain, -6.2);
    assert.equal(compact.iTunNORM, '0000F110');
    assert.equal(compact.hasReplayGain, true);
    const compactLean = sandbox.compactFiioTrackForStorage(sub1, true);
    assert.equal(compactLean._cueParentDuration, 420, '_cueParentDuration must survive ultraLean compaction');

    // 2. Scan #2 ingestFiioScannedFilesChunk updates _coverVersion & busts cover across BOTH subtracks
    const sets = sandbox.buildExistingFiioTrackSets();
    const collectedCues = [];
    sandbox.ingestFiioScannedFilesChunk([
      { path: '/storage/SD/Album/album.flac', name: 'album.flac', size: 50000000, lastModified: 1000, duration: 420, sampleRate: 96000, bitDepth: 24 },
      { path: '/storage/SD/Album/album.cue', name: 'album.cue' }
    ], sets.existingPaths, sets.existingUris, collectedCues);
    assert.equal(sub1._coverVersion, 'art:folder.jpg:456:6000');
    assert.equal(sub2._coverVersion, 'art:folder.jpg:456:6000');
    assert.equal(collectedCues.length, 1);

    // 3. expandFiioScannedCueSheets updates Track 1 & Track 2 (even with shifted INDEX 01) in-place preserving ReplayGain & ratings
    sandbox.expandFiioScannedCueSheets(collectedCues);
    assert.equal(sandbox.state.tracks.length, 2, 'No duplicate CUE tracks or virtual parent left in state.tracks');
    assert.equal(sub1.title, 'Track One Remastered');
    assert.equal(sub1.album, 'FiiO CUE Album Renamed');
    assert.equal(sub1.duration, 190, 'Track 1 duration must update from 180 -> 190 when Track 2 shifts to 3:10');
    assert.equal(new URL(sub1.cover).searchParams.get('v'), new URL(cov2).searchParams.get('v'), 'Track 1 cover must bust to new &v=');
    assert.notEqual(new URL(sub1.cover).searchParams.get('v'), new URL(cov1).searchParams.get('v'));
    assert.equal(sub2.id, 'fiio_cue_s2', 'Track 2 matched by trackNo fallback retains exact ID');
    assert.equal(sub2.cueStart, 190);
    assert.equal(sub2.duration, 230);
    assert.equal(new URL(sub2.cover).searchParams.get('v'), new URL(cov2).searchParams.get('v'), 'Track 2 cover must bust to new &v=');
    assert.equal(sub2.replayGainTrackGain, -4.8);
    assert.equal(sub2.rating, 4);

    // 4. Deleted .cue sheet under SAF content:// URI prunes CUE subtracks and restores parent standalone audio
    const safSub = {
      id: 'fiio_saf_c1', source: 'local', isCue: true,
      cueFilePath: '/storage/SD/SafAlb/saf.cue',
      path: '/storage/SD/SafAlb/saf.flac',
      uri: 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/saf.flac'
    };
    sandbox.state.tracks.push(safSub);
    const parentDescMap = new Map([
      ['/storage/SD/SafAlb/saf.flac', { path: '/storage/SD/SafAlb/saf.flac', uri: safSub.uri, name: 'saf.flac', size: 12345, lastModified: 2000 }]
    ]);
    const pruned = sandbox.pruneMissingFiioTracks(
      new Set(['/storage/SD/Album/album.flac', '/storage/SD/Album/album.cue', '/storage/SD/SafAlb/saf.flac']),
      new Set([safSub.uri]),
      { cueParentFilesByPath: parentDescMap }
    );
    assert.equal(pruned, 1, 'Deleted SAF .cue must prune orphaned SAF CUE subtrack');
    assert.ok(sandbox.state.tracks.some(t => !t.isCue && t.path === '/storage/SD/SafAlb/saf.flac'), 'Parent audio restored when SAF .cue deleted');

    // 5. triggerLyricsFetch clears stale local-sidecar lyrics & ignores stale local-sidecar vault hit when native readLocalLyrics returns ""
    const lrcTrack = {
      id: 'fiio_lrc_1', path: '/storage/SD/Album/01.flac',
      title: 'Song', artist: 'Artist',
      lyricsText: '[00:01.00] Stale Sidecar', lyricsSource: 'local-sidecar',
      lyricsVaultEntry: { lrcText: '[00:01.00] Stale Sidecar', source: 'local-sidecar' }
    };
    sandbox.LrclibClient = {
      getLyricsFromVault: async () => ({ lrc: '[00:01.00] Vault Sidecar', source: 'local-sidecar' })
    };
    await sandbox.triggerLyricsFetch(lrcTrack);
    assert.equal(lrcTrack.lyricsText, '', 'Deleted native .lrc must clear stale local-sidecar lyricsText');
    assert.equal(lrcTrack.lyricsSource, '');
    assert.equal(lrcTrack.lyricsVaultEntry, null);
  });

  it('4. Web Local CUE Hot-Swap (Probe 2b cache hydration, embedded cover survival, shifted INDEX 01, deleted folder.jpg), size-change re-tag & trackAnnotations migration', async () => {
    const metaCacheSlice = extractBetween(html, 'const LOCAL_META_CACHE_KEY =', 'function decodeTextBytesAuto(');
    const restoreUrlSlice = extractBetween(html, 'function restoreLocalTrackUrlSync(track) {', 'async function probeLocalMediaAccessError(');
    const statMigSlice = extractBetween(html, 'function getTrackUserStatKeys(track) {', 'function updateRoomRating(');
    const localSlice = extractBetween(html, 'function buildLocalCueSubTrack(', 'function quality(track)');

    const ls = makeMockStorage();
    let seqId = 0;
    const revokedUrls = [];
    const MockUrl = function (u, b) { return new URL(u, b); };
    MockUrl.createObjectURL = f => `blob:mock-${++seqId}-${(f && f.name) || 'x'}`;
    MockUrl.revokeObjectURL = u => revokedUrls.push(u);

    const EMB_COV = 'data:image/png;base64,EMBEDDED_PNG';
    let makeLocalCalls = 0;
    let currentCueText = [
      'PERFORMER "Web Artist"',
      'TITLE "Web CUE Suite"',
      'FILE "suite.flac" WAVE',
      '  TRACK 01 AUDIO',
      '    TITLE "Movement I"',
      '    INDEX 01 00:00:00',
      '  TRACK 02 AUDIO',
      '    TITLE "Movement II"',
      '    INDEX 01 03:00:00',
      ''
    ].join('\n');

    const sandbox = {
      library,
      localStorage: ls,
      URL: MockUrl,
      AUDIO_TYPES: /\.(mp3|wav|ogg|m4a|flac|aac|opus|alac|aiff|aif|ape|wv)$/i,
      STREAM_AUDIO_TYPES: /\.(dsf|dff)$/i,
      PLAY_COUNTS_KEY: 'nocturne-play-counts',
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Promise,
      setTimeout, clearTimeout,
      console: { warn: (...a) => console.error('TEST4_WARN:', ...a) },
      id: () => 'loc_' + (++seqId),
      state: {
        tracks: [],
        objectUrls: new Set(),
        albumCovers: new Map(),
        currentId: null,
        queueTrackIds: [],
        recentHistory: [],
        favorites: new Set(),
        trackRatings: {},
        trackAnnotations: {}
      },
      getTags: async f => ({ title: f.name, artist: f._artist || 'Web Artist', album: f._album || 'Web CUE Suite', cover: f._noEmb ? null : EMB_COV }),
      readAudioMetadata: async f => {
        makeLocalCalls++;
        return {
          duration: f._dur || 540,
          sampleRate: f._sr || 96000,
          bitDepth: f._bd || 24,
          channels: 2,
          ...(f._rg !== undefined ? { replayGainTrackGain: f._rg } : {})
        };
      },
      filenameMetadata: n => library.parseFilenameMetadata(n),
      normalizeCoverImage: async c => c || null,
      readLocalTextFileAuto: async f => f._text || '',
      getTrackRating: tr => Number(tr.rating) || 0,
      loadPlayCountsMap: () => { try { return JSON.parse(ls.getItem('nocturne-play-counts') || '{}'); } catch (_) { return {}; } },
      saveFavorites: () => {},
      syncAlbumCoversImmediate: (cov, tr) => {
        const ak = library.buildAlbumKey(tr);
        if (ak && cov) sandbox.state.albumCovers.set(ak, cov);
      },
      saveAlbumCoversCache: () => {},
      releaseOrphanedCoverBlobUrl: u => { if (u && u.startsWith('blob:')) MockUrl.revokeObjectURL(u); },
      propagateAndBroadcastCovers: () => {},
      pruneOrphanedAlbumCovers: () => {},
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      checkAndPromptResumeSession: () => {},
      toast: () => {}
    };
    vm.runInNewContext(
      `${metaCacheSlice}\n${restoreUrlSlice}\n${statMigSlice}\n${localSlice}\nthis.addLocalFiles = addLocalFiles;\nthis.migrateTrackUserStatKeys = migrateTrackUserStatKeys;\nthis.refreshModifiedLocalTrack = refreshModifiedLocalTrack;`,
      sandbox
    );

    // Scan #1: 2-track CUE + audio with embedded cover + folder.jpg
    const audioFile = { name: 'suite.flac', relativePath: 'Album/suite.flac', size: 100000, lastModified: 1000, _dur: 540, _sr: 96000, _bd: 24 };
    const cueFile1 = { name: 'suite.cue', relativePath: 'Album/suite.cue', _text: currentCueText };
    const res1 = await sandbox.addLocalFiles([audioFile, cueFile1], { folderRootKey: 'root1', pruneMissing: true });
    assert.equal(res1.added, 2);
    const t1 = sandbox.state.tracks[0];
    const t2 = sandbox.state.tracks[1];
    assert.equal(t1.hasEmbeddedCover, true);
    assert.equal(t1.cover, EMB_COV);
    t1.rating = 5;
    t1.playCount = 11;
    t1.isFavorite = true;
    t1.replayGainTrackGain = -4.0;
    t1.iTunNORM = '0000C001';
    sandbox.state.trackAnnotations[t1.id] = 'Master tape transfer';
    sandbox.state.trackRatings[t1.id] = 5;
    sandbox.state.favorites.add(t1.id);

    // Scan #2 (Probe 2b): clear albumCovers, add Track 3 + Track 4 + shift Track 2 INDEX 01 from 3:00 to 2:30 (150s) + rename Track 1
    sandbox.state.albumCovers.clear();
    makeLocalCalls = 0;
    const cueText2 = [
      'PERFORMER "Web Artist"',
      'TITLE "Web CUE Suite"',
      'FILE "suite.flac" WAVE',
      '  TRACK 01 AUDIO',
      '    TITLE "Movement I (Edit)"',
      '    INDEX 01 00:00:00',
      '  TRACK 02 AUDIO',
      '    TITLE "Movement II"',
      '    INDEX 01 02:30:00',
      '  TRACK 03 AUDIO',
      '    TITLE "Movement III"',
      '    INDEX 01 05:00:00',
      '  TRACK 04 AUDIO',
      '    TITLE "Movement IV"',
      '    INDEX 01 07:00:00',
      ''
    ].join('\n');
    const cueFile2 = { name: 'suite.cue', relativePath: 'Album/suite.cue', _text: cueText2 };
    const res2 = await sandbox.addLocalFiles([audioFile, cueFile2], { folderRootKey: 'root1', pruneMissing: true });
    assert.equal(res2.added, 2);
    assert.equal(sandbox.state.tracks.length, 4);
    assert.equal(makeLocalCalls, 1, 'Probe 2b must hydrate cached.siblingTrack once for Track 3 and reuse it for Track 4');
    assert.equal(t1.title, 'Movement I (Edit)');
    assert.equal(t1.duration, 150, 'Track 1 duration must shrink from 180 -> 150 when Track 2 shifts to 02:30');
    assert.equal(t1.cover, EMB_COV, 'Embedded data:image cover must survive Scan #2');
    assert.equal(t1.rating, 5);
    assert.equal(t1.playCount, 11);
    assert.equal(t1.isFavorite, true);
    assert.equal(t1.replayGainTrackGain, -4.0);
    assert.equal(sandbox.state.trackAnnotations[t1.id], 'Master tape transfer');
    const t3 = sandbox.state.tracks[2];
    const t4 = sandbox.state.tracks[3];
    assert.equal(t3.sampleRate, 96000);
    assert.equal(t3.bitDepth, 24);
    assert.equal(t3.hasEmbeddedCover, true);
    assert.equal(t3.cover, EMB_COV);
    assert.equal(t4.sampleRate, 96000);
    assert.equal(t4.cueParentDuration, 540);

    // Scan #3: Test folder.jpg addition -> deletion + trailing-track removal cleans state.albumCovers
    const noEmbAudio = { name: 'loose.flac', relativePath: 'Loose/loose.flac', size: 22000, lastModified: 1000, _noEmb: true, _artist: 'Loose Artist', _album: 'Loose Album', _dur: 200, _rg: -3.1 };
    const folderJpg = { name: 'folder.jpg', relativePath: 'Loose/folder.jpg', size: 5000 };
    await sandbox.addLocalFiles([noEmbAudio, folderJpg], { folderRootKey: 'root2', pruneMissing: true });
    const looseTr = sandbox.state.tracks.find(t => t.name === 'loose.flac' || t.relativePath === 'Loose/loose.flac');
    assert.ok(looseTr && String(looseTr.cover).startsWith('blob:'));
    looseTr.rating = 4;
    sandbox.state.trackAnnotations[looseTr.id] = 'Keep across retag!';

    // In-place re-tag changes file.size AND removes folder.jpg AND technical returns NO ReplayGain -> must keep ReplayGain, rating, id, annotations & clear stale cover!
    const retaggedAudio = { name: 'loose.flac', relativePath: 'Loose/loose.flac', size: 22999, lastModified: 2000, _noEmb: true, _artist: 'Loose Artist', _album: 'Loose Album', _dur: 201 };
    await sandbox.addLocalFiles([retaggedAudio], { folderRootKey: 'root2', pruneMissing: true });
    assert.equal(looseTr.size, 22999);
    assert.equal(looseTr.rating, 4);
    assert.equal(looseTr.replayGainTrackGain, -3.1, 'refreshModifiedLocalTrack must preserve existing ReplayGain when technical returns none');
    assert.equal(sandbox.state.trackAnnotations[looseTr.id], 'Keep across retag!');
    assert.equal(looseTr.cover, null, 'Deleting folder.jpg must clear non-embedded cover');

    // Direct migrateTrackUserStatKeys annotation migration when track.id changes
    const oldIdObj = { id: 'old_track_99', title: 'X', artist: 'Y', album: 'Z' };
    const newIdObj = { id: 'new_track_99', title: 'X', artist: 'Y', album: 'Z' };
    sandbox.state.trackAnnotations['old_track_99'] = 'Migrated note';
    assert.equal(sandbox.migrateTrackUserStatKeys(oldIdObj, newIdObj), true);
    assert.equal(sandbox.state.trackAnnotations['new_track_99'], 'Migrated note');
    assert.equal(JSON.parse(ls.getItem('nocturne-track-annotations'))['new_track_99'], 'Migrated note');
  });

  it('5. Run #89 P0 Drive Sync & Search invariants remain intact alongside R2 fixes', () => {
    assert.ok(html.includes("const GOOGLE_FOLDER_NAMES_KEY = 'nocturne-google-folder-names';"));
    assert.ok(html.includes("const GOOGLE_FOLDER_TREE_KEY = 'nocturne-google-folder-tree';"));
    assert.ok(html.includes('async function hydrateGoogleDriveFolderMetadata('));
    assert.ok(html.includes('function renderCollectionCards('));
    assert.ok(html.includes('function getCloudMetadataPriority('));
    const gLoad = extractBetween(html, 'async function loadGoogleFiles() {', 'async function fetchCloudFile(');
    assert.ok(gLoad.includes('queueCloudMetadata(pendingMeta);'), 'loadGoogleFiles finally must preserve queueCloudMetadata(pendingMeta)');
    assert.ok(library.filterTracks([{ title: 'Moonlit', artist: 'A', album: 'B' }], { search: 'moonlit' }).length === 1, 'library.filterTracks must index track metadata via normalizedTrackMetadata');
  });
});
