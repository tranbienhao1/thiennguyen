'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require('../library-utils.js');

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  assert.ok(e > s, `Missing end marker: ${endMarker} after ${startMarker}`);
  return src.slice(s, e);
}

describe('v3.9.96 M1: Cloud Sync Hardening (R1) & Cache Hygiene / Volume-Mute Shortcuts (R3)', () => {
  it('F1: parseCloudRetryAfterMs handles numeric, fractional, HTTP-date & cap, and fetchGoogleDrivePageWithRetry/graphGet propagate refreshed tokens + 5 retries', async () => {
    const retrySlice = sliceBetween(
      html,
      'function parseCloudRetryAfterMs(headerValue, maxCapMs)',
      'const checkedGoogleArtParents ='
    );

    let gAttempt = 0;
    let gToken = 'g-old';
    let gRefreshes = 0;
    const gSleeps = [];
    const gRetrySandbox = {
      setTimeout: (fn, ms) => { gSleeps.push(ms); fn(); return 0; },
      Math, Number, String, Date, Boolean, Promise, Error,
      fetch: async (_url, opts) => {
        gAttempt++;
        if (gAttempt === 1) {
          assert.equal(opts.headers.Authorization, 'Bearer g-old');
          return { ok: false, status: 401, headers: { get: () => '' } };
        }
        if (gAttempt >= 2 && gAttempt <= 6) {
          assert.equal(opts.headers.Authorization, 'Bearer g-fresh');
          return {
            ok: false,
            status: 429,
            headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? (gAttempt === 2 ? '0.01' : '120') : '') }
          };
        }
        return { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true }) };
      }
    };
    vm.createContext(gRetrySandbox);
    vm.runInContext(
      retrySlice + '\nthis.parseCloudRetryAfterMs = parseCloudRetryAfterMs;\nthis.fetchGoogleDrivePageWithRetry = fetchGoogleDrivePageWithRetry;',
      gRetrySandbox
    );

    assert.equal(gRetrySandbox.parseCloudRetryAfterMs('2', 30000), 2000);
    assert.equal(gRetrySandbox.parseCloudRetryAfterMs('0.01', 30000), 10);
    assert.equal(gRetrySandbox.parseCloudRetryAfterMs('0.0001', 30000), 1);
    assert.equal(gRetrySandbox.parseCloudRetryAfterMs('90', 30000), 30000);
    assert.equal(gRetrySandbox.parseCloudRetryAfterMs('-3', 30000), 0);
    const futureHttpDate = new Date(Date.now() + 5000).toUTCString();
    const parsedHttpDate = gRetrySandbox.parseCloudRetryAfterMs(futureHttpDate, 30000);
    assert.ok(parsedHttpDate >= 3000 && parsedHttpDate <= 6000, `Expected ~5000ms, got ${parsedHttpDate}`);
    assert.equal(gRetrySandbox.parseCloudRetryAfterMs(new Date(Date.now() - 5000).toUTCString(), 30000), 0);

    const res = await gRetrySandbox.fetchGoogleDrivePageWithRetry(
      'https://example.invalid/files',
      () => gToken,
      async () => { gRefreshes++; gToken = 'g-fresh'; return gToken; }
    );
    assert.equal(res.status, 200);
    assert.equal(gRefreshes, 1);
    assert.equal(gSleeps.length, 5, 'Must support up to 5 retries after 401 refresh');
    assert.ok(gSleeps[0] >= 10 && gSleeps[0] < 360, 'Fractional retry-after + <350ms jitter');
    assert.ok(gSleeps[1] >= 30000 && gSleeps[1] < 30350, 'Cap at 30000ms + <350ms jitter');

    // OneDrive graphGet + ensureMicrosoftMsalClient + getMicrosoftToken + token propagation
    const msAuthSlice = sliceBetween(
      html,
      'async function graphGet(url, token = state.microsoftAccessToken)',
      'async function applyMicrosoftSiblingFolderCovers('
    );
    const msHelpersSlice = sliceBetween(
      html,
      'async function enqueueMicrosoftSharedItems(',
      'async function tryLoadMicrosoftDeltaSync('
    );

    const ls = new Map();
    let silentCalls = 0;
    let graphCalls = 0;
    const graphAuthHeaders = [];
    const msSandbox = {
      parseCloudRetryAfterMs: gRetrySandbox.parseCloudRetryAfterMs,
      setTimeout: (fn) => { fn(); return 0; },
      Math, Number, String, Date, Boolean, Promise, Error, Array, Map, Set, Object, JSON, encodeURIComponent,
      location: { origin: 'https://nocturne.test', pathname: '/' },
      library,
      $: () => null,
      safeVal: () => '',
      DEFAULT_MICROSOFT_CLIENT_ID: 'ms-default-id',
      MICROSOFT_DELTA_LINK_KEY: 'nocturne-microsoft-delta-link',
      localStorage: {
        getItem: k => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
        removeItem: k => ls.delete(k)
      },
      writeCloudDeltaCursor: (k, v) => ls.set(k, v),
      isCloudAudio: () => true,
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p }),
      state: {
        tracks: [],
        microsoftAccessToken: 'ms-old',
        microsoftExpiresAt: Date.now() + 3600000,
        microsoftLastRefreshAt: 0,
        msal: {
          acquireTokenSilent: async () => {
            silentCalls++;
            return { accessToken: 'ms-fresh-' + silentCalls, expiresOn: new Date(Date.now() + 3600000) };
          }
        },
        msAccount: { homeAccountId: 'acct-1' }
      },
      fetch: async (url, opts) => {
        graphCalls++;
        graphAuthHeaders.push({ url, auth: opts.headers.Authorization });
        if (url.includes('sharedWithMe') && graphCalls === 1) {
          return { ok: false, status: 401, headers: { get: () => '' }, text: async () => 'Expired' };
        }
        if (url.includes('sharedWithMe') && graphCalls === 2) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => '' },
            json: async () => ({
              value: [{ id: 'sh-1', name: 'Shared1.flac', file: { mimeType: 'audio/flac' }, size: 100 }],
              '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?page=2'
            })
          };
        }
        if (url.includes('sharedWithMe?page=2')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => '' },
            json: async () => ({
              value: [{ id: 'sh-2', name: 'Shared2.flac', file: { mimeType: 'audio/flac' }, size: 200 }]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => '' },
          json: async () => ({ '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=latest-ok' })
        };
      }
    };
    vm.createContext(msSandbox);
    vm.runInContext(
      msAuthSlice + '\n' + msHelpersSlice +
      '\nthis.graphGet = graphGet;\nthis.ensureMicrosoftMsalClient = ensureMicrosoftMsalClient;\nthis.getMicrosoftToken = getMicrosoftToken;\nthis.enqueueMicrosoftSharedItems = enqueueMicrosoftSharedItems;\nthis.saveMicrosoftLatestDeltaLink = saveMicrosoftLatestDeltaLink;',
      msSandbox
    );

    const sharedAdded = await msSandbox.enqueueMicrosoftSharedItems('ms-old', [], new Set(), new Map(), new Set(), new Set(), []);
    assert.equal(sharedAdded.length, 2);
    assert.equal(msSandbox.state.microsoftAccessToken, 'ms-fresh-1');
    assert.equal(graphAuthHeaders[2].auth, 'Bearer ms-fresh-1', 'Page 2 of sharedWithMe must propagate refreshed token');

    await msSandbox.saveMicrosoftLatestDeltaLink('ms-old');
    assert.equal(graphAuthHeaders[3].auth, 'Bearer ms-fresh-1', 'saveMicrosoftLatestDeltaLink must prefer refreshed state.microsoftAccessToken');

    const coalescedFirst = await msSandbox.getMicrosoftToken(false, true);
    assert.equal(coalescedFirst, 'ms-fresh-1');
    const coalescedSecond = await msSandbox.getMicrosoftToken(false, true);
    assert.equal(coalescedSecond, 'ms-fresh-1');
    assert.equal(silentCalls, 1, 'Repeated forceRefresh within 8s must coalesce');

    // ensureMicrosoftMsalClient without global msal throws clean Vietnamese error, not ReferenceError
    const noMsalSandbox = {
      state: { msal: null },
      library,
      $: () => null,
      safeVal: () => '',
      DEFAULT_MICROSOFT_CLIENT_ID: 'ms-default-id',
      localStorage: { getItem: () => null },
      location: { origin: 'https://nocturne.test', pathname: '/' },
      Promise, Error
    };
    vm.createContext(noMsalSandbox);
    vm.runInContext(
      sliceBetween(html, 'let microsoftMsalInitPromise = null;', 'async function applyMicrosoftSiblingFolderCovers(') +
      '\nthis.ensureMicrosoftMsalClient = ensureMicrosoftMsalClient;',
      noMsalSandbox
    );
    await assert.rejects(() => noMsalSandbox.ensureMicrosoftMsalClient(), /Phiên OneDrive đã hết hạn/);
  });

  it('F2: Google & OneDrive delta sync persist page-1+ tracks before 410, runaway (>40), and network error fallbacks', async () => {
    const gBlock = sliceBetween(
      html,
      "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';",
      'function removeDeletedCloudTracks('
    );
    const msDeltaBlock = sliceBetween(
      html,
      'async function tryLoadMicrosoftDeltaSync(',
      'async function verifyMicrosoftAccountSwitch('
    );

    // Google Drive Delta: 410 on page 2, runaway > 40, and error on page 2
    for (const mode of ['410', 'runaway', 'neterr']) {
      const storage = new Map([['nocturne-google-delta-token', 'g-cur-1']]);
      const persisted = [];
      let page = 0;
      const gDeltaSandbox = {
        URLSearchParams, Date, Array, Number, String, Set, Map, Promise, Error,
        localStorage: {
          getItem: k => (storage.has(k) ? storage.get(k) : null),
          setItem: (k, v) => storage.set(k, String(v)),
          removeItem: k => storage.delete(k)
        },
        state: {
          tracks: [{ id: 'google:g-upd', remoteId: 'g-upd', source: 'google', name: 'Old.flac', size: 100 }],
          googleToken: 'g-tok'
        },
        ensureGoogleToken: async () => 'g-tok',
        googleConfigurationHint: () => '',
        isCloudAudio: () => true,
        googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, size: Number(f.size) || 0 }),
        persistCloudCatalog: async items => { persisted.push(items.map(t => t.id)); },
        fetchGoogleDrivePageWithRetry: async () => {
          page++;
          if (page === 1) {
            return {
              status: 200,
              ok: true,
              json: async () => ({
                nextPageToken: 'g-cur-2',
                changes: [
                  { fileId: 'g-add', file: { id: 'g-add', name: 'Add.flac', size: '500' } },
                  { fileId: 'g-upd', file: { id: 'g-upd', name: 'New.flac', size: '600' } }
                ]
              })
            };
          }
          if (mode === '410') return { status: 410, ok: false, text: async () => 'Gone' };
          if (mode === 'neterr') throw new Error('Drive delta dropped');
          return {
            status: 200,
            ok: true,
            json: async () => ({ nextPageToken: 'g-cur-' + (page + 1), changes: [] })
          };
        }
      };
      vm.createContext(gDeltaSandbox);
      vm.runInContext(gBlock + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', gDeltaSandbox);

      const existing = new Map([['g-upd', gDeltaSandbox.state.tracks[0]]]);
      const known = new Set(['g-upd']);
      if (mode === 'neterr') {
        await assert.rejects(() => gDeltaSandbox.tryLoadGoogleChangesDelta('g-tok', existing, known), /Drive delta dropped/);
      } else {
        const res = await gDeltaSandbox.tryLoadGoogleChangesDelta('g-tok', existing, known);
        assert.deepEqual(JSON.parse(JSON.stringify(res)), { handled: false, resetCursor: true });
        assert.equal(storage.has('nocturne-google-delta-token'), false);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(persisted)), [['google:g-add', 'google:g-upd']], `Google mode ${mode} must flush partial delta batch`);
    }

    // OneDrive Delta: syncStateNotFound/410 on page 2, runaway > 40, and error on page 2
    for (const mode of ['syncStateNotFound', 'runaway', 'neterr']) {
      const storage = new Map([['nocturne-microsoft-delta-link', 'https://graph.microsoft.com/v1.0/delta?p=1']]);
      const persisted = [];
      let page = 0;
      const msDeltaSandbox = {
        Date, Array, Number, String, Set, Map, Promise, Error,
        MICROSOFT_DELTA_LINK_KEY: 'nocturne-microsoft-delta-link',
        readCloudDeltaCursor: k => (storage.has(k) ? storage.get(k) : ''),
        writeCloudDeltaCursor: (k, v) => { if (v) storage.set(k, v); else storage.delete(k); },
        state: {
          tracks: [{ id: 'onedrive:ms-upd', remoteId: 'ms-upd', source: 'onedrive', name: 'Old.flac', size: 100 }],
          microsoftAccessToken: 'ms-tok'
        },
        isCloudAudio: () => true,
        microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p }),
        mergeMicrosoftTrack: () => {},
        persistCloudCatalog: async items => { persisted.push(items.map(t => t.id)); },
        graphGet: async () => {
          page++;
          if (page === 1) {
            return {
              value: [
                { id: 'ms-add', name: 'MsAdd.flac', file: { mimeType: 'audio/flac' }, size: 400 },
                { id: 'ms-upd', name: 'MsNew.flac', file: { mimeType: 'audio/flac' }, size: 700 }
              ],
              '@odata.nextLink': 'https://graph.microsoft.com/v1.0/delta?p=2'
            };
          }
          if (mode === 'syncStateNotFound') {
            const err = new Error('Microsoft Graph 400: {"error":{"code":"syncStateNotFound"}}');
            err.status = 400;
            throw err;
          }
          if (mode === 'neterr') {
            const err = new Error('Microsoft Graph 503: Unavailable');
            err.status = 503;
            throw err;
          }
          return { value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/delta?p=' + (page + 1) };
        }
      };
      vm.createContext(msDeltaSandbox);
      vm.runInContext(msDeltaBlock + '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;', msDeltaSandbox);

      const existing = new Map([['ms-upd', msDeltaSandbox.state.tracks[0]]]);
      const known = new Set(['ms-upd']);
      if (mode === 'neterr') {
        await assert.rejects(() => msDeltaSandbox.tryLoadMicrosoftDeltaSync('ms-tok', existing, known, new Map()), /503/);
      } else {
        const res = await msDeltaSandbox.tryLoadMicrosoftDeltaSync('ms-tok', existing, known, new Map());
        assert.deepEqual(JSON.parse(JSON.stringify(res)), { handled: false, resetCursor: true });
        assert.equal(storage.has('nocturne-microsoft-delta-link'), false);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(persisted)), [['onedrive:ms-add', 'onedrive:ms-upd']], `OneDrive mode ${mode} must flush partial delta batch`);
    }
  });

  it('F3: Google Drive checkpoint recovers from 404/410, defers clear until shortcut scan completes, guards incomplete shortcut pruning, and resets cloudStatus on error', async () => {
    const scBlock = sliceBetween(
      html,
      'const GOOGLE_DRIVE_SHORTCUT_QUERY =',
      "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';"
    );
    const cpBlock = sliceBetween(
      html,
      "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';",
      'function removeCloudTracksByRemoteIds('
    );
    const gBlock = sliceBetween(
      html,
      'async function loadGoogleFiles() {',
      'async function loadGoogleAudio('
    );

    // 1. Checkpoint 404/410 recovery
    for (const expiredStatus of [404, 410]) {
      const ls = { 'nocturne-google-sync-checkpoint': JSON.stringify({ pageToken: 'STALE_CP', useOrderBy: true, useAllDrives: true, savedAt: Date.now() }) };
      let calls = 0;
      const gSandbox = {
        GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
        navigator: { onLine: true },
        state: { tracks: [] },
        localStorage: {
          getItem: k => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
          setItem: (k, v) => { ls[k] = String(v); },
          removeItem: k => { delete ls[k]; }
        },
        restoreCloudCatalog: async () => {},
        ensureGoogleToken: async () => 'tok',
        fetchGoogleDrivePageWithRetry: async (url) => {
          calls++;
          if (calls === 1) {
            assert.ok(url.includes('pageToken=STALE_CP'));
            return { ok: false, status: expiredStatus, text: async () => 'Expired' };
          }
          assert.ok(!url.includes('pageToken=STALE_CP'), 'Must reset pageToken on expired checkpoint');
          return { ok: true, status: 200, json: async () => ({ nextPageToken: '', files: [{ id: 'g1', name: '01.flac', size: '100' }] }) };
        },
        isCloudAudio: () => true,
        googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, size: Number(f.size) }),
        persistCloudCatalog: async () => {},
        pruneCloudCatalog: async () => {},
        removeDeletedCloudTracks: async () => 0,
        fetchGoogleStartPageToken: async () => 'NEW_START_TOK',
        renderTracks: () => {},
        scheduleBackgroundRender: () => {},
        cloudStatus: () => {},
        toast: () => {},
        propagateAndBroadcastCovers: () => {},
        queueCloudMetadata: () => {},
        URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
      };
      vm.createContext(gSandbox);
      vm.runInContext(cpBlock + '\n' + gBlock + '\nthis.loadGoogleFiles = loadGoogleFiles;', gSandbox);
      await gSandbox.loadGoogleFiles();
      assert.equal(ls['nocturne-google-sync-checkpoint'], undefined);
      assert.equal(gSandbox.state.tracks.length, 1);
      assert.equal(ls['nocturne-google-delta-token'], 'NEW_START_TOK', 'Recovered full scan from root may stamp startPageToken');
    }

    // 2. Shortcut scan incomplete flag + gating removeDeletedCloudTracks/delta cursor + cloudStatus reset on error
    const ls2 = {};
    let deletedCalls = 0;
    let deltaTokenCalls = 0;
    let lastStatus = null;
    const scSandbox = {
      GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
      navigator: { onLine: true },
      state: { tracks: [{ id: 'google:existing', remoteId: 'existing', source: 'google', name: 'Keep.flac', metadataLoaded: true, cover: 'x' }] },
      localStorage: {
        getItem: k => (Object.prototype.hasOwnProperty.call(ls2, k) ? ls2[k] : null),
        setItem: (k, v) => { ls2[k] = String(v); },
        removeItem: k => { delete ls2[k]; }
      },
      restoreCloudCatalog: async () => {},
      ensureGoogleToken: async () => 'tok',
      fetchGoogleDrivePageWithRetry: async (url) => {
        const u = new URL(url);
        const q = u.searchParams.get('q') || '';
        if (q.includes("mimeType = 'application/vnd.google-apps.shortcut'")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [{ id: 'sc-dir', name: 'ShortcutFolder', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'target-dir', targetMimeType: 'application/vnd.google-apps.folder' } }]
            })
          };
        }
        if (q.includes("'target-dir' in parents")) {
          return { ok: false, status: 500, text: async () => 'Shortcut folder failed' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ nextPageToken: '', files: [{ id: 'existing', name: 'Keep.flac', size: '100' }] })
        };
      },
      isCloudAudio: () => true,
      googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => { deletedCalls++; return 0; },
      fetchGoogleStartPageToken: async () => { deltaTokenCalls++; return 'TOK'; },
      renderTracks: () => {},
      scheduleBackgroundRender: () => {},
      cloudStatus: (src, text, cls) => { lastStatus = { src, text, cls }; },
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(scSandbox);
    vm.runInContext(scBlock + '\n' + cpBlock + '\n' + gBlock + '\nthis.loadGoogleFiles = loadGoogleFiles;', scSandbox);
    await scSandbox.loadGoogleFiles();
    assert.equal(deletedCalls, 0, 'Incomplete shortcut scan must skip removeDeletedCloudTracks');
    assert.equal(deltaTokenCalls, 0, 'Incomplete shortcut scan must skip fetchGoogleStartPageToken');
    assert.equal(ls2['nocturne-google-sync-schema'], undefined, 'Incomplete shortcut scan must not stamp schema');

    // Error status reset check
    scSandbox.fetchGoogleDrivePageWithRetry = async () => ({ ok: false, status: 500, text: async () => 'Boom' });
    scSandbox.googleConfigurationHint = () => 'Server error';
    await assert.rejects(() => scSandbox.loadGoogleFiles(), /500/);
    assert.equal(lastStatus.src, 'google');
    assert.equal(lastStatus.cls, 'text-amber-300');
    assert.ok(lastStatus.text.includes('tạm dừng'));
  });

  it('F4: OneDrive checkpoint nextLink resume, >500 queue, QuotaExceededError, 404/410 recovery, sharedWithMe guard, shared WakeLock guard, and #microsoft-full-resync UI', async () => {
    // UI parity check
    assert.ok(html.includes('id="microsoft-full-resync"'), '#onedrive-card must expose #microsoft-full-resync button');
    assert.ok(html.includes("safeOn($('microsoft-full-resync'), 'click'"), '#microsoft-full-resync click handler must be wired');
    assert.ok(html.includes('loadMicrosoftFiles(token, { forceFullScan: true })'), '#microsoft-full-resync must trigger forceFullScan');

    const cpBlock = sliceBetween(
      html,
      "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';",
      'function removeCloudTracksByRemoteIds('
    );
    const wakeBlock = sliceBetween(
      html,
      'let lastNativeCloudSyncLock = null;',
      'async function verifyGoogleDriveAccountSwitch('
    );
    const gBlock = sliceBetween(
      html,
      'async function loadGoogleFiles() {',
      'async function loadGoogleAudio('
    );
    const mBlock = sliceBetween(
      html,
      'async function loadMicrosoftFiles(token) {',
      'const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS'
    );

    // 1. @odata.nextLink checkpoint update + activeMsBatch completed filter + 404 subfolder skip + >500 queue + QuotaExceededError
    const msLs = {};
    let throwOnPage2 = true;
    const seenUrls = [];
    const msSandbox = {
      state: { tracks: [], microsoftAccessToken: 'tok' },
      library,
      navigator: { onLine: true },
      localStorage: {
        getItem: k => (Object.prototype.hasOwnProperty.call(msLs, k) ? msLs[k] : null),
        setItem: (k, v) => { msLs[k] = String(v); },
        removeItem: k => { delete msLs[k]; }
      },
      restoreCloudCatalog: async () => {},
      graphGet: async (url) => {
        seenUrls.push(url);
        if (url.includes('/root/children')) {
          return {
            value: [
              { id: 'dir_a', name: 'DirA', folder: { childCount: 1 } },
              { id: 'dir_b', name: 'DirB', folder: { childCount: 1 } }
            ]
          };
        }
        if (url.includes('dir_a')) {
          return { value: [{ id: 'a1', name: 'a1.flac', file: { mimeType: 'audio/flac' }, size: 100 }] };
        }
        if (url.includes('dir_b') && !url.includes('next=2')) {
          return {
            value: [{ id: 'b1', name: 'b1.flac', file: { mimeType: 'audio/flac' }, size: 200 }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/items/dir_b/children?next=2'
          };
        }
        if (url.includes('next=2')) {
          if (throwOnPage2) {
            throwOnPage2 = false;
            throw new Error('Transient drop on page 2');
          }
          return { value: [{ id: 'b2', name: 'b2.flac', file: { mimeType: 'audio/flac' }, size: 300 }] };
        }
        if (url.includes('dir_deleted')) {
          const err = new Error('Not found');
          err.status = 404;
          throw err;
        }
        return { value: [] };
      },
      isCloudAudio: it => Boolean(it && it.file),
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p, size: it.size, metadataLoaded: true, cover: 'x' }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => 0,
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(msSandbox);
    vm.runInContext(cpBlock + '\n' + wakeBlock + '\n' + mBlock + '\nthis.loadMicrosoftFiles = loadMicrosoftFiles;\nthis.writeCloudSyncCheckpoint = writeCloudSyncCheckpoint;', msSandbox);

    await assert.rejects(() => msSandbox.loadMicrosoftFiles('tok'), /Transient drop on page 2/);
    const cp = JSON.parse(msLs['nocturne-microsoft-sync-checkpoint']);
    assert.equal(cp.queue.length, 1, 'Completed dir_a must not remain in checkpoint');
    assert.ok(cp.queue[0].url.includes('next=2'), 'Checkpoint must advance folderNode.url to @odata.nextLink');

    // Inject a deleted subfolder into checkpoint to verify 404 subfolder recovery skips cleanly
    cp.queue.push({ url: 'https://graph.microsoft.com/v1.0/me/drive/items/dir_deleted/children', path: 'DeletedSub', driveId: '' });
    msLs['nocturne-microsoft-sync-checkpoint'] = JSON.stringify(cp);
    seenUrls.length = 0;
    await msSandbox.loadMicrosoftFiles('tok');
    assert.ok(seenUrls.some(u => u.includes('next=2')), 'Resume must fetch exact nextLink');
    assert.ok(!seenUrls.some(u => u.includes('dir_a')), 'Completed dir_a must not be re-fetched');
    assert.equal(msLs['nocturne-microsoft-sync-checkpoint'], undefined);
    assert.equal(msSandbox.state.tracks.length, 3);

    // QuotaExceededError check on writeCloudSyncCheckpoint
    msSandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.equal(msSandbox.writeCloudSyncCheckpoint('k', { queue: [1] }), false);

    // >500-folder queue preserved without 500 truncation + 410 root checkpoint recovery
    const bigLs = {};
    let bigFailOnce = true;
    const bigFolders = Array.from({ length: 600 }, (_, i) => ({ id: 'd_' + i, name: 'D' + i, folder: { childCount: 0 } }));
    const bigMsSandbox = {
      state: { tracks: [], microsoftAccessToken: 'tok' },
      library,
      navigator: { onLine: true },
      localStorage: {
        getItem: k => (Object.prototype.hasOwnProperty.call(bigLs, k) ? bigLs[k] : null),
        setItem: (k, v) => { bigLs[k] = String(v); },
        removeItem: k => { delete bigLs[k]; }
      },
      restoreCloudCatalog: async () => {},
      graphGet: async (url) => {
        if (url.includes('/root/children')) return { value: bigFolders };
        if (url.includes('d_0') && bigFailOnce) {
          bigFailOnce = false;
          throw new Error('Mid-sync drop with >500 folders');
        }
        return { value: [] };
      },
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => 0,
      renderTracks: () => {},
      scheduleTrackRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(bigMsSandbox);
    vm.runInContext(cpBlock + '\n' + wakeBlock + '\n' + mBlock + '\nthis.loadMicrosoftFiles = loadMicrosoftFiles;', bigMsSandbox);
    await assert.rejects(() => bigMsSandbox.loadMicrosoftFiles('tok'), /Mid-sync drop/);
    const bigCp = JSON.parse(bigLs['nocturne-microsoft-sync-checkpoint']);
    assert.equal(bigCp.queue.length, 598, 'Checkpoint must preserve >500 incomplete folders (598 of 600, excluding 2 completed siblings) without silent 500-truncation');

    // 410 checkpoint expiry restarts from root cleanly
    const expLs = {
      'nocturne-microsoft-sync-checkpoint': JSON.stringify({ queue: [{ url: 'https://graph.microsoft.com/v1.0/me/drive/root/children?expired=1', path: '', driveId: '' }], savedAt: Date.now() })
    };
    let expCalls = 0;
    const expSandbox = {
      ...bigMsSandbox,
      state: { tracks: [], microsoftAccessToken: 'tok' },
      localStorage: {
        getItem: k => (Object.prototype.hasOwnProperty.call(expLs, k) ? expLs[k] : null),
        setItem: (k, v) => { expLs[k] = String(v); },
        removeItem: k => { delete expLs[k]; }
      },
      graphGet: async (url) => {
        expCalls++;
        if (expCalls === 1 && url.includes('expired=1')) {
          const err = new Error('Gone');
          err.status = 410;
          throw err;
        }
        return { value: [{ id: 'root-ok', name: 'Root.flac', file: { mimeType: 'audio/flac' }, size: 100 }] };
      },
      isCloudAudio: it => Boolean(it && it.file),
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p, metadataLoaded: true, cover: 'x' })
    };
    vm.createContext(expSandbox);
    vm.runInContext(cpBlock + '\n' + wakeBlock + '\n' + mBlock + '\nthis.loadMicrosoftFiles = loadMicrosoftFiles;', expSandbox);
    await expSandbox.loadMicrosoftFiles('tok');
    assert.equal(expLs['nocturne-microsoft-sync-checkpoint'], undefined);
    assert.equal(expSandbox.state.tracks.length, 1);

    // 2. sharedWithMe incomplete scan prevents removeDeletedCloudTracks + shared WakeLock guard
    const syncLockHistory = [];
    let msDeletedCount = 0;
    let releaseMs = null;
    const sharedLockSandbox = {
      GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
      window: { NocturneNative: { setCloudSyncActive: f => syncLockHistory.push(Boolean(f)) } },
      navigator: { onLine: true },
      state: { tracks: [] },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      restoreCloudCatalog: async () => {},
      ensureGoogleToken: async () => 'g-tok',
      fetchGoogleDrivePageWithRetry: async () => ({
        ok: true, status: 200,
        json: async () => ({ nextPageToken: '', files: [{ id: 'g1', name: '01.flac', size: '100' }] })
      }),
      enqueueMicrosoftSharedItems: async () => { const arr = []; arr._sharedScanComplete = false; return arr; },
      graphGet: async () => {
        await new Promise(resolve => { releaseMs = resolve; });
        return { value: [{ id: 'm1', name: '01.flac', file: { mimeType: 'audio/flac' }, size: 100 }] };
      },
      isCloudAudio: () => true,
      googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, metadataLoaded: true, cover: 'x' }),
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p, metadataLoaded: true, cover: 'x' }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async (src) => { if (src === 'onedrive') msDeletedCount++; return 0; },
      fetchGoogleStartPageToken: async () => '',
      renderTracks: () => {},
      scheduleBackgroundRender: () => {},
      scheduleTrackRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      URLSearchParams, encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(sharedLockSandbox);
    vm.runInContext(
      cpBlock + '\n' + wakeBlock + '\n' + gBlock + '\n' + mBlock +
      '\nthis.loadGoogleFiles = loadGoogleFiles;\nthis.loadMicrosoftFiles = loadMicrosoftFiles;',
      sharedLockSandbox
    );
    const msPromise = sharedLockSandbox.loadMicrosoftFiles('ms-tok');
    await sharedLockSandbox.loadGoogleFiles();
    assert.deepEqual(syncLockHistory, [true], 'Google finishing while OneDrive is active must NOT release WakeLock');
    releaseMs();
    await msPromise;
    assert.deepEqual(syncLockHistory, [true, false], 'WakeLock must release only once both syncs finish');
    assert.equal(msDeletedCount, 0, 'Incomplete sharedWithMe must prevent removeDeletedCloudTracks for OneDrive');
  });

  it('F5: firstSliceCache cleanup matches both JSON historyTrackKey and legacy prefixes, and defragmentCacheDatabase preserves active JSON keys', async () => {
    // 1. purgeCloudSliceCacheAndOrphanedCovers
    const purgeSlice = sliceBetween(html, 'function purgeCloudSliceCacheAndOrphanedCovers() {', 'function restoreCloudCatalog()');
    const deletedFromPurge = [];
    const purgeSandbox = {
      Array, Set, Map, String, Promise, Error,
      library,
      state: {
        tracks: [{ id: 'local:1', source: 'local', album: 'Local' }],
        albumCovers: new Map([['local', 'blob:l'], ['cloud', 'data:image/png;base64,x']]),
        lyricsPreloadLifecycle: { cancelAll: () => {} }
      },
      saveAlbumCoversCache: () => {},
      clearCloudSyncCheckpoint: () => {},
      writeCloudDeltaCursor: () => {},
      sliceCacheTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        return {
          transaction: tx,
          getAllKeys: () => {
            const req = {
              result: [
                JSON.stringify(['google', 'g1']),
                JSON.stringify(['onedrive', 'od1']),
                'google:legacy-1',
                'onedrive:legacy-2',
                JSON.stringify(['local', 'h1', 10, 500]),
                'local:3'
              ],
              onsuccess: null,
              onerror: null
            };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); if (tx.oncomplete) tx.oncomplete(); });
            return req;
          },
          delete: k => deletedFromPurge.push(k)
        };
      },
      catalogTransaction: () => {
        const tx = { oncomplete: null, onerror: null, onabort: null };
        return { transaction: tx, clear: () => queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); }) };
      }
    };
    vm.createContext(purgeSandbox);
    vm.runInContext(purgeSlice + '\nthis.clearCloudCatalog = clearCloudCatalog;', purgeSandbox);
    await purgeSandbox.clearCloudCatalog();
    assert.deepEqual(deletedFromPurge.sort(), ['["google","g1"]', '["onedrive","od1"]', 'google:legacy-1', 'onedrive:legacy-2'].sort());

    // 2. clearCloudSourceCatalog('google') preserves onedrive and local
    const clearSrcSlice = sliceBetween(html, 'async function clearCloudSourceCatalog(source) {', "if (typeof window !== 'undefined') window.clearCloudSourceCatalog");
    const deletedFromSrc = [];
    const srcSandbox = {
      Array, Set, Map, String, Promise, Error, JSON,
      state: {
        tracks: [
          { id: 'google:g1', remoteId: 'g1', source: 'google' },
          { id: 'onedrive:od1', remoteId: 'od1', source: 'onedrive' },
          { id: 'local:l1', source: 'local' }
        ],
        currentId: null
      },
      catalogTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        return { transaction: tx, delete: () => {}, oncomplete: null };
      },
      sliceCacheTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        return {
          transaction: tx,
          getAllKeys: () => {
            const req = {
              result: [
                JSON.stringify(['google', 'g1']),
                JSON.stringify(['onedrive', 'od1']),
                'google:legacy-1',
                'onedrive:legacy-2',
                JSON.stringify(['local', 'h1', 10, 500]),
                'local:3'
              ],
              onsuccess: null,
              onerror: null
            };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); if (tx.oncomplete) tx.oncomplete(); });
            return req;
          },
          delete: k => deletedFromSrc.push(k)
        };
      }
    };
    // Fix catalogTransaction completion callback
    srcSandbox.catalogTransaction = () => {
      const tx = { oncomplete: null, onerror: null };
      queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
      return { transaction: tx, delete: () => {} };
    };
    vm.createContext(srcSandbox);
    vm.runInContext(clearSrcSlice + '\nthis.clearCloudSourceCatalog = clearCloudSourceCatalog;', srcSandbox);
    await srcSandbox.clearCloudSourceCatalog('google');
    assert.deepEqual(deletedFromSrc.sort(), ['["google","g1"]', 'google:legacy-1'].sort());

    // 3. defragmentCacheDatabase keeps active JSON historyTrackKey entries
    const activeTracks = [
      { id: 'google:g1', remoteId: 'g1', source: 'google', title: 'G1' },
      { id: 'onedrive:od1', remoteId: 'od1', source: 'onedrive', title: 'OD1' },
      { id: 'local:l1', source: 'local', name: 'local-1.flac', size: 500, title: 'L1' }
    ];
    const now = Date.now();
    const entries = [
      { key: library.historyTrackKey(activeTracks[0]), size: 1000, savedAt: now },
      { key: library.historyTrackKey(activeTracks[1]), size: 2000, savedAt: now },
      { key: library.historyTrackKey(activeTracks[2]), size: 3000, savedAt: now },
      { key: '["google","orphan-g"]', size: 400, savedAt: now }
    ];
    const defrag = library.defragmentCacheDatabase(entries, activeTracks, { now });
    assert.equal(defrag.validCount, 3);
    assert.deepEqual(defrag.orphanedKeys, ['["google","orphan-g"]']);
  });

  it('F6: resurrection guard (_cloudSourceCleared + queue purge), playback/session cleanup, and Google/OneDrive account-switch detection', async () => {
    // 1. In-flight enrichCloudTrack + queue purge + playback/session cleanup
    const queueSlice = sliceBetween(html, 'const pendingCloudCatalogPersistMap = new Map();', 'function isCloudAuthHttpError(');

    const enrichSlice = sliceBetween(html, 'async function enrichCloudTrack(track) {', 'const dsdWorkerBaseUrl =');
    const persistSlice = sliceBetween(html, 'function persistCloudCatalog(tracks) {', 'function pruneCloudCatalog()');
    const clearSrcSlice = sliceBetween(html, 'async function clearCloudSourceCatalog(source) {', "if (typeof window !== 'undefined') window.clearCloudSourceCatalog");
    const discSlice = sliceBetween(html, 'async function disconnectCloudSource(source) {', "const RECENT_TRACKS_KEY = 'nocturne-recent-tracks';");

    const idbWritten = [];
    let releaseTags = null;
    let bpStopped = 0;
    let corsPaused = 0;
    let standbyPaused = 0;
    let audioPaused = 0;
    let dsdStopped = 0;
    let loadingSet = null;
    let optCleared = 0;
    let syncUiCalls = 0;
    const lsMap = new Map([
      ['nocturne-google-account', 'acct-a'],
      ['nocturne-playback-session', JSON.stringify({ trackId: 'google:g1', currentTime: 12 })]
    ]);
    const gTrack = { id: 'google:g1', remoteId: 'g1', source: 'google', name: 'Song.flac', album: 'Alb' };
    const odTrack = { id: 'onedrive:od1', remoteId: 'od1', source: 'onedrive', name: 'Od.flac', album: 'OdAlb' };

    const resSandbox = {
      Array, Set, Map, String, Number, Boolean, Object, JSON, Date, Promise, Error, console, setTimeout, clearTimeout,
      library,
      IS_LEGACY_ANDROID: false,
      CLOUD_METADATA_CONCURRENCY: 2,
      trackMetadataRevision: 0,
      filterOptionsSignature: '',
      bpCloudPreloadTrackId: 'google:g1',
      cloudCatalogResetting: false,
      audio: { pause: () => { audioPaused++; } },
      standbyAudio: { pause: () => { standbyPaused++; } },
      window: {
        NocturneNative: { stopBitPerfectPlayback: () => { bpStopped++; } }
      },
      localStorage: {
        getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
        setItem: (k, v) => lsMap.set(k, String(v)),
        removeItem: k => lsMap.delete(k)
      },
      state: {
        tracks: [gTrack, odTrack],
        currentId: 'google:g1',
        playGeneration: 5,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: true,
        dsdTrackId: 'google:g1',
        corsBypassAudio: { pause: () => { corsPaused++; } },
        albumCovers: new Map(),
        queueTrackIds: ['google:g1', 'onedrive:od1'],
        preloadTrackId: 'google:g1',
        lyricsPreloadLifecycle: { cancelAll: () => {} }
      },
      $: () => null,
      stopDsdWorker: () => { dsdStopped++; },
      setPlaybackLoading: v => { loadingSet = v; },
      clearOptimisticLoadingUi: () => { optCleared++; },
      clearStalePreload: () => {},
      invalidateCloudTrackContent: () => {},
      pruneOrphanedAlbumCovers: () => {},
      renderTracks: () => {},
      renderQueue: () => {},
      syncPlaybackButtonsUi: () => { syncUiCalls++; },
      updateMetadataFilters: () => {},
      scheduleTrackRender: () => {},
      syncAlbumCoversImmediate: (c, t) => { resSandbox.state.albumCovers.set(t.album, c); },
      broadcastCoverUpdate: () => {},
      normalizeCoverImage: async c => c,
      allSettledCompat: async arr => Promise.all(arr.map(p => Promise.resolve(p).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })))),
      cloudTagRequest: () => new Promise(resolve => { releaseTags = resolve; }),
      googleThumbnail: async () => 'data:image/jpeg;base64,THUMB',
      microsoftThumbnail: async () => null,
      serializableCloudTrack: t => t,
      catalogTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        return {
          transaction: tx,
          delete: () => {},
          put: item => { idbWritten.push(item.id); }
        };
      },
      sliceCacheTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        return {
          transaction: tx,
          getAllKeys: () => {
            const req = { result: [], onsuccess: null, onerror: null };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
            return req;
          },
          delete: () => {}
        };
      }
    };
    vm.createContext(resSandbox);
    vm.runInContext(
      'let cloudMetadataPausedUntil = 0; let cloudMetadataResumeTimer = null; let cloudMetadataActive = 0; const cloudMetadataQueue = []; const cloudMetadataQueued = new Set(); function runCloudMetadataQueue() {}' +
      '\n' + queueSlice +
      '\nfunction allSettledCompat(promises) { return Promise.all(promises.map(p => Promise.resolve(p).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason })))); }' +
      '\n' + enrichSlice +
      '\n' + persistSlice +
      '\n' + clearSrcSlice +
      '\n' + discSlice +
      '\nthis.pendingCloudCatalogPersistMap = pendingCloudCatalogPersistMap;\nthis.cloudMetadataQueue = cloudMetadataQueue;\nthis.enrichCloudTrack = enrichCloudTrack;\nthis.queueCloudCatalogPersist = queueCloudCatalogPersist;\nthis.persistCloudCatalog = persistCloudCatalog;\nthis.clearCloudSourceCatalog = clearCloudSourceCatalog;\nthis.disconnectCloudSource = disconnectCloudSource;',
      resSandbox
    );

    // Seed queues with both google and onedrive tracks
    resSandbox.pendingCloudCatalogPersistMap.set(gTrack.id, gTrack);
    resSandbox.pendingCloudCatalogPersistMap.set(odTrack.id, odTrack);
    resSandbox.cloudMetadataQueue.push(gTrack, odTrack);

    const enrichPromise = resSandbox.enrichCloudTrack(gTrack);
    const res = await resSandbox.disconnectCloudSource('google');
    assert.equal(res.removedCount, 1);
    assert.equal(bpStopped, 1, 'isNativeBitPerfectPaused must trigger stopBitPerfectPlayback');
    assert.equal(corsPaused, 1);
    assert.equal(standbyPaused, 1);
    assert.equal(audioPaused, 1);
    assert.equal(dsdStopped, 1);
    assert.equal(resSandbox.state.playGeneration, 6);
    assert.equal(loadingSet, false);
    assert.equal(optCleared, 1);
    assert.equal(resSandbox.bpCloudPreloadTrackId, null);
    assert.equal(lsMap.has('nocturne-playback-session'), false);
    assert.equal(lsMap.has('nocturne-google-account'), false);
    assert.equal(syncUiCalls, 1);
    assert.equal(resSandbox.pendingCloudCatalogPersistMap.has(gTrack.id), false);
    assert.equal(resSandbox.pendingCloudCatalogPersistMap.has(odTrack.id), true);
    assert.equal(resSandbox.cloudMetadataQueue.length, 1);

    // Now resolve the mid-flight enrichCloudTrack and verify zero resurrection
    releaseTags({ title: 'Ghost', artist: 'Ghost', album: 'GhostAlb', cover: 'data:image/jpeg;base64,GHOST' });
    await enrichPromise;
    resSandbox.queueCloudCatalogPersist(gTrack);
    await resSandbox.persistCloudCatalog([gTrack, odTrack], { skipPrune: true });
    assert.equal(resSandbox.state.albumCovers.has('GhostAlb'), false, 'Cleared track cover must not resurrect');
    assert.deepEqual(idbWritten, ['onedrive:od1'], 'Only non-cleared OneDrive track may persist');

    // 2. Account switch detection in loadGoogleFiles & loadMicrosoftFiles
    const cpBlock = sliceBetween(html, "const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';", 'function removeDeletedCloudTracks(');
    const gAcctBlock = sliceBetween(html, 'async function verifyGoogleDriveAccountSwitch(', 'async function loadGoogleAudio(');
    const msAcctBlock = sliceBetween(html, 'async function verifyMicrosoftAccountSwitch(', 'const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS');

    const acctLs = new Map([
      ['nocturne-google-account', 'acct-old@gmail.com'],
      ['nocturne-google-delta-token', 'old-g-delta'],
      ['nocturne-microsoft-account', 'drive:ms-old-id'],
      ['nocturne-microsoft-delta-link', 'old-ms-delta']
    ]);
    let clearedSources = [];
    const acctSandbox = {
      GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
      navigator: { onLine: true },
      localStorage: {
        getItem: k => (acctLs.has(k) ? acctLs.get(k) : null),
        setItem: (k, v) => acctLs.set(k, String(v)),
        removeItem: k => acctLs.delete(k)
      },
      state: {
        tracks: [
          { id: 'google:old', remoteId: 'old', source: 'google', name: 'OldG.flac' },
          { id: 'onedrive:old', remoteId: 'old', source: 'onedrive', name: 'OldM.flac' },
          { id: 'local:1', source: 'local', name: 'Local.flac' }
        ],
        currentId: null
      },
      clearCloudSourceCatalog: async (src) => {
        clearedSources.push(src);
        acctSandbox.state.tracks = acctSandbox.state.tracks.filter(t => t.source !== src);
        acctLs.delete(src === 'google' ? 'nocturne-google-account' : 'nocturne-microsoft-account');
        acctLs.delete(src === 'google' ? 'nocturne-google-delta-token' : 'nocturne-microsoft-delta-link');
      },
      syncPlaybackButtonsUi: () => {},
      restoreCloudCatalog: async () => {},
      ensureGoogleToken: async () => 'g-tok-new',
      fetchGoogleDrivePageWithRetry: async (url) => {
        if (url.includes('/drive/v3/about')) {
          return { ok: true, status: 200, json: async () => ({ user: { permissionId: 'acct-new-perm', emailAddress: 'acct-new@gmail.com' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ nextPageToken: '', files: [{ id: 'g-new', name: 'NewG.flac', size: '100' }] }) };
      },
      fetch: async (url) => {
        if (url.includes('/me/drive?$select=id,owner')) {
          return { ok: true, status: 200, json: async () => ({ id: 'ms-new-id' }) };
        }
        return { ok: true, status: 200, json: async () => ({ value: [] }) };
      },
      graphGet: async () => ({ value: [{ id: 'ms-new', name: 'NewM.flac', file: { mimeType: 'audio/flac' }, size: 200 }] }),
      isCloudAudio: () => true,
      googleTrack: f => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, metadataLoaded: true, cover: 'x' }),
      microsoftTrack: (it, p) => ({ id: 'onedrive:' + it.id, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: p, metadataLoaded: true, cover: 'x' }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => 0,
      fetchGoogleStartPageToken: async () => 'g-fresh-start',
      renderTracks: () => {},
      scheduleBackgroundRender: () => {},
      scheduleTrackRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      URLSearchParams, encodeURIComponent, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(acctSandbox);
    vm.runInContext(
      cpBlock + '\n' + gAcctBlock + '\n' + msAcctBlock +
      '\nthis.loadGoogleFiles = loadGoogleFiles;\nthis.loadMicrosoftFiles = loadMicrosoftFiles;',
      acctSandbox
    );
    await acctSandbox.loadGoogleFiles();
    await acctSandbox.loadMicrosoftFiles('ms-tok-new');
    assert.deepEqual(clearedSources, ['google', 'onedrive']);
    assert.equal(acctLs.get('nocturne-google-account'), 'acct-new-perm');
    assert.equal(acctLs.get('nocturne-microsoft-account'), 'drive:ms-new-id');
    assert.deepEqual(acctSandbox.state.tracks.map(t => t.id).sort(), ['google:g-new', 'local:1', 'onedrive:ms-new'].sort());

    // 3. Empty complete HTTP-200 scan cleans up stale cloud tracks while preserving active account key
    clearedSources = [];
    acctSandbox.fetchGoogleDrivePageWithRetry = async (url) => {
      if (url.includes('/drive/v3/about')) {
        return { ok: true, status: 200, json: async () => ({ user: { permissionId: 'acct-new-perm' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ nextPageToken: '', files: [] }) };
    };
    await acctSandbox.loadGoogleFiles();
    assert.deepEqual(clearedSources, ['google']);
    assert.equal(acctLs.get('nocturne-google-account'), 'acct-new-perm', 'Active account key must remain stamped after empty complete scan');
    assert.deepEqual(acctSandbox.state.tracks.map(t => t.id).sort(), ['local:1', 'onedrive:ms-new'].sort());
  });

  it('F7: setGain null-guards volume-mobile/volume & syncs corsBypassAudio, toggleMute/ArrowUp/ArrowDown respect Bit-Perfect lock, and n avoids Night Dimmer collision', () => {
    const gainSlice = sliceBetween(html, 'let volumeBeforeMute = 80;', 'function setStereoBalance(');
    // Grab full ArrowUp/ArrowDown/u/n branch from keydown listener
    const kdStart = html.indexOf("else if (event.key === 'ArrowUp' || event.key === 'ArrowDown')");
    const kdEnd = html.indexOf("else if (event.key.toLowerCase() === 'p')", kdStart);
    assert.ok(kdStart > 0 && kdEnd > kdStart);
    const kdBranch = html.slice(kdStart, kdEnd);

    const dimmerStart = html.indexOf("document.addEventListener('keydown', e => {\n      if (!e || e.defaultPrevented");
    const dimmerEnd = html.indexOf('applyNightDimmerLevel(nightDimmerIdx, false);', dimmerStart);
    assert.ok(dimmerStart > 0 && dimmerEnd > dimmerStart);
    const dimmerSlice = html.slice(dimmerStart, dimmerEnd);

    const toasts = [];
    let playNextCalls = 0;
    let dimmerCalls = 0;
    const listeners = [];
    const volInput = { value: '50' };
    const f7Sandbox = {
      Number, Math, String, Boolean,
      audio: { volume: 0.5 },
      standbyAudio: { volume: 0.5 },
      state: {
        bitPerfectEnabled: false,
        replayGainEnabled: false,
        replayGainMultiplier: 1,
        corsBypassAudio: { volume: 0.5 }
      },
      $: id => (id === 'volume' ? volInput : null), // volume-mobile is null!
      toast: msg => toasts.push(msg),
      playNext: () => { playNextCalls++; },
      toggleMiniPlayerHud: () => {},
      nightDimmerIdx: 0,
      applyNightDimmerLevel: () => { dimmerCalls++; },
      document: {
        addEventListener: (_ev, fn) => listeners.push(fn)
      }
    };
    vm.createContext(f7Sandbox);
    vm.runInContext(
      gainSlice +
      '\nfunction handleTestKey(event) { if (false) {} ' + kdBranch + ' }' +
      '\n' + dimmerSlice +
      '\nthis.setGain = setGain;\nthis.toggleMute = toggleMute;\nthis.handleTestKey = handleTestKey;',
      f7Sandbox
    );

    // setGain with volume-mobile === null and corsBypassAudio active
    f7Sandbox.setGain(0);
    assert.equal(f7Sandbox.audio.volume, 0);
    assert.equal(f7Sandbox.state.corsBypassAudio.volume, 0);
    assert.equal(volInput.value, 0);

    // Bit-Perfect mode: toggleMute and ArrowUp/ArrowDown keep unity gain and show Bit-Perfect toast
    f7Sandbox.state.bitPerfectEnabled = true;
    f7Sandbox.toggleMute();
    assert.equal(f7Sandbox.audio.volume, 1.0);
    assert.equal(f7Sandbox.state.corsBypassAudio.volume, 1.0);
    assert.equal(volInput.value, 100);
    assert.ok(toasts[toasts.length - 1].includes('Bit-Perfect'), 'toggleMute must explain Bit-Perfect unity lock');

    f7Sandbox.handleTestKey({ key: 'ArrowDown', preventDefault: () => {}, stopImmediatePropagation: () => {} });
    assert.equal(f7Sandbox.audio.volume, 1.0);
    assert.ok(toasts[toasts.length - 1].includes('Bit-Perfect'), 'ArrowDown must explain Bit-Perfect unity lock');

    // 'n' collision check: main handler prevents default; Night Dimmer respects defaultPrevented
    let prevented = false;
    const nEvt = {
      key: 'n',
      ctrlKey: false, metaKey: false, altKey: false, isComposing: false,
      target: { tagName: 'BODY' },
      get defaultPrevented() { return prevented; },
      preventDefault: () => { prevented = true; }
    };
    f7Sandbox.handleTestKey(nEvt);
    assert.equal(playNextCalls, 1);
    assert.equal(prevented, true);
    listeners[0](nEvt);
    assert.equal(dimmerCalls, 0, 'Night Dimmer must NOT trigger when main keydown handled n');
  });
});
