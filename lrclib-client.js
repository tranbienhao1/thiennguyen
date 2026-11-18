'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LrclibClient = api;
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {

  const DEFAULT_BASE_URL = 'https://lrclib.net';
  const DEFAULT_USER_AGENT = 'Nocturne-HiRes-Player (https://github.com/tranbienhao1/thiennguyen)';
  const DEFAULT_MIN_SPACING_MS = 250;
  const DEFAULT_MAX_RETRIES = 3;
  const VAULT_DB_NAME = 'nocturne_lyrics_vault';
  const VAULT_STORE_NAME = 'lyrics';

  // --- Lightweight in-memory IndexedDB fallback ---
  class MemoryObjectStore {
    constructor(map) {
      this._map = map;
    }
    put(item) {
      const key = item && item.key;
      this._map.set(key, JSON.parse(JSON.stringify(item)));
      const req = { onsuccess: null, onerror: null, result: key };
      queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    }
    get(key) {
      const val = this._map.get(key);
      const res = val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
      const req = { onsuccess: null, onerror: null, result: res };
      queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    }
    delete(key) {
      this._map.delete(key);
      const req = { onsuccess: null, onerror: null, result: undefined };
      queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    }
    clear() {
      this._map.clear();
      const req = { onsuccess: null, onerror: null, result: undefined };
      queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    }
    getAll() {
      const list = Array.from(this._map.values()).map(v => JSON.parse(JSON.stringify(v)));
      const req = { onsuccess: null, onerror: null, result: list };
      queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    }
  }

  class MemoryTransaction {
    constructor(map) {
      this._map = map;
    }
    objectStore(name) {
      if (name !== VAULT_STORE_NAME) {
        throw new Error(`NotFoundError: Object store "${name}" not found in memory vault`);
      }
      return new MemoryObjectStore(this._map);
    }
  }

  class MemoryIDBDatabase {
    constructor() {
      this.name = VAULT_DB_NAME;
      this.version = 1;
      this.objectStoreNames = {
        contains: (name) => name === VAULT_STORE_NAME,
        item: (i) => (i === 0 ? VAULT_STORE_NAME : null),
        length: 1
      };
      this._data = new Map();
    }
    transaction(storeNames, mode) {
      return new MemoryTransaction(this._data);
    }
    close() {}
  }

  let _vaultDbInstance = null;
  let _memoryDbInstance = null;

  function openLyricsVault(idbFactory) {
    const idb = idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (!idb) {
      if (!_memoryDbInstance) {
        _memoryDbInstance = new MemoryIDBDatabase();
      }
      return Promise.resolve(_memoryDbInstance);
    }

    if (_vaultDbInstance && !idbFactory) {
      return Promise.resolve(_vaultDbInstance);
    }

    return new Promise((resolve, reject) => {
      let req;
      try {
        req = idb.open(VAULT_DB_NAME, 1);
      } catch (err) {
        return reject(err);
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
          db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'key' });
        }
      };

      req.onblocked = () => {};

      req.onsuccess = () => {
        const db = req.result;
        if (db) {
          db.onversionchange = () => {
            try { if (typeof db.close === 'function') db.close(); } catch (_) {}
            if (_vaultDbInstance === db) _vaultDbInstance = null;
          };
          db.onclose = () => {
            if (_vaultDbInstance === db) _vaultDbInstance = null;
          };
        }
        if (!idbFactory) {
          _vaultDbInstance = db;
        }
        resolve(db);
      };

      req.onerror = () => {
        reject(req.error || new Error('Failed to open lyrics vault IndexedDB'));
      };
    });
  }

  async function saveLyricsToVault(key, data, idbFactory) {
    if (!key) throw new Error('Key is required to save lyrics to vault');
    const db = await openLyricsVault(idbFactory);

    const metadata = (data && data.metadata) ? { ...data.metadata } : {
      title: (data && (data.title || data.trackName || data.name)) || '',
      artist: (data && (data.artist || data.artistName)) || '',
      album: (data && (data.album || data.albumName)) || '',
      duration: (data && data.duration !== undefined && data.duration !== null) ? Number(data.duration) : null,
      instrumental: Boolean(data && data.instrumental)
    };

    const record = {
      key: String(key),
      lrc: (data && (data.lrc !== undefined ? data.lrc : (data.syncedLyrics || data.plainLyrics))) || '',
      lyricsfile: (data && data.lyricsfile) || null,
      metadata,
      source: (data && data.source) || 'lrclib',
      updatedAt: (data && data.updatedAt) || Date.now()
    };

    if (data && data.syncedLyrics !== undefined) record.syncedLyrics = data.syncedLyrics;
    if (data && data.plainLyrics !== undefined) record.plainLyrics = data.plainLyrics;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(VAULT_STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error || new Error('Failed to put lyrics to vault'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async function getLyricsFromVault(key, idbFactory) {
    if (!key) return null;
    const db = await openLyricsVault(idbFactory);

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
        const store = tx.objectStore(VAULT_STORE_NAME);
        const req = store.get(String(key));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('Failed to get lyrics from vault'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async function clearLyricsVault(idbFactory) {
    const db = await openLyricsVault(idbFactory);
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(VAULT_STORE_NAME);
        const req = store.clear ? store.clear() : null;
        if (req) {
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error || new Error('Failed to clear lyrics vault'));
        } else {
          resolve(true);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Local Sidecar Detection ---
  async function findLocalSidecarLyrics(fileHandle, dirHandle) {
    if (!fileHandle) return null;

    let fileName = '';
    if (typeof fileHandle === 'string') {
      fileName = fileHandle;
    } else if (fileHandle && typeof fileHandle.name === 'string') {
      fileName = fileHandle.name;
    } else {
      return null;
    }

    const baseWithExt = fileName.split(/[\\/]/).pop() || '';
    const baseName = baseWithExt.replace(/\.[^/.\\]+$/, '');
    if (!baseName) return null;

    const candidateExts = ['.lrc', '.lyricsfile', '.yaml', '.txt'];

    // 1. FileSystemDirectoryHandle (File System Access API)
    if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
      for (const ext of candidateExts) {
        const candidateName = `${baseName}${ext}`;
        try {
          const sidecarHandle = await dirHandle.getFileHandle(candidateName);
          if (sidecarHandle) {
            const file = await sidecarHandle.getFile();
            const text = await file.text();
            return {
              name: candidateName,
              extension: ext,
              type: ext === '.lrc' ? 'lrc' : (ext === '.txt' ? 'txt' : 'lyricsfile'),
              text: text,
              handle: sidecarHandle
            };
          }
        } catch (e) {
          // File not found or inaccessible, continue
        }
      }
    }

    // 2. dirHandle as Map or plain object mapping filename -> text or file-like object
    if (dirHandle && typeof dirHandle === 'object' && typeof dirHandle.getFileHandle !== 'function') {
      for (const ext of candidateExts) {
        const candidateName = `${baseName}${ext}`;
        let entry = undefined;
        if (typeof dirHandle.get === 'function') {
          entry = dirHandle.get(candidateName);
        } else if (Object.prototype.hasOwnProperty.call(dirHandle, candidateName)) {
          entry = dirHandle[candidateName];
        }

        if (entry !== undefined && entry !== null) {
          let text = '';
          if (typeof entry === 'string') {
            text = entry;
          } else if (entry && typeof entry.text === 'function') {
            text = await entry.text();
          } else if (entry && typeof entry.getFile === 'function') {
            const f = await entry.getFile();
            text = await f.text();
          } else if (entry && typeof entry.content === 'string') {
            text = entry.content;
          } else {
            text = String(entry);
          }
          return {
            name: candidateName,
            extension: ext,
            type: ext === '.lrc' ? 'lrc' : (ext === '.txt' ? 'txt' : 'lyricsfile'),
            text: text,
            handle: entry
          };
        }
      }
    }

    // 3. Node.js filesystem path
    if (typeof dirHandle === 'string' && typeof require === 'function') {
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        for (const ext of candidateExts) {
          const candidatePath = path.join(dirHandle, `${baseName}${ext}`);
          if (fs.existsSync(candidatePath)) {
            const text = fs.readFileSync(candidatePath, 'utf8');
            return {
              name: `${baseName}${ext}`,
              extension: ext,
              type: ext === '.lrc' ? 'lrc' : (ext === '.txt' ? 'txt' : 'lyricsfile'),
              text: text,
              path: candidatePath
            };
          }
        }
      } catch (e) {
        // Ignored
      }
    }

    return null;
  }

  // --- Normalization & Helper Functions ---
  function normalizeLyricsItem(item) {
    if (!item) return null;
    const syncedLyrics = typeof item.syncedLyrics === 'string' ? item.syncedLyrics : null;
    const plainLyrics = typeof item.plainLyrics === 'string' ? item.plainLyrics : null;
    const instrumental = Boolean(item.instrumental);
    const hasSyncedLyrics = Boolean(syncedLyrics && syncedLyrics.trim().length > 0);
    const hasPlainLyrics = Boolean(plainLyrics && plainLyrics.trim().length > 0);
    const hasWordSync = Boolean(
      item.hasWordSync ||
      (syncedLyrics && /<\d{2}:\d{2}(?:\.\d{2,3})?>/.test(syncedLyrics))
    );

    return {
      ...item,
      id: item.id !== undefined ? item.id : null,
      trackName: item.trackName || item.name || '',
      artistName: item.artistName || '',
      albumName: item.albumName || '',
      duration: item.duration !== undefined && item.duration !== null ? Number(item.duration) : null,
      instrumental,
      plainLyrics,
      syncedLyrics,
      hasPlainLyrics,
      hasSyncedLyrics,
      hasWordSync
    };
  }

  function parseRetryAfter(response) {
    if (!response || !response.headers) return null;
    const header = typeof response.headers.get === 'function'
      ? response.headers.get('Retry-After')
      : (response.headers['retry-after'] || response.headers['Retry-After']);
    if (!header) return null;

    const num = Number(header);
    if (!isNaN(num) && num >= 0) {
      return num; // in seconds
    }
    const dateMs = Date.parse(header);
    if (!isNaN(dateMs)) {
      const diffSec = (dateMs - Date.now()) / 1000;
      return diffSec > 0 ? diffSec : 0;
    }
    return null;
  }

  function calculateRetryDelay(response, attempt, options = {}) {
    const retryAfterSec = parseRetryAfter(response);
    let baseMs;
    if (retryAfterSec !== null) {
      baseMs = retryAfterSec * 1000;
    } else {
      baseMs = 1000 * Math.pow(2, attempt);
    }

    // Jitter: 0 - 30% added
    let jitterFactor;
    if (options && typeof options.jitterRatio === 'number') {
      jitterFactor = Math.max(0, Math.min(0.30, options.jitterRatio));
    } else {
      jitterFactor = Math.random() * 0.30;
    }

    return Math.round(baseMs * (1 + jitterFactor));
  }

  // --- Abortable Yield Helper for Batched PoW ---
  function _yieldPowBatchWithAbort(signal, delayMs = 0) {
    if (signal && signal.aborted) {
      return Promise.reject(_makeAbortError(signal.reason));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let tid = null;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        if (tid !== null) clearTimeout(tid);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
        reject(_makeAbortError(signal.reason));
      };
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      tid = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, delayMs);
    });
  }

  // --- PoW Fallback Solver (UPG-09 Batch Progress & Instant Abort) ---
  async function solveLrclibPoWFallback(prefix, target, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const signal = opts.signal || null;
    if (signal && signal.aborted) {
      throw _makeAbortError(signal.reason);
    }

    const targetNorm = String(target).toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const startNonce = Number.isFinite(Number(opts.startNonce)) ? Math.max(0, Math.floor(Number(opts.startNonce))) : 0;
    const maxIterations = Number.isFinite(Number(opts.maxIterations)) && Number(opts.maxIterations) > 0
      ? Math.max(1, Math.floor(Number(opts.maxIterations)))
      : 10000000;
    const batchSize = Number.isFinite(Number(opts.batchSize)) && Number(opts.batchSize) > 0
      ? Math.max(1, Math.min(8192, Math.floor(Number(opts.batchSize))))
      : 512;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const nowFn = typeof opts.nowFn === 'function'
      ? opts.nowFn
      : () => (typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());

    const startedAt = nowFn();
    let nonce = startNonce;
    let iterations = 0;
    let batchIndex = 0;

    if (typeof require === 'function') {
      try {
        const crypto = require('node:crypto');
        while (iterations < maxIterations) {
          if (signal && signal.aborted) throw _makeAbortError(signal.reason);
          const sliceTarget = Math.min(batchSize, maxIterations - iterations);
          for (let i = 0; i < sliceTarget; i++) {
            if (signal && (i & 63) === 0 && signal.aborted) {
              throw _makeAbortError(signal.reason);
            }
            const hash = crypto.createHash('sha256').update(prefix + nonce).digest('hex');
            iterations++;
            if (hash.padStart(64, '0') < targetNorm) {
              return String(nonce);
            }
            nonce++;
          }
          batchIndex++;
          if (onProgress) {
            const elapsedMs = Math.max(0, nowFn() - startedAt);
            const hashRateHps = elapsedMs > 0 ? Math.round((iterations * 1000) / elapsedMs) : Math.round(iterations * 1000);
            onProgress({ nonce, iterations, elapsedMs, hashRateHps, batchIndex, maxIterations });
          }
          if (signal && signal.aborted) throw _makeAbortError(signal.reason);
          if (iterations < maxIterations) {
            await _yieldPowBatchWithAbort(signal, 0);
          }
        }
        throw new Error('PoW search limit exceeded');
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.message === 'PoW search limit exceeded')) throw e;
      }
    }

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      while (iterations < maxIterations) {
        if (signal && signal.aborted) throw _makeAbortError(signal.reason);
        const sliceTarget = Math.min(batchSize, maxIterations - iterations);
        for (let i = 0; i < sliceTarget; i++) {
          if (signal && signal.aborted) throw _makeAbortError(signal.reason);
          const data = encoder.encode(prefix + nonce);
          const hashBuf = await _racePromiseWithSignal(crypto.subtle.digest('SHA-256', data), signal);
          if (signal && signal.aborted) throw _makeAbortError(signal.reason);
          const hashArray = Array.from(new Uint8Array(hashBuf));
          const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          iterations++;
          if (hash.padStart(64, '0') < targetNorm) {
            return String(nonce);
          }
          nonce++;
        }
        batchIndex++;
        if (onProgress) {
          const elapsedMs = Math.max(0, nowFn() - startedAt);
          const hashRateHps = elapsedMs > 0 ? Math.round((iterations * 1000) / elapsedMs) : Math.round(iterations * 1000);
          onProgress({ nonce, iterations, elapsedMs, hashRateHps, batchIndex, maxIterations });
        }
        if (signal && signal.aborted) throw _makeAbortError(signal.reason);
        if (iterations < maxIterations) {
          await _yieldPowBatchWithAbort(signal, 0);
        }
      }
      throw new Error('PoW search limit exceeded');
    }

    throw new Error('No crypto provider available for LRCLIB PoW challenge');
  }

  // --- Abortable Sequential Rate-Limiting Queue (BUG-04 Hardened) ---
  function _makeAbortError(reason) {
    if (reason instanceof Error && reason.name === 'AbortError') return reason;
    const msg = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'LRCLIB request aborted';
    const err = new Error(msg);
    err.name = 'AbortError';
    err.code = 'ABORT_ERR';
    return err;
  }

  function _resolveExternalAbortableQueueFactory() {
    if (typeof globalThis === 'object' && globalThis) {
      if (globalThis.NocturneLibrary && typeof globalThis.NocturneLibrary.createAbortableSequentialRequestQueue === 'function') {
        return globalThis.NocturneLibrary.createAbortableSequentialRequestQueue;
      }
      if (globalThis.library && typeof globalThis.library.createAbortableSequentialRequestQueue === 'function') {
        return globalThis.library.createAbortableSequentialRequestQueue;
      }
    }
    if (typeof require === 'function') {
      try {
        const lib = require('./library-utils.js');
        if (lib && typeof lib.createAbortableSequentialRequestQueue === 'function') {
          return lib.createAbortableSequentialRequestQueue;
        }
      } catch (_) {}
    }
    return null;
  }

  function _createFallbackAbortableQueue(options = {}) {
    const opts = typeof options === 'number' ? { minSpacingMs: options } : (options || {});
    const minSpacingMs = opts.minSpacingMs !== undefined ? Math.max(0, Number(opts.minSpacingMs) || 0) : DEFAULT_MIN_SPACING_MS;
    const nowFn = typeof opts.nowFn === 'function' ? opts.nowFn : () => Date.now();
    const setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : id => clearTimeout(id);

    let generation = 0;
    let lastOutboundTime = 0;
    let activeEntry = null;
    const pending = [];
    const activeTimers = new Set();
    let completedCount = 0;
    let abortedCount = 0;
    let evictedCount = 0;

    function abortableSleep(delayMs, signal = null, reason = 'Aborted during Retry-After sleep') {
      const waitMs = Math.max(0, Math.round(Number(delayMs) || 0));
      if (signal && signal.aborted) return Promise.reject(_makeAbortError(signal.reason || reason));
      if (waitMs <= 0) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let settled = false;
        let tid = null;
        const cleanup = () => {
          if (tid !== null) { activeTimers.delete(tid); tid = null; }
          if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          if (tid !== null) clearTimer(tid);
          cleanup();
          reject(_makeAbortError((signal && signal.reason) || reason));
        };
        if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
        if (signal && signal.aborted) { onAbort(); return; }
        tid = setTimer(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        }, waitMs);
        activeTimers.add(tid);
      });
    }

    async function waitForSpacing(signal = null) {
      if (signal && signal.aborted) throw _makeAbortError(signal.reason);
      if (minSpacingMs > 0 && lastOutboundTime > 0) {
        const elapsed = nowFn() - lastOutboundTime;
        if (elapsed < minSpacingMs) {
          await abortableSleep(minSpacingMs - elapsed, signal, 'Aborted during spacing wait');
        }
      }
      if (signal && signal.aborted) throw _makeAbortError(signal.reason);
      lastOutboundTime = nowFn();
    }

    function abortEntry(entry, reason, queued) {
      if (!entry || entry.aborted) return;
      entry.aborted = true;
      entry.detach();
      const err = _makeAbortError(reason);
      entry.ctrl.abort(err);
      if (queued) {
        const idx = pending.indexOf(entry);
        if (idx !== -1) pending.splice(idx, 1);
        evictedCount++;
      }
      if (!entry.settled) {
        entry.settled = true;
        abortedCount++;
        entry.reject(err);
      }
      if (activeEntry === entry) {
        activeEntry = null;
        pump();
      }
    }

    function sweep(reason = 'Superseded') {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (!pending[i].ignoreSupersede && pending[i].generation < generation) {
          abortEntry(pending[i], reason, true);
        }
      }
      if (activeEntry && !activeEntry.ignoreSupersede && activeEntry.generation < generation) {
        abortEntry(activeEntry, reason, false);
      }
    }

    function advanceGeneration(reason = 'Superseded') {
      generation++;
      sweep(reason);
      return generation;
    }

    function cancelAll(reason = 'Queue cancelled') {
      generation++;
      while (pending.length) abortEntry(pending.pop(), reason, true);
      if (activeEntry) abortEntry(activeEntry, reason, false);
    }

    function pump() {
      sweep();
      while (!activeEntry && pending.length > 0) {
        const next = pending.shift();
        if (!next || next.aborted || next.settled) continue;
        activeEntry = next;
        const sig = next.ctrl.signal;
        const ctx = {
          signal: sig,
          generation: next.generation,
          isAborted: () => next.aborted || sig.aborted || (!next.ignoreSupersede && next.generation < generation),
          throwIfAborted: () => { if (next.aborted || sig.aborted) throw _makeAbortError(sig.reason); },
          sleep: ms => abortableSleep(ms, sig),
          waitRetryAfter: ms => abortableSleep(ms, sig),
          waitForSpacing: () => waitForSpacing(sig)
        };
        Promise.resolve()
          .then(() => { ctx.throwIfAborted(); return next.fn(ctx); })
          .then(
            res => {
              next.detach();
              const wasActive = activeEntry === next;
              if (wasActive) activeEntry = null;
              if (!next.settled) { next.settled = true; completedCount++; next.resolve(res); }
              if (wasActive) pump();
            },
            err => {
              next.detach();
              const wasActive = activeEntry === next;
              if (wasActive) activeEntry = null;
              if (!next.settled) {
                next.settled = true;
                if (next.aborted || sig.aborted || (err && err.name === 'AbortError')) {
                  abortedCount++;
                  next.reject(_makeAbortError(err));
                } else {
                  next.reject(err);
                }
              }
              if (wasActive) pump();
            }
          );
      }
    }

    function enqueue(fn, taskOptions = {}) {
      const tOpts = taskOptions || {};
      const extSig = tOpts.signal || null;
      const ignoreSupersede = Boolean(tOpts.ignoreSupersede || tOpts.pinned);
      if (extSig && extSig.aborted) {
        abortedCount++;
        return Promise.reject(_makeAbortError(extSig.reason));
      }
      if (tOpts.supersedePrevious === true) advanceGeneration('Superseded by newer request');
      const entryGen = Number.isFinite(Number(tOpts.generation)) ? Math.floor(Number(tOpts.generation)) : generation;
      if (!ignoreSupersede && entryGen < generation) {
        abortedCount++;
        evictedCount++;
        return Promise.reject(_makeAbortError('Superseded before execution'));
      }
      return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const entry = { fn, generation: entryGen, ignoreSupersede, ctrl, aborted: false, settled: false, resolve, reject, detach: () => {} };
        if (extSig && typeof extSig.addEventListener === 'function') {
          const onAbort = () => abortEntry(entry, extSig.reason || 'Aborted', pending.includes(entry));
          extSig.addEventListener('abort', onAbort, { once: true });
          entry.detach = () => { extSig.removeEventListener('abort', onAbort); entry.detach = () => {}; };
          if (extSig.aborted) { onAbort(); return; }
        }
        pending.push(entry);
        pump();
      });
    }

    return {
      spacingMs: minSpacingMs,
      minSpacingMs,
      get generation() { return generation; },
      get pendingCount() { return pending.length; },
      get activeTimerCount() { return activeTimers.size; },
      enqueue,
      sleep: abortableSleep,
      waitRetryAfter: abortableSleep,
      waitForSpacing,
      advanceGeneration,
      supersede: advanceGeneration,
      cancelAll,
      getGeneration: () => generation,
      getStats: () => ({
        pendingCount: pending.length,
        inFlightCount: activeEntry ? 1 : 0,
        activeTimerCount: activeTimers.size,
        generation,
        completedCount,
        abortedCount,
        evictedCount
      })
    };
  }

  class SequentialQueue {
    constructor(spacingOrOptions = DEFAULT_MIN_SPACING_MS) {
      const factory = _resolveExternalAbortableQueueFactory() || _createFallbackAbortableQueue;
      const opts = typeof spacingOrOptions === 'number'
        ? { minSpacingMs: spacingOrOptions }
        : (spacingOrOptions || {});
      this._delegate = factory(opts);
      this.spacingMs = this._delegate.minSpacingMs;
    }

    enqueue(fn, taskOptions = {}) {
      return this._delegate.enqueue(fn, taskOptions);
    }

    waitForSpacing(signal = null) {
      return this._delegate.waitForSpacing(signal);
    }

    sleep(delayMs, signal = null) {
      return this._delegate.sleep(delayMs, signal);
    }

    advanceGeneration(reason) {
      return this._delegate.advanceGeneration(reason);
    }

    supersede(reason) {
      return this._delegate.advanceGeneration(reason);
    }

    cancelAll(reason) {
      return this._delegate.cancelAll(reason);
    }

    getGeneration() {
      return this._delegate.getGeneration();
    }

    getStats() {
      return this._delegate.getStats();
    }
  }

  function _racePromiseWithSignal(promise, signal) {
    if (!signal || typeof signal.addEventListener !== 'function') return promise;
    if (signal.aborted) return Promise.reject(_makeAbortError(signal.reason));
    return new Promise((resolve, reject) => {
      let done = false;
      const onAbort = () => {
        if (done) return;
        done = true;
        reject(_makeAbortError(signal.reason));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        val => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        err => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  // --- Core Request Execution with Abortable 429/503 Retries ---
  async function _executeFetch(client, url, fetchOptions, attempt = 0, ctx = null) {
    const taskSignal = (ctx && ctx.signal) || (fetchOptions && fetchOptions.signal) || null;
    if (taskSignal && taskSignal.aborted) {
      throw _makeAbortError(taskSignal.reason);
    }

    await client.queue.waitForSpacing(taskSignal);

    if (taskSignal && taskSignal.aborted) {
      throw _makeAbortError(taskSignal.reason);
    }

    const fetchImpl = client.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) {
      throw new Error('fetch implementation is not available in current environment');
    }

    const outboundOpts = (fetchOptions && fetchOptions.signal)
      ? { ...fetchOptions, signal: taskSignal || fetchOptions.signal }
      : fetchOptions;

    let response;
    try {
      response = await _racePromiseWithSignal(Promise.resolve(fetchImpl(url, outboundOpts)), taskSignal);
    } catch (networkErr) {
      if ((networkErr && networkErr.name === 'AbortError') || (taskSignal && taskSignal.aborted)) {
        throw _makeAbortError(networkErr);
      }
      if (attempt < client.maxRetries) {
        const delayMs = calculateRetryDelay(null, attempt, client.options);
        await client.queue.sleep(delayMs, taskSignal);
        return _executeFetch(client, url, fetchOptions, attempt + 1, ctx);
      }
      throw networkErr;
    }

    if (taskSignal && taskSignal.aborted) {
      throw _makeAbortError(taskSignal.reason);
    }

    if (response.status === 429 || response.status === 503) {
      if (attempt < client.maxRetries) {
        const delayMs = calculateRetryDelay(response, attempt, client.options);
        await client.queue.sleep(delayMs, taskSignal);
        return _executeFetch(client, url, fetchOptions, attempt + 1, ctx);
      }
      const err = new Error(`LRCLIB HTTP ${response.status}: Rate limit / Service unavailable after ${attempt} retries`);
      err.status = response.status;
      err.response = response;
      throw err;
    }

    return response;
  }

  // --- LRCLIB Client Class ---
  class LrclibClient {
    constructor(options = {}) {
      this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
      this.fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      this.minSpacingMs = options.minSpacingMs !== undefined ? options.minSpacingMs : DEFAULT_MIN_SPACING_MS;
      this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
      this.options = options;
      this.queue = new SequentialQueue({
        minSpacingMs: this.minSpacingMs,
        nowFn: options.nowFn,
        setTimer: options.setTimer,
        clearTimer: options.clearTimer
      });
    }

    supersedePending(reason = 'Track switched') {
      return this.queue.advanceGeneration(reason);
    }

    cancelAll(reason = 'Client requests cancelled') {
      this.queue.cancelAll(reason);
    }

    fetchWithRetry(url, fetchOptions = {}, queueOptions = {}) {
      const qOpts = queueOptions && typeof queueOptions === 'object' ? queueOptions : {};
      const fOpts = fetchOptions && typeof fetchOptions === 'object' ? { ...fetchOptions } : {};
      const signal = qOpts.signal || fOpts.signal || null;
      const supersedePrevious = Boolean(qOpts.supersedePrevious || fOpts.supersedePrevious);
      const ignoreSupersede = Boolean(qOpts.ignoreSupersede || qOpts.pinned);
      const generation = qOpts.generation;
      if ('supersedePrevious' in fOpts) {
        delete fOpts.supersedePrevious;
      }

      return this.queue.enqueue(
        ctx => _executeFetch(this, url, fOpts, 0, ctx),
        { signal, supersedePrevious, ignoreSupersede, generation }
      );
    }

    async getLyrics(params = {}) {
      const trackName = params.trackName || params.track_name || params.title || '';
      const artistName = params.artistName || params.artist_name || params.artist || '';
      const albumName = params.albumName || params.album_name || params.album || '';
      const duration = (params.duration !== undefined && params.duration !== null)
        ? Math.round(Number(params.duration))
        : undefined;

      if (!trackName) {
        throw new Error('trackName is required to get lyrics');
      }

      const signal = params.signal || null;
      const reqGeneration = params.supersedePrevious === true
        ? this.queue.advanceGeneration('Superseded by newer getLyrics track')
        : (params.generation !== undefined ? params.generation : this.queue.getGeneration());
      const queueTaskOpts = {
        signal,
        generation: reqGeneration,
        ignoreSupersede: Boolean(params.ignoreSupersede || params.pinned)
      };

      const buildUrl = (includeAlbum) => {
        const url = new URL('/api/get', this.baseUrl);
        url.searchParams.set('track_name', trackName);
        if (artistName) url.searchParams.set('artist_name', artistName);
        if (includeAlbum && albumName) url.searchParams.set('album_name', albumName);
        if (duration !== undefined && !isNaN(duration) && duration > 0) {
          url.searchParams.set('duration', String(duration));
        }
        return url.toString();
      };

      const reqHeaders = {
        'Lrclib-Client': this.userAgent,
        'Accept': 'application/json'
      };
      const baseFetchOpts = signal
        ? { method: 'GET', headers: reqHeaders, signal }
        : { method: 'GET', headers: reqHeaders };

      const firstUrl = buildUrl(Boolean(albumName));
      const firstRes = await this.fetchWithRetry(firstUrl, baseFetchOpts, queueTaskOpts);

      if (firstRes.status === 200) {
        const data = await firstRes.json();
        return normalizeLyricsItem(data);
      }

      // Fallback without albumName if not found (404) and albumName was provided
      if (firstRes.status === 404 && albumName) {
        const fallbackUrl = buildUrl(false);
        const fallbackRes = await this.fetchWithRetry(fallbackUrl, baseFetchOpts, queueTaskOpts);

        if (fallbackRes.status === 200) {
          const data = await fallbackRes.json();
          return normalizeLyricsItem(data);
        }

        if (fallbackRes.status === 404) {
          return null;
        }

        throw new Error(`LRCLIB getLyrics failed with status ${fallbackRes.status}`);
      }

      if (firstRes.status === 404) {
        return null;
      }

      throw new Error(`LRCLIB getLyrics failed with status ${firstRes.status}`);
    }

    async searchLyrics(query, filter = {}) {
      const params = new URLSearchParams();
      const qStr = typeof query === 'string' ? query.trim() : (filter.q || '');
      if (qStr) params.set('q', qStr);

      const opts = (typeof query === 'object' && query !== null) ? { ...query, ...filter } : filter;
      const track = opts.trackName || opts.track_name || opts.title;
      const artist = opts.artistName || opts.artist_name || opts.artist;
      const album = opts.albumName || opts.album_name || opts.album;

      if (track) params.set('track_name', track);
      if (artist) params.set('artist_name', artist);
      if (album) params.set('album_name', album);

      const signal = opts.signal || null;
      const reqGeneration = opts.supersedePrevious === true
        ? this.queue.advanceGeneration('Superseded by newer searchLyrics query')
        : (opts.generation !== undefined ? opts.generation : this.queue.getGeneration());
      const queueTaskOpts = {
        signal,
        generation: reqGeneration,
        ignoreSupersede: Boolean(opts.ignoreSupersede || opts.pinned)
      };
      const reqHeaders = {
        'Lrclib-Client': this.userAgent,
        'Accept': 'application/json'
      };
      const baseFetchOpts = signal
        ? { method: 'GET', headers: reqHeaders, signal }
        : { method: 'GET', headers: reqHeaders };

      const qs = params.toString();

      // Try /api/v2/search first
      const v2Url = `${this.baseUrl}/api/v2/search${qs ? `?${qs}` : ''}`;
      let tryFallback = false;

      try {
        const res = await this.fetchWithRetry(v2Url, baseFetchOpts, queueTaskOpts);

        if (res.status === 200) {
          const list = await res.json();
          if (Array.isArray(list)) {
            return list.map(normalizeLyricsItem);
          }
          return [];
        } else {
          tryFallback = true;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        tryFallback = true;
      }

      // Fallback to /api/search
      if (tryFallback) {
        const v1Url = `${this.baseUrl}/api/search${qs ? `?${qs}` : ''}`;
        const v1Res = await this.fetchWithRetry(v1Url, baseFetchOpts, queueTaskOpts);

        if (v1Res.status === 200) {
          const list = await v1Res.json();
          if (Array.isArray(list)) {
            return list.map(normalizeLyricsItem);
          }
          return [];
        }
        if (v1Res.status === 404) {
          return [];
        }
        throw new Error(`LRCLIB searchLyrics failed with status ${v1Res.status}`);
      }

      return [];
    }

    async getLyricsById(id, options = {}) {
      if (id === undefined || id === null) {
        throw new Error('id is required to get lyrics by id');
      }

      const opts = options && typeof options === 'object' ? options : {};
      const signal = opts.signal || null;
      const reqHeaders = {
        'Lrclib-Client': this.userAgent,
        'Accept': 'application/json'
      };
      const baseFetchOpts = signal
        ? { method: 'GET', headers: reqHeaders, signal }
        : { method: 'GET', headers: reqHeaders };

      const url = `${this.baseUrl}/api/get/${encodeURIComponent(id)}`;
      const res = await this.fetchWithRetry(url, baseFetchOpts, {
        signal,
        supersedePrevious: Boolean(opts.supersedePrevious),
        generation: opts.generation,
        ignoreSupersede: Boolean(opts.ignoreSupersede || opts.pinned)
      });

      if (res.status === 200) {
        const data = await res.json();
        return normalizeLyricsItem(data);
      }

      if (res.status === 404) {
        return null;
      }

      throw new Error(`LRCLIB getLyricsById failed with status ${res.status}`);
    }

    async publishLyrics(payload, options = {}) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required to publish lyrics');
      }

      const opts = options && typeof options === 'object' ? options : {};
      const signal = opts.signal || null;
      const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
      const onStageChange = typeof opts.onStageChange === 'function' ? opts.onStageChange : null;

      if (signal && signal.aborted) {
        throw _makeAbortError(signal.reason);
      }

      if (onStageChange) {
        onStageChange('requesting_challenge', { stage: 'requesting_challenge' });
      }

      // 1. Request challenge (pinned so track-switch background skips don't accidentally cancel an explicit user publish unless signal aborts!)
      const challengeUrl = `${this.baseUrl}/api/request-challenge`;
      const challengeHeaders = {
        'Content-Type': 'application/json',
        'Lrclib-Client': this.userAgent,
        'Accept': 'application/json'
      };
      const challengeFetchOpts = signal
        ? { method: 'POST', headers: challengeHeaders, signal }
        : { method: 'POST', headers: challengeHeaders };

      const challengeRes = await this.fetchWithRetry(challengeUrl, challengeFetchOpts, {
        signal,
        pinned: true
      });

      if (!challengeRes.ok) {
        throw new Error(`Failed to request challenge: HTTP ${challengeRes.status}`);
      }

      const { prefix, target } = await challengeRes.json();
      if (!prefix || !target) {
        throw new Error('Invalid challenge response: missing prefix or target');
      }

      if (signal && signal.aborted) {
        throw _makeAbortError(signal.reason);
      }

      if (onStageChange) {
        onStageChange('solving', { stage: 'solving', prefix, target });
      }

      // 2. Solve PoW with batch progress & instant AbortSignal support (UPG-09)
      const powCallOpts = {
        signal,
        onProgress,
        batchSize: opts.batchSize,
        maxIterations: opts.maxIterations,
        startNonce: opts.startNonce,
        nowFn: opts.nowFn
      };

      let nonce;
      const customSolvePoW = typeof opts.solvePoW === 'function'
        ? opts.solvePoW
        : (this.options && typeof this.options.solvePoW === 'function' ? this.options.solvePoW : null);

      const resolveLibraryPow = () => {
        if (typeof globalThis === 'object' && globalThis) {
          if (globalThis.NocturneLibrary && typeof globalThis.NocturneLibrary.solveLrclibChallengeAsync === 'function') {
            return globalThis.NocturneLibrary;
          }
          if (globalThis.library && typeof globalThis.library.solveLrclibChallengeAsync === 'function') {
            return globalThis.library;
          }
        }
        if (typeof require === 'function') {
          try {
            const lib = require('./library-utils.js');
            if (lib && typeof lib.solveLrclibChallengeAsync === 'function') return lib;
          } catch (_) {}
        }
        return null;
      };

      const isStrictHex64 = typeof target === 'string' && /^[0-9a-fA-F]{64}$/.test(target.trim().replace(/^0x/i, ''));

      if (customSolvePoW) {
        const rawSolved = await _racePromiseWithSignal(
          Promise.resolve().then(() => customSolvePoW(prefix, target, powCallOpts)),
          signal
        );
        nonce = (rawSolved && typeof rawSolved === 'object' && rawSolved.nonce !== undefined)
          ? rawSolved.nonce
          : rawSolved;
      } else if (opts.powRunner && typeof opts.powRunner.solve === 'function' && isStrictHex64) {
        const solved = await opts.powRunner.solve(prefix, target, powCallOpts);
        nonce = solved.nonce;
      } else if ((onProgress || signal || opts.preferAsyncPow) && isStrictHex64) {
        const libMod = resolveLibraryPow();
        if (libMod && typeof libMod.createLrclibPowWorkerRunner === 'function') {
          const runner = this._powWorkerRunner || (this._powWorkerRunner = libMod.createLrclibPowWorkerRunner());
          const solved = await runner.solve(prefix, target, powCallOpts);
          nonce = solved.nonce;
        } else if (libMod && typeof libMod.solveLrclibChallengeAsync === 'function') {
          const solved = await libMod.solveLrclibChallengeAsync(prefix, target, powCallOpts);
          nonce = solved.nonce;
        } else {
          nonce = await solveLrclibPoWFallback(prefix, target, powCallOpts);
        }
      } else {
        let solver = null;
        if (this.options && this.options.lyricsUtils && typeof this.options.lyricsUtils.solveLrclibPoW === 'function') {
          solver = this.options.lyricsUtils.solveLrclibPoW;
        } else if (typeof globalThis !== 'undefined' && globalThis.LyricsUtils && typeof globalThis.LyricsUtils.solveLrclibPoW === 'function') {
          solver = globalThis.LyricsUtils.solveLrclibPoW;
        } else if (typeof window !== 'undefined' && window.LyricsUtils && typeof window.LyricsUtils.solveLrclibPoW === 'function') {
          solver = window.LyricsUtils.solveLrclibPoW;
        } else if (typeof require === 'function') {
          try {
            const lu = require('./lyrics-utils.js');
            if (lu && typeof lu.solveLrclibPoW === 'function') {
              solver = lu.solveLrclibPoW;
            }
          } catch (e) {}
        }

        if (solver) {
          const rawSolved = await _racePromiseWithSignal(
            Promise.resolve().then(() => solver(prefix, target, powCallOpts)),
            signal
          );
          nonce = (rawSolved && typeof rawSolved === 'object' && rawSolved.nonce !== undefined)
            ? rawSolved.nonce
            : rawSolved;
        } else {
          nonce = await solveLrclibPoWFallback(prefix, target, powCallOpts);
        }
      }

      if (signal && signal.aborted) {
        throw _makeAbortError(signal.reason);
      }

      if (nonce === null || nonce === undefined) {
        throw new Error('PoW search limit exceeded without finding a valid nonce');
      }

      if (onStageChange) {
        onStageChange('publishing', { stage: 'publishing', nonce: String(nonce) });
      }

      // 3. Post to /api/publish
      const publishUrl = `${this.baseUrl}/api/publish`;
      const publishHeaders = {
        'Content-Type': 'application/json',
        'Lrclib-Client': this.userAgent,
        'X-Publish-Token': `${prefix}:${nonce}`,
        'Accept': 'application/json'
      };
      const publishFetchOpts = signal
        ? { method: 'POST', headers: publishHeaders, body: JSON.stringify(payload), signal }
        : { method: 'POST', headers: publishHeaders, body: JSON.stringify(payload) };

      const publishRes = await this.fetchWithRetry(publishUrl, publishFetchOpts, {
        signal,
        pinned: true
      });

      if (!publishRes.ok) {
        const errText = await publishRes.text().catch(() => '');
        throw new Error(`Failed to publish lyrics: HTTP ${publishRes.status}${errText ? ` - ${errText}` : ''}`);
      }

      return await publishRes.json().catch(() => ({ success: true, status: publishRes.status }));
    }

    // Vault delegators on instance
    openLyricsVault(idbFactory) {
      return openLyricsVault(idbFactory || (this.options && this.options.indexedDB));
    }
    saveLyricsToVault(key, data, idbFactory) {
      return saveLyricsToVault(key, data, idbFactory || (this.options && this.options.indexedDB));
    }
    getLyricsFromVault(key, idbFactory) {
      return getLyricsFromVault(key, idbFactory || (this.options && this.options.indexedDB));
    }
    findLocalSidecarLyrics(fileHandle, dirHandle) {
      return findLocalSidecarLyrics(fileHandle, dirHandle);
    }
  }

  // --- Default Client Singleton & Module Exports ---
  const defaultClient = new LrclibClient();

  LrclibClient.getLyrics = (params) => defaultClient.getLyrics(params);
  LrclibClient.searchLyrics = (query, filter) => defaultClient.searchLyrics(query, filter);
  LrclibClient.getLyricsById = (id, options) => defaultClient.getLyricsById(id, options);
  LrclibClient.publishLyrics = (payload, options) => defaultClient.publishLyrics(payload, options);
  LrclibClient.fetchWithRetry = (url, options, queueOptions) => defaultClient.fetchWithRetry(url, options, queueOptions);
  LrclibClient.supersedePending = (reason) => defaultClient.supersedePending(reason);
  LrclibClient.cancelAll = (reason) => defaultClient.cancelAll(reason);
  LrclibClient.SequentialQueue = SequentialQueue;

  LrclibClient.openLyricsVault = openLyricsVault;
  LrclibClient.saveLyricsToVault = saveLyricsToVault;
  LrclibClient.getLyricsFromVault = getLyricsFromVault;
  LrclibClient.clearLyricsVault = clearLyricsVault;
  LrclibClient.findLocalSidecarLyrics = findLocalSidecarLyrics;
  LrclibClient.normalizeLyricsItem = normalizeLyricsItem;
  LrclibClient.parseRetryAfter = parseRetryAfter;
  LrclibClient.calculateRetryDelay = calculateRetryDelay;
  LrclibClient.solveLrclibPoWFallback = solveLrclibPoWFallback;
  LrclibClient.createClient = (options) => new LrclibClient(options);
  LrclibClient.LrclibClient = LrclibClient;

  return LrclibClient;
});
