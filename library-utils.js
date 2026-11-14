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

  function matchSearchQuery(searchStr, queryStr) {
    if (!queryStr) return true;
    if (!searchStr) return false;
    if (searchStr.includes(queryStr)) return true;
    const tokens = queryStr.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return false;
    return tokens.every(token => searchStr.includes(token));
  }

  function scoreSearchMatch(track, query) {
    const q = metadataKey(query);
    if (!q) return 0;
    const meta = normalizedTrackMetadata(track);
    const title = meta.title || '';
    const artist = meta.artist || '';
    const album = meta.album || '';
    const search = meta.search || '';

    if (title === q) return 1000;
    if (title.startsWith(q)) return 800;
    if (title.includes(q)) return 600;

    const tokens = q.split(/\s+/).filter(Boolean);
    const allInTitle = tokens.length > 1 && tokens.every(t => title.includes(t));
    if (allInTitle) return 500;

    if (artist === q || album === q) return 400;
    if (artist.startsWith(q) || album.startsWith(q)) return 350;
    if (artist.includes(q) || album.includes(q)) return 300;

    const allInSearch = tokens.length > 1 && tokens.every(t => search.includes(t));
    if (allInSearch) return 200;

    if (search.includes(q)) return 150;
    return 0;
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
    const filtered = tracks.filter(track => {
      if (hasSource && track.source !== filters.source) return false;
      if (hasFavorites && (!filters.isFavorite || !filters.isFavorite(track))) return false;
      if (!hasArtist && !hasAlbum && !query) return true;
      const normalized = normalizedTrackMetadata(track);
      if (hasArtist && normalized.artist !== artistKey) return false;
      if (hasAlbum && (normalized.album !== selectedAlbumKey || (selectedAlbumArtistKey && normalized.artist !== selectedAlbumArtistKey))) return false;
      return !query || matchSearchQuery(normalized.search, query);
    });
    if (filters.rankByRelevance && query && filtered.length > 1) {
      return [...filtered].sort((a, b) => scoreSearchMatch(b, query) - scoreSearchMatch(a, query));
    }
    return filtered;
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

  const CROSSFADE_CURVE_PROFILES = {
    'equal-power': {
      id: 'equal-power',
      name: 'Đẳng công suất (Equal Power)',
      description: 'Duy trì tổng công suất âm học không đổi (cos/sin), âm lượng mượt mà không bị hụt ở giữa bản nhạc.',
      formula: 'cos(t·π/2) / sin(t·π/2)'
    },
    'linear': {
      id: 'linear',
      name: 'Tuyến tính (Linear Gain)',
      description: 'Hòa âm suy giảm dần đều theo biên độ (1-t / t), lý tưởng cho nhạc giao hưởng, acoustic và ambient.',
      formula: '(1 - t) / t'
    },
    'exponential': {
      id: 'exponential',
      name: 'Mạnh mẽ (Log-Exponential / Club)',
      description: 'Giữ năng lượng bản nhạc cũ dài hơn và bùng nổ chuyển sang bài mới, tối ưu cho EDM, Dance và Hip-hop.',
      formula: 'sqrt(1 - t) / sqrt(t)'
    },
    's-curve': {
      id: 's-curve',
      name: 'Mềm mại (Smooth S-Curve / Sigmoid)',
      description: 'Đường cong mượt mà bậc 3 (Smoothstep) triệt tiêu hoàn toàn rung chấn chuyển tiếp ở hai đầu mút.',
      formula: 'smoothstep(3t² - 2t³)'
    }
  };

  function calculateCrossfadeGains(progress, curveType = 'equal-power') {
    const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const type = CROSSFADE_CURVE_PROFILES[curveType] ? curveType : 'equal-power';

    if (type === 'linear') {
      return { out: 1 - t, in: t };
    }

    if (type === 'exponential') {
      return { out: Math.sqrt(1 - t), in: Math.sqrt(t) };
    }

    if (type === 's-curve') {
      const s = t * t * (3 - 2 * t);
      const angle = s * Math.PI / 2;
      return { out: Math.cos(angle), in: Math.sin(angle) };
    }

    // Default: equal-power
    const angle = t * Math.PI / 2;
    return { out: Math.cos(angle), in: Math.sin(angle) };
  }

  function crossfadeGains(progress) {
    return calculateCrossfadeGains(progress, 'equal-power');
  }

  function clampCrossfadeSeconds(value, fallback = 0) {
    const seconds = Number(value);
    const fallbackSeconds = Number.isFinite(fallback) ? fallback : 0;
    if (!Number.isFinite(seconds)) return Math.min(CROSSFADE_MAX_SECONDS, Math.max(0, fallbackSeconds));
    return Math.min(CROSSFADE_MAX_SECONDS, Math.max(0, seconds));
  }

  function formatCrossfadeSummary(seconds, curveId = 'equal-power') {
    const s = clampCrossfadeSeconds(seconds, 0);
    if (s <= 0) return 'Tắt (Chuyển bài lập tức)';
    const profile = CROSSFADE_CURVE_PROFILES[curveId] || CROSSFADE_CURVE_PROFILES['equal-power'];
    return `${s}s · ${profile.name}`;
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
    if (options.autoEqProfile && options.autoEqProfile !== 'none') {
      const profile = getAutoEqProfile(options.autoEqProfile);
      if (profile) {
        const prefix = (profile.category === 'Target Curve') ? 'Target Curve' : (profile.category === 'Sound Signature' ? 'Sound Signature' : 'AutoEQ');
        dspActive.push(`${prefix}: ${profile.name}`);
      }
    }
    if (options.phaseInvert) {
      dspActive.push('Đảo pha: Ø 180°');
    }
    if (options.limiterMode && options.limiterMode !== 'off') {
      const limProfile = getLimiterProfile(options.limiterMode);
      dspActive.push(`Peak Limiter: ${limProfile.name}`);
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

    const candidates = tracks.filter(t => t && t.id && !excludeSet.has(t.id) && (!options.isOffline || canPlayOffline(t)));
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

  function formatSleepCountdownCompact(remainingMs) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '0:00';
    const totalSecs = Math.max(0, Math.floor(remainingMs / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const sStr = s < 10 ? '0' + s : String(s);
    if (h > 0) {
      const mStr = m < 10 ? '0' + m : String(m);
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }

  function calculateAlbumRemainingSeconds(tracks, currentTrackId, currentTrackPlaybackSec = 0) {
    if (!Array.isArray(tracks) || !currentTrackId) return 0;
    const curTrack = tracks.find(t => t && t.id === currentTrackId);
    if (!curTrack || !curTrack.album) return Math.max(0, Math.round((curTrack?.duration || 0) - (Number(currentTrackPlaybackSec) || 0)));
    const albumTracks = tracks.filter(t => t && t.album === curTrack.album);
    const curIndex = albumTracks.findIndex(t => t.id === currentTrackId);
    if (curIndex === -1) return Math.max(0, Math.round((curTrack.duration || 0) - (Number(currentTrackPlaybackSec) || 0)));

    let remaining = Math.max(0, (curTrack.duration || 0) - (Number(currentTrackPlaybackSec) || 0));
    for (let i = curIndex + 1; i < albumTracks.length; i++) {
      const t = albumTracks[i];
      if (t && Number.isFinite(t.duration) && t.duration > 0) {
        remaining += t.duration;
      }
    }
    return Math.round(remaining);
  }

  function extendSleepTimer(currentRemainingMs, addMinutes) {
    const addMs = Math.max(0, (Number(addMinutes) || 0) * 60000);
    const curMs = (Number.isFinite(currentRemainingMs) && currentRemainingMs > 0) ? currentRemainingMs : 0;
    const maxMs = 360 * 60000; // tối đa 6 tiếng
    return Math.min(maxMs, curMs + addMs);
  }

  function calculateAdaptiveSleepStage(remainingMs, totalDurationMs, fadeDurationMs = DEFAULT_SLEEP_FADEOUT_MS, options = {}) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      return { stage: 'ended', musicGain: 0, ambientGain: 0 };
    }
    const fadeMs = Math.max(1000, Number(fadeDurationMs) || DEFAULT_SLEEP_FADEOUT_MS);
    if (remainingMs <= fadeMs) {
      const musicGain = calculateSleepFadeGain(remainingMs, fadeMs);
      const ambientGain = options.ambientScene ? musicGain * (options.ambientBaseVolume ?? 0.3) : 0;
      return { stage: 'fadeout', musicGain, ambientGain };
    }
    const ambientWindowMs = Math.max(fadeMs * 2, Math.min(600000, (Number(totalDurationMs) || 0) * 0.4));
    if (options.ambientScene && remainingMs <= ambientWindowMs) {
      const transitionProgress = 1 - (remainingMs - fadeMs) / (ambientWindowMs - fadeMs);
      const ambientGain = Math.max(0, Math.min(1, transitionProgress)) * (options.ambientBaseVolume ?? 0.3);
      return { stage: 'ambient_transition', musicGain: 1.0, ambientGain };
    }
    return { stage: 'active', musicGain: 1.0, ambientGain: options.ambientScene ? (options.ambientBaseVolume ?? 0.3) * 0.5 : 0 };
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
    const colorPlayed        = opts.colorPlayed        !== undefined ? opts.colorPlayed        : 'rgba(167,139,250,0.9)';
    const colorUnplayed      = opts.colorUnplayed      !== undefined ? opts.colorUnplayed      : 'rgba(167,139,250,0.35)';
    const colorPlayhead      = opts.colorPlayhead      !== undefined ? opts.colorPlayhead      : 'rgba(255,255,255,0.9)';
    const colorGhostPlayhead = opts.colorGhostPlayhead !== undefined ? opts.colorGhostPlayhead : 'rgba(255,255,255,0.45)';
    const backgroundColor   = opts.backgroundColor    !== undefined ? opts.backgroundColor    : 'transparent';

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

    // Draw ghost playhead line on hover if provided
    if (typeof opts.hoverFraction === 'number' && Number.isFinite(opts.hoverFraction) && opts.hoverFraction >= 0 && opts.hoverFraction <= 1) {
      const hoverX = Math.round(opts.hoverFraction * W);
      ctx.fillStyle = colorGhostPlayhead;
      ctx.fillRect(hoverX - 0.5, 0, 1.5, H);
    }

    // Draw 2px playhead line
    ctx.fillStyle = colorPlayhead;
    ctx.fillRect(playheadX - 1, 0, 2, H);
  }

  function calculateHoverSeekFraction(clientX, rect) {
    if (!rect || typeof rect.width !== 'number' || rect.width <= 0) return 0;
    const x = clientX - (rect.left || 0);
    return Math.max(0, Math.min(1, x / rect.width));
  }

  function calculateHoverSeekTime(clientX, rect, duration) {
    const frac = calculateHoverSeekFraction(clientX, rect);
    const dur = Math.max(0, Number(duration) || 0);
    return Math.max(0, Math.min(dur, frac * dur));
  }

  function formatHoverTime(seconds) {
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
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

  // ── Roon Luxe UI Helpers (Focus Engine, Signal Path LED & Stages) ─────────

  function filterTracksByFocus(tracks, focusCriteria, options = {}) {
    if (!Array.isArray(tracks)) return [];
    if (!focusCriteria || focusCriteria === 'all' || (Array.isArray(focusCriteria) && focusCriteria.length === 0)) {
      return tracks;
    }
    const criteria = Array.isArray(focusCriteria) ? focusCriteria : [focusCriteria];
    const favs = options.favorites || new Set();

    return tracks.filter(track => {
      if (!track) return false;
      return criteria.every(crit => {
        if (!crit || crit === 'all') return true;
        if (crit === 'dsd') {
          return Boolean(track.isDsd || (track.format && track.format.toUpperCase().includes('DSD')) || (track.path && track.path.match(/\.(dsf|dff)$/i)));
        }
        if (crit === 'hires') {
          return !track.isDsd && ((track.sampleRate && track.sampleRate > 48000) || (track.bitDepth && track.bitDepth > 16));
        }
        if (crit === 'lossless') {
          return !track.isDsd &&
            (!track.bitDepth || track.bitDepth <= 16) &&
            (!track.sampleRate || track.sampleRate <= 48000) &&
            (!track.format || track.format.toUpperCase().includes('FLAC') || track.format.toUpperCase().includes('WAV') || track.format.toUpperCase().includes('ALAC') || track.format.toUpperCase().includes('LOSSLESS'));
        }
        if (crit === 'favorite') {
          return Boolean(track.isFavorite || (favs && favs.has(track.id)));
        }
        if (crit === 'cloud') {
          return track.source === 'google' || track.source === 'microsoft' || track.source === 'cloud';
        }
        if (crit === 'local') {
          return track.source === 'local' || !track.source;
        }
        if (crit === 'offline') {
          return canPlayOffline(track);
        }
        return true;
      });
    });
  }

  function countFocusCategories(tracks, favorites = new Set()) {
    if (!Array.isArray(tracks)) return { all: 0, dsd: 0, hires: 0, lossless: 0, favorite: 0, cloud: 0, local: 0, offline: 0 };
    const counts = { all: tracks.length, dsd: 0, hires: 0, lossless: 0, favorite: 0, cloud: 0, local: 0, offline: 0 };
    for (const track of tracks) {
      if (!track) continue;
      if (track.isDsd || (track.format && track.format.toUpperCase().includes('DSD')) || (track.path && track.path.match(/\.(dsf|dff)$/i))) {
        counts.dsd++;
      } else if ((track.sampleRate && track.sampleRate > 48000) || (track.bitDepth && track.bitDepth > 16)) {
        counts.hires++;
      } else if (!track.format || track.format.toUpperCase().includes('FLAC') || track.format.toUpperCase().includes('WAV') || track.format.toUpperCase().includes('ALAC') || track.format.toUpperCase().includes('LOSSLESS')) {
        counts.lossless++;
      }
      if (track.isFavorite || (favorites && favorites.has(track.id))) {
        counts.favorite++;
      }
      if (track.source === 'google' || track.source === 'microsoft' || track.source === 'cloud') {
        counts.cloud++;
      } else {
        counts.local++;
      }
      if (canPlayOffline(track)) {
        counts.offline++;
      }
    }
    return counts;
  }

  function formatFocusBadge(criterion) {
    const labels = {
      all: 'Tất cả',
      dsd: 'DSD Audiophile',
      hires: 'Hi-Res Lossless',
      lossless: 'Lossless CD',
      favorite: 'Yêu thích',
      cloud: 'Đám mây',
      local: 'Tập tin máy',
      offline: 'Ngoại tuyến (Offline)'
    };
    return labels[criterion] || criterion || '';
  }

  function computeRoonSignalLed(qualityTier, isBitPerfect) {
    if (isBitPerfect || qualityTier === 'BIT-PERFECT') {
      return { color: 'purple', hex: '#a855f7', label: 'Bit-Perfect', stars: 5, pulse: true };
    }
    if (qualityTier === 'DSD') {
      return { color: 'purple', hex: '#c084fc', label: 'DSD Direct', stars: 5, pulse: true };
    }
    if (qualityTier === 'HI-RES') {
      return { color: 'green', hex: '#10b981', label: 'High Resolution', stars: 4, pulse: false };
    }
    if (qualityTier === 'ENHANCED') {
      return { color: 'blue', hex: '#3b82f6', label: 'Enhanced DSP', stars: 4, pulse: false };
    }
    if (qualityTier === 'LOSSLESS') {
      return { color: 'green', hex: '#34d399', label: 'Lossless CD', stars: 3, pulse: false };
    }
    return { color: 'yellow', hex: '#eab308', label: 'Standard Quality', stars: 2, pulse: false };
  }

  function buildRoonSignalPathStages(track, options = {}) {
    if (!track) return [];
    const stages = [];
    const isBypassed = !!options.isDspBypassed;

    // Stage 1: Source
    const sourceRateStr = track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)}kHz` : 'PCM';
    const sourceDepthStr = track.bitDepth ? `${track.bitDepth}-bit` : '';
    const sourceDesc = track.isDsd
      ? `DSD${track.dsdMultiplier || 64} · 1-bit / ${(track.sampleRate ? (track.sampleRate / 1000000).toFixed(2) : '2.82')}MHz`
      : `${track.format || 'FLAC'} ${sourceRateStr}${sourceDepthStr ? ` / ${sourceDepthStr}` : ''}`;
    stages.push({
      stage: 'source',
      name: 'Nguồn âm thanh',
      icon: 'file',
      status: track.isDsd ? 'dsd' : (track.sampleRate > 48000 || track.bitDepth > 16 ? 'hires' : 'lossless'),
      description: sourceDesc,
      subtext: track.title || 'Bài hát'
    });

    // Stage 2: Decoder
    stages.push({
      stage: 'decoder',
      name: 'Bộ giải mã',
      icon: 'cpu',
      status: 'bitperfect',
      description: track.isDsd ? 'DSD-to-PCM Audio Worker Engine' : 'Trình giải mã Native Audio Web',
      subtext: 'Bảo toàn nguyên vẹn bitstream'
    });

    // Stage 3: DSP
    stages.push({
      stage: 'dsp',
      name: 'Bộ xử lý DSP',
      icon: 'sliders',
      status: isBypassed ? 'bypassed' : 'enhanced',
      description: isBypassed ? 'Bit-Perfect Direct (Bypass hoàn toàn DSP)' : (options.dspSummary || 'PWA DSP Engine Active'),
      subtext: isBypassed ? 'Không can thiệp tín hiệu số' : (options.dspDetails || 'EQ & Headroom Management')
    });

    // Stage 4: Output
    const outRate = options.outputSampleRate || 48000;
    stages.push({
      stage: 'output',
      name: 'Đầu ra & Vùng phát',
      icon: 'speaker',
      status: 'ready',
      description: options.zoneName || 'Phòng nghe Audiophile',
      subtext: `AudioContext ${(outRate / 1000).toFixed(1)} kHz`
    });

    return stages;
  }

  // --- AutoEQ Headphone Profiles & Harman Target Compensation ---
  const AUTOEQ_PROFILES = {
    'none': {
      id: 'none',
      name: 'Không cân chỉnh (Bypass)',
      category: 'Direct',
      description: 'Phẳng / Không can thiệp đường cong tai nghe',
      preamp: 0,
      bands: []
    },
    'target-harman-2019': {
      id: 'target-harman-2019',
      name: 'Harman Target 2019',
      category: 'Target Curve',
      description: 'Chuẩn âm học toàn cầu: Sub-bass ấm áp, Vocal trong trẻo, Treble tự nhiên',
      preamp: -4.5,
      bands: [
        { type: 'lowshelf', frequency: 105, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 3000, gain: 2.0, q: 2.0 },
        { type: 'highshelf', frequency: 10000, gain: -0.5, q: 0.71 }
      ]
    },
    'target-diffuse-field': {
      id: 'target-diffuse-field',
      name: 'Diffuse Field Studio Reference',
      category: 'Target Curve',
      description: 'Chuẩn kiểm âm phòng thu phẳng: Tách bạch chi tiết micro-dynamics và không gian acoustic',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 80, gain: -1.0, q: 0.71 },
        { type: 'peaking', frequency: 2800, gain: 3.0, q: 1.8 },
        { type: 'highshelf', frequency: 12000, gain: 1.5, q: 0.71 }
      ]
    },
    'target-warm-vocal': {
      id: 'target-warm-vocal',
      name: 'Vocal Warmth & Intimacy',
      category: 'Sound Signature',
      description: 'Tôn vinh giọng ca ngọt ngào, mid-forward ấm áp, kiểm soát triệt để tiếng chói sibilance',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 150, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 1200, gain: 2.0, q: 1.5 },
        { type: 'peaking', frequency: 2500, gain: 2.5, q: 2.0 },
        { type: 'peaking', frequency: 6500, gain: -2.5, q: 2.5 }
      ]
    },
    'target-basshead-club': {
      id: 'target-basshead-club',
      name: 'Basshead Club Impact',
      category: 'Sound Signature',
      description: 'Dải trầm sub-bass sâu chắc khỏe cho EDM/Hip-hop, uy lực sàn diễn club',
      preamp: -6.0,
      bands: [
        { type: 'lowshelf', frequency: 65, gain: 6.0, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: 2.5, q: 1.2 },
        { type: 'peaking', frequency: 400, gain: -1.5, q: 1.5 },
        { type: 'highshelf', frequency: 8000, gain: 1.0, q: 0.71 }
      ]
    },
    'target-treble-air': {
      id: 'target-treble-air',
      name: 'Acoustic Air & Soundstage',
      category: 'Sound Signature',
      description: 'Mở rộng âm trường 3D thoáng đãng, lấp lánh dải treble cao (Air band)',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 120, gain: -1.0, q: 0.71 },
        { type: 'peaking', frequency: 3500, gain: 1.2, q: 2.0 },
        { type: 'highshelf', frequency: 10000, gain: 3.0, q: 0.71 },
        { type: 'peaking', frequency: 14000, gain: 2.0, q: 1.8 }
      ]
    },
    'sennheiser-hd600': {
      id: 'sennheiser-hd600',
      name: 'Sennheiser HD 600',
      category: 'Over-Ear Open',
      description: 'Cân chỉnh Harman Over-Ear: bù sub-bass, làm phẳng mid/treble',
      preamp: -4.5,
      bands: [
        { type: 'lowshelf', frequency: 50, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 190, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 1250, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 3200, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 5800, gain: 2.2, q: 3.0 },
        { type: 'highshelf', frequency: 10000, gain: 1.5, q: 0.71 }
      ]
    },
    'sennheiser-hd650': {
      id: 'sennheiser-hd650',
      name: 'Sennheiser HD 650 / 6XX',
      category: 'Over-Ear Open',
      description: 'Cân chỉnh Harman Over-Ear: bù sub-bass, giảm mờ mid-bass, mở rộng dải treble',
      preamp: -5.0,
      bands: [
        { type: 'lowshelf', frequency: 45, gain: 5.0, q: 0.71 },
        { type: 'peaking', frequency: 220, gain: -2.0, q: 1.1 },
        { type: 'peaking', frequency: 1300, gain: -1.0, q: 1.8 },
        { type: 'peaking', frequency: 3300, gain: -1.8, q: 2.2 },
        { type: 'peaking', frequency: 5600, gain: 3.0, q: 2.8 },
        { type: 'highshelf', frequency: 10500, gain: 2.0, q: 0.71 }
      ]
    },
    'ath-m50x': {
      id: 'ath-m50x',
      name: 'Audio-Technica ATH-M50x',
      category: 'Over-Ear Closed',
      description: 'Cân chỉnh Harman Over-Ear: giảm dải bass thừa, tăng vocal, làm mượt treble gắt',
      preamp: -3.5,
      bands: [
        { type: 'peaking', frequency: 180, gain: -3.5, q: 1.0 },
        { type: 'peaking', frequency: 400, gain: 1.5, q: 1.5 },
        { type: 'peaking', frequency: 1200, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 3100, gain: 3.0, q: 2.0 },
        { type: 'peaking', frequency: 9200, gain: -4.0, q: 3.0 }
      ]
    },
    'sony-wh1000xm4': {
      id: 'sony-wh1000xm4',
      name: 'Sony WH-1000XM4',
      category: 'Over-Ear ANC',
      description: 'Cân chỉnh Harman Over-Ear: gọt bass bloat, mở rộng vocal & độ trong trẻo soundstage',
      preamp: -4.0,
      bands: [
        { type: 'peaking', frequency: 150, gain: -5.0, q: 0.8 },
        { type: 'peaking', frequency: 700, gain: 1.8, q: 1.4 },
        { type: 'peaking', frequency: 2400, gain: 3.5, q: 1.8 },
        { type: 'peaking', frequency: 6500, gain: -2.5, q: 2.5 },
        { type: 'highshelf', frequency: 8500, gain: 3.0, q: 0.71 }
      ]
    },
    'beyer-dt770': {
      id: 'beyer-dt770',
      name: 'Beyerdynamic DT 770 Pro (80Ω)',
      category: 'Over-Ear Studio',
      description: 'Cân chỉnh Harman Over-Ear: triệt tiêu đỉnh gắt 6kHz/8.5kHz (Beyer peak), nâng vocal',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 70, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 2200, gain: 2.5, q: 1.6 },
        { type: 'peaking', frequency: 6000, gain: -5.0, q: 3.0 },
        { type: 'peaking', frequency: 8500, gain: -4.0, q: 3.5 },
        { type: 'highshelf', frequency: 11000, gain: -1.5, q: 0.71 }
      ]
    },
    'airpods-pro': {
      id: 'airpods-pro',
      name: 'Apple AirPods Pro',
      category: 'In-Ear TWS',
      description: 'Cân chỉnh Harman In-Ear: làm mịn upper-midrange, cân bằng dải âm tự nhiên',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 60, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 1800, gain: -2.0, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 3.0, q: 2.5 },
        { type: 'peaking', frequency: 7500, gain: -3.0, q: 3.0 }
      ]
    },
    'hifiman-sundara': {
      id: 'hifiman-sundara',
      name: 'HiFiMan Sundara',
      category: 'Planar Magnetic',
      description: 'Cân chỉnh Harman Over-Ear: tăng lực sub-bass Planar, kiểm soát treble 9kHz',
      preamp: -4.5,
      bands: [
        { type: 'lowshelf', frequency: 45, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 1500, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 9200, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    }
  };

  function getAutoEqProfile(id) {
    if (typeof id !== 'string' || !AUTOEQ_PROFILES[id]) return null;
    const profile = AUTOEQ_PROFILES[id];
    return {
      id: profile.id,
      name: profile.name,
      category: profile.category,
      description: profile.description,
      preamp: profile.preamp,
      bands: profile.bands.map(b => ({
        type: b.type || 'peaking',
        frequency: Math.max(20, Math.min(20000, Number(b.frequency) || 1000)),
        gain: Math.max(-24, Math.min(24, Number(b.gain) || 0)),
        q: Math.max(0.1, Math.min(18, Number(b.q) || 1))
      }))
    };
  }

  function listAutoEqProfiles() {
    return Object.keys(AUTOEQ_PROFILES).map(key => ({
      id: AUTOEQ_PROFILES[key].id,
      name: AUTOEQ_PROFILES[key].name,
      category: AUTOEQ_PROFILES[key].category,
      description: AUTOEQ_PROFILES[key].description,
      preamp: AUTOEQ_PROFILES[key].preamp,
      bandCount: AUTOEQ_PROFILES[key].bands.length
    }));
  }

  function calculateAutoEqPreamp(bands = []) {
    if (!Array.isArray(bands) || bands.length === 0) return 0;
    let maxBoost = 0;
    for (const band of bands) {
      const g = Number(band && band.gain) || 0;
      if (g > maxBoost) maxBoost = g;
    }
    return maxBoost > 0 ? -Math.round(maxBoost * 10) / 10 : 0;
  }

  function formatAutoEqProfile(profile) {
    if (!profile || profile.id === 'none') return 'Không cân chỉnh (Bypass)';
    return `${profile.name} (${profile.category || 'Harman'}) · Preamp ${profile.preamp || 0} dB`;
  }

  function clampPhaseInvert(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === '1';
    if (typeof value === 'number') return value === -1 || value === 1 ? value === -1 : Boolean(value);
    return false;
  }

  function formatPhaseInvert(inverted) {
    return inverted ? 'Ø 180° (Đảo pha)' : '0° (Chuẩn)';
  }

  function cleanSearchQuery(title, artist) {
    const cleanTitle = String(title || '')
      .replace(/\.(mp3|flac|wav|m4a|dsf|dff|aac|ogg|opus)$/i, '')
      .replace(/\s*[\(\[](?:feat|ft|official|audio|video|lyrics|explicit|remastered|remaster|live)[^\)\]]*[\)\]]/gi, '')
      .replace(/^[0-9\.\-\s_]+/, '')
      .trim();
    const cleanArtist = String(artist || '')
      .replace(/\s*[\(\[](?:feat|ft)[^\)\]]*[\)\]]/gi, '')
      .trim();
    return { title: cleanTitle || String(title || ''), artist: cleanArtist || String(artist || '') };
  }

  function generateDeterministicWaveform(seed, count = 200) {
    const peaks = new Float32Array(count);
    let h = 0x811c9dc5;
    const str = String(seed || 'nocturne-audio-track');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    for (let i = 0; i < count; i++) {
      h ^= (i + 1);
      h = Math.imul(h, 0x01000193);
      const r1 = ((h >>> 0) % 1000) / 1000;
      const envelope = Math.sin((i / count) * Math.PI) * 0.5 + 0.35;
      const variation = (r1 * 0.45) - 0.15;
      peaks[i] = Math.max(0.12, Math.min(0.98, envelope + variation));
    }
    return peaks;
  }

  // ── Orynivo Audio Engine Utilities (CUE Sheet, Smart Playlist & Rating) ──

  function parseCueSheet(cueText, totalDuration = null) {
    const tracks = [];
    let globalTitle = '';
    let globalPerformer = '';
    let globalSongwriter = '';
    let globalFile = '';
    let globalGenre = '';
    let globalDate = '';

    if (typeof cueText !== 'string' || !cueText.trim()) {
      return Object.assign(tracks, {
        title: '',
        album: '',
        performer: '',
        artist: '',
        songwriter: '',
        file: '',
        genre: '',
        date: '',
        tracks
      });
    }

    const lines = cueText.split(/\r?\n/);
    let currentTrack = null;
    let currentFile = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // REM lines (e.g. REM GENRE "Rock", REM DATE 1994)
      const remMatch = line.match(/^REM\s+(\S+)\s*(.*)$/i);
      if (remMatch) {
        const remKey = remMatch[1].toUpperCase();
        const remVal = remMatch[2].replace(/^["']|["']$/g, '').trim();
        if (remKey === 'GENRE') {
          if (!currentTrack) globalGenre = remVal;
          else currentTrack.genre = remVal;
        } else if (remKey === 'DATE' || remKey === 'YEAR') {
          if (!currentTrack) globalDate = remVal;
          else currentTrack.year = remVal;
        }
        continue;
      }

      // FILE "filename" TYPE
      const fileMatch = line.match(/^FILE\s+(?:"([^"]+)"|'([^']*)'|(\S+))\s*(.*)$/i);
      if (fileMatch) {
        const fileName = (fileMatch[1] || fileMatch[2] || fileMatch[3] || '').trim();
        currentFile = fileName;
        if (!currentTrack && !globalFile) {
          globalFile = fileName;
        }
        continue;
      }

      // TRACK nn AUDIO
      const trackMatch = line.match(/^TRACK\s+(\d+)(?:\s+(\S+))?/i);
      if (trackMatch) {
        const trackNum = parseInt(trackMatch[1], 10);
        currentTrack = {
          number: trackNum,
          track: trackNum,
          title: '',
          performer: '',
          artist: '',
          album: '',
          file: currentFile || globalFile || '',
          offset: 0,
          startTime: 0,
          start: 0,
          duration: 0,
          indexes: {}
        };
        tracks.push(currentTrack);
        continue;
      }

      // Global or Per-Track properties
      if (!currentTrack) {
        const titleMatch = line.match(/^TITLE\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (titleMatch) {
          globalTitle = (titleMatch[1] || titleMatch[2] || titleMatch[3] || '').trim();
          continue;
        }

        const performerMatch = line.match(/^PERFORMER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (performerMatch) {
          globalPerformer = (performerMatch[1] || performerMatch[2] || performerMatch[3] || '').trim();
          continue;
        }

        const songwriterMatch = line.match(/^SONGWRITER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (songwriterMatch) {
          globalSongwriter = (songwriterMatch[1] || songwriterMatch[2] || songwriterMatch[3] || '').trim();
          continue;
        }
      } else {
        const titleMatch = line.match(/^TITLE\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (titleMatch) {
          currentTrack.title = (titleMatch[1] || titleMatch[2] || titleMatch[3] || '').trim();
          continue;
        }

        const performerMatch = line.match(/^PERFORMER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (performerMatch) {
          currentTrack.performer = (performerMatch[1] || performerMatch[2] || performerMatch[3] || '').trim();
          continue;
        }

        const songwriterMatch = line.match(/^SONGWRITER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (songwriterMatch) {
          currentTrack.songwriter = (songwriterMatch[1] || songwriterMatch[2] || songwriterMatch[3] || '').trim();
          continue;
        }

        // INDEX nn mm:ss:ff
        const indexMatch = line.match(/^INDEX\s+(\d+)\s+(\d{1,3}):(\d{2}):(\d{2})/i);
        if (indexMatch) {
          const idxNum = indexMatch[1];
          const mm = parseInt(indexMatch[2], 10);
          const ss = parseInt(indexMatch[3], 10);
          const ff = parseInt(indexMatch[4], 10);
          const offsetSeconds = mm * 60 + ss + ff / 75;
          currentTrack.indexes[idxNum] = offsetSeconds;

          if (idxNum === '01' || idxNum === '1') {
            currentTrack.offset = offsetSeconds;
            currentTrack.startTime = offsetSeconds;
            currentTrack.start = offsetSeconds;
            currentTrack.index01 = offsetSeconds;
          } else if (idxNum === '00' || idxNum === '0') {
            currentTrack.index00 = offsetSeconds;
          }
          continue;
        }
      }
    }

    // Post-process tracks
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track.title) {
        track.title = `Track ${track.number}`;
      }
      if (!track.performer) {
        track.performer = globalPerformer || globalSongwriter || UNKNOWN_ARTIST;
      }
      track.artist = track.performer;
      track.album = globalTitle || UNKNOWN_ALBUM;
      if (!track.file) {
        track.file = globalFile;
      }
      if (globalGenre && !track.genre) {
        track.genre = globalGenre;
      }
      if (globalDate && !track.year) {
        track.year = globalDate;
      }

      // Calculate track duration from offset difference between consecutive tracks
      if (i < tracks.length - 1) {
        const next = tracks[i + 1];
        const diff = next.offset - track.offset;
        track.duration = diff > 0 ? diff : 0;
      } else if (totalDuration != null && Number.isFinite(Number(totalDuration))) {
        track.duration = Math.max(0, Number(totalDuration) - track.offset);
      } else {
        track.duration = 0;
      }
    }

    tracks.title = globalTitle;
    tracks.album = globalTitle;
    tracks.performer = globalPerformer;
    tracks.artist = globalPerformer || globalSongwriter;
    tracks.songwriter = globalSongwriter;
    tracks.file = globalFile;
    tracks.genre = globalGenre;
    tracks.date = globalDate;
    tracks.tracks = tracks;

    return tracks;
  }

  function evaluateSmartPlaylist(rules, track) {
    if (!rules || typeof rules !== 'object') return true;
    if (!track || typeof track !== 'object') return false;

    // rules.format: checks track.format / quality
    if (rules.format !== undefined && rules.format !== null && rules.format !== '') {
      const reqFormats = Array.isArray(rules.format) ? rules.format : [rules.format];
      const matched = reqFormats.some(fmt => {
        const f = String(fmt).toLowerCase().trim();
        if (!f || f === 'all') return true;

        if (f === 'dsd' || f.includes('dsd')) {
          if (track.isDsd) return true;
          if (track.qualityTier === 'dsd') return true;
          const fmtStr = String(track.format || '').toLowerCase();
          if (fmtStr.includes('dsd') || fmtStr === 'dsf' || fmtStr === 'dff') return true;
          const pathStr = String(track.path || track.file || track.url || track.name || '').toLowerCase();
          if (/\.(dsf|dff)$/i.test(pathStr)) return true;
          const qStr = String((track.quality && track.quality.label) || track.quality || track.qualityLabel || '').toLowerCase();
          if (qStr.includes('dsd')) return true;
          return false;
        }

        if (f === 'hires' || f === 'hi-res' || f.includes('hi-res') || f.includes('hires') || f === 'highres') {
          if (track.isHiRes) return true;
          if (track.qualityTier === 'highres') return true;
          if ((track.sampleRate && track.sampleRate > 48000) || (track.bitDepth && track.bitDepth > 16)) return true;
          const fmtStr = String(track.format || '').toLowerCase();
          if (fmtStr.includes('hi-res') || fmtStr.includes('hires')) return true;
          const qStr = String((track.quality && track.quality.label) || track.quality || track.qualityLabel || '').toLowerCase();
          if (qStr.includes('hi-res') || qStr.includes('hires')) return true;
          return false;
        }

        if (f === 'lossless') {
          if (track.qualityTier === 'lossless') return true;
          const fmtStr = String(track.format || '').toLowerCase();
          if (fmtStr.includes('lossless') || fmtStr.includes('flac') || fmtStr.includes('wav') || fmtStr.includes('alac')) return true;
          return false;
        }

        const fmtStr = String(track.format || '').toLowerCase();
        const qStr = String((track.quality && track.quality.label) || track.quality || track.qualityLabel || '').toLowerCase();
        const pathStr = String(track.path || track.file || track.url || track.name || '').toLowerCase();
        return fmtStr.includes(f) || qStr.includes(f) || pathStr.endsWith('.' + f);
      });
      if (!matched) return false;
    }

    // rules.favorite: checks isFavorite
    if (rules.favorite !== undefined && rules.favorite !== null) {
      const isFav = Boolean(track.isFavorite || track.favorite);
      if (Boolean(rules.favorite) !== isFav) {
        return false;
      }
    }

    // rules.minDuration / maxDuration: checks track.duration
    if (rules.minDuration !== undefined && rules.minDuration !== null) {
      const minDur = Number(rules.minDuration);
      const trackDur = Number(track.duration || 0);
      if (trackDur < minDur) return false;
    }
    if (rules.maxDuration !== undefined && rules.maxDuration !== null) {
      const maxDur = Number(rules.maxDuration);
      const trackDur = Number(track.duration || 0);
      if (trackDur > maxDur) return false;
    }

    // rules.artist: case-insensitive substring
    if (rules.artist !== undefined && rules.artist !== null && rules.artist !== '') {
      const reqArtist = String(rules.artist).toLowerCase().trim();
      const trackArtist = String(track.artist || track.performer || '').toLowerCase();
      if (!trackArtist.includes(reqArtist)) return false;
    }

    // rules.genre: case-insensitive substring
    if (rules.genre !== undefined && rules.genre !== null && rules.genre !== '') {
      const reqGenre = String(rules.genre).toLowerCase().trim();
      const trackGenre = String(track.genre || '').toLowerCase();
      if (!trackGenre.includes(reqGenre)) return false;
    }

    // rules.minRating: checks track.rating (1-5)
    if (rules.minRating !== undefined && rules.minRating !== null) {
      const minRating = Number(rules.minRating);
      const trackRating = Number(track.rating || 0);
      if (trackRating < minRating) return false;
    }

    if (rules.rating !== undefined && rules.rating !== null) {
      const reqRating = Number(rules.rating);
      const trackRating = Number(track.rating || 0);
      if (trackRating !== reqRating) return false;
    }

    if (rules.maxRating !== undefined && rules.maxRating !== null) {
      const maxRating = Number(rules.maxRating);
      const trackRating = Number(track.rating || 0);
      if (trackRating > maxRating) return false;
    }

    return true;
  }

  function clampRating(rating) {
    const num = Math.round(Number(rating));
    if (!Number.isFinite(num) || num < 0) return 0;
    if (num > 5) return 5;
    return num;
  }

  function formatRating(rating) {
    const stars = clampRating(rating);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  // Pha B — Dynamic Range Meter (DR Score / Crest Factor = Peak_dB - RMS_dB)
  function calculateDynamicRange(peakDb, rmsDb) {
    const p = Number(peakDb), r = Number(rmsDb);
    if (!Number.isFinite(p) || !Number.isFinite(r) || p <= -90 || r <= -90) {
      return 0;
    }
    const diff = Math.max(0, p - r);
    return Math.round(diff * 10) / 10;
  }

  function formatDynamicRange(drScore) {
    const score = Math.max(0, Number(drScore) || 0);
    const rounded = Math.round(score);
    if (score === 0) {
      return { score: 0, label: 'DR --', grade: 'Chờ tín hiệu', color: 'text-zinc-500', badgeClass: 'border-white/10 bg-white/5 text-zinc-500' };
    }
    if (score >= 14) {
      return { score, label: `DR${rounded}`, grade: 'Audiophile Ref', color: 'text-emerald-400', badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' };
    }
    if (score >= 10) {
      return { score, label: `DR${rounded}`, grade: 'Tự nhiên', color: 'text-violet-400', badgeClass: 'border-violet-500/30 bg-violet-500/10 text-violet-300' };
    }
    if (score >= 7) {
      return { score, label: `DR${rounded}`, grade: 'Tiêu chuẩn', color: 'text-amber-400', badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
    }
    return { score, label: `DR${rounded}`, grade: 'Nén mạnh', color: 'text-rose-400', badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-300' };
  }

  // Pha B — Audio Buffer Lookahead & Gapless Transitions Monitor
  function calculateBufferLookahead(currentTime, bufferedRanges) {
    const cur = Number(currentTime);
    if (!Number.isFinite(cur) || cur < 0 || !bufferedRanges) return 0;
    const length = bufferedRanges.length !== undefined ? bufferedRanges.length : 0;
    if (length === 0) return 0;
    for (let i = 0; i < length; i++) {
      const start = typeof bufferedRanges.start === 'function' ? bufferedRanges.start(i) : (bufferedRanges[i] ? bufferedRanges[i][0] : 0);
      const end = typeof bufferedRanges.end === 'function' ? bufferedRanges.end(i) : (bufferedRanges[i] ? bufferedRanges[i][1] : 0);
      if (cur >= start - 0.25 && cur <= end + 0.1) {
        return Math.max(0, Math.round((end - cur) * 10) / 10);
      }
    }
    return 0;
  }

  function formatBufferLookahead(lookaheadSec, isGaplessReady) {
    const sec = Math.max(0, Number(lookaheadSec) || 0);
    if (sec <= 0) return 'Đang nạp luồng...';
    if (sec >= 10 || isGaplessReady) return `Đệm ${sec.toFixed(1)}s (Sẵn sàng Gapless)`;
    if (sec >= 3) return `Đang phát (${sec.toFixed(1)}s đệm)`;
    return `Đang nạp (${sec.toFixed(1)}s)`;
  }

  function calculateGaplessReadiness(currentAudio, standbyAudio, nextTrack, options = {}) {
    if (!nextTrack) {
      return {
        isReady: false,
        status: 'idle',
        bufferLeadSeconds: 0,
        qualityPercent: 0,
        label: 'Không có bài chờ'
      };
    }

    if (!standbyAudio) {
      return {
        isReady: false,
        status: 'standby_missing',
        bufferLeadSeconds: 0,
        qualityPercent: 0,
        label: 'Chưa khởi tạo deck chờ'
      };
    }

    let bufferLead = 0;
    try {
      if (standbyAudio.buffered && standbyAudio.buffered.length > 0) {
        const end = standbyAudio.buffered.end(standbyAudio.buffered.length - 1);
        const start = standbyAudio.buffered.start(0);
        bufferLead = Math.max(0, end - start);
      }
    } catch (e) {
      bufferLead = 0;
    }

    const readyState = Number(standbyAudio.readyState) || 0;
    const hasCachedBlob = !!(nextTrack.file || nextTrack.blob || nextTrack.firstSliceCached);

    const isReady = readyState >= 3 || bufferLead >= 3 || (hasCachedBlob && readyState >= 2);
    let qualityPercent = 0;
    if (isReady) {
      qualityPercent = Math.min(100, Math.round(70 + Math.min(30, bufferLead * 5)));
    } else if (readyState >= 2 || bufferLead > 0) {
      qualityPercent = Math.min(65, Math.round(30 + bufferLead * 10));
    } else {
      qualityPercent = hasCachedBlob ? 50 : 15;
    }

    let status = 'buffering';
    let label = 'Đang nạp đệm bài kế...';
    if (isReady) {
      status = 'ready';
      label = `Sẵn sàng phát liền mạch (Đệm trước: ${Math.round(bufferLead * 10) / 10}s)`;
    } else if (readyState === 0 && !hasCachedBlob) {
      status = 'idle';
      label = 'Chờ nạp trước';
    }

    return {
      isReady,
      status,
      bufferLeadSeconds: Math.round(bufferLead * 100) / 100,
      qualityPercent,
      label
    };
  }

  // ── Vũ Trường Ánh Sáng Thời Gian Thực (Audio-Reactive Ambient Stage) ──

  function calculateAudioEnergyBands(frequencyData, sampleRate = 44100, fftSize = 256) {
    if (!frequencyData || typeof frequencyData.length !== 'number' || frequencyData.length === 0) {
      return {
        bass: 0,
        vocal: 0,
        treble: 0,
        overall: 0,
        isBeatPulse: false
      };
    }

    const totalBins = frequencyData.length;
    const sRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const fSize = Number.isFinite(fftSize) && fftSize > 0 ? fftSize : totalBins * 2;
    const binHz = sRate / fSize;

    let bassSum = 0, bassCount = 0;
    let vocalSum = 0, vocalCount = 0;
    let trebleSum = 0, trebleCount = 0;
    let totalSum = 0;

    for (let i = 0; i < totalBins; i++) {
      const val = Number(frequencyData[i]) || 0;
      const normalized = Math.min(1, Math.max(0, val / 255));
      totalSum += normalized;

      const freq = i * binHz;
      if (freq >= 20 && freq <= 260) {
        bassSum += normalized;
        bassCount++;
      } else if (freq > 260 && freq <= 4000) {
        vocalSum += normalized;
        vocalCount++;
      } else if (freq > 4000) {
        trebleSum += normalized;
        trebleCount++;
      }
    }

    if (bassCount === 0 && totalBins > 0) {
      bassSum = (Number(frequencyData[0]) || 0) / 255;
      bassCount = 1;
    }

    const bass = bassCount > 0 ? Math.round((bassSum / bassCount) * 1000) / 1000 : 0;
    const vocal = vocalCount > 0 ? Math.round((vocalSum / vocalCount) * 1000) / 1000 : 0;
    const treble = trebleCount > 0 ? Math.round((trebleSum / trebleCount) * 1000) / 1000 : 0;
    const overall = totalBins > 0 ? Math.round((totalSum / totalBins) * 1000) / 1000 : 0;

    const isBeatPulse = bass >= 0.55 && bass > overall * 1.25;

    return {
      bass,
      vocal,
      treble,
      overall,
      isBeatPulse
    };
  }

  const AMBIENT_STAGE_MODES = {
    'reactive': {
      id: 'reactive',
      name: 'Vũ trường Ánh sáng (Audio-Reactive)',
      description: 'Hào quang phập phồng và chuyển động 60fps đồng bộ theo nhịp đập Bass và năng lượng Vocal.'
    },
    'subtle': {
      id: 'subtle',
      name: 'Phòng nghe Tinh tế (Audiophile Lounge)',
      description: 'Chuyển động êm dịu, dải sáng mềm mại, mang lại cảm giác thư thái không phân tâm.'
    },
    'static': {
      id: 'static',
      name: 'Tĩnh từ Bìa Album (Album Art Glow)',
      description: 'Cố định màu nền gradient trích xuất từ ảnh bìa mà không rung động theo âm thanh.'
    },
    'off': {
      id: 'off',
      name: 'Tắt hiệu ứng',
      description: 'Tắt hoàn toàn hào quang nền, tối giản giao diện theo phong cách Black Dark Mode.'
    }
  };

  function calculateAmbientPulseTransform(energy, mode = 'reactive', options = {}) {
    const selectedMode = AMBIENT_STAGE_MODES[mode] ? mode : 'reactive';
    const e = energy || { bass: 0, vocal: 0, treble: 0, overall: 0, isBeatPulse: false };
    const bass = Number.isFinite(e.bass) ? e.bass : 0;
    const vocal = Number.isFinite(e.vocal) ? e.vocal : 0;
    const overall = Number.isFinite(e.overall) ? e.overall : 0;

    if (selectedMode === 'off') {
      return {
        scale: 1,
        opacity: 0,
        blur: 0,
        brightness: 1,
        transform: 'scale(1)',
        filter: 'blur(0px) brightness(1)'
      };
    }

    if (selectedMode === 'static') {
      return {
        scale: 1,
        opacity: 0.35,
        blur: 24,
        brightness: 1,
        transform: 'scale(1)',
        filter: 'blur(24px) brightness(1)'
      };
    }

    if (selectedMode === 'subtle') {
      const scale = Math.round((1 + bass * 0.02) * 1000) / 1000;
      const opacity = Math.round((0.25 + overall * 0.2) * 1000) / 1000;
      const blur = Math.round(20 + vocal * 10);
      const brightness = Math.round((1 + vocal * 0.1) * 1000) / 1000;
      return {
        scale,
        opacity,
        blur,
        brightness,
        transform: `scale(${scale})`,
        filter: `blur(${blur}px) brightness(${brightness})`
      };
    }

    // Default: 'reactive'
    const beatMultiplier = e.isBeatPulse ? 1.2 : 1.0;
    const scale = Math.round((1 + bass * 0.05 * beatMultiplier) * 1000) / 1000;
    const opacity = Math.round((0.3 + overall * 0.45 * beatMultiplier) * 1000) / 1000;
    const blur = Math.round(18 + vocal * 16);
    const brightness = Math.round((1 + vocal * 0.25) * 1000) / 1000;

    return {
      scale,
      opacity: Math.min(0.9, opacity),
      blur,
      brightness,
      transform: `scale(${scale})`,
      filter: `blur(${blur}px) brightness(${brightness})`
    };
  }

  function formatAmbientStageSummary(mode = 'reactive', isPlaying = true) {
    const profile = AMBIENT_STAGE_MODES[mode] || AMBIENT_STAGE_MODES['reactive'];
    if (mode === 'off') return 'Ánh sáng nền: Tắt';
    if (!isPlaying) return `${profile.name} (Tạm dừng)`;
    return `${profile.name} · Đang phát`;
  }

  // ── Universal Audiophile Audio Seeker & Media Session CUE Sync ──

  function calculateTrackPlaybackPosition(elementCurrentTime, track, elementDuration) {
    const rawTime = Number(elementCurrentTime) || 0;
    const rawDur = Number(elementDuration) || 0;
    if (!track) {
      const fraction = rawDur > 0 ? Math.min(1, Math.max(0, rawTime / rawDur)) : 0;
      return {
        trackCurrentTime: Math.max(0, rawTime),
        trackDuration: Math.max(0, rawDur),
        progressFraction: Math.round(fraction * 1000) / 1000,
        isCue: false,
        cueStart: 0,
        cueEnd: null
      };
    }

    const isCue = track.cueStart !== undefined && track.cueStart !== null;
    const cueStart = isCue ? Math.max(0, Number(track.cueStart) || 0) : 0;
    const cueEnd = (isCue && track.cueEnd != null) ? Number(track.cueEnd) : null;
    const trackDur = isCue
      ? (Number(track.duration) > 0 ? Number(track.duration) : (cueEnd ? Math.max(0, cueEnd - cueStart) : Math.max(0, rawDur - cueStart)))
      : (Number(track.duration) > 0 ? Number(track.duration) : rawDur);

    const trackCurrentTime = isCue
      ? Math.max(0, Math.min(trackDur, rawTime - cueStart))
      : Math.max(0, Math.min(trackDur || rawDur, rawTime));

    const progressFraction = trackDur > 0 ? Math.min(1, Math.max(0, trackCurrentTime / trackDur)) : 0;

    return {
      trackCurrentTime: Math.round(trackCurrentTime * 100) / 100,
      trackDuration: Math.round(trackDur * 100) / 100,
      progressFraction: Math.round(progressFraction * 1000) / 1000,
      isCue,
      cueStart,
      cueEnd
    };
  }

  function calculateSeekTargetTime(targetSecondsOrFraction, track, elementDuration, options = {}) {
    const isFraction = Boolean(options.isFraction);
    const delta = Number(options.delta) || 0;
    const currentRaw = Number(options.currentRawTime) || 0;
    const rawDur = Number(elementDuration) || 0;

    const isCue = Boolean(track && track.cueStart !== undefined && track.cueStart !== null);
    const cueStart = isCue ? Math.max(0, Number(track.cueStart) || 0) : 0;
    const trackDur = isCue
      ? (Number(track.duration) > 0 ? Number(track.duration) : Math.max(0, rawDur - cueStart))
      : (Number(track?.duration) > 0 ? Number(track.duration) : rawDur);
    const cueEnd = isCue ? (track.cueEnd != null ? Number(track.cueEnd) : cueStart + trackDur) : rawDur;

    let targetWithinTrack = 0;
    if (delta !== 0) {
      const currentTrackTime = isCue ? Math.max(0, currentRaw - cueStart) : currentRaw;
      targetWithinTrack = Math.min(trackDur, Math.max(0, currentTrackTime + delta));
    } else if (isFraction) {
      const fraction = Math.min(1, Math.max(0, Number(targetSecondsOrFraction) || 0));
      targetWithinTrack = fraction * trackDur;
    } else {
      targetWithinTrack = Math.min(trackDur, Math.max(0, Number(targetSecondsOrFraction) || 0));
    }

    const absoluteTarget = isCue
      ? Math.min(Math.max(cueStart, cueStart + targetWithinTrack), Math.max(cueStart, cueEnd - 0.15))
      : Math.min(Math.max(0, targetWithinTrack), rawDur > 0 ? Math.max(0, rawDur - 0.15) : targetWithinTrack);

    return {
      targetAbsoluteTime: Math.round(absoluteTarget * 100) / 100,
      targetTrackTime: Math.round(targetWithinTrack * 100) / 100,
      isCue
    };
  }

  function resolveMediaSessionPositionState(element, track) {
    if (!element) return null;
    const rawTime = Number(element.currentTime) || 0;
    const rawDur = Number(element.duration) || 0;
    const pos = calculateTrackPlaybackPosition(rawTime, track, rawDur);
    if (!Number.isFinite(pos.trackDuration) || pos.trackDuration <= 0) return null;

    return {
      duration: pos.trackDuration,
      playbackRate: Number(element.playbackRate) || 1,
      position: Math.min(pos.trackCurrentTime, pos.trackDuration)
    };
  }

  // ── Mood & Genre Smart Filter Engine ──

  const GENRE_MOOD_DEFINITIONS = {
    genres: {
      'acoustic': { id: 'acoustic', name: 'Acoustic & Folk', keywords: ['acoustic', 'folk', 'guitar', 'unplugged', 'piano', 'mộc'] },
      'ballad': { id: 'ballad', name: 'Ballad & Trữ tình', keywords: ['ballad', 'trữ tình', 'nhạc nhẹ', 'slow', 'tình ca'] },
      'pop': { id: 'pop', name: 'Pop & Modern', keywords: ['pop', 'indie pop', 'synthpop', 'dance pop'] },
      'rock': { id: 'rock', name: 'Rock & Alternative', keywords: ['rock', 'metal', 'alternative', 'punk', 'indie rock'] },
      'electronic': { id: 'electronic', name: 'EDM & Electronic', keywords: ['edm', 'electronic', 'house', 'techno', 'synthwave', 'dance', 'remix'] },
      'classical': { id: 'classical', name: 'Classical & Symphony', keywords: ['classical', 'symphony', 'orchestra', 'cổ điển', 'instrumental', 'không lời'] },
      'jazz': { id: 'jazz', name: 'Jazz & Blues', keywords: ['jazz', 'blues', 'soul', 'r&b', 'bossa nova'] },
      'vocal': { id: 'vocal', name: 'Audiophile Vocal', keywords: ['vocal', 'audiophile', 'hi-end', 'giọng ca', 'singer'] }
    },
    moods: {
      'relax': { id: 'relax', name: 'Thư giãn & Êm dịu', description: 'Giai điệu nhẹ nhàng, sâu lắng để xả stress' },
      'energy': { id: 'energy', name: 'Tràn đầy Năng lượng', description: 'Tiết tấu sôi động, bùng nổ nhịp điệu' },
      'focus': { id: 'focus', name: 'Tập trung Làm việc', description: 'Không gian tĩnh lặng, tăng sự chú ý' },
      'midnight': { id: 'midnight', name: 'Đêm muộn & Trầm tư', description: 'Không gian đêm yên ắng, chất giọng ấm áp' }
    }
  };

  function detectTrackMoodAndGenre(track) {
    if (!track) return { genres: ['Pop & Modern'], moods: ['relax'] };
    const textToMatch = `${track.genre || ''} ${track.title || ''} ${track.album || ''} ${track.artist || ''}`.toLowerCase();
    
    const matchedGenres = [];
    for (const [id, def] of Object.entries(GENRE_MOOD_DEFINITIONS.genres)) {
      if (def.keywords.some(kw => textToMatch.includes(kw))) {
        matchedGenres.push(def.name);
      }
    }
    if (matchedGenres.length === 0) {
      if (track.isDsd || (track.sampleRate && track.sampleRate > 48000)) {
        matchedGenres.push('Audiophile Vocal');
      } else {
        matchedGenres.push('Pop & Modern');
      }
    }

    const matchedMoods = [];
    const dur = Number(track.duration) || 0;
    if (dur >= 240 || matchedGenres.some(g => g.includes('Classical') || g.includes('Jazz') || g.includes('Acoustic'))) {
      matchedMoods.push('relax');
    }
    if (matchedGenres.some(g => g.includes('Electronic') || g.includes('Rock') || g.includes('Pop'))) {
      matchedMoods.push('energy');
    }
    if (matchedMoods.length === 0) {
      matchedMoods.push('relax');
    }

    return {
      genres: matchedGenres,
      moods: matchedMoods
    };
  }

  function groupTracksByGenreMood(tracks) {
    if (!Array.isArray(tracks)) return [];
    const groupMap = new Map();

    for (const def of Object.values(GENRE_MOOD_DEFINITIONS.genres)) {
      groupMap.set(def.name, {
        key: `genre:${def.id}`,
        name: def.name,
        type: 'genre',
        tracks: [],
        cover: ''
      });
    }

    for (const [id, def] of Object.entries(GENRE_MOOD_DEFINITIONS.moods)) {
      groupMap.set(def.name, {
        key: `mood:${id}`,
        name: def.name,
        type: 'mood',
        tracks: [],
        cover: ''
      });
    }

    for (const track of tracks) {
      if (!track) continue;
      const detected = detectTrackMoodAndGenre(track);
      for (const gName of detected.genres) {
        const group = groupMap.get(gName);
        if (group) {
          group.tracks.push(track);
          if (!group.cover && track.cover) group.cover = track.cover;
        }
      }
      for (const mId of detected.moods) {
        const moodDef = GENRE_MOOD_DEFINITIONS.moods[mId];
        if (moodDef) {
          const group = groupMap.get(moodDef.name);
          if (group) {
            group.tracks.push(track);
            if (!group.cover && track.cover) group.cover = track.cover;
          }
        }
      }
    }

    return [...groupMap.values()].filter(g => g.tracks.length > 0);
  }

  // ── Subsonic / OpenSubsonic REST API & Self-Hosted Helpers ──

  function buildSubsonicUrl(endpoint, action, params = {}, authConfig = {}) {
    if (!endpoint) return '';
    let base = String(endpoint).trim();
    if (!/^https?:\/\//i.test(base)) {
      base = 'http://' + base;
    }
    base = base.replace(/\/+$/, '');

    let act = String(action || '').trim().replace(/^\/+/, '');
    let fullPath = '';
    if (base.endsWith('/rest')) {
      fullPath = base + '/' + (act.startsWith('rest/') ? act.slice(5) : act);
    } else if (act.startsWith('rest/')) {
      fullPath = base + '/' + act;
    } else {
      fullPath = base + '/rest/' + act;
    }

    const url = new URL(fullPath);
    url.pathname = url.pathname.replace(/\/+/g, '/');

    const auth = authConfig || {};
    const u = auth.u != null ? auth.u : (auth.user != null ? auth.user : auth.username);
    const p = auth.p != null ? auth.p : (auth.pass != null ? auth.pass : auth.password);
    const t = auth.t != null ? auth.t : auth.token;
    const s = auth.s != null ? auth.s : auth.salt;
    const v = auth.v || auth.version || '1.16.1';
    const c = auth.c || auth.client || 'nocturne';
    const f = auth.f || auth.format || 'json';

    if (u != null && u !== '') url.searchParams.set('u', String(u));
    if (t != null && t !== '') {
      url.searchParams.set('t', String(t));
      if (s != null && s !== '') url.searchParams.set('s', String(s));
    } else if (p != null && p !== '') {
      url.searchParams.set('p', String(p));
    }
    url.searchParams.set('v', String(v));
    url.searchParams.set('c', String(c));
    url.searchParams.set('f', String(f));

    if (params && typeof params === 'object') {
      for (const [key, val] of Object.entries(params)) {
        if (val != null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    return url.toString();
  }

  function parseSubsonicSong(entry, serverUrl, authConfig = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const songId = entry.id != null ? String(entry.id) : '';
    const coverId = entry.coverArt != null ? String(entry.coverArt) : songId;

    const src = serverUrl && songId ? buildSubsonicUrl(serverUrl, 'stream.view', { id: songId }, authConfig) : '';
    const cover = serverUrl && coverId ? buildSubsonicUrl(serverUrl, 'getCoverArt.view', { id: coverId }, authConfig) : '';

    return {
      id: 'subsonic-' + songId,
      title: entry.title != null ? String(entry.title) : 'Unknown Title',
      artist: entry.artist != null ? String(entry.artist) : UNKNOWN_ARTIST,
      album: entry.album != null ? String(entry.album) : UNKNOWN_ALBUM,
      duration: Number(entry.duration) || 0,
      format: entry.suffix ? String(entry.suffix).toUpperCase() : 'FLAC',
      bitDepth: Number(entry.bitDepth) || 16,
      sampleRate: Number(entry.samplingRate || entry.sampleRate) || 44100,
      src,
      cover,
      year: entry.year != null ? Number(entry.year) : undefined,
      genre: entry.genre != null ? String(entry.genre) : '',
      source: 'Subsonic',
      trackNumber: entry.track != null ? Number(entry.track) : undefined,
      discNumber: entry.discNumber != null ? Number(entry.discNumber) : undefined,
      raw: entry
    };
  }

  function extractDecade(year) {
    if (year === null || year === undefined || year === '') return null;
    let y = NaN;
    if (typeof year === 'number') {
      y = year;
    } else if (typeof year === 'string') {
      const match = year.match(/\b(\d{4})\b/);
      if (match) {
        y = parseInt(match[1], 10);
      } else {
        y = parseInt(year.trim(), 10);
      }
    }
    if (!Number.isFinite(y) || y <= 0 || y < 1000 || y > 9999) {
      return null;
    }
    const decade = Math.floor(y / 10) * 10;
    return `${decade}s`;
  }

  function filterTracksByDecade(tracks, decade) {
    if (!Array.isArray(tracks)) return [];
    if (!decade || typeof decade !== 'string' || decade.trim() === '' || decade.trim().toLowerCase() === 'all') {
      return tracks.slice();
    }
    const target = decade.trim().toLowerCase();
    return tracks.filter(t => {
      if (!t || typeof t !== 'object') return false;
      if (t.decade && String(t.decade).trim().toLowerCase() === target) {
        return true;
      }
      const trackYear = t.year != null ? t.year : t.date;
      if (trackYear != null) {
        const dec = extractDecade(trackYear);
        if (dec && dec.toLowerCase() === target) {
          return true;
        }
      }
      return false;
    });
  }

  function isScrobbleEligible(playedSeconds, totalDuration) {
    const played = Number(playedSeconds);
    const total = Number(totalDuration);
    if (!Number.isFinite(played) || !Number.isFinite(total)) return false;
    if (total < 30) return false;
    if (played <= 0) return false;
    const threshold = Math.min(240, total * 0.5);
    return played >= threshold;
  }

  function buildListenBrainzPayload(track, listenType = 'single_listen', listenedAt) {
    const t = track || {};
    const type = listenType === 'playing_now' ? 'playing_now' : 'single_listen';

    const trackMetadata = {
      artist_name: t.artist != null ? String(t.artist) : UNKNOWN_ARTIST,
      track_name: t.title != null ? String(t.title) : 'Unknown Title',
      release_name: t.album != null ? String(t.album) : UNKNOWN_ALBUM,
      additional_info: {
        submission_client: 'Nocturne',
        submission_client_version: '1.0.0',
        media_player: 'Nocturne'
      }
    };

    if (Number.isFinite(Number(t.duration)) && Number(t.duration) > 0) {
      trackMetadata.additional_info.duration_ms = Math.round(Number(t.duration) * 1000);
    }
    if (t.trackNumber != null || t.track != null) {
      trackMetadata.additional_info.tracknumber = Number(t.trackNumber || t.track);
    }
    if (t.source) {
      trackMetadata.additional_info.music_service = String(t.source);
    }

    const listenItem = {
      track_metadata: trackMetadata
    };

    if (type !== 'playing_now') {
      let timestamp = listenedAt;
      if (timestamp instanceof Date) {
        timestamp = Math.floor(timestamp.getTime() / 1000);
      } else if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        timestamp = timestamp > 1e11 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
      } else {
        timestamp = Math.floor(Date.now() / 1000);
      }
      listenItem.listened_at = timestamp;
    }

    return {
      listen_type: type,
      payload: [listenItem]
    };
  }

  // ── Jellyfin REST API & Self-Hosted Helpers (Finamp, Feishin, Tauon, Symfonium) ──

  function buildJellyfinUrl(endpoint, path = '', params = {}, apiKey = '') {
    if (!endpoint) return '';
    let base = String(endpoint).trim();
    if (!base) return '';
    if (!/^https?:\/\//i.test(base)) {
      base = 'http://' + base;
    }
    base = base.replace(/\/+$/, '');

    let cleanPath = String(path || '').trim();
    if (cleanPath && !cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
    }

    try {
      const url = new URL(base + cleanPath);
      url.pathname = url.pathname.replace(/\/+/g, '/');

      if (params && typeof params === 'object') {
        for (const [key, val] of Object.entries(params)) {
          if (val !== undefined && val !== null) {
            url.searchParams.set(key, String(val));
          }
        }
      }

      const effectiveApiKey = (apiKey != null && apiKey !== '')
        ? String(apiKey)
        : (params && (params.api_key || params.apiKey || params.token || ''));
      if (effectiveApiKey) {
        url.searchParams.set('api_key', String(effectiveApiKey));
      }

      return url.toString();
    } catch {
      return '';
    }
  }

  function parseJellyfinItem(item, endpoint, apiKey) {
    if (!item || typeof item !== 'object') return null;

    const itemId = item.Id != null ? item.Id : (item.id != null ? item.id : '');
    const albumId = item.AlbumId != null ? item.AlbumId : (item.albumId != null ? item.albumId : itemId);

    const artistsList = Array.isArray(item.Artists) ? item.Artists : (Array.isArray(item.artists) ? item.artists : null);
    const artistsStr = artistsList && artistsList.length > 0 ? artistsList.join(', ') : null;
    const albumArtistFallback = item.AlbumArtist || item.albumArtist || (artistsList && artistsList[0]) || 'Unknown Artist';
    const artist = artistsStr || albumArtistFallback;
    const albumArtist = item.AlbumArtist || item.albumArtist || (artistsList && artistsList[0]) || 'Unknown Artist';

    const album = item.Album != null ? String(item.Album) : (item.album != null ? String(item.album) : '');
    const ticks = item.RunTimeTicks != null ? item.RunTimeTicks : item.runTimeTicks;
    const duration = ticks ? Math.round(Number(ticks) / 10000000) : 0;
    const container = item.Container || item.container || 'FLAC';

    const streams = item.MediaStreams || item.mediaStreams;
    const stream = Array.isArray(streams) ? streams[0] : null;
    const bitDepth = Number(stream?.BitDepth ?? stream?.bitDepth) || 16;
    const sampleRate = Number(stream?.SampleRate ?? stream?.sampleRate) || 44100;

    const src = endpoint && itemId ? buildJellyfinUrl(endpoint, '/Audio/' + itemId + '/stream', { static: true }, apiKey) : '';
    const cover = endpoint && (albumId || itemId) ? buildJellyfinUrl(endpoint, '/Items/' + (albumId || itemId) + '/Images/Primary', { maxWidth: 500, quality: 90 }, apiKey) : '';

    const year = item.ProductionYear != null ? Number(item.ProductionYear) : (item.productionYear != null ? Number(item.productionYear) : undefined);
    const genres = item.Genres || item.genres;
    const genre = (Array.isArray(genres) && genres[0]) ? String(genres[0]) : '';

    return {
      id: 'jellyfin-' + itemId,
      title: item.Name != null ? String(item.Name) : (item.name != null ? String(item.name) : 'Unknown Title'),
      artist,
      albumArtist,
      album,
      duration,
      format: String(container).toUpperCase(),
      bitDepth,
      sampleRate,
      src,
      cover,
      year,
      genre,
      source: 'Jellyfin',
      trackNumber: item.IndexNumber != null ? Number(item.IndexNumber) : (item.indexNumber != null ? Number(item.indexNumber) : undefined),
      discNumber: item.ParentIndexNumber != null ? Number(item.ParentIndexNumber) : (item.parentIndexNumber != null ? Number(item.parentIndexNumber) : undefined),
      raw: item
    };
  }

  function groupTracksByAlbumArtist(tracks) {
    if (!Array.isArray(tracks)) return [];
    const map = new Map();
    for (const track of tracks) {
      if (!track || typeof track !== 'object') continue;
      const albumArtist = (track.albumArtist && String(track.albumArtist).trim())
        || (track.artist && String(track.artist).trim())
        || 'Unknown Artist';
      if (!map.has(albumArtist)) {
        map.set(albumArtist, []);
      }
      map.get(albumArtist).push(track);
    }

    const list = [];
    for (const [artist, groupTracks] of map.entries()) {
      const group = {
        albumArtist: artist,
        artist: artist,
        label: artist,
        tracks: groupTracks
      };
      list.push(group);
      Object.defineProperty(list, artist, {
        value: groupTracks,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }

    Object.defineProperty(list, 'get', {
      value: function (artist) {
        return list[artist];
      },
      enumerable: false,
      writable: true,
      configurable: true
    });

    Object.defineProperty(list, 'has', {
      value: function (artist) {
        return Boolean(list[artist]);
      },
      enumerable: false,
      writable: true,
      configurable: true
    });

    return list;
  }

  function calculatePlaybackRate(rate) {
    if (rate === null || rate === undefined || rate === '') {
      return 1.0;
    }
    let r = Number(rate);
    if (!Number.isFinite(r)) {
      return 1.0;
    }
    if (r < 0.5) r = 0.5;
    if (r > 2.0) r = 2.0;
    return Math.round(r * 100) / 100;
  }

  // ── Black Candy Self-Hosted Music Server & Smart Queue Helpers ──

  function buildBlackCandyAuthHeader(token) {
    const cleanToken = token != null ? String(token).trim() : '';
    return {
      'Authorization': `Token token=${cleanToken}`,
      'Accept': 'application/json'
    };
  }

  function buildBlackCandyUrl(endpoint, path = '', params = {}) {
    if (!endpoint) return '';
    let base = String(endpoint).trim();
    if (!base) return '';
    if (!/^https?:\/\//i.test(base)) {
      base = 'http://' + base;
    }
    base = base.replace(/\/+$/, '');

    let cleanPath = String(path || '').trim();
    if (cleanPath && !cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
    }

    try {
      const url = new URL(base + cleanPath);
      url.pathname = url.pathname.replace(/\/+/g, '/');

      if (params && typeof params === 'object') {
        for (const [key, val] of Object.entries(params)) {
          if (val !== undefined && val !== null) {
            url.searchParams.set(key, String(val));
          }
        }
      }

      return url.toString();
    } catch {
      return '';
    }
  }

  function parseBlackCandySong(rawSong, endpoint, options = { transcode: false }) {
    if (!rawSong || typeof rawSong !== 'object') return null;

    const isTranscode = Boolean(options && options.transcode);
    const streamPath = isTranscode ? '/transcoded_stream/new' : '/stream/new';
    const songId = rawSong.id != null ? rawSong.id : '';

    const src = (endpoint && songId !== '')
      ? buildBlackCandyUrl(endpoint, streamPath, { song_id: songId })
      : '';

    const format = String(
      options && options.transcode ? (rawSong.format || 'mp3') : (rawSong.format || 'FLAC')
    ).toUpperCase();

    const cover = rawSong.album_image_urls?.large || rawSong.album_image_urls?.medium || rawSong.album_image_urls?.small;

    return {
      id: `blackcandy-${songId}`,
      title: rawSong.name != null ? String(rawSong.name) : 'Unknown Title',
      artist: rawSong.artist_name || 'Unknown Artist',
      album: rawSong.album_name || 'Unknown Album',
      duration: Number(rawSong.duration) || 0,
      format,
      src,
      cover,
      isFavorited: Boolean(rawSong.is_favorited),
      lyricsUrl: rawSong.lyrics_url,
      source: 'Black Candy',
      raw: rawSong
    };
  }

  function parseLrcWithOffsetAndTags(lrcText) {
    if (typeof lrcText !== 'string') return [];

    const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    const offsetMs = offsetMatch ? Number(offsetMatch[1]) : 0;
    const offsetSec = offsetMs / 1000;

    const entries = [];
    const lines = lrcText.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/g;
      const timeMatches = [...line.matchAll(timestampRegex)];
      if (!timeMatches.length) {
        continue;
      }

      const cleanLyric = line
        .replace(/\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/g, '')
        .replace(/\[[a-zA-Z_]+:[^\]]*\]/g, '')
        .replace(/<\d{1,3}:\d{2}(?:[.:]\d+)?>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (!cleanLyric) continue;

      let firstTimeMs = null;
      for (const match of timeMatches) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        if (seconds >= 60) continue;
        const fractionSec = match[3] ? Number('0.' + match[3]) : 0;
        const rawSec = minutes * 60 + seconds + fractionSec + offsetSec;
        const totalSec = Math.max(0, Math.round(rawSec * 1000) / 1000);
        const timeMs = Math.max(0, totalSec * 1000);
        if (firstTimeMs === null) firstTimeMs = timeMs;

        const entry = { time: totalSec, text: cleanLyric };
        const words = parseKaraokeWords(line, timeMs, offsetMs, (timeMs - firstTimeMs) / 1000, false);
        Object.defineProperty(entry, 'words', {
          value: words,
          enumerable: false,
          writable: true,
          configurable: true
        });
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => a.time - b.time);
  }

  function smartQueuePlayNext(queue, currentIndex, song) {
    if (!song) return Array.isArray(queue) ? queue.slice() : [];
    const list = Array.isArray(queue) ? (Object.isFrozen(queue) ? queue.slice() : queue) : [];

    const songId = (song && typeof song === 'object' && song.id != null) ? song.id : song;
    const existingIndex = list.findIndex(item => {
      if (item === song) return true;
      if (item && typeof item === 'object' && item.id != null) {
        return item.id === songId;
      }
      return item === song;
    });

    let targetIndex = Math.max(0, (Number.isInteger(currentIndex) ? currentIndex : 0) + 1);

    if (existingIndex !== -1) {
      const [removed] = list.splice(existingIndex, 1);
      if (existingIndex < targetIndex) {
        targetIndex = Math.max(0, targetIndex - 1);
      }
      if (targetIndex > list.length) targetIndex = list.length;
      list.splice(targetIndex, 0, removed);
    } else {
      if (targetIndex > list.length) targetIndex = list.length;
      list.splice(targetIndex, 0, song);
    }

    return list;
  }

  function smartQueueAppend(queue, song) {
    if (!song) return Array.isArray(queue) ? queue.slice() : [];
    const list = Array.isArray(queue) ? (Object.isFrozen(queue) ? queue.slice() : queue) : [];

    const songId = (song && typeof song === 'object' && song.id != null) ? song.id : song;
    const exists = list.some(item => {
      if (item === song) return true;
      if (item && typeof item === 'object' && item.id != null) {
        return item.id === songId;
      }
      return item === song;
    });

    if (!exists) {
      list.push(song);
    }

    return list;
  }

  function smartQueueReorder(queue, fromIndex, toIndex) {
    if (!Array.isArray(queue)) return [];
    const list = Object.isFrozen(queue) ? queue.slice() : queue;
    if (list.length <= 1) return list;

    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
    if (from < 0 || from >= list.length) return list;

    const clampedTo = Math.max(0, Math.min(list.length - 1, to));
    if (from === clampedTo) return list;

    const [item] = list.splice(from, 1);
    list.splice(clampedTo, 0, item);
    return list;
  }

  function reorderQueueByIds(queueTrackIds, draggedId, targetId, dropPosition = 'before') {
    if (!Array.isArray(queueTrackIds)) return [];
    const list = queueTrackIds.map(String);
    const fromIdx = list.indexOf(String(draggedId));
    const toIdx = list.indexOf(String(targetId));
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list;

    const [item] = list.splice(fromIdx, 1);
    let newTargetIdx = list.indexOf(String(targetId));
    if (dropPosition === 'after') {
      newTargetIdx += 1;
    }
    list.splice(newTargetIdx, 0, item);
    return list;
  }

  // ── Pha D — PWA Architecture: Persistent Playback Session & Position Restoration ──
  function savePlaybackSession(trackId, currentTime, queueTrackIds = [], extra = {}) {
    if (!trackId && trackId !== 0) return null;
    const session = {
      trackId: String(trackId),
      currentTime: Math.max(0, Math.round((Number(currentTime) || 0) * 100) / 100),
      queueTrackIds: Array.isArray(queueTrackIds) ? queueTrackIds.map(String) : [],
      updatedAt: Number(extra.updatedAt) || Date.now(),
      wasPlaying: Boolean(extra.wasPlaying)
    };
    if (extra.volume !== undefined && Number.isFinite(Number(extra.volume))) {
      session.volume = Math.max(0, Math.min(1, Number(extra.volume)));
    }
    return JSON.stringify(session);
  }

  function restorePlaybackSession(rawSession, tracks = []) {
    if (!rawSession) return { isValid: false, track: null, trackId: null, currentTime: 0, queueTrackIds: [] };
    let data = rawSession;
    if (typeof rawSession === 'string') {
      try {
        data = JSON.parse(rawSession);
      } catch (_) {
        return { isValid: false, track: null, trackId: null, currentTime: 0, queueTrackIds: [] };
      }
    }
    if (!data || typeof data !== 'object') {
      return { isValid: false, track: null, trackId: null, currentTime: 0, queueTrackIds: [] };
    }
    const trackId = data.trackId != null ? String(data.trackId) : null;
    if (!trackId) {
      return { isValid: false, track: null, trackId: null, currentTime: 0, queueTrackIds: [] };
    }

    const trackList = Array.isArray(tracks) ? tracks : [];
    const foundTrack = trackList.find(t => t && String(t.id) === trackId);
    if (!foundTrack) {
      return { isValid: false, track: null, trackId, currentTime: 0, queueTrackIds: [] };
    }

    let pos = Math.max(0, Number(data.currentTime) || 0);
    if (foundTrack.duration && Number.isFinite(foundTrack.duration) && foundTrack.duration > 2) {
      if (pos >= foundTrack.duration - 2) {
        pos = 0;
      } else {
        pos = Math.min(pos, foundTrack.duration);
      }
    }

    const validQueueIds = Array.isArray(data.queueTrackIds)
      ? data.queueTrackIds.map(String).filter(id => trackList.some(t => t && String(t.id) === id))
      : [];

    return {
      isValid: true,
      track: foundTrack,
      trackId,
      currentTime: pos,
      queueTrackIds: validQueueIds,
      updatedAt: Number(data.updatedAt) || 0,
      wasPlaying: Boolean(data.wasPlaying),
      volume: data.volume !== undefined ? Number(data.volume) : undefined
    };
  }

  function formatResumePrompt(track, positionSeconds) {
    if (!track || typeof track !== 'object') return '';
    const title = track.title || 'bài hát';
    const totalSecs = Math.max(0, Math.floor(Number(positionSeconds) || 0));
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    const sStr = s < 10 ? '0' + s : String(s);
    const timeStr = `${m}:${sStr}`;
    if (totalSecs > 0) {
      return `Tiếp tục nghe "${title}" tại ${timeStr}?`;
    }
    return `Tiếp tục phát "${title}"?`;
  }

  // ── Pha A — DSP Audio Engine: Peak Limiter & Anti-Clipping Profiles ──
  const LIMITER_PROFILES = {
    transparent: {
      id: 'transparent',
      name: 'Brickwall (Trong suốt)',
      threshold: -0.5,
      knee: 0,
      ratio: 20,
      attack: 0.001,
      release: 0.05,
      badge: 'BRICKWALL',
      description: 'Bảo vệ dải động -0.5 dBFS, phản hồi tức thì 1ms chống clipping tuyệt đối'
    },
    soft: {
      id: 'soft',
      name: 'Soft-Knee (Ấm áp)',
      threshold: -3.0,
      knee: 6,
      ratio: 12,
      attack: 0.003,
      release: 0.1,
      badge: 'SOFT-KNEE',
      description: 'Nén dốc thoai thoải -3 dBFS, chất âm mượt mà tương tự ampli đèn'
    },
    off: {
      id: 'off',
      name: 'Bỏ qua (Bypass)',
      threshold: 0,
      knee: 0,
      ratio: 1,
      attack: 0.01,
      release: 0.1,
      badge: 'BYPASS',
      description: 'Tuyến tính 100%, không can thiệp dải động (dành cho Zone Bit-Perfect)'
    }
  };

  function getLimiterProfile(mode) {
    if (!mode || typeof mode !== 'string') return LIMITER_PROFILES.transparent;
    return LIMITER_PROFILES[mode.toLowerCase()] || LIMITER_PROFILES.transparent;
  }

  function applyLimiterParams(node, mode, currentTime = 0) {
    if (!node || typeof node !== 'object') return false;
    const profile = getLimiterProfile(mode);
    const time = Math.max(0, Number(currentTime) || 0);

    const setParam = (param, val) => {
      if (!param) return;
      if (typeof param.setTargetAtTime === 'function') {
        try {
          param.setTargetAtTime(val, time, 0.015);
          return;
        } catch (_) {}
      }
      param.value = val;
    };

    setParam(node.threshold, profile.threshold);
    setParam(node.knee, profile.knee);
    setParam(node.ratio, profile.ratio);
    setParam(node.attack, profile.attack);
    setParam(node.release, profile.release);
    return true;
  }

  function formatLimiterSummary(mode) {
    const profile = getLimiterProfile(mode);
    if (profile.id === 'off') return 'Bỏ qua (Bypass)';
    return `${profile.name} (${profile.threshold} dBFS)`;
  }

  // ── Pha B — UI/UX: Audiophile FFT Spectrum Visualizer & Peak Hold Decay ──
  const VISUALIZER_THEMES = {
    cyber: {
      id: 'cyber',
      name: 'Neon Cyber',
      stops: [
        { offset: 0, color: '#38bdf8' },
        { offset: 0.5, color: '#818cf8' },
        { offset: 1, color: '#c084fc' }
      ],
      peakColor: '#f43f5e'
    },
    sunset: {
      id: 'sunset',
      name: 'Sunset Glow',
      stops: [
        { offset: 0, color: '#fbbf24' },
        { offset: 0.5, color: '#fb7185' },
        { offset: 1, color: '#e11d48' }
      ],
      peakColor: '#fde047'
    },
    aurora: {
      id: 'aurora',
      name: 'Aurora Borealis',
      stops: [
        { offset: 0, color: '#34d399' },
        { offset: 0.5, color: '#22d3ee' },
        { offset: 1, color: '#818cf8' }
      ],
      peakColor: '#a7f3d0'
    },
    monochrome: {
      id: 'monochrome',
      name: 'Classic Audiophile',
      stops: [
        { offset: 0, color: '#7c3aed' },
        { offset: 0.5, color: '#a78bfa' },
        { offset: 1, color: '#c4b5fd' }
      ],
      peakColor: '#ddd6fe'
    }
  };

  function getVisualizerTheme(themeId) {
    if (!themeId || typeof themeId !== 'string') return VISUALIZER_THEMES.cyber;
    return VISUALIZER_THEMES[themeId.toLowerCase()] || VISUALIZER_THEMES.cyber;
  }

  function cycleVisualizerTheme(currentId) {
    const keys = Object.keys(VISUALIZER_THEMES);
    const curIndex = keys.indexOf(String(currentId || '').toLowerCase());
    const nextIndex = (curIndex + 1) % keys.length;
    return keys[nextIndex];
  }

  function updateVisualizerPeaks(currentValues, previousPeaks, options = {}) {
    if (!Array.isArray(currentValues)) return [];
    const decayRate = Number(options.decayRate) || 0.025;
    const holdFrames = Number(options.holdFrames) || 6;
    const result = new Array(currentValues.length);

    for (let i = 0; i < currentValues.length; i++) {
      const val = Math.max(0, Math.min(1, Number(currentValues[i]) || 0));
      const prev = (Array.isArray(previousPeaks) && previousPeaks[i] && typeof previousPeaks[i] === 'object')
        ? previousPeaks[i]
        : { val: 0, hold: 0 };

      let peakVal = prev.val;
      let hold = prev.hold;

      if (val >= peakVal) {
        peakVal = val;
        hold = holdFrames;
      } else if (hold > 0) {
        hold--;
      } else {
        peakVal = Math.max(0, peakVal - decayRate);
      }

      result[i] = { val: peakVal, hold };
    }
    return result;
  }

  function renderVisualizerSpectrum(context, options = {}) {
    if (!context || !options) return false;
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const bars = Math.max(4, Number(options.bars) || 32);
    const gap = Math.max(0, Number(options.gap) || 2);
    const data = options.data;
    const peaks = options.peaks || [];
    const theme = getVisualizerTheme(options.theme);
    const isMirror = options.mode === 'mirror';

    const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);

    let grad;
    try {
      grad = context.createLinearGradient(0, isMirror ? 0 : height, 0, isMirror ? height : 0);
      for (const stop of theme.stops) {
        grad.addColorStop(stop.offset, stop.color);
      }
    } catch (_) {
      grad = '#a78bfa';
    }

    context.fillStyle = grad;

    for (let i = 0; i < bars; i++) {
      let normVal = 0;
      if (data && data.length > 0) {
        const dataIndex = Math.min(data.length - 1, Math.floor(i * data.length / bars));
        normVal = Math.max(0, Math.min(1, (data[dataIndex] || 0) / 255));
      }

      const barHeight = Math.max(2, normVal * (isMirror ? height * 0.9 : height));
      const x = i * (barWidth + gap);
      const y = isMirror ? (height - barHeight) / 2 : (height - barHeight);

      if (typeof context.roundRect === 'function' && typeof context.fill === 'function') {
        if (typeof context.beginPath === 'function') context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, 1.5);
        context.fill();
      } else if (typeof context.fillRect === 'function') {
        context.fillRect(x, y, barWidth, barHeight);
      }

      if (peaks && peaks[i] && Number.isFinite(peaks[i].val) && peaks[i].val > 0.05) {
        const peakHeight = peaks[i].val * (isMirror ? height * 0.9 : height);
        const peakY = isMirror ? (height - peakHeight) / 2 : (height - peakHeight);
        context.fillStyle = theme.peakColor;
        context.fillRect(x, Math.max(0, peakY - 1.5), barWidth, 1.5);
        context.fillStyle = grad;
      }
    }
    return true;
  }

  function highlightSearchMatch(text, query, options = {}) {
    const str = String(text || '');
    if (!str) return '';
    const q = String(query || '').trim();
    const escape = options.escape !== false;
    const escapeFn = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    if (!q) return escape ? escapeFn(str) : str;

    const markClass = options.className || 'bg-violet-500/25 text-violet-200 font-medium rounded px-0.5';
    const tag = options.tag || 'mark';

    const chars = [...str];
    const unaccented = chars.map(ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/đ/gi, 'd').toLowerCase()).join('');
    const queryUnaccented = q.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/đ/gi, 'd').toLowerCase();

    const tokens = [queryUnaccented];
    const words = queryUnaccented.split(/\s+/).filter(w => w.length >= 2);
    for (const w of words) {
      if (!tokens.includes(w)) tokens.push(w);
    }

    const intervals = [];
    for (const token of tokens) {
      let pos = 0;
      while (pos < unaccented.length) {
        const idx = unaccented.indexOf(token, pos);
        if (idx === -1) break;
        intervals.push([idx, idx + token.length]);
        pos = idx + Math.max(1, token.length);
      }
    }

    if (intervals.length === 0) {
      return escape ? escapeFn(str) : str;
    }

    intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = intervals[i];
      if (curr[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }

    let result = '';
    let lastIndex = 0;
    for (const [start, end] of merged) {
      if (start > lastIndex) {
        const plain = str.slice(lastIndex, start);
        result += escape ? escapeFn(plain) : plain;
      }
      const matched = str.slice(start, end);
      const escapedMatched = escape ? escapeFn(matched) : matched;
      result += `<${tag} class="${markClass}">${escapedMatched}</${tag}>`;
      lastIndex = end;
    }
    if (lastIndex < str.length) {
      const remaining = str.slice(lastIndex);
      result += escape ? escapeFn(remaining) : remaining;
    }
    return result;
  }

  const SEARCH_HISTORY_KEY = 'nocturne-search-history';
  function getSearchHistory(storage = null, key = SEARCH_HISTORY_KEY) {
    try {
      const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return [];
      const raw = s.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim().length > 0) : [];
    } catch (_) {
      return [];
    }
  }

  function addSearchHistory(query, storage = null, key = SEARCH_HISTORY_KEY, max = 8) {
    const q = String(query || '').trim();
    if (!q || q.length < 2) return getSearchHistory(storage, key);
    try {
      const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return [q];
      const history = getSearchHistory(s, key);
      const filtered = history.filter(item => item.toLowerCase() !== q.toLowerCase());
      const next = [q, ...filtered].slice(0, Math.max(1, max));
      s.setItem(key, JSON.stringify(next));
      return next;
    } catch (_) {
      return [q];
    }
  }

  function clearSearchHistory(storage = null, key = SEARCH_HISTORY_KEY) {
    try {
      const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (s) s.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatStorageBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function getStorageEstimate(storageManager) {
    const sm = storageManager || (typeof navigator !== 'undefined' && navigator && navigator.storage ? navigator.storage : null);
    if (!sm || typeof sm.estimate !== 'function') {
      return {
        usage: 0,
        quota: 0,
        percent: 0,
        formattedUsage: '0 B',
        formattedQuota: 'Không xác định',
        isLowSpace: false,
        supported: false
      };
    }
    try {
      const estimate = await sm.estimate();
      const usage = Number(estimate.usage) || 0;
      const quota = Number(estimate.quota) || 0;
      const percent = quota > 0 ? Math.round((usage / quota) * 1000) / 10 : 0;
      return {
        usage,
        quota,
        percent,
        formattedUsage: formatStorageBytes(usage),
        formattedQuota: formatStorageBytes(quota),
        isLowSpace: quota > 0 && (quota - usage < 100 * 1024 * 1024 || percent >= 90),
        supported: true
      };
    } catch (_) {
      return {
        usage: 0,
        quota: 0,
        percent: 0,
        formattedUsage: '0 B',
        formattedQuota: 'Không xác định',
        isLowSpace: false,
        supported: false
      };
    }
  }

  function auditOfflineStorage(tracks) {
    if (!Array.isArray(tracks)) {
      return { totalTracks: 0, offlineTracks: 0, offlinePercent: 0, localCount: 0, cachedCloudCount: 0, sliceCount: 0 };
    }
    let offlineCount = 0;
    let localCount = 0;
    let cachedCloudCount = 0;
    let sliceCount = 0;

    for (const track of tracks) {
      if (!track) continue;
      if (canPlayOffline(track)) {
        offlineCount++;
        if (track.source === 'local' || !track.source) {
          localCount++;
        } else if (track.file || track.blob) {
          cachedCloudCount++;
        } else if (track.firstSliceCached || track.hasCachedSlice) {
          sliceCount++;
        } else {
          localCount++;
        }
      }
    }
    const percent = tracks.length > 0 ? Math.round((offlineCount / tracks.length) * 1000) / 10 : 0;
    return {
      totalTracks: tracks.length,
      offlineTracks: offlineCount,
      offlinePercent: percent,
      localCount,
      cachedCloudCount,
      sliceCount
    };
  }

  // ── Pha D — PWA Architecture: Intelligent Offline Autoplay & Resilient Playback Protection ──
  function getOfflineTrackList(tracks) {
    if (!Array.isArray(tracks)) return [];
    return tracks.filter(t => canPlayOffline(t));
  }

  function shouldPreloadTrack(track, options = {}) {
    if (!track) return false;
    const isOffline = !!options.isOffline;
    if (isOffline && !canPlayOffline(track)) return false;
    return true;
  }

  function getNextPlayableTrack(tracks, currentIndex, direction = 1, options = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return { track: null, index: -1, wasFiltered: false };
    }

    const isOffline = !!options.isOffline;
    const shuffle = !!options.shuffle;
    const repeat = Number.isInteger(options.repeat) ? options.repeat : 0;
    const dir = direction >= 0 ? 1 : -1;

    // Case 1: Repeat One
    if (repeat === 2 && currentIndex >= 0 && currentIndex < tracks.length) {
      const cur = tracks[currentIndex];
      if (!isOffline || canPlayOffline(cur)) {
        return { track: cur, index: currentIndex, wasFiltered: false };
      }
    }

    // Case 2: Offline Mode Filtering
    if (isOffline) {
      const offlineIndices = [];
      for (let i = 0; i < tracks.length; i++) {
        if (canPlayOffline(tracks[i])) {
          offlineIndices.push(i);
        }
      }

      if (offlineIndices.length === 0) {
        return { track: null, index: -1, wasFiltered: true };
      }

      // Offline Shuffle
      if (shuffle) {
        const available = offlineIndices.filter(idx => idx !== currentIndex);
        if (available.length === 0) {
          return { track: tracks[offlineIndices[0]], index: offlineIndices[0], wasFiltered: true };
        }
        const pickedIdx = available[Math.floor(Math.random() * available.length)];
        return { track: tracks[pickedIdx], index: pickedIdx, wasFiltered: true };
      }

      // Offline Sequential
      let currentOfflinePos = offlineIndices.indexOf(currentIndex);
      if (currentOfflinePos === -1) {
        if (dir > 0) {
          const nextIdx = offlineIndices.find(idx => idx > currentIndex);
          const chosen = nextIdx !== undefined ? nextIdx : (repeat === 1 ? offlineIndices[0] : -1);
          return chosen >= 0
            ? { track: tracks[chosen], index: chosen, wasFiltered: true }
            : { track: null, index: -1, wasFiltered: true };
        } else {
          const prevIndices = offlineIndices.filter(idx => idx < currentIndex);
          const chosen = prevIndices.length > 0 ? prevIndices[prevIndices.length - 1] : (repeat === 1 ? offlineIndices[offlineIndices.length - 1] : -1);
          return chosen >= 0
            ? { track: tracks[chosen], index: chosen, wasFiltered: true }
            : { track: null, index: -1, wasFiltered: true };
        }
      }

      let nextOfflinePos = currentOfflinePos + dir;
      if (nextOfflinePos >= offlineIndices.length) {
        if (repeat === 1) nextOfflinePos = 0;
        else return { track: null, index: -1, wasFiltered: true };
      } else if (nextOfflinePos < 0) {
        if (repeat === 1) nextOfflinePos = offlineIndices.length - 1;
        else return { track: null, index: -1, wasFiltered: true };
      }

      const targetIdx = offlineIndices[nextOfflinePos];
      return { track: tracks[targetIdx], index: targetIdx, wasFiltered: true };
    }

    // Case 3: Online Normal Mode
    if (shuffle) {
      const available = tracks.map((_, i) => i).filter(i => i !== currentIndex);
      if (available.length === 0) {
        return { track: tracks[currentIndex] || null, index: currentIndex, wasFiltered: false };
      }
      const pickedIdx = available[Math.floor(Math.random() * available.length)];
      return { track: tracks[pickedIdx], index: pickedIdx, wasFiltered: false };
    }

    let nextIdx = currentIndex + dir;
    if (nextIdx >= tracks.length) {
      if (repeat === 1) nextIdx = 0;
      else return { track: null, index: -1, wasFiltered: false };
    } else if (nextIdx < 0) {
      if (repeat === 1) nextIdx = tracks.length - 1;
      else return { track: null, index: -1, wasFiltered: false };
    }

    return { track: tracks[nextIdx], index: nextIdx, wasFiltered: false };
  }

  // ── Pha D — Memory Leak Prevention & Multi-Tier Storage Quota Manager ──

  const STORAGE_TIERS = {
    TIER_1_CRITICAL: {
      id: 'tier1_critical',
      name: 'Thiết yếu & Trạng thái (Critical State)',
      description: 'Lịch sử phát, hàng đợi, yêu thích, cấu hình EQ/DSP',
      evictionPolicy: 'never'
    },
    TIER_2_MEDIA_CACHE: {
      id: 'tier2_media',
      name: 'Đệm Âm Thanh Lát Đầu (Audio Slices)',
      description: 'Lát FLAC/DSD 1MB trong IndexedDB để phát tức thì',
      evictionPolicy: 'lru'
    },
    TIER_3_ENRICHMENT: {
      id: 'tier3_enrichment',
      name: 'Siêu Dữ Liệu & Bìa (Metadata & Lyrics)',
      description: 'Lời bài hát LRCLIB, ảnh bìa album base64',
      evictionPolicy: 'volatile'
    }
  };

  function categorizeStorageItem(key, metadata = {}) {
    const k = String(key || '').toLowerCase();
    const store = String(metadata.store || '').toLowerCase();

    if (store === 'history' || k.startsWith('session:') || k.includes('history') || k.includes('settings') || k.includes('favorite')) {
      return 'tier1_critical';
    }
    if (store === 'slices' || k.startsWith('slice:') || k.includes('first_slice') || k.includes('dsd_slice') || metadata.isSlice) {
      return 'tier2_media';
    }
    if (store === 'cloud-catalog' || k.startsWith('cover:') || k.startsWith('lyrics:') || k.includes('lrc') || metadata.isCover || metadata.isLyrics) {
      return 'tier3_enrichment';
    }
    return 'tier3_enrichment';
  }

  function calculateStorageTierMetrics(items = []) {
    const safeItems = Array.isArray(items) ? items : [];
    const tierSummaries = {
      tier1_critical: { id: 'tier1_critical', name: STORAGE_TIERS.TIER_1_CRITICAL.name, count: 0, bytes: 0 },
      tier2_media: { id: 'tier2_media', name: STORAGE_TIERS.TIER_2_MEDIA_CACHE.name, count: 0, bytes: 0 },
      tier3_enrichment: { id: 'tier3_enrichment', name: STORAGE_TIERS.TIER_3_ENRICHMENT.name, count: 0, bytes: 0 }
    };

    let totalBytes = 0;
    let totalCount = 0;

    for (const item of safeItems) {
      if (!item) continue;
      const tier = item.tier || categorizeStorageItem(item.key, item);
      const target = tierSummaries[tier] || tierSummaries.tier3_enrichment;
      const size = Math.max(0, Number(item.size) || (typeof item.data === 'string' ? item.data.length : 0));
      target.count += 1;
      target.bytes += size;
      totalBytes += size;
      totalCount += 1;
    }

    for (const key of Object.keys(tierSummaries)) {
      tierSummaries[key].formattedBytes = formatStorageBytes(tierSummaries[key].bytes);
    }

    const healthScore = Math.max(20, Math.min(100, Math.round(100 - (totalBytes / (100 * 1024 * 1024)) * 50)));

    return {
      tiers: tierSummaries,
      totalBytes,
      totalCount,
      formattedTotalBytes: formatStorageBytes(totalBytes),
      healthScore
    };
  }

  function auditMemoryLeaks(trackedUrls, activeReferences = {}) {
    const urls = trackedUrls instanceof Set ? Array.from(trackedUrls) : (Array.isArray(trackedUrls) ? trackedUrls : []);
    const liveUrls = new Set();

    if (activeReferences.currentTrackUrl) liveUrls.add(activeReferences.currentTrackUrl);
    if (activeReferences.standbyTrackUrl) liveUrls.add(activeReferences.standbyTrackUrl);
    if (Array.isArray(activeReferences.queueUrls)) {
      for (const u of activeReferences.queueUrls) if (u) liveUrls.add(u);
    }
    if (Array.isArray(activeReferences.activeDeckUrls)) {
      for (const u of activeReferences.activeDeckUrls) if (u) liveUrls.add(u);
    }

    const leakedUrls = urls.filter(u => typeof u === 'string' && u.startsWith('blob:') && !liveUrls.has(u));

    return {
      totalTracked: urls.length,
      activeCount: urls.length - leakedUrls.length,
      leakedCount: leakedUrls.length,
      leakedUrls,
      hasLeaks: leakedUrls.length > 0
    };
  }

  function pruneUnreferencedObjectUrls(trackedUrlsSet, activeReferences = {}, revokeFn = (typeof URL !== 'undefined' && URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : null)) {
    if (!trackedUrlsSet) return { revokedCount: 0, remainingCount: 0, revokedUrls: [] };
    const audit = auditMemoryLeaks(trackedUrlsSet, activeReferences);
    const revokedUrls = [];

    for (const url of audit.leakedUrls) {
      try {
        if (typeof revokeFn === 'function') revokeFn(url);
      } catch (_) {}
      if (trackedUrlsSet instanceof Set) trackedUrlsSet.delete(url);
      revokedUrls.push(url);
    }

    return {
      revokedCount: revokedUrls.length,
      remainingCount: trackedUrlsSet instanceof Set ? trackedUrlsSet.size : 0,
      revokedUrls
    };
  }

  function formatMemoryAuditSummary(auditOrPruneResult) {
    if (!auditOrPruneResult) return 'Bộ nhớ tối ưu';
    if (auditOrPruneResult.revokedCount !== undefined) {
      if (auditOrPruneResult.revokedCount === 0) return 'Bộ nhớ RAM sạch sẽ, không có ObjectURL rác.';
      return `Đã giải phóng ${auditOrPruneResult.revokedCount} Blob URL rác, còn lại ${auditOrPruneResult.remainingCount} URL đang dùng.`;
    }
    if (auditOrPruneResult.leakedCount === 0) return 'Tất cả Blob URL đều đang được tham chiếu.';
    return `Phát hiện ${auditOrPruneResult.leakedCount} Blob URL không dùng có thể giải phóng.`;
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, normalizeSearchKey: metadataKey, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, fetchAudioFirstSlice, FIRST_SLICE_BYTES, flacFirstFrameOffset, FIRST_SLICE_FRAME_ALLOWANCE_BYTES, FIRST_SLICE_MAX_BYTES, fetchAudioRetryDelayMs, isFetchAudioRetryable, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks, compareTrackQuality, groupTrackVersions, parseLyrics, parseKaraokeWords, lyricWordAt, lyricLineAt, shouldScrollLyricIntoView, parseCloudConfig, PRELOAD_LEAD_SECONDS, shouldPreloadNext, clampSeekTime, CROSSFADE_MAX_SECONDS, crossfadeGains, calculateCrossfadeGains, CROSSFADE_CURVE_PROFILES, formatCrossfadeSummary, clampCrossfadeSeconds, MAX_CLOUD_CATALOG_ENTRIES, pruneCatalogEntries, MAX_CATALOG_COVER_TOTAL_CHARS, capCatalogCovers, prepareRestoredCatalog, FIRST_SLICE_CACHE_MAX_ENTRIES, FIRST_SLICE_CACHE_MAX_BYTES, DSD_FIRST_SLICE_CACHE_MAX_BYTES, sliceCacheMetaMatches, pruneSliceCacheEntries, peakRmsFromTimeDomain, queueDisplayOrder, clampBalance, formatBalance, CROSSFEED_CUTOFF_HZ, CROSSFEED_DELAY_S, CROSSFEED_MAX_GAIN, clampCrossfeed, crossfeedCrossGain, formatCrossfeed, computeSignalPath, selectRoonRadioTrack, extractDominantColors, parseReplayGain, computeReplayGainMultiplier, formatReplayGain, summarizeAlbum, formatAlbumDuration, DEFAULT_SLEEP_FADEOUT_MS, calculateSleepFadeGain, formatSleepRemaining, formatSleepCountdownCompact, calculateAlbumRemainingSeconds, extendSleepTimer, calculateAdaptiveSleepStage, isOnlineState, formatNetworkStatus, canPlayOffline, TONE_BASS_FREQ_HZ, TONE_TREBLE_FREQ_HZ, TONE_GAIN_MIN_DB, TONE_GAIN_MAX_DB, clampToneGain, formatToneGain, formatToneSummary, generateWaveformPeaks, renderWaveformCanvas, calculateHoverSeekFraction, calculateHoverSeekTime, formatHoverTime, formatWaveformStatus, generatePinkNoiseBuffer, generateBrownNoiseBuffer, generateCampfireCrackleBuffer, createAmbientChannel, clampAmbientVolume, formatAmbientVolume, formatAmbientSummary, createZoneModel, formatRoonThreeLine, parseRoonCoreEndpoint, createRoonMooMessage, parseRoonMooMessage, formatRoonZoneStatus, filterTracksByFocus, countFocusCategories, formatFocusBadge, computeRoonSignalLed, buildRoonSignalPathStages, AUTOEQ_PROFILES, getAutoEqProfile, listAutoEqProfiles, calculateAutoEqPreamp, formatAutoEqProfile, clampPhaseInvert, formatPhaseInvert, cleanSearchQuery, generateDeterministicWaveform, parseCueSheet, evaluateSmartPlaylist, clampRating, formatRating, calculateDynamicRange, formatDynamicRange, calculateBufferLookahead, formatBufferLookahead, calculateGaplessReadiness, buildSubsonicUrl, parseSubsonicSong, extractDecade, filterTracksByDecade, isScrobbleEligible, buildListenBrainzPayload, buildJellyfinUrl, parseJellyfinItem, groupTracksByAlbumArtist, calculatePlaybackRate, buildBlackCandyAuthHeader, buildBlackCandyUrl, parseBlackCandySong, parseLrcWithOffsetAndTags, smartQueuePlayNext, smartQueueAppend, smartQueueReorder, reorderQueueByIds, savePlaybackSession, restorePlaybackSession, formatResumePrompt, LIMITER_PROFILES, getLimiterProfile, applyLimiterParams, formatLimiterSummary, VISUALIZER_THEMES, getVisualizerTheme, cycleVisualizerTheme, updateVisualizerPeaks, renderVisualizerSpectrum, matchSearchQuery, scoreSearchMatch, highlightSearchMatch, SEARCH_HISTORY_KEY, getSearchHistory, addSearchHistory, clearSearchHistory, formatStorageBytes, getStorageEstimate, auditOfflineStorage, getOfflineTrackList, shouldPreloadTrack, getNextPlayableTrack, calculateAudioEnergyBands, AMBIENT_STAGE_MODES, calculateAmbientPulseTransform, formatAmbientStageSummary, calculateTrackPlaybackPosition, calculateSeekTargetTime, resolveMediaSessionPositionState, GENRE_MOOD_DEFINITIONS, detectTrackMoodAndGenre, groupTracksByGenreMood, STORAGE_TIERS, categorizeStorageItem, calculateStorageTierMetrics, auditMemoryLeaks, pruneUnreferencedObjectUrls, formatMemoryAuditSummary};
});
