'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. cloud-metadata.js preserves HTTP .status and cloudTagRequest/googleThumbnail retry once after 401/403 token refresh', async () => {
  const cloudMetadata = require(path.join(ROOT, 'cloud-metadata.js'));

  // 1.1 cloud-metadata.js propagates HTTP 401 .status from makeRangeReader / loadReaderRangeAsync (FLAC path)
  await assert.rejects(
    cloudMetadata.readRemoteTags(
      null,
      { url: 'https://www.googleapis.com/drive/v3/files/f1?alt=media', size: 65536, name: 'Test.flac', format: 'flac' },
      { headers: { Authorization: 'Bearer expired' } },
      { fetch: async () => ({ status: 401, headers: { get: () => null }, body: { cancel: () => {} } }) }
    ),
    err => err && err.status === 401
  );

  // 1.2 cloud-metadata.js propagates HTTP 401 .status via jsmediatags FileReader path (MP3 path)
  function FakeReader(source) { this.source = source; }
  FakeReader.prototype.setFileReader = function (FR) { this.FR = FR; return this; };
  FakeReader.prototype.read = function (cb) {
    const reader = new this.FR(this.source);
    reader.loadRange([0, 127], { onSuccess: () => cb.onSuccess({ tags: {} }), onError: err => cb.onError(err) });
  };
  await assert.rejects(
    cloudMetadata.readRemoteTags(
      { Reader: FakeReader },
      { url: 'https://www.googleapis.com/drive/v3/files/f2?alt=media', size: 65536, name: 'Test.mp3', format: 'mp3' },
      {},
      { fetch: async () => ({ status: 401, headers: { get: () => null }, body: { cancel: () => {} } }) }
    ),
    err => err && err.status === 401
  );

  // 1.3 Extract cloudTagRequest & googleThumbnail from index.html
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function isCloudAuthHttpError(err) {');
  const end = html.indexOf('async function cloudImageDataUrl(', start);
  assert.ok(start !== -1 && end > start, 'cloudTagRequest & googleThumbnail must follow isCloudAuthHttpError');
  const blockSrc = html.slice(start, end);

  let gTokenCalls = [];
  let msTokenCalls = 0;
  let tagCalls = 0;
  let fetchCalls = 0;

  const sandbox = {
    window: { jsmediatags: {} },
    Date,
    String,
    Error,
    encodeURIComponent,
    state: { microsoftAccessToken: 'ms-old' },
    ensureGoogleToken: async force => {
      gTokenCalls.push(Boolean(force));
      return force ? 'g-fresh' : 'g-old';
    },
    getMicrosoftToken: async () => {
      msTokenCalls++;
      sandbox.state.microsoftAccessToken = 'ms-fresh';
      return 'ms-fresh';
    },
    graphGet: async (url, tok) => ({
      '@microsoft.graph.downloadUrl': tok === 'ms-fresh' ? 'https://sp/fresh-url' : 'https://sp/stale-url'
    }),
    cloudImageDataUrl: async () => 'data:image/jpeg;base64,thumbok',
    cloudMetadata: {
      readRemoteTags: async (_, src, opts) => {
        tagCalls++;
        if (src.url.includes('googleapis.com')) {
          if (opts.headers.Authorization === 'Bearer g-old') {
            const e = new Error('Byte ranges unavailable (HTTP 401)');
            e.status = 401;
            throw e;
          }
          return { title: 'Google Recovered' };
        }
        if (src.url === 'https://sp/stale-url') {
          const e = new Error('Byte ranges unavailable (HTTP 403)');
          e.status = 403;
          throw e;
        }
        return { title: 'OneDrive Recovered' };
      }
    },
    fetch: async (url, opts) => {
      fetchCalls++;
      if (url.includes('fields=thumbnailLink')) {
        if (opts && opts.headers && opts.headers.Authorization === 'Bearer g-old') {
          return { status: 401, ok: false };
        }
        return { status: 200, ok: true, json: async () => ({ thumbnailLink: 'https://lh3.example/cover.jpg' }) };
      }
      return { status: 200, ok: true, blob: async () => ({ size: 120, type: 'image/jpeg' }) };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    blockSrc +
      '\nthis.cloudTagRequest = cloudTagRequest;' +
      '\nthis.googleThumbnail = googleThumbnail;',
    sandbox
  );

  // Google Drive 401 -> refresh -> success
  const gTags = await sandbox.cloudTagRequest({ source: 'google', remoteId: 'g-1', size: 1000, name: 'a.flac', format: 'FLAC' });
  assert.equal(gTags.title, 'Google Recovered');
  assert.deepEqual(gTokenCalls, [false, true]);
  assert.equal(tagCalls, 2);

  // OneDrive 403 -> refresh -> success
  const odTrack = { source: 'onedrive', remoteId: 'od-1', size: 2000, name: 'b.flac', format: 'FLAC', downloadUrl: 'https://sp/stale-url', downloadUrlAt: 100 };
  const odTags = await sandbox.cloudTagRequest(odTrack);
  assert.equal(odTags.title, 'OneDrive Recovered');
  assert.equal(msTokenCalls, 1);
  assert.equal(odTrack.downloadUrl, '');
  assert.equal(odTrack.downloadUrlAt, 0);

  // googleThumbnail 401 -> refresh -> success
  const thumbDataUrl = await sandbox.googleThumbnail({ source: 'google', remoteId: 'g-thumb' });
  assert.equal(thumbDataUrl, 'data:image/jpeg;base64,thumbok');
  assert.equal(fetchCalls, 3);
});

test('2. queueCloudCatalogPersist batches enriched metadata writes and flushes cleanly on threshold, debounce, queue drain, and unload', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const qStart = html.indexOf('const pendingCloudCatalogPersistMap = new Map();');
  const qEnd = html.indexOf('function isCloudAuthHttpError(', qStart);
  assert.ok(qStart !== -1 && qEnd > qStart, 'Batched catalog persist queue must exist above runCloudMetadataQueue');
  const qSrc = html.slice(qStart, qEnd);

  const persistBatches = [];
  let pruneCalls = 0;
  const timers = [];
  let clearedCount = 0;

  const sandbox = {
    Map,
    Array,
    Promise,
    Set,
    Date,
    IS_LEGACY_ANDROID: false,
    CLOUD_METADATA_CONCURRENCY: 3,
    cloudMetadataPausedUntil: 0,
    cloudMetadataQueue: [],
    cloudMetadataQueued: new Set(),
    cloudMetadataActive: 0,
    state: { isPlaybackLoading: false },
    persistCloudCatalog: async (batch, opts) => {
      persistBatches.push({ ids: batch.map(t => t.id), skipPrune: Boolean(opts && opts.skipPrune) });
    },
    pruneCloudCatalog: async () => { pruneCalls++; },
    enrichCloudTrack: async () => {},
    console,
    setTimeout: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cancelled: false });
      return id;
    },
    clearTimeout: id => {
      clearedCount++;
      const t = timers.find(item => item.id === id);
      if (t) t.cancelled = true;
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    qSrc +
      '\nthis.queueCloudCatalogPersist = queueCloudCatalogPersist;' +
      '\nthis.flushQueuedCloudCatalogPersist = flushQueuedCloudCatalogPersist;',
    sandbox
  );

  // Enqueue 3 tracks (one duplicate) -> coalesced via debounce timer
  sandbox.queueCloudCatalogPersist({ id: 'google:1', source: 'google' });
  sandbox.queueCloudCatalogPersist({ id: 'google:1', source: 'google' });
  sandbox.queueCloudCatalogPersist({ id: 'onedrive:2', source: 'onedrive' });
  assert.equal(persistBatches.length, 0, 'Must coalesce below batch size threshold until debounce fires');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1500);
  await timers[0].fn();
  assert.deepEqual(persistBatches, [{ ids: ['google:1', 'onedrive:2'], skipPrune: true }]);

  // Reaching threshold (12) flushes immediately without waiting for timer
  for (let i = 1; i <= 12; i++) {
    sandbox.queueCloudCatalogPersist({ id: 'google:b' + i, source: 'google' });
  }
  assert.equal(persistBatches.length, 2);
  assert.equal(persistBatches[1].ids.length, 12);
  assert.equal(persistBatches[1].skipPrune, true);
  assert.ok(clearedCount >= 1);

  // Flush on queue drain (runPrune = true) runs skipPrune: false
  sandbox.queueCloudCatalogPersist({ id: 'google:tail', source: 'google' });
  await sandbox.flushQueuedCloudCatalogPersist(true);
  assert.deepEqual(persistBatches[2], { ids: ['google:tail'], skipPrune: false });

  // Empty flush with runPrune = true triggers pruneCloudCatalog directly
  await sandbox.flushQueuedCloudCatalogPersist(true);
  assert.equal(pruneCalls, 1);

  // Verify wiring in enrichCloudTrack & beforeunload
  const enrichStart = html.indexOf('async function enrichCloudTrack(track) {');
  const enrichEnd = html.indexOf('const dsdWorkerBaseUrl =', enrichStart);
  assert.ok(html.slice(enrichStart, enrichEnd).includes('queueCloudCatalogPersist(track)'));
  assert.ok(html.includes("flushQueuedCloudCatalogPersist(false)"));
});

test('3. ensureLocalTrackPlayableUrl recovers FileSystemFileHandle permissions on play and rapid-Next cleans stale DSD workers & blobs', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 3.1 FileSystemFileHandle permission recovery
  const fnStart = html.indexOf('async function ensureLocalTrackPlayableUrl(');
  const csStart = html.indexOf('function clearStalePreload() {');
  const csEnd = html.indexOf("window.addEventListener('beforeunload',", csStart);
  assert.ok(fnStart !== -1 && csStart > fnStart && csEnd > csStart);

  let permissionState = 'prompt';
  let requestCalls = 0;
  let getFileCalls = 0;
  const sharedHandle = {
    queryPermission: async () => permissionState,
    requestPermission: async () => { requestCalls++; permissionState = 'granted'; return 'granted'; },
    getFile: async () => { getFileCalls++; return { name: 'SideA.flac', size: 5000 }; }
  };
  const cue1 = { id: 'cue-1', source: 'local', isCue: true, isDsd: false, url: '', file: null, fileHandle: sharedHandle };
  const cue2 = { id: 'cue-2', source: 'local', isCue: true, isDsd: false, url: '', file: null, fileHandle: sharedHandle };

  let stopDsdCalls = 0;
  const sandbox = {
    URL: { createObjectURL: () => 'blob:healed-cue', revokeObjectURL: () => {} },
    location: { href: 'https://app.example/' },
    Boolean,
    String,
    standbyAudio: { pause: () => {}, removeAttribute: () => {}, load: () => {} },
    state: {
      objectUrls: new Set(),
      tracks: [cue1, cue2],
      preloadTrackId: 'cue-1',
      preloadGeneration: 1,
      preloadReadyUrl: 'blob:old',
      preloadBusyId: null
    },
    restoreLocalTrackUrlSync: tr => {
      if (!tr.url && tr.file) {
        tr.url = 'blob:healed-cue';
        sandbox.state.objectUrls.add(tr.url);
      }
      return tr.url;
    },
    stopPrefetchDsdSlice: () => { stopDsdCalls++; },
    releaseUnusedCloudUrl: () => {}
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(fnStart, csEnd) +
      '\nthis.ensureLocalTrackPlayableUrl = ensureLocalTrackPlayableUrl;' +
      '\nthis.clearStalePreload = clearStalePreload;',
    sandbox
  );

  // Background preload (no requestPermission) must NOT prompt when permission is 'prompt'
  assert.equal(await sandbox.ensureLocalTrackPlayableUrl(cue1), '');
  assert.equal(requestCalls, 0);
  assert.equal(getFileCalls, 0);

  // Interactive play ({ requestPermission: true }) requests read permission & heals sibling CUE tracks
  const healed = await sandbox.ensureLocalTrackPlayableUrl(cue1, { requestPermission: true });
  assert.equal(healed, 'blob:healed-cue');
  assert.equal(requestCalls, 1);
  assert.equal(getFileCalls, 1);
  assert.ok(cue2.file && cue2.file.name === 'SideA.flac', 'Sibling CUE track sharing fileHandle must receive reacquired file');

  // clearStalePreload stops stale DSD prefetch worker
  sandbox.clearStalePreload();
  assert.equal(stopDsdCalls, 1);

  // Verify playTrack passes { requestPermission: true }
  const ptStart = html.indexOf('async function playTrack(trackId) {');
  const ptEnd = html.indexOf('function stopDsdWorker(', ptStart);
  assert.ok(html.slice(ptStart, ptEnd).includes('ensureLocalTrackPlayableUrl(track, { requestPermission: true })'));

  // 3.2 preloadDsdNext stops mismatched worker and drops superseded cloud DSD Blob
  const dsdStart = html.indexOf('async function preloadDsdNext(next) {');
  const dsdEnd = html.indexOf('function stopPrefetchDsdSlice() {', dsdStart);
  assert.ok(dsdStart !== -1 && dsdEnd > dsdStart);
  const dsdSrc = html.slice(dsdStart, dsdEnd);

  let workerStopped = 0;
  let prefetchCalled = 0;
  const cloudDsdTrack = {
    id: 'google:dsd-next',
    source: 'google',
    isDsd: true,
    size: 180 * 1024 * 1024,
    file: null,
    load: async () => {
      cloudDsdTrack.file = { byteLength: 180 * 1024 * 1024 };
      // Simulate rapid Next press bumping preloadGeneration & changing preloadTrackId while downloading
      dsdSandbox.state.preloadGeneration++;
      dsdSandbox.state.preloadTrackId = 'google:dsd-after-next';
    }
  };
  const dsdSandbox = {
    String,
    Number,
    console,
    state: {
      currentId: 'cur-1',
      preloadGeneration: 1,
      preloadTrackId: 'google:dsd-old',
      preloadBusyId: null,
      preloadDsdSliceTrackId: 'google:dsd-old',
      fiioDapMode: false
    },
    IS_LEGACY_ANDROID: false,
    clearStalePreload: () => {},
    stopPrefetchDsdSlice: () => { workerStopped++; dsdSandbox.state.preloadDsdSliceTrackId = null; },
    prepareCloudTrackForPreload: async () => {},
    prefetchDsdFirstSlice: () => { prefetchCalled++; }
  };

  vm.createContext(dsdSandbox);
  vm.runInContext(dsdSrc + '\nthis.preloadDsdNext = preloadDsdNext;', dsdSandbox);

  await dsdSandbox.preloadDsdNext(cloudDsdTrack);
  assert.equal(workerStopped, 1, 'preloadDsdNext must terminate mismatched DSD slice worker before loading');
  assert.equal(prefetchCalled, 0, 'Superseded DSD load must not start stale slice decode');
  assert.equal(cloudDsdTrack.file, null, 'Superseded cloud DSD blob must be released from memory');
});

test('4. Version sync v3.9.49 / versionCode 103, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:49|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.49';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.49';"));
  assert.ok(/versionCode\s*=\s*(?:10[3-9]|1[1-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.49"'));
  assert.ok(/"3\.9\.(?:49|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:49|[5-9]\d|\d{3,})/.test(publishRelease));

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
