'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root === 'object' && root !== null) {
    root.NocturneLibrary = api;
    if (!root.library) root.library = api;
  }
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
  // Pha D — kiểm toán bộ giải mã: lát đầu 1 MB của FLAC có ảnh bìa lớn
  // (khối PICTURE vài MB) có thể không chứa khung nhạc nào — trình duyệt
  // không khởi động được bộ giải mã nên play() reject rồi app nhảy bài dù
  // file đầy đủ vẫn đang tải nền. Đo offset khung nhạc đầu tiên (fLaC +
  // các khối metadata: 1 byte cờ/type + 3 byte độ dài BE, có thể có tiền
  // tố ID3); nếu metadata tràn khỏi lát thì trả về cuối khối đang dở làm
  // cận dưới để tải lại Range rộng hơn (tối đa 8 MB, tối đa 3 lần mở rộng).
  const FIRST_SLICE_FRAME_ALLOWANCE_BYTES = 256 * 1024;
  const FIRST_SLICE_MAX_BYTES = 8 * 1024 * 1024;
  function flacFirstFrameOffset(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let offset = 0;
    if (view.byteLength >= 10 && view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) {
      const tagSize = ((view[6] & 0x7f) << 21) | ((view[7] & 0x7f) << 14) | ((view[8] & 0x7f) << 7) | (view[9] & 0x7f);
      offset = 10 + tagSize + ((view[5] & 0x10) ? 10 : 0);
      if (offset + 4 > view.byteLength) return -1;
    }
    if (view.byteLength < offset + 8) return -1;
    if (view[offset] !== 0x66 || view[offset + 1] !== 0x4c || view[offset + 2] !== 0x61 || view[offset + 3] !== 0x43) return -1;
    offset += 4;
    for (;;) {
      if (offset + 4 > view.byteLength) return -1;
      const header = view[offset];
      const length = (view[offset + 1] << 16) | (view[offset + 2] << 8) | view[offset + 3];
      const blockEnd = offset + 4 + length;
      if (blockEnd >= view.byteLength) return blockEnd;
      if (header & 0x80) return (view[blockEnd] === 0xff && (view[blockEnd + 1] & 0xfe) === 0xf8) ? blockEnd : -1;
      offset = blockEnd;
    }
  }
  async function fetchAudioFirstSlice(url, options = {}, provider = 'Cloud') {
    const sliceHeaders = end => ({...(options.headers || {}), Range:`bytes=0-${end - 1}`});
    let end = FIRST_SLICE_BYTES;
    let response = await fetchAudioResponse(url, {...options, headers: sliceHeaders(end)}, provider);
    let blob = await response.blob();
    if (!blob || !blob.size) throw new Error(`${provider} trả về lát âm thanh đầu rỗng.`);
    const contentRange = (response.headers && response.headers.get('content-range')) || '';
    const totalMatch = String(contentRange).match(/\/(\d+)\s*$/);
    const contentLength = Number(response.headers && response.headers.get('content-length')) || 0;
    // Pha C — đừng tin Content-Range để biết file còn dài bao nhiêu:
    // đó là header cross-origin, trình duyệt ẩn nó khi máy chủ không
    // expose (Drive không expose) nên totalBytes rơi về content-length
    // (= đúng 1 MB lát đầu) và lát bị tưởng là toàn file: app không tải
    // nền, firstSlicePlayback=false, phát hết lát (~13 giây với Rio) thì
    // 'ended' mà guard không bắt nên nhảy bài im lặng, không toast —
    // đúng triệu chứng Melissa báo 20:03. Bên gọi đã biết tổng số byte
    // thật từ metadata Drive/OneDrive (track.size) thì dùng nó làm chuẩn.
    const expectedTotalBytes = Number(options.expectedTotalBytes) || 0;
    const totalBytes = expectedTotalBytes > 0 ? expectedTotalBytes : (totalMatch ? Number(totalMatch[1]) : (response.status === 200 ? blob.size : contentLength));
    const isComplete = () => totalBytes > 0 && blob.size >= totalBytes;
    for (let attempt = 0; attempt < 3 && !isComplete() && response.status === 206 && typeof blob.arrayBuffer === 'function'; attempt++) {
      let frameOffset = -1;
      try { frameOffset = flacFirstFrameOffset(new Uint8Array(await blob.arrayBuffer())); } catch (_) { break; }
      if (frameOffset < 0 || frameOffset < blob.size) break;
      const nextEnd = Math.min(frameOffset + FIRST_SLICE_FRAME_ALLOWANCE_BYTES, FIRST_SLICE_MAX_BYTES, totalBytes || Infinity);
      if (nextEnd <= end) break;
      end = nextEnd;
      response = await fetchAudioResponse(url, {...options, headers: sliceHeaders(end)}, provider);
      const extended = await response.blob();
      if (!extended || !extended.size || extended.size <= blob.size) break;
      blob = extended;
    }
    return {blob, totalBytes, complete: isComplete()};
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

  // Pha B — Versions kiểu Roon: gộp các bản trùng của cùng một bài
  // (cùng tiêu đề + nghệ sĩ đã chuẩn hoá, bỏ dấu/chữ hoa) thành một
  // nhóm; bản chính là bản chất lượng cao nhất (sample rate, rồi bit
  // depth, rồi dung lượng). Bài không có tiêu đề/nghệ sĩ thật (tên mặc
  // định) không gộp để khỏi nhầm hai bài không tên khác nhau thành một.
  function compareTrackQuality(a, b) {
    const rank = track => ({sampleRate: Number(track && track.sampleRate) || 0, bitDepth: Number(track && track.bitDepth) || 0, size: Number(track && track.size) || 0});
    const ra = rank(a), rb = rank(b);
    return (rb.sampleRate - ra.sampleRate) || (rb.bitDepth - ra.bitDepth) || (rb.size - ra.size);
  }
  function groupTrackVersions(tracks) {
    if (!Array.isArray(tracks)) return [];
    const groups = new Map();
    for (const track of tracks) {
      if (!track || typeof track !== 'object') continue;
      const metadata = trackMetadata(track);
      const key = metadata.title === 'Bài hát không tên' || metadata.artist === UNKNOWN_ARTIST
        ? `id:${track.id}`
        : `${metadataKey(metadata.title)}\t${metadataKey(metadata.artist)}`;
      if (!groups.has(key)) groups.set(key, {key, title: metadata.title, artist: metadata.artist, versions: []});
      groups.get(key).versions.push(track);
    }
    return [...groups.values()].map(group => {
      const versions = [...group.versions].sort(compareTrackQuality);
      return {...group, primary: versions[0], versions};
    });
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
      const times = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/g)];
      if (!times.length) continue;
      const lyric = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d+)?>/g, '').trim();
      if (!lyric) continue;
      let firstTimeMs = null;
      for (const match of times) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        if (seconds >= 60) continue;
        const fractionSec = match[3] ? Number('0.' + match[3]) : 0;
        const totalSec = Math.max(0, Math.round((minutes * 60 + seconds + fractionSec + (offsetMs / 1000)) * 10000) / 10000);
        const timeMs = Math.max(0, totalSec * 1000);
        if (firstTimeMs === null) firstTimeMs = timeMs;
        const line = {time: totalSec, text: lyric};
        const words = parseKaraokeWords(rawLine, timeMs, offsetMs, (timeMs - firstTimeMs) / 1000, false);
        Object.defineProperty(line, 'words', {
          value: words,
          enumerable: false,
          writable: true,
          configurable: true
        });
        entries.push(line);
      }
    }
    return entries.sort((a, b) => a.time - b.time);
  }

  // Pha C — tách mốc thời gian từng từ cho Karaoke Enhanced LRC: <mm:ss.xx>
  // hoặc <mm:ss.xxx>; trả về mảng [{time, text}] đã cộng offsetMs và sắp
  // xếp theo thời gian; trả về [] nếu không có thẻ từ hoặc content không hợp lệ.
  function parseKaraokeWords(content, lineTimeMs = 0, offsetMs = 0, relativeOffsetSec = 0, sort = true) {
    if (typeof content !== 'string') return [];
    const clean = content.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/g, '').trim();
    const tagRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d+))?>/g;
    const matches = [...clean.matchAll(tagRegex)];
    if (!matches.length) return [];

    const words = [];
    const off = Number(offsetMs) || 0;
    const relOffset = Number(relativeOffsetSec) || 0;

    // Chữ đứng trước mốc từ đầu tiên (nếu có) lấy theo mốc của dòng
    if (matches[0].index > 0) {
      const prefix = clean.slice(0, matches[0].index).trim();
      if (prefix) {
        const timeMs = Math.max(0, Number(lineTimeMs) || 0);
        words.push({ time: Math.round((timeMs / 1000) * 10000) / 10000, text: prefix });
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) continue;
      const fractionSec = match[3] ? Number('0.' + match[3]) : 0;
      const wordSec = minutes * 60 + seconds + fractionSec + (off / 1000) + relOffset;
      const time = Math.round(Math.max(0, wordSec) * 10000) / 10000;
      const startIndex = match.index + match[0].length;
      const endIndex = i + 1 < matches.length ? matches[i + 1].index : clean.length;
      const wordText = clean.slice(startIndex, endIndex).trim();
      if (wordText) {
        words.push({ time, text: wordText });
      }
    }
    return sort ? words.sort((a, b) => a.time - b.time) : words;
  }

  // Từ đang hát tại `seconds`: chỉ số của từ cuối cùng có time <= seconds,
  // -1 khi chưa tới từ đầu tiên hoặc đầu vào không hợp lệ.
  function lyricWordAt(words, seconds) {
    if (!Array.isArray(words) || !words.length) return -1;
    const current = Number(seconds);
    if (Number.isNaN(current)) return -1;
    let index = -1;
    for (let i = 0; i < words.length; i++) {
      const time = Number(words[i] && words[i].time);
      if (Number.isFinite(time) && time <= current) index = i;
    }
    return index;
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

  // Pha B — có nên tự cuộn dòng lời đang hát vào giữa panel lời không:
  // chỉ cuộn khi dòng nằm ngoài khung nhìn của panel (thò lên trên hoặc
  // thò xuống dưới); dòng đã hiện đủ thì giữ nguyên vị trí cuộn do người
  // dùng chọn, tránh scrollIntoView giật khung mỗi lần đổi dòng. Rect bẩn
  // (null/NaN, khung nhìn rỗng) thì không cuộn.
  function shouldScrollLyricIntoView(containerRect, rowRect) {
    if (!containerRect || !rowRect) return false;
    const top = Number(containerRect.top);
    const bottom = Number(containerRect.bottom);
    const rowTop = Number(rowRect.top);
    const rowBottom = Number(rowRect.bottom);
    if (![top, bottom, rowTop, rowBottom].every(Number.isFinite)) return false;
    if (bottom <= top) return false;
    return rowTop < top || rowBottom > bottom;
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
  // Pha C — lát PCM đầu DSD (~2 giây) ở tốc độ xuất cao (192 kHz,
  // 24-bit stereo) nặng tới ~2.3 MB nên giới hạn ghi cache riêng là
  // 3 MB, vẫn nằm trong ngân sách chung 20 lát / 20 MB của
  // pruneSliceCacheEntries (lát quá lớn tự bị loại khi dọn kho).
  const DSD_FIRST_SLICE_CACHE_MAX_BYTES = 3 * 1024 * 1024;
  // Pha C — lát PCM đầu DSD là âm thanh đã giải mã nên chỉ hợp lệ với
  // đúng thông số giải mã lúc ghi (tốc độ xuất PCM + bit depth); lát
  // FLAC là byte gốc của file nên không cần đối chiếu meta (không có kỳ
  // vọng thì luôn hợp lệ). Mục cũ không có meta thì coi là hết hạn để
  // worker giải mã lại một lần rồi ghi meta mới; meta bẩn (không phải
  // số) cũng hết hạn thay vì phát nhầm lát sai tốc độ/bit depth.
  function sliceCacheMetaMatches(entryMeta, expectedMeta) {
    if (!expectedMeta || typeof expectedMeta !== 'object') return true;
    if (!entryMeta || typeof entryMeta !== 'object') return false;
    const rate = Number(entryMeta.dsdRate), expectedRate = Number(expectedMeta.dsdRate);
    const depth = Number(entryMeta.dsdDepth), expectedDepth = Number(expectedMeta.dsdDepth);
    if (!Number.isFinite(rate) || !Number.isFinite(expectedRate) || rate !== expectedRate) return false;
    if (!Number.isFinite(depth) || !Number.isFinite(expectedDepth) || depth !== expectedDepth) return false;
    return true;
  }
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

  // Pha A — Cân bằng kênh âm thanh trái/phải Stereo Balance [-1, 1]:
  // kẹp giá trị an toàn trong khoảng [-1, 1] và định dạng hiển thị cho người dùng.
  function clampBalance(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(-1, Math.min(1, num));
  }

  function formatBalance(value) {
    const clamped = clampBalance(value, 0);
    const rounded = Math.round(clamped * 100);
    if (rounded === 0) return 'Giữa';
    if (rounded < 0) return `Trái ${Math.abs(rounded)}%`;
    return `Phải ${rounded}%`;
  }

  // Pha A — DSP Crossfeed kiểu Roon cho nghe tai nghe [0, 1]: trộn một phần tín hiệu
  // kênh đối diện qua lọc thấp 700 Hz + trễ 0,3 ms, gain chéo tối đa 0,35 (≈ −9 dB).
  const CROSSFEED_CUTOFF_HZ = 700;
  const CROSSFEED_DELAY_S = 0.0003;
  const CROSSFEED_MAX_GAIN = 0.35;

  function clampCrossfeed(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  }

  function crossfeedCrossGain(value) {
    return clampCrossfeed(value, 0) * CROSSFEED_MAX_GAIN;
  }

  function formatCrossfeed(value) {
    const clamped = clampCrossfeed(value, 0);
    if (clamped <= 0) return 'Tắt';
    return `${Math.round(clamped * 100)}%`;
  }

  // Pha B — Signal Path kiểu Roon trong Phòng nghe: tính toán chuỗi Nguồn → Giải mã → DSP → Đầu ra
  // từ metadata kỹ thuật của bài hát và cấu hình Web Audio Graph hiện tại.
  function computeSignalPath(track, options = {}) {
    if (!track || typeof track !== 'object') {
      return {
        qualityTier: 'standard',
        qualityLabel: 'READY',
        hasDsp: false,
        steps: []
      };
    }

    const isDsd = !!track.isDsd;
    const sampleRate = Number(track.sampleRate) || 0;
    const bitDepth = Number(track.bitDepth) || 0;
    const format = String(track.format || (isDsd ? 'DSD' : 'Âm thanh')).toUpperCase();
    const channels = Number(track.channels) || 2;
    const channelText = channels === 1 ? 'Mono (1 kênh)' : channels === 2 ? 'Stereo (2 kênh)' : `${channels} kênh`;

    const sourceLabels = {
      local: 'Tệp nội bộ trên thiết bị',
      google: 'Google Drive (Stream trực tiếp)',
      onedrive: 'Microsoft OneDrive (SharePoint / Graph)',
      url: 'URL mạng trực tiếp / WebDAV'
    };
    const sourceName = sourceLabels[track.source] || `Nguồn ${track.source || 'không xác định'}`;

    // 1. Stage: Source
    let sourceFormatLabel = format;
    let sourceTechLabel = '';
    if (isDsd) {
      const mult = track.dsdMultiplier || (sampleRate ? Math.round(sampleRate / 44100) : 64);
      sourceFormatLabel = `DSD${mult} (${format})`;
      sourceTechLabel = sampleRate ? `${(sampleRate / 1000000).toFixed(2)} MHz · 1-bit` : '1-bit';
    } else if (sampleRate && bitDepth) {
      sourceTechLabel = `${(sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0)} kHz · ${bitDepth}-bit`;
    } else if (sampleRate) {
      sourceTechLabel = `${(sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0)} kHz`;
    } else {
      sourceTechLabel = channelText;
    }

    const sourceStep = {
      stage: 'source',
      title: 'Nguồn phát (Source)',
      description: `${sourceFormatLabel} · ${sourceTechLabel}`,
      detail: `${sourceName} · ${channelText}`,
      badge: sourceFormatLabel,
      icon: 'source'
    };

    // 2. Stage: Decode
    let decodeStep;
    if (isDsd) {
      const targetRate = options.dsdOutputRate || track.pcmRate || 44100;
      const targetDepth = options.dsdOutputDepth || track.pcmBitDepth || 16;
      decodeStep = {
        stage: 'decode',
        title: 'Giải mã DSD (Decoder)',
        description: `Decimation FIR 48-tap → PCM ${(targetRate / 1000).toFixed(1)} kHz / ${targetDepth}-bit`,
        detail: 'Giải mã phần mềm thời gian thực bằng Web Worker (dsd2pcm)',
        badge: 'DSD → PCM',
        icon: 'decode'
      };
    } else {
      const isLossless = ['FLAC', 'WAV', 'AIFF', 'ALAC'].includes(format);
      decodeStep = {
        stage: 'decode',
        title: 'Giải mã âm thanh (Decoder)',
        description: isLossless ? `${format} Lossless Decode (Không mất mát dữ liệu)` : `${format} Audio Decode (Web Audio API)`,
        detail: isLossless ? 'Trình duyệt giải mã dòng byte nguyên bản' : 'Trình duyệt giải mã luồng âm thanh nén',
        badge: isLossless ? 'Lossless' : 'Compressed',
        icon: 'decode'
      };
    }

    // 3. Stage: DSP
    const dspActive = [];
    if (options.eqEnabled) {
      const presetLabel = options.eqPreset ? (options.eqPresetLabels?.[options.eqPreset] || options.eqPreset) : 'Tùy chỉnh';
      const preampText = Number.isFinite(options.eqPreamp) ? ` (Preamp ${options.eqPreamp.toFixed(1)} dB)` : '';
      dspActive.push(`Parametric EQ: ${presetLabel}${preampText}`);
    }
    if (Number.isFinite(options.stereoBalance) && Math.abs(options.stereoBalance) > 0.01) {
      const pct = Math.round(options.stereoBalance * 100);
      dspActive.push(`Cân bằng L/R: ${pct < 0 ? `Trái ${Math.abs(pct)}%` : `Phải ${pct}%`}`);
    }
    if (options.crossfeedEnabled && Number(options.crossfeedAmount) > 0) {
      dspActive.push(`Crossfeed tai nghe: ${Math.round(options.crossfeedAmount * 100)}%`);
    }
    if (options.replayGainEnabled && options.replayGainText) {
      dspActive.push(`ReplayGain: ${options.replayGainText}`);
    }
    if ((Number.isFinite(options.toneBass) && Math.abs(options.toneBass) > 0.05) || (Number.isFinite(options.toneTreble) && Math.abs(options.toneTreble) > 0.05)) {
      const toneText = formatToneSummary(options.toneBass, options.toneTreble);
      if (toneText && toneText !== '0 dB') {
        dspActive.push(`Âm sắc: ${toneText}`);
      }
    }

    let dspStep;
    if (dspActive.length > 0) {
      dspStep = {
        stage: 'dsp',
        title: 'Xử lý DSP (Digital Signal Processing)',
        description: dspActive.join(' · '),
        detail: 'Xử lý chuỗi BiquadFilter / Panner / Crossfeed / ReplayGain qua Web Audio Graph',
        badge: 'DSP Active',
        isEnhanced: true,
        icon: 'dsp'
      };
    } else {
      dspStep = {
        stage: 'dsp',
        title: 'Xử lý DSP (Bypass)',
        description: 'Bypass DSP — Tín hiệu nguyên bản (Bit-perfect path)',
        detail: 'Không có bộ lọc EQ hay hiệu ứng nào được áp dụng',
        badge: 'Bit-perfect',
        isEnhanced: false,
        icon: 'bypass'
      };
    }

    // 4. Stage: Output
    const contextRate = options.contextRate ? `${(options.contextRate / 1000).toFixed(1)} kHz` : 'Tần số hệ thống';
    const outputStep = {
      stage: 'output',
      title: 'Thiết bị đầu ra (Output)',
      description: `AudioContext Destination · ${contextRate}`,
      detail: 'Hệ điều hành / Trình duyệt điều phối tới DAC hoặc Loa/Tai nghe',
      badge: contextRate,
      icon: 'output'
    };

    // Quality Tier Assessment
    let qualityTier = 'standard';
    let qualityLabel = 'STANDARD';
    if (isDsd) {
      qualityTier = 'dsd';
      qualityLabel = 'DSD';
    } else if ((sampleRate && sampleRate > 48000) || (bitDepth && bitDepth > 16)) {
      qualityTier = 'highres';
      qualityLabel = 'HI-RES';
    } else if (['FLAC', 'WAV', 'AIFF', 'ALAC'].includes(format)) {
      qualityTier = 'lossless';
      qualityLabel = 'LOSSLESS';
    }

    if (dspActive.length > 0) {
      qualityLabel = `${qualityLabel} · ENHANCED`;
    }

    return {
      qualityTier,
      qualityLabel,
      hasDsp: dspActive.length > 0,
      steps: [sourceStep, decodeStep, dspStep, outputStep]
    };
  }

  // Pha C — Roon Radio: tự động chọn bài hát tương tự từ thư viện
  // khi danh sách phát hoặc hàng đợi kết thúc để nhạc không bị dừng đột ngột.
  function selectRoonRadioTrack(currentTrack, tracks, options = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    const excludeSet = new Set(Array.isArray(options.excludeIds) ? options.excludeIds : []);
    if (currentTrack && currentTrack.id) excludeSet.add(currentTrack.id);

    const candidates = tracks.filter(t => t && t.id && !excludeSet.has(t.id));
    if (candidates.length === 0) return null;

    const currentMeta = currentTrack ? trackMetadata(currentTrack) : null;
    const currentArtistKey = currentMeta && currentMeta.artist ? metadataKey(currentMeta.artist) : '';
    const currentAlbumKey = currentMeta && currentMeta.album ? metadataKey(currentMeta.album) : '';
    const unknownArtistKey = metadataKey(UNKNOWN_ARTIST);
    const unknownAlbumKey = metadataKey(UNKNOWN_ALBUM);

    const isCurrentKnownArtist = currentArtistKey && currentArtistKey !== unknownArtistKey;
    const isCurrentKnownAlbum = currentAlbumKey && currentAlbumKey !== unknownAlbumKey;
    const isCurrentDsd = !!(currentTrack && currentTrack.isDsd);
    const currentRate = Number(currentTrack && currentTrack.sampleRate) || 0;
    const currentDepth = Number(currentTrack && currentTrack.bitDepth) || 0;
    const isCurrentHiRes = !isCurrentDsd && (currentRate > 48000 || currentDepth > 16);

    const recentList = Array.isArray(options.recentHistory) ? options.recentHistory : [];
    const favorites = options.favorites instanceof Set
      ? options.favorites
      : new Set(Array.isArray(options.favorites) ? options.favorites : []);

    const scored = candidates.map(track => {
      const meta = trackMetadata(track);
      const artistKey = meta && meta.artist ? metadataKey(meta.artist) : '';
      const albumKey = meta && meta.album ? metadataKey(meta.album) : '';

      let score = 10;
      let primaryReason = 'Khám phá thư viện';

      // 1. Cùng nghệ sĩ
      if (isCurrentKnownArtist && artistKey === currentArtistKey) {
        score += 60;
        primaryReason = `Cùng nghệ sĩ ${meta.artist}`;
      } else if (isCurrentKnownAlbum && albumKey === currentAlbumKey) {
        // 2. Cùng album
        score += 40;
        primaryReason = `Cùng album ${meta.album}`;
      }

      // 3. Bài yêu thích
      if (favorites.has(track.id)) {
        score += 25;
        if (primaryReason === 'Khám phá thư viện') {
          primaryReason = 'Từ bài hát yêu thích';
        }
      }

      // 4. Tương đồng định dạng
      if (isCurrentDsd && track.isDsd) {
        score += 15;
      } else if (isCurrentHiRes && !track.isDsd && (Number(track.sampleRate) > 48000 || Number(track.bitDepth) > 16)) {
        score += 10;
      }

      // 5. Phạt bài vừa nghe gần đây
      const trackKey = historyTrackKey(track);
      const recentIndex = recentList.findIndex(item => {
        const itemKey = typeof item === 'string' ? item : (item && (item.trackKey || item.id));
        return itemKey === trackKey || itemKey === track.id;
      });
      if (recentIndex >= 0) {
        if (recentIndex < 3) score -= 80;
        else if (recentIndex < 8) score -= 40;
        else score -= 15;
      }

      let hash = 0;
      const str = String(track.id || '');
      for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xff;
      score += (hash % 6);

      return { track, reason: primaryReason, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  // ── Pha D — Ambient Glow: Trích xuất bảng màu chủ đạo từ pixel data ──
  // Nhận RGBA Uint8ClampedArray (hoặc plain Array) + kích thước canvas,
  // trả về mảng tối đa `count` màu dạng [r, g, b] sắp theo tần suất giảm dần.
  // Thuật toán: Lượng tử hóa (quantize) mỗi kênh xuống bước 32 (8 mức) rồi
  // đếm tần suất; bỏ pixel quá tối (< 25) và quá sáng (> 230) để glow có màu
  // rõ ràng. Fallback: mảng rỗng nếu không đủ pixel hợp lệ.
  function extractDominantColors(pixelData, width, height, count) {
    count = Math.max(1, Math.min(count || 3, 8));
    const step = 32;
    const bins = Object.create(null);
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const off = i * 4;
      const r = pixelData[off], g = pixelData[off + 1], b = pixelData[off + 2];
      const a = pixelData[off + 3];
      if (a < 128) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 25 || lum > 230) continue;
      const qr = Math.round(r / step) * step;
      const qg = Math.round(g / step) * step;
      const qb = Math.round(b / step) * step;
      const key = `${qr},${qg},${qb}`;
      if (!bins[key]) bins[key] = { r: 0, g: 0, b: 0, n: 0 };
      bins[key].r += r; bins[key].g += g; bins[key].b += b; bins[key].n += 1;
    }
    const entries = Object.values(bins).filter(b => b.n > 0);
    entries.sort((a, b) => b.n - a.n);
    const results = [];
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const e = entries[i];
      results.push([Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
    }
    return results;
  }

  // ── Pha A — ReplayGain & Loudness Normalization ──
  // Chuẩn hóa mức âm lượng giữa các bản nhạc dựa trên thông số ReplayGain
  // (ID3v2 TXXX, FLAC Vorbis comments hoặc ApeTag).
  function parseGainString(val) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val !== 'string') return null;
    const match = val.match(/([-+]?\d+(?:\.\d+)?)\s*(?:dB)?/i);
    return match ? parseFloat(match[1]) : null;
  }

  function parsePeakString(val) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val !== 'string') return null;
    const num = parseFloat(val);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  function parseReplayGain(input = {}) {
    if (!input || typeof input !== 'object') {
      return { trackGain: 0, trackPeak: 1, albumGain: 0, albumPeak: 1, hasReplayGain: false, hasTrackGain: false, hasAlbumGain: false };
    }

    const tags = input.tags || input;
    let trackGain = null, trackPeak = null, albumGain = null, albumPeak = null;

    const candidates = [
      ['trackGain', [input.trackGain, input.replayGainTrackGain, input.replaygain_track_gain, input.REPLAYGAIN_TRACK_GAIN, tags.trackGain, tags.replayGainTrackGain, tags.replaygain_track_gain, tags.REPLAYGAIN_TRACK_GAIN]],
      ['trackPeak', [input.trackPeak, input.replayGainTrackPeak, input.replaygain_track_peak, input.REPLAYGAIN_TRACK_PEAK, tags.trackPeak, tags.replayGainTrackPeak, tags.replaygain_track_peak, tags.REPLAYGAIN_TRACK_PEAK]],
      ['albumGain', [input.albumGain, input.replayGainAlbumGain, input.replaygain_album_gain, input.REPLAYGAIN_ALBUM_GAIN, tags.albumGain, tags.replayGainAlbumGain, tags.replaygain_album_gain, tags.REPLAYGAIN_ALBUM_GAIN]],
      ['albumPeak', [input.albumPeak, input.replayGainAlbumPeak, input.replaygain_album_peak, input.REPLAYGAIN_ALBUM_PEAK, tags.albumPeak, tags.replayGainAlbumPeak, tags.replaygain_album_peak, tags.REPLAYGAIN_ALBUM_PEAK]],
    ];

    for (const [key, list] of candidates) {
      for (const val of list) {
        if (val !== undefined && val !== null) {
          const parsed = key.endsWith('Peak') ? parsePeakString(val) : parseGainString(val);
          if (parsed !== null) {
            if (key === 'trackGain') trackGain = parsed;
            else if (key === 'trackPeak') trackPeak = parsed;
            else if (key === 'albumGain') albumGain = parsed;
            else if (key === 'albumPeak') albumPeak = parsed;
            break;
          }
        }
      }
    }

    if (Array.isArray(tags.TXXX)) {
      for (const frame of tags.TXXX) {
        const desc = String(frame.description || '').toUpperCase();
        const data = frame.data;
        if (trackGain === null && desc === 'REPLAYGAIN_TRACK_GAIN') trackGain = parseGainString(data);
        if (trackPeak === null && desc === 'REPLAYGAIN_TRACK_PEAK') trackPeak = parsePeakString(data);
        if (albumGain === null && desc === 'REPLAYGAIN_ALBUM_GAIN') albumGain = parseGainString(data);
        if (albumPeak === null && desc === 'REPLAYGAIN_ALBUM_PEAK') albumPeak = parsePeakString(data);
      }
    }

    const hasTrack = trackGain !== null;
    const hasAlbum = albumGain !== null;
    const hasReplayGain = hasTrack || hasAlbum;

    const finalTrackGain = hasTrack ? trackGain : (hasAlbum ? albumGain : 0);
    const finalAlbumGain = hasAlbum ? albumGain : (hasTrack ? trackGain : 0);
    const finalTrackPeak = trackPeak !== null ? trackPeak : 1.0;
    const finalAlbumPeak = albumPeak !== null ? albumPeak : finalTrackPeak;

    return {
      trackGain: finalTrackGain,
      trackPeak: finalTrackPeak,
      albumGain: finalAlbumGain,
      albumPeak: finalAlbumPeak,
      hasReplayGain,
      hasTrackGain: hasTrack,
      hasAlbumGain: hasAlbum
    };
  }

  function computeReplayGainMultiplier(parsedRg, options = {}) {
    const mode = options.mode === 'album' ? 'album' : 'track';
    const enabled = options.enabled !== false;
    const preampDb = Number(options.preampDb) || 0;
    const preventClipping = options.preventClipping !== false;

    if (!enabled) {
      return { multiplier: 1, rawGainDb: 0, totalGainDb: 0, effectiveDb: 0, isClipped: false, mode, hasReplayGain: false };
    }

    const rg = (parsedRg && typeof parsedRg === 'object' && typeof parsedRg.hasReplayGain === 'boolean') ? parsedRg : parseReplayGain(parsedRg);
    const rawGainDb = mode === 'album' ? rg.albumGain : rg.trackGain;
    const peak = mode === 'album' ? rg.albumPeak : rg.trackPeak;
    const hasGain = mode === 'album' ? rg.hasAlbumGain : rg.hasTrackGain;

    const totalGainDb = (hasGain ? rawGainDb : 0) + preampDb;
    let multiplier = Math.pow(10, totalGainDb / 20);
    let isClipped = false;

    if (preventClipping && peak > 0 && (multiplier * peak > 1.0)) {
      multiplier = 1.0 / peak;
      isClipped = true;
    }

    multiplier = Math.max(0.0316, Math.min(5.62, multiplier));
    const effectiveDb = 20 * Math.log10(multiplier);

    return {
      multiplier,
      rawGainDb: hasGain ? rawGainDb : 0,
      totalGainDb,
      effectiveDb: Math.round(effectiveDb * 10) / 10,
      isClipped,
      mode,
      hasReplayGain: hasGain
    };
  }

  function formatReplayGain(gainResult) {
    if (!gainResult) return 'Bypass';
    if (typeof gainResult === 'number') {
      const sign = gainResult > 0 ? '+' : '';
      return `${sign}${gainResult.toFixed(1)} dB`;
    }
    if (!gainResult.hasReplayGain) {
      return 'Không có tag';
    }
    const sign = gainResult.effectiveDb > 0 ? '+' : '';
    const clipTag = gainResult.isClipped ? ' (Anti-clip)' : '';
    const modeTag = gainResult.mode === 'album' ? 'Album' : 'Track';
    return `${sign}${gainResult.effectiveDb.toFixed(1)} dB · ${modeTag}${clipTag}`;
  }

  // ── Pha B — Roon-style Album Summary & Formatting ──
  function formatAlbumDuration(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (totalSeconds >= 3600) {
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      return `${h} giờ ${m} phút`;
    }
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m} phút${s ? ` ${s} giây` : ''}`;
  }

  function summarizeAlbum(tracks = []) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return {
        trackCount: 0,
        totalDuration: 0,
        formattedDuration: '0 phút',
        highestQuality: { tier: 'standard', label: 'STANDARD' },
        formats: [],
        year: null
      };
    }

    let totalDuration = 0;
    let hasDsd = false;
    let hasHiRes = false;
    let hasLossless = false;
    const formatSet = new Set();
    let year = null;

    for (const track of tracks) {
      if (!track) continue;
      const d = Number(track.duration);
      if (Number.isFinite(d) && d > 0) totalDuration += d;

      const fmt = String(track.format || '').toUpperCase();
      if (fmt) formatSet.add(fmt);

      if (track.isDsd) {
        hasDsd = true;
      } else {
        const rate = Number(track.sampleRate) || 0;
        const depth = Number(track.bitDepth) || 0;
        if (rate > 48000 || depth > 16) {
          hasHiRes = true;
        } else if (['FLAC', 'WAV', 'AIFF', 'ALAC'].includes(fmt)) {
          hasLossless = true;
        }
      }

      if (!year && track.year) year = track.year;
    }

    let highestQuality;
    if (hasDsd) {
      highestQuality = { tier: 'dsd', label: 'DSD' };
    } else if (hasHiRes) {
      highestQuality = { tier: 'highres', label: 'HI-RES' };
    } else if (hasLossless) {
      highestQuality = { tier: 'lossless', label: 'LOSSLESS' };
    } else {
      highestQuality = { tier: 'standard', label: 'STANDARD' };
    }

    return {
      trackCount: tracks.length,
      totalDuration: Math.round(totalDuration),
      formattedDuration: formatAlbumDuration(totalDuration),
      highestQuality,
      formats: Array.from(formatSet),
      year
    };
  }

  // ── Pha C — Sleep Timer Fade-Out ──
  // Giảm âm lượng mượt mà theo đường cong equal-power trong khoảng thời gian fade-out
  // (mặc định 30 giây cuối) trước khi dừng phát khi hết giờ hẹn ngủ.
  const DEFAULT_SLEEP_FADEOUT_MS = 30000;

  function calculateSleepFadeGain(remainingMs, fadeDurationMs = DEFAULT_SLEEP_FADEOUT_MS) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
    fadeDurationMs = Math.max(1000, Number(fadeDurationMs) || DEFAULT_SLEEP_FADEOUT_MS);
    if (remainingMs >= fadeDurationMs) return 1;
    const ratio = Math.max(0, Math.min(1, remainingMs / fadeDurationMs));
    // Equal-power sine curve: sin(ratio * pi / 2)
    return Math.sin(ratio * (Math.PI / 2));
  }

  function formatSleepRemaining(remainingMs) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Hết giờ';
    const totalSecs = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m === 0) return `${s} giây`;
    return s > 0 ? `${m} phút ${s} giây` : `${m} phút`;
  }

  // ── Pha D — PWA & Architecture: Network Status & Offline Playability ──
  // Giám sát trạng thái kết nối mạng và xác định khả năng phát khi ngoại tuyến
  function isOnlineState(navigatorObj) {
    if (!navigatorObj || typeof navigatorObj !== 'object') return true;
    return navigatorObj.onLine !== false;
  }

  function formatNetworkStatus(online) {
    const isOnline = !!online;
    return {
      online: isOnline,
      status: isOnline ? 'online' : 'offline',
      label: isOnline ? 'Trực tuyến' : 'Ngoại tuyến',
      message: isOnline
        ? 'Đã kết nối Internet.'
        : 'Đang ngắt kết nối mạng. Chỉ phát các bài hát nội bộ hoặc đã lưu bộ nhớ đệm.'
    };
  }

  function canPlayOffline(track) {
    if (!track || typeof track !== 'object') return false;
    // Bài local luôn phát được ngoại tuyến
    if (track.source === 'local') return true;
    // Bài đã có Blob/File sẵn trong bộ nhớ RAM
    if (track.file || track.blob) return true;
    // Bài đã có lát đầu hoặc file trong IndexedDB cache
    if (track.hasCachedSlice === true || track.firstSliceCached === true) return true;
    return false;
  }

  // ── Pha A — Tone Controls (Bass & Treble Quick Trim) ──
  // Bộ điều chỉnh âm sắc nhanh dải trầm (100 Hz low-shelf) và dải cao (10 kHz high-shelf) ±6 dB
  const TONE_BASS_FREQ_HZ = 100;
  const TONE_TREBLE_FREQ_HZ = 10000;
  const TONE_GAIN_MIN_DB = -6;
  const TONE_GAIN_MAX_DB = 6;

  function clampToneGain(val, min = TONE_GAIN_MIN_DB, max = TONE_GAIN_MAX_DB) {
    const num = Number(val);
    if (!Number.isFinite(num)) return 0;
    return Math.max(min, Math.min(max, Math.round(num * 2) / 2));
  }

  function formatToneGain(val) {
    const num = Number(val) || 0;
    if (Math.abs(num) < 0.05) return '0 dB';
    return `${num > 0 ? '+' : ''}${num.toFixed(1)} dB`;
  }

  function formatToneSummary(bass, treble) {
    const b = Number(bass) || 0, t = Number(treble) || 0;
    if (Math.abs(b) < 0.05 && Math.abs(t) < 0.05) return '0 dB';
    const parts = [];
    if (Math.abs(b) >= 0.05) parts.push(`Bass ${formatToneGain(b)}`);
    if (Math.abs(t) >= 0.05) parts.push(`Treble ${formatToneGain(t)}`);
    return parts.join(' · ');
  }

  // ── Waveform Helpers ──

  function generateWaveformPeaks(channelData, numBuckets) {
    if (!channelData || channelData.length === 0 || numBuckets <= 0) {
      return new Float32Array(0);
    }
    const peaks = new Float32Array(numBuckets);
    const samplesPerBucket = channelData.length / numBuckets;
    for (let b = 0; b < numBuckets; b++) {
      const start = Math.floor(b * samplesPerBucket);
      const end = Math.floor((b + 1) * samplesPerBucket);
      let max = 0;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(channelData[i]);
        if (abs > max) max = abs;
      }
      peaks[b] = Math.min(1.0, max);
    }
    return peaks;
  }

  function renderWaveformCanvas(canvas, peaks, playbackFraction, options) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    if (!peaks || peaks.length === 0) return;
    const opts = options || {};
    const colorPlayed    = opts.colorPlayed    !== undefined ? opts.colorPlayed    : 'rgba(167,139,250,0.9)';
    const colorUnplayed  = opts.colorUnplayed  !== undefined ? opts.colorUnplayed  : 'rgba(167,139,250,0.35)';
    const colorPlayhead  = opts.colorPlayhead  !== undefined ? opts.colorPlayhead  : 'rgba(255,255,255,0.9)';
    const backgroundColor = opts.backgroundColor !== undefined ? opts.backgroundColor : 'transparent';

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (backgroundColor !== 'transparent') {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, W, H);
    }

    const numPeaks = peaks.length;
    const barWidth = W / numPeaks;
    const fraction = Math.max(0, Math.min(1, playbackFraction || 0));
    const playheadX = Math.round(fraction * W);

    for (let i = 0; i < numPeaks; i++) {
      const x = i * barWidth;
      const barH = peaks[i] * H;
      const y = (H - barH) / 2;
      ctx.fillStyle = x < playheadX ? colorPlayed : colorUnplayed;
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    }

    // Draw 2px playhead line
    ctx.fillStyle = colorPlayhead;
    ctx.fillRect(playheadX - 1, 0, 2, H);
  }

  function formatWaveformStatus(numPeaks, isReady) {
    if (isReady && numPeaks > 0) {
      return 'Dạng sóng: ' + numPeaks + ' mẫu';
    }
    return 'Dạng sóng: đang tải...';
  }

  // --- Procedural Ambient Sound Synthesis & Volume Utilities (Pha D) ---

  function generatePinkNoiseBuffer(context, duration) {
    if (!context || typeof context.createBuffer !== 'function') return null;
    const sampleRate = (context && context.sampleRate) || 44100;
    const numFrames = Math.floor(Math.max(0, Number(duration) || 0) * sampleRate);
    const buffer = context.createBuffer(2, numFrames, sampleRate);
    if (numFrames === 0) return buffer;

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      // Pre-warm filter registers
      for (let w = 0; w < 64; w++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        b6 = white * 0.115926;
      }
      for (let i = 0; i < numFrames; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
        data[i] = Math.max(-1.0, Math.min(1.0, pink));
      }
    }
    return buffer;
  }

  function generateBrownNoiseBuffer(context, duration) {
    if (!context || typeof context.createBuffer !== 'function') return null;
    const sampleRate = (context && context.sampleRate) || 44100;
    const numFrames = Math.floor(Math.max(0, Number(duration) || 0) * sampleRate);
    const buffer = context.createBuffer(2, numFrames, sampleRate);
    if (numFrames === 0) return buffer;

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let y = 0.0;
      // Pre-warm leaky integrator
      for (let w = 0; w < 64; w++) {
        const white = Math.random() * 2 - 1;
        y = (y + 0.02 * white) / 1.02;
      }
      for (let i = 0; i < numFrames; i++) {
        const white = Math.random() * 2 - 1;
        y = (y + 0.02 * white) / 1.02;
        data[i] = Math.max(-1.0, Math.min(1.0, y * 3.5));
      }
    }
    return buffer;
  }

  function generateCampfireCrackleBuffer(context, duration) {
    if (!context || typeof context.createBuffer !== 'function') return null;
    const sampleRate = (context && context.sampleRate) || 44100;
    const numFrames = Math.floor(Math.max(0, Number(duration) || 0) * sampleRate);
    const buffer = context.createBuffer(2, numFrames, sampleRate);
    if (numFrames === 0) return buffer;

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let idx = 0;
      while (idx < numFrames) {
        // Inter-arrival interval between 15ms and 120ms
        const dt = 0.015 + Math.random() * 0.105;
        const intervalSamples = Math.floor(dt * sampleRate);
        idx += intervalSamples;
        if (idx >= numFrames) break;

        const isLoudPop = Math.random() < 0.15;
        const amplitude = isLoudPop ? (0.45 + Math.random() * 0.45) : (0.05 + Math.random() * 0.25);
        const tauDur = isLoudPop ? (0.008 + Math.random() * 0.020) : (0.002 + Math.random() * 0.007);
        const decaySamples = Math.floor(tauDur * sampleRate);
        const fRes = 300 + Math.random() * 2200;

        for (let j = 0; j < decaySamples && (idx + j) < numFrames; j++) {
          const t = j / sampleRate;
          const envelope = Math.exp(-t / (tauDur * 0.35));
          const snapNoise = (Math.random() * 2 - 1) * 0.7;
          const woodRing = Math.sin(2 * Math.PI * fRes * t) * 0.3;
          const sample = (snapNoise + woodRing) * amplitude * envelope;
          data[idx + j] = Math.max(-1.0, Math.min(1.0, data[idx + j] + sample));
        }
      }
    }
    return buffer;
  }

  function createAmbientChannel(context, type, options = {}) {
    if (!context) return null;
    const vol = (options && options.volume !== undefined) ? options.volume : 0.4;
    const gainNode = context.createGain ? context.createGain() : null;
    if (gainNode && gainNode.gain) gainNode.gain.value = vol;

    if (type === 'rain') {
      const buffer = generatePinkNoiseBuffer(context, 4.0);
      const source = context.createBufferSource ? context.createBufferSource() : null;
      let lp = null, hp = null;
      if (source) {
        source.buffer = buffer;
        source.loop = true;
      }
      if (context.createBiquadFilter) {
        lp = context.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1200;
        hp = context.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 200;
        if (source && gainNode) {
          source.connect(lp);
          lp.connect(hp);
          hp.connect(gainNode);
        }
      } else if (source && gainNode) {
        source.connect(gainNode);
      }
      if (source && typeof source.start === 'function') {
        try { source.start(0); } catch (_) {}
      }
      return {
        type: 'rain',
        source,
        gainNode,
        filters: { lp, hp },
        filter: lp,
        stop() {
          try { if (source && typeof source.stop === 'function') source.stop(); } catch (_) {}
          try { if (source && typeof source.disconnect === 'function') source.disconnect(); } catch (_) {}
        }
      };
    }

    if (type === 'campfire') {
      const emberBuffer = generateBrownNoiseBuffer(context, 4.0);
      const crackleBuffer = generateCampfireCrackleBuffer(context, 6.0);
      const emberSource = context.createBufferSource ? context.createBufferSource() : null;
      const crackleSource = context.createBufferSource ? context.createBufferSource() : null;
      if (emberSource) { emberSource.buffer = emberBuffer; emberSource.loop = true; }
      if (crackleSource) { crackleSource.buffer = crackleBuffer; crackleSource.loop = true; }
      if (emberSource && gainNode) emberSource.connect(gainNode);
      if (crackleSource && gainNode) crackleSource.connect(gainNode);
      if (emberSource && typeof emberSource.start === 'function') {
        try { emberSource.start(0); } catch (_) {}
      }
      if (crackleSource && typeof crackleSource.start === 'function') {
        try { crackleSource.start(0); } catch (_) {}
      }
      return {
        type: 'campfire',
        source: emberSource,
        emberSource,
        crackleSource,
        gainNode,
        stop() {
          try { if (emberSource && typeof emberSource.stop === 'function') emberSource.stop(); } catch (_) {}
          try { if (crackleSource && typeof crackleSource.stop === 'function') crackleSource.stop(); } catch (_) {}
          try { if (emberSource && typeof emberSource.disconnect === 'function') emberSource.disconnect(); } catch (_) {}
          try { if (crackleSource && typeof crackleSource.disconnect === 'function') crackleSource.disconnect(); } catch (_) {}
        }
      };
    }

    return {
      type,
      gainNode,
      stop() {
        try { if (gainNode && typeof gainNode.disconnect === 'function') gainNode.disconnect(); } catch (_) {}
      }
    };
  }

  function clampAmbientVolume(val, defaultVal = 40) {
    if (val === null || val === undefined || val === '') return defaultVal;
    const num = Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) return defaultVal;
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  function formatAmbientVolume(vol) {
    const clamped = clampAmbientVolume(vol, 0);
    return `${clamped}%`;
  }

  function formatAmbientSummary(rainEnabled, rainVol, campfireEnabled, campfireVol) {
    const rOn = Boolean(rainEnabled);
    const cOn = Boolean(campfireEnabled);
    if (!rOn && !cOn) return 'Đang tắt';
    const rText = `Mưa ${formatAmbientVolume(rainVol)}`;
    const cText = `Lửa trại ${formatAmbientVolume(campfireVol)}`;
    if (rOn && cOn) return `${rText} · ${cText}`;
    return rOn ? rText : cText;
  }

  // ── Roon Zone & Bridge Helpers ──

  function createZoneModel() {
    return [
      {
        id: 'zone_dsp',
        name: 'Phòng nghe Audiophile (PWA DSP)',
        type: 'local_dsp',
        isBitPerfect: false,
        state: 'stopped',
        description: 'Toàn bộ chuỗi xử lý DSP: EQ, Crossfeed, Tone Controls, ReplayGain & Ambient Mixer'
      },
      {
        id: 'zone_direct',
        name: 'Ngõ ra Trực tiếp (Bit-Perfect Direct)',
        type: 'local_direct',
        isBitPerfect: true,
        state: 'stopped',
        description: 'Bypass toàn bộ DSP, xuất âm thanh trực tiếp bit-transparent tới DAC'
      }
    ];
  }

  function formatRoonThreeLine(track, zone, signalPath) {
    if (!track) {
      return {
        line1: 'Chưa phát nhạc',
        line2: 'Sẵn sàng phát nhạc chất lượng cao',
        line3: zone ? (zone.name || zone.display_name || 'Phòng nghe Audiophile') : 'Phòng nghe Audiophile'
      };
    }
    const title = track.title || 'Không có tiêu đề';
    const artist = track.artist || 'Nghệ sĩ không xác định';
    const album = track.album || 'Không rõ album';
    let qualityStr = '';
    if (track.sampleRate || track.bits) {
      const rateKhz = track.sampleRate ? (track.sampleRate / 1000).toFixed(1) + ' kHz' : '';
      const bitsStr = track.bits ? track.bits + '-bit' : '';
      qualityStr = [bitsStr, rateKhz].filter(Boolean).join(' / ');
    } else if (track.isDsd) {
      qualityStr = 'DSD';
    } else {
      qualityStr = 'Lossless';
    }
    const bitPerfectTag = (zone && zone.isBitPerfect) ? ' · Bit-perfect' : '';
    const line3 = `${album} · ${qualityStr}${bitPerfectTag}`;
    return {
      line1: title,
      line2: artist,
      line3: line3
    };
  }

  function parseRoonCoreEndpoint(endpointStr) {
    if (!endpointStr || typeof endpointStr !== 'string') return null;
    const cleaned = endpointStr.trim().replace(/^ws:\/\/|^http:\/\//i, '').replace(/\/.*$/, '');
    if (!cleaned) return null;
    const parts = cleaned.split(':');
    const host = parts[0].trim();
    if (!host) return null;
    const port = parts[1] ? parseInt(parts[1], 10) : 9330;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
    return {
      host,
      port,
      wsUrl: `ws://${host}:${port}/api`
    };
  }

  function createRoonMooMessage(verb, name, body, requestId) {
    const reqId = requestId !== undefined ? requestId : 1;
    const v = verb ? String(verb).toUpperCase() : 'REQUEST';
    const service = name || 'com.roonlabs.ping:1/ping';
    const jsonBody = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '{}');
    return `MOO/1 ${v} ${service}\nRequest-Id: ${reqId}\nContent-Type: application/json\n\n${jsonBody}`;
  }

  function parseRoonMooMessage(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const headerEnd = rawText.indexOf('\n\n');
    const headersPart = headerEnd >= 0 ? rawText.substring(0, headerEnd) : rawText;
    const bodyPart = headerEnd >= 0 ? rawText.substring(headerEnd + 2) : '';
    const lines = headersPart.split('\n');
    const firstLine = lines[0] || '';
    const match = firstLine.match(/^MOO\/1\s+([A-Z]+)(?:\s+(.*))?$/);
    if (!match) return null;
    const verb = match[1];
    const name = match[2] || '';
    let requestId = null;
    let contentType = 'application/json';
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      const colon = l.indexOf(':');
      if (colon > 0) {
        const k = l.substring(0, colon).trim().toLowerCase();
        const val = l.substring(colon + 1).trim();
        if (k === 'request-id') requestId = val;
        if (k === 'content-type') contentType = val;
      }
    }
    let body = null;
    if (bodyPart) {
      if (contentType.includes('application/json')) {
        try { body = JSON.parse(bodyPart); } catch (_) { body = bodyPart; }
      } else {
        body = bodyPart;
      }
    }
    return { verb, name, requestId, contentType, body };
  }

  function formatRoonZoneStatus(zone) {
    if (!zone) return 'Không rõ';
    if (zone.is_paused || zone.state === 'paused') return 'Tạm dừng';
    if (zone.is_playing || zone.state === 'playing') return 'Đang phát';
    if (zone.state === 'loading') return 'Đang nạp';
    return 'Sẵn sàng';
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, normalizeSearchKey: metadataKey, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, fetchAudioFirstSlice, FIRST_SLICE_BYTES, flacFirstFrameOffset, FIRST_SLICE_FRAME_ALLOWANCE_BYTES, FIRST_SLICE_MAX_BYTES, fetchAudioRetryDelayMs, isFetchAudioRetryable, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks, compareTrackQuality, groupTrackVersions, parseLyrics, parseKaraokeWords, lyricWordAt, lyricLineAt, shouldScrollLyricIntoView, parseCloudConfig, PRELOAD_LEAD_SECONDS, shouldPreloadNext, clampSeekTime, CROSSFADE_MAX_SECONDS, crossfadeGains, clampCrossfadeSeconds, MAX_CLOUD_CATALOG_ENTRIES, pruneCatalogEntries, MAX_CATALOG_COVER_TOTAL_CHARS, capCatalogCovers, prepareRestoredCatalog, FIRST_SLICE_CACHE_MAX_ENTRIES, FIRST_SLICE_CACHE_MAX_BYTES, DSD_FIRST_SLICE_CACHE_MAX_BYTES, sliceCacheMetaMatches, pruneSliceCacheEntries, peakRmsFromTimeDomain, queueDisplayOrder, clampBalance, formatBalance, CROSSFEED_CUTOFF_HZ, CROSSFEED_DELAY_S, CROSSFEED_MAX_GAIN, clampCrossfeed, crossfeedCrossGain, formatCrossfeed, computeSignalPath, selectRoonRadioTrack, extractDominantColors, parseReplayGain, computeReplayGainMultiplier, formatReplayGain, summarizeAlbum, formatAlbumDuration, DEFAULT_SLEEP_FADEOUT_MS, calculateSleepFadeGain, formatSleepRemaining, isOnlineState, formatNetworkStatus, canPlayOffline, TONE_BASS_FREQ_HZ, TONE_TREBLE_FREQ_HZ, TONE_GAIN_MIN_DB, TONE_GAIN_MAX_DB, clampToneGain, formatToneGain, formatToneSummary, generateWaveformPeaks, renderWaveformCanvas, formatWaveformStatus, generatePinkNoiseBuffer, generateBrownNoiseBuffer, generateCampfireCrackleBuffer, createAmbientChannel, clampAmbientVolume, formatAmbientVolume, formatAmbientSummary, createZoneModel, formatRoonThreeLine, parseRoonCoreEndpoint, createRoonMooMessage, parseRoonMooMessage, formatRoonZoneStatus};
});
