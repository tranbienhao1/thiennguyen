'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

describe('v3.9.101 R2: Cloud & Local/FiiO Delta Metadata, Folder Cover, ReplayGain, .LRC Reconciliation & Leak Fixes', () => {
  it('1. Google Drive delta move/rename, trashed folder.jpg/.lrc, hasEmbeddedCover=false folder art overwrite & ReplayGain invalidation', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS =', 'let cloudMetadataQueue =');
    const needsSlice = extractBetween(html, 'function needsCloudMetadataEnrichment(', 'function repopulateCloudMetadataQueue(');
    const invSlice = extractBetween(html, 'function invalidateCloudTrackContent(', 'function releaseUnusedCloudUrl(');
    const gArtSlice = extractBetween(html, 'function applyDiscoveredCloudFolderCover(', 'const GOOGLE_DRIVE_SHORTCUT_QUERY =');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    const movedTrack = {
      id: 'google:g1', remoteId: 'g1', source: 'google',
      parents: ['gOldDir'], name: 'OldName.flac', title: 'Old Title', artist: 'Artist', album: 'Album',
      metadataLoaded: true, hasEmbeddedCover: false,
      cover: 'data:image/jpeg;base64,OLD_DIR_COVER',
      lyricsText: '[00:01.00] Old Sidecar Lyric', lyricsSource: 'cloud-sidecar', _checkedDriveLrc: true,
      replayGainTrackGain: -5.2, replayGainAlbumGain: -6.1, replayGainTrackPeak: 0.98, replayGainAlbumPeak: 0.99, iTunNORM: '00001000', _replayGainChecked: true
    };
    const embeddedTrack = {
      id: 'google:g2', remoteId: 'g2', source: 'google',
      parents: ['gNewDir'], name: 'Embedded.flac', title: 'Embedded', artist: 'Artist', album: 'Album',
      metadataLoaded: true, hasEmbeddedCover: true,
      cover: 'data:image/jpeg;base64,EMBEDDED_ART'
    };
    const trashSiblingTrack = {
      id: 'google:g3', remoteId: 'g3', source: 'google',
      parents: ['gTrashDir'], name: 'SongThree.flac',
      metadataLoaded: true, hasEmbeddedCover: false,
      cover: 'data:image/jpeg;base64,TRASHED_FOLDER_ART',
      lyricsText: '[00:01.00] Trashed LRC', lyricsSource: 'cloud-sidecar', _checkedDriveLrc: true
    };

    const checkedGoogleArtParents = new Set(['gOldDir', 'gNewDir', 'gTrashDir']);
    const sandbox = {
      library,
      state: { tracks: [movedTrack, embeddedTrack, trashSiblingTrack], googleToken: 'g-tok' },
      checkedGoogleArtParents,
      GOOGLE_DELTA_TOKEN_KEY: 'nocturne-google-delta-token',
      trackMetadataRevision: 0,
      URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, RegExp, JSON, Error, Promise, console, encodeURIComponent,
      readCloudDeltaCursor: () => 'g-cur-1',
      writeCloudDeltaCursor: () => {},
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
      cloudStatus: () => {},
      toast: () => {},
      fetchCloudImageCandidateDataUrl: async () => 'data:image/jpeg;base64,NEW_DIR_COVER',
      fetchGoogleDrivePageWithRetry: async url => {
        if (url.includes('/drive/v3/changes')) {
          return {
            ok: true, status: 200,
            json: async () => ({
              newStartPageToken: 'g-cur-2',
              changes: [
                { fileId: 'g1', removed: false, file: { id: 'g1', name: 'NewName.flac', parents: ['gNewDir'] } },
                { fileId: 'gNewLrc', removed: false, file: { id: 'gNewLrc', name: 'NewName.lrc', parents: ['gNewDir'], mimeType: 'text/plain' } },
                { fileId: 'gDeadArt', removed: false, file: { id: 'gDeadArt', name: 'folder.jpg', parents: ['gTrashDir'], trashed: true } },
                { fileId: 'gDeadLrc', removed: false, file: { id: 'gDeadLrc', name: 'SongThree.lrc', parents: ['gTrashDir'], trashed: true } }
              ]
            })
          };
        }
        return {
          ok: true, status: 200,
          json: async () => ({ files: [{ id: 'gNewArt', name: 'folder.jpg', parents: ['gNewDir'], thumbnailLink: 'https://lh3/new=s220' }] })
        };
      }
    };
    vm.runInNewContext(
      `${serSlice}\n${needsSlice}\n${invSlice}\n${gArtSlice}\n${gDeltaSlice}\nthis.serializableCloudTrack = serializableCloudTrack;\nthis.needsCloudMetadataEnrichment = needsCloudMetadataEnrichment;\nthis.invalidateCloudTrackContent = invalidateCloudTrackContent;\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;\nthis.discoverGoogleDriveFolderArtwork = discoverGoogleDriveFolderArtwork;`,
      sandbox
    );

    const serMoved = sandbox.serializableCloudTrack(movedTrack);
    assert.equal(serMoved.hasEmbeddedCover, false, 'serializableCloudTrack must persist hasEmbeddedCover=false');
    const serEmb = sandbox.serializableCloudTrack(embeddedTrack);
    assert.equal(serEmb.hasEmbeddedCover, true, 'serializableCloudTrack must persist hasEmbeddedCover=true');

    const deltaRes = await sandbox.tryLoadGoogleChangesDelta(
      'g-tok',
      new Map([['g1', movedTrack], ['g2', embeddedTrack], ['g3', trashSiblingTrack]]),
      new Set(['g1', 'g2', 'g3'])
    );
    assert.equal(deltaRes.handled, true);
    assert.deepEqual(movedTrack.parents, ['gNewDir']);
    assert.equal(movedTrack.name, 'NewName.flac');
    assert.equal(movedTrack._checkedDriveLrc, false, 'Move/rename must reset _checkedDriveLrc');
    assert.equal(movedTrack.lyricsText, '', 'Move/rename must clear stale cloud-sidecar lyricsText');
    assert.equal(trashSiblingTrack.cover, null, 'Trashed folder.jpg must clear non-embedded cover');
    assert.equal(trashSiblingTrack.lyricsText, '', 'Trashed .lrc must clear matching cloud-sidecar lyricsText');
    assert.equal(sandbox.needsCloudMetadataEnrichment(movedTrack), true, 'needsCloudMetadataEnrichment must re-queue after move/rename');

    await sandbox.discoverGoogleDriveFolderArtwork(sandbox.state.tracks, { forceParentIds: deltaRes.changedArtParents });
    assert.equal(movedTrack.cover, 'data:image/jpeg;base64,NEW_DIR_COVER', 'Non-embedded track with metadataLoaded=true must accept new folder cover');
    assert.equal(embeddedTrack.cover, 'data:image/jpeg;base64,EMBEDDED_ART', 'Embedded track must never be overwritten by folder cover');

    // invalidateCloudTrackContent clears ReplayGain + _replayGainChecked
    assert.equal(sandbox.invalidateCloudTrackContent(movedTrack), true);
    assert.equal(movedTrack._replayGainChecked, false);
    assert.equal(movedTrack.replayGainTrackGain, undefined);
    assert.equal(movedTrack.replayGainAlbumGain, undefined);
    assert.equal(movedTrack.iTunNORM, undefined);
  });

  it('2. OneDrive delta move/rename queries destination children, persists remoteLrc.cTag, and clears deleted .lrc sidecar lyrics', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS =', 'let cloudMetadataQueue =');
    const gArtSlice = extractBetween(html, 'function applyDiscoveredCloudFolderCover(', 'const GOOGLE_DRIVE_SHORTCUT_QUERY =');
    const msArtSlice = extractBetween(html, 'async function applyMicrosoftSiblingFolderCovers(', 'async function enqueueMicrosoftSharedItems(');
    const msDeltaSlice = extractBetween(html, 'async function tryLoadMicrosoftDeltaSync(', 'async function verifyMicrosoftAccountSwitch(');

    const msMoved = {
      id: 'onedrive:m1', remoteId: 'm1', source: 'onedrive',
      remoteParentId: 'msOldDir', remotePath: 'OldDir/Track1.flac', name: 'Track1.flac',
      title: 'Track 1', artist: 'Artist', album: 'Album',
      metadataLoaded: true, hasEmbeddedCover: false,
      cover: 'data:image/jpeg;base64,OLD_MS_COVER',
      remoteLrc: { id: 'msOldLrc', driveId: '', name: 'Track1.lrc', cTag: 'old-ctag' },
      lyricsText: '[00:01.00] Stale MS LRC', lyricsSource: 'cloud-sidecar', _cloudLrcChecked: true
    };
    const msDeletedLrcTrack = {
      id: 'onedrive:m2', remoteId: 'm2', source: 'onedrive',
      remoteParentId: 'msDir2', remotePath: 'Dir2/Track2.flac', name: 'Track2.flac',
      remoteLrc: { id: 'msDeadLrc', driveId: '', name: 'Track2.lrc', cTag: 'c1' },
      lyricsText: '[00:01.00] Dead LRC', lyricsSource: 'cloud-sidecar', _cloudLrcChecked: true
    };

    const siblingCoversByDir = new Map();
    const siblingLrcByBase = new Map();
    siblingCoversByDir._lrcMap = siblingLrcByBase;

    const sandbox = {
      library,
      state: { tracks: [msMoved, msDeletedLrcTrack], microsoftAccessToken: 'ms-tok' },
      MICROSOFT_DELTA_LINK_KEY: 'nocturne-microsoft-delta-link',
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Error, Promise, console, encodeURIComponent,
      readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=1',
      writeCloudDeltaCursor: () => {},
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      releaseUnusedCloudUrl: () => {},
      propagateAndBroadcastCovers: () => {},
      syncAlbumCoversImmediate: () => {},
      broadcastCoverUpdate: () => {},
      scheduleTrackRender: () => {},
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {},
      trackMetadataRevision: 0,
      isCloudAudio: it => Boolean(it && it.file && /\.flac$/i.test(it.name || '')),
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p }),
      mergeMicrosoftTrack: () => {},
      fetchCloudImageCandidateDataUrl: async () => 'data:image/jpeg;base64,DEST_MS_COVER',
      graphGet: async url => {
        if (url.includes('/me/drive/root/delta')) {
          return {
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?t=2',
            value: [
              { id: 'm1', name: 'Track1Renamed.flac', file: { mimeType: 'audio/flac' }, size: 1000, parentReference: { id: 'msNewDir', path: '/drive/root:/NewDir' } },
              { id: 'msDeadLrc', deleted: { state: 'deleted' } }
            ]
          };
        }
        if (url.includes('/items/msNewDir/children')) {
          return {
            value: [
              { id: 'destCover1', name: 'cover.jpg', file: { mimeType: 'image/jpeg' }, '@microsoft.graph.downloadUrl': 'https://1drv.ms/dest-cover' },
              { id: 'destLrc1', name: 'Track1Renamed.lrc', file: { mimeType: 'text/plain' }, cTag: 'dest-ctag-2', '@microsoft.graph.downloadUrl': 'https://1drv.ms/dest-lrc' }
            ]
          };
        }
        return { value: [] };
      }
    };
    vm.runInNewContext(
      `${serSlice}\n${gArtSlice}\n${msArtSlice}\n${msDeltaSlice}\nthis.serializableCloudTrack = serializableCloudTrack;\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;\nthis.applyMicrosoftSiblingFolderCovers = applyMicrosoftSiblingFolderCovers;\nthis.applyMicrosoftSiblingLrcLinks = applyMicrosoftSiblingLrcLinks;`,
      sandbox
    );

    const serWithCtag = sandbox.serializableCloudTrack(msMoved);
    assert.equal(serWithCtag.remoteLrc.cTag, 'old-ctag', 'serializableCloudTrack must preserve remoteLrc.cTag');

    const msRes = await sandbox.tryLoadMicrosoftDeltaSync(
      'ms-tok',
      new Map([['m1', msMoved], ['m2', msDeletedLrcTrack]]),
      new Set(['m1', 'm2']),
      siblingCoversByDir
    );
    assert.equal(msRes.handled, true);
    assert.equal(msMoved.remotePath, 'NewDir/Track1Renamed.flac');
    assert.equal(msMoved._needsFolderCoverRefresh, true);
    assert.equal(msMoved.lyricsText, '', 'Move/rename must clear stale OneDrive cloud-sidecar lyrics');
    assert.equal(msDeletedLrcTrack.remoteLrc, null);
    assert.equal(msDeletedLrcTrack.lyricsText, '', 'Deleted OneDrive .lrc must clear stale cloud-sidecar lyrics');

    // Destination children query populated siblingCoversByDir & siblingLrcByBase
    assert.ok(siblingCoversByDir.has('NewDir'), 'Must query destination folder children for folder cover when missing');
    const covApplied = await sandbox.applyMicrosoftSiblingFolderCovers(siblingCoversByDir);
    assert.equal(covApplied, 1);
    assert.equal(msMoved.cover, 'data:image/jpeg;base64,DEST_MS_COVER', 'Non-embedded track with metadataLoaded=true must accept destination folder cover');

    const lrcLinked = await sandbox.applyMicrosoftSiblingLrcLinks(siblingLrcByBase);
    assert.equal(lrcLinked, 1);
    assert.equal(msMoved.remoteLrc.cTag, 'dest-ctag-2');
    assert.equal(msMoved._cloudLrcChecked, false);
  });

  it('3. Web Local & FiiO sync preserve full ReplayGain, reconcile moved local tracks, bust /local-cover, and support SAF DocumentsContract siblings', async () => {
    // Web local cache ReplayGain + hasEmbeddedCover
    const metaCacheSlice = extractBetween(html, 'const LOCAL_META_CACHE_KEY =', 'function decodeTextBytesAuto(');
    const localModSlice = extractBetween(html, 'function reconcileMovedLocalTracks(', 'function quality(track)');

    const lsStore = {};
    const mSandbox = {
      library,
      localStorage: { getItem: k => lsStore[k] || null, setItem: (k, v) => { lsStore[k] = v; } },
      state: { tracks: [], objectUrls: new Set(), albumCovers: new Map(), currentId: null, queueTrackIds: [], recentHistory: [], favorites: new Set() },
      id: (() => { let n = 0; return () => 'loc_' + (++n); })(),
      getTags: async () => ({ title: 'Local Song', artist: 'Local Artist', album: 'Local Album', cover: 'data:image/png;base64,EMB' }),
      readAudioMetadata: async () => ({
        duration: 210, sampleRate: 96000, bitDepth: 24, channels: 2,
        replayGainTrackGain: -3.5, replayGainTrackPeak: 0.91,
        replayGainAlbumGain: -4.2, replayGainAlbumPeak: 0.95,
        iTunNORM: '00000ABC'
      }),
      filenameMetadata: f => ({ title: f, artist: 'Unknown Artist', album: 'Unknown Album' }),
      normalizeCoverImage: async c => c || null,
      getTrackRating: () => 0,
      syncAlbumCoversImmediate: () => {},
      scheduleTrackRender: () => {},
      URL: { createObjectURL: () => 'blob:loc-1', revokeObjectURL: () => {} },
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, Promise, setTimeout, clearTimeout
    };
    vm.runInNewContext(
      `${metaCacheSlice}\n${localModSlice}\nthis.makeLocalTrack = makeLocalTrack;\nthis.refreshModifiedLocalTrack = refreshModifiedLocalTrack;\nthis.reconcileMovedLocalTracks = reconcileMovedLocalTracks;`,
      mSandbox
    );

    const fakeFile = { name: '01.flac', relativePath: 'Album/01.flac', size: 50000, lastModified: 1700000000000 };
    const t1 = await mSandbox.makeLocalTrack(fakeFile);
    assert.equal(t1.hasEmbeddedCover, true);
    assert.equal(t1.replayGainAlbumGain, -4.2);
    assert.equal(t1.replayGainAlbumPeak, 0.95);
    assert.equal(t1.replayGainTrackPeak, 0.91);
    assert.equal(t1.iTunNORM, '00000ABC');

    // Second pass hits fast cache and restores all 5 ReplayGain fields + hasEmbeddedCover
    const t1Cached = await mSandbox.makeLocalTrack(fakeFile, { hasFolderCover: true });
    assert.equal(t1Cached.hasEmbeddedCover, true);
    assert.equal(t1Cached.replayGainAlbumGain, -4.2);
    assert.equal(t1Cached.replayGainAlbumPeak, 0.95);
    assert.equal(t1Cached.replayGainTrackPeak, 0.91);
    assert.equal(t1Cached.iTunNORM, '00000ABC');

    // reconcileMovedLocalTracks migrates rating, queueTrackIds, favorites, ReplayGain
    const oldLoc = {
      id: 'loc_old', source: 'local', name: '01.flac', relativePath: 'Old/01.flac', size: 50000,
      rating: 5, playCount: 4, replayGainAlbumGain: -4.2, iTunNORM: '00000ABC',
      lyricsText: '[00:01.00] Old Sidecar', lyricsSource: 'local-sidecar'
    };
    const newLoc = { id: 'loc_new', source: 'local', name: '01.flac', relativePath: 'New/01.flac', size: 50000 };
    mSandbox.state.queueTrackIds = ['loc_old'];
    mSandbox.state.favorites = new Set(['loc_old']);
    const mig = mSandbox.reconcileMovedLocalTracks([oldLoc], [newLoc]);
    assert.equal(mig, 1);
    assert.equal(newLoc.rating, 5);
    assert.equal(newLoc.playCount, 4);
    assert.equal(newLoc.replayGainAlbumGain, -4.2);
    assert.deepEqual(Array.from(mSandbox.state.queueTrackIds), ['loc_new']);
    assert.equal(mSandbox.state.favorites.has('loc_new'), true);
    assert.equal(newLoc.lyricsText, undefined, 'Moved local track must NOT copy stale local-sidecar lyrics from old folder');

    // FiiO buildFiioCoverUrl cache-buster + applyFiioRescanFields + reconcileMovedFiioTracks
    const urlA = library.buildFiioCoverUrl({ uri: 'content://media/external/audio/media/42', path: '/storage/SD/Old/01.flac', album: 'A', artist: 'B', lastModified: 100 });
    const urlB = library.buildFiioCoverUrl({ uri: 'content://media/external/audio/media/42', path: '/storage/SD/New/01.flac', album: 'A', artist: 'B', lastModified: 100 });
    assert.notEqual(urlA, urlB, 'buildFiioCoverUrl must vary &v= when path changes even with identical MediaStore URI');
    assert.ok(urlA.includes('&v=') && urlA.endsWith('&size=320'));

    const fiioSlice = extractBetween(html, 'function applyFiioRescanFields(', 'function fiioCueHash(');
    const fiioRecSlice = extractBetween(html, 'function reconcileMovedFiioTracks(', 'function pruneMissingFiioTracks(');
    const fSandbox = {
      library,
      state: { tracks: [], queueTrackIds: [], recentHistory: [], favorites: new Set() },
      fiioScanUpgradedCount: 0,
      restoreLocalTrackUrlSync: () => {},
      Map, Set, Array, Object, String, Number, Boolean
    };
    vm.runInNewContext(`${fiioSlice}\n${fiioRecSlice}\nthis.applyFiioRescanFields = applyFiioRescanFields;\nthis.reconcileMovedFiioTracks = reconcileMovedFiioTracks;`, fSandbox);

    const prevFiio = {
      id: 'fiio_1', uri: 'content://media/external/audio/media/42', path: '/storage/SD/Old/01.flac',
      name: '01', size: 1000, lastModified: 100,
      cover: 'https://appassets.androidplatform.net/local-cover?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F42&size=320',
      lyricsText: '[00:01.00] Old SD LRC', lyricsSource: 'local-sidecar'
    };
    fSandbox.applyFiioRescanFields(prevFiio, { name: '01.flac', size: 1000, lastModified: 100 }, '/storage/SD/New/01.flac', 'content://media/external/audio/media/42', new Set(), new Set(), new Map(), new Map());
    assert.equal(prevFiio.cover, '', 'MediaStore move (same URI, new path) must bust prevTrack.cover');
    assert.equal(prevFiio.lyricsText, '', 'MediaStore move must clear stale local-sidecar lyricsText');

    const oldF = { id: 'fiio_old', size: 2048, name: '02.flac', path: '/sd/old/02.flac', replayGainAlbumGain: -5.5, replayGainAlbumPeak: 0.94, iTunNORM: '001122', hasReplayGain: true };
    const newF = { id: 'fiio_new', size: 2048, name: '02.flac', path: '/sd/new/02.flac' };
    fSandbox.reconcileMovedFiioTracks([oldF], [newF]);
    assert.equal(newF.replayGainAlbumGain, -5.5);
    assert.equal(newF.iTunNORM, '001122');

    // MainActivity.java DocumentsContract SAF tree sibling + &v= cover cache buster
    assert.ok(mainJava.includes('DocumentsContract.buildChildDocumentsUriUsingTree('), 'MainActivity must use DocumentsContract tree child traversal');
    assert.ok(mainJava.includes('public Uri resolveSafSiblingUri(') && mainJava.includes('findSafSiblingLyricsUri(') && mainJava.includes('extractSafFolderCover('), 'MainActivity must provide SAF sibling LRC and folder cover fallbacks');
    assert.ok(mainJava.includes('extractLocalMediaQueryParam(uri, "v")') && mainJava.includes('versionSuffix'), 'handleLocalCoverArt must salt cache keys with &v=');
  });

  it('4. Leak prevention: onAndroidLowMemory protects covers via pruneExcessObjectUrls, upgradeSliceToFullAudio releases sliceUrl, and pruneOrphanedSliceCacheEntries prunes 0-track source with allowEmptySource', async () => {
    const trimSlice = extractBetween(html, 'window.onAndroidLowMemory = function(level) {', '    }\n    const CLOUD_METADATA_CONCURRENCY');
    const pruneObjSlice = extractBetween(html, 'function pruneExcessObjectUrls(maxBudget) {', 'function filteredTracks() {');
    const slicePruneSlice = extractBetween(html, 'function pruneOrphanedSliceCacheEntries(', 'function purgeCloudSliceCacheAndOrphanedCovers()');

    const revoked = [];
    const tracks = [
      { id: 'cur', url: 'blob:cur-audio', cover: 'blob:cur-cover', artist: 'A1', album: 'Alb1' },
      { id: 'q1', url: 'blob:queued-audio', cover: 'blob:other-cover', artist: 'A2', album: 'Alb2' }
    ];
    for (let i = 0; i < 10; i++) tracks.push({ id: 'extra_' + i, cover: 'blob:cov_' + i, artist: 'Ax', album: 'Albx' });
    const objectUrls = new Set(['blob:cur-audio', 'blob:cur-cover', 'blob:queued-audio', 'blob:other-cover', 'blob:orphan-1', 'blob:orphan-2']);
    for (let i = 0; i < 10; i++) objectUrls.add('blob:cov_' + i);

    const MockUrl = function (u, base) { return new URL(u, base); };
    MockUrl.revokeObjectURL = u => revoked.push(u);
    const memSandbox = {
      library,
      IS_LEGACY_ANDROID: true,
      audio: { src: 'blob:cur-audio' },
      standbyAudio: { src: '' },
      window: {},
      URL: MockUrl,
      location: { href: 'https://nocturne.local/' },
      state: {
        currentId: 'cur',
        preloadTrackId: null,
        queueTrackIds: ['q1'],
        tracks,
        objectUrls,
        albumCovers: new Map([['A1:::Alb1', 'blob:cur-cover'], ['A2:::Alb2', 'blob:other-cover']]),
        artistPortraits: new Map(),
        dsdUrl: null,
        preloadReadyUrl: null
      },
      pauseCloudMetadataQueue: () => {},
      setVisualizerRunning: () => {},
      clearStalePreload: () => {},
      console: { warn: () => {} },
      Array, Set, Map, Number, String, Boolean
    };
    vm.runInNewContext(`${pruneObjSlice}\n${trimSlice}`, memSandbox);
    memSandbox.window.onAndroidLowMemory(15);
    assert.ok(revoked.includes('blob:orphan-1') && revoked.includes('blob:orphan-2'), 'Must revoke unreferenced orphan blob URLs');
    assert.equal(revoked.includes('blob:cur-cover'), false, 'Must NEVER revoke active track cover blob URL');
    assert.equal(revoked.includes('blob:other-cover'), false, 'Must NEVER revoke library track cover blob URL');
    assert.equal(revoked.includes('blob:queued-audio'), false, 'Must NEVER revoke queued track audio blob URL');

    // pruneOrphanedSliceCacheEntries with allowEmptySource: true when 0 tracks of source remain
    const storeMap = new Map([
      [JSON.stringify(['google', 'g-last']), { key: JSON.stringify(['google', 'g-last']) }],
      [JSON.stringify(['onedrive', 'od-keep']), { key: JSON.stringify(['onedrive', 'od-keep']) }]
    ]);
    const pSandbox = {
      library,
      Array, Set, String, Promise,
      state: { currentId: null, preloadTrackId: null, tracks: [{ id: 'onedrive:od-keep', remoteId: 'od-keep', source: 'onedrive' }] },
      sliceCacheTransaction: () => {
        const tx = {};
        return {
          getAll: () => {
            const req = {};
            queueMicrotask(() => { req.result = Array.from(storeMap.values()); if (req.onsuccess) req.onsuccess(); });
            return req;
          },
          delete: k => {
            storeMap.delete(k);
            queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
          },
          transaction: tx
        };
      }
    };
    vm.runInNewContext(`${slicePruneSlice}\nthis.pruneOrphanedSliceCacheEntries = pruneOrphanedSliceCacheEntries;`, pSandbox);
    assert.equal(await pSandbox.pruneOrphanedSliceCacheEntries('google'), 0, 'Without allowEmptySource, empty source guard stays intact');
    assert.equal(await pSandbox.pruneOrphanedSliceCacheEntries('google', { allowEmptySource: true }), 1, 'With allowEmptySource=true, last deleted track slice must be pruned');
    assert.equal(storeMap.has(JSON.stringify(['onedrive', 'od-keep'])), true);

    const upSlice = extractBetween(html, 'async function upgradeSliceToFullAudio(', 'async function fetchCloudTrack(');
    assert.ok(upSlice.includes('if (track.url === sliceUrl) track.url = fullUrl;') && upSlice.includes('releaseTrackUrl(sliceUrl);'),
      'upgradeSliceToFullAudio early Bit-Perfect return must update track.url and release unreferenced sliceUrl');
  });

  it('5. Regression 3a.2: partial-album Google/OneDrive delta move to uncovered folder does not resurrect OLD_ART via instantPropagateCovers & applyGoogleScanUpdate resets moved metadata', async () => {
    const gArtSlice = extractBetween(html, 'function applyDiscoveredCloudFolderCover(', 'const GOOGLE_DRIVE_SHORTCUT_QUERY =');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    // Partial-album Google move: tr1 moves from folderA -> uncovered folderB while tr2 stays in folderA with OLD_ART
    const tr1 = {
      id: 'google:g_m1', remoteId: 'g_m1', source: 'google',
      parents: ['folderA'], name: '01.flac', title: 'Song 1', artist: 'Same Artist', album: 'Same Album',
      metadataLoaded: true, hasEmbeddedCover: false, cover: 'data:image/jpeg;base64,OLD_ART',
      lyricsText: '[00:01.00] Old LRC', lyricsSource: 'cloud-sidecar', _checkedDriveLrc: true
    };
    const tr2 = {
      id: 'google:g_m2', remoteId: 'g_m2', source: 'google',
      parents: ['folderA'], name: '02.flac', title: 'Song 2', artist: 'Same Artist', album: 'Same Album',
      metadataLoaded: true, hasEmbeddedCover: false, cover: 'data:image/jpeg;base64,OLD_ART'
    };
    const ak = library.buildAlbumKey(tr1);
    const albumCovers = new Map([[ak, 'data:image/jpeg;base64,OLD_ART']]);
    const checkedGoogleArtParents = new Set(['folderA', 'folderB']);

    const sandbox = {
      library,
      state: { tracks: [tr1, tr2], albumCovers, googleToken: 'g-tok' },
      checkedGoogleArtParents,
      GOOGLE_DELTA_TOKEN_KEY: 'nocturne-google-delta-token',
      trackMetadataRevision: 0,
      URLSearchParams, Map, Set, Array, Object, String, Number, Boolean, Date, Math, RegExp, JSON, Error, Promise, console, encodeURIComponent,
      readCloudDeltaCursor: () => 'g-cur-1',
      writeCloudDeltaCursor: () => {},
      ensureGoogleToken: async () => 'g-tok',
      isCloudAudio: () => true,
      googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      releaseUnusedCloudUrl: () => {},
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      propagateAndBroadcastCovers: () => library.instantPropagateCovers(sandbox.state.tracks, sandbox.state.albumCovers),
      syncAlbumCoversImmediate: () => {},
      broadcastCoverUpdate: () => {},
      saveAlbumCoversCache: () => {},
      cloudStatus: () => {},
      toast: () => {},
      fetchCloudImageCandidateDataUrl: async () => null,
      fetchGoogleDrivePageWithRetry: async url => {
        if (url.includes('/drive/v3/changes')) {
          return {
            ok: true, status: 200,
            json: async () => ({
              newStartPageToken: 'g-cur-2',
              changes: [
                { fileId: 'g_m1', removed: false, file: { id: 'g_m1', name: '01.flac', parents: ['folderB'] } }
              ]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
    };
    vm.runInNewContext(
      `${gArtSlice}\n${gDeltaSlice}\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;\nthis.discoverGoogleDriveFolderArtwork = discoverGoogleDriveFolderArtwork;`,
      sandbox
    );

    const deltaRes = await sandbox.tryLoadGoogleChangesDelta(
      'g-tok',
      new Map([['g_m1', tr1], ['g_m2', tr2]]),
      new Set(['g_m1', 'g_m2'])
    );
    assert.equal(deltaRes.handled, true);
    assert.equal(tr1._needsFolderCoverRefresh, true);
    assert.equal(tr1.cover, null);

    // Before discoverGoogleDriveFolderArtwork runs, loadGoogleFiles finally calls propagateAndBroadcastCovers()
    const propRes = sandbox.propagateAndBroadcastCovers();
    assert.equal(propRes.updatedCount, 0, '3a.2: instantPropagateCovers must NOT resurrect OLD_ART onto _needsFolderCoverRefresh track');
    assert.equal(tr1.cover, null, '3a.2: tr1.cover must stay null while awaiting folderB cover discovery');
    assert.equal(library.instantResolveTrackCover(tr1, albumCovers, sandbox.state.tracks), null, '3a.2: instantResolveTrackCover must skip _needsFolderCoverRefresh track');

    // Now discoverGoogleDriveFolderArtwork scans uncovered folderB -> finds no cover -> clears _needsFolderCoverRefresh cleanly
    await sandbox.discoverGoogleDriveFolderArtwork(sandbox.state.tracks, { forceParentIds: deltaRes.changedArtParents });
    assert.equal(tr1.cover, null, '3a.2: uncovered folderB must keep tr1.cover as null');
    assert.equal(tr1._needsFolderCoverRefresh, false, '3a.2: _needsFolderCoverRefresh must be cleared after folder discovery finishes');

    // Also verify applyGoogleScanUpdate parity on parents change in full scan
    const gLoadSlice = extractBetween(html, 'async function loadGoogleFiles() {', 'async function fetchCloudFile(');
    assert.ok(gLoadSlice.includes('existing._needsFolderCoverRefresh = true;') && gLoadSlice.includes("if (existing.lyricsSource === 'cloud-sidecar')"),
      'applyGoogleScanUpdate must set _needsFolderCoverRefresh and clear cloud-sidecar lyrics on parents change');
  });

  it('6. Regression 3d.1: onAndroidLowMemory(15) trims albumCovers > 40 without revoking active tr.cover blob URLs', () => {
    const trimSlice = extractBetween(html, 'window.onAndroidLowMemory = function(level) {', '    }\n    const CLOUD_METADATA_CONCURRENCY');
    const pruneObjSlice = extractBetween(html, 'function pruneExcessObjectUrls(maxBudget) {', 'function filteredTracks() {');

    const revoked = [];
    const tracks = [];
    const albumCovers = new Map();
    const objectUrls = new Set();

    // Create 45 tracks + albumCovers; entries 0..40 are active in state.tracks, entries 41..44 are orphaned albumCovers
    for (let i = 0; i < 45; i++) {
      const url = 'blob:cover_' + i;
      objectUrls.add(url);
      albumCovers.set('Artist' + i + ':::Album' + i, url);
      if (i < 41) {
        tracks.push({ id: 'tr_' + i, artist: 'Artist' + i, album: 'Album' + i, cover: url });
      }
    }

    const MockUrl = function (u, base) { return new URL(u, base); };
    MockUrl.revokeObjectURL = u => revoked.push(u);

    const sandbox = {
      library,
      IS_LEGACY_ANDROID: true,
      audio: { src: '' },
      standbyAudio: { src: '' },
      window: {},
      URL: MockUrl,
      location: { href: 'https://nocturne.local/' },
      state: {
        currentId: 'tr_40',
        preloadTrackId: null,
        queueTrackIds: [],
        tracks,
        objectUrls,
        albumCovers,
        artistPortraits: new Map(),
        dsdUrl: null,
        preloadReadyUrl: null
      },
      pauseCloudMetadataQueue: () => {},
      setVisualizerRunning: () => {},
      clearStalePreload: () => {},
      console: { warn: () => {} },
      Array, Set, Map, Number, String, Boolean
    };
    vm.runInNewContext(`${pruneObjSlice}\n${trimSlice}`, sandbox);

    sandbox.window.onAndroidLowMemory(15);
    assert.equal(albumCovers.size, 40, '3d.1: albumCovers must trim down to 40');
    assert.equal(revoked.includes('blob:cover_0'), false, '3d.1: active tr_0.cover blob URL must NEVER be revoked when albumCovers > 40');
    assert.equal(revoked.includes('blob:cover_4'), false, '3d.1: active tr_4.cover blob URL must NEVER be revoked');

    // Now test orphan blob URL in albumCovers (first entry in Map, not referenced by any track) IS revoked and deleted from objectUrls
    const tracks2 = [{ id: 'keep_tr', artist: 'KeepA', album: 'KeepAlb', cover: 'blob:active-keep' }];
    const albumCovers2 = new Map([['Orphan:::Key', 'blob:orphan-first']]);
    const objectUrls2 = new Set(['blob:orphan-first', 'blob:active-keep']);
    for (let i = 1; i < 45; i++) {
      const u = 'blob:extra_' + i;
      objectUrls2.add(u);
      albumCovers2.set('A' + i + ':::B' + i, u);
      tracks2.push({ id: 't_' + i, artist: 'A' + i, album: 'B' + i, cover: u });
    }
    const revoked2 = [];
    const MockUrl2 = function (u, base) { return new URL(u, base); };
    MockUrl2.revokeObjectURL = u => revoked2.push(u);
    const sandbox2 = {
      ...sandbox,
      URL: MockUrl2,
      state: { ...sandbox.state, currentId: 'keep_tr', tracks: tracks2, albumCovers: albumCovers2, objectUrls: objectUrls2 }
    };
    vm.runInNewContext(`${pruneObjSlice}\n${trimSlice}`, sandbox2);
    sandbox2.window.onAndroidLowMemory(15);
    assert.equal(revoked2.includes('blob:orphan-first'), true, '3d.1: unreferenced orphan blob cover in albumCovers must be revoked');
    assert.equal(objectUrls2.has('blob:orphan-first'), false, '3d.1: revoked orphan blob cover must be removed from state.objectUrls');
    assert.equal(revoked2.includes('blob:active-keep'), false);
    assert.equal(revoked2.includes('blob:extra_1'), false, '3d.1: active track covers in trimmed albumCovers slots must NOT be revoked');
  });
});
