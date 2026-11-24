'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const java = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const library = require('../library-utils.js');

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker} after ${startMarker}`);
  return src.slice(s, e);
}

function extractFunction(src, signaturePrefix) {
  const start = src.indexOf(signaturePrefix);
  assert.ok(start !== -1, `Missing function: ${signaturePrefix}`);
  const bodyOpen = src.indexOf('{', start);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;
  for (let i = bodyOpen; i < src.length; i++) {
    const ch = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingle || inDouble || inBacktick) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function brace for ${signaturePrefix}`);
}

describe('v3.9.97 M1 (R1-1..R1-4): Cloud Doze OAuth Refresh, Native Wake/WifiLock & Mixed-Queue Preload Continuity', () => {
  it('R1-1: Startup MSAL scheduler wiring, restoreMicrosoftSession expiry restore, lazy MSAL init & resolveMicrosoftDownloadUrl pre-expiry check', async () => {
    // 1. Startup block wires microsoftOAuthRefreshScheduler.scheduleRefresh(state.microsoftExpiresAt)
    const startupSlice = sliceBetween(html, 'const savedMsToken = localStorage.getItem(\'nocturne-microsoft-token\');', 'if (googleConfig.clientId || savedGoogleToken');
    assert.ok(
      startupSlice.includes('microsoftOAuthRefreshScheduler.scheduleRefresh(state.microsoftExpiresAt)'),
      'Startup restore must schedule proactive MSAL refresh when savedMsToken is valid'
    );

    // 2. restoreMicrosoftSession restores savedMsExp and schedules refresh on savedToken fallback
    const restoreFn = extractFunction(html, 'async function restoreMicrosoftSession()');
    const scheduled = [];
    const loadedTokens = [];
    const msStorage = {
      'nocturne-microsoft': '{}',
      'nocturne-microsoft-token': 'ms-saved-tok',
      'nocturne-microsoft-token-expires': String(Date.now() + 900000)
    };
    const restoreSandbox = {
      library,
      localStorage: { getItem: k => (k in msStorage ? msStorage[k] : null) },
      window: {},
      location: { origin: 'https://nocturne.local', pathname: '/' },
      DEFAULT_MICROSOFT_CLIENT_ID: 'ms-client-id',
      state: { msal: null, msAccount: null, microsoftAccessToken: '', microsoftExpiresAt: 0 },
      microsoftOAuthRefreshScheduler: { scheduleRefresh: exp => scheduled.push(exp) },
      loadMicrosoftFiles: async tok => { loadedTokens.push(tok); },
      cloudStatus: () => {},
      Number,
      console
    };
    vm.runInNewContext(restoreFn, restoreSandbox);
    const ok = await restoreSandbox.restoreMicrosoftSession();
    assert.equal(ok, true);
    assert.equal(restoreSandbox.state.microsoftAccessToken, 'ms-saved-tok');
    assert.ok(restoreSandbox.state.microsoftExpiresAt > Date.now());
    assert.equal(scheduled.length, 1, 'restoreMicrosoftSession fallback must schedule microsoftOAuthRefreshScheduler');
    assert.deepEqual(loadedTokens, ['ms-saved-tok']);

    // 3. microsoftOAuthRefreshScheduler lazily ensures MSAL client before checking state.msAccount
    const msSchedulerSlice = sliceBetween(
      html,
      'const microsoftOAuthRefreshScheduler =',
      'let microsoftMsalInitPromise = null;'
    );
    let ensureCalled = 0;
    let getTokenCalled = 0;
    const schedSandbox = {
      library: {
        createProactiveOAuthTokenRefreshScheduler: cfg => cfg
      },
      state: { msal: null, msAccount: null, microsoftExpiresAt: 123456 },
      ensureMicrosoftMsalClient: async () => {
        ensureCalled++;
        schedSandbox.state.msal = {};
        schedSandbox.state.msAccount = { username: 'u@example.com' };
        return schedSandbox.state.msal;
      },
      getMicrosoftToken: async () => {
        getTokenCalled++;
        return 'refreshed-ms-tok';
      }
    };
    vm.runInNewContext(msSchedulerSlice + '\nthis.microsoftOAuthRefreshScheduler = microsoftOAuthRefreshScheduler;', schedSandbox);
    const schedResult = await schedSandbox.microsoftOAuthRefreshScheduler.refreshFn();
    assert.equal(ensureCalled, 1, 'MSAL scheduler refreshFn must lazily call ensureMicrosoftMsalClient');
    assert.equal(getTokenCalled, 1);
    assert.equal(schedResult.accessToken, 'refreshed-ms-tok');

    // 4. resolveMicrosoftDownloadUrl refreshes expired/near-expiry token before calling graphGet
    const resolveFn = extractFunction(html, 'async function resolveMicrosoftDownloadUrl(track)');
    const callOrder = [];
    const resolveSandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      state: {
        microsoftAccessToken: 'near-exp-tok',
        microsoftExpiresAt: Date.now() + 20000, // 20s remaining (< 60s pre-expiry threshold)
        msAccount: { username: 'u@example.com' }
      },
      getMicrosoftToken: async (_interactive, force) => {
        callOrder.push(['getMicrosoftToken', force]);
        resolveSandbox.state.microsoftAccessToken = 'fresh-ms-tok';
        resolveSandbox.state.microsoftExpiresAt = Date.now() + 3600000;
        return 'fresh-ms-tok';
      },
      graphGet: async (_url, tok) => {
        callOrder.push(['graphGet', tok]);
        return { '@microsoft.graph.downloadUrl': 'https://sharepoint.example/fresh-url' };
      },
      Date,
      Boolean,
      encodeURIComponent
    };
    vm.runInNewContext(resolveFn, resolveSandbox);
    const trk = { id: 'od-1', source: 'onedrive', remoteId: 'item-1' };
    const dlUrl = await resolveSandbox.resolveMicrosoftDownloadUrl(trk);
    assert.equal(dlUrl, 'https://sharepoint.example/fresh-url');
    assert.deepEqual(callOrder, [
      ['getMicrosoftToken', false],
      ['graphGet', 'fresh-ms-tok']
    ]);

    // And when microsoftExpiresAt is undefined (pasted-token / onedrive-direct compat), must NOT call getMicrosoftToken
    callOrder.length = 0;
    resolveSandbox.state = { microsoftAccessToken: 'pasted-tok' };
    await resolveSandbox.resolveMicrosoftDownloadUrl({ id: 'od-2', source: 'onedrive', remoteId: 'item-2' });
    assert.deepEqual(callOrder, [['graphGet', 'pasted-tok']]);
  });

  it('R1-2: Decoupled periodic vs wake cooldowns, post-refresh resync, expired rejection invalidation, <9500ms auth timeout & wake triggers', async () => {
    // 1. Decoupled cooldowns + post-refresh resync/slice-retry + expired rejection invalidation
    const wakeSlice = sliceBetween(
      html,
      'let lastTokenKeepAliveAt = 0;',
      "const LONG_TRACK_POS_KEY = 'nocturne-long-track-positions';"
    );
    let nowMs = 1_000_000;
    let resolveGoogle;
    let rejectMs;
    const calls = { google: [], ms: [], bpAuth: [], sliceRetry: 0, resync: [], clearStale: 0 };
    const wakeSandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      navigator: { onLine: true },
      Date: { now: () => nowMs },
      Array, Object, Number, Boolean, String, RegExp,
      bpCloudPreloadTrackId: 'od:next',
      standbyAudio: { src: 'https://graph.microsoft.com/v1.0/me/drive/items/od2/content' },
      state: {
        currentId: 'gd:cur',
        preloadTrackId: 'od:next',
        preloadReadyUrl: 'https://graph.microsoft.com/v1.0/me/drive/items/od2/content',
        _bpPreloadedStream: { trackId: 'od:next', source: 'onedrive', url: 'https://graph.microsoft.com/v1.0/me/drive/items/od2/content', resolvedAt: nowMs },
        googleToken: 'g-soon',
        googleExpiresAt: nowMs + 60000, // near expiry (< 5 min)
        msAccount: { username: 'u@example.com' },
        microsoftAccessToken: 'ms-exp',
        microsoftExpiresAt: nowMs - 5000, // expired
        tracks: [
          { id: 'gd:cur', source: 'google', _pendingSliceUpgrade: true },
          { id: 'od:next', source: 'onedrive', url: 'https://graph.microsoft.com/v1.0/me/drive/items/od2/content', downloadUrl: 'https://sp.old/1', downloadUrlAt: nowMs - 3600000 }
        ]
      },
      ensureGoogleToken: force => {
        calls.google.push(force);
        return new Promise(r => { resolveGoogle = r; });
      },
      getMicrosoftToken: (_int, force) => {
        calls.ms.push(force);
        return new Promise((_r, rej) => { rejectMs = rej; });
      },
      pushActiveBitPerfectStreamAuth: (src, tok) => calls.bpAuth.push([src, tok]),
      retryPendingCurrentSliceUpgrade: async () => { calls.sliceRetry++; },
      resyncNextPreload: forceClear => { calls.resync.push(forceClear); },
      clearStalePreload: () => {
        calls.clearStale++;
        wakeSandbox.state.preloadTrackId = null;
        wakeSandbox.state.preloadReadyUrl = null;
        wakeSandbox.state._bpPreloadedStream = null;
      }
    };
    vm.runInNewContext(wakeSlice, wakeSandbox);

    // Periodic tick fires first -> must NOT block immediate runCloudWakeTokenRefresh()
    wakeSandbox.runGoogleTokenKeepAliveTick();
    assert.equal(calls.google.length, 1);
    assert.equal(calls.ms.length, 1);

    nowMs += 500; // only 0.5s later
    wakeSandbox.runCloudWakeTokenRefresh();
    assert.equal(calls.google.length, 2, 'Periodic keep-alive must NOT block wake refresh');
    assert.equal(calls.ms.length, 2, 'Periodic MS keep-alive must NOT block wake refresh');
    assert.equal(calls.sliceRetry, 1);
    assert.equal(calls.resync.length, 1);

    // Resolve Google async token -> must push auth and re-run slice retry + resyncNextPreload(false)
    resolveGoogle('fresh-google-tok');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(calls.bpAuth, [['google', 'fresh-google-tok']]);
    assert.equal(calls.sliceRetry, 2, 'Post-refresh .then() must re-run retryPendingCurrentSliceUpgrade');
    assert.equal(calls.resync.length, 2, 'Post-refresh .then() must re-run resyncNextPreload(false)');

    // Reject expired OneDrive refresh -> must invalidate stale https:// Cloud preload
    rejectMs(new Error('MSAL expired'));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.clearStale, 1, 'Expired refresh rejection must invalidate stale https:// preload');
    assert.equal(wakeSandbox.state.preloadTrackId, null);
    assert.equal(wakeSandbox.state.tracks[1].url, '');

    // 2. onNativeBitPerfectAuthRefresh resolves within < 9500ms budget on hung Google/OneDrive refresh
    const bpIntegrationSlice = sliceBetween(
      html,
      'function setupBitPerfectIntegration()',
      'window.setupBitPerfectIntegration = setupBitPerfectIntegration;'
    );
    const authReplies = [];
    const scheduledTimeouts = [];
    const clearedTimeouts = [];
    let nextTimerId = 1;
    const authSandbox = {
      state: {
        currentId: 'gd:1',
        googleToken: 'old-g',
        tracks: [{ id: 'gd:1', source: 'google', remoteId: 'r1', url: 'https://old.example/1' }]
      },
      library,
      Date, Math, Number, String, Boolean, JSON, Array, Set, Promise, Error, encodeURIComponent,
      audio: { paused: true },
      $: () => null,
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: (fn, ms) => {
        const id = nextTimerId++;
        scheduledTimeouts.push({ id, fn, ms });
        return id;
      },
      clearTimeout: id => clearedTimeouts.push(id),
      ensureGoogleToken: () => new Promise(() => {}), // hangs forever
      window: {
        NocturneNative: {
          provideBitPerfectRefreshedAuth: (ep, url, hdrs, ok) => authReplies.push({ ep, url, hdrs: JSON.parse(hdrs), ok })
        }
      },
      console: { warn: () => {}, log: () => {}, debug: () => {} }
    };
    vm.createContext(authSandbox);
    vm.runInContext(bpIntegrationSlice + '\nsetupBitPerfectIntegration();', authSandbox);
    const refreshPromise = authSandbox.window.onNativeBitPerfectAuthRefresh(42, 'google', 'r1', 'https://old.example/1', 401);
    assert.equal(scheduledTimeouts.length, 1);
    assert.ok(scheduledTimeouts[0].ms > 0 && scheduledTimeouts[0].ms < 9500, `Auth timeout budget must be < 9500ms, got ${scheduledTimeouts[0].ms}`);
    scheduledTimeouts[0].fn();
    await refreshPromise;
    assert.equal(authReplies.length, 1);
    assert.equal(authReplies[0].ep, 42);
    assert.equal(authReplies[0].ok, false);
    assert.ok(clearedTimeouts.includes(scheduledTimeouts[0].id));

    // 3. googleOAuthRefreshScheduler bounds silent requestGoogleToken to 9000ms and clears googleTokenRefreshPromise
    const googleOAuthSlice = sliceBetween(
      html,
      'const googleOAuthRefreshScheduler =',
      'async function connectGoogle('
    );
    const gTimeouts = [];
    const gStorage = {};
    const gSandbox = {
      library: {
        parseCloudConfig: () => ({ clientId: 'cid.apps.googleusercontent.com' }),
        createProactiveOAuthTokenRefreshScheduler: cfg => ({
          refreshNow: () => cfg.refreshFn(),
          scheduleRefresh: () => {},
          shouldRefreshSoon: () => false
        })
      },
      localStorage: { getItem: k => gStorage[k] || null, setItem: (k, v) => { gStorage[k] = v; } },
      DEFAULT_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      state: { googleToken: '', googleExpiresAt: 0 },
      window: {
        isSecureContext: true,
        google: {
          accounts: {
            oauth2: {
              initTokenClient: () => ({ requestAccessToken: () => {} }) // hangs
            }
          }
        }
      },
      setTimeout: (fn, ms) => { gTimeouts.push({ fn, ms }); return gTimeouts.length; },
      clearTimeout: () => {},
      loadGoogleScript: async () => {},
      Date, Number, Error, Promise
    };
    vm.runInNewContext(googleOAuthSlice + '\nthis.getRefreshPromise = () => googleTokenRefreshPromise;', gSandbox);
    const gErrPromise = gSandbox.ensureGoogleToken(true);
    assert.equal(gTimeouts.length, 1);
    assert.equal(gTimeouts[0].ms, 9000, 'Silent scheduler refresh must bound requestGoogleToken to 9000ms');
    gTimeouts[0].fn();
    await assert.rejects(gErrPromise, /Phiên Google Drive đã hết hạn/);
    assert.equal(gSandbox.getRefreshPromise(), null, 'googleTokenRefreshPromise must reset to null after timeout');

    // 4. Wake triggers wired on focus, mediaSession play, onHardwarePlay, and onAndroidNetworkAvailable
    assert.ok(/window\.addEventListener\('focus',[\s\S]{0,160}runCloudWakeTokenRefresh\(\)/.test(html), 'window focus must trigger runCloudWakeTokenRefresh');
    assert.ok(/action\('play',\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,120}runCloudWakeTokenRefresh\(\)/.test(html), 'mediaSession play must trigger runCloudWakeTokenRefresh');
    const hwPlaySlice = sliceBetween(html, 'window.onHardwarePlay =', 'window.onHardwarePause =');
    let hwWakeCalls = 0;
    let hwBtnClicks = 0;
    const hwSandbox = {
      state: { isNativeBitPerfectPlaying: true, isNativeBitPerfectPaused: true },
      audio: { paused: true },
      $: () => ({ click: () => { hwBtnClicks++; } }),
      runCloudWakeTokenRefresh: () => { hwWakeCalls++; },
      window: {}
    };
    vm.runInNewContext(hwPlaySlice, hwSandbox);
    hwSandbox.window.onHardwarePlay();
    assert.equal(hwWakeCalls, 1, 'onHardwarePlay must trigger runCloudWakeTokenRefresh when resuming');
    assert.equal(hwBtnClicks, 1);
    assert.ok(/window\.onAndroidNetworkAvailable\s*=[\s\S]{0,240}runCloudWakeTokenRefresh\(\)/.test(html), 'onAndroidNetworkAvailable must trigger runCloudWakeTokenRefresh');
  });

  it('R1-3: MainActivity.java NetworkCallback, ACTION_SCREEN_ON, Cloud resume wake, WifiLock retention & JS syncPendingNextCloudWifiLock', () => {
    // 1. Java structural & lifecycle contracts
    assert.ok(java.includes('registerDefaultNetworkCallback('), 'MainActivity must register ConnectivityManager.NetworkCallback');
    assert.ok(java.includes('unregisterNetworkCallback('), 'MainActivity must unregister NetworkCallback in onDestroy');
    assert.ok(java.includes('Intent.ACTION_SCREEN_ON'), 'MainActivity must observe ACTION_SCREEN_ON');
    assert.ok(java.includes('unregisterReceiver(mScreenOnReceiver)'), 'MainActivity must unregister mScreenOnReceiver in onDestroy');
    assert.ok(java.includes('private void postJsToWebView(final String js)') && java.includes('!isFinishing() && !isDestroyed()'), 'postJsToWebView must guard WebView lifecycle on UI thread');
    assert.ok(java.includes('boolean posted = mWebView.post(') && java.includes('if (!posted) {\n                    latch.countDown();'), 'requestAuthRefreshFromWeb must countDown latch if mWebView.post returns false');

    // Resume-from-pause wake refresh on dispatchPlayPauseToWeb, dispatchPlayToWeb, and AUDIOFOCUS_GAIN
    const dispPlayPause = sliceBetween(java, 'public void dispatchPlayPauseToWeb()', 'public void dispatchPlayToWeb()');
    const dispPlay = sliceBetween(java, 'public void dispatchPlayToWeb()', 'public void dispatchPauseToWeb()');
    const audioFocus = sliceBetween(java, 'public boolean requestAudioFocus()', 'public void abandonAudioFocus()');
    assert.ok(dispPlayPause.includes('mBitPerfectPlayer.isRemoteStream() || mNextTrackIsRemote') && dispPlayPause.includes('window.runCloudWakeTokenRefresh()'));
    assert.ok(dispPlay.includes('mBitPerfectPlayer.isRemoteStream() || mNextTrackIsRemote') && dispPlay.includes('window.runCloudWakeTokenRefresh()'));
    assert.ok(audioFocus.includes('mBitPerfectPlayer.isRemoteStream() || mNextTrackIsRemote') && audioFocus.includes('window.runCloudWakeTokenRefresh()'));

    // Mixed-queue WifiLock retention while preserving v3.9.18 string invariants
    assert.ok(java.includes('public void acquireWakeLock(boolean needWifiLock)'));
    assert.ok(java.includes('final boolean effectiveNeedWifi = needWifiLock || mIsCloudSyncActive || mNextTrackIsRemote;'));
    assert.ok(java.includes('Released WifiLock for offline local playback'));
    assert.ok(java.includes('public void setPendingNextCloudWifiLock(boolean nextIsRemote)'));
    assert.ok(java.includes('acquireWakeLock(mIsRemoteStream || mNextTrackIsRemote);'));

    // 2. JS syncPendingNextCloudWifiLock behavior
    const syncFn = extractFunction(html, 'function syncPendingNextCloudWifiLock()');
    const wifiCalls = [];
    const syncSandbox = {
      state: {
        currentId: 'loc-1',
        autoplay: true,
        repeat: 0,
        tracks: [
          { id: 'loc-1', source: 'local' },
          { id: 'gd-2', source: 'google' },
          { id: 'loc-3', source: 'local' }
        ]
      },
      nextIdx: 1,
      queueIndex: () => syncSandbox.nextIdx,
      window: {
        NocturneNative: {
          setPendingNextCloudWifiLock: v => wifiCalls.push(v)
        }
      }
    };
    vm.runInNewContext(syncFn, syncSandbox);
    assert.equal(syncSandbox.syncPendingNextCloudWifiLock(), true);
    syncSandbox.nextIdx = 2;
    assert.equal(syncSandbox.syncPendingNextCloudWifiLock(), false);
    syncSandbox.nextIdx = 1;
    syncSandbox.state.repeat = 2;
    assert.equal(syncSandbox.syncPendingNextCloudWifiLock(), false);
    assert.deepEqual(wifiCalls, [true, false, false]);
  });

  it('R1-4: Mixed-queue Bit-Perfect preload (_bpPreloadedStream reuse, DSD/Local without state.context, blob slice error/upgrade staleness, <5000 char budget)', async () => {
    // 1. v2-6-3 5000-char preloadNext budget check
    const pnStart = html.indexOf('async function preloadNext(force = false)');
    const pnFailOffset = html.indexOf('state._preloadFailedAt = Date.now()', pnStart) - pnStart;
    assert.ok(pnFailOffset > 0 && pnFailOffset + 35 < 5000, `preloadNext state._preloadFailedAt must stay within first 5000 chars (got ${pnFailOffset})`);

    // 2. preloadNext allows DSD & Local during Native Bit-Perfect without state.context
    const preloadNextFn = extractFunction(html, 'async function preloadNext(force = false)');
    const dsdPreloaded = [];
    const localEnsured = [];
    const pnSandbox = {
      state: {
        isNativeBitPerfectPlaying: true,
        bitPerfectEnabled: true,
        currentId: 'bp-cur',
        context: null,
        deckA: null,
        deckB: null,
        tracks: [
          { id: 'bp-cur', source: 'google' },
          { id: 'dsd-next', source: 'local', isDsd: true },
          { id: 'loc-next', source: 'local', isDsd: false, url: '' }
        ]
      },
      nextIdx: 1,
      queueIndex: () => pnSandbox.nextIdx,
      preloadDsdNext: async tr => dsdPreloaded.push(tr.id),
      ensureLocalTrackPlayableUrl: async tr => { localEnsured.push(tr.id); tr.url = 'http://127.0.0.1/local-media?id=1'; },
      clearStalePreload: () => {},
      navigator: { onLine: true },
      library
    };
    vm.runInNewContext(preloadNextFn, pnSandbox);
    await pnSandbox.preloadNext(true);
    assert.deepEqual(dsdPreloaded, ['dsd-next']);
    pnSandbox.nextIdx = 2;
    await pnSandbox.preloadNext(true);
    assert.deepEqual(localEnsured, ['loc-next']);

    // 3. isPreloadedStandbyStaleOrErrored & invalidateStaleStandbyPreload:
    // flags failed/pending-upgrade blob slices (never healthy firstSlicePlayback), and checks Graph /content expiry
    const staleFn = extractFunction(html, 'function isPreloadedStandbyStaleOrErrored(next, preloadUrl)');
    const invFn = extractFunction(html, 'function invalidateStaleStandbyPreload(track, url)');
    const revoked = [];
    const sb = { src: 'blob:slice-err', pauseCalls: 0, pause() { this.pauseCalls++; }, removeAttribute(k) { if (k === 'src') this.src = ''; }, load() {} };
    const staleSandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      state: {
        microsoftExpiresAt: Date.now() + 60000, // 1 min left (< 5 min lead)
        googleExpiresAt: Date.now() + 3600000,
        _bpPreloadedStream: { trackId: 'slice-err', url: 'blob:slice-err' }
      },
      standbyAudio: sb,
      releaseTrackUrl: u => revoked.push(u),
      Date, String, Boolean, RegExp
    };
    vm.runInNewContext(staleFn + '\n' + invFn, staleSandbox);

    const healthySlice = { id: 'slice-ok', source: 'google', firstSlicePlayback: true, url: 'blob:slice-ok' };
    assert.equal(staleSandbox.isPreloadedStandbyStaleOrErrored(healthySlice, 'blob:slice-ok'), false);

    const erroredSlice = { id: 'slice-err', source: 'google', firstSlicePlayback: true, fullAudioError: new Error('fail'), url: 'blob:slice-err' };
    assert.equal(staleSandbox.isPreloadedStandbyStaleOrErrored(erroredSlice, 'blob:slice-err'), true);
    assert.equal(staleSandbox.invalidateStaleStandbyPreload(erroredSlice, 'blob:slice-err'), true);
    assert.deepEqual(revoked, ['blob:slice-err']);
    assert.equal(erroredSlice.url, '');
    assert.equal(erroredSlice.firstSlicePlayback, false);
    assert.equal(sb.src, '');
    assert.equal(staleSandbox.state._bpPreloadedStream, null);

    const graphTrack = { id: 'od-graph', source: 'onedrive', downloadUrlAt: Date.now() };
    assert.equal(
      staleSandbox.isPreloadedStandbyStaleOrErrored(graphTrack, 'https://graph.microsoft.com/v1.0/me/drive/items/abc/content'),
      true,
      'OneDrive Graph /content preload must inspect state.microsoftExpiresAt instead of downloadUrlAt'
    );

    // 4. preloadCloudNextDuringBitPerfect re-resolves stale preload, caches _bpPreloadedStream, and playTrack reuses it & detaches standbyAudio before revoke
    const preloadBpSlice = sliceBetween(
      html,
      'let bpCloudPreloadTrackId = null;',
      'function resyncNextPreload('
    );
    let resolveCalls = 0;
    const bpPreloadSandbox = {
      state: {
        isNativeBitPerfectPlaying: true,
        bitPerfectEnabled: true,
        currentId: 'cur-1',
        preloadGeneration: 0,
        preloadTrackId: 'od-1',
        preloadReadyUrl: 'https://sp.expired/1',
        _bpPreloadedStream: { trackId: 'od-1', url: 'https://sp.expired/1', resolvedAt: Date.now() - 20 * 60 * 1000 },
        tracks: [
          { id: 'cur-1', source: 'local' },
          { id: 'od-1', source: 'onedrive', remoteId: 'r-od-1', size: 9999, downloadUrlAt: Date.now() - 29 * 60 * 1000 }
        ],
        objectUrls: new Set()
      },
      navigator: { onLine: true },
      queueIndex: () => 1,
      isPreloadedStandbyStaleOrErrored: staleSandbox.isPreloadedStandbyStaleOrErrored,
      invalidateStaleStandbyPreload: staleSandbox.invalidateStaleStandbyPreload,
      clearStalePreload: () => { bpPreloadSandbox.state.preloadTrackId = null; bpPreloadSandbox.state.preloadReadyUrl = null; },
      prepareCloudTrackForPreload: async () => {},
      resolveCloudBitPerfectStream: async tr => {
        resolveCalls++;
        return { url: 'https://sp.fresh/' + resolveCalls, headers: { Authorization: 'Bearer tok' }, source: tr.source, remoteId: tr.remoteId, size: tr.size };
      },
      window: { NocturneNative: { setBitPerfectStreamAuth: () => {}, setPendingNextCloudWifiLock: () => {} } },
      Date, Boolean, Number, String
    };
    vm.runInNewContext(preloadBpSlice, bpPreloadSandbox);
    await bpPreloadSandbox.preloadCloudNextDuringBitPerfect();
    assert.equal(resolveCalls, 1, 'Stale preload must not short-circuit preloadCloudNextDuringBitPerfect');
    assert.equal(bpPreloadSandbox.state._bpPreloadedStream.url, 'https://sp.fresh/1');
    assert.equal(bpPreloadSandbox.state._bpPreloadedStream.headers.Authorization, 'Bearer tok');

    const ptSlice = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
    assert.ok(ptSlice.includes('const preBp = state._bpPreloadedStream;') && ptSlice.includes('cloudBpStream = preBp;'), 'playTrack must reuse fresh state._bpPreloadedStream');
    assert.ok(ptSlice.includes('clearStalePreload();') && ptSlice.indexOf('clearStalePreload();') < ptSlice.lastIndexOf('releaseTrackUrl(track.url);'), 'playTrack must detach standbyAudio via clearStalePreload before revoking preloaded Cloud blob URL');
  });

  it('R1-4b (Probe 1C regression): runCloudWakeTokenRefresh + async preloadCloudNextDuringBitPerfect preserves preloadTrackId, avoids duplicate resolve, and background token refresh clears source-matched _bpPreloadedStream', async () => {
    const clearFn = extractFunction(html, 'function clearStalePreload()');
    const prepFn = extractFunction(html, 'async function prepareCloudTrackForPreload(track)');
    const preloadSlice = sliceBetween(
      html,
      'let bpCloudPreloadTrackId = null;',
      'function skipFailedTrack('
    );
    const wakeSlice = sliceBetween(
      html,
      'let lastTokenKeepAliveAt = 0;',
      "const LONG_TRACK_POS_KEY = 'nocturne-long-track-positions';"
    );

    let nowMs = 30_000_000;
    let resolveCount = 0;
    let pendingGooglePromise = null;
    let resolveGoogleToken = null;
    const sb = { src: '', pause() {}, removeAttribute(k) { if (k === 'src') this.src = ''; }, load() {} };
    const nextTrack = { id: 'gd:2', source: 'google', remoteId: 'g2', size: 1000, url: '', isDsd: false };
    const integratedSandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      navigator: { onLine: true },
      location: { href: 'https://nocturne.local/' },
      Date: { now: () => nowMs },
      Array, Object, Number, Boolean, String, RegExp, Set, URL, Promise,
      standbyAudio: sb,
      audio: { volume: 1 },
      library,
      state: {
        autoplay: true,
        repeat: 0,
        isNativeBitPerfectPlaying: true,
        bitPerfectEnabled: true,
        currentId: 'loc:1',
        preloadGeneration: 0,
        preloadTrackId: null,
        preloadReadyUrl: null,
        preloadBusyId: null,
        _bpPreloadedStream: null,
        _preloadFailedTrackId: null,
        _preloadFailedAt: 0,
        googleToken: 'g-expired',
        googleExpiresAt: nowMs - 60000,
        tracks: [
          { id: 'loc:1', source: 'local', isDsd: false },
          nextTrack
        ],
        objectUrls: new Set()
      },
      queueIndex: () => 1,
      releaseUnusedCloudUrl: () => {},
      stopPrefetchDsdSlice: () => {},
      pushActiveBitPerfectStreamAuth: () => {},
      retryPendingCurrentSliceUpgrade: async () => {},
      ensureGoogleToken: () => {
        if (!pendingGooglePromise) {
          pendingGooglePromise = new Promise(r => {
            resolveGoogleToken = tok => {
              integratedSandbox.state.googleToken = tok;
              integratedSandbox.state.googleExpiresAt = nowMs + 3600000;
              pendingGooglePromise = null;
              r(tok);
            };
          });
        }
        return pendingGooglePromise;
      },
      resolveCloudBitPerfectStream: async tr => {
        resolveCount++;
        return {
          url: 'https://www.googleapis.com/drive/v3/files/' + tr.remoteId + '?alt=media',
          headers: { Authorization: 'Bearer ' + integratedSandbox.state.googleToken },
          source: tr.source,
          remoteId: tr.remoteId,
          size: tr.size
        };
      },
      window: {
        NocturneNative: {
          setBitPerfectStreamAuth: () => {},
          setPendingNextCloudWifiLock: () => {}
        }
      },
      console
    };
    vm.runInNewContext(clearFn + '\n' + prepFn + '\n' + preloadSlice + '\n' + wakeSlice, integratedSandbox);

    // Trigger Doze wake refresh while autoplay=true & isNativeBitPerfectPlaying=true
    integratedSandbox.runCloudWakeTokenRefresh();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(typeof resolveGoogleToken === 'function', 'Pending Google token refresh must be in flight');

    // Resolve async token refresh -> onRefreshedToken must supersede in-flight preload and re-sync cleanly
    resolveGoogleToken('g-fresh');
    await new Promise(r => setTimeout(r, 10));

    assert.equal(integratedSandbox.state.preloadTrackId, 'gd:2', 'preloadTrackId must be gd:2 after wake refresh');
    assert.equal(integratedSandbox.state.preloadBusyId, null, 'preloadBusyId must settle to null');
    assert.ok(integratedSandbox.state._bpPreloadedStream, '_bpPreloadedStream must be populated');
    assert.equal(integratedSandbox.state._bpPreloadedStream.headers.Authorization, 'Bearer g-fresh');
    assert.equal(resolveCount, 1, 'Superseded pre-refresh preload must not double-resolve stream');

    // 3 subsequent position ticks calling preloadCloudNextDuringBitPerfect must remain memoized
    await integratedSandbox.preloadCloudNextDuringBitPerfect();
    await integratedSandbox.preloadCloudNextDuringBitPerfect();
    await integratedSandbox.preloadCloudNextDuringBitPerfect();
    assert.equal(resolveCount, 1, 'Subsequent preloadCloudNextDuringBitPerfect ticks must keep resolveCount === 1');
    assert.equal(integratedSandbox.state.preloadTrackId, 'gd:2');

    // Background scheduler token refresh in requestGoogleToken & getMicrosoftToken must clear source-matched _bpPreloadedStream
    const gAuthSlice = sliceBetween(html, 'let googleTokenRefreshPromise = null;', 'async function connectGoogle(');
    let capturedGoogleCb = null;
    const gSchedSandbox = {
      library: { parseCloudConfig: () => ({ clientId: 'cid.apps.googleusercontent.com' }) },
      localStorage: { getItem: () => null, setItem: () => {} },
      DEFAULT_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      state: {
        googleToken: 'g-old',
        googleExpiresAt: Date.now() + 1000,
        _bpPreloadedStream: { trackId: 'gd:2', source: 'google', url: 'https://g/2', headers: { Authorization: 'Bearer g-old' } }
      },
      googleOAuthRefreshScheduler: { scheduleRefresh: () => {} },
      pushActiveBitPerfectStreamAuth: () => {},
      window: {
        isSecureContext: true,
        google: {
          accounts: {
            oauth2: {
              initTokenClient: cfg => ({
                requestAccessToken: () => { capturedGoogleCb = cfg.callback; }
              })
            }
          }
        }
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
      Date, Number, Error, Promise
    };
    vm.runInNewContext(gAuthSlice, gSchedSandbox);
    const reqP = gSchedSandbox.requestGoogleToken({ prompt: '', timeoutMs: 9000 });
    capturedGoogleCb({ access_token: 'g-bg-fresh', expires_in: 3600 });
    await reqP;
    assert.equal(gSchedSandbox.state._bpPreloadedStream, null, 'requestGoogleToken callback must clear google _bpPreloadedStream');

    const msAuthSlice = sliceBetween(html, 'let microsoftMsalInitPromise = null;', 'async function applyMicrosoftSiblingFolderCovers(');
    const msSchedSandbox = {
      library,
      state: {
        msal: {
          acquireTokenSilent: async () => ({ accessToken: 'ms-bg-fresh', expiresOn: new Date(Date.now() + 3600000) })
        },
        msAccount: { username: 'u@example.com' },
        microsoftAccessToken: 'ms-old',
        microsoftExpiresAt: Date.now() + 1000,
        _bpPreloadedStream: { trackId: 'od:2', source: 'onedrive', url: 'https://od/2', headers: { Authorization: 'Bearer ms-old' } }
      },
      microsoftOAuthRefreshScheduler: { scheduleRefresh: () => {} },
      pushActiveBitPerfectStreamAuth: () => {},
      localStorage: { getItem: () => null, setItem: () => {} },
      location: { origin: 'https://nocturne.local', pathname: '/' },
      DEFAULT_MICROSOFT_CLIENT_ID: 'ms-cid',
      $: () => null,
      safeVal: () => '',
      Date, Promise, Error
    };
    vm.runInNewContext(msAuthSlice, msSchedSandbox);
    await msSchedSandbox.getMicrosoftToken(false, false);
    assert.equal(msSchedSandbox.state._bpPreloadedStream, null, 'getMicrosoftToken applyResult must clear onedrive _bpPreloadedStream');
  });

  it('R4-1: .agent/RUN.LOCK (when present) has Run >= 84 metadata and is ignored by .gitignore', () => {
    const lockPath = path.join(ROOT, '.agent', 'RUN.LOCK');
    if (fs.existsSync(lockPath)) {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      assert.ok(Number(lockData.run_id) >= 84, '.agent/RUN.LOCK run_id must be >= 84');
      assert.ok(typeof lockData.version === 'string' && lockData.version.startsWith('v3.9.'), '.agent/RUN.LOCK version must start with v3.9.');
      assert.ok(typeof lockData.started_at === 'string' && lockData.started_at.length > 0);
    }
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.agent/RUN.LOCK'));
  });
});
