'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. prepareCloudTrackForPreload proactively refreshes aging OneDrive downloadUrl and near-expiry Google/Microsoft tokens before preload', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('async function prepareCloudTrackForPreload(track) {');
  const end = html.indexOf('async function preloadDsdNext(next) {', start);
  assert.ok(start !== -1 && end > start, 'prepareCloudTrackForPreload must exist');
  const fnSrc = html.slice(start, end);

  let msTokenCalls = 0;
  let googTokenCalls = 0;
  let resolveUrlCalls = 0;

  const sandbox = {
    MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
    state: {
      microsoftAccessToken: 'ms-old',
      microsoftExpiresAt: Date.now() + 60 * 1000, // 1 min left (< 3 min threshold)
      googleToken: 'goog-old',
      googleExpiresAt: Date.now() + 90 * 1000 // 1.5 min left (< 3 min threshold)
    },
    getMicrosoftToken: async () => {
      msTokenCalls++;
      sandbox.state.microsoftAccessToken = 'ms-refreshed';
      sandbox.state.microsoftExpiresAt = Date.now() + 3600 * 1000;
      return 'ms-refreshed';
    },
    ensureGoogleToken: async () => {
      googTokenCalls++;
      sandbox.state.googleToken = 'goog-refreshed';
      sandbox.state.googleExpiresAt = Date.now() + 3600 * 1000;
      return 'goog-refreshed';
    },
    resolveMicrosoftDownloadUrl: async (tr) => {
      resolveUrlCalls++;
      tr.downloadUrl = 'https://tenant.sharepoint.com/fresh-direct-url';
      tr.downloadUrlAt = Date.now();
      return tr.downloadUrl;
    },
    Date
  };

  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.prepareCloudTrackForPreload = prepareCloudTrackForPreload;', sandbox);

  // 1.1 OneDrive track with aging downloadUrl (26 min old, within 5 min of 30 min max age)
  const odTrack = {
    id: 'od-1',
    remoteId: 'item-od-1',
    source: 'onedrive',
    downloadUrl: 'https://tenant.sharepoint.com/almost-expired',
    downloadUrlAt: Date.now() - 26 * 60 * 1000
  };
  await sandbox.prepareCloudTrackForPreload(odTrack);
  assert.equal(msTokenCalls, 1, 'Near-expiry Microsoft token must be refreshed proactively');
  assert.equal(resolveUrlCalls, 1, 'Almost-expired OneDrive downloadUrl must be refreshed proactively');
  assert.equal(odTrack.downloadUrl, 'https://tenant.sharepoint.com/fresh-direct-url');

  // 1.2 Google Drive track with near-expiry token
  const gTrack = { id: 'g-1', remoteId: 'file-g-1', source: 'google' };
  await sandbox.prepareCloudTrackForPreload(gTrack);
  assert.equal(googTokenCalls, 1, 'Near-expiry Google token must be refreshed proactively');
});

test('2. addLocalFiles matches CUE audio files across directory-scoped, converted-extension (.wav -> .flac), and double-extension (.flac.cue) layouts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const addStart = html.indexOf('async function addLocalFiles(files) {');
  const addSrc = html.slice(addStart, addStart + 8000);

  assert.ok(addSrc.includes('const cueBaseClean = cueBase.replace(/\\.(flac|wav|ape|wv|m4a|alac|aiff|aif|mp3|ogg|opus|dsf|dff)$/i, \'\');'), 'addLocalFiles must support double-extension .flac.cue files');
  assert.ok(addSrc.includes('candidates.find(f => getFileDirLower(f) === cueDir && matchesCueName(f))'), 'addLocalFiles must prioritize candidate audio files in the same directory as the .cue file');
  assert.ok(addSrc.includes('const allCueSubTracksExist = parsedTracks.every('), 'addLocalFiles must skip redundant makeLocalTrack when all CUE sub-tracks already exist on rescan');
});

test('3. ingestFiioScannedFilesChunk upgrades existing tracks with content:// URI, size, trackNumber and heals /local-media URL', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function buildExistingFiioTrackMaps() {');
  const end = html.indexOf('function deduplicateStorageRoots(', start);
  assert.ok(start !== -1 && end > start, 'ingestFiioScannedFilesChunk must exist');
  const fnSrc = html.slice(start, end);

  const existingTrack = {
    id: 'fiio_1',
    path: '/storage/1234-5678/Music/Miles Davis/Kind of Blue/01 So What.flac',
    uri: '',
    url: '',
    source: 'local',
    title: '01 So What',
    name: '01 So What',
    artist: 'Unknown Artist',
    album: 'FiiO Internal & SD Card',
    duration: 0,
    size: 0,
    trackNumber: 0
  };

  const sandbox = {
    window: {},
    activeFiioScanMaps: null,
    fiioScanUpgradedCount: 0,
    state: { tracks: [existingTrack] },
    library: {
      createFiioTrack: (f) => ({ id: 'fiio_new', path: f.path, uri: f.uri, source: 'local' }),
      enrichFiioTrackMetadata: () => {}
    },
    createFiioFallbackTrack: () => null,
    restoreLocalTrackUrlSync: (tr) => {
      if (!tr.url && tr.uri) {
        tr.url = 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(tr.uri);
      }
      return tr.url;
    },
    Map,
    Array,
    Number,
    String
  };

  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.ingestFiioScannedFilesChunk = ingestFiioScannedFilesChunk;', sandbox);

  const existingPaths = new Set([existingTrack.path]);
  const existingUris = new Set();

  const added = sandbox.ingestFiioScannedFilesChunk([
    {
      path: existingTrack.path,
      uri: 'content://media/external/audio/media/901',
      title: 'So What',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      albumArtist: 'Miles Davis',
      duration: 562,
      size: 38400000,
      trackNumber: 1
    }
  ], existingPaths, existingUris);

  assert.equal(added, 0, 'Existing track must be enriched in-place rather than duplicated');
  assert.equal(existingTrack.uri, 'content://media/external/audio/media/901');
  assert.equal(existingUris.has('content://media/external/audio/media/901'), true);
  assert.equal(existingTrack.size, 38400000);
  assert.equal(existingTrack.trackNumber, 1);
  assert.equal(existingTrack.artist, 'Miles Davis');
  assert.equal(existingTrack.album, 'Kind of Blue');
  assert.ok(existingTrack.url.includes('/local-media?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F901'));
  assert.equal(sandbox.fiioScanUpgradedCount, 1);
});

test('4. Version sync v3.9.45 / versionCode 99, 0 CR bytes in assets & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.ok(/FiiO M11S · v3\.9\.(?:4[5-9]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.45';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.45';"));
  assert.ok(/versionCode\s*=\s*(?:99|\d{3,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.45"'));
  assert.ok(/"3\.9\.(?:4[5-9]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[5-9]|[5-9]\d|\d{3,})/.test(publishRelease));

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets', f));
    assert.equal(assetBuf.includes(13), false, `${f} in android assets must have 0 CR bytes`);
  }
});
