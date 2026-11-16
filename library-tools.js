'use strict';

/**
 * Nocturne Hi-Res Music Player - Library Tools
 * Playlist M3U/M3U8 Import & Export, Online Cover Art Fetcher & Cloud Settings Backup
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LibraryTools = api;
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {

  const ITUNES_SEARCH_API = 'https://itunes.apple.com/search';
  const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
  const COVER_ART_ARCHIVE_API = 'https://coverartarchive.org';
  const COVER_CACHE_DB_NAME = 'nocturne_cover_art_cache';
  const COVER_CACHE_STORE_NAME = 'covers';
  const DEFAULT_TIMEOUT_MS = 6000;
  const DEFAULT_MIN_SPACING_MS = 250;

  // =========================================================================
  // 1. Lightweight In-Memory IndexedDB Fallback (for Node.js & non-IDB envs)
  // =========================================================================
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
      if (name !== COVER_CACHE_STORE_NAME) {
        throw new Error(`NotFoundError: Object store "${name}" not found in memory database`);
      }
      return new MemoryObjectStore(this._map);
    }
  }

  class MemoryIDBDatabase {
    constructor() {
      this.name = COVER_CACHE_DB_NAME;
      this.version = 1;
      this.objectStoreNames = {
        contains: (name) => name === COVER_CACHE_STORE_NAME,
        item: (i) => (i === 0 ? COVER_CACHE_STORE_NAME : null),
        length: 1
      };
      this._data = new Map();
    }
    transaction(storeNames, mode) {
      return new MemoryTransaction(this._data);
    }
    close() {}
  }

  let _coverDbInstance = null;
  let _memoryDbInstance = null;

  function openCoverArtCache(idbFactory) {
    const idb = idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (!idb) {
      if (!_memoryDbInstance) {
        _memoryDbInstance = new MemoryIDBDatabase();
      }
      return Promise.resolve(_memoryDbInstance);
    }

    if (_coverDbInstance && !idbFactory) {
      return Promise.resolve(_coverDbInstance);
    }

    return new Promise((resolve, reject) => {
      let req;
      try {
        req = idb.open(COVER_CACHE_DB_NAME, 1);
      } catch (err) {
        return reject(err);
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(COVER_CACHE_STORE_NAME)) {
          db.createObjectStore(COVER_CACHE_STORE_NAME, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        if (!idbFactory) {
          _coverDbInstance = db;
        }
        resolve(db);
      };

      req.onerror = () => {
        reject(req.error || new Error('Failed to open Cover Art IndexedDB'));
      };
    });
  }

  function normalizeKey(artist, album) {
    const a = String(artist || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const al = String(album || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return `${a}:::${al}`;
  }

  async function getCoverArtFromCache(artist, album, idbFactory) {
    try {
      const db = await openCoverArtCache(idbFactory);
      return new Promise((resolve) => {
        const tx = db.transaction([COVER_CACHE_STORE_NAME], 'readonly');
        const store = tx.objectStore(COVER_CACHE_STORE_NAME);
        const key = normalizeKey(artist, album);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function saveCoverArtToCache(artist, album, coverData, idbFactory) {
    try {
      const db = await openCoverArtCache(idbFactory);
      return new Promise((resolve, reject) => {
        const tx = db.transaction([COVER_CACHE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(COVER_CACHE_STORE_NAME);
        const key = normalizeKey(artist, album);
        const entry = {
          key,
          artist: String(artist || '').trim(),
          album: String(album || '').trim(),
          url: coverData.url || '',
          dataUrl: coverData.dataUrl || '',
          mimeType: coverData.mimeType || 'image/jpeg',
          source: coverData.source || 'online',
          savedAt: Date.now()
        };
        const req = store.put(entry);
        req.onsuccess = () => resolve(entry);
        req.onerror = () => reject(req.error || new Error('Failed to save cover art'));
      });
    } catch (err) {
      return null;
    }
  }

  async function clearCoverArtCache(idbFactory) {
    try {
      const db = await openCoverArtCache(idbFactory);
      return new Promise((resolve, reject) => {
        const tx = db.transaction([COVER_CACHE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(COVER_CACHE_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('Failed to clear cache'));
      });
    } catch (_) {
      return false;
    }
  }

  // =========================================================================
  // 2. Sequential Rate Limiter & Fetch Helper with Timeout
  // =========================================================================
  class RateLimiter {
    constructor(minSpacingMs = DEFAULT_MIN_SPACING_MS) {
      this.minSpacingMs = Math.max(0, Number(minSpacingMs) || DEFAULT_MIN_SPACING_MS);
      this._lastRequestTime = 0;
      this._queue = Promise.resolve();
    }

    enqueue(task) {
      const result = this._queue.then(async () => {
        const now = Date.now();
        const elapsed = now - this._lastRequestTime;
        if (elapsed < this.minSpacingMs) {
          const delay = this.minSpacingMs - elapsed;
          await new Promise(res => setTimeout(res, delay));
        }
        this._lastRequestTime = Date.now();
        return task();
      });
      // Keep queue running even if individual task fails
      this._queue = result.catch(() => {});
      return result;
    }
  }

  const defaultRateLimiter = new RateLimiter(DEFAULT_MIN_SPACING_MS);

  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = null) {
    const fn = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (!fn) throw new Error('No fetch implementation available');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    const combinedOptions = { ...options };
    if (signal && !combinedOptions.signal) {
      combinedOptions.signal = signal;
    }

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        fn(url, combinedOptions),
        timeoutPromise
      ]);
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // =========================================================================
  // 3. High-Res Cover Art Online Fetcher
  // =========================================================================

  /**
   * Cleans album or artist name for search query by stripping brackets, reissue tags, etc.
   */
  function cleanSearchTerm(term) {
    return String(term || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*(?:remaster|deluxe|edition|version|bonus|feat\.|explicit)[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Converts an ArrayBuffer to a base64 DataURI string safely in Node.js and Browser.
   */
  function bufferToDataUrl(arrayBuffer, mimeType = 'image/jpeg') {
    if (!arrayBuffer) return '';
    try {
      if (typeof Buffer !== 'undefined') {
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return `data:${mimeType};base64,${base64}`;
      }
      if (typeof btoa !== 'undefined') {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return `data:${mimeType};base64,${btoa(binary)}`;
      }
    } catch (_) {}
    return '';
  }

  /**
   * Queries iTunes Search API for album cover.
   */
  async function fetchFromItunes(artist, album, options = {}) {
    const fetchImpl = options.fetch;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const cleanArt = cleanSearchTerm(artist);
    const cleanAlb = cleanSearchTerm(album);
    const term = [cleanArt, cleanAlb].filter(Boolean).join(' ');
    if (!term) return null;

    const queryUrl = `${ITUNES_SEARCH_API}?term=${encodeURIComponent(term)}&entity=album&media=music&limit=5`;
    const resp = await fetchWithTimeout(queryUrl, {
      headers: { 'Accept': 'application/json' }
    }, timeoutMs, fetchImpl);

    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    if (!data || !Array.isArray(data.results) || data.results.length === 0) return null;

    // Pick best match by album name similarity or first result
    let best = data.results[0];
    const targetAlbLower = cleanAlb.toLowerCase();
    for (const item of data.results) {
      if (item.collectionName && item.collectionName.toLowerCase().includes(targetAlbLower)) {
        best = item;
        break;
      }
    }

    if (!best || !best.artworkUrl100) return null;

    // Convert standard 100x100 to High-Res (1000x1000 or original)
    const highResUrl = best.artworkUrl100
      .replace(/\/100x100bb\.(jpg|png|webp)/i, '/1000x1000bb.$1')
      .replace(/\/60x60bb\.(jpg|png|webp)/i, '/1000x1000bb.$1');

    return {
      url: highResUrl,
      source: 'itunes',
      artist: best.artistName || artist,
      album: best.collectionName || album
    };
  }

  /**
   * Queries MusicBrainz + Cover Art Archive for album cover.
   */
  async function fetchFromCoverArtArchive(artist, album, options = {}) {
    const fetchImpl = options.fetch;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const cleanArt = cleanSearchTerm(artist);
    const cleanAlb = cleanSearchTerm(album);
    if (!cleanAlb) return null;

    let query = `release:"${cleanAlb.replace(/"/g, '')}"`;
    if (cleanArt) {
      query += ` AND artist:"${cleanArt.replace(/"/g, '')}"`;
    }

    const mbUrl = `${MUSICBRAINZ_API}/release?query=${encodeURIComponent(query)}&fmt=json&limit=3`;
    const mbResp = await fetchWithTimeout(mbUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Nocturne-HiRes-Player/2.0 (https://github.com/tranbienhao1/thiennguyen)'
      }
    }, timeoutMs, fetchImpl);

    if (!mbResp || !mbResp.ok) return null;
    const mbData = await mbResp.json();
    if (!mbData || !Array.isArray(mbData.releases) || mbData.releases.length === 0) return null;

    const mbid = mbData.releases[0].id;
    if (!mbid) return null;

    // Query Cover Art Archive release endpoint
    const caaUrl = `${COVER_ART_ARCHIVE_API}/release/${mbid}`;
    const caaResp = await fetchWithTimeout(caaUrl, {
      headers: { 'Accept': 'application/json' }
    }, timeoutMs, fetchImpl);

    if (!caaResp || !caaResp.ok) return null;
    const caaData = await caaResp.json();
    if (!caaData || !Array.isArray(caaData.images) || caaData.images.length === 0) return null;

    const frontImage = caaData.images.find(img => img.front) || caaData.images[0];
    if (!frontImage) return null;

    const highResUrl = (frontImage.thumbnails && (frontImage.thumbnails['1200'] || frontImage.thumbnails['500']))
      || frontImage.image;

    return {
      url: highResUrl,
      source: 'coverartarchive',
      artist,
      album
    };
  }

  /**
   * Main function: fetchCoverArtOnline(artist, album, options)
   * Queries Cover Art Archive / iTunes Search API with timeout and rate limiting.
   * Caches retrieved album artwork Blobs/DataURIs in IndexedDB.
   */
  async function fetchCoverArtOnline(artist, album, options = {}) {
    const art = String(artist || '').trim();
    const alb = String(album || '').trim();

    if (!art && !alb) {
      return {
        success: false,
        url: null,
        dataUrl: null,
        error: 'Artist or album must be specified'
      };
    }

    const idbFactory = options.idbFactory;
    const skipCache = Boolean(options.skipCache);
    const rateLimiter = options.rateLimiter || defaultRateLimiter;
    const prefer = options.prefer || 'itunes'; // 'itunes' | 'coverartarchive' | 'both'
    const downloadImage = options.downloadImage !== false;

    // 1. Check IndexedDB cache first
    if (!skipCache) {
      const cached = await getCoverArtFromCache(art, alb, idbFactory);
      if (cached && (cached.url || cached.dataUrl)) {
        return {
          success: true,
          url: cached.url,
          dataUrl: cached.dataUrl,
          mimeType: cached.mimeType || 'image/jpeg',
          source: 'cache',
          artist: art,
          album: alb,
          cached: true
        };
      }
    }

    // 2. Fetch online via rate-limited queue
    let onlineResult = null;
    try {
      onlineResult = await rateLimiter.enqueue(async () => {
        if (prefer === 'coverartarchive') {
          return (await fetchFromCoverArtArchive(art, alb, options)) || (await fetchFromItunes(art, alb, options));
        }
        return (await fetchFromItunes(art, alb, options)) || (await fetchFromCoverArtArchive(art, alb, options));
      });
    } catch (err) {
      return {
        success: false,
        url: null,
        dataUrl: null,
        error: `Network search error: ${err.message || err}`,
        artist: art,
        album: alb
      };
    }

    if (!onlineResult || !onlineResult.url) {
      return {
        success: false,
        url: null,
        dataUrl: null,
        error: 'No cover art found online',
        artist: art,
        album: alb
      };
    }

    // 3. Download image bytes to create Blob & DataURI for offline storage
    let dataUrl = '';
    let mimeType = 'image/jpeg';
    let blob = null;

    if (downloadImage && options.fetch) {
      try {
        const imgResp = await fetchWithTimeout(onlineResult.url, {}, options.timeoutMs || DEFAULT_TIMEOUT_MS, options.fetch);
        if (imgResp && imgResp.ok) {
          mimeType = (imgResp.headers && imgResp.headers.get('content-type')) || 'image/jpeg';
          const buffer = await imgResp.arrayBuffer();
          dataUrl = bufferToDataUrl(buffer, mimeType);
          if (typeof Blob !== 'undefined') {
            blob = new Blob([buffer], { type: mimeType });
          }
        }
      } catch (_) {
        // Image download failed, fallback to url only
      }
    }

    const finalCover = {
      url: onlineResult.url,
      dataUrl,
      blob,
      mimeType,
      source: onlineResult.source
    };

    // 4. Cache in IndexedDB
    await saveCoverArtToCache(art, alb, finalCover, idbFactory);

    return {
      success: true,
      url: finalCover.url,
      dataUrl: finalCover.dataUrl,
      blob: finalCover.blob,
      mimeType: finalCover.mimeType,
      source: finalCover.source,
      artist: art,
      album: alb,
      cached: false
    };
  }

  // =========================================================================
  // 4. Playlist M3U/M3U8 Management
  // =========================================================================

  /**
   * Generates valid #EXTM3U content with #EXTINF:duration,artist - title and track URLs/paths.
   * @param {string} name - Playlist name
   * @param {Array<Object>} tracks - Array of track objects
   * @param {Object} [options] - Options
   * @returns {string} M3U/M3U8 formatted string
   */
  function exportPlaylistM3U(name, tracks, options = {}) {
    const list = Array.isArray(tracks) ? tracks : [];
    const playlistName = String(name || options.name || 'Nocturne Playlist').trim();
    const includeExtended = options.includeExtendedTags !== false;
    const lineEnding = options.crlf ? '\r\n' : '\n';

    const lines = [
      '#EXTM3U',
      '#EXTENC:UTF-8',
      `#PLAYLIST:${playlistName}`
    ];

    for (let i = 0; i < list.length; i++) {
      const track = list[i];
      if (!track || typeof track !== 'object') continue;

      let dur = -1;
      if (Number.isFinite(track.duration)) {
        dur = Math.round(Number(track.duration));
      }

      const artist = String(track.artist || 'Unknown Artist').trim();
      const title = String(track.title || track.name || `Track ${i + 1}`).trim();
      lines.push(`#EXTINF:${dur},${artist} - ${title}`);

      if (includeExtended) {
        if (track.album && track.album !== 'Unknown Album') {
          lines.push(`#EXTALBUM:${String(track.album).trim()}`);
        }
        if (track.format) {
          lines.push(`#EXTFORMAT:${String(track.format).trim().toUpperCase()}`);
        }
        if (track.id) {
          lines.push(`#EXTID:${String(track.id).trim()}`);
        }
      }

      const pathOrUrl = track.url || track.path || track.file || track.src || (track.id ? `${track.id}.mp3` : `track_${i + 1}.mp3`);
      lines.push(String(pathOrUrl).trim());
    }

    return lines.join(lineEnding) + lineEnding;
  }

  /**
   * Parses #EXTINF metadata and track entries from M3U / M3U8 playlist content.
   * @param {string} content - Raw M3U/M3U8 text
   * @param {Object} [options] - Parsing options
   * @returns {Object} Parsed result: { isValid, name, trackCount, tracks, error }
   */
  function parseM3UPlaylist(content, options = {}) {
    if (typeof content !== 'string' || !content.trim()) {
      return {
        isValid: false,
        name: '',
        trackCount: 0,
        tracks: [],
        error: 'Nội dung playlist M3U rỗng hoặc không hợp lệ'
      };
    }

    // Strip BOM if present
    const clean = content.replace(/^\uFEFF/, '').trim();
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let isM3u = false;
    let playlistName = String(options.defaultName || 'Nocturne Playlist').trim();
    const tracks = [];

    // Temporary metadata container for current track entry
    let curMeta = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTM3U')) {
        isM3u = true;
        continue;
      }

      if (line.startsWith('#PLAYLIST:')) {
        isM3u = true;
        playlistName = line.slice(10).trim();
        continue;
      }

      if (line.startsWith('#EXTINF:')) {
        isM3u = true;
        curMeta = curMeta || {};
        const colonIdx = line.indexOf(':');
        const rest = line.slice(colonIdx + 1).trim();
        const commaIdx = rest.indexOf(',');

        if (commaIdx !== -1) {
          const durationStr = rest.slice(0, commaIdx).trim().split(/\s+/)[0];
          const dur = parseFloat(durationStr);
          curMeta.duration = Number.isFinite(dur) ? Math.round(dur) : -1;

          const infoStr = rest.slice(commaIdx + 1).trim();
          const hyphenIdx = infoStr.indexOf(' - ');
          if (hyphenIdx !== -1) {
            curMeta.artist = infoStr.slice(0, hyphenIdx).trim();
            curMeta.title = infoStr.slice(hyphenIdx + 3).trim();
          } else {
            curMeta.artist = 'Unknown Artist';
            curMeta.title = infoStr;
          }
        } else {
          curMeta.duration = -1;
          curMeta.artist = 'Unknown Artist';
          curMeta.title = rest;
        }
        continue;
      }

      if (line.startsWith('#EXTALBUM:')) {
        curMeta = curMeta || {};
        curMeta.album = line.slice(10).trim();
        continue;
      }

      if (line.startsWith('#EXTFORMAT:')) {
        curMeta = curMeta || {};
        curMeta.format = line.slice(11).trim().toUpperCase();
        continue;
      }

      if (line.startsWith('#EXTID:')) {
        curMeta = curMeta || {};
        curMeta.id = line.slice(7).trim();
        continue;
      }

      // Ignore other comment tags starting with '#'
      if (line.startsWith('#')) {
        continue;
      }

      // Non-comment line: Track URI / Path
      const urlOrPath = line;
      const meta = curMeta;
      curMeta = null;

      const AUDIO_EXT_REGEX = /\.(mp3|flac|wav|dsf|dff|m4a|aac|ogg|opus|alac|aif|aiff|wma|ape|wv)(?:\?.*)?$/i;
      const isAudioUrl = urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('file://');
      const hasAudioExt = AUDIO_EXT_REGEX.test(urlOrPath);

      // If no #EXTM3U or #EXTINF tag has been seen, require lines to have an audio extension or URL scheme
      if (!isM3u && !meta && !hasAudioExt && !isAudioUrl) {
        continue;
      }

      // Extract filename without extension for fallback title
      const baseFilename = urlOrPath.split(/[\/\\]/).pop().split('?')[0] || `track_${tracks.length + 1}`;
      const nameWithoutExt = baseFilename.replace(/\.[a-z0-9]+$/i, '');

      const trackEntry = {
        id: (meta && meta.id) || `m3u_${tracks.length + 1}`,
        title: (meta && meta.title) || nameWithoutExt || 'Untitled',
        artist: (meta && meta.artist) || 'Unknown Artist',
        album: (meta && meta.album) || 'Unknown Album',
        duration: (meta && Number.isFinite(meta.duration)) ? meta.duration : -1,
        url: urlOrPath,
        file: urlOrPath,
        path: urlOrPath,
        format: (meta && meta.format) || (urlOrPath.match(/\.([a-z0-9]+)(?:\?.*)?$/i)?.[1]?.toUpperCase() || 'AUDIO')
      };

      tracks.push(trackEntry);
    }

    // Must have either an explicit M3U header/tag or at least one recognized audio track
    if ((!isM3u && tracks.length === 0) || tracks.length === 0) {
      return {
        isValid: false,
        name: '',
        trackCount: 0,
        tracks: [],
        error: 'Tệp không chứa tiêu đề #EXTM3U hoặc danh sách bài hát hợp lệ'
      };
    }

    return {
      isValid: true,
      name: playlistName,
      trackCount: tracks.length,
      tracks,
      error: null
    };
  }

  // =========================================================================
  // 5. Cloud & Local Settings Sync (Backup & Safe Restore)
  // =========================================================================

  /**
   * Exports PEQ presets, favorites, custom lyrics, and playback preferences to formatted JSON.
   * @param {Object} state - Player application state
   * @param {Object} [options] - Export options
   * @returns {string} Formatted JSON string
   */
  function exportUserSettings(state = {}, options = {}) {
    const s = state || {};

    // 1. PEQ Settings & Presets
    const peqBands = Array.isArray(s.bands) ? s.bands.map(b => ({
      id: b.id,
      freq: Number(b.freq) || 1000,
      gain: Number(b.gain) || 0,
      q: Number(b.q) || 1.0,
      type: b.type || 'peaking',
      enabled: b.enabled !== false
    })) : [];

    const peqPresets = Array.isArray(s.eqPresets) ? s.eqPresets : (
      Array.isArray(s.userEqPresets) ? s.userEqPresets : []
    );

    const peq = {
      enabled: Boolean(s.eqEnabled),
      preamp: Number(s.eqPreamp || s.preampGain || 0),
      bands: peqBands,
      presets: peqPresets
    };

    // 2. Favorites & Ratings
    const favorites = s.favorites instanceof Set
      ? Array.from(s.favorites)
      : (Array.isArray(s.favorites) ? s.favorites : []);

    const trackRatings = (s.trackRatings && typeof s.trackRatings === 'object')
      ? { ...s.trackRatings }
      : {};

    // 3. Custom Lyrics
    let customLyrics = {};
    if (s.customLyrics && typeof s.customLyrics === 'object') {
      customLyrics = { ...s.customLyrics };
    } else if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('nocturne-custom-lyrics');
        if (raw) customLyrics = JSON.parse(raw);
      } catch (_) {}
    }

    // 4. Playback Preferences & DSP
    const playbackPreferences = {
      crossfadeSeconds: Number.isFinite(Number(s.crossfadeSeconds)) ? Number(s.crossfadeSeconds) : 0,
      crossfadeCurve: s.crossfadeCurve || 'equal-power',
      crossfeed: Number.isFinite(Number(s.crossfeed)) ? Number(s.crossfeed) : 0,
      crossfeedPreset: s.crossfeedPreset || 'bauer',
      toneBass: Number.isFinite(Number(s.toneBass)) ? Number(s.toneBass) : 0,
      toneTreble: Number.isFinite(Number(s.toneTreble)) ? Number(s.toneTreble) : 0,
      stereoBalance: Number.isFinite(Number(s.stereoBalance)) ? Number(s.stereoBalance) : 0,
      replayGainEnabled: Boolean(s.replayGainEnabled),
      replayGainMode: s.replayGainMode || 'track',
      loudnessStandard: s.loudnessStandard || 'audiophile-album',
      roomAcousticProfile: s.roomAcousticProfile || 'bypass',
      roomAcousticWet: Number.isFinite(Number(s.roomAcousticWet)) ? Number(s.roomAcousticWet) : 0.2,
      subBassPunchProfile: s.subBassPunchProfile || 'off',
      subBassPunchIntensity: Number.isFinite(Number(s.subBassPunchIntensity)) ? Number(s.subBassPunchIntensity) : 1.0,
      subBassPhaseProfile: s.subBassPhaseProfile || 'bypass',
      tubeEmulationProfile: s.tubeEmulationProfile || 'off',
      dsdUltrasonicFilter: s.dsdUltrasonicFilter || 'bypass',
      limiterMode: s.limiterMode || 'transparent',
      visualizerTheme: s.visualizerTheme || 'cyber',
      visualizerMode: s.visualizerMode || 'spectrum',
      visualizerStrobeEnabled: s.visualizerStrobeEnabled !== false,
      ambientStageMode: s.ambientStageMode || 'reactive',
      bitPerfectEnabled: Boolean(s.bitPerfectEnabled),
      shuffle: Boolean(s.shuffle),
      repeat: Number(s.repeat) || 0,
      autoplay: s.autoplay !== false,
      roonRadio: s.roonRadio !== false
    };

    const payload = {
      app: 'nocturne',
      type: 'user-settings-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      peq,
      favorites,
      trackRatings,
      customLyrics,
      playbackPreferences
    };

    const indent = Number.isInteger(options.indent) ? options.indent : 2;
    return JSON.stringify(payload, null, indent);
  }

  /**
   * Safely validates and restores settings from JSON string into player state.
   * @param {string} jsonString - Settings JSON string
   * @param {Object} state - Target state to restore settings into
   * @param {Object} [options] - Options (e.g., persist to localStorage)
   * @returns {Object} Result: { isValid, restoredCount, settings, error }
   */
  function importUserSettings(jsonString, state = {}, options = {}) {
    if (typeof jsonString !== 'string' || !jsonString.trim()) {
      return {
        isValid: false,
        restoredCount: null,
        settings: null,
        error: 'Chuỗi JSON cài đặt rỗng hoặc không hợp lệ'
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      return {
        isValid: false,
        restoredCount: null,
        settings: null,
        error: `Lỗi phân tích cú pháp JSON: ${e.message}`
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        isValid: false,
        restoredCount: null,
        settings: null,
        error: 'Dữ liệu sao lưu không phải là một đối tượng JSON hợp lệ'
      };
    }

    const hasApp = parsed.app === 'nocturne' || parsed.appName === 'Nocturne';
    const hasRecognizedSection = parsed.peq || parsed.playbackPreferences || parsed.settings || parsed.favorites || parsed.customLyrics;
    if (!hasApp && !hasRecognizedSection) {
      return {
        isValid: false,
        restoredCount: null,
        settings: null,
        error: 'File không chứa cấu hình hợp lệ của ứng dụng Nocturne'
      };
    }

    // 1. Sanitize & validate PEQ
    const rawPeq = parsed.peq || {};
    const sanitizedBands = [];
    if (Array.isArray(rawPeq.bands)) {
      for (const b of rawPeq.bands) {
        if (!b || typeof b !== 'object') continue;
        const freq = Math.min(22000, Math.max(20, Number(b.freq) || 1000));
        const gain = Math.min(24, Math.max(-24, Number(b.gain) || 0));
        const q = Math.min(30, Math.max(0.1, Number(b.q) || 1.0));
        const type = ['peaking', 'lowshelf', 'highshelf', 'notch', 'bandpass', 'lowpass', 'highpass'].includes(b.type)
          ? b.type
          : 'peaking';
        sanitizedBands.push({
          id: b.id || `band_${sanitizedBands.length + 1}`,
          freq,
          gain,
          q,
          type,
          enabled: b.enabled !== false
        });
      }
    }

    const sanitizedPeqPresets = Array.isArray(rawPeq.presets) ? rawPeq.presets : [];
    const sanitizedPeq = {
      enabled: Boolean(rawPeq.enabled),
      preamp: Math.min(12, Math.max(-24, Number(rawPeq.preamp) || 0)),
      bands: sanitizedBands,
      presets: sanitizedPeqPresets
    };

    // 2. Sanitize & validate Favorites & Ratings
    const rawFavs = Array.isArray(parsed.favorites) ? parsed.favorites : [];
    const sanitizedFavorites = rawFavs
      .filter(f => typeof f === 'string' || typeof f === 'number')
      .map(String);

    const rawRatings = (parsed.trackRatings && typeof parsed.trackRatings === 'object') ? parsed.trackRatings : {};
    const sanitizedRatings = {};
    for (const [k, v] of Object.entries(rawRatings)) {
      const num = Number(v);
      if (Number.isFinite(num) && num >= 1 && num <= 5) {
        sanitizedRatings[k] = Math.round(num);
      }
    }

    // 3. Sanitize Custom Lyrics
    const rawLyrics = (parsed.customLyrics && typeof parsed.customLyrics === 'object') ? parsed.customLyrics : {};
    const sanitizedCustomLyrics = {};
    for (const [k, v] of Object.entries(rawLyrics)) {
      if (typeof v === 'string') {
        sanitizedCustomLyrics[k] = v;
      }
    }

    // 4. Sanitize Playback Preferences (supports both 'playbackPreferences' and legacy 'settings')
    const rawPrefs = parsed.playbackPreferences || parsed.settings || {};
    const sanitizedPrefs = {
      crossfadeSeconds: Math.min(15, Math.max(0, Number(rawPrefs.crossfadeSeconds) || 0)),
      crossfadeCurve: ['equal-power', 'linear', 'exponential', 's-curve', 'sub-bass-blend'].includes(rawPrefs.crossfadeCurve)
        ? rawPrefs.crossfadeCurve
        : 'equal-power',
      crossfeed: Math.min(1, Math.max(0, Number(rawPrefs.crossfeed) || 0)),
      crossfeedPreset: String(rawPrefs.crossfeedPreset || 'bauer'),
      toneBass: Math.min(12, Math.max(-12, Number(rawPrefs.toneBass) || 0)),
      toneTreble: Math.min(12, Math.max(-12, Number(rawPrefs.toneTreble) || 0)),
      stereoBalance: Math.min(1, Math.max(-1, Number(rawPrefs.stereoBalance) || 0)),
      replayGainEnabled: Boolean(rawPrefs.replayGainEnabled),
      replayGainMode: ['track', 'album'].includes(rawPrefs.replayGainMode) ? rawPrefs.replayGainMode : 'track',
      loudnessStandard: String(rawPrefs.loudnessStandard || 'audiophile-album'),
      roomAcousticProfile: String(rawPrefs.roomAcousticProfile || 'bypass'),
      roomAcousticWet: Math.min(1, Math.max(0, Number.isFinite(Number(rawPrefs.roomAcousticWet)) ? Number(rawPrefs.roomAcousticWet) : 0.2)),
      subBassPunchProfile: String(rawPrefs.subBassPunchProfile || 'off'),
      subBassPunchIntensity: Math.min(3, Math.max(0, Number.isFinite(Number(rawPrefs.subBassPunchIntensity)) ? Number(rawPrefs.subBassPunchIntensity) : 1.0)),
      subBassPhaseProfile: String(rawPrefs.subBassPhaseProfile || 'bypass'),
      tubeEmulationProfile: String(rawPrefs.tubeEmulationProfile || 'off'),
      dsdUltrasonicFilter: String(rawPrefs.dsdUltrasonicFilter || 'bypass'),
      limiterMode: String(rawPrefs.limiterMode || 'transparent'),
      visualizerTheme: String(rawPrefs.visualizerTheme || 'cyber'),
      visualizerMode: String(rawPrefs.visualizerMode || 'spectrum'),
      visualizerStrobeEnabled: rawPrefs.visualizerStrobeEnabled !== false,
      ambientStageMode: String(rawPrefs.ambientStageMode || 'reactive'),
      bitPerfectEnabled: Boolean(rawPrefs.bitPerfectEnabled),
      shuffle: Boolean(rawPrefs.shuffle),
      repeat: [0, 1, 2].includes(Number(rawPrefs.repeat)) ? Number(rawPrefs.repeat) : 0,
      autoplay: rawPrefs.autoplay !== false,
      roonRadio: rawPrefs.roonRadio !== false
    };

    // 5. Restore into target state
    let restoredFavCount = 0;
    if (state) {
      if (state.favorites instanceof Set) {
        for (const fav of sanitizedFavorites) {
          if (!state.favorites.has(fav)) {
            state.favorites.add(fav);
            restoredFavCount++;
          }
        }
      } else if (Array.isArray(state.favorites)) {
        state.favorites = sanitizedFavorites;
        restoredFavCount = sanitizedFavorites.length;
      } else {
        state.favorites = new Set(sanitizedFavorites);
        restoredFavCount = sanitizedFavorites.length;
      }

      state.trackRatings = { ...(state.trackRatings || {}), ...sanitizedRatings };
      state.customLyrics = { ...(state.customLyrics || {}), ...sanitizedCustomLyrics };

      if (sanitizedBands.length > 0) {
        state.bands = sanitizedBands;
      }
      if (sanitizedPeqPresets.length > 0) {
        state.eqPresets = sanitizedPeqPresets;
      }
      if (typeof sanitizedPeq.enabled === 'boolean') {
        state.eqEnabled = sanitizedPeq.enabled;
      }
      if (typeof sanitizedPeq.preamp === 'number') {
        state.eqPreamp = sanitizedPeq.preamp;
      }

      // Assign playback preferences to state
      for (const [k, v] of Object.entries(sanitizedPrefs)) {
        state[k] = v;
      }
    }

    // 6. Optional localStorage persistence
    if (options.persist !== false && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('nocturne-track-ratings', JSON.stringify(state ? state.trackRatings : sanitizedRatings));
        localStorage.setItem('nocturne-crossfade', sanitizedPrefs.crossfadeSeconds);
        localStorage.setItem('nocturne-crossfade-curve', sanitizedPrefs.crossfadeCurve);
        localStorage.setItem('nocturne-crossfeed', sanitizedPrefs.crossfeed);
        localStorage.setItem('nocturne-crossfeed-preset', sanitizedPrefs.crossfeedPreset);
        localStorage.setItem('nocturne-tone-bass', sanitizedPrefs.toneBass);
        localStorage.setItem('nocturne-tone-treble', sanitizedPrefs.toneTreble);
        localStorage.setItem('nocturne-stereo-balance', sanitizedPrefs.stereoBalance);
        localStorage.setItem('nocturne-room-acoustics-profile', sanitizedPrefs.roomAcousticProfile);
        localStorage.setItem('nocturne-room-acoustics-wet', String(sanitizedPrefs.roomAcousticWet));
        localStorage.setItem('nocturne-sub-bass-punch', sanitizedPrefs.subBassPunchProfile);
        localStorage.setItem('nocturne-sub-bass-intensity', String(sanitizedPrefs.subBassPunchIntensity));
        localStorage.setItem('nocturne-sub-bass-phase', sanitizedPrefs.subBassPhaseProfile);
        localStorage.setItem('nocturne-tube-emulation', sanitizedPrefs.tubeEmulationProfile);
        localStorage.setItem('nocturne-dsd-ultrasonic-filter', sanitizedPrefs.dsdUltrasonicFilter);
        localStorage.setItem('nocturne-limiter-mode', sanitizedPrefs.limiterMode);
        localStorage.setItem('nocturne-visualizer-theme', sanitizedPrefs.visualizerTheme);
        localStorage.setItem('nocturne-visualizer-mode', sanitizedPrefs.visualizerMode);
        localStorage.setItem('nocturne-visualizer-strobe', String(sanitizedPrefs.visualizerStrobeEnabled));
        localStorage.setItem('nocturne-ambient-stage-mode', sanitizedPrefs.ambientStageMode);
        if (Object.keys(sanitizedCustomLyrics).length > 0) {
          localStorage.setItem('nocturne-custom-lyrics', JSON.stringify(sanitizedCustomLyrics));
        }
      } catch (_) {}
    }

    const restoredCount = {
      favorites: restoredFavCount || sanitizedFavorites.length,
      ratings: Object.keys(sanitizedRatings).length,
      peqBands: sanitizedBands.length,
      peqPresets: sanitizedPeqPresets.length,
      customLyrics: Object.keys(sanitizedCustomLyrics).length,
      preferences: Object.keys(sanitizedPrefs).length
    };

    return {
      isValid: true,
      restoredCount,
      settings: {
        peq: sanitizedPeq,
        favorites: sanitizedFavorites,
        trackRatings: sanitizedRatings,
        customLyrics: sanitizedCustomLyrics,
        playbackPreferences: sanitizedPrefs
      },
      error: null
    };
  }

  // =========================================================================
  // Expose API
  // =========================================================================
  return {
    // Playlist M3U
    exportPlaylistM3U,
    parseM3UPlaylist,

    // Cover Art
    fetchCoverArtOnline,
    openCoverArtCache,
    getCoverArtFromCache,
    saveCoverArtToCache,
    clearCoverArtCache,
    cleanSearchTerm,
    bufferToDataUrl,
    RateLimiter,

    // Settings Sync
    exportUserSettings,
    importUserSettings,

    // Constants
    ITUNES_SEARCH_API,
    MUSICBRAINZ_API,
    COVER_ART_ARCHIVE_API,
    COVER_CACHE_DB_NAME,
    COVER_CACHE_STORE_NAME
  };
});
