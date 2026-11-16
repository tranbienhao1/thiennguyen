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

      req.onsuccess = () => {
        const db = req.result;
        if (!idbFactory) {
          _vaultDbInstance = db;
          db.onclose = () => { _vaultDbInstance = null; };
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

  // --- PoW Fallback Solver ---
  async function solveLrclibPoWFallback(prefix, target) {
    const targetNorm = target.toLowerCase().padStart(64, '0');
    let nonce = 0;

    if (typeof require === 'function') {
      try {
        const crypto = require('node:crypto');
        while (true) {
          const hash = crypto.createHash('sha256').update(prefix + nonce).digest('hex');
          if (hash.padStart(64, '0') < targetNorm) {
            return String(nonce);
          }
          nonce++;
          if (nonce > 10000000) {
            throw new Error('PoW search limit exceeded');
          }
        }
      } catch (e) {}
    }

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      while (true) {
        const data = encoder.encode(prefix + nonce);
        const hashBuf = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuf));
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash.padStart(64, '0') < targetNorm) {
          return String(nonce);
        }
        nonce++;
        if (nonce > 10000000) {
          throw new Error('PoW search limit exceeded');
        }
      }
    }

    throw new Error('No crypto provider available for LRCLIB PoW challenge');
  }

  // --- Sequential Rate-Limiting Queue ---
  class SequentialQueue {
    constructor(spacingMs = DEFAULT_MIN_SPACING_MS) {
      this.spacingMs = spacingMs;
      this.lastOutboundTime = 0;
      this._chain = Promise.resolve();
    }

    enqueue(fn) {
      const run = async () => {
        return await fn();
      };
      const result = this._chain.then(run, run);
      this._chain = result.catch(() => {});
      return result;
    }

    async waitForSpacing() {
      const now = Date.now();
      const elapsed = now - this.lastOutboundTime;
      if (elapsed < this.spacingMs) {
        const wait = this.spacingMs - elapsed;
        await new Promise(r => setTimeout(r, wait));
      }
      this.lastOutboundTime = Date.now();
    }
  }

  // --- Core Request Execution with 429/503 Retries ---
  async function _executeFetch(client, url, fetchOptions, attempt = 0) {
    await client.queue.waitForSpacing();

    const fetchImpl = client.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) {
      throw new Error('fetch implementation is not available in current environment');
    }

    let response;
    try {
      response = await fetchImpl(url, fetchOptions);
    } catch (networkErr) {
      if (attempt < client.maxRetries) {
        const delayMs = calculateRetryDelay(null, attempt, client.options);
        await new Promise(r => setTimeout(r, delayMs));
        return _executeFetch(client, url, fetchOptions, attempt + 1);
      }
      throw networkErr;
    }

    if (response.status === 429 || response.status === 503) {
      if (attempt < client.maxRetries) {
        const delayMs = calculateRetryDelay(response, attempt, client.options);
        await new Promise(r => setTimeout(r, delayMs));
        return _executeFetch(client, url, fetchOptions, attempt + 1);
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
      this.queue = new SequentialQueue(this.minSpacingMs);
    }

    fetchWithRetry(url, fetchOptions = {}) {
      return this.queue.enqueue(() => _executeFetch(this, url, fetchOptions, 0));
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

      const firstUrl = buildUrl(Boolean(albumName));
      const firstRes = await this.fetchWithRetry(firstUrl, {
        method: 'GET',
        headers: {
          'Lrclib-Client': this.userAgent,
          'Accept': 'application/json'
        }
      });

      if (firstRes.status === 200) {
        const data = await firstRes.json();
        return normalizeLyricsItem(data);
      }

      // Fallback without albumName if not found (404) and albumName was provided
      if (firstRes.status === 404 && albumName) {
        const fallbackUrl = buildUrl(false);
        const fallbackRes = await this.fetchWithRetry(fallbackUrl, {
          method: 'GET',
          headers: {
            'Lrclib-Client': this.userAgent,
            'Accept': 'application/json'
          }
        });

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

      const qs = params.toString();

      // Try /api/v2/search first
      const v2Url = `${this.baseUrl}/api/v2/search${qs ? `?${qs}` : ''}`;
      let tryFallback = false;

      try {
        const res = await this.fetchWithRetry(v2Url, {
          method: 'GET',
          headers: {
            'Lrclib-Client': this.userAgent,
            'Accept': 'application/json'
          }
        });

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
        tryFallback = true;
      }

      // Fallback to /api/search
      if (tryFallback) {
        const v1Url = `${this.baseUrl}/api/search${qs ? `?${qs}` : ''}`;
        const v1Res = await this.fetchWithRetry(v1Url, {
          method: 'GET',
          headers: {
            'Lrclib-Client': this.userAgent,
            'Accept': 'application/json'
          }
        });

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

    async getLyricsById(id) {
      if (id === undefined || id === null) {
        throw new Error('id is required to get lyrics by id');
      }

      const url = `${this.baseUrl}/api/get/${encodeURIComponent(id)}`;
      const res = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'Lrclib-Client': this.userAgent,
          'Accept': 'application/json'
        }
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

    async publishLyrics(payload) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required to publish lyrics');
      }

      // 1. Request challenge
      const challengeUrl = `${this.baseUrl}/api/request-challenge`;
      const challengeRes = await this.fetchWithRetry(challengeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Lrclib-Client': this.userAgent,
          'Accept': 'application/json'
        }
      });

      if (!challengeRes.ok) {
        throw new Error(`Failed to request challenge: HTTP ${challengeRes.status}`);
      }

      const { prefix, target } = await challengeRes.json();
      if (!prefix || !target) {
        throw new Error('Invalid challenge response: missing prefix or target');
      }

      // 2. Solve PoW via LyricsUtils.solveLrclibPoW(prefix, target)
      let nonce;
      let solver = null;
      if (this.options && typeof this.options.solvePoW === 'function') {
        solver = this.options.solvePoW;
      } else if (this.options && this.options.lyricsUtils && typeof this.options.lyricsUtils.solveLrclibPoW === 'function') {
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
        nonce = await solver(prefix, target);
      } else {
        nonce = await solveLrclibPoWFallback(prefix, target);
      }

      // 3. Post to /api/publish
      const publishUrl = `${this.baseUrl}/api/publish`;
      const publishRes = await this.fetchWithRetry(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Lrclib-Client': this.userAgent,
          'X-Publish-Token': `${prefix}:${nonce}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
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
  LrclibClient.getLyricsById = (id) => defaultClient.getLyricsById(id);
  LrclibClient.publishLyrics = (payload) => defaultClient.publishLyrics(payload);
  LrclibClient.fetchWithRetry = (url, options) => defaultClient.fetchWithRetry(url, options);

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
