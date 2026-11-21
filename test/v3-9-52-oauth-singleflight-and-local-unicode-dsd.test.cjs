'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Google Drive & OneDrive OAuth single-flight locks coalesce concurrent refreshes and avoid interaction_in_progress', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const library = require(path.join(ROOT, 'library-utils.js'));

  const gStart = html.indexOf('let googleTokenRefreshPromise = null;');
  const gEnd = html.indexOf('async function connectGoogle(', gStart);
  assert.ok(gStart !== -1 && gEnd > gStart, 'Google OAuth single-flight block must exist');

  const msStart = html.indexOf('let microsoftMsalInitPromise = null;');
  const msEnd = html.indexOf('async function applyMicrosoftSiblingFolderCovers(', msStart);
  assert.ok(msStart !== -1 && msEnd > msStart, 'OneDrive MSAL single-flight block must exist');

  const localStore = new Map();
  let googleRefreshCount = 0;
  let fakeTokenCounter = 0;
  let scheduledExpiry = 0;

  let msalCtorCount = 0;
  let msalInitCount = 0;
  let msalSilentCount = 0;
  let msalLoginPopupCount = 0;
  let msScheduledExpiry = 0;

  class FakeInteractionRequiredAuthError extends Error {}

  const state = {
    googleToken: '',
    googleExpiresAt: 0,
    googleLastRefreshAt: 0,
    msal: null,
    msAccount: null,
    microsoftAccessToken: '',
    microsoftExpiresAt: 0,
    microsoftLastRefreshAt: 0
  };

  const googleOAuthRefreshScheduler = {
    shouldRefreshSoon: exp => exp - Date.now() < 120000,
    refreshNow: async () => {
      googleRefreshCount += 1;
      await new Promise(r => setTimeout(r, 25));
      fakeTokenCounter += 1;
      state.googleToken = 'g-tok-' + fakeTokenCounter;
      state.googleExpiresAt = Date.now() + 3600000;
      state.googleLastRefreshAt = Date.now();
      return state.googleToken;
    },
    scheduleRefresh: exp => { scheduledExpiry = exp; }
  };

  const microsoftOAuthRefreshScheduler = {
    scheduleRefresh: exp => { msScheduledExpiry = exp; }
  };

  let failNextSilent = false;
  let requireInteractiveThenPopup = false;

  const fakeMsalModule = {
    InteractionRequiredAuthError: FakeInteractionRequiredAuthError,
    PublicClientApplication: class FakePCA {
      constructor() {
        msalCtorCount += 1;
        this._accounts = [];
      }
      async initialize() {
        msalInitCount += 1;
        await new Promise(r => setTimeout(r, 20));
        this._accounts = [{ username: 'user@example.com' }];
      }
      getAllAccounts() {
        return this._accounts;
      }
      async acquireTokenSilent() {
        msalSilentCount += 1;
        await new Promise(r => setTimeout(r, 25));
        if (failNextSilent) {
          failNextSilent = false;
          throw new Error('transient silent failure');
        }
        return { accessToken: 'ms-silent-' + msalSilentCount, expiresOn: new Date(Date.now() + 3600000) };
      }
      async loginPopup() {
        msalLoginPopupCount += 1;
        await new Promise(r => setTimeout(r, 25));
        const acc = { username: 'interactive@example.com' };
        this._accounts = [acc];
        return { account: acc };
      }
      async acquireTokenPopup() {
        return { accessToken: 'ms-popup-tok', expiresOn: new Date(Date.now() + 3600000) };
      }
    }
  };

  const sandbox = {
    library,
    state,
    googleOAuthRefreshScheduler,
    microsoftOAuthRefreshScheduler,
    msal: fakeMsalModule,
    DEFAULT_GOOGLE_CLIENT_ID: 'gid',
    DEFAULT_MICROSOFT_CLIENT_ID: 'msid',
    DEFAULT_GOOGLE_EXPIRY: 3600,
    $: () => null,
    safeVal: () => '',
    loadGoogleScript: async () => {},
    location: { origin: 'https://example.com', pathname: '/' },
    window: {
      isSecureContext: true,
      google: { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } }
    },
    localStorage: {
      getItem: k => localStore.get(k) || null,
      setItem: (k, v) => localStore.set(k, String(v))
    },
    Date,
    console,
    Promise,
    Error,
    Number,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(gStart, gEnd) + '\n' + html.slice(msStart, msEnd) +
    '\nthis.__testExports = { ensureGoogleToken, getMicrosoftToken, ensureMicrosoftMsalClient };',
    sandbox
  );

  // Google: 3 concurrent expired calls coalesce into 1 refreshNow
  const gResults = await Promise.all([
    sandbox.__testExports.ensureGoogleToken(false),
    sandbox.__testExports.ensureGoogleToken(false),
    sandbox.__testExports.ensureGoogleToken(true)
  ]);
  assert.equal(googleRefreshCount, 1);
  assert.deepEqual(gResults, ['g-tok-1', 'g-tok-1', 'g-tok-1']);

  // Google: immediate 401 forceRefresh within 8s recent-refresh dedup window reuses freshly minted token
  const dedupToken = await sandbox.__testExports.ensureGoogleToken(true);
  assert.equal(googleRefreshCount, 1);
  assert.equal(dedupToken, 'g-tok-1');

  // Google: error resets googleTokenRefreshPromise cleanly for subsequent retries
  state.googleLastRefreshAt = 0;
  state.googleToken = '';
  const origRefresh = googleOAuthRefreshScheduler.refreshNow;
  googleOAuthRefreshScheduler.refreshNow = async () => { throw new Error('network error'); };
  await assert.rejects(() => sandbox.__testExports.ensureGoogleToken(true));
  googleOAuthRefreshScheduler.refreshNow = origRefresh;
  const recovered = await sandbox.__testExports.ensureGoogleToken(true);
  assert.equal(recovered, 'g-tok-2');

  // OneDrive: 3 concurrent cold-start calls share 1 MSAL init + 1 acquireTokenSilent
  const msResults = await Promise.all([
    sandbox.__testExports.getMicrosoftToken(false),
    sandbox.__testExports.getMicrosoftToken(false),
    sandbox.__testExports.getMicrosoftToken(false)
  ]);
  assert.equal(msalCtorCount, 1);
  assert.equal(msalInitCount, 1);
  assert.equal(msalSilentCount, 1);
  assert.deepEqual(msResults, ['ms-silent-1', 'ms-silent-1', 'ms-silent-1']);
  assert.ok(msScheduledExpiry > Date.now());

  // OneDrive: silent failure resets lock so retry succeeds
  failNextSilent = true;
  await assert.rejects(() => sandbox.__testExports.getMicrosoftToken(false), /transient silent failure/);
  const msRetry = await sandbox.__testExports.getMicrosoftToken(false);
  assert.equal(msRetry, 'ms-silent-3');

  // OneDrive: concurrent interactive login + silent call while popup is open awaits interactive instead of calling acquireTokenSilent
  state.msAccount = null;
  const silentBeforeCount = msalSilentCount;
  const interactivePromise = sandbox.__testExports.getMicrosoftToken(true);
  await new Promise(r => setTimeout(r, 5));
  const piggybackSilent = sandbox.__testExports.getMicrosoftToken(false);
  const [tokInteractive, tokPiggyback] = await Promise.all([interactivePromise, piggybackSilent]);
  assert.equal(msalLoginPopupCount, 1);
  assert.equal(msalSilentCount, silentBeforeCount + 1);
  assert.equal(tokInteractive, tokPiggyback);
  assert.ok(scheduledExpiry === 0 || scheduledExpiry > 0);
});

test('2. DSD local FileHandle recovery and HTTP error checks in preloadDsdNext & playTrack', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const helperStart = html.indexOf('async function prepareLocalDsdNext(next) {');
  const preloadStart = html.indexOf('async function preloadDsdNext(next) {');
  const preloadEnd = html.indexOf('function stopPrefetchDsdSlice() {', preloadStart);
  assert.ok(helperStart !== -1 && preloadStart > helperStart && preloadEnd > preloadStart);
  const preloadSrc = html.slice(preloadStart, preloadEnd);
  const preloadBlockSrc = html.slice(helperStart, preloadEnd);

  // Preserve v3.9.25 invariant: FiiO M11S 48MB guard + clearStalePreload within first 1400 chars before load()
  assert.ok(preloadSrc.slice(0, 1400).includes('clearStalePreload()'));
  assert.ok(preloadSrc.includes('48 * 1024 * 1024'));

  // Run behavioral test on preloadDsdNext for local fileHandle DSD vs FiiO large DSD
  let ensureCalls = [];
  let prefetchCalls = [];
  let clearedStale = 0;
  const sandbox = {
    IS_LEGACY_ANDROID: false,
    standbyAudio: { pause() {}, removeAttribute() {}, load() {} },
    state: {
      fiioDapMode: false,
      preloadTrackId: null,
      preloadReadyUrl: null,
      preloadBusyId: null,
      preloadGeneration: 0,
      preloadDsdSliceTrackId: null,
      currentId: null
    },
    clearStalePreload: () => { clearedStale += 1; },
    stopPrefetchDsdSlice: () => {},
    prepareCloudTrackForPreload: async () => {},
    ensureLocalTrackPlayableUrl: async (track, opts) => {
      ensureCalls.push({ id: track.id, opts });
      track.file = { name: track.name, size: track.size };
      return 'blob:local-dsd';
    },
    prefetchDsdFirstSlice: (track, gen) => {
      prefetchCalls.push({ id: track.id, gen });
    },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(preloadBlockSrc + '\nthis.preloadDsdNext = preloadDsdNext;', sandbox);

  const localDsdNext = { id: 'local_dsd_1', source: 'local', fileHandle: { kind: 'file' }, file: null, name: 'Test.dsf', size: 120 * 1024 * 1024 };
  await sandbox.preloadDsdNext(localDsdNext);
  assert.equal(ensureCalls.length, 1);
  assert.equal(ensureCalls[0].id, 'local_dsd_1');
  assert.equal(ensureCalls[0].opts.requestPermission, false);
  assert.equal(prefetchCalls.length, 1);

  sandbox.state.fiioDapMode = true;
  const fiioLargeDsd = { id: 'fiio_dsd_big', source: 'local', file: null, load: async () => {}, size: 120 * 1024 * 1024 };
  await sandbox.preloadDsdNext(fiioLargeDsd);
  assert.equal(clearedStale, 1);

  // playTrack DSD branch assertions & index-script invariants
  const playDsdBranchStart = html.indexOf('if (track.isDsd) {');
  const playDsdBranchEnd = html.indexOf('// 2. Android Integration', playDsdBranchStart);
  assert.ok(playDsdBranchStart !== -1 && playDsdBranchEnd > playDsdBranchStart);
  const playDsdBranch = html.slice(playDsdBranchStart, playDsdBranchEnd);
  assert.ok(playDsdBranch.includes("await ensureLocalTrackPlayableUrl(track, { requestPermission: true });"));
  assert.ok(playDsdBranch.includes("if (!dsdResp.ok) throw new Error('HTTP ' + dsdResp.status + ' khi tải nguồn DSD.');"));
  assert.ok(playDsdBranch.includes('library.normalizeAudioBlob(rawDsdBlob,'));

  const releaseLocalMatches = html.match(/releaseUnusedLocalUrl\(previousTrack\);/g) || [];
  assert.equal(releaseLocalMatches.length, 3, 'Must preserve exact 3 occurrences of releaseUnusedLocalUrl(previousTrack)');
});

test('3. MainActivity.java local path resolution preserves literal + and Unicode NFC/NFD across streaming, cover art & BitPerfect', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('public static File resolveReadableLocalFile(@Nullable String rawPath)'));
  assert.ok(java.includes('java.text.Normalizer.normalize(rawPath, java.text.Normalizer.Form.NFC)'));
  assert.ok(java.includes('java.text.Normalizer.normalize(rawPath, java.text.Normalizer.Form.NFD)'));
  assert.ok(java.includes('java.text.Normalizer.normalize(decoded, java.text.Normalizer.Form.NFC)'));
  assert.ok(java.includes('java.text.Normalizer.normalize(decoded, java.text.Normalizer.Form.NFD)'));
  assert.ok(java.includes('String safeEncoded = rawPath.replace("+", "%2B");'));

  assert.ok(java.includes('private Uri queryMediaStoreAudioByDataPath(@Nullable String candidatePath)'));
  const msStart = java.indexOf('public Uri resolveMediaStoreContentUriForPath(@Nullable String filePath)');
  const msEnd = java.indexOf('private static final java.util.concurrent.Semaphore COVER_ART_PERMITS', msStart);
  assert.ok(msStart !== -1 && msEnd > msStart);
  const msSrc = java.slice(msStart, msEnd);
  assert.ok(msSrc.includes('queryMediaStoreAudioByDataPath(filePath)'));
  assert.ok(msSrc.includes('Normalizer.Form.NFC'));
  assert.ok(msSrc.includes('Normalizer.Form.NFD'));
  assert.ok(msSrc.includes('replace("+", "%2B")'));

  const extractStart = java.indexOf('private byte[] extractCoverJpeg(');
  const extractEnd = java.indexOf('private void pruneCoverCache(', extractStart);
  assert.ok(extractStart !== -1 && extractEnd > extractStart);
  assert.ok(java.slice(extractStart, extractEnd).includes('file = resolveReadableLocalFile(pathParam);'));

  const streamStart = java.indexOf('private WebResourceResponse handleLocalMediaStreaming(');
  const streamEnd = java.indexOf('private WebResourceResponse streamContentUriResponse(', streamStart);
  assert.ok(streamStart !== -1 && streamEnd > streamStart);
  assert.ok(java.slice(streamStart, streamEnd).includes('File file = resolveReadableLocalFile(pathParam);'));

  const bpStart = java.indexOf('private void runPlaybackLoop(');
  const bpEnd = java.indexOf('// 2. Locate audio track', bpStart);
  assert.ok(bpStart !== -1 && bpEnd > bpStart);
  const bpResolve = java.slice(bpStart, bpEnd);
  assert.ok(bpResolve.includes('resolvedPath.replace("+", "%2B")'));
  assert.ok(bpResolve.includes('File localFile = resolveReadableLocalFile(resolvedPath);'));
});

test('4. Version consistency (v3.9.52+ / versionCode >= 106) and Chromium 74 syntax safety in new code', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const release = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[2-9]|[6-9]\d)';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[2-9]|[6-9]\d)';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)\b/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 106, 'versionCode must be >= 106');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[2-9]|[6-9]\d)"/);
  assert.match(java, /"3\.9\.(5[2-9]|[6-9]\d)"/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[2-9]|[6-9]\d)/);
  assert.match(release, /'v3\.9\.(5[2-9]|[6-9]\d)'/);
});
