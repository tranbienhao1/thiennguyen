'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneLibrary = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const UNKNOWN_ARTIST = 'Nghệ sĩ không xác định';
  const UNKNOWN_ALBUM = '—';
  const normalize = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const metadataKey = value => normalize(value).normalize('NFKC').toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/đ/gu, 'd');
  const PLACEHOLDERS = new Set(['', '-', '—', '?', 'unknown', 'unknown artist', 'unknown album', 'n/a', 'na', 'none', 'null', '(unknown)']);

  function cleanMetadataValue(value, fallback = '') {
    const cleaned = normalize(value);
    return PLACEHOLDERS.has(metadataKey(cleaned)) ? fallback : cleaned;
  }

  function stripTrackPrefix(value) {
    return normalize(value).replace(/^(?:(?:cd|disc|disk)\s*\d+\s*[-_. ]+)?\d{1,3}\s*[-–—._]\s*/i, '').trim();
  }

  function firstMetadataValue(...values) {
    for (const value of values) {
      const candidate = Array.isArray(value) ? value[0] : value && typeof value === 'object' ? value.text || value.value || value.name || value.no || value.number : value;
      const cleaned = cleanMetadataValue(candidate, '');
      if (cleaned) return cleaned;
    }
    return '';
  }

  function stripMatchingTrackNumber(value, trackNumber) {
    const candidate = Array.isArray(trackNumber) ? trackNumber[0] : trackNumber && typeof trackNumber === 'object' ? trackNumber.text || trackNumber.value || trackNumber.no || trackNumber.number : trackNumber;
    const number = String(candidate ?? '').match(/\d+/)?.[0];
    if (!number) return normalize(value);
    return normalize(value).replace(/^(\d{1,3})(?=\s|[-–—._])(?:\s*[-–—._]\s*|\s+)/, (prefix, digits) => Number(digits) === Number(number) ? '' : prefix);
  }

  function stripLeadingTrackNumber(value) {
    const text = normalize(value).replace(/^0\d{1,2}(?:\s+|[-_.\s]\s*)/, '');
    return stripTrackPrefix(text);
  }

  function primaryArtistName(value, fallback = UNKNOWN_ARTIST, trackNumber = '') {
    let text = stripLeadingTrackNumber(stripMatchingTrackNumber(value, trackNumber));
    if (!text) return fallback;
    text = text.replace(/\s*[[(]\s*(?:feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]/i, '').trim();
    const collaboration = text.search(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/i);
    if (collaboration > 0) text = text.slice(0, collaboration).trim();
    const duet = text.search(/\s+[x×&+]\s+/);
    if (duet > 0) text = text.slice(0, duet).trim();
    const and = text.search(/\s+(?:and|và)\s+/i);
    if (and > 0) text = text.slice(0, and).trim();
    const first = String(text.split(/\s*[,;|]\s*/)[0] || '').trim();
    const cleaned = cleanMetadataValue(stripLeadingTrackNumber(first), '');
    return cleaned || fallback;
  }

  function primaryAlbumName(value, fallback = UNKNOWN_ALBUM) {
    return cleanMetadataValue(stripLeadingTrackNumber(value), fallback);
  }

  function parseFilenameMetadata(filename, trackNumber = '') {
    const pathParts = normalize(filename).replace(/\\/g, '/').split('/').filter(Boolean);
    const originalName = pathParts.pop() || '';
    const rawBaseName = originalName.replace(/\.[^.]+$/, '');
    const trackNumberCandidate = Array.isArray(trackNumber) ? trackNumber[0] : trackNumber && typeof trackNumber === 'object' ? trackNumber.text || trackNumber.value || trackNumber.no || trackNumber.number : trackNumber;
    const taggedTrackNumber = String(trackNumberCandidate ?? '').match(/\d+/)?.[0] || '';
    const numberedBaseName = stripMatchingTrackNumber(rawBaseName, trackNumber);
    const baseName = numberedBaseName === rawBaseName ? stripTrackPrefix(rawBaseName) : numberedBaseName;
    const parts = baseName.split(/\s+[–—-]\s+/).map(stripTrackPrefix).filter(Boolean);
    const hasOuterTrackPrefix = /^(?:0\d{1,2})(?:\s+|[-_.\s]\s*)/.test(rawBaseName);
    const numberedArtistPrefix = parts[0] && parts[0].match(/^(1[0-9]|2[0-4])\s+(?=\S)/);
    if (parts.length >= 2 && !hasOuterTrackPrefix && numberedArtistPrefix && (!taggedTrackNumber || Number(numberedArtistPrefix[1]) === Number(taggedTrackNumber))) {
      parts[0] = parts[0].slice(numberedArtistPrefix[0].length);
    }
    const metadataFolders = pathParts.filter(part => !/^(?:cd|disc|disk)\s*\d+$/i.test(normalize(part)));
    const folderArtist = metadataFolders.length >= 2 ? primaryArtistName(metadataFolders[metadataFolders.length - 2], '') : '';
    const folderAlbum = metadataFolders.length >= 2 ? primaryAlbumName(metadataFolders[metadataFolders.length - 1], '') : '';
    if (parts.length >= 2) {
      const title = cleanMetadataValue(parts[parts.length - 1], 'Bài hát không tên');
      return {
        title,
        artist:primaryArtistName(parts[0], folderArtist || UNKNOWN_ARTIST),
        album:parts.length > 2 ? primaryAlbumName(parts.slice(1, -1).join(' - '), folderAlbum || UNKNOWN_ALBUM) : (folderAlbum || UNKNOWN_ALBUM)
      };
    }
    return {
      title:cleanMetadataValue(baseName, 'Bài hát không tên'),
      artist:folderArtist || UNKNOWN_ARTIST,
      album:folderAlbum || UNKNOWN_ALBUM
    };
  }

  function resolveTrackMetadata(tags = {}, fallback = {}) {
    const fallbackMetadata = {
      title:cleanMetadataValue(fallback.title, 'Bài hát không tên'),
      artist:primaryArtistName(fallback.artist),
      album:primaryAlbumName(fallback.album)
    };
    const trackNumber = firstMetadataValue(tags.track, tags.tracknumber, tags.trackNumber, tags.TRACKNUMBER, tags.TRCK);
    const title = firstMetadataValue(tags.title, tags.titles, tags.TITLE, tags.TIT2);
    const artist = firstMetadataValue(tags.artist, tags.artists, tags.artistName, tags.artist_name, tags.ARTIST, tags.TPE1);
    const albumArtist = firstMetadataValue(tags.albumartist, tags.albumArtist, tags.album_artist, tags.album_artist_name, tags.ALBUMARTIST, tags.TPE2);
    const albumTag = tags.album ?? tags.albums ?? tags.ALBUM ?? tags.TALB;
    const album = Array.isArray(albumTag) ? albumTag[0] : albumTag && typeof albumTag === 'object' ? albumTag.text || albumTag.value || albumTag.name : albumTag;
    return {
      title:cleanMetadataValue(stripMatchingTrackNumber(title, trackNumber), fallbackMetadata.title),
      artist:primaryArtistName(artist, primaryArtistName(albumArtist, fallbackMetadata.artist, trackNumber), trackNumber),
      album:primaryAlbumName(album, fallbackMetadata.album)
    };
  }

  const AUDIO_MIME_TYPES = {
    flac:'audio/flac', wav:'audio/wav', mp3:'audio/mpeg', mp2:'audio/mpeg',
    m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', opus:'audio/ogg',
    aiff:'audio/aiff', aif:'audio/aiff', alac:'audio/alac', wma:'audio/x-ms-wma'
  };

  function normalizeAudioBlob(blob, filename, fallbackType = '') {
    if (!blob || typeof blob.slice !== 'function') throw new TypeError('Cần một Blob âm thanh hợp lệ.');
    const currentType = normalize(blob.type).split(';')[0].toLowerCase();
    if (currentType.startsWith('audio/')) return blob;
    const fallback = normalize(fallbackType).split(';')[0].toLowerCase();
    const extension = normalize(filename).split(/[\\/]/).pop().match(/\.([^.]+)$/);
    const type = fallback.startsWith('audio/') ? fallback : extension && AUDIO_MIME_TYPES[extension[1].toLowerCase()];
    return type ? new Blob([blob], {type}) : blob;
  }

  // Pha C — thử lại khi mạng chập chờn (cấp số nhân): lỗi mạng (fetch ném)
  // và HTTP 429/5xx được thử lại tối đa 3 lần, trễ 400 ms rồi 800 ms;
  // 401/403 (hết hạn token, tầng trên tự làm mới), 404, sai content-type
  // hay blob rỗng là lỗi xác định nên rớt ngay không thử lại.
  const FETCH_AUDIO_MAX_ATTEMPTS = 3;
  const FETCH_AUDIO_RETRY_BASE_MS = 400;
  function fetchAudioRetryDelayMs(attempt) { return FETCH_AUDIO_RETRY_BASE_MS * (2 ** attempt); }
  function isFetchAudioRetryable(error) {
    if (!error || typeof error !== 'object') return false;
    if (error.retryable === true) return true;
    return Number.isInteger(error.status) && (error.status === 429 || error.status >= 500);
  }
  async function fetchAudioResponse(url, options, provider) {
    let response;
    try { response = await fetch(url, options); }
    catch (error) { const wrapped = new Error(`${provider} không thể tải âm thanh. Kiểm tra kết nối, quyền truy cập và cấu hình CORS rồi thử lại. (${error.message || error})`); wrapped.retryable = true; throw wrapped; }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 240); } catch (_) {}
      const error = new Error(`${provider} tải âm thanh thất bại (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const contentType = (response.headers && response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('audio/') && !['application/octet-stream','application/ogg','binary/octet-stream'].includes(contentType)) {
      throw new Error(`${provider} trả về kiểu dữ liệu ${contentType}, không phải âm thanh. Hãy kiểm tra quyền truy cập hoặc kết nối lại tài khoản.`);
    }
    return response;
  }
  async function fetchAudioBlobOnce(url, options, provider) {
    const response = await fetchAudioResponse(url, options, provider);
    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error(`${provider} trả về file âm thanh rỗng.`);
    return blob;
  }
  // Pha C — lát đầu để phát ngay: chỉ tải 1 MB đầu bằng Range để bài hát
  // bắt đầu phát trong tích tắc thay vì chờ tải cả file (1 MB ≈ 2 giây
  // nhạc FLAC 24-bit/96 kHz, ~25 giây MP3 320 kbps — đủ để giải mã vài
  // khung đầu rồi tải nền phần còn lại, xem fetchCloudTrack); máy chủ
  // không hỗ trợ Range thì trả 200 kèm toàn bộ file, vẫn phát ngay mà
  // không cần tải nền. Lát đầu lỗi thì fetchCloudTrack rớt về đường cũ.
  const FIRST_SLICE_BYTES = 1 * 1024 * 1024;
  async function fetchAudioFirstSlice(url, options = {}, provider = 'Cloud') {
    const response = await fetchAudioResponse(url, {...options, headers:{...(options.headers || {}), Range:`bytes=0-${FIRST_SLICE_BYTES - 1}`}}, provider);
    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error(`${provider} trả về lát âm thanh đầu rỗng.`);
    const contentRange = (response.headers && response.headers.get('content-range')) || '';
    const totalMatch = String(contentRange).match(/\/(\d+)\s*$/);
    const contentLength = Number(response.headers && response.headers.get('content-length')) || 0;
    const totalBytes = totalMatch ? Number(totalMatch[1]) : (response.status === 200 ? blob.size : contentLength);
    return {blob, totalBytes, complete: totalBytes > 0 && blob.size >= totalBytes};
  }

  async function fetchAudioBlob(url, options = {}, provider = 'Cloud') {
    let lastError;
    for (let attempt = 0; attempt < FETCH_AUDIO_MAX_ATTEMPTS; attempt++) {
      try { return await fetchAudioBlobOnce(url, options, provider); }
      catch (error) {
        lastError = error;
        if (!isFetchAudioRetryable(error) || attempt === FETCH_AUDIO_MAX_ATTEMPTS - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, fetchAudioRetryDelayMs(attempt)));
      }
    }
    throw lastError;
  }

  const TRACK_METADATA_CACHE = new WeakMap();
  const NORMALIZED_METADATA_CACHE = new WeakMap();

  function trackMetadata(track) {
    if (!track || typeof track !== 'object') {
      return {title:cleanMetadataValue(track && track.title, 'Bài hát không tên'), artist:primaryArtistName(track && track.artist), album:primaryAlbumName(track && track.album)};
    }
    const cached = TRACK_METADATA_CACHE.get(track);
    if (cached && cached.titleSource === track.title && cached.artistSource === track.artist && cached.albumSource === track.album) return cached.value;
    const value = {
      title:cleanMetadataValue(track.title, 'Bài hát không tên'),
      artist:primaryArtistName(track.artist),
      album:primaryAlbumName(track.album)
    };
    TRACK_METADATA_CACHE.set(track, {titleSource:track.title, artistSource:track.artist, albumSource:track.album, value});
    NORMALIZED_METADATA_CACHE.delete(track);
    return value;
  }

  function normalizedTrackMetadata(track) {
    const metadata = trackMetadata(track);
    const cached = NORMALIZED_METADATA_CACHE.get(track);
    if (cached && cached.metadata === metadata) return cached.value;
    const value = {
      title:metadataKey(metadata.title),
      artist:metadataKey(metadata.artist),
      album:metadataKey(metadata.album),
      search:metadataKey(`${metadata.title} ${metadata.artist} ${metadata.album}`)
    };
    NORMALIZED_METADATA_CACHE.set(track, {metadata, value});
    return value;
  }

  function historyTrackKey(track) {
    if (!track || !track.source || track.source === 'url') return null;
    if (['google','onedrive'].includes(track.source) && track.remoteId) return JSON.stringify([track.source, String(track.remoteId)]);
    if (track.source === 'local') {
      const path = normalize(track.relativePath || track.webkitRelativePath || track.name).normalize('NFKC').toLocaleLowerCase('vi');
      if (!path) return null;
      let hash = 0xcbf29ce484222325n;
      for (const character of path) {
        hash ^= BigInt(character.codePointAt(0));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      return JSON.stringify(['local', hash.toString(16), path.length, Number(track.size) || 0]);
    }
    return null;
  }

  function metadataOptions(tracks, field, fallback) {
    const options = new Map();
    for (const track of tracks) {
      const metadata = trackMetadata(track);
      if (field === 'album') {
        const albumKey = metadataKey(metadata.album || fallback);
        const artistKey = metadataKey(metadata.artist);
        const key = `${albumKey}\t${artistKey}`;
        const label = metadata.album === UNKNOWN_ALBUM ? 'Chưa rõ album' : metadata.album;
        if (!options.has(key)) options.set(key, label);
        continue;
      }
      const cleaned = field === 'artist' ? metadata.artist : cleanMetadataValue(track && track[field], fallback);
      const key = metadataKey(cleaned);
      if (!options.has(key)) options.set(key, cleaned);
    }
    return [...options.entries()].sort(([a], [b]) => a.localeCompare(b, 'vi')).map(([key, label]) => ({key, label}));
  }

  function filterTracks(tracks, filters = {}) {
    const query = metadataKey(filters.query);
    const artistKey = metadataKey(filters.artist);
    const albumSelection = String(filters.album || '');
    const [selectedAlbumKey, selectedAlbumArtistKey] = albumSelection.includes('\t') ? albumSelection.split('\t', 2) : [metadataKey(albumSelection), ''];
    const hasSource = !!filters.source && filters.source !== 'all';
    const hasArtist = !!filters.artist && filters.artist !== '*';
    const hasAlbum = !!filters.album && filters.album !== '*';
    const hasFavorites = !!filters.favoritesOnly;
    return tracks.filter(track => {
      if (hasSource && track.source !== filters.source) return false;
      if (hasFavorites && (!filters.isFavorite || !filters.isFavorite(track))) return false;
      if (!hasArtist && !hasAlbum && !query) return true;
      const normalized = normalizedTrackMetadata(track);
      if (hasArtist && normalized.artist !== artistKey) return false;
      if (hasAlbum && (normalized.album !== selectedAlbumKey || (selectedAlbumArtistKey && normalized.artist !== selectedAlbumArtistKey))) return false;
      return !query || normalized.search.includes(query);
    });
  }

  function groupTracks(tracks, groupBy = 'none') {
    if (groupBy !== 'artist' && groupBy !== 'album') return [{label:'', tracks}];
    const groups = new Map();
    for (const track of tracks) {
      const metadata = trackMetadata(track);
      if (groupBy === 'artist') {
        const key = metadataKey(metadata.artist);
        if (!groups.has(key)) groups.set(key, {label:metadata.artist, tracks:[]});
        groups.get(key).tracks.push(track);
      } else {
        const artistKey = metadataKey(metadata.artist);
        const albumKey = metadataKey(metadata.album);
        const key = `${albumKey}\t${artistKey}`;
        const label = metadata.album === UNKNOWN_ALBUM ? 'Chưa rõ album' : metadata.album;
        if (!groups.has(key)) groups.set(key, {label, tracks:[]});
        groups.get(key).tracks.push(track);
      }
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }

  // Pha B — lời đồng bộ .lrc: [mm:ss.xx] (1-3 chữ số thập phân), nhiều mốc
  // trên một dòng, thẻ Enhanced LRC <mm:ss.xx> từng từ, thẻ [offset:±ms]
  // (cộng vào mọi mốc), thẻ metadata [ti:/ar:/al:] bị bỏ qua. Trả về mảng
  // đã sắp xếp theo thời gian; đầu vào không phải chuỗi trả về [].
  function parseLyrics(text) {
    if (typeof text !== 'string') return [];
    const offset = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    const offsetMs = offset ? Number(offset[1]) : 0;
    const entries = [];
    for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
      const times = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      if (!times.length) continue;
      const lyric = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
      if (!lyric) continue;
      for (const match of times) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        if (seconds >= 60) continue;
        const fraction = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
        const timeMs = Math.max(0, (minutes * 60 + seconds) * 1000 + fraction + offsetMs);
        entries.push({time: timeMs / 1000, text: lyric});
      }
    }
    return entries.sort((a, b) => a.time - b.time);
  }

  // Dòng lời đang hát tại `seconds`: chỉ số của mốc cuối cùng <= seconds,
  // -1 khi chưa tới dòng đầu hoặc đầu vào không hợp lệ.
  function lyricLineAt(lines, seconds) {
    if (!Array.isArray(lines) || !lines.length) return -1;
    const current = Number(seconds);
    if (!Number.isFinite(current)) return -1;
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      const time = Number(lines[i] && lines[i].time);
      if (Number.isFinite(time) && time <= current) index = i;
    }
    return index;
  }

  // Pha C — đọc cấu hình cloud đã lưu: JSON bẩn (cắt cụt, không phải object)
  // thì trả về {} thay vì ném SyntaxError làm hỏng đăng nhập/khôi phục phiên.
  function parseCloudConfig(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return {};
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { return {}; }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  // Pha A — nạp trước (pre-decode) bài kế tiếp để phát gapless 0 ms: bắt đầu
  // nạp khi bài hiện tại còn PRELOAD_LEAD_SECONDS giây (đủ thời gian lấy URL
  // ký cloud + đệm deck chờ trước khi bài hiện tại kết thúc). So sánh URL sau
  // khi phân giải tương đối, vì standbyAudio.src luôn là URL tuyệt đối trong
  // khi preloadReadyUrl có thể là đường dẫn tương đối — so sánh chuỗi thô sẽ
  // gọi preloadNext lặp lại mỗi lần timeupdate. Live stream (duration vô
  // hạn), NaN, duration 0 hay currentTime âm đều trả về false.
  const PRELOAD_LEAD_SECONDS = 15;
  function shouldPreloadNext(duration, currentTime, standbySrc = '', preloadReadyUrl = '', leadSeconds = PRELOAD_LEAD_SECONDS, baseUrl = '') {
    const total = Number(duration), position = Number(currentTime), lead = Number(leadSeconds);
    if (!Number.isFinite(total) || total <= 0) return false;
    if (!Number.isFinite(position) || position < 0) return false;
    if (!Number.isFinite(lead) || lead < 0) return false;
    if (total - position > lead) return false;
    const standby = String(standbySrc || '');
    const ready = String(preloadReadyUrl || '');
    if (!standby || !ready) return true;
    try {
      const base = baseUrl || 'http://localhost/';
      return new URL(standby, base).href !== new URL(ready, base).href;
    } catch (error) { return standby !== ready; }
  }

  // Pha B — tua nhanh bằng phím [ ] / ← / →: vị trí mới luôn kẹp trong
  // [0, duration]; live stream (duration vô hạn), NaN hay duration 0 thì
  // giữ nguyên vị trí hiện tại thay vì nhảy về 0 hay NaN.
  function clampSeekTime(currentTime, duration, deltaSeconds) {
    const current = Number.isFinite(currentTime) ? currentTime : 0;
    if (!Number.isFinite(duration) || duration <= 0) return current;
    const delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
    return Math.min(Math.max(0, current + delta), duration);
  }

  // Pha A — crossfade đẳng công suất khi chuyển bài: gain deck cũ = cos(θ),
  // deck mới = sin(θ) với θ = (π/2)·tiến độ; cos²+sin² = 1 nên tổng công
  // suất không đổi, không hụt âm lượng giữa bài như fade tuyến tính.
  // Tiến độ ngoài [0,1] được kẹp về biên; đầu vào không phải số coi như
  // chưa fade (deck cũ giữ nguyên, deck mới im). Thời lượng crossfade
  // tối đa 5 giây; giá trị ngoài khoảng hoặc không phải số kẹp về biên
  // hoặc fallback (mặc định 0 = tắt).
  const CROSSFADE_MAX_SECONDS = 5;
  function crossfadeGains(progress) {
    const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const angle = t * Math.PI / 2;
    return {out: Math.cos(angle), in: Math.sin(angle)};
  }
  function clampCrossfadeSeconds(value, fallback = 0) {
    const seconds = Number(value);
    const fallbackSeconds = Number.isFinite(fallback) ? fallback : 0;
    if (!Number.isFinite(seconds)) return Math.min(CROSSFADE_MAX_SECONDS, Math.max(0, fallbackSeconds));
    return Math.min(CROSSFADE_MAX_SECONDS, Math.max(0, seconds));
  }

  // Pha C — giới hạn danh mục cloud trong IndexedDB: chỉ giữ maxEntries mục
  // mới nhất theo savedAt; mục thiếu savedAt (catalog cũ) bị coi là cũ nhất
  // nên xóa trước. Trả về danh sách id cần xóa, theo thứ tự cũ -> mới.
  const MAX_CLOUD_CATALOG_ENTRIES = 1000;
  function pruneCatalogEntries(entries, maxEntries = MAX_CLOUD_CATALOG_ENTRIES) {
    if (!Array.isArray(entries)) return [];
    const max = Number.isFinite(maxEntries) ? Math.floor(maxEntries) : MAX_CLOUD_CATALOG_ENTRIES;
    const withId = entries.filter(entry => entry && typeof entry.id === 'string' && entry.id);
    if (withId.length <= Math.max(0, max)) return [];
    const ranked = withId.map((entry, index) => ({id: entry.id, savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : -Infinity, index}));
    ranked.sort((a, b) => (a.savedAt - b.savedAt) || (a.index - b.index));
    return ranked.slice(0, withId.length - Math.max(0, max)).map(item => item.id);
  }

  // Pha C — tổng ngân sách ảnh bìa cho catalog cloud trong IndexedDB:
  // giới hạn từng mục 512 KiB chưa đủ — 1000 mục có thể phình tới ~512 MB
  // base64 khi khôi phục offline. Giữ ảnh của các mục mới nhất cho tới khi
  // đủ MAX_CATALOG_COVER_TOTAL_CHARS, các mục cũ hơn bị đặt cover = null
  // (lần đồng bộ sau nạp lại metadata). Ảnh URL https không tính vào ngân
  // sách vì chỉ là chuỗi ngắn; mục thiếu savedAt được coi là cũ nhất.
  const MAX_CATALOG_COVER_TOTAL_CHARS = 8 * 1024 * 1024;
  function capCatalogCovers(entries, maxTotalChars = MAX_CATALOG_COVER_TOTAL_CHARS) {
    if (!Array.isArray(entries)) return [];
    const max = Number.isFinite(maxTotalChars) ? Math.floor(maxTotalChars) : MAX_CATALOG_COVER_TOTAL_CHARS;
    const ranked = entries
      .map((entry, index) => ({entry, savedAt: entry && Number.isFinite(entry.savedAt) ? entry.savedAt : -Infinity, index}))
      .filter(item => item.entry && typeof item.entry.id === 'string' && item.entry.id);
    ranked.sort((a, b) => (b.savedAt - a.savedAt) || (b.index - a.index));
    const dropped = new Set();
    let used = 0;
    for (const {entry} of ranked) {
      const cover = typeof entry.cover === 'string' && entry.cover.startsWith('data:image') ? entry.cover : null;
      if (!cover) continue;
      if (used + cover.length <= Math.max(0, max)) { used += cover.length; continue; }
      dropped.add(entry.id);
    }
    return entries.map(entry => (entry && dropped.has(entry.id) ? {...entry, cover: null} : entry));
  }

  // Pha C — siết catalog cloud khi khôi phục từ IndexedDB: catalog do bản
  // cũ ghi (hoặc lần dọn sau ghi thất bại lặng) có thể vượt 1000 mục /
  // 8 MiB ảnh bìa; chỉ nạp 1000 mục mới nhất và bỏ ảnh bìa cũ vượt ngân
  // sách trước khi đưa vào RAM lúc mở app, tránh phình bộ nhớ ngay từ
  // lần khởi động. Trả về {entries, changed}: entries đã lọc giữ nguyên
  // thứ tự gốc, mục thiếu id bị bỏ; changed = true khi kho cần dọn lại
  // ở nền (có mục quá hạn, ảnh bị bỏ, hoặc mục không hợp lệ).
  function prepareRestoredCatalog(entries, maxEntries = MAX_CLOUD_CATALOG_ENTRIES, maxTotalChars = MAX_CATALOG_COVER_TOTAL_CHARS) {
    if (!Array.isArray(entries)) return {entries: [], changed: false};
    const stale = new Set(pruneCatalogEntries(entries, maxEntries));
    const capped = capCatalogCovers(entries, maxTotalChars);
    const usable = capped.filter(entry => entry && typeof entry.id === 'string' && entry.id && !stale.has(entry.id));
    const coverChanged = capped.some((entry, index) => entry && entries[index] && entry.cover !== entries[index].cover);
    return {entries: usable, changed: stale.size > 0 || coverChanged || usable.length !== entries.length};
  }

  // Pha C — cache lát đầu trong IndexedDB: giữ tối đa 20 lát (mỗi lát 1 MB,
  // ~20 MB) mới nhất theo savedAt; mục thiếu key/size/savedAt bị coi là cũ
  // nhất nên xóa trước. Trả về danh sách key cần xóa, cũ -> mới.
  const FIRST_SLICE_CACHE_MAX_ENTRIES = 20;
  const FIRST_SLICE_CACHE_MAX_BYTES = 20 * 1024 * 1024;
  function pruneSliceCacheEntries(entries, maxEntries = FIRST_SLICE_CACHE_MAX_ENTRIES, maxBytes = FIRST_SLICE_CACHE_MAX_BYTES) {
    if (!Array.isArray(entries)) return [];
    const maxCount = Number.isFinite(maxEntries) ? Math.floor(maxEntries) : FIRST_SLICE_CACHE_MAX_ENTRIES;
    const maxTotal = Number.isFinite(maxBytes) ? Math.floor(maxBytes) : FIRST_SLICE_CACHE_MAX_BYTES;
    const usable = entries.filter(entry => entry && typeof entry.key === 'string' && entry.key);
    if (!usable.length) return [];
    const ranked = usable.map((entry, index) => ({key: entry.key, size: Number.isFinite(entry.size) && entry.size > 0 ? entry.size : 0, savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : -Infinity, index}));
    ranked.sort((a, b) => (a.savedAt - b.savedAt) || (a.index - b.index));
    let totalBytes = ranked.reduce((sum, item) => sum + item.size, 0);
    const evict = [];
    while ((ranked.length - evict.length > Math.max(0, maxCount) || totalBytes > Math.max(0, maxTotal)) && evict.length < ranked.length) { const oldest = ranked[evict.length]; evict.push(oldest.key); totalBytes -= oldest.size; }
    return evict;
  }

  // Pha A — đồng hồ đo mức Peak/RMS thật từ AnalyserNode: dữ liệu miền thời
  // gian là byte 0–255 (128 = im lặng); peak/RMS tính trên biên độ tuyến
  // tính rồi đổi sang dBFS, im lặng tuyệt đối hiển thị -96 dB thay vì -Infinity.
  function peakRmsFromTimeDomain(data) {
    if (!data || typeof data.length !== 'number' || !data.length) return {peak: 0, rms: 0, peakDb: -96, rmsDb: -96};
    let peak = 0, sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = (Number(data[i]) - 128) / 128;
      if (!Number.isFinite(sample)) continue;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const toDb = value => value > 0 ? Math.max(-96, 20 * Math.log10(value)) : -96;
    return {peak, rms, peakDb: toDb(peak), rmsDb: toDb(rms)};
  }

  // Pha B — hàng đợi hiển thị bài đang phát ghim đầu danh sách, rồi tới các
  // bài phát tiếp theo; bài đang phát nếu lọt vào danh sách chờ thì không lặp lại.
  function queueDisplayOrder(currentTrack, queuedTracks) {
    const queued = Array.isArray(queuedTracks) ? queuedTracks.filter(Boolean) : [];
    if (!currentTrack) return queued;
    return [currentTrack, ...queued.filter(track => track.id !== currentTrack.id)];
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, normalizeSearchKey: metadataKey, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, fetchAudioFirstSlice, FIRST_SLICE_BYTES, fetchAudioRetryDelayMs, isFetchAudioRetryable, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks, parseLyrics, lyricLineAt, parseCloudConfig, PRELOAD_LEAD_SECONDS, shouldPreloadNext, clampSeekTime, CROSSFADE_MAX_SECONDS, crossfadeGains, clampCrossfadeSeconds, MAX_CLOUD_CATALOG_ENTRIES, pruneCatalogEntries, MAX_CATALOG_COVER_TOTAL_CHARS, capCatalogCovers, prepareRestoredCatalog, FIRST_SLICE_CACHE_MAX_ENTRIES, FIRST_SLICE_CACHE_MAX_BYTES, pruneSliceCacheEntries, peakRmsFromTimeDomain, queueDisplayOrder};
});
