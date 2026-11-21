'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));

test('1. Google Drive Delta Sync refreshes discNumber on folder rename, tracks changedArtParents for cover/move, and refreshes non-embedded folder art', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const artStart = html.indexOf('function applyDiscoveredCloudFolderCover(matchingTracks, cover, opts) {');
  const artEnd = html.indexOf('const GOOGLE_DRIVE_SHORTCUT_QUERY =', artStart);
  const deltaStart = html.indexOf('async function tryLoadGoogleChangesDelta(token, existingByRemoteId, knownIds) {');
  const deltaEnd = html.indexOf('function removeDeletedCloudTracks(', deltaStart);
  assert.ok(artStart > 0 && artEnd > artStart && deltaStart > 0 && deltaEnd > deltaStart);

  const trackInRenamedFolder = {
    id: 'google:f1',
    remoteId: 'f1',
    source: 'google',
    name: '01 So What.flac',
    title: 'So What',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    parents: ['folder-disc'],
    discNumber: 1,
    cover: 'data:image/jpeg;base64,OLD_FOLDER_ART',
    metadataLoaded: false
  };
  const trackWithEmbeddedArt = {
    id: 'google:f2',
    remoteId: 'f2',
    source: 'google',
    name: '02 Freddie Freeloader.flac',
    title: 'Freddie Freeloader',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    parents: ['folder-art'],
    cover: 'data:image/jpeg;base64,EMBEDDED_FLAC_ART',
    metadataLoaded: true
  };
  const trackWithOldFolderArt = {
    id: 'google:f3',
    remoteId: 'f3',
    source: 'google',
    name: '03 Blue in Green.flac',
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    parents: ['folder-art'],
    cover: 'data:image/jpeg;base64,OLD_FOLDER_ART',
    metadataLoaded: false
  };

  const persisted = [];
  const checkedGoogleArtParents = new Set(['folder-disc', 'folder-art', 'folder-moved']);
  const state = { tracks: [trackInRenamedFolder, trackWithEmbeddedArt, trackWithOldFolderArt] };

  const sandbox = {
    state,
    library,
    checkedGoogleArtParents,
    GOOGLE_DELTA_TOKEN_KEY: 'nocturne-google-delta-token',
    trackMetadataRevision: 0,
    URLSearchParams,
    encodeURIComponent,
    Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, Promise, console,
    readCloudDeltaCursor: () => 'cursor-1',
    writeCloudDeltaCursor: () => {},
    ensureGoogleToken: async () => 'tok-1',
    isCloudAudio: f => /\.(flac|mp3|wav)$/i.test(String(f && f.name || '')),
    googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, parents: f.parents || [] }),
    persistCloudCatalog: async list => { persisted.push(...list); },
    removeCloudTracksByRemoteIds: async () => 0,
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    scheduleTrackRender: () => {},
    propagateAndBroadcastCovers: () => {},
    cloudStatus: () => {},
    toast: () => {},
    fetchCloudImageCandidateDataUrl: async () => 'data:image/jpeg;base64,FRESH_FOLDER_ART',
    fetchGoogleDrivePageWithRetry: async url => {
      if (url.includes('/drive/v3/changes')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            newStartPageToken: 'cursor-2',
            changes: [
              { fileId: 'folder-disc', file: { id: 'folder-disc', name: 'Disc 2', mimeType: 'application/vnd.google-apps.folder' } },
              { fileId: 'cover-img-1', file: { id: 'cover-img-1', name: 'cover.jpg', mimeType: 'image/jpeg', parents: ['folder-art'] } },
              { fileId: 'f1', file: { id: 'f1', name: '01 So What.flac', parents: ['folder-moved'] } }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'cover-img-1', name: 'cover.jpg', parents: ['folder-art'], thumbnailLink: 'https://lh3.test/img=s220' }
          ]
        })
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(artStart, artEnd) + '\n' +
    html.slice(deltaStart, deltaEnd) +
    '\nthis.__exports = { tryLoadGoogleChangesDelta, discoverGoogleDriveFolderArtwork };',
    sandbox
  );

  // Move f1 back to folder-disc first for checking folder rename? Notice f1 change moves it to folder-moved,
  // while folder-disc rename ran BEFORE f1's move in changes[] -> f1 gets discNumber 2 AND parents ['folder-moved']!
  const existingByRemoteId = new Map([
    ['f1', trackInRenamedFolder],
    ['f2', trackWithEmbeddedArt],
    ['f3', trackWithOldFolderArt]
  ]);
  const knownIds = new Set(['f1', 'f2', 'f3']);
  const deltaRes = await sandbox.__exports.tryLoadGoogleChangesDelta('tok-1', existingByRemoteId, knownIds);

  assert.equal(deltaRes.handled, true);
  assert.equal(trackInRenamedFolder.discNumber, 2, 'Renamed Drive folder "Disc 2" must update child track discNumber');
  assert.deepEqual(trackInRenamedFolder.parents, ['folder-moved']);
  assert.ok(deltaRes.changedArtParents.includes('folder-disc'));
  assert.ok(deltaRes.changedArtParents.includes('folder-art'));
  assert.ok(deltaRes.changedArtParents.includes('folder-moved'));
  assert.equal(checkedGoogleArtParents.has('folder-art'), false, 'Changed folder cover parent must be evicted from checkedGoogleArtParents');

  // Now run discoverGoogleDriveFolderArtwork with forceParentIds from deltaRes
  const applied = await sandbox.__exports.discoverGoogleDriveFolderArtwork(state.tracks, { forceParentIds: deltaRes.changedArtParents });
  assert.equal(applied, 1, 'Only non-embedded folder art track should be refreshed');
  assert.equal(trackWithOldFolderArt.cover, 'data:image/jpeg;base64,FRESH_FOLDER_ART');
  assert.equal(trackWithEmbeddedArt.cover, 'data:image/jpeg;base64,EMBEDDED_FLAC_ART', 'Embedded FLAC/ID3 cover must NEVER be overwritten by folder art refresh');
});

test('2. OneDrive Delta Sync persists remoteParentId and propagates folder rename remotePath & discNumber to child tracks', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const serStart = html.indexOf('const serializableCloudTrack =');
  const serEnd = html.indexOf('let cloudMetadataQueue = [], cloudMetadataActive = 0;', serStart);
  const deltaStart = html.indexOf('async function tryLoadMicrosoftDeltaSync(token, existingByRemoteId, knownIds, siblingCoversByDir) {');
  const deltaEnd = html.indexOf('async function loadMicrosoftFiles(token) {', deltaStart);
  assert.ok(serStart > 0 && serEnd > serStart && deltaStart > 0 && deltaEnd > deltaStart);

  const persisted = [];
  const childTrack = {
    id: 'onedrive:tr-1',
    remoteId: 'tr-1',
    remoteParentId: 'folder-abc',
    remotePath: 'Music/Temp Rip/Disc 1/01 Track.flac',
    source: 'onedrive',
    name: '01 Track.flac',
    title: 'Track 1',
    artist: 'Artist',
    album: 'Temp Rip',
    discNumber: 1,
    metadataLoaded: true
  };
  const movedTrack = {
    id: 'onedrive:tr-2',
    remoteId: 'tr-2',
    remoteParentId: 'folder-old',
    remotePath: 'Music/BoxSet/Disc 1/02 Song.flac',
    source: 'onedrive',
    name: '02 Song.flac',
    title: 'Song 2',
    artist: 'Artist',
    album: 'BoxSet',
    discNumber: 1,
    metadataLoaded: true
  };
  const state = { tracks: [childTrack, movedTrack] };

  const sandbox = {
    state,
    library,
    MICROSOFT_DELTA_LINK_KEY: 'nocturne-ms-delta-link',
    Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, Promise, Date, decodeURIComponent, console,
    AUDIO_TYPES: /\.(flac|mp3|wav)$/i,
    STREAM_AUDIO_TYPES: /\.(m4a|ogg|opus)$/i,
    audioFormat: f => String(f && f.name || '').split('.').pop().toUpperCase(),
    isDsdFormat: () => false,
    isCloudAudio: f => /\.(flac|mp3|wav)$/i.test(String(f && f.name || '')),
    filenameMetadata: n => ({ title: n, artist: 'Unknown Artist', album: 'Unknown Album' }),
    coverForCatalog: c => c || '',
    loadGoogleAudio: () => {},
    loadMicrosoftAudio: () => {},
    readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=1',
    writeCloudDeltaCursor: () => {},
    persistCloudCatalog: async list => { persisted.push(...list); },
    removeCloudTracksByRemoteIds: async () => 0,
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    graphGet: async () => ({
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=2',
      value: [
        {
          id: 'folder-abc',
          name: 'Disc 2',
          folder: { childCount: 1 },
          parentReference: { path: '/drive/root:/Music/Kind of Blue' }
        },
        {
          id: 'tr-2',
          name: '02 Song.flac',
          size: 5000000,
          parentReference: { id: 'folder-disc3', path: '/drive/root:/Music/BoxSet/Disc 3' }
        }
      ]
    })
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(serStart, serEnd) + '\n' +
    html.slice(deltaStart, deltaEnd) +
    '\nthis.__exports = { serializableCloudTrack, microsoftTrack, tryLoadMicrosoftDeltaSync };',
    sandbox
  );

  // Check remoteParentId extraction & serialization
  const built = sandbox.__exports.microsoftTrack({
    id: 'new-1',
    name: '03 Blue.flac',
    parentReference: { id: 'p-99', path: '/drive/root:/Music' }
  }, 'Music/03 Blue.flac');
  assert.equal(built.remoteParentId, 'p-99');
  assert.equal(sandbox.__exports.serializableCloudTrack(built).remoteParentId, 'p-99');

  const existingByRemoteId = new Map([['tr-1', childTrack], ['tr-2', movedTrack]]);
  const knownIds = new Set(['tr-1', 'tr-2']);
  const res = await sandbox.__exports.tryLoadMicrosoftDeltaSync('ms-tok', existingByRemoteId, knownIds, new Map());

  assert.equal(res.handled, true);
  assert.equal(childTrack.remotePath, 'Music/Kind of Blue/Disc 2/01 Track.flac', 'Renamed OneDrive folder must propagate new remotePath to child tracks');
  assert.equal(childTrack.discNumber, 2, 'Renamed OneDrive folder "Disc 2" must refresh child discNumber');
  assert.equal(movedTrack.remoteParentId, 'folder-disc3');
  assert.equal(movedTrack.remotePath, 'Music/BoxSet/Disc 3/02 Song.flac');
  assert.equal(movedTrack.discNumber, 3, 'Moved OneDrive track into Disc 3 must update discNumber');
  assert.ok(persisted.includes(childTrack) && persisted.includes(movedTrack), 'Updated tracks must be persisted to IndexedDB');
});

test('3. Android MainActivity USB DAC/headphone removal triggers debounced becoming-noisy pause & JS syncs notification without ghost toasts', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(java.includes('private static boolean isExternalAudioSinkType(int t)'));
  assert.ok(java.includes('private boolean hasActiveExternalAudioSink()'));
  assert.ok(java.includes('private void triggerAudioBecomingNoisy(String reason)'));
  assert.ok(java.includes('if (nowMs - mLastBecomingNoisyAtMs < 800L) return;'));
  assert.ok(java.includes('if (!connected && !hasActiveExternalAudioSink()) {\n                triggerAudioBecomingNoisy("DEVICE_REMOVED");'));
  assert.ok(java.includes('window.__androidNoisyNativeWasPlaying='));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const noisyStart = html.indexOf('window.onAndroidAudioBecomingNoisy = () => {');
  const noisyEnd = html.indexOf('window.onAndroidAudioDeviceChanged =', noisyStart);
  assert.ok(noisyStart > 0 && noisyEnd > noisyStart);

  const toasts = [];
  const notifUpdates = [];
  let uiSynced = [];
  const audio = { paused: true, pause() { this.paused = true; } };
  const standbyAudio = { paused: true, pause() { this.paused = true; } };
  const state = {
    currentId: 't1',
    tracks: [{ id: 't1', title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue' }],
    isNativeBitPerfectPlaying: false,
    isNativeBitPerfectPaused: false
  };
  const win = {
    __androidNoisyNativeWasPlaying: false,
    NocturneNative: {
      pauseBitPerfectPlayback: () => {},
      updateMediaNotification: (t, a, al, playing) => notifUpdates.push({ t, a, al, playing })
    },
    onNativeBitPerfectStateChange: playing => uiSynced.push(playing)
  };
  const nav = { mediaSession: { playbackState: 'playing' } };
  const sandbox = {
    window: win,
    navigator: nav,
    state,
    audio,
    standbyAudio,
    library: {},
    syncPlaybackButtonsUi: p => uiSynced.push(p),
    toast: m => toasts.push(m),
    Boolean, Array
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(noisyStart, noisyEnd), sandbox);

  // Case A: Already paused -> silent (no ghost toast)
  win.onAndroidAudioBecomingNoisy();
  assert.equal(toasts.length, 0, 'Unplugging headphones while already paused must not show a spurious toast');

  // Case B: Native Bit-Perfect was playing (paused natively before JS callback) -> syncs mediaSession, notification & shows toast
  win.__androidNoisyNativeWasPlaying = true;
  win.onAndroidAudioBecomingNoisy();
  assert.equal(win.__androidNoisyNativeWasPlaying, false);
  assert.equal(nav.mediaSession.playbackState, 'paused');
  assert.equal(notifUpdates.length, 1);
  assert.equal(notifUpdates[0].playing, false);
  assert.equal(toasts.length, 1);

  // Case C: HTML5 audio was playing -> pauses audio & updates notification
  audio.paused = false;
  win.onAndroidAudioBecomingNoisy();
  assert.equal(audio.paused, true);
  assert.equal(notifUpdates.length, 2);
  assert.equal(toasts.length, 2);
});
