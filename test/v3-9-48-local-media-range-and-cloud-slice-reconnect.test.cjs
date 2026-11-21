'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. MainActivity.java unifies /local-media HTTP Range parsing and closes Bounded streams safely on seek/init errors', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  const prStart = java.indexOf('public static long[] parseByteRangeHeader(');
  const prEnd = java.indexOf('private WebResourceResponse handleLocalMediaStreaming(', prStart);
  assert.ok(prStart !== -1 && prEnd > prStart, 'parseByteRangeHeader helper must exist before handleLocalMediaStreaming');
  const prSrc = java.slice(prStart, prEnd);
  assert.ok(prSrc.includes('trimmed.regionMatches(true, 0, "bytes=", 0, 6)'), 'parseByteRangeHeader must accept case-insensitive bytes= prefix');
  assert.ok(prSrc.includes("spec.indexOf(',')"), 'parseByteRangeHeader must handle comma-separated multi-range headers safely');
  assert.ok(prSrc.includes('if (suffix <= 0) return new long[]{-1L, -1L, 0L};'), 'parseByteRangeHeader must reject non-positive suffix ranges');

  const hlmStart = prEnd;
  const scStart = java.indexOf('private WebResourceResponse streamContentUriResponse(', hlmStart);
  const scEnd = java.indexOf('public boolean isMediaKey(', scStart);
  assert.ok(scStart > hlmStart && scEnd > scStart);
  const hlmSrc = java.slice(hlmStart, scStart);
  const scSrc = java.slice(scStart, scEnd);

  assert.ok(hlmSrc.includes('if (fileLength <= 0)'), 'handleLocalMediaStreaming must guard empty 0-byte local files cleanly');
  assert.ok(hlmSrc.includes('long[] parsedRange = parseByteRangeHeader(rangeHeader, fileLength);'));
  assert.ok(scSrc.includes('long[] parsedRange = parseByteRangeHeader(rangeHeader, totalLength);'));
  assert.ok(scSrc.includes('catch (IOException openErr)'));
  assert.ok(scSrc.includes('catch (IOException streamErr)'));

  const bfsStart = java.indexOf('public static class BoundedFileInputStream extends InputStream {');
  const bcsStart = java.indexOf('public static class BoundedContentUriInputStream extends InputStream {', bfsStart);
  const bcsEnd = java.indexOf('public static String getAudioMimeType(', bcsStart);
  const bfsSrc = java.slice(bfsStart, bcsStart);
  const bcsSrc = java.slice(bcsStart, bcsEnd);

  assert.ok(bfsSrc.includes('private volatile boolean mClosed = false;'));
  assert.ok(bfsSrc.includes('public long skip(long n) throws IOException'));
  assert.ok(bfsSrc.includes('if (mClosed) return;'));
  assert.ok(bfsSrc.includes('catch (IOException seekErr) {\n                try { this.mRaf.close(); } catch (IOException ignored) {}\n                throw seekErr;\n            }'));

  assert.ok(bcsSrc.includes('private volatile boolean mClosed = false;'));
  assert.ok(bcsSrc.includes('public long skip(long n) throws IOException'));
  assert.ok(bcsSrc.includes('catch (IOException initErr)'));
  assert.ok(bcsSrc.includes('if (this.mFis != null) this.mFis.close();'));
});

test('2. purgeSliceCacheKeys and pruneOrphanedSliceCacheEntries remove deleted cloud slices while protecting active & other-source caches', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const library = require(path.join(ROOT, 'library-utils.js'));

  const pStart = html.indexOf('function purgeSliceCacheKeys(keys) {');
  const pEnd = html.indexOf('function clearCloudCatalog() {', pStart);
  assert.ok(pStart !== -1 && pEnd > pStart, 'purgeSliceCacheKeys and pruneOrphanedSliceCacheEntries must exist');
  const fnSrc = html.slice(pStart, pEnd);

  const sliceStoreMap = new Map([
    [JSON.stringify(['google', 'g-keep']), { key: JSON.stringify(['google', 'g-keep']), size: 100 }],
    [JSON.stringify(['google', 'g-orphan']), { key: JSON.stringify(['google', 'g-orphan']), size: 100 }],
    [JSON.stringify(['onedrive', 'od-keep']), { key: JSON.stringify(['onedrive', 'od-keep']), size: 100 }],
    [JSON.stringify(['onedrive', 'od-orphan']), { key: JSON.stringify(['onedrive', 'od-orphan']), size: 100 }],
    [JSON.stringify(['local', 'abc', 10, 500]), { key: JSON.stringify(['local', 'abc', 10, 500]), size: 100 }]
  ]);

  const sandbox = {
    library,
    Array,
    Set,
    String,
    Promise,
    state: {
      currentId: 'g-cur-id',
      preloadTrackId: 'od-pre-id',
      tracks: [
        { id: 'g-cur-id', remoteId: 'g-keep', source: 'google' },
        { id: 'od-pre-id', remoteId: 'od-keep', source: 'onedrive' }
      ]
    },
    sliceCacheTransaction: () => {
      const tx = {};
      const store = {
        getAll: () => {
          const req = {};
          queueMicrotask(() => {
            req.result = Array.from(sliceStoreMap.values());
            if (typeof req.onsuccess === 'function') req.onsuccess();
          });
          return req;
        },
        delete: key => {
          sliceStoreMap.delete(key);
          queueMicrotask(() => { if (typeof tx.oncomplete === 'function') tx.oncomplete(); });
        },
        transaction: tx
      };
      return store;
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    fnSrc +
      '\nthis.purgeSliceCacheKeys = purgeSliceCacheKeys;' +
      '\nthis.pruneOrphanedSliceCacheEntries = pruneOrphanedSliceCacheEntries;',
    sandbox
  );

  // Prune only 'google' orphans first
  const gRemoved = await sandbox.pruneOrphanedSliceCacheEntries('google');
  assert.equal(gRemoved, 1);
  assert.equal(sliceStoreMap.has(JSON.stringify(['google', 'g-orphan'])), false, 'Deleted Google slice should be purged');
  assert.equal(sliceStoreMap.has(JSON.stringify(['google', 'g-keep'])), true, 'Active Google slice must be kept');
  assert.equal(sliceStoreMap.has(JSON.stringify(['onedrive', 'od-orphan'])), true, 'OneDrive entries must not be touched during google-only prune');
  assert.equal(sliceStoreMap.has(JSON.stringify(['local', 'abc', 10, 500])), true, 'Non-cloud entries must never be purged');

  // Empty source safety: when no onedrive tracks exist in state.tracks, must return 0 without wiping cache
  const savedTracks = sandbox.state.tracks.slice();
  sandbox.state.tracks = [savedTracks[0]];
  assert.equal(await sandbox.pruneOrphanedSliceCacheEntries('onedrive'), 0);
  assert.equal(sliceStoreMap.has(JSON.stringify(['onedrive', 'od-orphan'])), true);

  // Restore both sources and prune onedrive orphans
  sandbox.state.tracks = savedTracks;
  const odRemoved = await sandbox.pruneOrphanedSliceCacheEntries('onedrive');
  assert.equal(odRemoved, 1);
  assert.equal(sliceStoreMap.has(JSON.stringify(['onedrive', 'od-orphan'])), false);
  assert.equal(sliceStoreMap.has(JSON.stringify(['onedrive', 'od-keep'])), true);

  // Verify purgeSliceCacheKeys direct cleanup
  sliceStoreMap.set('google:stale-direct', { key: 'google:stale-direct' });
  const directPurged = await sandbox.purgeSliceCacheKeys(['google:stale-direct']);
  assert.equal(directPurged, 1);
  assert.equal(sliceStoreMap.has('google:stale-direct'), false);

  // Verify wiring in pruneCloudCatalog, removeDeletedCloudTracks, loadGoogleFiles, and loadMicrosoftFiles
  const pcStart = html.indexOf('function pruneCloudCatalog() {');
  const pcEnd = html.indexOf('function purgeSliceCacheKeys(', pcStart);
  assert.ok(html.slice(pcStart, pcEnd).includes("purgeSliceCacheKeys(staleSliceKeys)"), 'pruneCloudCatalog must purge slices for evicted catalog tracks');

  const rmStart = html.indexOf('function removeDeletedCloudTracks(');
  const rmEnd = html.indexOf('async function loadGoogleFiles() {', rmStart);
  assert.ok(html.slice(rmStart, rmEnd).includes("invalidateCloudTrackContent(tr)"), 'removeDeletedCloudTracks must invalidate deleted slices');

  const gEnd = html.indexOf('async function fetchCloudFile(', rmEnd);
  assert.ok(html.slice(rmEnd, gEnd).includes("pruneOrphanedSliceCacheEntries('google')"));

  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  assert.ok(html.slice(msStart, msEnd).includes("pruneOrphanedSliceCacheEntries('onedrive')"));
});

test('3. scheduleOnlineCloudDeltaSync debounces reconnect flaps, enforces 45s cooldown, and skips while sync is active', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sStart = html.indexOf('const ONLINE_CLOUD_RESYNC_COOLDOWN_MS =');
  const sEnd = html.indexOf("window.addEventListener('online', () => {", sStart);
  assert.ok(sStart !== -1 && sEnd > sStart, 'scheduleOnlineCloudDeltaSync block must exist above online listener');
  const fnSrc = html.slice(sStart, sEnd);

  const onlineListenerSlice = html.slice(sEnd, sEnd + 600);
  assert.ok(onlineListenerSlice.includes('scheduleOnlineCloudDeltaSync()'), 'online event listener must invoke scheduleOnlineCloudDeltaSync()');

  let fakeNow = 1_700_000_000_000;
  let timers = [];
  let clearedCount = 0;
  let gSyncCalls = 0;
  let msSyncCalls = 0;

  const sandbox = {
    Math,
    Number,
    Boolean,
    console,
    Date: { now: () => fakeNow },
    navigator: { onLine: true },
    cloudSyncPromise: null,
    state: {
      googleToken: 'g-tok',
      googleExpiresAt: fakeNow + 600000,
      microsoftAccessToken: 'ms-tok',
      msAccount: null
    },
    loadGoogleFiles: async () => { gSyncCalls++; },
    loadMicrosoftFiles: async () => { msSyncCalls++; },
    restoreMicrosoftSession: async () => true,
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
  vm.runInContext(fnSrc + '\nthis.scheduleOnlineCloudDeltaSync = scheduleOnlineCloudDeltaSync;', sandbox);

  // Offline must skip
  sandbox.navigator.onLine = false;
  assert.equal(sandbox.scheduleOnlineCloudDeltaSync(2500), false);
  sandbox.navigator.onLine = true;

  // Rapid reconnect flaps coalesce into one timer
  assert.equal(sandbox.scheduleOnlineCloudDeltaSync(2500), true);
  assert.equal(sandbox.scheduleOnlineCloudDeltaSync(2500), true);
  assert.equal(clearedCount, 1);

  const activeTimer = timers.find(t => !t.cancelled);
  assert.ok(activeTimer && activeTimer.ms === 2500);
  activeTimer.fn();
  if (sandbox.cloudSyncPromise) await sandbox.cloudSyncPromise;
  assert.equal(gSyncCalls, 1);
  assert.equal(msSyncCalls, 1);

  // Cooldown blocks immediate re-trigger within 45s
  fakeNow += 10000;
  assert.equal(sandbox.scheduleOnlineCloudDeltaSync(2500), false);

  // After cooldown, an already in-flight cloudSyncPromise prevents overlap
  fakeNow += 50000;
  sandbox.cloudSyncPromise = Promise.resolve();
  assert.equal(sandbox.scheduleOnlineCloudDeltaSync(1000), true);
  const t2 = timers[timers.length - 1];
  await t2.fn();
  assert.equal(gSyncCalls, 1, 'Must not overlap an active cloudSyncPromise');
});

test('4. Version sync v3.9.48 / versionCode 102, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:4[89]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.48';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.48';"));
  assert.ok(/versionCode\s*=\s*(?:10[2-9]|1[1-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.48"'));
  assert.ok(/"3\.9\.(?:4[89]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[89]|[5-9]\d|\d{3,})/.test(publishRelease));

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
