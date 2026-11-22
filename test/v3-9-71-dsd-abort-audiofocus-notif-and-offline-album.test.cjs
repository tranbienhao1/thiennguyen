'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Cloud DSD fetchCloudFile deduplicates, aborts cleanly via releaseUnusedCloudUrl, frees skipped RAM, and falls back 2-layer on OneDrive Shared', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const relStart = html.indexOf('function releaseUnusedCloudUrl(track) {');
  const relEnd = html.indexOf('function releaseUnusedLocalUrl(track) {', relStart);
  const ffStart = html.indexOf('async function fetchCloudFile(track, url, options, provider) {');
  const ffEnd = html.indexOf('async function loadGoogleAudio(', ffStart);
  assert.ok(relStart > 0 && relEnd > relStart);
  assert.ok(ffStart > 0 && ffEnd > ffStart);

  let fetchCalls = 0;
  let capturedSignal = null;
  let rejectPendingFetch = null;

  class MockFile {
    constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts && opts.type; this.size = (parts[0] && parts[0].size) || 0; }
  }

  const sandbox = {
    AbortController,
    File: MockFile,
    URL,
    Date,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    location: { href: 'https://app.example/' },
    audio: { src: '' },
    standbyAudio: { src: '' },
    state: { currentId: 'dsd_1', preloadTrackId: null, microsoftAccessToken: 'ms-tok' },
    releaseTrackUrl: () => {},
    isGraphContentUrl: (u) => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
    isDsdFormat: (f) => /^(dsf|dff|dsd)$/i.test(String(f || '')),
    loadCloudMetadata: async () => {},
    persistCloudCatalog: async () => {},
    readAudioMetadata: async () => ({ sampleRate: 2822400, channels: 2, duration: 200 }),
    resolveMicrosoftDownloadUrl: async (tr) => {
      tr.downloadUrl = 'https://sharepoint.example/fresh-blocked';
      tr.downloadUrlAt = Date.now();
      return tr.downloadUrl;
    },
    getMicrosoftToken: async () => 'ms-bearer',
    library: {
      fetchAudioBlob: (url, opts) => {
        fetchCalls++;
        capturedSignal = opts && opts.signal;
        if (url.includes('abort-me')) {
          return new Promise((_, reject) => {
            rejectPendingFetch = reject;
            if (capturedSignal) {
              capturedSignal.addEventListener('abort', () => {
                const err = new Error('Aborted'); err.name = 'AbortError';
                reject(err);
              });
            }
          });
        }
        if (url.includes('old-direct') || url.includes('fresh-blocked')) {
          const e = new Error('403 forbidden'); e.status = 403;
          return Promise.reject(e);
        }
        if (url.includes('/drives/drv-shared-5/items/dsd-item-9/content')) {
          return Promise.resolve({ size: 512000, type: 'audio/x-dsf' });
        }
        return Promise.reject(new Error('Unexpected URL: ' + url));
      },
      normalizeAudioBlob: (b) => b
    },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(relStart, relEnd) + '\n' + html.slice(ffStart, ffEnd) +
    '\nthis.releaseUnusedCloudUrl = releaseUnusedCloudUrl; this.fetchCloudFile = fetchCloudFile;',
    sandbox
  );

  // 1.1 Concurrent dedup + mid-load abort via releaseUnusedCloudUrl when track skipped
  const skippedDsd = { id: 'dsd_1', source: 'google', isDsd: true, format: 'DSF', name: '01.dsf', title: 'DSD 1', metadataLoaded: true, cover: 'x' };
  const p1 = sandbox.fetchCloudFile(skippedDsd, 'https://drive.example/abort-me', {}, 'Google Drive');
  const p2 = sandbox.fetchCloudFile(skippedDsd, 'https://drive.example/abort-me', {}, 'Google Drive');
  assert.equal(fetchCalls, 1, 'Concurrent fetchCloudFile calls for same DSD track must coalesce');
  assert.ok(skippedDsd._dsdFetchAbort, '_dsdFetchAbort controller must be attached');

  sandbox.state.currentId = 'dsd_2';
  sandbox.releaseUnusedCloudUrl(skippedDsd);
  await assert.rejects(() => Promise.all([p1, p2]), err => err && err.name === 'AbortError');
  assert.equal(skippedDsd.file, undefined, 'Aborted DSD download must not allocate track.file');
  assert.equal(skippedDsd._dsdFetchAbort, null, '_dsdFetchAbort must be cleared after abort');

  // 1.2 OneDrive Shared 2-layer fallback + RAM release when skipped later
  const odDsd = { id: 'dsd_2', source: 'onedrive', isDsd: true, format: 'DSF', remoteId: 'dsd-item-9', remoteDriveId: 'drv-shared-5', name: '02.dsf', title: 'DSD 2', metadataLoaded: true, cover: 'x' };
  const fileRes = await sandbox.fetchCloudFile(odDsd, 'https://sharepoint.example/old-direct', {}, 'OneDrive');
  assert.ok(fileRes && odDsd.file === fileRes, '2-layer OneDrive Shared DSD fallback must succeed via Graph /drives/{remoteDriveId}/items/{id}/content');

  // Still active track keeps track.file; once skipped, releaseUnusedCloudUrl frees track.file to save RAM
  sandbox.releaseUnusedCloudUrl(odDsd);
  assert.ok(odDsd.file, 'Currently playing Cloud DSD track must keep track.file');
  sandbox.state.currentId = 'other_3';
  sandbox.releaseUnusedCloudUrl(odDsd);
  assert.equal(odDsd.file, null, 'Skipped Cloud DSD track must release track.file to avoid RAM exhaustion on FiiO M11S');
});

test('2. MainActivity.java syncs MediaSession notification and Bit-Perfect position immediately on AudioFocus transitions', () => {
  const javaSrc = fs.readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
    'utf8'
  );
  assert.ok(javaSrc.includes('private void syncAudioFocusNativeUiAndMediaSession(final boolean isPlaying)'), 'MainActivity must define syncAudioFocusNativeUiAndMediaSession');
  assert.ok(javaSrc.includes('showMediaNotification(mLastMediaTitle, mLastMediaArtist, mLastMediaAlbum, isPlaying)'), 'AudioFocus sync must immediately refresh native MediaSession/notification');
  assert.ok(javaSrc.includes('onNativeBitPerfectPosition'), 'AudioFocus resume must sync native Bit-Perfect position to WebView');
  const afSlice = javaSrc.slice(javaSrc.indexOf('public boolean requestAudioFocus()'), javaSrc.indexOf('public void abandonAudioFocus()'));
  assert.ok(afSlice.includes('syncAudioFocusNativeUiAndMediaSession(false);'), 'AudioFocus loss/transient must sync paused state');
  assert.ok(afSlice.includes('syncAudioFocusNativeUiAndMediaSession(true);'), 'AudioFocus gain resume must sync playing state');
});

test('3. playNext skips uncached Cloud tracks in sequential album mode when offline + v3.9.71 alignment', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lib = require(path.join(ROOT, 'library-utils.js'));
  const pnStart = html.indexOf('function playNext(direction = 1, auto = false) {');
  const pnEnd = html.indexOf('if (direction > 0 && state.shuffle', pnStart);
  assert.ok(pnStart > 0 && pnEnd > pnStart);

  // Extract full playNext safely
  const braceStart = html.indexOf('{', pnStart);
  let depth = 0, endIdx = braceStart;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  const playNextSrc = html.slice(pnStart, endIdx);

  const played = [];
  const toasts = [];
  const t1 = { id: 'local_1', source: 'local', title: 'Local 1', album: 'Mixed' };
  const t2 = { id: 'cloud_2', source: 'google', title: 'Uncached Cloud 2', album: 'Mixed', firstSliceCached: false };
  const t3 = { id: 'cloud_3', source: 'onedrive', title: 'Cached Cloud 3', album: 'Mixed', firstSliceCached: true };

  const sandbox = {
    URL, Number, String, Boolean, Array, Map, Set, Math,
    location: { href: 'https://app.example/' },
    navigator: { onLine: false },
    window: {},
    audio: { currentTime: 0, pause() {}, play() {} },
    standbyAudio: { paused: true, pause() {} },
    library: lib,
    NocturneLibrary: lib,
    state: {
      tracks: [t1, t2, t3],
      currentId: 'local_1',
      playbackContext: { type: 'album', key: 'album:mixed', name: 'Mixed', trackIds: ['local_1', 'cloud_2', 'cloud_3'] },
      queueTrackIds: ['cloud_2', 'cloud_3'],
      autoplay: true,
      repeat: 0,
      shuffle: false,
      activeFocus: 'all'
    },
    trackById: (id) => sandbox.state.tracks.find(t => t.id === id),
    queueTracks: () => [],
    resolveActiveAlbumTracks: () => ({ name: 'Mixed', tracks: sandbox.state.tracks }),
    renderQueue: () => {},
    playTrack: (id) => played.push(id),
    toast: (m) => toasts.push(m)
  };

  vm.createContext(sandbox);
  vm.runInContext(playNextSrc + '\nthis.playNext = playNext;', sandbox);

  // 3.1 Mixed album offline: skips uncached cloud_2 and plays cached cloud_3
  sandbox.playNext(1, false);
  assert.deepEqual(played, ['cloud_3'], 'Offline sequential album must skip uncached cloud_2 and play offline-playable cloud_3');

  // 3.2 All remaining album tracks uncached offline: toasts clear offline notice without calling playTrack
  played.length = 0;
  toasts.length = 0;
  t3.firstSliceCached = false;
  sandbox.state.currentId = 'local_1';
  sandbox.playNext(1, false);
  assert.deepEqual(played, [], 'Must not attempt to play uncached Cloud track when offline');
  assert.ok(toasts.some(m => m.includes('ngoại tuyến')), 'Must toast clear offline message when no remaining album tracks are playable offline');

  // 3.3 Version alignment v3.9.71+ / versionCode >= 125
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.71';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.71';"));
  assert.ok(gradle.includes('versionCode = 125'));
  assert.ok(gradle.includes('versionName = "3.9.71"'));
  assert.ok(/FiiO M11S · v3\.9\.(?:7[1-9]|[89]\d|\d{3,})/.test(html));
});
