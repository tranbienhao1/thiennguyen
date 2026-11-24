'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const library = require(path.join(ROOT, 'library-utils.js'));

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, 'Missing start marker: ' + startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, 'Missing end marker: ' + endMarker);
  return src.slice(s, e);
}

function extractFn(src, signature) {
  const s = src.indexOf(signature);
  assert.ok(s >= 0, 'Missing function signature: ' + signature);
  const brace = src.indexOf('{', s);
  let depth = 0;
  let inS = false;
  let inD = false;
  let inT = false;
  let esc = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (!inD && !inT && ch === "'") { inS = !inS; continue; }
    if (!inS && !inT && ch === '"') { inD = !inD; continue; }
    if (!inS && !inD && ch === '`') { inT = !inT; continue; }
    if (inS || inD || inT) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(s, i + 1);
    }
  }
  throw new Error('Unbalanced braces for: ' + signature);
}

describe('R3-1: IndexedDB & QuotaExceededError Resilience', () => {
  it('1. sliceCacheTransaction clears activeMainDbPromise on InvalidStateError & getCachedFirstSlice guards touch put', async () => {
    const sliceSection = sliceBetween(
      html,
      'let activeMainDbPromise = null;',
      'const RECENT_FOLDER_HANDLE_KEY ='
    ) + '\n' + sliceBetween(
      html,
      'async function getCachedFirstSlice(track, expectedMeta) {',
      'function persistCloudCatalog(tracks) {'
    );

    let touchReqRef = null;
    let touchTxRef = null;
    let openDbCalls = 0;
    const fakeEntry = {
      key: 'google:g1',
      blob: { size: 1024 },
      totalBytes: 5000,
      meta: null,
      savedAt: 100,
      lastAccessedAt: 100
    };
    let txModeRead = true;
    const sandbox = {
      Array, Set, Map, String, Number, Boolean, Object, Math, Date, Promise, Error, console,
      performance: { now: () => 10 },
      FIRST_SLICE_CACHE_STORE: 'firstSliceCache',
      CLOUD_CATALOG_STORE: 'cloudCatalog',
      CLOUD_CATALOG_VERSION: 5,
      IS_LEGACY_ANDROID: false,
      library: {
        FIRST_SLICE_CACHE_MAX_ENTRIES: 20,
        FIRST_SLICE_CACHE_MAX_BYTES: 20 * 1024 * 1024,
        FIRST_SLICE_BYTES: 1024 * 1024,
        historyTrackKey: t => (t ? t.source + ':' + t.remoteId : ''),
        sliceCacheMetaMatches: () => true,
        formatCacheTelemetry: () => 'HIT',
        getStorageEstimate: async () => ({ percent: 40, isLowSpace: false }),
        calculateAdaptiveCacheLimits: () => ({ maxEntries: 20, maxBytes: 20 * 1024 * 1024 })
      },
      indexedDB: { open: () => ({}) },
      openDatabase: async () => { openDbCalls++; return null; },
      state: {
        tracks: [],
        db: {
          objectStoreNames: { contains: () => true },
          transaction: (_storeName, mode) => {
            if (txModeRead && mode === 'readonly') {
              return {
                objectStore: () => ({
                  get: () => {
                    const req = { result: fakeEntry, onsuccess: null, onerror: null };
                    queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
                    return req;
                  }
                })
              };
            }
            const tx = { onerror: null, onabort: null, oncomplete: null };
            touchTxRef = tx;
            return {
              objectStore: () => ({
                transaction: tx,
                put: () => {
                  const req = { onerror: null, onsuccess: null };
                  touchReqRef = req;
                  return req;
                }
              })
            };
          },
          close: () => {}
        }
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(
      sliceSection +
      '\nthis.getActiveMainDbPromise = () => activeMainDbPromise; this.setActiveMainDbPromise = v => { activeMainDbPromise = v; };',
      sandbox
    );

    const blob = await sandbox.getCachedFirstSlice({ id: 'g1', source: 'google', remoteId: 'g1', size: 5000 }, null);
    assert.equal(blob.size, 1024);
    assert.ok(touchReqRef && typeof touchReqRef.onerror === 'function', 'touch put must attach req.onerror');
    assert.ok(touchTxRef && typeof touchTxRef.onerror === 'function' && typeof touchTxRef.onabort === 'function', 'touch tx must attach onerror and onabort');

    let prevented = false;
    touchReqRef.onerror({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);

    const stalePromise = Promise.resolve('stale');
    sandbox.setActiveMainDbPromise(stalePromise);
    vm.runInContext('var reopenTriggered = 0; openDatabase = async () => { reopenTriggered++; return null; }; this.__reopen = () => reopenTriggered;', sandbox);
    sandbox.state.db.transaction = () => {
      const err = new Error('The database connection is closing.');
      err.name = 'InvalidStateError';
      throw err;
    };
    assert.throws(() => sandbox.sliceCacheTransaction('readonly'), /closing/);
    assert.equal(sandbox.getActiveMainDbPromise(), null, 'sliceCacheTransaction must clear activeMainDbPromise on InvalidStateError');
    assert.equal(sandbox.state.db, null);
    assert.equal(sandbox.__reopen(), 1);
  });

  it('2. evictOldestFirstSlicesForQuota awaits tx.oncomplete, pruneSliceCache passes real storageEstimate & cacheFirstSlice escalates 0.5 -> 1.0', async () => {
    const sliceSection = sliceBetween(
      html,
      'let activeMainDbPromise = null;',
      'const RECENT_FOLDER_HANDLE_KEY ='
    ) + '\n' + sliceBetween(
      html,
      'async function getCachedFirstSlice(track, expectedMeta) {',
      'function persistCloudCatalog(tracks) {'
    );

    const rows = new Map();
    const tracks = [];
    for (let i = 0; i < 10; i++) {
      const tr = { id: 'g:' + i, source: 'google', remoteId: 'r' + i, firstSliceCached: true };
      tracks.push(tr);
      rows.set('google:r' + i, { key: 'google:r' + i, size: 500000, savedAt: 10 + i, lastAccessedAt: 10 + i });
    }
    const targetTrack = { id: 'g:target', source: 'google', remoteId: 'rtarget', firstSliceCached: false };
    tracks.push(targetTrack);

    let putAttempt = 0;
    let passedEstimate = undefined;
    let delayedComplete = false;
    const sandbox = {
      Array, Set, Map, String, Number, Boolean, Object, Math, Date, Promise, Error, console,
      setTimeout,
      performance: { now: () => 5 },
      FIRST_SLICE_CACHE_STORE: 'firstSliceCache',
      CLOUD_CATALOG_STORE: 'cloudCatalog',
      CLOUD_CATALOG_VERSION: 5,
      IS_LEGACY_ANDROID: false,
      bpCloudPreloadTrackId: 'g:2',
      indexedDB: { open: () => ({}) },
      library: {
        FIRST_SLICE_CACHE_MAX_ENTRIES: 20,
        FIRST_SLICE_CACHE_MAX_BYTES: 20 * 1024 * 1024,
        FIRST_SLICE_BYTES: 1024 * 1024,
        historyTrackKey: t => (t ? t.source + ':' + t.remoteId : ''),
        getStorageEstimate: async () => ({ percent: 91, isLowSpace: true }),
        calculateAdaptiveCacheLimits: est => {
          passedEstimate = est;
          return { maxEntries: 20, maxBytes: 20 * 1024 * 1024 };
        },
        computeLruCacheEviction: library.computeLruCacheEviction
      },
      state: {
        currentId: 'g:0',
        preloadTrackId: 'g:1',
        queueTrackIds: ['g:3'],
        tracks,
        fiioDapMode: false,
        db: {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            return {
              objectStore: () => ({
                transaction: tx,
                getAll: () => {
                  const req = { result: Array.from(rows.values()), onsuccess: null, onerror: null };
                  queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
                  return req;
                },
                delete: k => {
                  rows.delete(k);
                  setTimeout(() => {
                    delayedComplete = true;
                    if (tx.oncomplete) tx.oncomplete();
                  }, 15);
                },
                put: entry => {
                  putAttempt++;
                  const req = { onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    if (putAttempt <= 2) {
                      const err = new Error('QuotaExceededError');
                      err.name = 'QuotaExceededError';
                      req.error = err;
                      if (req.onerror) req.onerror();
                    } else {
                      rows.set(entry.key, entry);
                      if (req.onsuccess) req.onsuccess();
                    }
                  });
                  return req;
                }
              })
            };
          }
        }
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(sliceSection, sandbox);

    // 1. Direct evictOldestFirstSlicesForQuota waits for tx.oncomplete
    let resolvedEarly = false;
    const evictPromise = sandbox.evictOldestFirstSlicesForQuota(['google:r0'], 0.5).then(c => {
      resolvedEarly = !delayedComplete;
      return c;
    });
    const evictedCount = await evictPromise;
    assert.equal(resolvedEarly, false, 'evictOldestFirstSlicesForQuota must await tx.oncomplete');
    assert.equal(evictedCount, 5);

    // 2. Restore rows (10 entries: 4 pinned r0..r3 + 6 unpinned r4..r9) and test cacheFirstSlice escalating 0.5 -> 1.0
    rows.clear();
    for (let i = 0; i < 10; i++) {
      tracks[i].firstSliceCached = true;
      rows.set('google:r' + i, { key: 'google:r' + i, size: 500000, savedAt: 10 + i, lastAccessedAt: 10 + i });
    }
    putAttempt = 0;
    await sandbox.refreshStorageEstimate(true);
    const cachedOk = await sandbox.cacheFirstSlice(targetTrack, { size: 65536 }, 500000);
    assert.equal(cachedOk, true, 'cacheFirstSlice must escalate 0.5 -> 1.0 eviction on second QuotaExceededError');
    assert.equal(putAttempt, 3);
    assert.equal(rows.has('google:r0'), true, 'currentId must stay pinned');
    assert.equal(rows.has('google:r1'), true, 'preloadTrackId must stay pinned');
    assert.equal(rows.has('google:r2'), true, 'bpCloudPreloadTrackId must stay pinned');
    assert.equal(rows.has('google:r3'), true, 'queueTrackIds[0] must stay pinned');
    assert.equal(rows.has('google:r4'), false, 'unpinned r4 must be evicted');
    assert.equal(rows.has('google:r9'), false, 'unpinned r9 must be evicted on 1.0 escalation');
    assert.deepEqual(passedEstimate, { percent: 91, isLowSpace: true }, 'pruneSliceCache must pass lastStorageEstimate');
  });

  it('3. persistCloudCatalog handles onabort, cover-strip + slice eviction quota recovery, and saveCatalog attaches catch', async () => {
    const quotaFn = extractFn(html, 'function isSliceCacheQuotaError(error)');
    const persistFn = extractFn(html, 'function persistCloudCatalog(tracks)');
    const saveCatalogFn = extractFn(html, 'function saveCatalog()');

    // Verify saveCatalog guards rejection
    assert.ok(saveCatalogFn.includes('.catch('), 'saveCatalog must handle async rejection from persistCloudCatalog');

    const gTracks = [
      { id: 'google:1', source: 'google', remoteId: '1', cover: 'data:image/jpeg;base64,AAA' },
      { id: 'google:2', source: 'google', remoteId: '2', cover: 'data:image/jpeg;base64,BBB' }
    ];

    // Scenario A: QuotaExceededError resolved by cover-strip
    {
      const written = [];
      let txCount = 0;
      const sandbox = {
        Array, Set, Map, Object, Error, Promise,
        cloudCatalogResetting: false,
        library: {
          deduplicateCatalogCovers: arr => arr,
          historyTrackKey: t => t.id
        },
        serializableCloudTrack: t => Object.assign({}, t),
        isSliceCacheQuotaError: new Function('return ' + quotaFn)(),
        pruneCloudCatalog: async () => {},
        evictOldestFirstSlicesForQuota: async () => 0,
        catalogTransaction: () => {
          txCount++;
          const tx = { oncomplete: null, onerror: null, onabort: null };
          const batch = [];
          queueMicrotask(() => {
            if (txCount === 1) {
              const e = new Error('Quota exceeded');
              e.name = 'QuotaExceededError';
              tx.error = e;
              if (tx.onabort) tx.onabort();
            } else {
              written.push(...batch);
              if (tx.oncomplete) tx.oncomplete();
            }
          });
          return {
            transaction: tx,
            put: entry => batch.push(entry)
          };
        }
      };
      vm.createContext(sandbox);
      vm.runInContext(persistFn, sandbox);
      await sandbox.persistCloudCatalog(gTracks, { skipPrune: true });
      assert.equal(txCount, 2);
      assert.equal(written.length, 2);
      assert.equal(written[0].cover, null, 'Cover-stripped retry must null out cover');
      assert.equal(written[1].cover, null);
    }

    // Scenario B: Cover-strip still fails quota -> evicts firstSliceCache (0.5 -> 1.0) -> succeeds; Scenario C: all fail -> rejects cleanly
    {
      const evictFractions = [];
      let txCount = 0;
      let rejectOnAll = false;
      const sandbox = {
        Array, Set, Map, Object, Error, Promise,
        cloudCatalogResetting: false,
        state: { tracks: gTracks, currentId: 'google:1', queueTrackIds: [] },
        library: { deduplicateCatalogCovers: arr => arr, historyTrackKey: t => t.id },
        serializableCloudTrack: t => Object.assign({}, t),
        isSliceCacheQuotaError: new Function('return ' + quotaFn)(),
        pruneCloudCatalog: async () => {},
        evictOldestFirstSlicesForQuota: async (_pins, frac) => {
          evictFractions.push(frac);
          return 2;
        },
        catalogTransaction: () => {
          txCount++;
          const tx = { oncomplete: null, onerror: null, onabort: null };
          queueMicrotask(() => {
            if (rejectOnAll || txCount <= 3) {
              const e = new Error('QuotaExceededError');
              e.name = 'QuotaExceededError';
              tx.error = e;
              if (tx.onerror) tx.onerror();
            } else if (tx.oncomplete) {
              tx.oncomplete();
            }
          });
          return { transaction: tx, put: () => {} };
        }
      };
      vm.createContext(sandbox);
      vm.runInContext(persistFn, sandbox);
      await sandbox.persistCloudCatalog(gTracks, { skipPrune: true });
      assert.deepEqual(evictFractions, [0.5, 1.0]);

      rejectOnAll = true;
      await assert.rejects(
        sandbox.persistCloudCatalog(gTracks, { skipPrune: true }),
        err => err && err.name === 'QuotaExceededError'
      );
    }
  });

  it('4. pruneCloudCatalog isolates stale deletes (Tx 1) from cover-cap puts (Tx 2) when Tx 2 hits QuotaExceededError', async () => {
    const pruneFn = extractFn(html, 'function pruneCloudCatalog()');
    const coverData = size => 'data:image/jpeg;base64,' + 'x'.repeat(size);
    const rows = [
      { id: 'stale-old', savedAt: 1, cover: coverData(3 * 1024 * 1024) },
      { id: 'mid', savedAt: 2, cover: coverData(5 * 1024 * 1024) },
      { id: 'new', savedAt: 3, cover: coverData(4 * 1024 * 1024) }
    ];
    const origMax = library.MAX_CLOUD_CATALOG_ENTRIES;
    library.MAX_CLOUD_CATALOG_ENTRIES = 2;
    let txIndex = 0;
    const sandbox = {
      Set, Array, Error, Promise,
      library,
      purgeSliceCacheKeys: () => {},
      catalogTransaction: () => {
        txIndex++;
        const currentTxIndex = txIndex;
        const tx = { oncomplete: null, onerror: null, onabort: null };
        let scheduled = false;
        const pendingDeletes = [];
        const schedule = () => {
          if (scheduled) return;
          scheduled = true;
          setTimeout(() => {
            if (currentTxIndex === 1) {
              for (const did of pendingDeletes) {
                const idx = rows.findIndex(r => r.id === did);
                if (idx >= 0) rows.splice(idx, 1);
              }
              if (tx.oncomplete) tx.oncomplete();
            } else {
              // Simulate QuotaExceededError aborting Tx 2 (cover-cap puts)
              if (tx.onabort) tx.onabort();
            }
          }, 0);
        };
        return {
          transaction: tx,
          getAll: () => {
            const req = { result: rows.map(r => Object.assign({}, r)), onsuccess: null, onerror: null };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); schedule(); });
            return req;
          },
          delete: id => { pendingDeletes.push(id); schedule(); },
          put: () => { schedule(); }
        };
      }
    };
    try {
      vm.createContext(sandbox);
      vm.runInContext(pruneFn, sandbox);
      await sandbox.pruneCloudCatalog();
    } finally {
      library.MAX_CLOUD_CATALOG_ENTRIES = origMax;
    }
    assert.equal(txIndex, 2, 'Should isolate deletes into Tx 1 and puts into Tx 2');
    assert.equal(rows.some(r => r.id === 'stale-old'), false, 'Deleted stale entry must stay committed even when Tx 2 aborts');
    assert.equal(rows.length, 2);
  });

  it('5. library-utils computeLruCacheEviction protects pinned entries even when currentCount <= pinnedKeys.size, and defragmentCacheDatabase expires lastAccessedAt/savedAt', () => {
    const entries = [
      { key: 'pinned-1', size: 60000, lastAccessedAt: 10 },
      { key: 'pinned-2', size: 60000, lastAccessedAt: 20 },
      { key: 'unpinned-1', size: 10000, lastAccessedAt: 5 }
    ];
    const plan = library.computeLruCacheEviction(entries, 5, 50000, { pinnedKeys: ['pinned-1', 'pinned-2', 'missing-pin'] });
    assert.deepEqual(plan.keysToEvict, ['unpinned-1'], 'Pinned entries must never be evicted unless allowEvictPinned is set');

    const now = 1000 * 60 * 60 * 24 * 30;
    const defrag = library.defragmentCacheDatabase(
      [
        { key: 'google:g1', size: 5000, lastAccessedAt: now - 10 * 24 * 60 * 60 * 1000 },
        { key: 'google:g2', size: 5000, savedAt: now - 9 * 24 * 60 * 60 * 1000 },
        { key: 'google:g3', size: 5000, lastAccessedAt: now - 1000 }
      ],
      [
        { id: 'google:g1', source: 'google', remoteId: 'g1' },
        { id: 'google:g2', source: 'google', remoteId: 'g2' },
        { id: 'google:g3', source: 'google', remoteId: 'g3' }
      ],
      { now, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }
    );
    assert.deepEqual(defrag.orphanedKeys, ['google:g1', 'google:g2']);
    assert.equal(defrag.validCount, 1);
  });

  it('6. sw.js networkFirst prunes shell cache when cache.put throws QuotaExceededError', async () => {
    let prunedCalled = 0;
    const fakeCache = {
      put: async () => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      },
      keys: async () => [{ url: 'https://nocturne.local/index.html?stale=1' }, { url: 'https://nocturne.local/index.html' }],
      delete: async () => { prunedCalled++; return true; }
    };
    const sandbox = {
      URL, Set, Map, Promise, Boolean, String, Error,
      self: { location: { href: 'https://nocturne.local/', origin: 'https://nocturne.local' }, addEventListener: () => {} },
      caches: { open: async () => fakeCache, match: async () => null },
      fetch: async () => ({ ok: true, clone: () => ({ ok: true }) })
    };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);
    const res = await sandbox.networkFirst({ url: 'https://nocturne.local/index.html' });
    assert.equal(res.ok, true);
    assert.equal(prunedCalled, 1, 'networkFirst catch must call pruneShellCache on QuotaExceededError');
  });
});

describe('R3-2: Multi-Folder FileSystemDirectoryHandle, CUE Sheets & Android SAF Recovery', () => {
  it('1. Same-name folders persist unique folderKeys, survive clearRecentLocalFolderHandle, prompt upfront, warn on startup, and merge cross-folder CUE files', async () => {
    const folderSection = sliceBetween(
      html,
      "const RECENT_FOLDER_HANDLE_KEY = 'recent-local-folder';",
      'async function getCachedFirstSlice('
    );
    const pickerSection = sliceBetween(
      html,
      'async function collectAudioAndCoverFilesFromDirectoryHandle(',
      'let googleScriptPromise = null;'
    );

    const idbStore = new Map();
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({
          get: k => {
            const req = { result: idbStore.get(k), onsuccess: null, onerror: null };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
            return req;
          },
          put: v => {
            idbStore.set(v.id, v);
            const req = { result: v.id, onsuccess: null, onerror: null };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
            return req;
          },
          delete: k => {
            idbStore.delete(k);
            const req = { result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
            return req;
          }
        })
      })
    };

    const makeDirHandle = (name, filesMap) => {
      const h = {
        name,
        perm: 'granted',
        reqCount: 0,
        async isSameEntry(other) { return other === h; },
        async queryPermission() { return h.perm; },
        async requestPermission() { h.reqCount++; h.perm = 'granted'; return 'granted'; },
        async *values() {
          for (const [fname, content] of Object.entries(filesMap)) {
            yield {
              kind: 'file',
              name: fname,
              async getFile() { return { name: fname, size: content.length || 100 }; }
            };
          }
        }
      };
      return h;
    };

    const dirA = makeDirHandle('Music', { 'Album.cue': 'FILE "Track01.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00' });
    const dirB = makeDirHandle('Music', { 'Track01.flac': 'audio-bytes' });
    let pickedDir = dirA;
    const batches = [];
    const warnings = [];
    const els = {
      'reopen-folder': { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setAttribute: () => {}, removeAttribute: () => {} },
      'reopen-folder-label': {},
      'empty-reopen-folder': { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setAttribute: () => {}, removeAttribute: () => {} }
    };

    const sandbox = {
      Array, Set, Map, Object, String, Boolean, Number, Date, Math, Promise, Error, console,
      Object_defineProperty: Object.defineProperty,
      AUDIO_TYPES: /\.(flac|wav|mp3|dsf|dff)$/i,
      STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      FOLDER_HANDLES_STORE: 'folderHandles',
      window: { showDirectoryPicker: async () => pickedDir },
      document: { createElement: () => ({ webkitdirectory: true }) },
      $: id => els[id] || null,
      openDatabase: async () => db,
      sliceCacheRequest: req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }),
      addLocalFiles: async (files, opts) => { batches.push({ files, opts }); return { added: files.length, removed: 0 }; },
      pruneRemovedLocalFolderTracks: () => 0,
      renderTracks: () => {},
      toast: () => {},
      state: { tracks: [] }
    };
    vm.createContext(sandbox);
    vm.runInContext(
      folderSection + '\n' + pickerSection +
      '\nthis.setReopenFolderWarning = v => { __warnings.push(v); }; this.__warnings = [];' +
      '\nthis.savedRecords = () => savedLocalFolderRecords;',
      sandbox
    );
    sandbox.__warnings = warnings;
    // Re-bind setReopenFolderWarning override cleanly inside vm
    vm.runInContext('setReopenFolderWarning = v => __warnings.push(Boolean(v));', sandbox);

    // Pick two distinct folders both named "Music"
    pickedDir = dirA;
    await sandbox.pickFolder();
    pickedDir = dirB;
    await sandbox.pickFolder();

    const recs = sandbox.savedRecords();
    assert.equal(recs.length, 2, 'Two distinct folders with same name "Music" must both be stored');
    assert.notEqual(recs[0].folderKey, recs[1].folderKey, 'Same-name folders must get distinct folderKeys');
    assert.equal(batches[0].opts.folderRootKey, recs[1].folderKey);
    assert.equal(batches[1].opts.folderRootKey, recs[0].folderKey);

    // Startup with dirA='granted', dirB='prompt' must warn
    dirA.perm = 'granted';
    dirB.perm = 'prompt';
    await sandbox.restoreSavedLocalFolderOnStartup();
    assert.equal(warnings[warnings.length - 1], true, 'Startup must call setReopenFolderWarning(true) when any saved folder needs permission');

    // Interactive reopen requests permission on dirB upfront and passes unified batch with both folders' files
    dirA.perm = 'prompt';
    dirB.perm = 'prompt';
    batches.length = 0;
    const reopened = await sandbox.reopenSavedFolder({ silentIfGranted: false });
    assert.equal(reopened, true);
    assert.equal(dirA.reqCount, 1);
    assert.equal(dirB.reqCount, 1);
    assert.equal(batches.length, 1, 'Multi-folder reopen must pass unified files in one addLocalFiles batch for cross-folder CUE resolution');
    assert.equal(batches[0].opts.folderRootKeys.length, 2);
    assert.equal(batches[0].files.length, 2);

    // clearRecentLocalFolderHandle(dirA) removes ONLY dirA, preserving dirB
    await sandbox.clearRecentLocalFolderHandle(dirA);
    assert.equal(sandbox.savedRecords().length, 1);
    assert.equal(sandbox.savedRecords()[0].handle, dirB);
  });

  it('2. addLocalFiles + buildLocalCueSubTrack resolve cross-folder CUE, subpath Disc 1, replace standalone parent, skip dead single-file CUE, skip DSD createObjectURL, and dedup pickLocalFiles vs folder', async () => {
    const cueSection = sliceBetween(
      html,
      'function buildLocalCueSubTrack(ct, ctx) {',
      'function pruneRemovedLocalFolderTracks('
    );
    let urlSeq = 0;
    const createdForFiles = [];
    const state = {
      currentId: null,
      tracks: [
        {
          id: 'standalone-parent',
          source: 'local',
          isCue: false,
          isDsd: false,
          name: 'Symphony.flac',
          relativePath: 'Symphony.flac',
          size: 5000,
          url: 'blob:parent-1',
          cover: ''
        }
      ],
      objectUrls: new Set(['blob:parent-1']),
      albumCovers: new Map()
    };
    const sandbox = {
      Array, Set, Map, Object, String, Boolean, Number, Math, Promise, console,
      AUDIO_TYPES: /\.(flac|wav|mp3|dsf|dff)$/i,
      STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      library: {
        parseCueSheet: text => {
          if (text.includes('MISSING')) return [{ number: 1, title: 'Ghost', offset: 0, file: 'Missing.flac' }];
          if (text.includes('DSF')) return [{ number: 1, title: 'DsdTrack', offset: 0, file: 'Album.dsf' }];
          if (text.includes('SUBPATH')) {
            return [
              { number: 1, title: 'Disc1Track', offset: 0, file: 'Disc 1/01.flac' },
              { number: 2, title: 'Disc2Track', offset: 0, file: 'Disc 2/01.flac' }
            ];
          }
          return [
            { number: 1, title: 'Mov 1', offset: 0, duration: 100, file: 'Symphony.flac', hasNextInFile: true },
            { number: 2, title: 'Mov 2', offset: 100, duration: 120, file: 'Symphony.flac', hasNextInFile: false }
          ];
        },
        extractFolderArtCandidates: () => []
      },
      state,
      id: () => 'id-' + (++urlSeq),
      URL: {
        createObjectURL: f => {
          const u = 'blob:u-' + (++urlSeq);
          createdForFiles.push(f && f.name);
          return u;
        },
        revokeObjectURL: () => {}
      },
      readLocalTextFileAuto: async f => f._text,
      makeLocalTrack: async f => ({
        id: 'mk-' + f.name,
        source: 'local',
        name: f.name,
        title: f.name,
        artist: 'Art',
        album: 'Alb',
        format: /\.(dsf|dff)$/i.test(f.name) ? 'DSF' : 'FLAC',
        isDsd: /\.(dsf|dff)$/i.test(f.name),
        url: /\.(dsf|dff)$/i.test(f.name) ? '' : 'blob:mk-' + (++urlSeq),
        duration: 300,
        size: f.size || 1000
      }),
      restoreLocalTrackUrlSync: tr => tr.url,
      getTrackRating: () => {},
      syncAlbumCoversImmediate: () => {},
      propagateAndBroadcastCovers: () => {},
      renderTracks: () => {},
      toast: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(cueSection, sandbox);

    // 2a. Replace standalone parent + skip missing single-file CUE + skip createObjectURL for DSD CUE
    await sandbox.addLocalFiles([
      { name: 'Symphony.cue', relativePath: 'FolderA/Symphony.cue', _localFolderKey: 'dir:a', _text: 'SYMPHONY', size: 100 },
      { name: 'Dead.cue', relativePath: 'FolderA/Dead.cue', _localFolderKey: 'dir:a', _text: 'MISSING', size: 100 },
      { name: 'Dsd.cue', relativePath: 'FolderA/Dsd.cue', _localFolderKey: 'dir:a', _text: 'DSF', size: 100 },
      { name: 'Album.dsf', relativePath: 'FolderB/Album.dsf', _localFolderKey: 'dir:b', size: 9999 },
      { name: 'Sub.cue', relativePath: 'FolderA/Sub.cue', _localFolderKey: 'dir:a', _text: 'SUBPATH', size: 100 },
      { name: '01.flac', relativePath: 'Disc 1/01.flac', _localFolderKey: 'dir:b', size: 2001 },
      { name: '01.flac', relativePath: 'Disc 2/01.flac', _localFolderKey: 'dir:b', size: 2002 }
    ], { folderRootKeys: ['dir:a', 'dir:b'] });

    assert.equal(state.tracks.some(t => t.id === 'standalone-parent'), false, 'Standalone parent replaced by CUE must be removed from state.tracks');
    assert.equal(state.tracks.some(t => t.title === 'Ghost'), false, 'Single-file CUE with missing audio must not create dead virtual track');
    assert.equal(createdForFiles.includes('Album.dsf'), false, 'DSD CUE parent must never call URL.createObjectURL');
    const sub1 = state.tracks.find(t => t.title === 'Disc1Track');
    const sub2 = state.tracks.find(t => t.title === 'Disc2Track');
    assert.equal(sub1.size, 2001, 'Subpath Disc 1/01.flac must match Disc 1 candidate');
    assert.equal(sub2.size, 2002, 'Subpath Disc 2/01.flac must match Disc 2 candidate');

    // 2b. Rescanning same Symphony.cue with pickLocalFiles (no relativePath) deduplicates via cueAudioAliasKey
    const countBefore = state.tracks.length;
    await sandbox.addLocalFiles([
      { name: 'Symphony.cue', _text: 'SYMPHONY', size: 100 },
      { name: 'Symphony.flac', size: 5000 }
    ]);
    assert.equal(state.tracks.length, countBefore, 'pickLocalFiles vs folder scan must deduplicate CUE tracks in-place');
  });

  it('3. ensureLocalTrackPlayableUrl checks fileHandle.queryPermission before cached track.file and propagates Android SAF recovery across CUE siblings', async () => {
    const urlSection = sliceBetween(
      html,
      'function restoreLocalTrackUrlSync(track) {',
      'function clearStalePreload()'
    );
    const revoked = [];
    let perm = 'prompt';
    const handle = {
      queryPermission: async () => perm,
      requestPermission: async () => { perm = 'granted'; return 'granted'; },
      getFile: async () => ({ name: 'A.flac', size: 100 })
    };
    const trackWithStaleFile = {
      id: 'c1',
      source: 'local',
      isCue: true,
      file: { name: 'A.flac', size: 100 },
      fileHandle: handle,
      url: 'blob:stale-1'
    };
    const safCue1 = {
      id: 's1',
      source: 'local',
      isCue: true,
      uri: 'content://com.android.externalstorage.documents/tree/primary/document/1',
      path: '/storage/emulated/0/Music/Alb.flac',
      url: 'https://appassets.androidplatform.net/local-media?uri=x'
    };
    const safCue2 = {
      id: 's2',
      source: 'local',
      isCue: true,
      uri: safCue1.uri,
      path: safCue1.path,
      url: 'https://appassets.androidplatform.net/local-media?uri=x'
    };
    const sandbox = {
      Set, String, Boolean, encodeURIComponent,
      AbortController, setTimeout, clearTimeout,
      state: { tracks: [trackWithStaleFile, safCue1, safCue2], objectUrls: new Set(['blob:stale-1']) },
      URL: {
        createObjectURL: () => 'blob:fresh',
        revokeObjectURL: u => revoked.push(u)
      },
      window: { NocturneNative: { hasValidPersistedUriPermission: () => false } },
      fetch: async u => {
        if (String(u).includes('?uri=')) return { status: 403, headers: { get: () => 'SAF_PERMISSION_REVOKED' } };
        return { status: 200, headers: { get: () => '' } };
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(urlSection, sandbox);

    // Must NOT trust cached track.file when fileHandle.queryPermission === 'prompt'
    const resPrompt = await sandbox.ensureLocalTrackPlayableUrl(trackWithStaleFile, { requestPermission: false });
    assert.equal(resPrompt, '');
    assert.equal(trackWithStaleFile._localAccessError, 'permission_denied');
    assert.deepEqual(revoked, ['blob:stale-1']);

    // Android SAF fallback to ?path= must propagate to sibling safCue2
    const healedSaf = await sandbox.ensureLocalTrackPlayableUrl(safCue1);
    assert.ok(healedSaf.includes('/local-media?path='));
    assert.equal(safCue2.url, healedSaf, 'SAF path fallback recovery must propagate to sibling CUE tracks');
    assert.equal(safCue2._localAccessError, '');
  });

  it('4. MainActivity.java readLocalTextFile supports content:// URIs & expandFiioScannedCueSheets handles cf.uri + directory-suffix matching', () => {
    const javaFn = sliceBetween(
      mainJava,
      'public String readLocalTextFile(@Nullable String filePath)',
      'private static String extractFlacVorbisLyricsFromFile('
    );
    assert.ok(javaFn.includes('trimmed.startsWith("content://")'), 'readLocalTextFile must support content:// URIs');
    assert.ok(javaFn.includes('OpenableColumns.DISPLAY_NAME') && javaFn.includes('resolver.openInputStream(contentUri)'));

    const expandSection = sliceBetween(
      html,
      'function fiioCueHash(str) {',
      'function isFiioTrackRescanUnchanged('
    );
    const tracks = [
      { id: 'fiio_1', source: 'local', path: '/sdcard/Music/Box/Disc 1/01.flac', name: '01', duration: 200, format: 'FLAC' },
      { id: 'fiio_2', source: 'local', path: '/sdcard/Music/Box/Disc 2/01.flac', name: '01', duration: 200, format: 'FLAC' }
    ];
    const sandbox = {
      Array, Set, Map, String, Number, Boolean, Math, library,
      state: { tracks, currentId: null },
      window: {
        NocturneNative: {
          readLocalTextFile: p => {
            if (p.startsWith('content://')) {
              return 'FILE "Disc 2/01.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00';
            }
            return '';
          }
        }
      },
      restoreLocalTrackUrlSync: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(expandSection, sandbox);
    const added = sandbox.expandFiioScannedCueSheets([{ uri: 'content://saf/box.cue', name: 'box.cue' }]);
    assert.equal(added, 1, 'expandFiioScannedCueSheets must support cf.uri-only CUE descriptors');
    const cueTr = tracks.find(t => t.isCue);
    assert.equal(cueTr.path, '/sdcard/Music/Box/Disc 2/01.flac', 'Directory-suffix matching must pick Disc 2/01.flac over Disc 1/01.flac');
  });

  it('5. Regression (Bug #1): Stale cached track.file must NOT bypass permission_denied in ensureLocalTrackPlayableUrl, preloadNext, or playTrack (non-DSD & DSD)', async () => {
    const urlSection = sliceBetween(
      html,
      'function restoreLocalTrackUrlSync(track) {',
      'function clearStalePreload()'
    );
    const preloadFn = extractFn(html, 'async function preloadNext(force = false)');
    const playTrackSection = sliceBetween(
      html,
      'function abortPlayCleanup(track) {',
      'function stopDsdWorker(invalidate = true) {'
    );

    let permState = 'denied';
    let allowNotAllowed = false;
    let playTargetCalls = 0;
    let finishCalls = 0;
    let dsdPlayCalls = 0;
    let reopenWarnCalls = 0;
    let createdUrls = [];
    let toasts = [];

    const deniedHandle = {
      queryPermission: async () => allowNotAllowed ? 'granted' : permState,
      requestPermission: async () => allowNotAllowed ? 'granted' : permState,
      getFile: async () => {
        if (allowNotAllowed) {
          const err = new Error('Permission revoked');
          err.name = 'NotAllowedError';
          throw err;
        }
        return { name: 'Track.flac', size: 1024 };
      }
    };

    const cueSib1 = {
      id: 'cue-perm-1',
      source: 'local',
      isCue: true,
      isDsd: false,
      file: { name: 'Album.flac', size: 5000 },
      fileHandle: deniedHandle,
      url: ''
    };
    const cueSib2 = {
      id: 'cue-perm-2',
      source: 'local',
      isCue: true,
      isDsd: false,
      file: { name: 'Album.flac', size: 5000 },
      fileHandle: deniedHandle,
      url: 'blob:stale-sib'
    };
    const dsdTrack = {
      id: 'dsd-perm-1',
      source: 'local',
      isCue: false,
      isDsd: true,
      file: { name: 'Sacd.dsf', size: 9000 },
      fileHandle: deniedHandle,
      url: ''
    };

    const makeDeckEl = () => ({
      src: '',
      volume: 1,
      muted: false,
      defaultMuted: false,
      paused: true,
      error: null,
      readyState: 4,
      networkState: 1,
      dataset: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      removeAttribute: () => {},
      pause: () => {},
      load: () => {},
      play: async () => { playTargetCalls++; }
    });
    const deckAEl = makeDeckEl();
    const deckBEl = makeDeckEl();
    const gainStub = () => ({ gain: { value: 1, cancelScheduledValues: () => {}, setValueAtTime: () => {}, setTargetAtTime: () => {} } });

    const sandbox = {
      Array, Set, Map, String, Number, Boolean, Object, Math, Date, Promise, Error, console,
      encodeURIComponent, AbortController, setTimeout, clearTimeout,
      performance: { now: () => 100 },
      location: { href: 'https://nocturne.local/' },
      navigator: { onLine: true },
      window: {},
      $: () => ({ textContent: '', classList: { add: () => {}, remove: () => {} } }),
      URL: class extends URL {
        static createObjectURL(f) {
          const u = 'blob:recreated-' + (createdUrls.length + 1) + '-' + (f && f.name);
          createdUrls.push(u);
          return u;
        }
        static revokeObjectURL() {}
      },
      audio: deckAEl,
      standbyAudio: deckBEl,
      state: {
        currentId: 'other-id',
        previousTrackId: null,
        playGeneration: 0,
        preloadGeneration: 0,
        preloadTrackId: null,
        preloadReadyUrl: null,
        preloadBusyId: null,
        _bpPositionGuardToken: 0,
        _bpAwaitingStart: false,
        tracks: [cueSib1, cueSib2, dsdTrack],
        queueTrackIds: [],
        objectUrls: new Set(['blob:stale-sib']),
        context: { state: 'running', sampleRate: 44100, currentTime: 0, resume: async () => {} },
        deckA: { element: deckAEl, router: gainStub() },
        deckB: { element: deckBEl, router: gainStub() },
        activeDeck: null
      },
      queueIndex: () => 1,
      clearStalePreload: () => { sandbox.state.preloadTrackId = null; sandbox.state.preloadReadyUrl = null; },
      setupAudio: () => {},
      renderQueue: () => {},
      unlockAudioDecksOnGesture: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      isTrackRoutedToNativeBitPerfect: () => false,
      abortStaleFullAudioUpgrades: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {},
      isSilentUnlockSrc: () => false,
      isExternalNonAppAssetsHttpUrl: () => false,
      setReopenFolderWarning: v => { if (v) reopenWarnCalls++; },
      toast: msg => toasts.push(msg),
      finishPlaybackStart: () => { finishCalls++; },
      playDsdTrack: async () => { dsdPlayCalls++; }
    };
    sandbox.state.activeDeck = sandbox.state.deckA;
    vm.createContext(sandbox);
    vm.runInContext(urlSection + '\n' + preloadFn + '\n' + playTrackSection, sandbox);

    // 5a. preloadNext must NOT recreate blob URL from cached cueSib2.file when queryPermission === 'denied'
    await sandbox.preloadNext(true);
    assert.equal(cueSib2.file, null, 'Denied queryPermission must clear stale cached file on track');
    assert.equal(cueSib1.file, null, 'Denied queryPermission must clear stale cached file on CUE sibling');
    assert.equal(cueSib2.url, '', 'Denied queryPermission must clear stale blob url on CUE sibling');
    assert.equal(cueSib2._localAccessError, 'permission_denied');
    assert.equal(createdUrls.length, 0, 'preloadNext must NEVER recreate blob URL when permission is denied');

    // 5b. playTrack (non-DSD) even if track.file was populated in memory must NOT start playback when permission is denied
    cueSib1.file = { name: 'Album.flac', size: 5000 };
    await sandbox.playTrack('cue-perm-1');
    assert.equal(cueSib1.file, null);
    assert.equal(cueSib1._localAccessError, 'permission_denied');
    assert.equal(createdUrls.length, 0, 'playTrack must NEVER recreate blob URL when permission is denied');
    assert.equal(playTargetCalls, 0, 'target.play() must NOT be called when permission is denied');
    assert.equal(finishCalls, 0, 'finishPlaybackStart must NOT be called when permission is denied');
    assert.ok(reopenWarnCalls >= 1, 'playTrack must trigger setReopenFolderWarning(true) on permission_denied');

    // 5c. NotAllowedError inside getFile() also clears track.file + sibling file and blocks playDsdTrack for DSD
    allowNotAllowed = true;
    dsdTrack.file = null;
    await sandbox.playTrack('dsd-perm-1');
    assert.equal(dsdTrack._localAccessError, 'permission_denied');
    assert.equal(dsdPlayCalls, 0, 'playDsdTrack must NOT be called on NotAllowedError');
    allowNotAllowed = false;
    dsdTrack.file = { name: 'Sacd.dsf', size: 9000 };
    await sandbox.playTrack('dsd-perm-1');
    assert.equal(dsdTrack.file, null, 'DSD cached track.file must be cleared when queryPermission !== granted');
    assert.equal(dsdPlayCalls, 0, 'playDsdTrack must NOT be called when permission is denied');
  });

  it('6. Regression (Bugs #2, #3, #4 & Reviewer 1): Multi-folder flat root .lrc, same-named root .cue isolation, same-folder priority, and pickLocalFiles parent dedup', async () => {
    const cueSection = sliceBetween(
      html,
      'function normalizeLocalLrcKey(rawPath) {',
      'function pruneRemovedLocalFolderTracks('
    );

    let seq = 0;
    const state = { currentId: null, tracks: [], objectUrls: new Set(), albumCovers: new Map() };
    const sandbox = {
      Array, Set, Map, Object, String, Boolean, Number, Math, Promise, console,
      AUDIO_TYPES: /\.(flac|wav|mp3|dsf|dff)$/i,
      STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      library: {
        parseCueSheet: text => {
          if (text === 'CUE_A') return [{ number: 1, title: 'Root Song', offset: 0, duration: 180, file: 'Album.flac', hasNextInFile: false }];
          if (text === 'CUE_B') return [{ number: 1, title: 'Folder B Track', offset: 0, duration: 200, file: 'Album.flac', hasNextInFile: false }];
          if (text === 'CUE_CROSS') return [{ number: 1, title: 'Cross Track', offset: 0, duration: 150, file: 'Cross.flac', hasNextInFile: false }];
          return [
            { number: 1, title: 'Part 1', offset: 0, duration: 100, file: 'Standalone.flac', hasNextInFile: true },
            { number: 2, title: 'Part 2', offset: 100, duration: 100, file: 'Standalone.flac', hasNextInFile: false }
          ];
        },
        extractFolderArtCandidates: () => []
      },
      state,
      id: () => 'id-' + (++seq),
      URL: { createObjectURL: f => 'blob:u-' + (++seq) + '-' + f.name, revokeObjectURL: () => {} },
      readLocalTextFileAuto: async f => f._text,
      makeLocalTrack: async f => ({
        id: 'mk-' + (++seq),
        source: 'local',
        name: f.name,
        title: f.title || f.name.replace(/\.[^.]+$/, ''),
        artist: 'Art',
        album: 'Alb',
        format: 'FLAC',
        isDsd: false,
        url: 'blob:mk-' + seq + '-' + f.name,
        duration: 240,
        size: f.size || 1000
      }),
      restoreLocalTrackUrlSync: tr => tr.url,
      getTrackRating: () => {},
      syncAlbumCoversImmediate: () => {},
      propagateAndBroadcastCovers: () => {},
      renderTracks: () => {},
      toast: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(cueSection, sandbox);

    // 6a. Bug #2 + #3 + Reviewer 1: Multi-folder scan with flat root .cue, flat root .lrc, same-named root Album.flac (Folder B listed BEFORE Folder A), and cross-folder CUE .lrc
    await sandbox.addLocalFiles([
      { name: 'Album.cue', _localFolderKey: 'dir:b', _text: 'CUE_B', size: 100 },
      { name: 'Album.flac', _localFolderKey: 'dir:b', size: 2222 },
      { name: 'Album.cue', _localFolderKey: 'dir:a', _text: 'CUE_A', size: 100 },
      { name: 'Album.flac', _localFolderKey: 'dir:a', size: 1111 },
      { name: '01 - Root Song.lrc', _localFolderKey: 'dir:a', _text: '[00:01.00]Lyrics A', size: 40 },
      { name: '01 - Plain Song.flac', _localFolderKey: 'dir:a', size: 3333 },
      { name: '01 - Plain Song.lrc', _localFolderKey: 'dir:a', _text: '[00:02.00]Plain A', size: 40 },
      { name: 'Cross.cue', _localFolderKey: 'dir:a', _text: 'CUE_CROSS', size: 100 },
      { name: 'Cross.flac', _localFolderKey: 'dir:b', size: 4444 },
      { name: '01 - Cross Track.lrc', _localFolderKey: 'dir:b', _text: '[00:03.00]Cross B', size: 40 },
      { name: 'Root Song.flac', _localFolderKey: 'dir:b', size: 5555 }
    ], { folderRootKeys: ['dir:a', 'dir:b'] });

    const trackA = state.tracks.find(t => t.isCue && t.title === 'Root Song');
    const trackB = state.tracks.find(t => t.isCue && t.title === 'Folder B Track');
    const plainA = state.tracks.find(t => !t.isCue && t.name === '01 - Plain Song.flac');
    const crossTr = state.tracks.find(t => t.isCue && t.title === 'Cross Track');
    const plainB = state.tracks.find(t => !t.isCue && t.name === 'Root Song.flac');

    assert.ok(trackA && trackB, 'Same-named root CUE sheets across dir:a and dir:b must produce 2 distinct CUE tracks');
    assert.equal(trackA.localFolderKey, 'dir:a');
    assert.equal(trackA.size, 1111, 'Reviewer 1: dir:a CUE must prioritize same-folder dir:a Album.flac (1111) over dir:b (2222)');
    assert.equal(trackB.localFolderKey, 'dir:b');
    assert.equal(trackB.size, 2222, 'dir:b CUE must match dir:b Album.flac (2222)');
    assert.equal(trackA.lyricsText, '[00:01.00]Lyrics A', 'Bug #2: Flat root CUE track in multi-folder batch must match dir:a::01 - root song.lrc');
    assert.equal(plainA.lyricsText, '[00:02.00]Plain A', 'Bug #2: Flat root non-CUE track in multi-folder batch must match dir:a::01 - plain song.lrc');
    assert.equal(crossTr.lyricsText, '[00:03.00]Cross B', 'Bug #2: Cross-folder CUE must fall back to matchedAudioFile folder dir:b for .lrc');
    assert.equal(plainB.lyricsText || '', '', 'dir:b flat root track must NOT receive dir:a .lrc');

    // Rescanning same multi-folder batch must update both root CUEs in place without collapsing or duplicating
    const lenAfterFirst = state.tracks.length;
    await sandbox.addLocalFiles([
      { name: 'Album.cue', _localFolderKey: 'dir:a', _text: 'CUE_A', size: 100 },
      { name: 'Album.flac', _localFolderKey: 'dir:a', size: 1111 },
      { name: 'Album.cue', _localFolderKey: 'dir:b', _text: 'CUE_B', size: 100 },
      { name: 'Album.flac', _localFolderKey: 'dir:b', size: 2222 }
    ], { folderRootKeys: ['dir:a', 'dir:b'] });
    assert.equal(state.tracks.length, lenAfterFirst, 'Rescanning two same-named root CUEs must keep count unchanged');

    // 6b. Bug #4: pickLocalFiles() standalone Standalone.flac followed by pickLocalFiles() Standalone.cue + Standalone.flac replaces standalone parent cleanly
    state.tracks.length = 0;
    await sandbox.addLocalFiles([{ name: 'Standalone.flac', size: 7777 }]);
    assert.equal(state.tracks.filter(t => !t.isCue).length, 1);

    await sandbox.addLocalFiles([
      { name: 'Standalone.cue', _text: 'CUE_STANDALONE', size: 120 },
      { name: 'Standalone.flac', size: 7777 }
    ]);
    assert.equal(state.tracks.filter(t => !t.isCue).length, 0, 'Bug #4: Pre-existing standalone parent must be removed when pickLocalFiles() imports CUE + audio');
    assert.equal(state.tracks.filter(t => t.isCue).length, 2, 'Two CUE virtual tracks must replace the standalone parent');
  });

  it('7. Regression (Bug #4b): pickLocalFiles() CUE+audio preserves managed-folder tracks while removing unkeyed standalone parents, and preserves .cue-only cross-folder resolution', async () => {
    const cueSection = sliceBetween(
      html,
      'function normalizeLocalLrcKey(rawPath) {',
      'function pruneRemovedLocalFolderTracks('
    );

    let seq = 0;
    const state = { currentId: null, tracks: [], objectUrls: new Set(), albumCovers: new Map() };
    const sandbox = {
      Array, Set, Map, Object, String, Boolean, Number, Math, Promise, console,
      AUDIO_TYPES: /\.(flac|wav|mp3|dsf|dff)$/i,
      STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      library: {
        parseCueSheet: () => [
          { number: 1, title: 'Track 1', offset: 0, duration: 100, file: 'Album.flac', hasNextInFile: true },
          { number: 2, title: 'Track 2', offset: 100, duration: 100, file: 'Album.flac', hasNextInFile: false }
        ],
        extractFolderArtCandidates: () => []
      },
      state,
      id: () => 'id-' + (++seq),
      URL: { createObjectURL: f => 'blob:u-' + (++seq) + '-' + f.name, revokeObjectURL: () => {} },
      readLocalTextFileAuto: async f => f._text,
      makeLocalTrack: async f => ({
        id: 'mk-' + (++seq),
        source: 'local',
        name: f.name,
        title: f.title || f.name.replace(/\.[^.]+$/, ''),
        artist: 'Art',
        album: 'Alb',
        format: 'FLAC',
        isDsd: false,
        url: 'blob:mk-' + seq + '-' + f.name,
        duration: 200,
        size: f.size || 1000
      }),
      restoreLocalTrackUrlSync: tr => tr.url,
      getTrackRating: () => {},
      syncAlbumCoversImmediate: () => {},
      propagateAndBroadcastCovers: () => {},
      renderTracks: () => {},
      toast: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(cueSection, sandbox);

    // 7a. Both dir:b Album.flac (7777) AND unkeyed standalone Album.flac (5555) exist, then pickLocalFiles() imports Album.cue + Album.flac (5555)
    await sandbox.addLocalFiles([{ name: 'Album.flac', _localFolderKey: 'dir:b', size: 7777 }], { folderRootKey: 'dir:b' });
    await sandbox.addLocalFiles([{ name: 'Album.flac', size: 5555 }]);
    assert.equal(state.tracks.filter(t => !t.isCue).length, 2);

    await sandbox.addLocalFiles([
      { name: 'Album.cue', _text: 'CUE_PICK', size: 120 },
      { name: 'Album.flac', size: 5555 }
    ]);

    const nonCueAfter7a = state.tracks.filter(t => !t.isCue);
    const cueAfter7a = state.tracks.filter(t => t.isCue);
    assert.equal(nonCueAfter7a.length, 1, 'Bug #4b: Only unkeyed standalone Album.flac must be removed; dir:b track must stay intact');
    assert.equal(nonCueAfter7a[0].localFolderKey, 'dir:b');
    assert.equal(nonCueAfter7a[0].size, 7777);
    assert.equal(cueAfter7a.length, 2);
    assert.equal(cueAfter7a[0].size, 5555);

    // 7b. Only dir:b Album.flac (7777) exists, then pickLocalFiles() imports Album.cue + Album.flac (5555)
    state.tracks.length = 0;
    await sandbox.addLocalFiles([{ name: 'Album.flac', _localFolderKey: 'dir:b', size: 7777 }], { folderRootKey: 'dir:b' });
    await sandbox.addLocalFiles([
      { name: 'Album.cue', _text: 'CUE_PICK_ONLY_DIRB', size: 120 },
      { name: 'Album.flac', size: 5555 }
    ]);
    const nonCueAfter7b = state.tracks.filter(t => !t.isCue);
    const cueAfter7b = state.tracks.filter(t => t.isCue);
    assert.equal(nonCueAfter7b.length, 1, 'Bug #4b: dir:b Album.flac (7777) must NOT be deleted when pickLocalFiles() imports Album.cue + Album.flac (5555)');
    assert.equal(nonCueAfter7b[0].localFolderKey, 'dir:b');
    assert.equal(nonCueAfter7b[0].size, 7777);
    assert.equal(cueAfter7b.length, 2);

    // 7c. .cue opened alone via pickLocalFiles() (!matchedAudioFile) must still resolve cross-folder against dir:b Album.flac (7777)
    state.tracks.length = 0;
    await sandbox.addLocalFiles([{ name: 'Album.flac', _localFolderKey: 'dir:b', size: 7777 }], { folderRootKey: 'dir:b' });
    await sandbox.addLocalFiles([
      { name: 'Album.cue', _text: 'CUE_ALONE', size: 120 }
    ]);
    const cueAfter7c = state.tracks.filter(t => t.isCue);
    assert.equal(cueAfter7c.length, 2, 'Cross-folder .cue-only resolution via pickLocalFiles() must remain intact');
    assert.equal(cueAfter7c[0].size, 7777);
  });
});

describe('R3-3: ObjectURL Lifecycle & CUE Playback Boundaries', () => {
  it('1. syncAlbumCoversImmediate & folderCoverByDir revoke replaced/evicted/unused blob covers', () => {
    const coverSection = sliceBetween(
      html,
      'function releaseOrphanedCoverBlobUrl(blobUrl, keepUrl) {',
      'function broadcastCoverUpdate('
    );
    const revoked = [];
    const state = {
      fiioDapMode: true,
      tracks: [{ id: 't-keep', artist: 'Keep', album: 'KeepAlb', cover: 'blob:keep-in-track' }],
      albumCovers: new Map(),
      objectUrls: new Set(['blob:old-rep', 'blob:evict-1', 'blob:keep-in-track'])
    };
    for (let i = 0; i < 180; i++) {
      const val = i === 0 ? 'blob:evict-1' : (i === 1 ? 'blob:keep-in-track' : 'https://cdn/' + i);
      state.albumCovers.set('art' + i + ':::alb' + i, val);
    }
    state.albumCovers.set('target:::alb', 'blob:old-rep');

    const sandbox = {
      Array, Set, Map, String,
      window: {},
      IS_LEGACY_ANDROID: false,
      URL: { revokeObjectURL: u => revoked.push(u) },
      library: { buildAlbumKey: t => (t.artist + ':::' + t.album).toLowerCase() },
      state,
      saveAlbumCoversCache: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(coverSection, sandbox);

    sandbox.syncAlbumCoversImmediate('data:image/jpeg;base64,' + 'A'.repeat(200), { id: 't-new', artist: 'Target', album: 'Alb' });
    assert.equal(revoked.includes('blob:old-rep'), true, 'Replaced unreferenced blob cover must be revoked');
    assert.equal(revoked.includes('blob:evict-1'), true, 'Evicted unreferenced blob cover must be revoked');
    assert.equal(revoked.includes('blob:keep-in-track'), false, 'Blob cover still referenced by a track must NOT be revoked');
  });

  it('2. CUE rescan shares a single blob URL across all N existing CUE siblings and prunes unused folderCoverByDir', async () => {
    const cueSection = sliceBetween(
      html,
      'function buildLocalCueSubTrack(ct, ctx) {',
      'function pruneRemovedLocalFolderTracks('
    );
    let createdCount = 0;
    const revoked = [];
    const state = {
      currentId: null,
      tracks: [
        { id: 'c1', source: 'local', isCue: true, cueFile: 'Alb.cue', relativePath: 'Alb/Alb.cue', cueDedupKey: 'Alb/Alb.cue::cue::1-0', url: '', cover: 'https://existing' },
        { id: 'c2', source: 'local', isCue: true, cueFile: 'Alb.cue', relativePath: 'Alb/Alb.cue', cueDedupKey: 'Alb/Alb.cue::cue::2-10000', url: '', cover: 'https://existing' },
        { id: 'c3', source: 'local', isCue: true, cueFile: 'Alb.cue', relativePath: 'Alb/Alb.cue', cueDedupKey: 'Alb/Alb.cue::cue::3-20000', url: '', cover: 'https://existing' }
      ],
      objectUrls: new Set(),
      albumCovers: new Map()
    };
    const sandbox = {
      Array, Set, Map, Object, String, Boolean, Number, Math, Promise, console,
      AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      STREAM_AUDIO_TYPES: /\.(flac|wav|mp3)$/i,
      library: {
        parseCueSheet: () => [
          { number: 1, title: 'T1', offset: 0, duration: 100, file: 'Alb.flac', hasNextInFile: true },
          { number: 2, title: 'T2', offset: 100, duration: 100, file: 'Alb.flac', hasNextInFile: true },
          { number: 3, title: 'T3', offset: 200, duration: 100, file: 'Alb.flac', hasNextInFile: false }
        ],
        extractFolderArtCandidates: files => files.filter(f => /\.jpg$/i.test(f.name)).map(f => ({ file: f, relativePath: f.relativePath }))
      },
      state,
      id: () => 'x',
      URL: {
        createObjectURL: f => 'blob:shared-' + (++createdCount) + '-' + (f && f.name),
        revokeObjectURL: u => revoked.push(u)
      },
      readLocalTextFileAuto: async () => 'CUE',
      makeLocalTrack: async () => { throw new Error('Should skip makeLocalTrack on full CUE rescan'); },
      restoreLocalTrackUrlSync: tr => {
        if (!tr.url && tr.file) {
          tr.url = sandbox.URL.createObjectURL(tr.file);
          state.objectUrls.add(tr.url);
        }
        return tr.url;
      },
      getTrackRating: () => {},
      syncAlbumCoversImmediate: () => {},
      propagateAndBroadcastCovers: () => {},
      renderTracks: () => {},
      toast: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(cueSection, sandbox);

    await sandbox.addLocalFiles([
      { name: 'cover.jpg', relativePath: 'Alb/cover.jpg', size: 100 },
      { name: 'Alb.cue', relativePath: 'Alb/Alb.cue', size: 50 },
      { name: 'Alb.flac', relativePath: 'Alb/Alb.flac', size: 50000 }
    ]);

    assert.equal(state.tracks[0].url, state.tracks[1].url);
    assert.equal(state.tracks[1].url, state.tracks[2].url);
    const audioUrls = Array.from(state.objectUrls).filter(u => u.includes('Alb.flac'));
    assert.equal(audioUrls.length, 1, 'CUE rescan must create only 1 shared blob URL for all 3 siblings');
    assert.equal(revoked.some(u => u.includes('cover.jpg')), true, 'Unused folderCoverByDir blob URL must be revoked');
  });

  it('3. resumeFullAudioFromSlice, retrySlicePlaybackFromFullAudio, and playTrack abort cleanup revoke unused blob URLs without false revocation', async () => {
    // 3a. resumeFullAudioFromSlice revokes oldSliceUrl and updates track.url
    const resumeFn = extractFn(html, 'function resumeFullAudioFromSlice(track, position)');
    const revoked = [];
    const element = { src: 'blob:slice-1', paused: false, duration: 200, currentTime: 10, addEventListener: () => {}, play: async () => {} };
    const track = { id: 't1', url: 'blob:slice-1', fullAudioUrl: 'blob:full-1', firstSlicePlayback: true };
    const sandboxResume = {
      Number, Math,
      URL: class extends URL { static revokeObjectURL(u) { revoked.push(u); } },
      location: { href: 'https://nocturne.local/' },
      setTimeout, clearTimeout,
      element, audio: element, standbyAudio: { src: '' },
      state: { playGeneration: 1, currentId: 't1', objectUrls: new Set(['blob:slice-1', 'blob:full-1']) }
    };
    vm.createContext(sandboxResume);
    vm.runInContext(resumeFn, sandboxResume);
    sandboxResume.resumeFullAudioFromSlice(track, 10);
    assert.equal(track.url, 'blob:full-1');
    assert.deepEqual(revoked, ['blob:slice-1']);

    // 3b. retrySlicePlaybackFromFullAudio checks bpGuardToken post-await and revokes oldSliceUrl on success
    const retryFn = extractFn(html, 'async function retrySlicePlaybackFromFullAudio(track, generation, target, previousTrack)');
    const retryRevoked = [];
    let guardResolve = null;
    const retryState = { playGeneration: 5, _bpPositionGuardToken: 10, objectUrls: new Set(['blob:retry-slice', 'blob:retry-full']) };
    const retrySandbox = {
      URL: class extends URL { static revokeObjectURL(u) { retryRevoked.push(u); } },
      location: { href: 'https://nocturne.local/' },
      audio: { src: '' }, standbyAudio: { src: '' },
      state: retryState,
      finishPlaybackStart: () => true,
      console: { warn: () => {} }
    };
    vm.createContext(retrySandbox);
    vm.runInContext(retryFn, retrySandbox);

    const raceTrack = { id: 'r1', url: 'blob:retry-slice', fullAudioPromise: new Promise(r => { guardResolve = r; }) };
    const racePromise = retrySandbox.retrySlicePlaybackFromFullAudio(raceTrack, 5, { src: '', load: () => {}, play: async () => {} }, null);
    retryState._bpPositionGuardToken = 11;
    guardResolve('blob:retry-full');
    assert.equal(await racePromise, false, 'retrySlicePlaybackFromFullAudio must abort when bpGuardToken changes');

    const okTrack = { id: 'r2', url: 'blob:retry-slice', fullAudioUrl: 'blob:retry-full', firstSlicePlayback: true };
    const okTarget = { src: '', load: () => {}, play: async () => {} };
    const okRes = await retrySandbox.retrySlicePlaybackFromFullAudio(okTrack, 5, okTarget, null);
    assert.equal(okRes, true);
    assert.equal(okTrack.url, 'blob:retry-full');
    assert.deepEqual(retryRevoked, ['blob:retry-slice']);

    // 3c. abortPlayCleanup revokes when superseded, skips when track.id === state.currentId
    const abortFn = extractFn(html, 'function abortPlayCleanup(track)');
    const abortCalls = [];
    const abortSandbox = {
      state: { currentId: 'active-1' },
      releaseUnusedCloudUrl: t => abortCalls.push('cloud:' + t.id),
      releaseUnusedLocalUrl: t => abortCalls.push('local:' + t.id)
    };
    vm.createContext(abortSandbox);
    vm.runInContext(abortFn, abortSandbox);
    abortSandbox.abortPlayCleanup({ id: 'active-1' });
    assert.deepEqual(abortCalls, [], 'Must NEVER revoke URLs if track.id === state.currentId');
    abortSandbox.abortPlayCleanup({ id: 'superseded-2' });
    assert.deepEqual(abortCalls, ['cloud:superseded-2', 'local:superseded-2']);

    // Verify releaseUnusedLocalUrl(previousTrack); count === 3 invariant
    const prevMatches = html.match(/releaseUnusedLocalUrl\(previousTrack\);/g) || [];
    assert.equal(prevMatches.length, 3);
  });

  it('4. pruneExcessObjectUrls & #prune-object-urls-btn protect corsBypassAudio, dsdUrl, active queueTrackIds, and referenced albumCovers', () => {
    const pruneFn = extractFn(html, 'function pruneExcessObjectUrls(maxBudget)');
    const revoked = [];
    const tracks = [
      { id: 'cur', url: 'blob:cur', cover: 'blob:cov-track' },
      { id: 'q1', url: 'blob:q1', fullAudioUrl: 'blob:q1-full', artist: 'QA', album: 'QAlb' },
      { id: 'idle', url: 'blob:idle-dead' }
    ];
    const state = {
      currentId: 'cur',
      preloadTrackId: null,
      queueTrackIds: ['q1'],
      dsdUrl: 'blob:dsd-active',
      preloadReadyUrl: 'blob:pre-ready',
      corsBypassAudio: { src: 'blob:cors-active' },
      albumCovers: new Map([
        ['qa:::qalb', 'blob:cov-map-active'],
        ['orphan:::alb', 'blob:cov-map-orphan']
      ]),
      tracks,
      objectUrls: new Set([
        'blob:cur', 'blob:q1', 'blob:q1-full', 'blob:dsd-active', 'blob:pre-ready',
        'blob:cors-active', 'blob:cov-track', 'blob:cov-map-active', 'blob:cov-map-orphan', 'blob:idle-dead'
      ])
    };
    const sandbox = {
      Array, Set, Map, String, Number, Boolean, Math,
      URL: class extends URL { static revokeObjectURL(u) { revoked.push(u); } },
      location: { href: 'https://nocturne.local/' },
      library: { buildAlbumKey: t => ((t.artist || '') + ':::' + (t.album || '')).toLowerCase() },
      audio: { src: '' },
      standbyAudio: { src: '' },
      state
    };
    vm.createContext(sandbox);
    vm.runInContext(pruneFn, sandbox);

    const count = sandbox.pruneExcessObjectUrls(4);
    assert.equal(count, 2);
    assert.deepEqual(revoked.sort(), ['blob:cov-map-orphan', 'blob:idle-dead']);
    assert.equal(tracks[2].url, '', 'Revoked URL must be cleared from idle track');
    assert.equal(state.albumCovers.has('orphan:::alb'), false, 'Revoked orphan cover must be deleted from albumCovers');
    assert.equal(state.objectUrls.has('blob:cors-active'), true);
    assert.equal(state.objectUrls.has('blob:dsd-active'), true);
    assert.equal(state.objectUrls.has('blob:q1-full'), true);

    // Also verify #prune-object-urls-btn handler uses state.queueTrackIds & clears revokedUrls
    const btnBlock = sliceBetween(html, "safeOn($('prune-object-urls-btn'), 'click'", "safeOn($('rebuild-compact-index-btn')");
    assert.ok(btnBlock.includes('state.queueTrackIds') && btnBlock.includes('state.corsBypassAudio') && btnBlock.includes('res.revokedUrls'));
  });

  it('5. timeupdate cueEnd pauses element when playback stops (not repeat===2) & isSameCueHtmlParent seeks/preloads/saves session', async () => {
    const tuBlock = sliceBetween(
      html,
      "element.addEventListener('timeupdate', () => {",
      'const isCueScreenHidden ='
    );
    assert.ok(tuBlock.includes('element.pause()') && tuBlock.includes('state.repeat !== 2'), 'timeupdate cueEnd must pause when playNext stops');

    // Run timeupdate boundary check in vm
    let listeners = {};
    const element = {
      currentTime: 99.9,
      paused: false,
      ended: false,
      pause: () => { element.paused = true; },
      addEventListener: (ev, fn) => { listeners[ev] = fn; }
    };
    const tuState = { currentId: 'cue-1', repeat: 0, isPlaybackLoading: false, isSeeking: false, tracks: [{ id: 'cue-1', cueStart: 0, cueEnd: 100 }] };
    const tuSandbox = {
      element, audio: element, state: tuState, Number, Math,
      playNext: () => {},
      syncPlaybackButtonsUi: () => {},
      updatePositionState: () => {}
    };
    vm.createContext(tuSandbox);
    vm.runInContext(
      "element.addEventListener('timeupdate', () => {\n" +
      tuBlock.slice(tuBlock.indexOf('const curTrack =')) +
      '\n}\n});',
      tuSandbox
    );
    listeners.timeupdate();
    assert.equal(element.paused, true, 'Element must pause at cueEnd when playNext stops');
    assert.equal(element.currentTime, 100);

    // Repeat one (repeat === 2) must NOT pause
    element.paused = false;
    element.currentTime = 99.9;
    tuState.repeat = 2;
    listeners.timeupdate();
    assert.equal(element.paused, false, 'Repeat-one mode must remain unpaused');

    // Verify isSameCueHtmlParent seek threshold 0.35, cueStart === 0, preloadNext(true), savePlaybackSession(true)
    const ptSlice = sliceBetween(html, 'const isSameCueHtmlParent = Boolean(', 'target._unlockToken =');
    assert.ok(ptSlice.includes('>= 0.35') && ptSlice.includes('initialTargetSeekSec === 0'));
    assert.ok(ptSlice.includes('preloadNext(true)') && ptSlice.includes('savePlaybackSession(true)'));
  });
});
