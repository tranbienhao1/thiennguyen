'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradleKts = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainActivityJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

test('v3.9.79+ version synchronization across sw.js, index.html, and build.gradle.kts (versionCode >= 133)', () => {
  const swMatch = swJs.match(/const CACHE_VERSION = 'v3\.9\.(\d+)';/);
  assert.ok(swMatch && Number(swMatch[1]) >= 79);
  const nameMatch = swJs.match(/const CACHE_NAME = 'nocturne-v3\.9\.(\d+)';/);
  assert.ok(nameMatch && Number(nameMatch[1]) >= 79);
  assert.ok(indexHtml.includes('FiiO M11S · v3.9.' + swMatch[1]), 'FiiO badge should match CACHE_VERSION');
  const codeMatch = gradleKts.match(/versionCode = (\d+)\b/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 133);
  assert.ok(gradleKts.includes('versionName = "3.9.' + swMatch[1] + '"'));
});

test('v3.9.79 invalidateCloudTrackContent clears retry backoffs & preloaded standby track, and enrichCloudTrack overwrites updated binary audio specs', async () => {
  const invStart = indexHtml.indexOf('function invalidateCloudTrackContent(track) {');
  const invEnd = indexHtml.indexOf('function releaseUnusedCloudUrl(track) {', invStart);
  assert.ok(invStart > 0 && invEnd > invStart);

  let clearedPreload = 0;
  let releasedTrackId = null;
  const invSandbox = {
    state: {
      currentId: 'google:playing1',
      preloadTrackId: 'onedrive:preloaded2',
      preloadReadyUrl: 'blob:https://appassets.androidplatform.net/stale-preload'
    },
    deleteCachedFirstSlice: () => {},
    clearStalePreload: () => {
      clearedPreload++;
      invSandbox.state.preloadTrackId = null;
      invSandbox.state.preloadReadyUrl = null;
    },
    releaseUnusedCloudUrl: (tr) => { releasedTrackId = tr.id; }
  };
  vm.createContext(invSandbox);
  vm.runInContext(indexHtml.slice(invStart, invEnd), invSandbox);

  const editedTrack = {
    id: 'onedrive:preloaded2',
    source: 'onedrive',
    remoteId: 'preloaded2',
    firstSliceCached: true,
    _loadedFromSliceCache: true,
    metadataLoaded: true,
    metadataRetryAt: Date.now() + 3600000,
    thumbnailRetryAt: Date.now() + 3600000,
    _metaRateLimitRetries: 2,
    downloadUrl: 'https://stale.sharepoint.com/temp',
    downloadUrlAt: Date.now()
  };

  assert.equal(invSandbox.invalidateCloudTrackContent(editedTrack), true);
  assert.equal(editedTrack.metadataRetryAt, undefined, 'Should clear metadataRetryAt so re-enrichment is not blocked');
  assert.equal(editedTrack.thumbnailRetryAt, undefined, 'Should clear thumbnailRetryAt so updated cover is fetched');
  assert.equal(editedTrack._metaRateLimitRetries, 0);
  assert.equal(clearedPreload, 1, 'Should clear stale preload when invalidated track was preloaded on standbyAudio');
  assert.equal(releasedTrackId, 'onedrive:preloaded2', 'Should release unused cloud URL after clearing preloadTrackId');

  // Verify enrichCloudTrack overwrites sampleRate, bitDepth, channels, duration, albumArtist, iTunNORM, lyricsText from binary tags
  const enrichStart = indexHtml.indexOf('async function enrichCloudTrack(track) {');
  const enrichEnd = indexHtml.indexOf('const dsdWorkerBaseUrl =', enrichStart);
  assert.ok(enrichStart > 0 && enrichEnd > enrichStart);
  const enrichBlock = indexHtml.slice(enrichStart, enrichEnd);
  assert.ok(enrichBlock.includes('if (tagAa) track.albumArtist = tagAa;'));
  assert.ok(enrichBlock.includes('if (tags.sampleRate > 0) track.sampleRate = tags.sampleRate;'));
  assert.ok(enrichBlock.includes('if (tags.bitDepth > 0) track.bitDepth = tags.bitDepth;'));
  assert.ok(enrichBlock.includes('if (tags.channels > 0) track.channels = tags.channels;'));
  assert.ok(enrichBlock.includes('if (tags.duration > 0) track.duration = tags.duration;'));
  assert.ok(enrichBlock.includes('if (tags.lyrics) track.lyricsText = tags.lyrics;'));
});

test('v3.9.79 applyMicrosoftSiblingFolderCovers refreshes non-embedded folder covers on delta forceUpdate or folder move', async () => {
  const fnStart = indexHtml.indexOf('async function applyMicrosoftSiblingFolderCovers(siblingCoversByDir) {');
  const fnEnd = indexHtml.indexOf('async function applyMicrosoftSiblingLrcLinks(', fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart);

  const trackMoved = {
    id: 'onedrive:m1',
    source: 'onedrive',
    remotePath: 'Jazz/NewFolder/Track1.flac',
    cover: 'data:image/jpeg;base64,OLD_FOLDER_COVER',
    metadataLoaded: false,
    _needsFolderCoverRefresh: true
  };
  const trackEmbedded = {
    id: 'onedrive:m2',
    source: 'onedrive',
    remotePath: 'Jazz/NewFolder/Track2.flac',
    cover: 'data:image/jpeg;base64,EMBEDDED_ID3_COVER',
    metadataLoaded: true
  };

  let receivedForceOpts = null;
  const sandbox = {
    Map,
    Array,
    Promise,
    Math,
    String,
    Boolean,
    encodeURIComponent,
    trackMetadataRevision: 0,
    state: {
      tracks: [trackMoved, trackEmbedded],
      microsoftAccessToken: 'tok_123'
    },
    library: {
      resolveFolderCoverWithDiscFallback: (map, dir) => map.get(dir) || null
    },
    fetchCloudImageCandidateDataUrl: async () => 'data:image/jpeg;base64,NEW_FOLDER_COVER',
    applyDiscoveredCloudFolderCover: (matched, cover, opts) => {
      receivedForceOpts = opts;
      const changed = [];
      for (const tr of matched) {
        if (tr.cover && tr.cover !== '♫' && (!(opts && opts.forceNonEmbedded) || tr.metadataLoaded)) continue;
        tr.cover = cover;
        changed.push(tr);
      }
      return changed;
    },
    propagateAndBroadcastCovers: () => {},
    scheduleTrackRender: () => {},
    persistCloudCatalog: async () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(indexHtml.slice(fnStart, fnEnd), sandbox);

  const siblingMap = new Map([
    ['Jazz/NewFolder', { id: 'cov1', name: 'cover.jpg', score: 100, downloadUrl: 'https://1drv.ms/cov1', forceUpdate: true }]
  ]);
  const applied = await sandbox.applyMicrosoftSiblingFolderCovers(siblingMap);
  assert.equal(applied, 1);
  assert.equal(Boolean(receivedForceOpts && receivedForceOpts.forceNonEmbedded), true);
  assert.equal(trackMoved.cover, 'data:image/jpeg;base64,NEW_FOLDER_COVER');
  assert.equal(trackMoved._needsFolderCoverRefresh, false);
  assert.equal(trackEmbedded.cover, 'data:image/jpeg;base64,EMBEDDED_ID3_COVER', 'Embedded cover must not be overwritten');
});

test('v3.9.79 removeFromQueue & moveQueueTrack unpin stale preloadTrackId and MainActivity resolves MediaStore storage aliases', () => {
  const qStart = indexHtml.indexOf('function addToQueue(trackId) {');
  const qEnd = indexHtml.indexOf('function syncAutoplayButton() {', qStart);
  assert.ok(qStart > 0 && qEnd > qStart);

  let preloadNextCalls = 0;
  const qSandbox = {
    Array,
    String,
    state: {
      currentId: 't_now',
      isNativeBitPerfectPlaying: true,
      queueTrackIds: ['t_next_1', 't_next_2'],
      queue: [{ id: 't_next_1' }, { id: 't_next_2' }],
      preloadTrackId: 't_next_1',
      preloadReadyUrl: 'blob:https://appassets.androidplatform.net/t_next_1',
      lyricsPreloadLifecycle: null
    },
    audio: { src: '' }, // Empty during Native Bit-Perfect playback
    trackById: (id) => ({ id, title: id }),
    library: { trackMetadata: (t) => t },
    refreshQueueRows: () => {},
    renderQueue: () => {},
    toast: () => {},
    preloadNext: () => { preloadNextCalls++; }
  };
  vm.createContext(qSandbox);
  vm.runInContext(indexHtml.slice(qStart, qEnd), qSandbox);

  // Removing the preloaded head-of-queue track unpins state.preloadTrackId and triggers preloadNext even in Bit-Perfect mode
  qSandbox.removeFromQueue('t_next_1');
  assert.equal(qSandbox.state.preloadTrackId, null, 'Must unpin removed track from preloadTrackId so shuffle queueIndex does not replay it');
  assert.equal(qSandbox.state.preloadReadyUrl, null);
  assert.equal(preloadNextCalls, 1, 'Must call preloadNext(true) even when Native Bit-Perfect is active and audio.src is empty');

  // Verify MainActivity.java queryMediaStoreAudioWithStorageAliases maps /sdcard/ <-> /storage/emulated/0/ and /mnt/media_rw/ <-> /storage/
  assert.ok(mainActivityJava.includes('private Uri queryMediaStoreAudioWithStorageAliases(@Nullable String candidatePath)'));
  assert.ok(mainActivityJava.includes('queryMediaStoreAudioByDataPath("/storage/emulated/0/" + candidatePath.substring(8))'));
  assert.ok(mainActivityJava.includes('queryMediaStoreAudioByDataPath("/sdcard/" + candidatePath.substring(20))'));
  assert.ok(mainActivityJava.includes('queryMediaStoreAudioByDataPath("/storage/" + candidatePath.substring(14))'));
  assert.ok(mainActivityJava.includes('queryMediaStoreAudioByDataPath("/mnt/media_rw/" + candidatePath.substring(9))'));
});
