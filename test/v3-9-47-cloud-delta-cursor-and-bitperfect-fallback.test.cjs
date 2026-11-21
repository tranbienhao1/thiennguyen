'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Google Drive incremental delta cursor sync adds/updates/deletes tracks and falls back cleanly on 410 Gone', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
  const end = html.indexOf('function removeDeletedCloudTracks(', start);
  assert.ok(start !== -1 && end > start, 'Google delta cursor block must exist before removeDeletedCloudTracks');
  const blockSrc = html.slice(start, end);

  const storageMap = new Map([['nocturne-google-delta-token', 'cursor-1']]);
  const deletedCatalogIds = [];
  const invalidatedIds = [];
  const persistedBatches = [];
  let prunedCalls = 0;
  let renderedCalls = 0;

  const tracks = [
    { id: 'google:playing', remoteId: 'playing', source: 'google', name: 'Playing.flac', size: 1000, contentRev: 'md5-p' },
    { id: 'google:upd', remoteId: 'upd', source: 'google', name: 'Old.flac', size: 1000, contentRev: 'md5-old' },
    { id: 'google:del', remoteId: 'del', source: 'google', name: 'Deleted.flac', size: 1000, contentRev: 'md5-del' }
  ];
  const existingByRemoteId = new Map(tracks.map(t => [t.remoteId, t]));
  const knownIds = new Set(tracks.map(t => t.remoteId));

  let pageCalls = 0;
  let mockMode = 'normal';
  const sandbox = {
    URLSearchParams,
    Date,
    Array,
    Number,
    String,
    Set,
    Map,
    localStorage: {
      getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: k => storageMap.delete(k)
    },
    state: { currentId: 'google:playing', tracks },
    catalogTransaction: () => {
      const store = {
        delete: id => deletedCatalogIds.push(id),
        transaction: {}
      };
      queueMicrotask(() => {
        if (typeof store.transaction.oncomplete === 'function') store.transaction.oncomplete();
      });
      return store;
    },
    invalidateCloudTrackContent: tr => { invalidatedIds.push(tr.id); },
    ensureGoogleToken: async () => 'g-tok-fresh',
    googleConfigurationHint: () => '',
    isCloudAudio: f => Boolean(f && f.name && f.name.endsWith('.flac')),
    googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name, size: Number(f.size) || 0, contentRev: f.md5Checksum || f.modifiedTime || '' }),
    persistCloudCatalog: async items => { persistedBatches.push(items.map(i => i.id)); },
    pruneCloudCatalog: async () => { prunedCalls++; },
    renderTracks: () => { renderedCalls++; },
    cloudStatus: () => {},
    toast: () => {},
    fetchGoogleDrivePageWithRetry: async url => {
      if (mockMode === '410') {
        return { status: 410, ok: false, json: async () => ({}), text: async () => 'Gone' };
      }
      if (url.includes('startPageToken')) {
        return { status: 200, ok: true, json: async () => ({ startPageToken: 'start-tok-fresh' }) };
      }
      pageCalls++;
      if (pageCalls === 1) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            nextPageToken: 'cursor-2',
            changes: [
              { fileId: 'upd', file: { id: 'upd', name: 'Remastered.flac', size: '2500', md5Checksum: 'md5-new', parents: ['p1'] } },
              { fileId: 'new-1', file: { id: 'new-1', name: 'Added.flac', size: '3000', md5Checksum: 'md5-add' } },
              { fileId: 'del', removed: true }
            ]
          })
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          newStartPageToken: 'cursor-next-cycle',
          changes: [
            { fileId: 'playing', file: { id: 'playing', name: 'Playing.flac', trashed: true } }
          ]
        })
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    blockSrc +
      '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;' +
      '\nthis.fetchGoogleStartPageToken = fetchGoogleStartPageToken;' +
      '\nthis.readCloudDeltaCursor = readCloudDeltaCursor;' +
      '\nthis.GOOGLE_DELTA_TOKEN_KEY = GOOGLE_DELTA_TOKEN_KEY;',
    sandbox
  );

  const res = await sandbox.tryLoadGoogleChangesDelta('g-tok', existingByRemoteId, knownIds);
  assert.deepEqual(
    { handled: res.handled, added: res.added, updated: res.updated, removed: res.removed },
    { handled: true, added: 1, updated: 1, removed: 1 }
  );
  assert.equal(storageMap.get('nocturne-google-delta-token'), 'cursor-next-cycle');
  assert.deepEqual(invalidatedIds, ['google:upd', 'google:del']);
  assert.deepEqual(deletedCatalogIds, ['google:del']);
  assert.ok(tracks.some(t => t.id === 'google:playing'), 'Active playing track must remain protected on delta delete');
  assert.ok(tracks.some(t => t.id === 'google:new-1'), 'Added track must be inserted');
  assert.ok(!tracks.some(t => t.id === 'google:del'), 'Removed track must be pruned from state.tracks');
  assert.equal(tracks.find(t => t.id === 'google:upd').name, 'Remastered.flac');
  assert.equal(prunedCalls, 1);
  assert.equal(renderedCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(persistedBatches)), [['google:new-1', 'google:upd']]);

  // Test startPageToken helper
  const startTok = await sandbox.fetchGoogleStartPageToken('g-tok');
  assert.equal(startTok, 'start-tok-fresh');

  // Test 410 Gone resets cursor so caller falls back to full scan
  mockMode = '410';
  const expiredRes = await sandbox.tryLoadGoogleChangesDelta('g-tok', existingByRemoteId, knownIds);
  assert.deepEqual(JSON.parse(JSON.stringify(expiredRes)), { handled: false, resetCursor: true });
  assert.equal(sandbox.readCloudDeltaCursor(sandbox.GOOGLE_DELTA_TOKEN_KEY), '');
});

test('2. OneDrive incremental delta cursor sync, cover discovery, 410 reset, and loadGoogleFiles/loadMicrosoftFiles wiring', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gBlockStart = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
  const gBlockEnd = html.indexOf('function removeDeletedCloudTracks(', gBlockStart);
  const msDeltaStart = html.indexOf('async function saveMicrosoftLatestDeltaLink(token) {');
  const msDeltaEnd = html.indexOf('async function loadMicrosoftFiles(token) {', msDeltaStart);
  assert.ok(msDeltaStart !== -1 && msDeltaEnd > msDeltaStart, 'OneDrive delta helpers must exist right before loadMicrosoftFiles');

  const storageMap = new Map([['nocturne-microsoft-delta-link', 'https://graph.microsoft.com/v1.0/delta?token=od-1']]);
  const invalidatedIds = [];
  const deletedCatalogIds = [];
  const persisted = [];

  const tracks = [
    { id: 'onedrive:od-upd', remoteId: 'od-upd', source: 'onedrive', name: 'Old.flac', size: 1000, contentRev: 'c-1', title: 'Old' },
    { id: 'onedrive:od-del', remoteId: 'od-del', source: 'onedrive', name: 'Del.flac', size: 1000, contentRev: 'c-del' }
  ];
  const existingByRemoteId = new Map(tracks.map(t => [t.remoteId, t]));
  const knownIds = new Set(tracks.map(t => t.remoteId));
  const siblingCoversByDir = new Map();

  let graphMode = 'normal';
  const sandbox = {
    Date,
    Array,
    Number,
    String,
    Set,
    Map,
    decodeURIComponent,
    library: { scoreFolderCoverFilename: name => (name.toLowerCase() === 'cover.jpg' ? 100 : 0) },
    localStorage: {
      getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: k => storageMap.delete(k)
    },
    state: { currentId: null, tracks },
    catalogTransaction: () => {
      const store = { delete: id => deletedCatalogIds.push(id), transaction: {} };
      queueMicrotask(() => { if (typeof store.transaction.oncomplete === 'function') store.transaction.oncomplete(); });
      return store;
    },
    invalidateCloudTrackContent: tr => { invalidatedIds.push(tr.id); tr.metadataLoaded = false; },
    isCloudAudio: item => Boolean(item && item.name && item.name.endsWith('.flac')),
    microsoftTrack: (item, itemPath) => ({ id: `onedrive:${item.id}`, remoteId: item.id, remotePath: itemPath, source: 'onedrive', name: item.name, size: Number(item.size) || 0, contentRev: item.cTag || item.eTag || '' }),
    mergeMicrosoftTrack: (tr, item, itemPath) => { tr.remotePath = itemPath; if (item.audio && item.audio.title) tr.title = item.audio.title; },
    persistCloudCatalog: async items => { persisted.push(...items.map(i => i.id)); },
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    graphGet: async url => {
      if (graphMode === '410') {
        const err = new Error('Microsoft Graph 410: resyncRequired');
        err.status = 410;
        throw err;
      }
      if (url.includes('delta?token=latest')) {
        return { '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=od-latest' };
      }
      return {
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=od-2',
        value: [
          {
            id: 'od-upd',
            name: 'New.flac',
            size: 2048,
            cTag: 'c-2',
            audio: { title: 'Remastered Title' },
            parentReference: { path: '/drive/root:/Jazz%20Miles' }
          },
          { id: 'od-del', deleted: { state: 'deleted' } },
          { id: 'od-new', name: 'Added.flac', size: 4096, cTag: 'c-new', parentReference: { path: '/drive/root:/Jazz%20Miles' } },
          { id: 'od-cov', name: 'cover.jpg', '@microsoft.graph.downloadUrl': 'https://dl/cover.jpg', parentReference: { path: '/drive/root:/Jazz%20Miles' } }
        ]
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(gBlockStart, gBlockEnd) +
      '\n' +
      html.slice(msDeltaStart, msDeltaEnd) +
      '\nthis.saveMicrosoftLatestDeltaLink = saveMicrosoftLatestDeltaLink;' +
      '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;' +
      '\nthis.readCloudDeltaCursor = readCloudDeltaCursor;' +
      '\nthis.MICROSOFT_DELTA_LINK_KEY = MICROSOFT_DELTA_LINK_KEY;',
    sandbox
  );

  const msRes = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', existingByRemoteId, knownIds, siblingCoversByDir);
  assert.deepEqual(JSON.parse(JSON.stringify(msRes)), { handled: true, added: 1, updated: 1, removed: 1 });
  assert.equal(storageMap.get('nocturne-microsoft-delta-link'), 'https://graph.microsoft.com/v1.0/delta?token=od-2');
  assert.deepEqual(invalidatedIds, ['onedrive:od-upd', 'onedrive:od-del']);
  assert.deepEqual(deletedCatalogIds, ['onedrive:od-del']);
  assert.equal(tracks.find(t => t.id === 'onedrive:od-upd').title, 'Remastered Title');
  assert.equal(tracks.find(t => t.id === 'onedrive:od-new').remotePath, 'Jazz Miles/Added.flac');
  assert.equal(siblingCoversByDir.get('Jazz Miles').id, 'od-cov');
  assert.deepEqual(persisted, ['onedrive:od-new', 'onedrive:od-upd']);

  // saveMicrosoftLatestDeltaLink saves latest delta token cleanly
  const latestSaved = await sandbox.saveMicrosoftLatestDeltaLink('ms-tok');
  assert.equal(latestSaved, 'https://graph.microsoft.com/v1.0/delta?token=od-latest');

  // 410 Gone clears deltaLink and signals fallback to full scan
  graphMode = '410';
  const expiredMs = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', existingByRemoteId, knownIds, siblingCoversByDir);
  assert.deepEqual(JSON.parse(JSON.stringify(expiredMs)), { handled: false, resetCursor: true });
  assert.equal(sandbox.readCloudDeltaCursor(sandbox.MICROSOFT_DELTA_LINK_KEY), '');

  // Verify loadGoogleFiles & loadMicrosoftFiles wiring
  const gFnStart = html.indexOf('async function loadGoogleFiles() {');
  const gFnEnd = html.indexOf('async function fetchCloudFile(', gFnStart);
  const gFnSrc = html.slice(gFnStart, gFnEnd);
  assert.ok(gFnSrc.includes('tryLoadGoogleChangesDelta(token, existingByRemoteId, knownIds)'));
  assert.ok(gFnSrc.includes('fetchGoogleStartPageToken(token)'));

  const msFnStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msFnEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msFnStart);
  const msFnSrc = html.slice(msFnStart, msFnEnd);
  assert.ok(msFnSrc.includes('tryLoadMicrosoftDeltaSync(token, existingByRemoteId, knownIds, siblingCoversByDir)'));
  assert.ok(msFnSrc.includes('saveMicrosoftLatestDeltaLink(token)'));
});

test('3. Android Bit-Perfect error cleans focus before fallback, preserves seek position, bounds retries, and hardens OneDrive upgrade fallback', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  // 3.1 MainActivity.java cleanup order: abandonAudioFocus() BEFORE notifyBitPerfectErrorToWeb(pendingErrorReason)
  const loopStart = java.indexOf('private void runPlaybackLoop(');
  const loopEnd = java.indexOf('private final BitPerfectAudioPlayer mBitPerfectPlayer', loopStart);
  const loopSrc = java.slice(loopStart, loopEnd);
  assert.ok(loopSrc.includes('String pendingErrorReason = null;'));
  assert.ok(loopSrc.includes('pendingErrorReason = e.getMessage()'));
  const abandonIdx = loopSrc.indexOf('abandonAudioFocus();');
  const notifyIdx = loopSrc.indexOf('notifyBitPerfectErrorToWeb(pendingErrorReason);');
  assert.ok(abandonIdx > 0 && notifyIdx > abandonIdx, 'notifyBitPerfectErrorToWeb must run in finally AFTER abandonAudioFocus()');

  // 3.2 Web window.onNativeBitPerfectError preserves mid-track position and bounds retry loop
  const bpErrStart = html.indexOf('window.onNativeBitPerfectError =');
  const bpErrEnd = html.indexOf('window.onBitPerfectPlaybackComplete =', bpErrStart);
  assert.ok(bpErrStart !== -1 && bpErrEnd > bpErrStart);
  const bpErrSrc = html.slice(bpErrStart, bpErrEnd);

  const curTrack = { id: 'loc-1', source: 'local', title: 'Test FLAC' };
  const playedIds = [];
  const nextCalls = [];
  let ctxResumeCalls = 0;
  let fakeNow = 1_700_000_000_000;
  const bpSandbox = {
    window: {},
    console,
    Number,
    Boolean,
    String,
    Date: { now: () => fakeNow },
    audio: { paused: true },
    state: {
      currentId: 'loc-1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lastBitPerfectPositionSec: 47.8,
      tracks: [curTrack],
      context: { state: 'suspended', resume: () => { ctxResumeCalls++; return Promise.resolve(); } }
    },
    playTrack: id => playedIds.push(id),
    playNext: (dir, auto) => nextCalls.push([dir, auto]),
    toast: () => {}
  };
  vm.createContext(bpSandbox);
  vm.runInContext(bpErrSrc, bpSandbox);

  bpSandbox.window.onNativeBitPerfectError('MediaCodec decode error');
  assert.equal(bpSandbox.state.isNativeBitPerfectPlaying, false);
  assert.equal(curTrack._skipNativeBpOnce, true);
  assert.ok(curTrack._nativeBpFallbackUntil > fakeNow);
  assert.equal(curTrack._resumeAfterBpFallbackSec, 47.8);
  assert.equal(ctxResumeCalls, 1);
  assert.deepEqual(playedIds, ['loc-1']);

  // Second fallback within 30s still attempts fallback; 3rd failure skips to next track
  bpSandbox.state.isNativeBitPerfectPlaying = true;
  bpSandbox.window.onNativeBitPerfectError('Err 2');
  assert.equal(playedIds.length, 2);

  bpSandbox.state.isNativeBitPerfectPlaying = true;
  bpSandbox.window.onNativeBitPerfectError('Err 3');
  assert.equal(playedIds.length, 2, 'Must break error loop on 3rd failure within 30s');
  assert.deepEqual(nextCalls, [[1, false]]);

  // Verify playTrack honors _nativeBpFallbackUntil and initialTargetSeekSec
  const playTrackStart = html.indexOf('async function playTrack(trackId) {');
  const playTrackEnd = html.indexOf('function stopDsdWorker(', playTrackStart);
  const playTrackSrc = html.slice(playTrackStart, playTrackEnd);
  assert.ok(playTrackSrc.includes('track._nativeBpFallbackUntil && Date.now() < track._nativeBpFallbackUntil'));
  assert.ok(playTrackSrc.includes('track._resumeAfterBpFallbackSec'));
  assert.ok(playTrackSrc.includes('initialTargetSeekSec'));

  // 3.3 upgradeSliceToFullAudio falls back from broken OneDrive pre-signed directUrl on 410 / retryable network drop
  const upStart = html.indexOf('async function upgradeSliceToFullAudio(');
  const upEnd = html.indexOf('async function fetchCloudTrack(', upStart);
  const upSrc = html.slice(upStart, upEnd);

  const fetchedUrls = [];
  const upTrack = { id: 'od-1', remoteId: 'od-1', source: 'onedrive', format: 'flac', title: 'Track', downloadUrl: 'https://sharepoint/old', downloadUrlAt: 1 };
  const FakeURL = function (u) { this.href = String(u); };
  FakeURL.createObjectURL = () => 'blob:full-od';
  FakeURL.revokeObjectURL = () => {};
  const upSandbox = {
    state: { currentId: 'od-1', objectUrls: new Set() },
    audio: { src: '' },
    standbyAudio: { src: '' },
    location: { href: 'https://appassets.androidplatform.net/index.html' },
    URL: FakeURL,
    Blob,
    Promise,
    Error,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
    isGraphContentUrl: u => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
    resolveMicrosoftDownloadUrl: async () => '',
    getMicrosoftToken: async () => 'ms-tok',
    finishCloudMetadataInBackground: () => {},
    releaseTrackUrl: () => {},
    library: {
      normalizeAudioBlob: b => b,
      fetchAudioBlob: async u => {
        fetchedUrls.push(u);
        if (u.startsWith('https://sharepoint/old')) {
          const e = new Error('Pre-signed link expired');
          e.status = 410;
          throw e;
        }
        return new Blob(['flac-bytes'], { type: 'audio/flac' });
      }
    }
  };
  vm.createContext(upSandbox);
  vm.runInContext(
    html.slice(html.indexOf('const isGraphContentUrl ='), upStart) +
      '\n' +
      upSrc +
      '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;',
    upSandbox
  );
  const upgradedUrl = await upSandbox.upgradeSliceToFullAudio(upTrack, 'blob:slice', 'https://sharepoint/old', {}, 'OneDrive');
  assert.equal(upgradedUrl, 'blob:full-od');
  assert.deepEqual(fetchedUrls, [
    'https://sharepoint/old',
    'https://graph.microsoft.com/v1.0/me/drive/items/od-1/content'
  ]);
});

test('4. Version sync v3.9.47 / versionCode 101, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:4[7-9]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.47';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.47';"));
  assert.ok(/versionCode\s*=\s*(?:10[1-9]|1[1-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.47"'));
  assert.ok(/"3\.9\.(?:4[7-9]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[7-9]|[5-9]\d|\d{3,})/.test(publishRelease));

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
