'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. prepareCloudTrackForPreload & preloadNext refresh near-expiry Cloud tokens/URLs (incl. firstSlicePlayback) and skip duplicate standby preload for same-file CUE sub-tracks', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const prepStart = html.indexOf('async function prepareCloudTrackForPreload(track) {');
  const prepEnd = html.indexOf('async function prepareLocalDsdNext(', prepStart);
  const cueStart = html.indexOf('function isSameCueParentTrack(curTrack, nextTrack) {');
  const cueEnd = html.indexOf('function skipFailedTrack(', cueStart);
  assert.ok(prepStart > 0 && prepEnd > prepStart, 'prepareCloudTrackForPreload must exist');
  assert.ok(cueStart > 0 && cueEnd > cueStart, 'isSameCueParentTrack & preloadNext must exist');

  const combinedSrc = html.slice(prepStart, prepEnd) + '\n' + html.slice(cueStart, cueEnd);

  let googleForceFlags = [];
  let msTokenCalls = 0;
  let msResolveCalls = 0;
  let standbyLoads = 0;
  let staleClears = 0;

  const standbyAudio = {
    src: '',
    volume: 1,
    muted: false,
    readyState: 0,
    pause() {},
    removeAttribute(attr) { if (attr === 'src') this.src = ''; },
    load() { standbyLoads++; }
  };

  const sharedCueFile = { name: 'Concert.flac', size: 500000000 };
  const cueT1 = { id: 'cue_1', isCue: true, source: 'local', file: sharedCueFile, url: 'blob:https://app/concert', cueStart: 0, cueEnd: 300 };
  const cueT2 = { id: 'cue_2', isCue: true, source: 'local', file: sharedCueFile, url: 'blob:https://app/concert', cueStart: 300, cueEnd: 600 };
  const cueT3OtherFile = { id: 'cue_3', isCue: true, source: 'local', file: { name: 'Disc2.flac' }, url: 'blob:https://app/disc2', cueStart: 0, cueEnd: 240 };
  const cloudSliceNext = {
    id: 'g_slice_next',
    remoteId: 'drive_99',
    source: 'google',
    url: 'blob:https://app/slice99',
    firstSlicePlayback: true,
    load: async () => { throw new Error('Should not re-run load() when slice URL is already cached'); }
  };

  const sandbox = {
    MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
    location: { href: 'https://app.example/' },
    URL,
    Date,
    Set,
    navigator: { onLine: true },
    library: {},
    audio: { volume: 0.9 },
    standbyAudio,
    state: {
      context: { currentTime: 10 },
      deckA: { router: { gain: { setTargetAtTime() {} } } },
      deckB: { router: { gain: { setTargetAtTime() {} } } },
      activeDeck: null,
      crossfadeUntil: 0,
      currentId: 'cue_1',
      tracks: [cueT1, cueT2, cueT3OtherFile, cloudSliceNext],
      preloadTrackId: null,
      preloadBusyId: null,
      preloadReadyUrl: null,
      preloadGeneration: 0,
      objectUrls: new Set(['blob:https://app/slice99']),
      googleToken: 'g-old',
      googleExpiresAt: Date.now() + 4 * 60 * 1000, // 4 min left (< 5 min buffer)
      microsoftAccessToken: '',
      msAccount: { username: 'user@outlook.com' },
      microsoftExpiresAt: 0
    },
    queueIndex: () => 1,
    clearStalePreload: () => { staleClears++; },
    releaseUnusedCloudUrl: () => {},
    ensureGoogleToken: async (force) => {
      googleForceFlags.push(Boolean(force));
      sandbox.state.googleToken = 'g-fresh';
      sandbox.state.googleExpiresAt = Date.now() + 3600 * 1000;
      return 'g-fresh';
    },
    getMicrosoftToken: async () => {
      msTokenCalls++;
      sandbox.state.microsoftAccessToken = 'ms-fresh';
      sandbox.state.microsoftExpiresAt = Date.now() + 3600 * 1000;
      return 'ms-fresh';
    },
    resolveMicrosoftDownloadUrl: async (tr) => {
      msResolveCalls++;
      tr.downloadUrl = 'https://sharepoint.example/fresh';
      tr.downloadUrlAt = Date.now();
      return tr.downloadUrl;
    },
    console
  };
  sandbox.state.activeDeck = sandbox.state.deckA;

  vm.createContext(sandbox);
  vm.runInContext(
    combinedSrc + '\nthis.prepareCloudTrackForPreload = prepareCloudTrackForPreload; this.isSameCueParentTrack = isSameCueParentTrack; this.preloadNext = preloadNext;',
    sandbox
  );

  // 1.1 Same-file CUE Track 1 -> Track 2 skips standbyAudio.load()
  await sandbox.preloadNext(false);
  assert.equal(standbyLoads, 0, 'Same-file CUE next track must NOT open a duplicate stream on standbyAudio');
  assert.equal(sandbox.state.preloadTrackId, 'cue_2');

  // 1.2 Different-file CUE Track 1 -> Track 3 DOES preload standbyAudio
  sandbox.queueIndex = () => 2;
  await sandbox.preloadNext(false);
  assert.ok(standbyLoads >= 1, 'Multi-file CUE next track with different audio file must preload on standbyAudio');
  assert.equal(standbyAudio.src, 'blob:https://app/disc2');

  // 1.3 Cached first-slice Cloud next track still proactively refreshes near-expiry Google token (force=true)
  sandbox.queueIndex = () => 3;
  await sandbox.preloadNext(false);
  assert.deepEqual(googleForceFlags, [true], 'prepareCloudTrackForPreload must run with ensureGoogleToken(true) within 5-min window even when firstSlicePlayback blob is cached');

  // 1.4 OneDrive track with missing access token but valid msAccount refreshes token & downloadUrl
  const odTrack = { id: 'od_1', remoteId: 'rm_1', source: 'onedrive', downloadUrl: '', downloadUrlAt: 0 };
  await sandbox.prepareCloudTrackForPreload(odTrack);
  assert.equal(msTokenCalls, 1, 'OneDrive with msAccount and empty token must call getMicrosoftToken(false)');
  assert.equal(msResolveCalls, 1, 'OneDrive without downloadUrl must resolve fresh SharePoint direct URL');
  assert.equal(odTrack.downloadUrl, 'https://sharepoint.example/fresh');
});

test('2. Local .lrc multi-encoding decoding & CUE sub-track .lrc lookup work across Web and Android/FiiO', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const decStart = html.indexOf('function decodeTextBytesAuto(rawBuf) {');
  const decEnd = html.indexOf('function buildLocalCueSubTrack(', decStart);
  assert.ok(decStart > 0 && decEnd > decStart, 'decodeTextBytesAuto & findLocalCueLrcFile must exist above buildLocalCueSubTrack');

  const sandbox = {
    Uint8Array,
    TextDecoder,
    String,
    Number,
    Map,
    Array,
    Boolean
  };
  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(decStart, decEnd) +
    '\nthis.decodeTextBytesAuto = decodeTextBytesAuto; this.normalizeLocalLrcKey = normalizeLocalLrcKey; this.findLocalCueLrcFile = findLocalCueLrcFile;',
    sandbox
  );

  // 2.1 Shift-JIS Japanese .lrc bytes decode cleanly (zero U+FFFD)
  // "[00:12.00]夢の途中" -> Shift-JIS for "夢の途中": 96 B2 82 CC 93 72 92 86
  const sjisBytes = Uint8Array.from([0x5B, 0x30, 0x30, 0x3A, 0x31, 0x32, 0x2E, 0x30, 0x30, 0x5D, 0x96, 0xB2, 0x82, 0xCC, 0x93, 0x72, 0x92, 0x86]);
  const decodedSjis = sandbox.decodeTextBytesAuto(sjisBytes.buffer);
  assert.ok(decodedSjis.includes('[00:12.00]'), 'Decoded Shift-JIS LRC must preserve timestamps');
  assert.ok(!decodedSjis.includes('\uFFFD'), 'Shift-JIS LRC must not contain UTF-8 replacement characters');

  // 2.2 findLocalCueLrcFile matches track-numbered, exact, and NFC/NFD sibling .lrc strictly within the same folder
  const f1 = { name: '01 - Opening Song.lrc' };
  const f2 = { name: '02. M\u1ed9t \u0110\u1eddi.lrc'.normalize('NFD') };
  const fOtherDir = { name: '01 - Opening Song.lrc' };
  const lrcByBase = new Map([
    [sandbox.normalizeLocalLrcKey('Music\\AlbumA\\01 - Opening Song.lrc'), f1],
    [sandbox.normalizeLocalLrcKey('Music/AlbumA/' + f2.name), f2],
    [sandbox.normalizeLocalLrcKey('Music/AlbumB/01 - Opening Song.lrc'), fOtherDir]
  ]);

  assert.equal(sandbox.findLocalCueLrcFile(lrcByBase, 'music/albuma', { number: 1, title: 'Opening Song' }), f1);
  assert.equal(sandbox.findLocalCueLrcFile(lrcByBase, 'music/albuma', { number: 2, title: 'M\u1ed9t \u0110\u1eddi'.normalize('NFC') }), f2);
  assert.equal(sandbox.findLocalCueLrcFile(lrcByBase, 'music/albumc', { number: 1, title: 'Opening Song' }), null, 'Must not cross-match LRC from a different album directory');

  // 2.3 Web addLocalFiles & triggerLyricsFetch wiring + Android MainActivity.java readLocalCueLyrics
  const addStart = html.indexOf('async function addLocalFiles(files) {');
  const addEnd = html.indexOf('function lookupLocalFolderCover(', addStart);
  const addSrc = html.slice(addStart, addEnd);
  assert.ok(addSrc.includes('findLocalCueLrcFile(lrcByBase, cueDir, ct)'), 'addLocalFiles must look up CUE sub-track LRC files');
  assert.ok(addSrc.includes('await readLocalTextFileAuto(lrcFile)'), 'addLocalFiles must decode local .lrc via readLocalTextFileAuto');

  const trigStart = html.indexOf('async function triggerLyricsFetch(track) {');
  const trigSrc = html.slice(trigStart, trigStart + 5000);
  assert.ok(trigSrc.includes('native.readLocalCueLyrics('), 'triggerLyricsFetch must call native.readLocalCueLyrics for CUE sub-tracks');

  const javaSrc = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
  assert.ok(javaSrc.includes('public String readLocalCueLyrics(@Nullable String filePath, @Nullable String contentUri, @Nullable String trackTitle, int trackNumber)'), 'MainActivity must expose readLocalCueLyrics on JS bridge');
  assert.ok(javaSrc.includes('scoreCueLyricsCandidate('), 'MainActivity must score CUE sub-track sibling LRC filenames');
});

test('3. Google Drive & OneDrive per-provider sync mutex coalesces overlapping scans and handles offline gracefully', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gStart = html.indexOf('async function loadGoogleFiles() {');
  const gEnd = html.indexOf('async function fetchCloudFile(', gStart);
  const mStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const mEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', mStart);
  assert.ok(gStart > 0 && gEnd > gStart);
  assert.ok(mStart > 0 && mEnd > mStart);

  // 3.1 Google Drive concurrent call coalescing + offline guard
  let gFetchCount = 0;
  let releaseGoogleFetch = null;
  const gGate = new Promise(resolve => { releaseGoogleFetch = resolve; });
  const gStatuses = [];

  const gSandbox = {
    GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
    navigator: { onLine: true },
    state: { tracks: [] },
    restoreCloudCatalog: async () => {},
    ensureGoogleToken: async () => 'tok_g',
    fetchGoogleDrivePageWithRetry: async () => {
      gFetchCount++;
      await gGate;
      return { ok: true, status: 200, json: async () => ({ nextPageToken: '', files: [{ id: 'g1', name: '01.flac', mimeType: 'audio/flac', size: '1234' }] }) };
    },
    isCloudAudio: () => true,
    googleTrack: (f) => ({ id: 'g_' + f.id, remoteId: f.id, source: 'google', name: f.name, title: f.name, size: 1234, metadataLoaded: true, cover: 'x' }),
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    scheduleBackgroundRender: () => {},
    cloudStatus: (p, msg) => gStatuses.push(msg),
    toast: () => {},
    propagateAndBroadcastCovers: () => {},
    queueCloudMetadata: () => {},
    URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, Date, Promise, Error, console
  };
  vm.createContext(gSandbox);
  vm.runInContext(html.slice(gStart, gEnd) + '\nthis.loadGoogleFiles = loadGoogleFiles;', gSandbox);

  const pG1 = gSandbox.loadGoogleFiles();
  const pG2 = gSandbox.loadGoogleFiles();
  assert.ok(gSandbox.state._googleSyncPromise, 'In-flight Google sync mutex must be active');
  releaseGoogleFetch();
  await Promise.all([pG1, pG2]);
  assert.equal(gFetchCount, 1, 'Overlapping loadGoogleFiles calls must coalesce into a single Drive scan');
  assert.equal(gSandbox.state._googleSyncPromise, null, 'Google sync mutex must clear after completion');

  // Offline graceful return
  gSandbox.navigator.onLine = false;
  const offlineG = await gSandbox.loadGoogleFiles();
  assert.equal(offlineG, false, 'loadGoogleFiles must return false cleanly when offline');
  assert.equal(gFetchCount, 1, 'Offline loadGoogleFiles must not make network calls');
  assert.ok(gStatuses.some(s => s.includes('Ngoại tuyến')), 'Offline Google sync must update status gracefully');

  // 3.2 OneDrive concurrent call coalescing + offline guard
  let mFetchCount = 0;
  let releaseMsFetch = null;
  const mGate = new Promise(resolve => { releaseMsFetch = resolve; });
  const mStatuses = [];

  const mSandbox = {
    navigator: { onLine: true },
    state: { tracks: [], microsoftAccessToken: '' },
    restoreCloudCatalog: async () => {},
    graphGet: async () => {
      mFetchCount++;
      await mGate;
      return { value: [{ id: 'od1', name: '01.flac', file: { mimeType: 'audio/flac' }, size: 4321 }] };
    },
    isCloudAudio: () => true,
    microsoftTrack: (item) => ({ id: 'od_' + item.id, remoteId: item.id, source: 'onedrive', name: item.name, title: item.name, size: 4321, metadataLoaded: true, cover: 'x' }),
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    scheduleBackgroundRender: () => {},
    cloudStatus: (p, msg) => mStatuses.push(msg),
    toast: () => {},
    queueCloudMetadata: () => {},
    Map, Set, Array, Number, String, Boolean, Object, Date, Promise, Error, console
  };
  vm.createContext(mSandbox);
  vm.runInContext(html.slice(mStart, mEnd) + '\nthis.loadMicrosoftFiles = loadMicrosoftFiles;', mSandbox);

  const pM1 = mSandbox.loadMicrosoftFiles('ms_tok');
  const pM2 = mSandbox.loadMicrosoftFiles('ms_tok');
  assert.ok(mSandbox.state._microsoftSyncPromise, 'In-flight OneDrive sync mutex must be active');
  releaseMsFetch();
  await Promise.all([pM1, pM2]);
  assert.equal(mFetchCount, 1, 'Overlapping loadMicrosoftFiles calls must coalesce into a single OneDrive scan');
  assert.equal(mSandbox.state._microsoftSyncPromise, null, 'OneDrive sync mutex must clear after completion');

  mSandbox.navigator.onLine = false;
  const offlineM = await mSandbox.loadMicrosoftFiles('ms_tok');
  assert.equal(offlineM, false, 'loadMicrosoftFiles must return false cleanly when offline');
  assert.equal(mFetchCount, 1, 'Offline loadMicrosoftFiles must not make network calls');
  assert.ok(mStatuses.some(s => s.includes('Ngoại tuyến')), 'Offline OneDrive sync must update status gracefully');

  // 3.3 Version sync checks for v3.9.68 / versionCode 122
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.68';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.68';"));
  assert.ok(gradle.includes('versionCode = 122'));
  assert.ok(gradle.includes('versionName = "3.9.68"'));
  assert.ok(html.includes('FiiO M11S · v3.9.68'));
});
