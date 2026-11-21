'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. MainActivity.java BitPerfectAudioPlayer unblocks rapid skips, rescues content:// PFD/bitrate duration & guards corrupt streams', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const bpStart = java.indexOf('public class BitPerfectAudioPlayer {');
  const bpEnd = java.indexOf('private final BitPerfectAudioPlayer mBitPerfectPlayer', bpStart);
  assert.ok(bpStart !== -1 && bpEnd > bpStart);
  const bp = java.slice(bpStart, bpEnd);

  // 1.1 stopInternal unblocks AudioTrack write BEFORE joining mPlaybackThread, keeping epoch guard first
  const stopStart = bp.indexOf('private synchronized void stopInternal(boolean preserveSession)');
  const stopEnd = bp.indexOf('public boolean isActive()', stopStart);
  const stopSrc = bp.slice(stopStart, stopEnd);
  assert.ok(stopSrc.includes('mPlaybackEpoch.incrementAndGet();'));
  const unblockIdx = stopSrc.indexOf('AudioTrack unblockTrack = mAudioTrack;');
  const stopCallIdx = stopSrc.indexOf('unblockTrack.stop();', unblockIdx);
  const joinIdx = stopSrc.indexOf('mPlaybackThread.join(800);');
  const releaseIdx = stopSrc.indexOf('mAudioTrack.release();');
  assert.ok(unblockIdx > 0 && stopCallIdx > unblockIdx && joinIdx > stopCallIdx && releaseIdx > joinIdx,
    'stopInternal must pause/flush/stop AudioTrack BEFORE join(800) and release AFTER join');

  // 1.2 content:// ParcelFileDescriptor fallback & bitrate duration estimate while preserving test/android-apk-playback-fix contract
  assert.ok(bp.includes('extractor.setDataSource(MainActivity.this, Uri.parse(resolvedUri), null);'));
  assert.ok(bp.includes('getContentResolver().openFileDescriptor(Uri.parse(resolvedUri), "r")'));
  assert.ok(bp.includes('extractor.setDataSource(dsPfd.getFileDescriptor())'));
  assert.ok(bp.includes('durMmr.setDataSource(mmrPfd.getFileDescriptor())'));
  assert.ok(bp.includes('private static long estimateBitrateDurationMs(long fileBytes, int bitrateBps)'));
  assert.ok(bp.includes('long estMs = estimateBitrateDurationMs(knownSourceBytes, bps);'));

  // 1.3 Early no-audio-stream exit uses pendingErrorReason so finally releases AudioFocus first
  assert.ok(!bp.includes('notifyBitPerfectErrorToWeb("No audio stream found in source");'));
  assert.ok(bp.includes('pendingErrorReason = "No audio stream found in source";\n                    return;'));

  // 1.4 Corrupt/truncated frame guard, EOS idle-drain cap, dead AudioTrack exit & null-safe mWebView post
  assert.ok(bp.includes('int idleDrainIterations = 0;'));
  assert.ok(bp.includes('int consecutiveCodecErrors = 0;'));
  assert.ok(bp.includes('if (writtenFramesSinceBase > 0L && consecutiveCodecErrors >= 5)'));
  assert.ok(bp.includes('if (idleDrainIterations >= 200)'));
  assert.ok(bp.includes('if (written < 0) {'));
  assert.ok(bp.includes('pendingErrorReason = "AudioTrack write error (" + written + ")";'));
  assert.ok(bp.includes('if (sawOutputEOS && !mIsStopped && mPlaybackEpoch.get() == epoch) {\n                    if (mWebView != null) {'));
});

test('2. Cloud renamed/moved track preservation across mergeMicrosoftTrack, Drive delta & OneDrive delta', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const library = require(path.join(ROOT, 'library-utils.js'));

  const msTrackBlockStart = html.indexOf('const MAX_CATALOG_COVER_CHARS =');
  const msTrackBlockEnd = html.indexOf('let cloudMetadataQueue = [], cloudMetadataActive = 0;', msTrackBlockStart);
  const gBlockStart = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
  const gBlockEnd = html.indexOf('function removeDeletedCloudTracks(', gBlockStart);
  const msDeltaStart = html.indexOf('async function saveMicrosoftLatestDeltaLink(token) {');
  const msDeltaEnd = html.indexOf('async function loadMicrosoftFiles(token) {', msDeltaStart);

  assert.ok(msTrackBlockStart !== -1 && msTrackBlockEnd > msTrackBlockStart);
  assert.ok(gBlockStart !== -1 && gBlockEnd > gBlockStart);
  assert.ok(msDeltaStart !== -1 && msDeltaEnd > msDeltaStart);

  const storageMap = new Map([
    ['nocturne-google-delta-token', 'g-cur-1'],
    ['nocturne-microsoft-delta-link', 'https://graph.microsoft.com/v1.0/delta?token=ms-1']
  ]);

  const richDriveTrack = {
    id: 'google:g-rich', remoteId: 'g-rich', source: 'google',
    name: '01 Old.flac', title: 'Real Embedded Title', artist: 'Real Artist', album: 'Real Album',
    cover: 'data:image/jpeg;base64,RICH', rating: 5, size: 1000, contentRev: 'rev-1', metadataLoaded: true
  };
  const fallbackDriveTrack = {
    id: 'google:g-raw', remoteId: 'g-raw', source: 'google',
    name: '01 Old Name.flac', title: '01 Old Name', artist: 'Unknown Artist', album: 'Unknown Album',
    cover: 'data:image/jpeg;base64,RAW', rating: 4, size: 2000, contentRev: 'rev-2', metadataLoaded: false
  };
  const richMsTrack = {
    id: 'onedrive:ms-rich', remoteId: 'ms-rich', source: 'onedrive',
    name: '02 Old.flac', title: 'Rich FLAC Title', artist: 'Rich FLAC Artist', album: 'Rich Album', albumArtist: 'Rich Album Artist',
    duration: 345, cover: 'data:image/jpeg;base64,MSRICH', size: 3000, contentRev: 'c-1', metadataLoaded: true
  };
  const fallbackMsTrack = {
    id: 'onedrive:ms-raw', remoteId: 'ms-raw', source: 'onedrive',
    name: 'Old File Name.flac', title: 'Old File Name', artist: 'Unknown Artist', album: 'Unknown Album',
    size: 4000, contentRev: 'c-2', metadataLoaded: false
  };

  const sandbox = {
    library,
    Date,
    Array,
    Number,
    String,
    Object,
    Boolean,
    Set,
    Map,
    URLSearchParams,
    decodeURIComponent,
    encodeURIComponent,
    localStorage: {
      getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: k => storageMap.delete(k)
    },
    filenameMetadata: name => {
      const base = String(name).replace(/\.[^.]+$/, '');
      const parts = base.split(' - ');
      return parts.length >= 2
        ? { title: parts[1], artist: parts[0], album: 'Renamed Album' }
        : { title: base, artist: 'Unknown Artist', album: 'Unknown Album' };
    },
    audioFormat: () => 'FLAC',
    isDsdFormat: () => false,
    isCloudAudio: f => Boolean(f && f.name && f.name.endsWith('.flac')),
    loadGoogleAudio: () => async () => {},
    loadMicrosoftAudio: () => async () => {},
    ensureGoogleToken: async () => 'g-tok',
    googleConfigurationHint: () => '',
    invalidateCloudTrackContent: tr => { tr.metadataLoaded = false; },
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    catalogTransaction: () => {
      const store = { delete: () => {}, transaction: {} };
      queueMicrotask(() => { if (typeof store.transaction.oncomplete === 'function') store.transaction.oncomplete(); });
      return store;
    },
    state: { currentId: null, tracks: [richDriveTrack, fallbackDriveTrack, richMsTrack, fallbackMsTrack] },
    fetchGoogleDrivePageWithRetry: async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        newStartPageToken: 'g-cur-2',
        changes: [
          { fileId: 'g-rich', file: { id: 'g-rich', name: 'Renamed On Drive.flac', size: '1000', md5Checksum: 'rev-1' } },
          { fileId: 'g-raw', file: { id: 'g-raw', name: 'Miles Davis - Blue In Green.flac', size: '2000', md5Checksum: 'rev-2' } }
        ]
      })
    }),
    graphGet: async () => ({
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=ms-2',
      value: [
        { id: 'ms-raw', name: 'Bill Evans - Waltz for Debby.flac', size: 4000, cTag: 'c-2', parentReference: { path: '/drive/root:/Jazz Moved' } }
      ]
    })
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(msTrackBlockStart, msTrackBlockEnd) + '\n' +
      html.slice(gBlockStart, gBlockEnd) + '\n' +
      html.slice(msDeltaStart, msDeltaEnd) +
      '\nthis.mergeMicrosoftTrack = mergeMicrosoftTrack;' +
      '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;' +
      '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;',
    sandbox
  );

  // 2.1 mergeMicrosoftTrack preserves loaded ID3/FLAC metadata & duration when item.audio is sparse
  sandbox.mergeMicrosoftTrack(richMsTrack, {
    id: 'ms-rich',
    name: '02 New Name.flac',
    audio: { title: 'Sparse Graph Title' },
    cTag: 'c-1'
  }, 'Jazz/02 New Name.flac');
  assert.equal(richMsTrack.metadataLoaded, true);
  assert.equal(richMsTrack.duration, 345, 'Existing duration must be preserved when Graph audio omits duration');
  assert.equal(richMsTrack.title, 'Rich FLAC Title', 'Enriched ID3/FLAC title must not be downgraded by sparse Graph audio');
  assert.equal(richMsTrack.artist, 'Rich FLAC Artist');
  assert.equal(richMsTrack.albumArtist, 'Rich Album Artist');
  assert.equal(richMsTrack.remotePath, 'Jazz/02 New Name.flac');

  // 2.2 Google Drive delta rename preserves rich metadata while refreshing unparsed filename fallback
  const gMap = new Map([['g-rich', richDriveTrack], ['g-raw', fallbackDriveTrack]]);
  await sandbox.tryLoadGoogleChangesDelta('g-tok', gMap, new Set(gMap.keys()));
  assert.equal(richDriveTrack.name, 'Renamed On Drive.flac');
  assert.equal(richDriveTrack.title, 'Real Embedded Title', 'Loaded Drive metadata must stay intact across file rename');
  assert.equal(fallbackDriveTrack.name, 'Miles Davis - Blue In Green.flac');
  assert.equal(fallbackDriveTrack.title, 'Blue In Green', 'Unloaded Drive track must refresh filename metadata on rename');
  assert.equal(fallbackDriveTrack.artist, 'Miles Davis');
  assert.equal(fallbackDriveTrack.rating, 4);
  assert.equal(fallbackDriveTrack.cover, 'data:image/jpeg;base64,RAW');

  // 2.3 OneDrive delta rename/move updates remotePath + name + filename fallback without needing item.audio
  const msMap = new Map([['ms-rich', richMsTrack], ['ms-raw', fallbackMsTrack]]);
  await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', msMap, new Set(msMap.keys()), new Map());
  assert.equal(fallbackMsTrack.name, 'Bill Evans - Waltz for Debby.flac');
  assert.equal(fallbackMsTrack.remotePath, 'Jazz Moved/Bill Evans - Waltz for Debby.flac');
  assert.equal(fallbackMsTrack.title, 'Waltz for Debby');
  assert.equal(fallbackMsTrack.artist, 'Bill Evans');
});

test('3. FiiO local move/rename reconciliation preserves URI moves, path renames & history keys across unique matches', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const library = require(path.join(ROOT, 'library-utils.js'));
  const start = html.indexOf('function buildExistingFiioTrackMaps() {');
  const end = html.indexOf('window.pruneMissingFiioTracks = pruneMissingFiioTracks;', start);
  assert.ok(start !== -1 && end > start);

  const uriMovedTrack = {
    id: 'fiio_uri_1',
    source: 'local',
    path: '/storage/SD/OldDir/01 - Old Song.flac',
    uri: 'content://media/external/audio/media/42',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2FSD%2FOldDir%2F01%20-%20Old%20Song.flac',
    name: '01 - Old Song',
    title: '01 - Old Song',
    artist: 'Coltrane',
    album: 'A Love Supreme',
    size: 40000000,
    cover: 'data:image/jpeg;base64,CUSTOM_COVER',
    rating: 5,
    lyricsText: '[00:10] Praise'
  };

  const ghostOldTrack = {
    id: 'fiio_ghost_1',
    source: 'local',
    path: '/storage/SD/Inbox/02 - Resolution.flac',
    uri: 'content://media/external/audio/media/77',
    name: '02 - Resolution',
    title: 'Resolution',
    artist: 'John Coltrane',
    album: 'A Love Supreme',
    albumArtist: 'John Coltrane',
    size: 51234567,
    sampleRate: 96000,
    bitDepth: 24,
    channels: 2,
    duration: 440,
    cover: 'data:image/jpeg;base64,MOVED_ART',
    rating: 5,
    lyricsText: '[00:15] Part II',
    metadataLoaded: true
  };

  const scannedNewTrack = {
    id: 'fiio_new_99',
    source: 'local',
    path: '/storage/SD/Jazz/Coltrane/02 - Resolution.flac',
    uri: 'content://media/external/audio/media/999',
    name: '02 - Resolution',
    title: '02 - Resolution',
    artist: 'John Coltrane',
    album: 'FiiO Internal & SD Card',
    size: 51234567,
    cover: ''
  };

  // Ambiguous duplicate tracks with identical size & basename must NOT receive incorrect migration
  const ambOld = {
    id: 'fiio_amb_old', source: 'local', path: '/storage/SD/A/Track.flac',
    name: 'Track', title: 'Track', size: 123456, rating: 3, lyricsText: '[00:01] A'
  };
  const ambCand1 = { id: 'fiio_amb_1', source: 'local', path: '/storage/SD/B/Track.flac', name: 'Track', size: 123456 };
  const ambCand2 = { id: 'fiio_amb_2', source: 'local', path: '/storage/SD/C/Track.flac', name: 'Track', size: 123456 };

  const oldHistKey = library.historyTrackKey(ghostOldTrack);
  const newHistKey = library.historyTrackKey(scannedNewTrack);

  const sandbox = {
    window: {},
    library,
    activeFiioScanMaps: null,
    fiioScanUpgradedCount: 0,
    state: {
      currentId: null,
      tracks: [uriMovedTrack, ghostOldTrack, scannedNewTrack, ambOld, ambCand1, ambCand2],
      recentHistory: [{ trackKey: oldHistKey, title: 'Resolution', artist: 'John Coltrane', source: 'local', playedAt: 1000 }]
    },
    createFiioFallbackTrack: f => ({ id: 'fiio_new', path: f.path, uri: f.uri, source: 'local' }),
    restoreLocalTrackUrlSync: tr => {
      if (!tr.url && tr.uri) tr.url = 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(tr.uri) + '&name=' + encodeURIComponent(tr.name || '');
      else if (!tr.url && tr.path) tr.url = 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(tr.path);
      return tr.url;
    },
    encodeURIComponent,
    Map,
    Set,
    Array,
    Number,
    String
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(start, end) +
      '\nthis.applyFiioRescanFields = applyFiioRescanFields;' +
      '\nthis.ingestFiioScannedFilesChunk = ingestFiioScannedFilesChunk;' +
      '\nthis.pruneMissingFiioTracks = pruneMissingFiioTracks;',
    sandbox
  );

  // 3A. File moved + renamed on disk while retaining same MediaStore URI
  const existingPaths = new Set([uriMovedTrack.path]);
  const existingUris = new Set([uriMovedTrack.uri]);
  sandbox.ingestFiioScannedFilesChunk([
    {
      path: '/storage/SD/Jazz/01 - Renamed Song.flac',
      uri: 'content://media/external/audio/media/42',
      name: '01 - Renamed Song.flac',
      size: 40000000
    }
  ], existingPaths, existingUris);

  assert.equal(uriMovedTrack.path, '/storage/SD/Jazz/01 - Renamed Song.flac', 'Moved path must overwrite stale old path');
  assert.equal(uriMovedTrack.name, '01 - Renamed Song', 'Renamed filename must update track.name');
  assert.equal(uriMovedTrack.title, 'Renamed Song', 'enrichFiioTrackMetadata should derive clean title from renamed file');
  assert.equal(existingPaths.has('/storage/SD/OldDir/01 - Old Song.flac'), false, 'Stale old path must be removed from existingPaths');
  assert.equal(existingPaths.has('/storage/SD/Jazz/01 - Renamed Song.flac'), true);
  assert.ok(uriMovedTrack.url.includes('uri=' + encodeURIComponent(uriMovedTrack.uri)), 'Stale /local-media?path URL must be regenerated cleanly');
  assert.equal(uriMovedTrack.rating, 5);
  assert.equal(uriMovedTrack.cover, 'data:image/jpeg;base64,CUSTOM_COVER');
  assert.ok(sandbox.fiioScanUpgradedCount >= 1);

  // 3B. File moved with brand new URI -> pruneMissingFiioTracks removes ghosts and reconciles unique match + history
  const removed = sandbox.pruneMissingFiioTracks(
    new Set([uriMovedTrack.path, scannedNewTrack.path, ambCand1.path, ambCand2.path]),
    new Set([uriMovedTrack.uri, scannedNewTrack.uri])
  );
  assert.equal(removed, 2, 'Two old paths/ghosts must be pruned');
  assert.equal(scannedNewTrack.cover, 'data:image/jpeg;base64,MOVED_ART');
  assert.equal(scannedNewTrack.rating, 5);
  assert.equal(scannedNewTrack.lyricsText, '[00:15] Part II');
  assert.equal(scannedNewTrack.albumArtist, 'John Coltrane');
  assert.equal(scannedNewTrack.sampleRate, 96000);
  assert.equal(scannedNewTrack.bitDepth, 24);
  assert.equal(scannedNewTrack.metadataLoaded, true);
  assert.equal(sandbox.state.recentHistory[0].trackKey, newHistKey, 'recentHistory entry must migrate to moved track key');
  assert.equal(ambCand1.lyricsText, undefined, 'Ambiguous candidates must not inherit metadata');
  assert.equal(ambCand2.lyricsText, undefined);
});

test('4. Version sync v3.9.51 / versionCode 105, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:5[1-9]|[6-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.51';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.51';"));
  assert.ok(/versionCode\s*=\s*(?:10[5-9]|1[1-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.51"'));
  assert.ok(/"3\.9\.(?:5[1-9]|[6-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:5[1-9]|[6-9]\d|\d{3,})/.test(publishRelease));

  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(indexHtml.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(indexHtml.includes('target.volume = audio.volume; target.muted = false;'));
  assert.equal(/\bmodal\.showModal\s*\(/.test(indexHtml), false);

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

  const scriptStart = indexHtml.lastIndexOf('<script>');
  const scriptEnd = indexHtml.lastIndexOf('</script>');
  const codeFiles = [['index.html <script>', indexHtml.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter(name => name.endsWith('.js'))) {
    codeFiles.push([f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  }
  for (const [label, src] of codeFiles) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const stripped = lines[i]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain bare catch {}`);
    }
  }
});
