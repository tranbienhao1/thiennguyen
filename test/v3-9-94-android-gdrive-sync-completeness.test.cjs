'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainActivity = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
const virtualScroll = fs.readFileSync(path.join(ROOT, 'virtual-scroll.js'), 'utf8');
const releaseScript = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'), 'utf8');

describe('v3.9.94: Android Google Drive Sync Completeness, Shortcut Folder BFS, 403 Backoff & WakeLock Guard', () => {
  it('1. fetchGoogleDrivePageWithRetry retries 403 rateLimitExceeded & loadGoogleFiles handles allDrives/user fallback, orderBy reset and schema upgrade reset', async () => {
    const rStart = html.indexOf('async function fetchGoogleDrivePageWithRetry(');
    const rEnd = html.indexOf('const checkedGoogleArtParents =', rStart);
    assert.ok(rStart > 0 && rEnd > rStart, 'fetchGoogleDrivePageWithRetry block must exist');

    let retryCalls = 0;
    const retrySandbox = {
      setTimeout: (fn) => { fn(); return 0; },
      Math,
      Number,
      Boolean,
      Promise,
      fetch: async () => {
        retryCalls++;
        if (retryCalls <= 2) {
          return {
            ok: false,
            status: 403,
            headers: { get: () => '' },
            clone: () => ({ text: async () => '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}' })
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => '' },
          json: async () => ({ files: [{ id: 'ok1', name: '01.flac' }] })
        };
      }
    };
    vm.createContext(retrySandbox);
    vm.runInContext(html.slice(rStart, rEnd) + '\nthis.fetchGoogleDrivePageWithRetry = fetchGoogleDrivePageWithRetry;', retrySandbox);

    const res403 = await retrySandbox.fetchGoogleDrivePageWithRetry('https://example.invalid/files', () => 'tok', async () => 'tok');
    assert.equal(res403.status, 200, 'fetchGoogleDrivePageWithRetry must retry HTTP 403 rateLimitExceeded until 200');
    assert.equal(retryCalls, 3);

    const cpStart = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
    const cpEnd = html.indexOf('function removeCloudTracksByRemoteIds(', cpStart);
    const gStart = html.indexOf('async function loadGoogleFiles() {');
    const gEnd = html.indexOf('async function loadGoogleAudio(', gStart);
    assert.ok(cpStart > 0 && cpEnd > cpStart && gStart > 0 && gEnd > gStart);

    const ls = {
      'nocturne-google-delta-token': 'stale-old-delta-token'
    };
    const seenUrls = [];
    let syncLockHistory = [];
    let deltaCalls = 0;
    const gSandbox = {
      GOOGLE_DRIVE_CANDIDATE_QUERY: 'trashed = false',
      window: {
        NocturneNative: {
          setCloudSyncActive: (flag) => syncLockHistory.push(Boolean(flag))
        }
      },
      navigator: { onLine: true },
      state: { tracks: [] },
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
        setItem: (k, v) => { ls[k] = String(v); },
        removeItem: (k) => { delete ls[k]; }
      },
      restoreCloudCatalog: async () => {},
      ensureGoogleToken: async () => 'tok_g',
      tryLoadGoogleChangesDelta: async () => { deltaCalls++; return { handled: true }; },
      fetchGoogleDrivePageWithRetry: async (url) => {
        seenUrls.push(url);
        const u = new URL(url);
        if (u.searchParams.get('corpora') === 'allDrives') {
          return { ok: false, status: 400, text: async () => 'invalid corpora allDrives for personal query' };
        }
        if (u.searchParams.get('orderBy')) {
          return { ok: false, status: 400, text: async () => 'orderBy rejected' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            nextPageToken: '',
            files: [{ id: 'f1', name: '01 - Track.flac', mimeType: 'audio/flac', size: '100' }]
          })
        };
      },
      isCloudAudio: () => true,
      googleTrack: (f) => ({ id: 'google:' + f.id, remoteId: f.id, source: 'google', name: f.name, size: Number(f.size) }),
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeDeletedCloudTracks: async () => 0,
      fetchGoogleStartPageToken: async () => 'FRESH_START_TOK',
      renderTracks: () => {},
      scheduleBackgroundRender: () => {},
      cloudStatus: () => {},
      toast: () => {},
      propagateAndBroadcastCovers: () => {},
      queueCloudMetadata: () => {},
      URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, JSON, Date, Promise, Error, console
    };
    vm.createContext(gSandbox);
    vm.runInContext(html.slice(cpStart, cpEnd) + '\n' + html.slice(gStart, gEnd) + '\nthis.loadGoogleFiles = loadGoogleFiles;', gSandbox);

    await gSandbox.loadGoogleFiles();
    assert.equal(deltaCalls, 0, 'Upgraded schema must clear stale delta token without schema marker and run full scan once');
    assert.ok(seenUrls[0].includes('corpora=allDrives'), 'First scan attempt must request corpora=allDrives');
    assert.ok(seenUrls.some(u => u.includes('corpora=user')), 'Must fall back cleanly to corpora=user on 400');
    assert.ok(ls['nocturne-google-sync-schema'] === 'v2-alldrives-shortcuts', 'Completed full scan must stamp sync schema');
    assert.equal(ls['nocturne-google-delta-token'], 'FRESH_START_TOK', 'Completed scan must store fresh startPageToken');
    assert.deepEqual(syncLockHistory, [true, false], 'Native Android cloud sync WakeLock guard must toggle true -> false');
    assert.equal(gSandbox.state.tracks.length, 1);
  });

  it('2. scanGoogleDriveAudioShortcuts recursively traverses folder shortcuts beyond 10 pages & awaits persist before checkpoint', async () => {
    const scStart = html.indexOf("const GOOGLE_DRIVE_SHORTCUT_QUERY =");
    const scEnd = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY =", scStart);
    assert.ok(scStart > 0 && scEnd > scStart);

    const scState = { tracks: [] };
    const seenQ = [];
    const scSandbox = {
      URLSearchParams, Map, Set, Array, Number, String, Boolean, Object, console,
      state: scState,
      isCloudAudio: (f) => Boolean(f && f.name && /\.(flac|mp3|dsf)$/i.test(f.name) && !(f.shortcutDetails && f.shortcutDetails.targetMimeType === 'application/vnd.google-apps.folder')),
      invalidateCloudTrackContent: () => {},
      googleTrack: (f) => ({
        id: 'google:' + f.id,
        remoteId: f.id,
        ...(f.shortcutDetails && f.shortcutDetails.targetId ? { targetRemoteId: f.shortcutDetails.targetId } : {}),
        ...(Array.isArray(f.parents) ? { parents: f.parents } : {}),
        source: 'google',
        name: f.name
      }),
      fetchGoogleDrivePageWithRetry: async (url) => {
        const u = new URL(url);
        const q = u.searchParams.get('q') || '';
        seenQ.push(q);
        if (q.includes('mimeType = \'application/vnd.google-apps.shortcut\'')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                { id: 'sc-folder-1', name: 'Shared Music Library', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'folder-shared-root', targetMimeType: 'application/vnd.google-apps.folder' } }
              ]
            })
          };
        }
        if (q.includes("'folder-shared-root' in parents")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                { id: 'sub-album-dir', name: 'Album A', mimeType: 'application/vnd.google-apps.folder' },
                { id: 'track-root-1', name: '01 - Intro.flac', mimeType: 'audio/flac', size: '1000' }
              ]
            })
          };
        }
        if (q.includes("'sub-album-dir' in parents")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: [
                { id: 'track-sub-1', name: '02 - Sonata.dsf', mimeType: 'application/octet-stream', size: '5000' }
              ]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
    };
    vm.createContext(scSandbox);
    vm.runInContext(html.slice(scStart, scEnd) + '\nthis.scanGoogleDriveAudioShortcuts = scanGoogleDriveAudioShortcuts;', scSandbox);

    const knownIds = new Set();
    const res = await scSandbox.scanGoogleDriveAudioShortcuts(() => 'tok', async () => 'tok', new Map(), knownIds, new Set(), [], []);
    assert.equal(res.added, 2, 'Recursive folder shortcut BFS must discover tracks inside nested folders');
    assert.ok(scState.tracks.some(t => t.remoteId === 'track-sub-1' && Array.isArray(t.parents) && t.parents[0] === 'sub-album-dir'));
    assert.ok(html.slice(scStart, scEnd).includes('scPageCount < 100'), 'Shortcut pagination cap must be >= 100 pages');

    const gBodyStart = html.indexOf('async function loadGoogleFiles() {');
    const gBodyEnd = html.indexOf('async function fetchCloudFile(', gBodyStart);
    const gBody = html.slice(gBodyStart, gBodyEnd);
    const awaitPersistPos = gBody.indexOf('await persistChain;\n            if (!persistFailed)');
    const writeCpPos = gBody.indexOf('writeCloudSyncCheckpoint(GOOGLE_SYNC_CHECKPOINT_KEY');
    assert.ok(awaitPersistPos !== -1 && writeCpPos > awaitPersistPos, 'Checkpoint write must wait for page IndexedDB persistChain');
  });

  it('3. MainActivity.java guards WakeLock during active cloud sync and virtual-scroll.js handles wide/tablet Android viewports', () => {
    assert.ok(mainActivity.includes('private volatile boolean mIsCloudSyncActive = false;'), 'MainActivity must declare mIsCloudSyncActive');
    assert.ok(mainActivity.includes('public void setCloudSyncActive(boolean active)'), 'MainActivity and WebAppInterface must expose setCloudSyncActive');
    assert.ok(mainActivity.includes('if (!mIsCloudSyncActive && !mIsMediaPlaying'), 'onPause must not drop WakeLock/WifiLock while cloud sync is active');
    assert.match(
      mainActivity,
      /if \(!mIsCloudSyncActive(?:\s*&&[^\n{]+)?\)\s*\{\s*releaseWakeLock\(\);/,
      'updateMediaNotification(false) must preserve WakeLock while cloud sync is active'
    );

    // Verify VirtualTrackList.getScrollTarget selects contentCol on Android >= 1024px when overflowY is auto
    const vsSandbox = {
      window: {
        innerWidth: 1280,
        isNativeAndroid: true,
        NocturneNative: {},
        getComputedStyle: () => ({ overflowY: 'auto' }),
        addEventListener: () => {}
      },
      document: {
        getElementById: (id) => (id === 'content-col' ? { id: 'content-col', addEventListener: () => {}, scrollTop: 0, clientHeight: 800 } : null)
      }
    };
    vm.createContext(vsSandbox);
    vm.runInContext(virtualScroll, vsSandbox);
    const list = new vsSandbox.VirtualTrackList({ addEventListener: () => {} });
    const targetWide = list.getScrollTarget();
    assert.equal(targetWide.id, 'content-col', 'Android tablet/landscape >= 1024px with overflow-y:auto must scroll #content-col');

    vsSandbox.window.innerWidth = 390;
    vsSandbox.window.getComputedStyle = () => ({ overflowY: 'visible' });
    list._scrollTarget = null;
    const targetPhone = list.getScrollTarget();
    assert.equal(targetPhone, vsSandbox.window, 'Phone < 1024px with overflow:visible must scroll window');
  });

  it('4. Settings exposes #google-full-resync button and all version markers match v3.9.94+ (versionCode >= 148)', () => {
    assert.ok(html.includes('id="google-full-resync"'), '#google-full-resync button must exist in Settings UI');
    assert.ok(html.includes("safeOn($('google-full-resync'), 'click'"), '#google-full-resync click listener must be wired');
    assert.ok(html.includes('loadGoogleFiles({ forceFullScan: true })'), '#google-full-resync must trigger forceFullScan');

    const semverTuple = s => String(s || '').split('.').map(n => parseInt(n, 10) || 0);
    const geq = (a, b) => {
      const va = semverTuple(a);
      const vb = semverTuple(b);
      for (let i = 0; i < 3; i++) {
        if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) > (vb[i] || 0);
      }
      return true;
    };
    const mHtml = html.match(/FiiO M11S · v(\d+\.\d+\.\d+)/);
    const mSwVer = sw.match(/const CACHE_VERSION = 'v(\d+\.\d+\.\d+)'/);
    const mSwName = sw.match(/const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)'/);
    const mGCode = gradle.match(/versionCode = (\d+)\b/);
    const mGName = gradle.match(/versionName = "(\d+\.\d+\.\d+)"/);
    const mRel = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRel, 'All version markers must exist');
    const ver = mHtml[1];
    assert.equal(mSwVer[1], ver);
    assert.equal(mSwName[1], ver);
    assert.equal(mGName[1], ver);
    assert.equal(mRel[1], ver);
    assert.equal(geq(ver, '3.9.94'), true, `Expected version ${ver} >= 3.9.94`);
    assert.ok(parseInt(mGCode[1], 10) >= 148, `Expected versionCode ${mGCode[1]} >= 148`);
    assert.doesNotThrow(() => new vm.Script(releaseScript));
  });
});
