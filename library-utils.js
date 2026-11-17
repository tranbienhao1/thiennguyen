'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root === 'object' && root !== null) {
    root.NocturneLibrary = api;
    if (!root.library) root.library = api;
    else if (typeof root.library === 'object') Object.assign(root.library, api);
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
    },
    'sub-bass-blend': {
      id: 'sub-bass-blend',
      name: 'Bảo toàn năng lượng dải trầm (Sub-Bass Energy Preservation)',
      description: 'Duy trì trọn vẹn xung lực Sub-bass khi chuyển giao bài hát, chuyển mượt dải trung cao mà không hụt âm trầm.',
      formula: 'cos(t·π/2.15) / sin(t·π/1.85)'
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

    if (type === 'sub-bass-blend') {
      if (t <= 0) return { out: 1, in: 0 };
      if (t >= 1) return { out: 0, in: 1 };
      const outGain = Math.pow(Math.cos(t * Math.PI / 2), 0.7);
      const inGain = Math.pow(Math.sin(t * Math.PI / 2), 0.7);
      return {
        out: Math.min(1, Math.max(0, outGain)),
        in: Math.min(1, Math.max(0, inGain))
      };
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

  function shouldAutoCrossfade(currentTime, duration, crossfadeSeconds, options = {}) {
    const seconds = clampCrossfadeSeconds(crossfadeSeconds, 0);
    if (seconds <= 0) return false;
    const cur = Number(currentTime);
    const dur = Number(duration);
    const lead = Number(options.leadMargin) || 0;
    if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= seconds) return false;
    if (options.isPaused || options.isSliceWaiting) return false;
    if (options.repeatMode === 2) return false;
    if (options.hasNextTrack === false) return false;
    return cur >= dur - (seconds + lead);
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

  // Pha A — DSP Crossfeed Matrix & Standards cho nghe tai nghe audiophile
  const CROSSFEED_PRESETS = Object.freeze({
    bauer: {
      id: 'bauer',
      name: 'Bauer Stereophonic (Roon Standard)',
      cutoffHz: 700,
      delaySeconds: 0.0003,
      crossGainMax: 0.35,
      directGainScale: 0.98,
      description: 'Mô hình Bauer chuẩn mực Roon, tự nhiên, tái tạo trường âm loa nổi trước mặt'
    },
    meier: {
      id: 'meier',
      name: 'Jan Meier Natural Crossfeed',
      cutoffHz: 650,
      delaySeconds: 0.00025,
      crossGainMax: 0.38,
      directGainScale: 1.0,
      description: 'Mạch Jan Meier tối ưu giọng ca trung tính, giảm thiểu hiện tượng mệt mỏi thính giác'
    },
    chu_moy: {
      id: 'chu_moy',
      name: 'Chu Moy Modified Linkwitz',
      cutoffHz: 750,
      delaySeconds: 0.00035,
      crossGainMax: 0.30,
      directGainScale: 0.96,
      description: 'Thiết kế Chu Moy mộc mạc, phù hợp cho tai nghe closed-back cách âm sâu'
    },
    binaural_studio: {
      id: 'binaural_studio',
      name: 'Binaural Studio Monitor (±30°)',
      cutoffHz: 850,
      delaySeconds: 0.00028,
      crossGainMax: 0.28,
      directGainScale: 0.99,
      description: 'Mô phỏng vị trí 2 loa kiểm âm studio đặt góc 30 độ chuẩn phòng thu'
    }
  });

  function getCrossfeedPreset(key) {
    if (!key || typeof key !== 'string') return CROSSFEED_PRESETS.bauer;
    return CROSSFEED_PRESETS[key] || CROSSFEED_PRESETS.bauer;
  }

  function listCrossfeedPresets() {
    return Object.values(CROSSFEED_PRESETS);
  }

  function calculateCrossfeedMatrixParams(presetKey, intensity = 0) {
    const preset = getCrossfeedPreset(presetKey);
    const clampedIntensity = clampCrossfeed(intensity, 0);

    const crossGain = clampedIntensity * preset.crossGainMax;
    const directGain = clampedIntensity > 0
      ? Math.sqrt(Math.max(0.5, 1 - Math.pow(crossGain, 2))) * preset.directGainScale
      : 1.0;

    return {
      presetId: preset.id,
      presetName: preset.name,
      cutoffHz: preset.cutoffHz,
      delaySeconds: preset.delaySeconds,
      crossGain: Number(crossGain.toFixed(4)),
      directGain: Number(directGain.toFixed(4)),
      intensity: clampedIntensity,
      isActive: clampedIntensity > 0
    };
  }

  function formatCrossfeedMatrixSummary(params) {
    if (!params || !params.isActive) return 'Crossfeed: Tắt';
    const ms = (params.delaySeconds * 1000).toFixed(2);
    const db = (20 * Math.log10(Math.max(0.0001, params.crossGain))).toFixed(1);
    return `⚡ ${params.presetName} (${params.cutoffHz}Hz · ${ms}ms · ${db}dB)`;
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
    if (options.roomAcousticProfile && options.roomAcousticProfile !== 'bypass') {
      const roomProfile = getRoomAcousticProfile(options.roomAcousticProfile);
      if (roomProfile && roomProfile.id !== 'bypass') {
        const wetPct = Math.round((Number.isFinite(options.roomAcousticWet) ? options.roomAcousticWet : 0.2) * 100);
        dspActive.push(`Không gian phòng: ${roomProfile.name} (${wetPct}% wet)`);
      }
    }
    if (options.subBassPunchProfile && options.subBassPunchProfile !== 'off') {
      const punchProfile = getSubBassPunchProfile(options.subBassPunchProfile);
      if (punchProfile && punchProfile.id !== 'off') {
        const intensity = Number.isFinite(options.subBassPunchIntensity) ? options.subBassPunchIntensity : 1.0;
        dspActive.push(`Sub-Bass Punch: ${punchProfile.name.split(' (')[0]} (x${intensity.toFixed(1)})`);
      }
    }
    if (options.tubeEmulationProfile && options.tubeEmulationProfile !== 'off') {
      const tubeP = getTubeEmulationProfile(options.tubeEmulationProfile);
      if (tubeP && tubeP.id !== 'off') {
        dspActive.push(`Tube Warmth: ${tubeP.badge} (${tubeP.name.split(' (')[0]})`);
      }
    }
    if (options.dsdUltrasonicFilter && options.dsdUltrasonicFilter !== 'bypass') {
      const dsdFilter = getDsdUltrasonicFilter(options.dsdUltrasonicFilter);
      if (dsdFilter && dsdFilter.id !== 'bypass') {
        dspActive.push(`Lọc DSD Siêu Âm: ${dsdFilter.badge} (${dsdFilter.name.split(' (')[0]})`);
      }
    }
    if (options.subBassPhaseProfile && options.subBassPhaseProfile !== 'bypass') {
      const phaseProfile = getSubBassPhaseProfile(options.subBassPhaseProfile);
      if (phaseProfile && phaseProfile.id !== 'bypass') {
        dspActive.push(`Bù Pha Trầm: ${phaseProfile.badge} (${phaseProfile.name.split(' (')[0]})`);
      }
    }

    let dspStep;
    if (dspActive.length > 0) {
      dspStep = {
        stage: 'dsp',
        title: 'Xử lý DSP (Digital Signal Processing)',
        description: dspActive.join(' · '),
        detail: 'Xử lý chuỗi BiquadFilter / Convolver / Panner / Crossfeed / ReplayGain qua Web Audio Graph',
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
    const curTrack = tracks.find(t => t && (t.id === currentTrackId || String(t.id) === String(currentTrackId)));
    if (!curTrack || !curTrack.album) return Math.max(0, Math.round((curTrack?.duration || 0) - (Number(currentTrackPlaybackSec) || 0)));
    const albumTracks = tracks.filter(t => t && t.album === curTrack.album);
    const curIndex = albumTracks.findIndex(t => t && (t.id === currentTrackId || String(t.id) === String(currentTrackId)));
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
          return Boolean(track.isFavorite || (favs && (favs.has(track.id) || favs.has(String(track.id)))));
        }
        if (crit === 'fav-masterpiece') {
          const isFav = Boolean(track.isFavorite || (favs && (favs.has(track.id) || favs.has(String(track.id)))));
          const ratings = options.ratings || {};
          const uRating = Number(ratings[track.id] || ratings[String(track.id)] || track.rating || 0);
          return uRating === 5 || (isFav && uRating >= 4);
        }
        if (crit === 'fav-hires') {
          const isFav = Boolean(track.isFavorite || (favs && (favs.has(track.id) || favs.has(String(track.id)))));
          const fmt = (track.format || track.title || '').toString().toUpperCase();
          const isHiresFmt = fmt.includes('FLAC') || fmt.includes('DSD') || fmt.includes('DSF') || fmt.includes('DFF') || fmt.includes('WAV') || fmt.includes('ALAC') || (track.sampleRate && track.sampleRate > 48000);
          return isFav && isHiresFmt;
        }
        if (crit === 'fav-gems') {
          const isFav = Boolean(track.isFavorite || (favs && (favs.has(track.id) || favs.has(String(track.id)))));
          const stats = (options.playStats && (options.playStats[track.id] || options.playStats[String(track.id)])) || {};
          const pCount = Number(stats.playCount ?? track.playCount ?? 0);
          return isFav && pCount >= 3;
        }
        if (crit === 'fav-rediscover') {
          const isFav = Boolean(track.isFavorite || (favs && (favs.has(track.id) || favs.has(String(track.id)))));
          const stats = (options.playStats && (options.playStats[track.id] || options.playStats[String(track.id)])) || {};
          const pCount = Number(stats.playCount ?? track.playCount ?? 0);
          return isFav && pCount <= 1;
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

  const PARAMETRIC_EQ_PRESETS = {
    'peq-sub-bass-slam': {
      id: 'peq-sub-bass-slam',
      name: 'Sub-Bass Slam & Depth',
      category: 'Parametric Preset',
      description: 'Gia cố dải siêu trầm 35Hz uy lực và cắt bỏ dải 250Hz chống đục âm',
      preamp: -4.0,
      bands: [
        { type: 'lowshelf', frequency: 35, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 80, gain: 2.5, q: 1.0 },
        { type: 'peaking', frequency: 250, gain: -1.5, q: 1.4 },
        { type: 'highshelf', frequency: 10000, gain: 0.5, q: 0.71 }
      ]
    },
    'peq-vocal-clarity': {
      id: 'peq-vocal-clarity',
      name: 'Vocal Clarity & Air',
      category: 'Parametric Preset',
      description: 'Đẩy giọng hát lên phía trước, dải cao 12kHz thoáng đãng và tự nhiên',
      preamp: -3.0,
      bands: [
        { type: 'lowshelf', frequency: 120, gain: -1.0, q: 0.71 },
        { type: 'peaking', frequency: 2800, gain: 2.5, q: 1.8 },
        { type: 'peaking', frequency: 5200, gain: 2.0, q: 2.0 },
        { type: 'highshelf', frequency: 12000, gain: 2.5, q: 0.71 }
      ]
    },
    'peq-acoustic-intimate': {
      id: 'peq-acoustic-intimate',
      name: 'Acoustic Guitar & Piano',
      category: 'Parametric Preset',
      description: 'Tôn vinh tiếng đàn mộc, độ ngân vang phím đàn và chi tiết dải cao mượt mà',
      preamp: -2.5,
      bands: [
        { type: 'lowshelf', frequency: 65, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 750, gain: -1.5, q: 1.5 },
        { type: 'peaking', frequency: 4200, gain: 2.2, q: 2.0 },
        { type: 'highshelf', frequency: 15000, gain: 2.5, q: 0.71 }
      ]
    },
    'peq-analog-tube': {
      id: 'peq-analog-tube',
      name: 'Vintage Tube Warmth',
      category: 'Parametric Preset',
      description: 'Mô phỏng chất âm ampli đèn analog ấm áp, mid mộc và treble dịu êm',
      preamp: -2.5,
      bands: [
        { type: 'lowshelf', frequency: 180, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 1200, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 3800, gain: -1.8, q: 2.0 },
        { type: 'highshelf', frequency: 8500, gain: -2.0, q: 0.71 }
      ]
    },
    'peq-de-esser': {
      id: 'peq-de-esser',
      name: 'Sibilance De-Esser',
      category: 'Parametric Preset',
      description: 'Triệt tiêu dải tần chói gắt 6-8.5kHz, giảm mỏi tai khi nghe lâu',
      preamp: 0.0,
      bands: [
        { type: 'peaking', frequency: 6200, gain: -4.0, q: 3.5 },
        { type: 'peaking', frequency: 8500, gain: -2.5, q: 3.0 }
      ]
    },
    'peq-orchestral': {
      id: 'peq-orchestral',
      name: 'Orchestral Grandeur',
      category: 'Parametric Preset',
      description: 'Mở rộng dải động cho dàn nhạc giao hưởng, phân tách bè trầm và bè bổng',
      preamp: -2.5,
      bands: [
        { type: 'lowshelf', frequency: 40, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 350, gain: -1.2, q: 1.5 },
        { type: 'peaking', frequency: 3000, gain: 1.5, q: 1.8 },
        { type: 'highshelf', frequency: 11000, gain: 2.0, q: 0.71 }
      ]
    }
  };

  Object.assign(AUTOEQ_PROFILES, PARAMETRIC_EQ_PRESETS);

  function getParametricEqPreset(id) {
    if (typeof id !== 'string') return null;
    const cleanId = id.startsWith('peq-') ? id : `peq-${id}`;
    const preset = PARAMETRIC_EQ_PRESETS[cleanId] || PARAMETRIC_EQ_PRESETS[id];
    if (!preset) return null;
    return {
      id: preset.id,
      name: preset.name,
      category: preset.category,
      description: preset.description,
      preamp: Number(preset.preamp) || 0,
      bands: preset.bands.map(b => ({
        type: b.type || 'peaking',
        frequency: Math.max(20, Math.min(20000, Number(b.frequency) || 1000)),
        gain: Math.max(-24, Math.min(24, Number(b.gain) || 0)),
        q: Math.max(0.1, Math.min(18, Number(b.q) || 1))
      }))
    };
  }

  function listParametricEqPresets() {
    return Object.keys(PARAMETRIC_EQ_PRESETS).map(key => ({
      id: PARAMETRIC_EQ_PRESETS[key].id,
      name: PARAMETRIC_EQ_PRESETS[key].name,
      category: PARAMETRIC_EQ_PRESETS[key].category,
      description: PARAMETRIC_EQ_PRESETS[key].description,
      preamp: PARAMETRIC_EQ_PRESETS[key].preamp,
      bandCount: PARAMETRIC_EQ_PRESETS[key].bands.length
    }));
  }

  function calculatePresetAutoPreamp(bands = []) {
    return calculateAutoEqPreamp(bands);
  }

  function formatParametricEqSummary(preset) {
    if (!preset || typeof preset !== 'object') return 'Không có cấu hình';
    const name = preset.name || preset.id || 'Preset';
    const bandCount = Array.isArray(preset.bands) ? preset.bands.length : 0;
    const preamp = Number(preset.preamp) || 0;
    return `${name} · ${bandCount} dải · Preamp ${preamp > 0 ? '+' : ''}${preamp.toFixed(1)} dB`;
  }

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
      url: src,
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
      url: src,
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
      url: src,
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
    },
    emerald: {
      id: 'emerald',
      name: 'McIntosh Vintage Green',
      stops: [
        { offset: 0, color: '#059669' },
        { offset: 0.5, color: '#10b981' },
        { offset: 1, color: '#34d399' }
      ],
      peakColor: '#6ee7b7'
    },
    amber: {
      id: 'amber',
      name: 'Vacuum Tube Warmth',
      stops: [
        { offset: 0, color: '#d97706' },
        { offset: 0.5, color: '#f59e0b' },
        { offset: 1, color: '#fbbf24' }
      ],
      peakColor: '#fef08a'
    },
    ocean: {
      id: 'ocean',
      name: 'Pacific Hi-Res Blue',
      stops: [
        { offset: 0, color: '#0284c7' },
        { offset: 0.5, color: '#0ea5e9' },
        { offset: 1, color: '#38bdf8' }
      ],
      peakColor: '#bae6fd'
    },
    crimson: {
      id: 'crimson',
      name: 'Crimson Velvet Night',
      stops: [
        { offset: 0, color: '#991b1b' },
        { offset: 0.5, color: '#ef4444' },
        { offset: 1, color: '#fb7185' }
      ],
      peakColor: '#fecdd3'
    },
    amethyst: {
      id: 'amethyst',
      name: 'Deep Amethyst Glow',
      stops: [
        { offset: 0, color: '#581c87' },
        { offset: 0.5, color: '#8b5cf6' },
        { offset: 1, color: '#c084fc' }
      ],
      peakColor: '#f5d0fe'
    },
    neon_hologram: {
      id: 'neon_hologram',
      name: 'Neon Hologram Cyber',
      stops: [
        { offset: 0, color: '#06b6d4' },
        { offset: 0.5, color: '#ec4899' },
        { offset: 1, color: '#a855f7' }
      ],
      peakColor: '#67e8f9'
    },
    golden_ember: {
      id: 'golden_ember',
      name: 'Golden Tube Ember',
      stops: [
        { offset: 0, color: '#b45309' },
        { offset: 0.5, color: '#f59e0b' },
        { offset: 1, color: '#fef08a' }
      ],
      peakColor: '#ffffff'
    },
    emerald_matrix: {
      id: 'emerald_matrix',
      name: 'Emerald Matrix Hi-Tech',
      stops: [
        { offset: 0, color: '#064e3b' },
        { offset: 0.5, color: '#10b981' },
        { offset: 1, color: '#6ee7b7' }
      ],
      peakColor: '#a7f3d0'
    },
    solar_flare: {
      id: 'solar_flare',
      name: 'Solar Flare Warmth',
      stops: [
        { offset: 0, color: '#7c2d12' },
        { offset: 0.5, color: '#ea580c' },
        { offset: 1, color: '#fbbf24' }
      ],
      peakColor: '#fef08a'
    },
    aurora_borealis: {
      id: 'aurora_borealis',
      name: 'Aurora Borealis Arctic Light',
      stops: [
        { offset: 0, color: '#064e3b' },
        { offset: 0.5, color: '#0284c7' },
        { offset: 1, color: '#a855f7' }
      ],
      peakColor: '#f0abfc'
    },
    monochrome_studio: {
      id: 'monochrome_studio',
      name: 'Monochrome Studio Reference',
      stops: [
        { offset: 0, color: '#18181b' },
        { offset: 0.5, color: '#71717a' },
        { offset: 1, color: '#e4e4e7' }
      ],
      peakColor: '#ffffff'
    }
  };

  function hexToRgba(hex, alpha = 1) {
    if (typeof hex !== 'string') return `rgba(255, 255, 255, ${alpha})`;
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length === 6) {
      const r = parseInt(clean.substring(0, 2), 16) || 0;
      const g = parseInt(clean.substring(2, 4), 16) || 0;
      const b = parseInt(clean.substring(4, 6), 16) || 0;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgba(255, 255, 255, ${alpha})`;
  }

  function calculateVisualizerStrobe(energyOrData, prevStrobe = {}, options = {}) {
    let bass = 0;
    let isBeat = false;

    if (energyOrData && typeof energyOrData.bass === 'number') {
      bass = energyOrData.bass;
      isBeat = Boolean(energyOrData.isBeatPulse);
    } else if (Array.isArray(energyOrData) || (energyOrData && typeof energyOrData.length === 'number')) {
      const total = energyOrData.length;
      if (total > 0) {
        let sum = 0;
        const count = Math.min(total, 16);
        for (let i = 0; i < count; i++) {
          sum += (Number(energyOrData[i]) || 0) / 255;
        }
        bass = count > 0 ? (sum / count) : 0;
        isBeat = bass > 0.65;
      }
    }

    const threshold = Number(options.threshold) || 0.62;
    const decayRate = Number(options.decayRate) || 0.88;
    const prevIntensity = Number(prevStrobe?.intensity) || 0;

    let intensity = prevIntensity * decayRate;
    let isTriggered = false;

    if (bass >= threshold || isBeat) {
      const boost = Math.min(1.0, 0.4 + (bass - threshold) * 1.5);
      intensity = Math.min(1.0, intensity + boost);
      isTriggered = true;
    }

    if (intensity < 0.02) intensity = 0;

    const pulseScale = 1.0 + Math.min(0.08, intensity * 0.08);
    const flashOpacity = Math.min(0.3, intensity * 0.25);
    const flashColor = options.color || 'rgba(255, 255, 255, 0.2)';

    return {
      isStrobeTriggered: isTriggered || intensity > 0.35,
      intensity: Number(intensity.toFixed(3)),
      pulseScale: Number(pulseScale.toFixed(3)),
      flashOpacity: Number(flashOpacity.toFixed(3)),
      flashColor,
      bassEnergy: Number(bass.toFixed(3))
    };
  }

  function renderVisualizerBackdropGlow(context, options = {}) {
    if (!context || !options) return false;
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const strobe = options.strobe;
    const intensity = Number(strobe?.intensity) || 0;
    if (intensity < 0.03) return false;

    const theme = getVisualizerTheme(options.theme);
    const color = (theme && theme.peakColor) || '#c084fc';

    try {
      if (typeof context.save === 'function') context.save();
      const centerX = width / 2;
      const centerY = height * 0.85;
      const radius = Math.max(width, height) * 0.75;

      const glowGrad = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      const alpha = Math.min(0.28, intensity * 0.25);
      glowGrad.addColorStop(0, hexToRgba(color, alpha));
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      context.fillStyle = glowGrad;
      context.fillRect(0, 0, width, height);
      if (typeof context.restore === 'function') context.restore();
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatVisualizerThemeSummary(themeId) {
    const theme = getVisualizerTheme(themeId);
    const stopsCount = Array.isArray(theme.stops) ? theme.stops.length : 0;
    return `${theme.name} · ${stopsCount} bậc màu · Đỉnh ${theme.peakColor}`;
  }

  function getVisualizerTheme(themeId) {
    if (!themeId || typeof themeId !== 'string') return VISUALIZER_THEMES.cyber;
    return VISUALIZER_THEMES[themeId.toLowerCase()] || VISUALIZER_THEMES.cyber;
  }

  function cycleVisualizerTheme(currentId, options = {}) {
    const keys = options.all
      ? Object.keys(VISUALIZER_THEMES)
      : ['cyber', 'sunset', 'aurora', 'monochrome'];
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

  function calculateLogarithmicFrequencyBins(data, barsCount = 32, options = {}) {
    if (!data || data.length === 0) return new Float32Array(barsCount);
    const count = Math.max(4, Math.min(128, Number(barsCount) || 32));
    const result = new Float32Array(count);
    const dataLen = data.length;
    const minFreqIdx = Math.max(1, Math.floor(Number(options?.minBin) || 1));
    const maxFreqIdx = Math.min(dataLen, Math.floor(Number(options?.maxBin) || dataLen));

    for (let i = 0; i < count; i++) {
      const logStart = minFreqIdx * Math.pow(maxFreqIdx / minFreqIdx, i / count);
      const logEnd = minFreqIdx * Math.pow(maxFreqIdx / minFreqIdx, (i + 1) / count);

      const startIdx = Math.min(dataLen - 1, Math.floor(logStart));
      const endIdx = Math.min(dataLen - 1, Math.max(startIdx, Math.floor(logEnd)));

      let sum = 0;
      let binCount = 0;
      for (let j = startIdx; j <= endIdx; j++) {
        sum += (data[j] || 0) / 255;
        binCount++;
      }
      const avg = binCount > 0 ? (sum / binCount) : 0;
      const tilt = 1.0 + (i / count) * 0.25;
      result[i] = Math.max(0, Math.min(1, avg * tilt));
    }
    return result;
  }

  function calculateBallisticSpectrumDynamics(prevBins, newBins, options = {}) {
    if (!newBins || newBins.length === 0) return prevBins || new Float32Array(0);
    const len = newBins.length;
    const smoothed = new Float32Array(len);
    const attack = Math.max(0.1, Math.min(0.99, Number(options?.attackRate) || 0.72));
    const decay = Math.max(0.1, Math.min(0.99, Number(options?.decayRate) || 0.86));

    for (let i = 0; i < len; i++) {
      const prev = (prevBins && prevBins[i]) ? prevBins[i] : 0;
      const target = newBins[i] || 0;
      if (target >= prev) {
        smoothed[i] = prev + attack * (target - prev);
      } else {
        smoothed[i] = prev * decay;
      }
      if (smoothed[i] < 0.005) smoothed[i] = 0;
    }
    return smoothed;
  }

  function calculateBeatStrobeChromaticAura(strobeData, options = {}) {
    if (!strobeData || typeof strobeData !== 'object') {
      return {
        concentricRipples: [],
        chromaticOffsetDeg: 0,
        rimGlowAlpha: 0,
        isAuraActive: false,
        dominantEnergy: 0
      };
    }

    const bass = Number(strobeData.bassIntensity) || 0;
    const vocal = Number(strobeData.vocalIntensity) || 0;
    const treble = Number(strobeData.trebleIntensity) || 0;
    const sensitivity = Math.max(0.5, Math.min(2.5, Number(options?.sensitivity) || 1.0));

    const effectiveBass = Math.min(1.0, bass * sensitivity);
    const isAuraActive = effectiveBass > 0.05 || vocal > 0.08 || !!strobeData.isStrobeTriggered;

    const concentricRipples = [];
    if (effectiveBass > 0.1) {
      concentricRipples.push({
        radiusMultiplier: 1.0 + effectiveBass * 0.15,
        alpha: Number(Math.min(0.4, effectiveBass * 0.35).toFixed(3)),
        colorHex: options?.primaryColor || '#c084fc'
      });
      if (effectiveBass > 0.35) {
        concentricRipples.push({
          radiusMultiplier: 1.25 + effectiveBass * 0.25,
          alpha: Number(Math.min(0.25, effectiveBass * 0.22).toFixed(3)),
          colorHex: '#38bdf8'
        });
      }
    }

    const timeSec = Number(options?.timeSeconds) || (Date.now() / 1000);
    const chromaticOffsetDeg = Math.round((timeSec * 45 + treble * 90) % 360);
    const rimGlowAlpha = Number(Math.min(0.5, (effectiveBass * 0.3 + vocal * 0.2)).toFixed(3));

    return {
      concentricRipples,
      chromaticOffsetDeg,
      rimGlowAlpha,
      isAuraActive,
      dominantEnergy: Math.max(effectiveBass, vocal, treble)
    };
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

    let computedBins = null;
    if (options.logarithmic && data && data.length > 0) {
      computedBins = calculateLogarithmicFrequencyBins(data, bars, options);
    }
    if (computedBins && options.ballistics && options.prevBins) {
      computedBins = calculateBallisticSpectrumDynamics(options.prevBins, computedBins, options);
    }

    for (let i = 0; i < bars; i++) {
      let normVal = 0;
      if (computedBins) {
        normVal = computedBins[i] || 0;
      } else if (data && data.length > 0) {
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
    return options.returnBins ? (computedBins || true) : true;
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

  // ── Pha A — Parametric EQ Filter Coherence & Nyquist-Safe Audio Engine ──

  const STANDARD_EQ_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
  ];

  function sanitizeBiquadFilterParams(band, sampleRate = 44100) {
    if (!band || typeof band !== 'object') {
      return { type: 'peaking', frequency: 1000, gain: 0, q: 1 };
    }
    const supportedTypes = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'];
    const type = supportedTypes.includes(band.type) ? band.type : 'peaking';

    const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const maxSafeFreq = Math.min(20000, Math.floor((sr / 2) - 50));
    const frequency = Math.max(20, Math.min(maxSafeFreq, Number(band.frequency) || 1000));
    const gain = Math.max(-24, Math.min(24, Number(band.gain) || 0));
    const q = Math.max(0.1, Math.min(18, Number(band.q) || 1));

    return { type, frequency, gain, q };
  }

  function calculateBiquadFrequencyResponse(band, frequencies = STANDARD_EQ_FREQUENCIES, sampleRate = 44100) {
    const sanitized = sanitizeBiquadFilterParams(band, sampleRate);
    const Fs = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const f0 = sanitized.frequency;
    const gain = sanitized.gain;
    const Q = sanitized.q;
    const type = sanitized.type;

    const A = Math.pow(10, gain / 40);
    const w0 = (2 * Math.PI * f0) / Fs;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw0 = Math.cos(w0);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (type) {
      case 'lowshelf': {
        const sqrtA2 = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cosw0 + sqrtA2);
        b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
        b2 = A * ((A + 1) - (A - 1) * cosw0 - sqrtA2);
        a0 = (A + 1) + (A - 1) * cosw0 + sqrtA2;
        a1 = -2 * ((A - 1) + (A + 1) * cosw0);
        a2 = (A + 1) + (A - 1) * cosw0 - sqrtA2;
        break;
      }
      case 'highshelf': {
        const sqrtA2 = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cosw0 + sqrtA2);
        b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
        b2 = A * ((A + 1) - (A - 1) * cosw0 - sqrtA2);
        a0 = (A + 1) - (A - 1) * cosw0 + sqrtA2;
        a1 = 2 * ((A - 1) - (A + 1) * cosw0);
        a2 = (A + 1) - (A - 1) * cosw0 - sqrtA2;
        break;
      }
      case 'lowpass': {
        b0 = (1 - cosw0) / 2;
        b1 = 1 - cosw0;
        b2 = (1 - cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      }
      case 'highpass': {
        b0 = (1 + cosw0) / 2;
        b1 = -(1 + cosw0);
        b2 = (1 + cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      }
      case 'peaking':
      default: {
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
        break;
      }
    }

    const b0_ = b0 / a0, b1_ = b1 / a0, b2_ = b2 / a0;
    const a1_ = a1 / a0, a2_ = a2 / a0;

    const freqs = Array.isArray(frequencies) && frequencies.length > 0 ? frequencies : STANDARD_EQ_FREQUENCIES;
    const response = [];

    for (const f of freqs) {
      const freqNum = Number(f) || 1000;
      const w = (2 * Math.PI * freqNum) / Fs;
      const c1 = Math.cos(w), s1 = Math.sin(w);
      const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);

      const nr = b0_ + b1_ * c1 + b2_ * c2;
      const ni = -b1_ * s1 - b2_ * s2;
      const dr = 1 + a1_ * c1 + a2_ * c2;
      const di = -a1_ * s1 - a2_ * s2;

      const numMag2 = nr * nr + ni * ni;
      const denMag2 = dr * dr + di * di;
      const mag2 = denMag2 > 0 ? numMag2 / denMag2 : 1;
      const gainDb = mag2 > 0 ? 10 * Math.log10(mag2) : -100;

      response.push({
        frequency: freqNum,
        gainDb: Math.round(gainDb * 100) / 100
      });
    }

    return response;
  }

  function calculateCombinedEqCurve(bands = [], frequencies = STANDARD_EQ_FREQUENCIES, sampleRate = 44100) {
    const freqs = Array.isArray(frequencies) && frequencies.length > 0 ? frequencies : STANDARD_EQ_FREQUENCIES;
    const safeBands = Array.isArray(bands) ? bands.filter(b => b && (b.gain !== 0 || b.type === 'lowpass' || b.type === 'highpass')) : [];

    if (safeBands.length === 0) {
      return {
        frequencies: freqs,
        curve: freqs.map(f => ({ frequency: f, gainDb: 0 })),
        peakBoostDb: 0,
        peakCutDb: 0,
        recommendedPreampDb: 0
      };
    }

    const summedGains = new Float64Array(freqs.length);

    for (const band of safeBands) {
      const resp = calculateBiquadFrequencyResponse(band, freqs, sampleRate);
      for (let i = 0; i < freqs.length; i++) {
        summedGains[i] += resp[i].gainDb;
      }
    }

    let peakBoost = 0;
    let peakCut = 0;
    const curve = [];

    for (let i = 0; i < freqs.length; i++) {
      const g = Math.round(summedGains[i] * 100) / 100;
      curve.push({ frequency: freqs[i], gainDb: g });
      if (g > peakBoost) peakBoost = g;
      if (g < peakCut) peakCut = g;
    }

    peakBoost = Math.max(0, Math.round(peakBoost * 10) / 10);
    peakCut = Math.min(0, Math.round(peakCut * 10) / 10);
    const recommendedPreampDb = -peakBoost;

    return {
      frequencies: freqs,
      curve,
      peakBoostDb: peakBoost,
      peakCutDb: peakCut,
      recommendedPreampDb
    };
  }

  function formatEqCurveSummary(combinedCurve) {
    if (!combinedCurve || (!combinedCurve.peakBoostDb && !combinedCurve.peakCutDb)) {
      return 'Phẳng (0 dB)';
    }
    const boostStr = combinedCurve.peakBoostDb > 0 ? `+${combinedCurve.peakBoostDb.toFixed(1)} dB` : '0 dB';
    const cutStr = combinedCurve.peakCutDb < 0 ? `${combinedCurve.peakCutDb.toFixed(1)} dB` : '0 dB';
    return `Đỉnh: ${boostStr} · Trũng: ${cutStr}`;
  }

  // ── Pha B — Stereo Phase Correlation Meter & Soundstage Width Engine ──

  function calculateStereoPhaseCorrelation(leftData, rightData) {
    if (!leftData || !rightData || leftData.length === 0 || rightData.length === 0) {
      return {
        correlation: 1.0,
        phaseCategory: 'IN_PHASE',
        label: 'Đồng pha (In-Phase)',
        badgeClass: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
      };
    }

    const len = Math.min(leftData.length, rightData.length);
    const isByteLeft = leftData instanceof Uint8Array || (typeof leftData[0] === 'number' && leftData[0] >= 0 && leftData[0] <= 255 && !Array.from(leftData.slice(0, 10)).some(v => v < 0));
    const isByteRight = rightData instanceof Uint8Array || (typeof rightData[0] === 'number' && rightData[0] >= 0 && rightData[0] <= 255 && !Array.from(rightData.slice(0, 10)).some(v => v < 0));

    let sumLR = 0;
    let sumL2 = 0;
    let sumR2 = 0;

    for (let i = 0; i < len; i++) {
      const l = isByteLeft ? (leftData[i] - 128) / 128 : Number(leftData[i]) || 0;
      const r = isByteRight ? (rightData[i] - 128) / 128 : Number(rightData[i]) || 0;

      sumLR += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
    }

    const denominator = Math.sqrt(sumL2 * sumR2);
    let correlation = 1.0;

    if (denominator > 1e-9) {
      correlation = sumLR / denominator;
      correlation = Math.max(-1.0, Math.min(1.0, Math.round(correlation * 100) / 100));
    } else {
      correlation = 1.0;
    }

    let phaseCategory = 'IN_PHASE';
    let label = 'Đồng pha (In-Phase)';
    let badgeClass = 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';

    if (correlation >= 0.5) {
      phaseCategory = 'IN_PHASE';
      label = 'Đồng pha (In-Phase)';
      badgeClass = 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
    } else if (correlation >= 0.1) {
      phaseCategory = 'STEREO';
      label = 'Stereo mở rộng';
      badgeClass = 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300';
    } else if (correlation >= -0.1) {
      phaseCategory = 'WIDE';
      label = 'Không gian rộng (Wide)';
      badgeClass = 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300';
    } else {
      phaseCategory = 'PHASE_WARNING';
      label = 'Lệch pha (Anti-Phase)';
      badgeClass = 'border-rose-400/30 bg-rose-400/10 text-rose-300';
    }

    return {
      correlation,
      phaseCategory,
      label,
      badgeClass
    };
  }

  function calculateStereoSoundstageWidth(leftData, rightData) {
    if (!leftData || !rightData || leftData.length === 0 || rightData.length === 0) {
      return { widthPercent: 50, midEnergy: 0, sideEnergy: 0, label: 'Stereo chuẩn (50%)' };
    }

    const len = Math.min(leftData.length, rightData.length);
    const isByteLeft = leftData instanceof Uint8Array || (typeof leftData[0] === 'number' && leftData[0] >= 0 && leftData[0] <= 255 && !Array.from(leftData.slice(0, 10)).some(v => v < 0));
    const isByteRight = rightData instanceof Uint8Array || (typeof rightData[0] === 'number' && rightData[0] >= 0 && rightData[0] <= 255 && !Array.from(rightData.slice(0, 10)).some(v => v < 0));

    let sumMid2 = 0;
    let sumSide2 = 0;

    for (let i = 0; i < len; i++) {
      const l = isByteLeft ? (leftData[i] - 128) / 128 : Number(leftData[i]) || 0;
      const r = isByteRight ? (rightData[i] - 128) / 128 : Number(rightData[i]) || 0;

      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;

      sumMid2 += mid * mid;
      sumSide2 += side * side;
    }

    const total = sumMid2 + sumSide2;
    const ratio = total > 1e-9 ? sumSide2 / total : 0.5;
    const widthPercent = Math.max(0, Math.min(100, Math.round(ratio * 200)));

    return {
      widthPercent,
      midEnergy: Math.round(sumMid2 * 100) / 100,
      sideEnergy: Math.round(sumSide2 * 100) / 100,
      label: widthPercent < 15 ? 'Đơn âm (Mono)' : (widthPercent > 70 ? 'Không gian 3D' : `Stereo (${widthPercent}%)`)
    };
  }

  function formatStereoCorrelationBadge(corr) {
    if (!corr) return 'Phase +1.0';
    const val = Number.isFinite(corr.correlation) ? corr.correlation : 1.0;
    const sign = val > 0 ? '+' : '';
    return `Phase ${sign}${val.toFixed(2)}`;
  }

  // Pha C — Động cơ bù trừ độ trễ lời bài hát thời gian thực (Lyrics Time Offset Calibration)
  function calculateLyricsOffsetTime(currentTime, offsetSeconds = 0) {
    const cur = Number(currentTime);
    const off = Number(offsetSeconds);
    const validCur = Number.isFinite(cur) ? cur : 0;
    const validOff = Number.isFinite(off) ? off : 0;
    return Math.max(0, validCur + validOff);
  }

  function clampLyricsOffset(offsetSeconds, min = -10, max = 10) {
    const off = Number(offsetSeconds);
    if (!Number.isFinite(off)) return 0;
    const clamped = Math.max(min, Math.min(max, off));
    return Math.round(clamped * 100) / 100;
  }

  function formatLyricsOffset(offsetSeconds) {
    const off = Number(offsetSeconds);
    if (!Number.isFinite(off) || Math.abs(off) < 0.001) return 'Chuẩn (0ms)';
    const ms = Math.round(off * 1000);
    const sign = ms > 0 ? '+' : '';
    return `${sign}${ms}ms`;
  }

  function calculateLyricsLineOpacity(lineIndex, activeIndex) {
    const l = Number(lineIndex);
    const a = Number(activeIndex);
    if (!Number.isFinite(l) || !Number.isFinite(a) || a < 0) return 0.6;
    if (l === a) return 1.0;
    const distance = Math.abs(l - a);
    if (distance === 1) return 0.65;
    if (distance === 2) return 0.45;
    return 0.25;
  }

  // Pha D — Quản Lý Bộ Đệm Âm Thanh LRU & Thích Ứng Hạn Ngạch Lưu Trữ (Adaptive Quota & LRU Audio Cache)
  function calculateAdaptiveCacheLimits(storageEstimate, isLowSpace = false) {
    const est = storageEstimate || {};
    const percent = Number(est.percent) || 0;
    const lowSpace = Boolean(isLowSpace || est.isLowSpace);

    if (lowSpace || percent >= 90) {
      return {
        maxEntries: 8,
        maxBytes: 8 * 1024 * 1024,
        mode: 'emergency_compaction',
        description: 'Chế độ tiết kiệm khẩn cấp: Đĩa sắp đầy (giới hạn 8 lát / 8 MB)'
      };
    }
    if (percent >= 75) {
      return {
        maxEntries: 14,
        maxBytes: 14 * 1024 * 1024,
        mode: 'conservative',
        description: 'Chế độ thận trọng: Dung lượng trung bình (giới hạn 14 lát / 14 MB)'
      };
    }
    return {
      maxEntries: FIRST_SLICE_CACHE_MAX_ENTRIES, // 20
      maxBytes: FIRST_SLICE_CACHE_MAX_BYTES,     // 20 MB
      mode: 'optimal',
      description: 'Chế độ tối ưu: Dung lượng dồi dào (giới hạn 20 lát / 20 MB)'
    };
  }

  function computeLruCacheEviction(entries, maxEntries = FIRST_SLICE_CACHE_MAX_ENTRIES, maxBytes = FIRST_SLICE_CACHE_MAX_BYTES, options = {}) {
    if (!Array.isArray(entries)) return { keysToEvict: [], freedBytes: 0, remainingCount: 0, remainingBytes: 0 };
    const limitCount = Number.isFinite(maxEntries) && maxEntries >= 0 ? Math.floor(maxEntries) : FIRST_SLICE_CACHE_MAX_ENTRIES;
    const limitTotal = Number.isFinite(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : FIRST_SLICE_CACHE_MAX_BYTES;
    const pinnedKeys = new Set(Array.isArray(options.pinnedKeys) ? options.pinnedKeys : (options.pinnedKeys ? [options.pinnedKeys] : []));

    const validEntries = entries.filter(e => e && typeof e.key === 'string' && e.key);
    if (!validEntries.length) return { keysToEvict: [], freedBytes: 0, remainingCount: 0, remainingBytes: 0 };

    const mapped = validEntries.map((e, index) => {
      const accessTime = Number.isFinite(e.lastAccessedAt) ? e.lastAccessedAt : (Number.isFinite(e.savedAt) ? e.savedAt : 0);
      const size = Number.isFinite(e.size) && e.size > 0 ? e.size : 0;
      const isPinned = pinnedKeys.has(e.key);
      return {
        key: e.key,
        size,
        accessTime,
        isPinned,
        index
      };
    });

    mapped.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? 1 : -1;
      return (a.accessTime - b.accessTime) || (a.index - b.index);
    });

    let currentTotalBytes = mapped.reduce((sum, item) => sum + item.size, 0);
    let currentCount = mapped.length;
    const keysToEvict = [];
    let freedBytes = 0;

    for (let i = 0; i < mapped.length; i++) {
      if (currentCount <= limitCount && currentTotalBytes <= limitTotal) break;
      const candidate = mapped[i];
      if (candidate.isPinned && (mapped.length - i) <= pinnedKeys.size && currentCount > pinnedKeys.size) {
        continue;
      }
      keysToEvict.push(candidate.key);
      freedBytes += candidate.size;
      currentTotalBytes -= candidate.size;
      currentCount--;
    }

    return {
      keysToEvict,
      freedBytes,
      remainingCount: currentCount,
      remainingBytes: Math.max(0, currentTotalBytes)
    };
  }

  function formatCacheTelemetry(isHit, latencyMs = 0, sizeBytes = 0) {
    const lat = Number(latencyMs) || 0;
    const bytes = Number(sizeBytes) || 0;
    if (isHit) {
      const sizeStr = bytes > 0 ? ` · ${formatStorageBytes(bytes)}` : '';
      return `Cache HIT${sizeStr} · ${lat < 1 ? '<1' : lat.toFixed(1)}ms`;
    }
    return `Cache MISS · Mạng (${lat > 0 ? lat.toFixed(1) + 'ms' : 'đang tải'})`;
  }

  function evaluateStorageHealth(storageMetrics, storageEstimate) {
    const est = storageEstimate || {};
    const percent = Number(est.percent) || 0;
    const isLowSpace = Boolean(est.isLowSpace);
    const score = storageMetrics && Number.isFinite(storageMetrics.healthScore) ? storageMetrics.healthScore : 90;

    let grade = 'A+';
    let statusLabel = 'Tối ưu';
    let badgeColor = 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10';

    if (isLowSpace || percent >= 90 || score < 40) {
      grade = 'D';
      statusLabel = 'Nguy cơ đầy đĩa';
      badgeColor = 'text-rose-400 border-rose-400/30 bg-rose-400/10';
    } else if (percent >= 80 || score < 60) {
      grade = 'C';
      statusLabel = 'Cần dọn dẹp';
      badgeColor = 'text-amber-400 border-amber-400/30 bg-amber-400/10';
    } else if (percent >= 60 || score < 80) {
      grade = 'B';
      statusLabel = 'Khá';
      badgeColor = 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10';
    }

    return {
      grade,
      score,
      statusLabel,
      badgeColor,
      summary: `Hạng ${grade} (${statusLabel}) · Bộ đệm dùng ${est.formattedUsage || '0 B'}`
    };
  }

  // Pha A — Động cơ Đo True Peak / Inter-Sample Peak & Bảo Vệ Headroom Chuẩn EBU R128 / ITU-R BS.1770
  function calculateInterSamplePeak(samples, oversampleFactor = 4) {
    if (!samples || !samples.length) {
      return { samplePeakDb: -96, truePeakDbtp: -96, interSampleOvershootDb: 0, isClipping: false };
    }
    const len = samples.length;
    const isByte = samples instanceof Uint8Array || (typeof samples[0] === 'number' && samples[0] >= 0 && samples[0] <= 255 && samples.some(v => v > 1.5));

    let sampleMax = 0;
    // Chuyển đổi và trích xuất mảng số thực chuẩn hóa [-1.0, 1.0]
    const pcm = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const v = isByte ? (samples[i] - 128) / 128 : Number(samples[i]) || 0;
      pcm[i] = v;
      const absV = Math.abs(v);
      if (absV > sampleMax) sampleMax = absV;
    }

    let truePeakMax = sampleMax;
    // Nội suy Hermite 4 điểm để phát hiện các đỉnh sóng giữa các mẫu số (Inter-Sample Peaks)
    for (let i = 1; i < len - 2; i++) {
      const p0 = pcm[i - 1];
      const p1 = pcm[i];
      const p2 = pcm[i + 1];
      const p3 = pcm[i + 2];

      const c0 = p1;
      const c1 = 0.5 * (p2 - p0);
      const c2 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
      const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);

      // Thử các bước nội suy 4x: t = 0.25, 0.5, 0.75
      for (let step = 1; step < oversampleFactor; step++) {
        const t = step / oversampleFactor;
        const interp = ((c3 * t + c2) * t + c1) * t + c0;
        const absInterp = Math.abs(interp);
        if (absInterp > truePeakMax) {
          truePeakMax = absInterp;
        }
      }
    }

    const samplePeakDb = sampleMax > 1e-5 ? Math.round(20 * Math.log10(sampleMax) * 100) / 100 : -96;
    const truePeakDbtp = truePeakMax > 1e-5 ? Math.round(20 * Math.log10(truePeakMax) * 100) / 100 : -96;
    const overshootDb = Math.max(0, Math.round((truePeakDbtp - samplePeakDb) * 100) / 100);

    return {
      samplePeakDb,
      truePeakDbtp,
      interSampleOvershootDb: overshootDb,
      isClipping: truePeakDbtp > 0.0
    };
  }

  function calculateTruePeakHeadroom(truePeakDbtp, targetMarginDbtp = -1.0) {
    const tp = Number(truePeakDbtp);
    const target = Number(targetMarginDbtp);
    const validTp = Number.isFinite(tp) ? tp : -96;
    const validTarget = Number.isFinite(target) ? target : -1.0;

    if (validTp <= validTarget) {
      return {
        targetMarginDbtp: validTarget,
        truePeakDbtp: validTp,
        recommendedAttenuationDb: 0,
        hasHeadroom: true
      };
    }

    const atten = Math.round((validTarget - validTp) * 100) / 100;
    return {
      targetMarginDbtp: validTarget,
      truePeakDbtp: validTp,
      recommendedAttenuationDb: atten,
      hasHeadroom: false
    };
  }

  function formatTruePeakBadge(truePeakDbtp) {
    const tp = Number(truePeakDbtp);
    if (!Number.isFinite(tp) || tp <= -90) return 'TP --';
    if (tp > 0.0) {
      return `TP +${tp.toFixed(1)} ⚠`;
    }
    const sign = tp > -0.05 && tp < 0.05 ? '' : (tp > 0 ? '+' : '');
    return `TP ${sign}${tp.toFixed(1)} dBTP`;
  }

  // Pha B — Cử Chỉ Vuốt Cảm Ứng Di Động (Mobile Touch Swipe Gestures) & Hiệu Ứng Đàn Hồi Vật Lý (Spring Physics)
  function calculateSwipeGesture(startX, startY, endX, endY, deltaMs, options = {}) {
    const sX = Number(startX) || 0;
    const sY = Number(startY) || 0;
    const eX = Number(endX) || 0;
    const eY = Number(endY) || 0;
    const dt = Math.max(1, Number(deltaMs) || 1);

    const deltaX = Math.round((eX - sX) * 10) / 10;
    const deltaY = Math.round((eY - sY) * 10) / 10;
    const distance = Math.round(Math.hypot(deltaX, deltaY) * 10) / 10;
    const velocity = Math.round((distance / dt) * 100) / 100; // px/ms

    const minDistance = Number.isFinite(options.minDistance) ? options.minDistance : 45;
    const maxCrossAxis = Number.isFinite(options.maxCrossAxis) ? options.maxCrossAxis : 85;
    const velocityThreshold = Number.isFinite(options.velocityThreshold) ? options.velocityThreshold : 0.25;

    let direction = 'none';

    // Horizontal swipe (Left / Right)
    if (Math.abs(deltaX) >= minDistance || (Math.abs(deltaX) >= minDistance * 0.65 && velocity >= velocityThreshold)) {
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && Math.abs(deltaY) <= maxCrossAxis) {
        direction = deltaX < 0 ? 'swipe_left' : 'swipe_right';
      }
    }

    // Vertical swipe (Down: Dismiss / Up: Expand)
    if (direction === 'none') {
      if (Math.abs(deltaY) >= minDistance || (Math.abs(deltaY) >= minDistance * 0.65 && velocity >= velocityThreshold)) {
        if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25 && Math.abs(deltaX) <= maxCrossAxis) {
          direction = deltaY > 0 ? 'swipe_down' : 'swipe_up';
        }
      }
    }

    return {
      direction,
      deltaX,
      deltaY,
      distance,
      velocity,
      isValidSwipe: direction !== 'none'
    };
  }

  function calculateSpringTransform(deltaX, deltaY, isHorizontal = true, maxDragPx = 180) {
    const dX = Number(deltaX) || 0;
    const dY = Number(deltaY) || 0;
    const maxDrag = Math.max(50, Number(maxDragPx) || 180);

    if (isHorizontal) {
      const sign = dX >= 0 ? 1 : -1;
      const raw = Math.abs(dX);
      const damped = Math.round(sign * Math.min(maxDrag, Math.pow(raw, 0.82) * 1.75) * 10) / 10;
      const rotateDeg = Math.round((damped / maxDrag) * 7.5 * 100) / 100;
      const progress = Math.min(1, Math.abs(damped) / maxDrag);
      const opacity = Math.round(Math.max(0.4, 1 - progress * 0.5) * 100) / 100;
      const scale = Math.round(Math.max(0.92, 1 - progress * 0.08) * 1000) / 1000;
      return {
        translateX: damped,
        translateY: 0,
        rotateDeg,
        scale,
        opacity,
        progress,
        cssTransform: `translate3d(${damped}px, 0, 0) scale(${scale}) rotate(${rotateDeg}deg)`
      };
    }

    // Vertical pull-down
    const dampedY = Math.round(Math.max(0, Math.min(maxDrag, Math.pow(Math.max(0, dY), 0.82) * 1.75)) * 10) / 10;
    const progress = Math.min(1, dampedY / maxDrag);
    const opacity = Math.round(Math.max(0.4, 1 - progress * 0.55) * 100) / 100;
    const scale = Math.round(Math.max(0.90, 1 - progress * 0.1) * 1000) / 1000;
    return {
      translateX: 0,
      translateY: dampedY,
      rotateDeg: 0,
      scale,
      opacity,
      progress,
      cssTransform: `translate3d(0, ${dampedY}px, 0) scale(${scale})`
    };
  }

  function formatSwipeHint(direction) {
    switch (direction) {
      case 'swipe_left':
        return 'Chuyển sang bài tiếp theo ➔';
      case 'swipe_right':
        return 'Quay lại bài trước ‹';
      case 'swipe_down':
        return 'Đóng màn hình ✕';
      case 'swipe_up':
        return 'Mở toàn màn hình ⛶';
      default:
        return '';
    }
  }

  // Pha B — Hiện Sóng Dao Động Ký Thời Gian Thực (Real-Time Oscilloscope Waveform)
  function renderVisualizerOscilloscope(context, options = {}) {
    if (!context || !options) return false;
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const data = options.data;
    if (!data || data.length === 0) return false;

    const theme = getVisualizerTheme(options.theme);
    const strokeWidth = Number.isFinite(options.strokeWidth) ? Math.max(1, options.strokeWidth) : 2;
    const glow = options.glow !== false;

    // Center reference line
    if (options.showCenterLine) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
    }

    let grad;
    try {
      grad = context.createLinearGradient(0, 0, width, 0);
      for (const stop of theme.stops) {
        grad.addColorStop(stop.offset, stop.color);
      }
    } catch (_) {
      grad = theme.peakColor || '#a78bfa';
    }

    context.lineWidth = strokeWidth;
    context.strokeStyle = grad;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (glow && typeof context.shadowBlur === 'number') {
      context.shadowBlur = 8;
      context.shadowColor = theme.peakColor || '#a78bfa';
    }

    context.beginPath();
    const sliceWidth = width / (data.length - 1);
    let x = 0;

    for (let i = 0; i < data.length; i++) {
      const v = (data[i] || 128) / 128.0; // 0..2, with 1.0 being center
      const y = (v * height) / 2;

      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      x += sliceWidth;
    }

    context.stroke();

    // Reset shadow
    if (glow && typeof context.shadowBlur === 'number') {
      context.shadowBlur = 0;
    }

    return true;
  }

  // Pha B — Đo Lường Ballistics & Đồng Hồ VU Analog Kép (Dual Stereophonic Analog VU Meter)
  function calculateVuBallistics(currentLevel, previousLevel = 0, options = {}) {
    const raw = Math.max(0, Math.min(1, Number(currentLevel) || 0));
    const prev = Math.max(0, Math.min(1, Number(previousLevel) || 0));
    const attack = Number.isFinite(options.attack) ? Math.max(0.05, Math.min(1, options.attack)) : 0.35;
    const decay = Number.isFinite(options.decay) ? Math.max(0.01, Math.min(0.5, options.decay)) : 0.05;

    let level;
    if (raw > prev) {
      level = prev + (raw - prev) * attack;
    } else {
      level = Math.max(0, prev - decay);
    }

    const db = level > 0.001 ? Math.max(-40, 20 * Math.log10(level)) : -40;
    const isOverload = db >= -0.5;
    const norm = Math.min(1, Math.max(0, (db + 40) / 43));
    const needleAngle = -45 + norm * 90;

    return {
      level: Math.round(level * 1000) / 1000,
      db: Math.round(db * 10) / 10,
      needleAngle: Math.round(needleAngle * 10) / 10,
      isOverload
    };
  }

  function cycleVisualizerMode(currentMode) {
    const modes = ['spectrum', 'oscilloscope', 'vumeter'];
    const curIndex = modes.indexOf(String(currentMode || '').toLowerCase());
    const nextIndex = (curIndex + 1) % modes.length;
    return modes[nextIndex];
  }

  function formatVisualizerMode(mode) {
    switch (String(mode || '').toLowerCase()) {
      case 'oscilloscope':
        return 'Dao động ký thời gian thực (Oscilloscope)';
      case 'vumeter':
        return 'Đồng hồ VU Analog kép (Dual VU Meter)';
      case 'spectrum':
      default:
        return 'Phổ tần số FFT (Spectrum)';
    }
  }

  function renderVisualizerVuMeter(context, options = {}) {
    if (!context || !options) return false;
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const theme = getVisualizerTheme(options.theme);
    const leftAngle = Number.isFinite(options.leftAngle) ? options.leftAngle : -45;
    const rightAngle = Number.isFinite(options.rightAngle) ? options.rightAngle : leftAngle;
    const isOverloadLeft = !!options.isOverloadLeft;
    const isOverloadRight = !!options.isOverloadRight;

    context.clearRect(0, 0, width, height);

    const isDual = width >= 140;
    const channels = isDual ? [
      { label: 'L', angle: leftAngle, overload: isOverloadLeft, cx: width * 0.28, cy: height * 0.88, r: Math.min(width * 0.24, height * 0.75) },
      { label: 'R', angle: rightAngle, overload: isOverloadRight, cx: width * 0.72, cy: height * 0.88, r: Math.min(width * 0.24, height * 0.75) }
    ] : [
      { label: 'VU', angle: leftAngle, overload: isOverloadLeft || isOverloadRight, cx: width * 0.5, cy: height * 0.88, r: Math.min(width * 0.45, height * 0.78) }
    ];

    for (const ch of channels) {
      const { cx, cy, r, angle, label, overload } = ch;

      context.beginPath();
      context.arc(cx, cy, r, Math.PI * 1.25, Math.PI * 1.75);
      context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      context.lineWidth = 3;
      context.stroke();

      context.beginPath();
      context.arc(cx, cy, r, Math.PI * 1.62, Math.PI * 1.75);
      context.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      context.lineWidth = 3;
      context.stroke();

      const ticks = [-40, -20, -10, -5, 0, 3];
      for (const tDb of ticks) {
        const tNorm = (tDb + 40) / 43;
        const rad = (Math.PI * 1.25) + tNorm * (Math.PI * 0.5);
        const x1 = cx + Math.cos(rad) * (r - 2);
        const y1 = cy + Math.sin(rad) * (r - 2);
        const x2 = cx + Math.cos(rad) * (r + 4);
        const y2 = cy + Math.sin(rad) * (r + 4);

        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = tDb >= 0 ? 'rgba(239, 68, 68, 0.9)' : 'rgba(255, 255, 255, 0.25)';
        context.lineWidth = tDb === 0 ? 2 : 1;
        context.stroke();
      }

      context.fillStyle = 'rgba(255, 255, 255, 0.4)';
      context.font = '8px monospace';
      context.textAlign = 'center';
      context.fillText(label, cx, cy - r * 0.35);

      context.beginPath();
      context.arc(cx + r * 0.7, cy - r * 0.65, 3, 0, Math.PI * 2);
      context.fillStyle = overload ? '#ef4444' : 'rgba(239, 68, 68, 0.15)';
      context.fill();
      if (overload && typeof context.shadowBlur === 'number') {
        context.shadowBlur = 6;
        context.shadowColor = '#ef4444';
      }

      const needleRad = (Math.PI * 1.5) + (angle * (Math.PI / 180));
      const nx = cx + Math.cos(needleRad) * (r * 0.92);
      const ny = cy + Math.sin(needleRad) * (r * 0.92);

      context.beginPath();
      context.moveTo(cx, cy);
      context.lineTo(nx, ny);
      context.strokeStyle = overload ? '#f87171' : (theme.stops && theme.stops[0] ? theme.stops[0].color : '#38bdf8');
      context.lineWidth = 1.5;
      context.lineCap = 'round';
      context.stroke();

      context.beginPath();
      context.arc(cx, cy, 3, 0, Math.PI * 2);
      context.fillStyle = '#71717a';
      context.fill();

      if (typeof context.shadowBlur === 'number') context.shadowBlur = 0;
    }

    return true;
  }

  // Pha B — Acoustic Thermal Ballistics & 3D Soundstage Vector Constellation
  function calculateThermalBallistics(currentLevel, previousState = {}, options = {}) {
    const raw = Math.max(0, Math.min(1, Number(currentLevel) || 0));
    const prevLevel = Math.max(0, Math.min(1, Number(previousState.level) || 0));
    const prevTemp = Number.isFinite(previousState.temperatureC) ? previousState.temperatureC : 25;
    const prevThermalLoad = Math.max(0, Math.min(1, Number(previousState.thermalLoad) || 0));
    const prevPeakHold = Number.isFinite(previousState.peakHoldDb) ? previousState.peakHoldDb : -40;

    // Ballistics constants (DIN / IEC 60268-10 VU standard with thermal inertia)
    const attackRate = Number.isFinite(options.attack) ? Math.max(0.05, Math.min(1, options.attack)) : 0.38;
    const decayRate = Number.isFinite(options.decay) ? Math.max(0.01, Math.min(0.5, options.decay)) : 0.045;
    const thermalInertia = Number.isFinite(options.thermalInertia) ? Math.max(0.005, Math.min(0.2, options.thermalInertia)) : 0.025;
    const coolingRate = Number.isFinite(options.coolingRate) ? Math.max(0.002, Math.min(0.1, options.coolingRate)) : 0.012;

    let level;
    if (raw > prevLevel) {
      level = prevLevel + (raw - prevLevel) * attackRate;
    } else {
      level = Math.max(0, prevLevel - decayRate);
    }

    const db = level > 0.0005 ? Math.max(-40, Math.min(3, 20 * Math.log10(level))) : -40;
    const isOverload = db >= -0.2;
    const norm = Math.min(1, Math.max(0, (db + 40) / 43));
    const needleAngle = Math.round((-45 + norm * 90) * 10) / 10;

    // Thermal simulation: Power dissipation = level^2
    const instantaneousPower = raw * raw;
    let thermalLoad;
    if (instantaneousPower > prevThermalLoad) {
      thermalLoad = prevThermalLoad + (instantaneousPower - prevThermalLoad) * thermalInertia;
    } else {
      thermalLoad = Math.max(0, prevThermalLoad - coolingRate);
    }
    thermalLoad = Math.min(1, Math.max(0, thermalLoad));

    // Temperature in °C: ambient (25°C) to peak rated (85°C)
    const temperatureC = Math.round((25 + thermalLoad * 60) * 10) / 10;

    let thermalRating = 'cool';
    if (temperatureC >= 75) {
      thermalRating = 'hot';
    } else if (temperatureC >= 60) {
      thermalRating = 'warm';
    } else if (temperatureC >= 38) {
      thermalRating = 'optimal';
    }

    const isThermalWarning = temperatureC >= 75 || thermalLoad >= 0.85;

    // Peak hold calculation
    let peakHoldDb;
    if (db > prevPeakHold) {
      peakHoldDb = db;
    } else {
      peakHoldDb = Math.max(-40, prevPeakHold - 0.25);
    }

    return {
      level: Math.round(level * 1000) / 1000,
      db: Math.round(db * 10) / 10,
      needleAngle,
      thermalLoad: Math.round(thermalLoad * 1000) / 1000,
      temperatureC,
      thermalRating,
      isOverload,
      isThermalWarning,
      peakHoldDb: Math.round(peakHoldDb * 10) / 10
    };
  }

  function formatThermalBallisticsBadge(thermal) {
    if (!thermal) return '25°C · Tĩnh';
    const temp = Number.isFinite(thermal.temperatureC) ? thermal.temperatureC : 25;
    const rating = thermal.thermalRating || 'cool';
    const warning = thermal.isThermalWarning ? ' ⚠️' : '';
    switch (rating) {
      case 'hot':
        return `${temp.toFixed(0)}°C · Quá tải${warning}`;
      case 'warm':
        return `${temp.toFixed(0)}°C · Ấm`;
      case 'optimal':
        return `${temp.toFixed(0)}°C · Tối ưu`;
      case 'cool':
      default:
        return `${temp.toFixed(0)}°C · Mát mẻ`;
    }
  }

  function calculateSoundstageAcousticVectors(leftData, rightData, sampleRate = 44100) {
    if (!leftData || !rightData || leftData.length === 0 || rightData.length === 0) {
      return {
        azimuth: 0,
        depth: 0.5,
        spread: 50,
        airiness: 0.5,
        soundstageType: 'balanced',
        summary: 'Âm hình Cân bằng (Rộng 50%)'
      };
    }

    const len = Math.min(leftData.length, rightData.length);
    const isByteLeft = leftData instanceof Uint8Array || (typeof leftData[0] === 'number' && leftData[0] >= 0 && leftData[0] <= 255 && !Array.from(leftData.slice(0, 10)).some(v => v < 0));
    const isByteRight = rightData instanceof Uint8Array || (typeof rightData[0] === 'number' && rightData[0] >= 0 && rightData[0] <= 255 && !Array.from(rightData.slice(0, 10)).some(v => v < 0));

    let sumL2 = 0, sumR2 = 0, sumMid2 = 0, sumSide2 = 0;
    let highFreqEnergy = 0, totalEnergy = 0;

    for (let i = 0; i < len; i++) {
      const l = isByteLeft ? (leftData[i] - 128) / 128 : Number(leftData[i]) || 0;
      const r = isByteRight ? (rightData[i] - 128) / 128 : Number(rightData[i]) || 0;

      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;

      sumL2 += l * l;
      sumR2 += r * r;
      sumMid2 += mid * mid;
      sumSide2 += side * side;

      if (i > 0) {
        const prevL = isByteLeft ? (leftData[i-1] - 128) / 128 : Number(leftData[i-1]) || 0;
        const diff = l - prevL;
        highFreqEnergy += diff * diff;
      }
      totalEnergy += (l * l + r * r) * 0.5;
    }

    const totalLR = sumL2 + sumR2;
    let azimuth = 0;
    if (totalLR > 1e-9) {
      const panRatio = (sumR2 - sumL2) / totalLR;
      azimuth = Math.round(panRatio * 45 * 10) / 10;
    }

    const totalMS = sumMid2 + sumSide2;
    const spreadRatio = totalMS > 1e-9 ? sumSide2 / totalMS : 0.5;
    const spread = Math.max(0, Math.min(100, Math.round(spreadRatio * 200)));
    const depth = Math.max(0.1, Math.min(1.0, Math.round((0.3 + spreadRatio * 0.7) * 100) / 100));
    const airRatio = totalEnergy > 1e-9 ? highFreqEnergy / totalEnergy : 0.3;
    const airiness = Math.max(0, Math.min(1, Math.round(Math.min(1, airRatio * 2.5) * 100) / 100));

    let soundstageType = 'balanced';
    if (spread < 20) {
      soundstageType = 'intimate';
    } else if (spread > 75) {
      soundstageType = 'holographic';
    } else if (spread > 55) {
      soundstageType = 'wide';
    }

    const summary = formatSoundstageVectorsSummary({ azimuth, depth, spread, airiness, soundstageType });

    return {
      azimuth,
      depth,
      spread,
      airiness,
      soundstageType,
      summary
    };
  }

  function formatSoundstageVectorsSummary(vectors) {
    if (!vectors) return 'Âm hình Cân bằng';
    const type = vectors.soundstageType || 'balanced';
    const spread = vectors.spread !== undefined ? vectors.spread : 50;
    const az = Number.isFinite(vectors.azimuth) ? vectors.azimuth : 0;
    const azDir = Math.abs(az) < 3 ? 'Giữa' : (az > 0 ? `Lệch Phải ${az.toFixed(0)}°` : `Lệch Trái ${Math.abs(az).toFixed(0)}°`);

    switch (type) {
      case 'holographic':
        return `Không gian Holographic 3D (Rộng ${spread}% · ${azDir})`;
      case 'wide':
        return `Âm trường Rộng Mở (Rộng ${spread}% · ${azDir})`;
      case 'intimate':
        return `Âm hình Gần Gũi / Mono (Rộng ${spread}% · ${azDir})`;
      case 'balanced':
      default:
        return `Âm hình Stereo Chuẩn (Rộng ${spread}% · ${azDir})`;
    }
  }

  function renderAcousticSoundstageCanvas(context, vectors, options = {}) {
    if (!context) return false;
    const width = Number(options.width) || (context.canvas ? context.canvas.width : 0);
    const height = Number(options.height) || (context.canvas ? context.canvas.height : 0);
    if (width <= 0 || height <= 0) return false;

    const theme = getVisualizerTheme(options.theme || 'cyber');
    const primaryColor = (theme.stops && theme.stops[0]) ? theme.stops[0].color : '#a855f7';
    const secondaryColor = (theme.stops && theme.stops[1]) ? theme.stops[1].color : '#ec4899';
    const peakColor = theme.peakColor || '#c084fc';

    context.clearRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.65;
    const maxR = Math.min(width * 0.42, height * 0.55);

    // Draw polar grid rings
    const rings = [0.25, 0.5, 0.75, 1.0];
    for (const rFraction of rings) {
      context.beginPath();
      context.arc(cx, cy, maxR * rFraction, Math.PI, Math.PI * 2);
      context.strokeStyle = rFraction === 1.0 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
      context.lineWidth = 1;
      context.stroke();
    }

    // Radial spokes (-45°, -30°, -15°, 0°, +15°, +30°, +45°)
    const angles = [-45, -30, -15, 0, 15, 30, 45];
    for (const deg of angles) {
      const rad = (deg - 90) * (Math.PI / 180);
      context.beginPath();
      context.moveTo(cx, cy);
      context.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
      context.strokeStyle = deg === 0 ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.05)';
      context.lineWidth = deg === 0 ? 1.5 : 1;
      context.stroke();

      if (Math.abs(deg) === 45 || deg === 0) {
        const lx = cx + Math.cos(rad) * (maxR + 14);
        const ly = cy + Math.sin(rad) * (maxR + 14);
        context.fillStyle = 'rgba(255, 255, 255, 0.35)';
        context.font = '9px monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(deg === 0 ? 'C' : (deg < 0 ? 'L' : 'R'), lx, ly);
      }
    }

    // Sweet Spot / Listener position
    context.beginPath();
    context.arc(cx, cy, 4, 0, Math.PI * 2);
    context.fillStyle = '#94a3b8';
    context.fill();

    const safeVectors = vectors || { azimuth: 0, depth: 0.5, spread: 50, airiness: 0.5 };
    const az = Number.isFinite(safeVectors.azimuth) ? safeVectors.azimuth : 0;
    const depth = Number.isFinite(safeVectors.depth) ? safeVectors.depth : 0.5;
    const spread = Number.isFinite(safeVectors.spread) ? safeVectors.spread : 50;

    const vectorRad = (az - 90) * (Math.PI / 180);
    const vectorR = maxR * Math.min(1.0, Math.max(0.15, depth));
    const vx = cx + Math.cos(vectorRad) * vectorR;
    const vy = cy + Math.sin(vectorRad) * vectorR;

    const spreadRadius = (spread / 100) * (maxR * 0.45);
    if (typeof context.save === 'function') context.save();
    context.beginPath();
    if (typeof context.ellipse === 'function') {
      context.ellipse(vx, vy, spreadRadius + 10, spreadRadius * 0.6 + 6, 0, 0, Math.PI * 2);
    } else {
      context.arc(vx, vy, spreadRadius + 10, 0, Math.PI * 2);
    }
    if (typeof context.createRadialGradient === 'function') {
      const grad = context.createRadialGradient(vx, vy, 0, vx, vy, spreadRadius + 12);
      grad.addColorStop(0, primaryColor + '66');
      grad.addColorStop(0.6, secondaryColor + '33');
      grad.addColorStop(1, 'transparent');
      context.fillStyle = grad;
      context.fill();
    }
    context.strokeStyle = peakColor + '88';
    context.lineWidth = 1.5;
    context.stroke();
    if (typeof context.restore === 'function') context.restore();

    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(vx, vy);
    context.strokeStyle = peakColor;
    context.lineWidth = 2;
    context.stroke();

    context.beginPath();
    context.arc(vx, vy, 5, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();

    return true;
  }

  // Pha C — Thống Kê Hàng Đợi Thông Minh & Phân Tích Định Dạng Audio
  function calculateQueueMetrics(queueTracks) {
    if (!Array.isArray(queueTracks) || queueTracks.length === 0) {
      return {
        totalTracks: 0,
        totalDurationSec: 0,
        formattedDuration: '0:00',
        formatBreakdown: {},
        highResCount: 0,
        highResPercentage: 0,
        estimatedSizeMb: 0
      };
    }

    const totalTracks = queueTracks.length;
    let totalDurationSec = 0;
    const formatBreakdown = {};
    let highResCount = 0;
    let estimatedBytes = 0;

    for (const track of queueTracks) {
      if (!track) continue;
      const dur = Number(track.duration);
      const trackDur = Number.isFinite(dur) && dur > 0 ? dur : 0;
      totalDurationSec += trackDur;

      const fmt = (track.format || (track.isDsd ? 'DSD' : (track.source || 'AUDIO'))).toUpperCase();
      formatBreakdown[fmt] = (formatBreakdown[fmt] || 0) + 1;

      const isHighRes = track.isDsd || (track.bitDepth && track.bitDepth >= 24) || (track.sampleRate && track.sampleRate >= 48000) || fmt === 'FLAC' || fmt === 'DSD';
      if (isHighRes) highResCount++;

      // Byte estimation: bytes per second based on quality
      let byteRate = 128 * 1024 / 8; // ~128kbps default (~16KB/s)
      if (track.isDsd) byteRate = 5644800 / 8; // DSD64 1-bit ~700KB/s
      else if (track.bitDepth >= 24 && track.sampleRate >= 96000) byteRate = (96000 * 24 * 2) / 8; // ~576KB/s
      else if (fmt === 'FLAC' || fmt === 'WAV') byteRate = (44100 * 16 * 2 * 0.6) / 8; // FLAC ~105KB/s
      else if (fmt === 'MP3' || fmt === 'AAC') byteRate = 320 * 1024 / 8; // ~40KB/s

      estimatedBytes += (trackDur > 0 ? trackDur : 210) * byteRate;
    }

    totalDurationSec = Math.round(totalDurationSec);
    const hrs = Math.floor(totalDurationSec / 3600);
    const mins = Math.floor((totalDurationSec % 3600) / 60);
    const secs = totalDurationSec % 60;
    let formattedDuration = '0:00';
    if (hrs > 0) {
      formattedDuration = `${hrs}h ${mins}m`;
    } else if (mins > 0) {
      formattedDuration = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    } else if (secs > 0) {
      formattedDuration = `0:${secs < 10 ? '0' : ''}${secs}`;
    }

    const highResPercentage = totalTracks > 0 ? Math.round((highResCount / totalTracks) * 100) : 0;
    const estimatedSizeMb = Math.round((estimatedBytes / (1024 * 1024)) * 10) / 10;

    return {
      totalTracks,
      totalDurationSec,
      formattedDuration,
      formatBreakdown,
      highResCount,
      highResPercentage,
      estimatedSizeMb
    };
  }

  function formatQueueSummaryBadge(metrics) {
    if (!metrics || !metrics.totalTracks) return 'Hàng đợi trống';
    const parts = [
      `${metrics.totalTracks} bài`,
      metrics.formattedDuration
    ];
    if (metrics.highResPercentage > 0) {
      parts.push(`Hi-Res ${metrics.highResPercentage}%`);
    }
    if (metrics.estimatedSizeMb > 0) {
      parts.push(`~${metrics.estimatedSizeMb >= 1000 ? (metrics.estimatedSizeMb / 1024).toFixed(1) + ' GB' : metrics.estimatedSizeMb + ' MB'}`);
    }
    return parts.join(' · ');
  }

  // Pha C — Tính Toán Tiến Trình Từng Từ Karaoke (Word-Level Karaoke Progress)
  function calculateLyricWordProgress(currentTime, wordTime, nextWordTime = null) {
    const cur = Number(currentTime);
    const start = Number(wordTime);
    if (!Number.isFinite(cur) || !Number.isFinite(start)) return 0;
    if (cur < start) return 0;

    const end = (Number.isFinite(Number(nextWordTime)) && Number(nextWordTime) > start)
      ? Number(nextWordTime)
      : start + 0.6; // default 600ms word duration

    if (cur >= end) return 1.0;
    const progress = (cur - start) / (end - start);
    return Math.max(0, Math.min(1, Math.round(progress * 1000) / 1000));
  }

  // Pha C — Xuất Chuẩn Định Dạng Lời Bài Hát .LRC (Standard LRC Exporter)
  function generateLrcExportContent(track, lyricsLines, options = {}) {
    const lines = [];
    const meta = track || {};
    const title = meta.title || 'Untitled';
    const artist = meta.artist || 'Unknown Artist';
    const album = meta.album && meta.album !== 'Unknown Album' ? meta.album : '';

    lines.push(`[ti:${title}]`);
    lines.push(`[ar:${artist}]`);
    if (album) lines.push(`[al:${album}]`);
    lines.push(`[by:Nocturne Audiophile Music Player]`);
    lines.push(`[re:Nocturne PWA]`);

    if (meta.duration && Number(meta.duration) > 0) {
      const dMin = Math.floor(meta.duration / 60);
      const dSec = Math.floor(meta.duration % 60);
      lines.push(`[length:${dMin < 10 ? '0' : ''}${dMin}:${dSec < 10 ? '0' : ''}${dSec}]`);
    }

    const offsetMs = Number(options.offsetMs) || 0;
    if (offsetMs !== 0) {
      lines.push(`[offset:${offsetMs}]`);
    }

    if (Array.isArray(lyricsLines)) {
      for (const item of lyricsLines) {
        if (!item) continue;
        const t = Number(item.time);
        const text = String(item.text || '').trim();
        if (Number.isFinite(t) && t >= 0) {
          const m = Math.floor(t / 60);
          const s = Math.floor(t % 60);
          const cs = Math.floor((t % 1) * 100);
          const padM = m < 10 ? '0' + m : m;
          const padS = s < 10 ? '0' + s : s;
          const padCs = cs < 10 ? '0' + cs : cs;
          lines.push(`[${padM}:${padS}.${padCs}]${text}`);
        } else if (text) {
          lines.push(text);
        }
      }
    }

    return lines.join('\n');
  }

  // Pha D — Bộ Sao Lưu & Phục Hồi Toàn Diện Cấu Hình Thư Viện PWA (Full Config Backup & Safe Restore)
  function exportAppConfiguration(configSource = {}) {
    const favorites = Array.isArray(configSource.favorites)
      ? configSource.favorites
      : (configSource.favorites instanceof Set ? Array.from(configSource.favorites) : []);

    const playlists = Array.isArray(configSource.playlists) ? configSource.playlists : [];
    const recentHistory = Array.isArray(configSource.recentHistory) ? configSource.recentHistory.slice(0, 50) : [];
    const trackRatings = (configSource.trackRatings && typeof configSource.trackRatings === 'object') ? configSource.trackRatings : {};
    const trackAnnotations = (configSource.trackAnnotations && typeof configSource.trackAnnotations === 'object') ? configSource.trackAnnotations : {};

    const settings = {
      crossfadeSeconds: Number(configSource.crossfadeSeconds) || 0,
      crossfadeCurve: configSource.crossfadeCurve || 'equal-power',
      autoEqProfile: configSource.autoEqProfile || 'none',
      visualizerTheme: configSource.visualizerTheme || 'cyber',
      visualizerMode: configSource.visualizerMode || 'spectrum',
      visualizerStrobeEnabled: configSource.visualizerStrobeEnabled !== false,
      ambientStageMode: configSource.ambientStageMode || 'reactive',
      limiterMode: configSource.limiterMode || 'transparent',
      roomAcousticProfile: configSource.roomAcousticProfile || 'bypass',
      roomAcousticWet: Number.isFinite(Number(configSource.roomAcousticWet)) ? Number(configSource.roomAcousticWet) : 0.2,
      toneBass: Number(configSource.toneBass) || 0,
      toneTreble: Number(configSource.toneTreble) || 0,
      stereoBalance: Number(configSource.stereoBalance) || 0,
      crossfeed: Number(configSource.crossfeed) || 0,
      replayGainEnabled: Boolean(configSource.replayGainEnabled),
      subBassPunchProfile: configSource.subBassPunchProfile || 'off',
      subBassPunchIntensity: Number.isFinite(Number(configSource.subBassPunchIntensity)) ? Number(configSource.subBassPunchIntensity) : 1.0,
      tubeEmulationProfile: configSource.tubeEmulationProfile || 'off',
      dsdUltrasonicFilter: configSource.dsdUltrasonicFilter || 'bypass',
      subBassPhaseProfile: configSource.subBassPhaseProfile || 'bypass'
    };

    return {
      appName: 'Nocturne',
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites,
      playlists,
      recentHistory,
      trackRatings,
      trackAnnotations,
      settings
    };
  }

  function validateAndParseConfiguration(jsonText) {
    if (typeof jsonText !== 'string' || !jsonText.trim()) {
      return { isValid: false, config: null, error: 'Dữ liệu sao lưu trống hoặc không hợp lệ.' };
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object') {
        return { isValid: false, config: null, error: 'Định dạng JSON không phải là một đối tượng hợp lệ.' };
      }

      const hasApp = parsed.appName === 'Nocturne';
      const hasCore = Array.isArray(parsed.favorites) || Array.isArray(parsed.playlists) || (parsed.settings && typeof parsed.settings === 'object') || (parsed.trackRatings && typeof parsed.trackRatings === 'object') || (parsed.trackAnnotations && typeof parsed.trackAnnotations === 'object');

      if (!hasApp && !hasCore) {
        return { isValid: false, config: null, error: 'File không chứa cấu hình hợp lệ của ứng dụng Nocturne.' };
      }

      const sanitized = {
        appName: 'Nocturne',
        version: Number(parsed.version) || 1,
        exportedAt: parsed.exportedAt || new Date().toISOString(),
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter(id => typeof id === 'string' || typeof id === 'number') : [],
        playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
        recentHistory: Array.isArray(parsed.recentHistory) ? parsed.recentHistory : [],
        trackRatings: (parsed.trackRatings && typeof parsed.trackRatings === 'object') ? parsed.trackRatings : {},
        trackAnnotations: (parsed.trackAnnotations && typeof parsed.trackAnnotations === 'object') ? parsed.trackAnnotations : {},
        settings: (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : {}
      };

      return { isValid: true, config: sanitized, error: null };
    } catch (e) {
      return { isValid: false, config: null, error: `Lỗi phân tích cú pháp JSON: ${e.message}` };
    }
  }

  function mergeRestoredConfiguration(currentState, importedConfig, options = {}) {
    if (!currentState || !importedConfig || typeof importedConfig !== 'object') {
      return { restoredFavoritesCount: 0, restoredPlaylistsCount: 0, restoredRatingsCount: 0, restoredAnnotationsCount: 0, appliedSettingsCount: 0 };
    }

    let restoredFavoritesCount = 0;
    if (Array.isArray(importedConfig.favorites)) {
      if (currentState.favorites instanceof Set) {
        for (const fav of importedConfig.favorites) {
          if (!currentState.favorites.has(fav)) {
            currentState.favorites.add(fav);
            restoredFavoritesCount++;
          }
        }
      }
    }

    let restoredPlaylistsCount = 0;
    if (Array.isArray(importedConfig.playlists)) {
      restoredPlaylistsCount = importedConfig.playlists.length;
    }

    let restoredRatingsCount = 0;
    if (importedConfig.trackRatings && typeof importedConfig.trackRatings === 'object') {
      if (!currentState.trackRatings || typeof currentState.trackRatings !== 'object') {
        currentState.trackRatings = {};
      }
      for (const [tid, rating] of Object.entries(importedConfig.trackRatings)) {
        currentState.trackRatings[tid] = Number(rating);
        restoredRatingsCount++;
      }
    }

    let restoredAnnotationsCount = 0;
    if (importedConfig.trackAnnotations && typeof importedConfig.trackAnnotations === 'object') {
      if (!currentState.trackAnnotations || typeof currentState.trackAnnotations !== 'object') {
        currentState.trackAnnotations = {};
      }
      for (const [key, ann] of Object.entries(importedConfig.trackAnnotations)) {
        if (ann && typeof ann === 'object') {
          currentState.trackAnnotations[key] = normalizeTrackAnnotation(ann);
          restoredAnnotationsCount++;
        }
      }
    }

    let appliedSettingsCount = 0;
    if (importedConfig.settings && typeof importedConfig.settings === 'object') {
      const s = importedConfig.settings;
      if (s.crossfadeSeconds !== undefined) { currentState.crossfadeSeconds = Number(s.crossfadeSeconds); appliedSettingsCount++; }
      if (s.crossfadeCurve !== undefined) { currentState.crossfadeCurve = s.crossfadeCurve; appliedSettingsCount++; }
      if (s.autoEqProfile !== undefined) { currentState.autoEqProfile = s.autoEqProfile; appliedSettingsCount++; }
      if (s.visualizerTheme !== undefined) { currentState.visualizerTheme = s.visualizerTheme; appliedSettingsCount++; }
      if (s.visualizerMode !== undefined) { currentState.visualizerMode = s.visualizerMode; appliedSettingsCount++; }
      if (s.visualizerStrobeEnabled !== undefined) { currentState.visualizerStrobeEnabled = Boolean(s.visualizerStrobeEnabled); appliedSettingsCount++; }
      if (s.ambientStageMode !== undefined) { currentState.ambientStageMode = s.ambientStageMode; appliedSettingsCount++; }
      if (s.limiterMode !== undefined) { currentState.limiterMode = s.limiterMode; appliedSettingsCount++; }
      if (s.roomAcousticProfile !== undefined) { currentState.roomAcousticProfile = s.roomAcousticProfile; appliedSettingsCount++; }
      if (s.roomAcousticWet !== undefined) { currentState.roomAcousticWet = Number(s.roomAcousticWet); appliedSettingsCount++; }
      if (s.toneBass !== undefined) { currentState.toneBass = Number(s.toneBass); appliedSettingsCount++; }
      if (s.toneTreble !== undefined) { currentState.toneTreble = Number(s.toneTreble); appliedSettingsCount++; }
      if (s.stereoBalance !== undefined) { currentState.stereoBalance = Number(s.stereoBalance); appliedSettingsCount++; }
      if (s.crossfeed !== undefined) { currentState.crossfeed = Number(s.crossfeed); appliedSettingsCount++; }
      if (s.replayGainEnabled !== undefined) { currentState.replayGainEnabled = Boolean(s.replayGainEnabled); appliedSettingsCount++; }
      if (s.subBassPunchProfile !== undefined) { currentState.subBassPunchProfile = s.subBassPunchProfile; appliedSettingsCount++; }
      if (s.subBassPunchIntensity !== undefined) { currentState.subBassPunchIntensity = Number(s.subBassPunchIntensity); appliedSettingsCount++; }
      if (s.tubeEmulationProfile !== undefined) { currentState.tubeEmulationProfile = s.tubeEmulationProfile; appliedSettingsCount++; }
      if (s.dsdUltrasonicFilter !== undefined) { currentState.dsdUltrasonicFilter = s.dsdUltrasonicFilter; appliedSettingsCount++; }
      if (s.subBassPhaseProfile !== undefined) { currentState.subBassPhaseProfile = s.subBassPhaseProfile; appliedSettingsCount++; }
    }

    return {
      restoredFavoritesCount,
      restoredPlaylistsCount,
      restoredRatingsCount,
      restoredAnnotationsCount,
      appliedSettingsCount
    };
  }

  // Pha C — Hệ Thống Ghi Chú Bản Thu & Quản Lý Metadata Âm Nhạc Cá Nhân Hóa (Per-Track Audiophile Liner Notes & Custom Annotations)
  function buildTrackAnnotationKey(track) {
    if (!track) return 'unknown-track';
    if (typeof track === 'string') return track.trim() || 'unknown-track';
    if (track.id !== undefined && track.id !== null && String(track.id).trim() !== '') {
      return String(track.id).trim();
    }
    const artist = (track.artist || '').trim().toLowerCase();
    const album = (track.album || '').trim().toLowerCase();
    const title = (track.title || track.name || '').trim().toLowerCase();
    if (artist || album || title) {
      return `${artist} - ${album} - ${title}`;
    }
    return 'unknown-track';
  }

  function normalizeTrackAnnotation(rawAnnotation) {
    if (!rawAnnotation || typeof rawAnnotation !== 'object') {
      return {
        notes: '',
        gearRecommendation: '',
        masteringDetails: '',
        audiophileScore: 0,
        moodTags: [],
        personalRating: 0,
        venueYear: '',
        updatedAt: new Date().toISOString()
      };
    }

    const notes = typeof rawAnnotation.notes === 'string' ? rawAnnotation.notes.trim() : '';
    const gearRecommendation = typeof rawAnnotation.gearRecommendation === 'string' ? rawAnnotation.gearRecommendation.trim() : '';
    const masteringDetails = typeof rawAnnotation.masteringDetails === 'string' ? rawAnnotation.masteringDetails.trim() : '';
    const venueYear = typeof rawAnnotation.venueYear === 'string' ? rawAnnotation.venueYear.trim() : '';

    let audiophileScore = Number(rawAnnotation.audiophileScore);
    if (!Number.isFinite(audiophileScore) || audiophileScore < 0) audiophileScore = 0;
    if (audiophileScore > 100) audiophileScore = 100;
    audiophileScore = Math.round(audiophileScore);

    let personalRating = Number(rawAnnotation.personalRating);
    if (!Number.isFinite(personalRating) || personalRating < 0) personalRating = 0;
    if (personalRating > 5) personalRating = 5;
    personalRating = Math.round(personalRating * 2) / 2;

    let moodTags = [];
    if (Array.isArray(rawAnnotation.moodTags)) {
      const set = new Set();
      for (const tag of rawAnnotation.moodTags) {
        if (typeof tag === 'string' && tag.trim()) {
          set.add(tag.trim().toLowerCase());
        }
      }
      moodTags = Array.from(set);
    } else if (typeof rawAnnotation.moodTags === 'string') {
      moodTags = rawAnnotation.moodTags
        .split(/[,;\s]+/)
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      moodTags = Array.from(new Set(moodTags));
    }

    let updatedAt = rawAnnotation.updatedAt;
    if (typeof updatedAt !== 'string' || isNaN(Date.parse(updatedAt))) {
      updatedAt = new Date().toISOString();
    }

    return {
      notes,
      gearRecommendation,
      masteringDetails,
      audiophileScore,
      moodTags,
      personalRating,
      venueYear,
      updatedAt
    };
  }

  function formatAnnotationSummary(annotation) {
    if (!annotation || typeof annotation !== 'object') {
      return 'Chưa có ghi chú';
    }
    const normalized = normalizeTrackAnnotation(annotation);
    const parts = [];

    if (normalized.personalRating > 0) {
      parts.push(`⭐ ${normalized.personalRating}/5`);
    }
    if (normalized.audiophileScore > 0) {
      parts.push(`🎯 ${normalized.audiophileScore}/100`);
    }
    if (normalized.gearRecommendation) {
      parts.push(`🎧 ${normalized.gearRecommendation}`);
    }
    if (normalized.masteringDetails) {
      parts.push(`💽 ${normalized.masteringDetails}`);
    }
    if (normalized.moodTags && normalized.moodTags.length > 0) {
      parts.push(`🏷️ ${normalized.moodTags.slice(0, 3).join(', ')}`);
    }
    if (normalized.venueYear) {
      parts.push(`🏛️ ${normalized.venueYear}`);
    }
    if (normalized.notes && parts.length === 0) {
      const truncated = normalized.notes.length > 40 ? normalized.notes.slice(0, 37) + '...' : normalized.notes;
      parts.push(`📝 ${truncated}`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'Chưa có ghi chú';
  }

  function mergeTrackAnnotations(existingMap, incomingMap) {
    const merged = {};
    let addedCount = 0;
    let updatedCount = 0;

    if (existingMap && typeof existingMap === 'object') {
      for (const [key, val] of Object.entries(existingMap)) {
        if (val && typeof val === 'object') {
          merged[key] = normalizeTrackAnnotation(val);
        }
      }
    }

    if (incomingMap && typeof incomingMap === 'object') {
      for (const [key, val] of Object.entries(incomingMap)) {
        if (!val || typeof val !== 'object') continue;
        const normalizedIncoming = normalizeTrackAnnotation(val);
        if (!merged[key]) {
          merged[key] = normalizedIncoming;
          addedCount++;
        } else {
          const existingTime = Date.parse(merged[key].updatedAt) || 0;
          const incomingTime = Date.parse(normalizedIncoming.updatedAt) || 0;
          if (incomingTime >= existingTime) {
            merged[key] = normalizedIncoming;
            updatedCount++;
          }
        }
      }
    }

    return {
      merged,
      addedCount,
      updatedCount,
      totalCount: Object.keys(merged).length
    };
  }

  function filterTracksByAnnotationQuery(tracks, annotationsMap, query) {
    if (!Array.isArray(tracks)) return [];
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [...tracks];
    }

    const q = query.trim().toLowerCase();
    const map = annotationsMap && typeof annotationsMap === 'object' ? annotationsMap : {};
    const scoreMatch = q.match(/^score\s*([><]=?|=)\s*(\d+)$/);

    return tracks.filter(track => {
      if (!track) return false;
      const key = buildTrackAnnotationKey(track);
      const ann = map[key] || map[track.id];
      if (!ann) return false;

      if (scoreMatch) {
        const op = scoreMatch[1];
        const targetScore = Number(scoreMatch[2]);
        const currentScore = Number(ann.audiophileScore) || 0;
        if (op === '>=') return currentScore >= targetScore;
        if (op === '>') return currentScore > targetScore;
        if (op === '<=') return currentScore <= targetScore;
        if (op === '<') return currentScore < targetScore;
        if (op === '=') return currentScore === targetScore;
      }

      const notes = (ann.notes || '').toLowerCase();
      const gear = (ann.gearRecommendation || '').toLowerCase();
      const mastering = (ann.masteringDetails || '').toLowerCase();
      const venue = (ann.venueYear || '').toLowerCase();
      const tags = Array.isArray(ann.moodTags) ? ann.moodTags.join(' ').toLowerCase() : '';

      return notes.includes(q) || gear.includes(q) || mastering.includes(q) || venue.includes(q) || tags.includes(q);
    });
  }

  function calculateAudioMemoryFootprint(activeTracksCount, cachedSlicesCount, options = {}) {
    const tCount = Math.max(0, Number(activeTracksCount) || 0);
    const cCount = Math.max(0, Number(cachedSlicesCount) || 0);
    const avgTrackBytes = Number(options.avgTrackBytes) || (10 * 1024 * 1024); // 10MB approx
    const sliceBytes = Number(options.sliceBytes) || (1024 * 1024); // 1MB per slice

    const totalEstimatedBytes = (tCount * avgTrackBytes) + (cCount * sliceBytes);
    const totalMb = Math.round((totalEstimatedBytes / (1024 * 1024)) * 10) / 10;

    let pressureTier = 'optimal';
    if (totalMb > 160) {
      pressureTier = 'critical';
    } else if (totalMb > 70) {
      pressureTier = 'elevated';
    }

    return {
      activeTracksCount: tCount,
      cachedSlicesCount: cCount,
      totalMb,
      pressureTier,
      isLowPressure: pressureTier === 'optimal'
    };
  }

  // Pha A — Động Cơ Mô Phỏng Không Gian Phòng & Xung Lực Tai Nghe Audiophile (Room Acoustics & IR Convolver Engine)
  const ROOM_ACOUSTIC_PROFILES = {
    bypass: {
      id: 'bypass',
      name: 'Bypass (Trực tiếp)',
      badge: 'BIT-PERFECT',
      rt60: 0,
      preDelayMs: 0,
      damping: 1.0,
      description: 'Âm thanh nguyên bản không gian phòng, giữ nguyên Bit-Perfect'
    },
    studio: {
      id: 'studio',
      name: 'Studio Control Room',
      badge: 'STUDIO',
      rt60: 0.28,
      preDelayMs: 8,
      damping: 0.75,
      description: 'Phòng thu tiêu âm chuẩn studio, âm hình cận cảnh sắc nét và kiểm soát phân rã chặt chẽ'
    },
    jazz_club: {
      id: 'jazz_club',
      name: 'Jazz Club Intimate',
      badge: 'JAZZ CLUB',
      rt60: 0.72,
      preDelayMs: 14,
      damping: 0.55,
      description: 'Không gian ấm cúng câu lạc bộ nhạc Jazz, âm thanh mộc mạc giàu nhạc tính'
    },
    concert_hall: {
      id: 'concert_hall',
      name: 'Symphony Concert Hall',
      badge: 'HALL',
      rt60: 1.85,
      preDelayMs: 24,
      damping: 0.35,
      description: 'Thính phòng giao hưởng tráng lệ, không gian âm thanh 3D sâu thẳm và âm hình mở rộng'
    },
    cathedral: {
      id: 'cathedral',
      name: 'Sacred Cathedral',
      badge: 'CATHEDRAL',
      rt60: 3.20,
      preDelayMs: 36,
      damping: 0.20,
      description: 'Đại giáo đường nguy nga, trường phản xạ âm thanh dày đặc vang vọng đa tầng'
    },
    vinyl_lounge: {
      id: 'vinyl_lounge',
      name: 'Audiophile Vinyl Lounge',
      badge: 'VINYL',
      rt60: 0.45,
      preDelayMs: 10,
      damping: 0.65,
      description: 'Phòng nghe đĩa than lót thảm len và gỗ sồi, tán âm ấm áp, giảm thiểu độ chói gắt'
    },
    chamber_music: {
      id: 'chamber_music',
      name: 'Chamber Music Salon',
      badge: 'CHAMBER',
      rt60: 1.25,
      preDelayMs: 18,
      damping: 0.45,
      description: 'Salon thính phòng bán cổ điển cho nhạc hòa tấu tứ tấu đàn dây và piano'
    }
  };

  function getRoomAcousticProfile(key) {
    if (!key || typeof key !== 'string') return ROOM_ACOUSTIC_PROFILES.bypass;
    return ROOM_ACOUSTIC_PROFILES[key] || ROOM_ACOUSTIC_PROFILES.bypass;
  }

  function listRoomAcousticProfiles() {
    return Object.values(ROOM_ACOUSTIC_PROFILES);
  }

  function clampAcousticWet(value, fallback = 0.2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  }

  function calculateAcousticWetDry(profileKeyOrWet, wetLevel) {
    let profileKey = 'studio';
    let wet = 0.2;
    if (typeof profileKeyOrWet === 'string') {
      profileKey = profileKeyOrWet;
      wet = clampAcousticWet(wetLevel, 0.2);
    } else {
      wet = clampAcousticWet(profileKeyOrWet, 0.2);
    }
    if (profileKey === 'bypass') {
      return { dryGain: 1, wetGain: 0, wetLevel: 0 };
    }
    const angle = wet * (Math.PI / 2);
    const dryGain = Math.cos(angle);
    const wetGain = Math.sin(angle);
    return { dryGain, wetGain, wetLevel: wet };
  }

  function formatAcousticSummary(profileKey, wetLevel) {
    const profile = getRoomAcousticProfile(profileKey);
    if (profile.id === 'bypass') return 'Trực tiếp (Bit-Perfect)';
    const wetPct = Math.round(clampAcousticWet(wetLevel, 0.2) * 100);
    return `${profile.name} · ${wetPct}% Ướt · RT60 ${profile.rt60}s`;
  }

  function generateImpulseResponse(profileKey, sampleRate = 44100, options = {}) {
    const profile = getRoomAcousticProfile(profileKey);
    if (profile.id === 'bypass') return null;

    const rate = Math.max(8000, Math.min(192000, Number(sampleRate) || 44100));
    const rt60 = profile.rt60 || 0.5;
    const preDelaySamples = Math.round(((profile.preDelayMs || 10) / 1000) * rate);
    const lengthSamples = Math.min(Math.round(rt60 * rate * 1.2), rate * 5);
    const totalSamples = preDelaySamples + lengthSamples;

    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    const tauSamples = (rt60 * rate) / 6.907755;
    const damping = profile.damping || 0.5;

    const earlyReflEnd = Math.min(lengthSamples, Math.round(0.08 * rate));
    const seed = Number(options.seed) || 1337;
    let rnd = seed;
    const nextRandom = () => {
      rnd = (rnd * 1664525 + 1013904223) % 4294967296;
      return rnd / 4294967296;
    };

    let leftLp = 0;
    let rightLp = 0;
    const lpAlpha = Math.max(0.1, Math.min(0.95, 1 - damping * 0.7));

    for (let i = 0; i < lengthSamples; i++) {
      const idx = preDelaySamples + i;
      const decay = Math.exp(-i / tauSamples);

      const rawLeft = (nextRandom() * 2 - 1) * decay;
      const rawRight = (nextRandom() * 2 - 1) * decay;

      leftLp = leftLp + lpAlpha * (rawLeft - leftLp);
      rightLp = rightLp + lpAlpha * (rawRight - rightLp);

      let earlyBoostL = 1.0;
      let earlyBoostR = 1.0;
      if (i < earlyReflEnd && i % 47 === 0) earlyBoostL += 2.2;
      if (i < earlyReflEnd && i % 53 === 0) earlyBoostR += 2.2;

      left[idx] = leftLp * earlyBoostL;
      right[idx] = rightLp * earlyBoostR;
    }

    let maxPeak = 0;
    for (let i = 0; i < totalSamples; i++) {
      const absL = Math.abs(left[i]);
      const absR = Math.abs(right[i]);
      if (absL > maxPeak) maxPeak = absL;
      if (absR > maxPeak) maxPeak = absR;
    }
    if (maxPeak > 0) {
      const scale = 0.7 / maxPeak;
      for (let i = 0; i < totalSamples; i++) {
        left[i] *= scale;
        right[i] *= scale;
      }
    }

    return {
      sampleRate: rate,
      channels: 2,
      length: totalSamples,
      duration: totalSamples / rate,
      left,
      right
    };
  }

  function calculateAdaptiveRoomWetDry(roomProfile, trackEnergy, userWet = 0.2) {
    const profile = getRoomAcousticProfile(typeof roomProfile === 'string' ? roomProfile : (roomProfile?.id || 'bypass'));
    const baseWet = clampAcousticWet(userWet, 0.2);
    if (profile.id === 'bypass' || baseWet <= 0) {
      return { wet: 0, dry: 1.0, wetGain: 0, dryGain: 1.0, rawWet: 0, profile: profile.id, isAdapted: false };
    }

    let adaptiveMultiplier = 1.0;
    if (trackEnergy && typeof trackEnergy === 'object') {
      const bassEnergy = Number(trackEnergy.bass) || 0;
      const crestFactor = Number(trackEnergy.crestFactor) || 10;
      if (bassEnergy > 0.75) {
        adaptiveMultiplier *= 0.85;
      }
      if (crestFactor >= 14) {
        adaptiveMultiplier = Math.min(1.15, adaptiveMultiplier * 1.1);
      }
    }

    const adaptedWet = clampAcousticWet(baseWet * adaptiveMultiplier, baseWet);
    const gains = calculateAcousticWetDry(profile.id, adaptedWet);
    return {
      wet: gains.wetGain,
      dry: gains.dryGain,
      wetGain: gains.wetGain,
      dryGain: gains.dryGain,
      rawWet: Number(adaptedWet.toFixed(3)),
      profile: profile.id,
      isAdapted: Math.abs(adaptedWet - baseWet) > 0.005
    };
  }

  function scheduleMultiTrackPreload(queue, currentIndex, options = {}) {
    if (!Array.isArray(queue) || queue.length === 0 || typeof currentIndex !== 'number' || currentIndex < 0 || currentIndex >= queue.length) {
      return {
        pipeline: [],
        totalEstimatedBytes: 0,
        networkTier: 'offline',
        allowedConcurrency: 0,
        timestamp: Date.now()
      };
    }

    const networkType = String(options.networkType || '4g').toLowerCase();
    const isSaveData = Boolean(options.saveData);
    const lookaheadCount = Math.max(1, Math.min(5, Number(options.lookaheadCount) || 3));
    const defaultSliceBytes = Number(options.sliceBytes) || (1024 * 1024);
    const dsdSliceBytes = Number(options.dsdSliceBytes) || (3 * 1024 * 1024);

    let networkTier = 'high-bandwidth';
    let allowedConcurrency = 2;

    if (isSaveData) {
      networkTier = 'constrained';
      allowedConcurrency = 1;
    } else if (networkType === 'slow-2g' || networkType === '2g') {
      networkTier = 'low-bandwidth';
      allowedConcurrency = 1;
    } else if (networkType === '3g') {
      networkTier = 'standard';
      allowedConcurrency = 1;
    } else if (networkType === 'offline') {
      networkTier = 'offline';
      allowedConcurrency = 0;
    } else {
      networkTier = 'high-bandwidth';
      allowedConcurrency = 2;
    }

    const pipeline = [];
    let totalEstimatedBytes = 0;

    for (let offset = 1; offset <= lookaheadCount; offset++) {
      const targetIndex = currentIndex + offset;
      if (targetIndex >= queue.length) break;
      const track = queue[targetIndex];
      if (!track) continue;

      const trackId = String(track.id || `track-${targetIndex}`);
      const title = String(track.title || 'Unknown');
      const artist = String(track.artist || UNKNOWN_ARTIST);
      const isDsd = Boolean(track.isDsd || (track.name && /\.(dsf|dff)$/i.test(track.name)));

      let priority = 'low';
      let preloadType = 'metadata';
      let estimatedBytes = 8192;
      let reason = '';

      if (networkTier === 'offline') {
        preloadType = 'skip';
        estimatedBytes = 0;
        reason = 'Ngoại tuyến, không thể tải trước mạng';
      } else if (isSaveData) {
        if (offset === 1) {
          priority = 'immediate';
          preloadType = 'metadata';
          estimatedBytes = 8192;
          reason = 'Chế độ tiết kiệm dữ liệu: chỉ nạp trước siêu dữ liệu bài kế';
        } else {
          preloadType = 'skip';
          estimatedBytes = 0;
          reason = 'Chế độ tiết kiệm dữ liệu: bỏ qua bài xa hơn';
        }
      } else if (networkTier === 'low-bandwidth') {
        if (offset === 1) {
          priority = 'immediate';
          preloadType = 'first-slice';
          estimatedBytes = isDsd ? dsdSliceBytes : defaultSliceBytes;
          reason = 'Băng thông 2G: chỉ nạp lát đầu bài kế tiếp';
        } else if (offset === 2) {
          priority = 'medium';
          preloadType = 'metadata';
          estimatedBytes = 8192;
          reason = 'Băng thông 2G: nạp trước siêu dữ liệu bài +2';
        } else {
          preloadType = 'skip';
          estimatedBytes = 0;
          reason = 'Băng thông thấp: hạn chế tải trước';
        }
      } else if (networkTier === 'standard') {
        if (offset === 1) {
          priority = 'immediate';
          preloadType = isDsd ? 'first-slice' : (track.file && track.file.size ? 'full' : 'first-slice');
          estimatedBytes = isDsd ? dsdSliceBytes : (track.file && track.file.size ? track.file.size : defaultSliceBytes * 4);
          reason = 'Băng thông 3G: nạp bài kế tiếp chuẩn bị chuyển deck';
        } else if (offset === 2) {
          priority = 'high';
          preloadType = 'first-slice';
          estimatedBytes = isDsd ? dsdSliceBytes : defaultSliceBytes;
          reason = 'Băng thông 3G: nạp đệm lát đầu bài +2';
        } else {
          priority = 'medium';
          preloadType = 'metadata';
          estimatedBytes = 16384;
          reason = 'Băng thông 3G: nạp siêu dữ liệu & bìa bài +3';
        }
      } else {
        if (offset === 1) {
          priority = 'immediate';
          preloadType = isDsd ? 'first-slice' : 'full';
          estimatedBytes = (track.file && track.file.size) || (isDsd ? dsdSliceBytes : 25 * 1024 * 1024);
          reason = 'Băng thông cao: nạp đầy đủ bài kế tiếp cho gapless 0ms';
        } else if (offset === 2) {
          priority = 'high';
          preloadType = 'first-slice';
          estimatedBytes = isDsd ? dsdSliceBytes : defaultSliceBytes;
          reason = 'Băng thông cao: nạp trước lát đầu bài +2 vào IndexedDB';
        } else if (offset === 3) {
          priority = 'medium';
          preloadType = 'metadata';
          estimatedBytes = 32768;
          reason = 'Băng thông cao: nạp trước siêu dữ liệu & lời nhạc bài +3';
        } else {
          priority = 'low';
          preloadType = 'metadata';
          estimatedBytes = 8192;
          reason = 'Nạp siêu dữ liệu nhìn trước';
        }
      }

      totalEstimatedBytes += estimatedBytes;
      pipeline.push({
        trackIndex: targetIndex,
        trackId,
        title,
        artist,
        offset,
        priority,
        preloadType,
        estimatedBytes,
        reason
      });
    }

    return {
      pipeline,
      totalEstimatedBytes,
      networkTier,
      allowedConcurrency,
      timestamp: Date.now()
    };
  }

  function defragmentCacheDatabase(entries, activeTracks, options = {}) {
    const rawEntries = Array.isArray(entries) ? entries : [];
    const tracks = Array.isArray(activeTracks) ? activeTracks : [];
    const maxAgeMs = Number(options.maxAgeMs) || (7 * 24 * 60 * 60 * 1000);
    const now = Number(options.now) || Date.now();

    const activeTrackIds = new Set();
    const activeUrls = new Set();
    const activeTitles = new Set();

    for (const t of tracks) {
      if (!t) continue;
      if (t.id) activeTrackIds.add(String(t.id));
      if (t.url) activeUrls.add(String(t.url));
      if (t.title) activeTitles.add(metadataKey(t.title));
    }

    const orphanedKeys = [];
    const validEntries = [];
    let reclaimableBytes = 0;
    let validBytes = 0;

    for (const entry of rawEntries) {
      if (!entry) continue;
      const key = String(entry.key || entry.id || '');
      const size = Number(entry.size || entry.byteLength || (entry.blob && entry.blob.size) || 0);
      const timestamp = Number(entry.timestamp || entry.cachedAt || 0);

      const isExpired = timestamp > 0 && (now - timestamp > maxAgeMs);
      let isReferenced = false;

      if (entry.trackId && activeTrackIds.has(String(entry.trackId))) {
        isReferenced = true;
      } else if (entry.url && activeUrls.has(String(entry.url))) {
        isReferenced = true;
      } else if (key && (activeTrackIds.has(key) || activeUrls.has(key))) {
        isReferenced = true;
      } else if (entry.title && activeTitles.has(metadataKey(entry.title))) {
        isReferenced = true;
      }

      if (!isReferenced || isExpired) {
        orphanedKeys.push(key);
        reclaimableBytes += size;
      } else {
        validEntries.push(entry);
        validBytes += size;
      }
    }

    const totalEntries = rawEntries.length;
    const reclaimableCount = orphanedKeys.length;
    const validCount = validEntries.length;
    const fragmentationRatio = totalEntries > 0 ? Number((reclaimableCount / totalEntries).toFixed(4)) : 0;
    const integrityScore = totalEntries > 0 ? Math.round((validCount / totalEntries) * 100) : 100;

    const formattedReclaim = formatStorageBytes(reclaimableBytes);
    let summary = '';
    if (reclaimableCount > 0) {
      summary = `Phát hiện ${reclaimableCount} lát rác (${formattedReclaim.formatted}), độ toàn vẹn ${integrityScore}%`;
    } else {
      summary = `Bộ đệm IndexedDB tối ưu (độ toàn vẹn ${integrityScore}%, ${validCount} mục hợp lệ)`;
    }

    return {
      orphanedKeys,
      reclaimableCount,
      reclaimableBytes,
      validCount,
      validBytes,
      totalEntries,
      fragmentationRatio,
      integrityScore,
      summary
    };
  }

  function calculatePreloadReadiness(nextTrack, standbyAudio, options = {}) {
    if (!nextTrack) {
      return {
        readinessScore: 0,
        status: 'unbuffered',
        gaplessFeasible: false,
        bufferedSeconds: 0,
        label: 'Không có bài chờ'
      };
    }

    let bufferedSeconds = 0;
    try {
      if (standbyAudio && standbyAudio.buffered && standbyAudio.buffered.length > 0) {
        const end = standbyAudio.buffered.end(standbyAudio.buffered.length - 1);
        const start = standbyAudio.buffered.start(0);
        bufferedSeconds = Math.max(0, end - start);
      }
    } catch (_) {
      bufferedSeconds = 0;
    }
    if (typeof options.lookaheadSeconds === 'number' && options.lookaheadSeconds > bufferedSeconds) {
      bufferedSeconds = options.lookaheadSeconds;
    }

    const readyState = standbyAudio ? (Number(standbyAudio.readyState) || 0) : 0;
    const hasCachedBlob = Boolean(nextTrack.file || nextTrack.blob || nextTrack.firstSliceCached || options.firstSliceCached);

    let score = 0;
    if (hasCachedBlob) score += 40;

    if (readyState >= 4) {
      score += 40;
    } else if (readyState === 3) {
      score += 30;
    } else if (readyState === 2) {
      score += 15;
    } else if (readyState === 1) {
      score += 5;
    }

    if (bufferedSeconds >= 15) {
      score += 20;
    } else if (bufferedSeconds >= 10) {
      score += 15;
    } else if (bufferedSeconds >= 5) {
      score += 10;
    } else if (bufferedSeconds > 0) {
      score += 5;
    }

    if (options.isOffline && !hasCachedBlob) {
      score = Math.max(0, score - 50);
    }
    if (options.networkType === '2g' || options.networkType === 'slow-2g') {
      score = Math.max(0, score - 10);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let status = 'unbuffered';
    let label = 'Chưa nạp đệm';

    if (score >= 85) {
      status = 'instant';
      label = `Sẵn sàng phát 0 ms (${score}%)`;
    } else if (score >= 50) {
      status = 'buffered';
      label = `Đã đệm đủ (${bufferedSeconds.toFixed(1)}s)`;
    } else if (score >= 20) {
      status = 'streaming';
      label = `Đang nạp luồng (${score}%)`;
    } else {
      status = 'unbuffered';
      label = 'Chưa nạp đệm';
    }

    const gaplessFeasible = score >= 70;

    return {
      readinessScore: score,
      status,
      gaplessFeasible,
      bufferedSeconds,
      label
    };
  }

  function formatPreloadReadinessBadge(readiness) {
    if (!readiness || typeof readiness !== 'object') {
      return {
        text: 'Chưa đệm',
        colorClass: 'text-zinc-400 bg-zinc-800/80 border-zinc-700',
        isReady: false
      };
    }

    const status = readiness.status || 'unbuffered';
    const isReady = Boolean(readiness.gaplessFeasible || status === 'instant');

    switch (status) {
      case 'instant':
        return {
          text: `Gapless: ${readiness.label || 'Sẵn sàng 100%'}`,
          colorClass: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
          isReady: true
        };
      case 'buffered':
        return {
          text: `Đệm tốt: ${readiness.label || 'Đã nạp'}`,
          colorClass: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/30',
          isReady: true
        };
      case 'streaming':
        return {
          text: `Đang nạp: ${readiness.label || 'Đang luồng'}`,
          colorClass: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
          isReady: false
        };
      case 'unbuffered':
      default:
        return {
          text: 'Chưa đệm',
          colorClass: 'text-zinc-400 bg-zinc-800/80 border-zinc-700',
          isReady: false
        };
    }
  }

  // ── Pha E — Album Sequential Playback vs Songs Random Shuffle ──

  /**
   * Resolves the album playback queue when a track inside an album is clicked.
   * Returns currentTrack, clickedIndex, and remainingTracks strictly after clickedIndex
   * in order from top to bottom.
   *
   * @param {string|number|object} clickedTrackId - Identifier or track object of the clicked track
   * @param {Array<object>} albumTracks - Array of album tracks in sequential order
   * @param {object} [options={}] - Optional configurations
   * @returns {{ currentTrack: object|null, clickedIndex: number, remainingTracks: Array<object>, remainingTrackIds: Array<string|number> }}
   */
  function resolveAlbumPlaybackQueue(clickedTrackId, albumTracks, options = {}) {
    const list = Array.isArray(albumTracks) ? albumTracks : [];
    if (!list.length) {
      return {
        currentTrack: null,
        clickedIndex: -1,
        remainingTracks: [],
        remainingTrackIds: []
      };
    }

    const targetId = clickedTrackId && typeof clickedTrackId === 'object'
      ? (clickedTrackId.id ?? clickedTrackId._id ?? clickedTrackId.trackId ?? clickedTrackId)
      : clickedTrackId;

    const clickedIndex = list.findIndex(track => {
      if (!track) return false;
      const tid = typeof track === 'object'
        ? (track.id ?? track._id ?? track.trackId ?? track)
        : track;
      return tid != null && targetId != null && String(tid) === String(targetId);
    });

    if (clickedIndex < 0) {
      return {
        currentTrack: null,
        clickedIndex: -1,
        remainingTracks: [],
        remainingTrackIds: []
      };
    }

    const currentTrack = list[clickedIndex] || null;
    const remainingTracks = list.slice(clickedIndex + 1);
    const remainingTrackIds = remainingTracks.map(t => {
      if (!t) return null;
      return typeof t === 'object' ? (t.id ?? t._id ?? t.trackId ?? t) : t;
    });

    return {
      currentTrack,
      clickedIndex,
      remainingTracks,
      remainingTrackIds
    };
  }

  /**
   * Enforces sequential progression in album track order.
   * direction > 0 moves downwards (forward), direction < 0 moves upwards (backward).
   * Handles boundaries and repeat:
   *   repeat: 0 (stops at end)
   *   repeat: 1 (loops album)
   *   repeat: 2 (repeats current)
   *
   * @param {string|number|object} currentTrackId - Current track ID or object
   * @param {Array<object>} tracks - Sequential album tracks
   * @param {number} [direction=1] - Direction (+1 forward, -1 backward)
   * @param {object|number} [options={}] - Options object or repeat number
   * @returns {{ track: object|null, index: number, isEnd: boolean, isStart: boolean }}
   */
  function resolveNextSequentialTrack(currentTrackId, tracks, direction = 1, options = {}) {
    const list = Array.isArray(tracks) ? tracks : [];
    if (!list.length) {
      return {
        track: null,
        index: -1,
        isEnd: true,
        isStart: true
      };
    }

    const repeatMode = typeof options === 'number'
      ? options
      : Number(options?.repeat ?? 0);
    const repeat = Number.isFinite(repeatMode) ? repeatMode : 0;
    const dir = Number(direction) >= 0 ? 1 : -1;
    const clamp = Boolean(options && typeof options === 'object' && options.clamp);

    const targetId = currentTrackId && typeof currentTrackId === 'object'
      ? (currentTrackId.id ?? currentTrackId._id ?? currentTrackId.trackId ?? currentTrackId)
      : currentTrackId;

    const currentIndex = list.findIndex(track => {
      if (!track) return false;
      const tid = typeof track === 'object'
        ? (track.id ?? track._id ?? track.trackId ?? track)
        : track;
      return tid != null && targetId != null && String(tid) === String(targetId);
    });

    // repeat: 2 -> repeats current track
    if (repeat === 2) {
      const idx = currentIndex >= 0 ? currentIndex : 0;
      return {
        track: list[idx] || null,
        index: idx,
        isEnd: false,
        isStart: false
      };
    }

    // Current track not found in album tracks list
    if (currentIndex < 0) {
      const fallbackIdx = dir > 0 ? 0 : list.length - 1;
      return {
        track: list[fallbackIdx] || null,
        index: fallbackIdx,
        isEnd: dir > 0 ? list.length <= 1 : false,
        isStart: dir < 0 ? list.length <= 1 : true
      };
    }

    const nextIndex = currentIndex + dir;

    // Moving forward past end
    if (dir > 0 && nextIndex >= list.length) {
      if (repeat === 1) {
        // repeat: 1 -> loops album
        return {
          track: list[0] || null,
          index: 0,
          isEnd: false,
          isStart: false
        };
      }
      // repeat: 0 -> stops at end
      return {
        track: clamp ? list[list.length - 1] : null,
        index: clamp ? list.length - 1 : -1,
        isEnd: true,
        isStart: false
      };
    }

    // Moving backward past start
    if (dir < 0 && nextIndex < 0) {
      if (repeat === 1) {
        // repeat: 1 -> loops album
        const lastIdx = list.length - 1;
        return {
          track: list[lastIdx] || null,
          index: lastIdx,
          isEnd: false,
          isStart: false
        };
      }
      // repeat: 0 -> stops at start
      return {
        track: clamp ? list[0] : null,
        index: clamp ? 0 : -1,
        isEnd: false,
        isStart: true
      };
    }

    // Normal progression within bounds
    return {
      track: list[nextIndex] || null,
      index: nextIndex,
      isEnd: nextIndex === list.length - 1,
      isStart: nextIndex === 0
    };
  }

  /**
   * Returns true if playbackContext indicates sequential album playback should be enforced,
   * false otherwise (e.g. for songs list, playlist, or random shuffle).
   *
   * @param {object|null} playbackContext - Current playback context
   * @returns {boolean}
   */
  function shouldEnforceSequentialPlayback(playbackContext) {
    if (!playbackContext || typeof playbackContext !== 'object') return false;
    const type = String(playbackContext.type || '').trim().toLowerCase();
    return type === 'album';
  }

  /**
   * Formats playback context summary string.
   * e.g. "Album [Name] · Phát tuần tự bài 2/10" or "Danh sách bài hát · Tự do"
   *
   * @param {object|null} playbackContext - Current playback context
   * @param {object|null} [currentTrack=null] - Currently playing track
   * @param {object} [options={}] - Options (e.g. useBrackets)
   * @returns {string}
   */
  function formatPlaybackContextSummary(playbackContext, currentTrack = null, options = {}) {
    if (!playbackContext || typeof playbackContext !== 'object' || !shouldEnforceSequentialPlayback(playbackContext)) {
      if (playbackContext && typeof playbackContext === 'object' && playbackContext.name && playbackContext.type && playbackContext.type !== 'songs') {
        return `${playbackContext.name} · Tự do`;
      }
      return 'Danh sách bài hát · Tự do';
    }

    // Context is an album
    const rawName = playbackContext.name || playbackContext.album || (currentTrack && (currentTrack.album || currentTrack.albumName)) || '';
    const albumName = String(rawName).trim();
    let nameLabel = 'Album';
    if (albumName) {
      if (options.useBrackets || playbackContext.useBrackets) {
        nameLabel = albumName.startsWith('[') && albumName.endsWith(']') ? `Album ${albumName}` : `Album [${albumName}]`;
      } else {
        nameLabel = `Album ${albumName}`;
      }
    }

    // Determine total tracks
    let totalTracks = 0;
    if (Array.isArray(playbackContext.tracks)) {
      totalTracks = playbackContext.tracks.length;
    } else if (playbackContext.totalTracks != null && Number.isFinite(Number(playbackContext.totalTracks))) {
      totalTracks = Number(playbackContext.totalTracks);
    } else if (playbackContext.trackCount != null && Number.isFinite(Number(playbackContext.trackCount))) {
      totalTracks = Number(playbackContext.trackCount);
    } else if (currentTrack && currentTrack.totalTracks != null && Number.isFinite(Number(currentTrack.totalTracks))) {
      totalTracks = Number(currentTrack.totalTracks);
    }

    // Determine 1-based current track sequence number
    let currentNum = 0;
    if (playbackContext.currentIndex != null && Number.isFinite(Number(playbackContext.currentIndex)) && Number(playbackContext.currentIndex) >= 0) {
      currentNum = Number(playbackContext.currentIndex) + 1;
    } else if (playbackContext.index != null && Number.isFinite(Number(playbackContext.index)) && Number(playbackContext.index) >= 0) {
      currentNum = Number(playbackContext.index) + 1;
    } else if (currentTrack) {
      if (Array.isArray(playbackContext.tracks) && playbackContext.tracks.length) {
        const targetId = typeof currentTrack === 'object'
          ? (currentTrack.id ?? currentTrack._id ?? currentTrack.trackId ?? currentTrack)
          : currentTrack;
        const idx = playbackContext.tracks.findIndex(t => {
          if (!t) return false;
          const tid = typeof t === 'object' ? (t.id ?? t._id ?? t.trackId ?? t) : t;
          return tid != null && targetId != null && String(tid) === String(targetId);
        });
        if (idx >= 0) {
          currentNum = idx + 1;
        }
      }
      if (!currentNum) {
        const trackNo = currentTrack.trackNumber ?? currentTrack.track_no ?? currentTrack.track;
        if (trackNo != null && Number.isFinite(Number(trackNo)) && Number(trackNo) > 0) {
          currentNum = Number(trackNo);
        }
      }
    }

    if (currentNum > 0 && totalTracks > 0) {
      return `${nameLabel} · Phát tuần tự bài ${currentNum}/${totalTracks}`;
    }
    if (currentNum > 0) {
      return `${nameLabel} · Phát tuần tự bài ${currentNum}`;
    }
    if (totalTracks > 0) {
      return `${nameLabel} · Phát tuần tự (${totalTracks} bài)`;
    }
    return `${nameLabel} · Phát tuần tự`;
  }

  // ── Pha C — Hệ Thống Chia Sẻ Danh Sách Phát & Đồng Bộ Hóa Đa Thiết Bị ──
  function buildShareablePlaylistPayload(playlistName, tracks, options = {}) {
    const list = Array.isArray(tracks) ? tracks : [];
    let totalDuration = 0;
    const cleanTracks = [];

    for (const t of list) {
      if (!t) continue;
      const meta = (typeof trackMetadata === 'function') ? trackMetadata(t) : t;
      const duration = Number(meta.duration || t.duration) || 0;
      totalDuration += duration;
      cleanTracks.push({
        id: String(t.id || ''),
        title: String(t.title || meta.title || t.name || 'Untitled').trim(),
        artist: String(t.artist || meta.artist || 'Unknown Artist').trim(),
        album: String(t.album || (meta.album && meta.album !== 'Unknown Album' ? meta.album : '')).trim(),
        duration: Math.round(duration),
        format: String(t.format || 'FLAC').toUpperCase(),
        sampleRate: Number(t.sampleRate) || 44100,
        bitDepth: Number(t.bitDepth) || 16
      });
    }

    const name = String(playlistName || options.name || 'Danh sách phát Nocturne').trim() || 'Danh sách phát Nocturne';
    return {
      version: 1,
      app: 'nocturne',
      type: 'playlist',
      createdAt: options.createdAt || new Date().toISOString(),
      name,
      description: String(options.description || 'Được chia sẻ từ Nocturne Audiophile Web Player').trim(),
      trackCount: cleanTracks.length,
      totalDuration: Math.round(totalDuration),
      tracks: cleanTracks
    };
  }

  function encodeShareablePlaylistLink(payload, baseUrl = '') {
    if (!payload || typeof payload !== 'object') return '';
    try {
      const jsonStr = JSON.stringify(payload);
      let base64 = '';
      if (typeof btoa === 'function') {
        base64 = btoa(unescape(encodeURIComponent(jsonStr)));
      } else if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(jsonStr, 'utf8').toString('base64');
      } else {
        base64 = encodeURIComponent(jsonStr);
      }
      const base = String(baseUrl || '').split('#')[0];
      return `${base}#playlist=${encodeURIComponent(base64)}`;
    } catch (_) {
      return '';
    }
  }

  function parseShareablePlaylistPayload(input) {
    if (!input || (typeof input !== 'string' && typeof input !== 'object')) {
      return { isValid: false, error: 'Dữ liệu danh sách phát rỗng hoặc không đúng định dạng.' };
    }

    let parsed = null;
    if (typeof input === 'object') {
      parsed = input;
    } else {
      let text = String(input).trim();
      if (text.includes('#playlist=')) {
        text = text.split('#playlist=')[1];
      } else if (text.startsWith('#playlist=')) {
        text = text.slice(10);
      }
      text = decodeURIComponent(text);

      try {
        parsed = JSON.parse(text);
      } catch (_) {
        try {
          let decoded = '';
          if (typeof atob === 'function') {
            decoded = decodeURIComponent(escape(atob(text)));
          } else if (typeof Buffer !== 'undefined') {
            decoded = Buffer.from(text, 'base64').toString('utf8');
          }
          parsed = JSON.parse(decoded);
        } catch (e) {
          return { isValid: false, error: 'Không thể giải mã gói dữ liệu playlist: ' + (e.message || e) };
        }
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return { isValid: false, error: 'Cấu trúc dữ liệu playlist không hợp lệ.' };
    }
    if (parsed.type !== 'playlist' && !Array.isArray(parsed.tracks)) {
      return { isValid: false, error: 'Dữ liệu không phải là một danh sách phát Nocturne hợp lệ.' };
    }

    const tracks = Array.isArray(parsed.tracks) ? parsed.tracks.map(t => ({
      id: String(t.id || ''),
      title: String(t.title || t.name || 'Untitled').trim(),
      artist: String(t.artist || 'Unknown Artist').trim(),
      album: String(t.album || '').trim(),
      duration: Number(t.duration) || 0,
      format: String(t.format || 'FLAC').toUpperCase(),
      sampleRate: Number(t.sampleRate) || 44100,
      bitDepth: Number(t.bitDepth) || 16
    })) : [];

    const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    return {
      isValid: true,
      playlist: {
        version: Number(parsed.version) || 1,
        app: parsed.app || 'nocturne',
        name: String(parsed.name || 'Danh sách phát chia sẻ').trim(),
        description: String(parsed.description || '').trim(),
        createdAt: parsed.createdAt || new Date().toISOString(),
        trackCount: tracks.length,
        totalDuration: Math.round(totalDuration),
        tracks
      }
    };
  }

  function matchPlaylistWithLibrary(importedTracks, libraryTracks) {
    const imported = Array.isArray(importedTracks) ? importedTracks : [];
    const library = Array.isArray(libraryTracks) ? libraryTracks : [];

    const matchedTracks = [];
    const unmatchedTracks = [];

    const norm = str => (typeof metadataKey === 'function' ? metadataKey(str) : String(str || '').toLowerCase().trim());

    for (const item of imported) {
      if (!item) continue;
      const targetTitle = norm(item.title);
      const targetArtist = norm(item.artist);
      const targetAlbum = norm(item.album);

      let match = library.find(t => t && t.id === item.id);

      if (!match && targetTitle) {
        match = library.find(t => {
          if (!t) return false;
          const meta = (typeof trackMetadata === 'function') ? trackMetadata(t) : t;
          const title = norm(meta.title || t.name);
          const artist = norm(meta.artist);
          if (title === targetTitle) {
            if (!targetArtist || targetArtist === 'unknown artist' || artist === targetArtist) {
              return true;
            }
          }
          return false;
        });
      }

      if (!match && targetTitle && targetAlbum) {
        match = library.find(t => {
          if (!t) return false;
          const meta = (typeof trackMetadata === 'function') ? trackMetadata(t) : t;
          return norm(meta.title || t.name) === targetTitle && norm(meta.album) === targetAlbum;
        });
      }

      if (match) {
        matchedTracks.push({ imported: item, local: match });
      } else {
        unmatchedTracks.push(item);
      }
    }

    const total = imported.length;
    const matchedCount = matchedTracks.length;
    const matchRate = total > 0 ? Math.round((matchedCount / total) * 1000) / 10 : 0;
    const summary = total > 0
      ? `Đã khớp ${matchedCount}/${total} bài (${matchRate}%) trong thư viện của bạn`
      : 'Danh sách bài hát rỗng';

    return {
      matchedTracks,
      unmatchedTracks,
      matchedCount,
      totalCount: total,
      matchRate,
      summary
    };
  }

  function exportPlaylistM3u8(playlistName, tracks, options = {}) {
    const list = Array.isArray(tracks) ? tracks : [];
    const lines = [];
    lines.push('#EXTM3U');
    lines.push('#EXTENC:UTF-8');
    const name = String(playlistName || options.name || 'Nocturne Playlist').trim();
    lines.push(`#PLAYLIST:${name}`);

    for (const t of list) {
      if (!t) continue;
      const meta = (typeof trackMetadata === 'function') ? trackMetadata(t) : t;
      const duration = Math.round(Number(meta.duration || t.duration) || -1);
      const title = String(t.title || meta.title || t.name || 'Untitled').trim();
      const artist = String(t.artist || meta.artist || 'Unknown Artist').trim();
      const album = String(t.album || (meta.album && meta.album !== 'Unknown Album' ? meta.album : '')).trim();
      const format = String(t.format || '').toUpperCase();

      lines.push(`#EXTINF:${duration},${artist} - ${title}`);
      if (album && album !== 'Unknown Album') lines.push(`#EXTALBUM:${album}`);
      if (format) lines.push(`#EXTFORMAT:${format}`);
      if (t.id) lines.push(`#EXTID:${t.id}`);
      const pathOrUrl = t.file?.name || t.name || t.url || `${artist} - ${title}.flac`;
      lines.push(pathOrUrl);
    }

    return lines.join('\n');
  }

  function parseM3u8Playlist(m3u8Text) {
    if (!m3u8Text || typeof m3u8Text !== 'string') {
      return { isValid: false, name: '', tracks: [], error: 'Nội dung M3U8 rỗng.' };
    }
    const lines = m3u8Text.split(/\r?\n/);
    if (!lines.some(l => l.trim().startsWith('#EXTM3U'))) {
      return { isValid: false, name: '', tracks: [], error: 'Tệp không chứa tiêu đề #EXTM3U hợp lệ.' };
    }

    let name = 'M3U8 Playlist';
    const tracks = [];
    let currentItem = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#PLAYLIST:')) {
        name = line.substring(10).trim() || name;
      } else if (line.startsWith('#EXTINF:')) {
        const afterColon = line.substring(8);
        const commaIdx = afterColon.indexOf(',');
        let duration = 0;
        let info = '';
        if (commaIdx >= 0) {
          duration = Math.round(Number(afterColon.substring(0, commaIdx).trim()) || 0);
          info = afterColon.substring(commaIdx + 1).trim();
        } else {
          info = afterColon.trim();
        }

        let artist = 'Unknown Artist';
        let title = info;
        if (info.includes(' - ')) {
          const parts = info.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }

        currentItem = {
          duration: duration > 0 ? duration : 0,
          artist,
          title,
          album: '',
          format: 'FLAC',
          file: ''
        };
      } else if (line.startsWith('#EXTALBUM:') && currentItem) {
        currentItem.album = line.substring(10).trim();
      } else if (line.startsWith('#EXTFORMAT:') && currentItem) {
        currentItem.format = line.substring(11).trim().toUpperCase();
      } else if (line.startsWith('#EXTID:') && currentItem) {
        currentItem.id = line.substring(7).trim();
      } else if (!line.startsWith('#')) {
        if (!currentItem) {
          currentItem = {
            duration: 0,
            artist: 'Unknown Artist',
            title: line.replace(/\.[a-zA-Z0-9]+$/, ''),
            album: '',
            format: 'FLAC',
            file: line
          };
        } else {
          currentItem.file = line;
        }
        tracks.push(currentItem);
        currentItem = null;
      }
    }

    return {
      isValid: true,
      name,
      trackCount: tracks.length,
      tracks
    };
  }

  // ── Pha D — PWA Architecture: Audio Stream Dynamic Chunking & Resilient Cache Engine ──
  function calculateAudioChunkRanges(totalBytes, chunkSize = 512 * 1024) {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
    const validChunk = (Number.isFinite(chunkSize) && chunkSize > 0) ? Math.floor(chunkSize) : 512 * 1024;
    const ranges = [];
    let start = 0;
    let index = 0;
    while (start < totalBytes) {
      const end = Math.min(start + validChunk - 1, totalBytes - 1);
      const size = end - start + 1;
      ranges.push({
        index,
        start,
        end,
        rangeHeader: `bytes=${start}-${end}`,
        size,
        total: totalBytes
      });
      start = end + 1;
      index++;
    }
    return ranges;
  }

  function shouldCacheAudioStream(url, contentType, size, options = {}) {
    if (!url || typeof url !== 'string') return { shouldCache: false, strategy: 'bypass', reason: 'Invalid URL' };
    const lowerType = (contentType || '').toLowerCase();
    const isLive = !!options.isLive || url.includes('.m3u8') || url.includes('/live/') || lowerType.includes('application/x-mpegurl');
    if (isLive) return { shouldCache: false, strategy: 'bypass', reason: 'Live stream or HLS manifest' };

    const validSize = Number.isFinite(size) && size > 0 ? size : 0;
    const maxCacheLimit = options.maxCacheLimit || 150 * 1024 * 1024;
    if (validSize > maxCacheLimit) {
      return { shouldCache: false, strategy: 'bypass', reason: 'Size exceeds single-track cache limit' };
    }

    const chunkThreshold = options.chunkThreshold || 5 * 1024 * 1024;
    if (validSize > 0 && validSize <= chunkThreshold) {
      return { shouldCache: true, strategy: 'full-cache', reason: 'Small audio file suitable for immediate complete caching' };
    }
    return { shouldCache: true, strategy: 'range-chunk', reason: 'Large audio stream suitable for dynamic byte-range caching' };
  }

  function formatStreamChunkStatus(loadedChunks, totalChunks, cachedBytes, totalBytes) {
    const loaded = Math.max(0, Number.isInteger(loadedChunks) ? loadedChunks : 0);
    const total = Math.max(0, Number.isInteger(totalChunks) ? totalChunks : 0);
    const bytes = Math.max(0, Number.isFinite(cachedBytes) ? cachedBytes : 0);
    const totalB = Math.max(0, Number.isFinite(totalBytes) ? totalBytes : 0);

    const mb = (bytes / (1024 * 1024)).toFixed(1);
    if (total === 0) return `Bộ đệm: ${mb} MB`;
    const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    if (totalB > 0) {
      const totalMb = (totalB / (1024 * 1024)).toFixed(1);
      return `Nạp đệm: ${loaded}/${total} đoạn (${mb} / ${totalMb} MB · ${percent}%)`;
    }
    return `Nạp đệm: ${loaded}/${total} đoạn (${mb} MB · ${percent}%)`;
  }

  function buildServiceWorkerCacheManifest(routes, version = 'nocturne-v2.0.7') {
    const validRoutes = Array.isArray(routes) ? routes.filter(r => typeof r === 'string' && r.trim().length > 0) : [];
    const normalized = [...new Set(validRoutes.map(r => r.trim()))];
    return {
      version: String(version || 'nocturne-v2.0.7'),
      generatedAt: Date.now(),
      routes: normalized,
      count: normalized.length
    };
  }

  // ── Pha A — Audio Engine & DSP: Audiophile Sub-Bass Transient Punch & Low-Frequency Dynamic Decay ──
  const SUB_BASS_PUNCH_PROFILES = {
    'off': {
      id: 'off',
      name: 'Bypass (Bit-Perfect Direct)',
      description: 'Bỏ qua can thiệp dải trầm, giữ nguyên 100% tín hiệu gốc bit-perfect.',
      frequency: 0,
      gain: 0,
      q: 0.7,
      harmonicGain: 0,
      preampOffset: 0
    },
    'sub-punch': {
      id: 'sub-punch',
      name: 'Sub-Bass Transient Punch (45 Hz)',
      description: 'Tăng cường xung lực dải siêu trầm 45 Hz với độ động nảy tức thì cho EDM, Hip-Hop, Pop.',
      frequency: 45,
      gain: 3.5,
      q: 1.4,
      harmonicGain: 1.2,
      preampOffset: -2.5
    },
    'deep-rumble': {
      id: 'deep-rumble',
      name: 'Cinematic Deep Rumble (32 Hz)',
      description: 'Dải trầm rền sâu thăm thẳm 32 Hz chuẩn phòng chiếu phim, âm hình dày và lan tỏa.',
      frequency: 32,
      gain: 4.5,
      q: 1.0,
      harmonicGain: 1.8,
      preampOffset: -3.2
    },
    'tight-slam': {
      id: 'tight-slam',
      name: 'Audiophile Tight Slam (60 Hz)',
      description: 'Tiếng trống kick chắc gọn 60 Hz, xung lực dứt khoát không kéo đuôi, tối ưu cho Rock, Jazz & Metal.',
      frequency: 60,
      gain: 3.0,
      q: 1.8,
      harmonicGain: 0.8,
      preampOffset: -2.0
    }
  };

  function getSubBassPunchProfile(profileId) {
    return SUB_BASS_PUNCH_PROFILES[profileId] || SUB_BASS_PUNCH_PROFILES['off'];
  }

  function calculateSubBassPunchParams(profileId, intensity = 1.0) {
    const profile = getSubBassPunchProfile(profileId);
    const safeIntensity = Number.isFinite(intensity) ? Math.min(2.0, Math.max(0.0, intensity)) : 1.0;
    if (profile.id === 'off' || safeIntensity <= 0.01) {
      return {
        id: 'off',
        name: profile.name,
        frequency: 0,
        gain: 0,
        dynamicGain: 0,
        harmonicFrequency: 0,
        harmonicGain: 0,
        q: 0.7,
        intensity: safeIntensity,
        preampSafetyOffset: 0,
        description: profile.description
      };
    }

    const scaledGain = Math.round(profile.gain * safeIntensity * 100) / 100;
    const scaledHarmonicGain = Math.round(profile.harmonicGain * safeIntensity * 100) / 100;
    const preampSafety = -Math.max(1.0, Math.round((scaledGain * 0.7 + scaledHarmonicGain * 0.3) * 10) / 10);

    return {
      id: profile.id,
      name: profile.name,
      frequency: profile.frequency,
      gain: scaledGain,
      dynamicGain: scaledGain,
      harmonicFrequency: profile.frequency * 2,
      harmonicGain: scaledHarmonicGain,
      q: profile.q,
      intensity: safeIntensity,
      preampSafetyOffset: Math.min(0, preampSafety),
      description: profile.description
    };
  }

  function formatSubBassPunchSummary(profileId, intensity = 1.0) {
    const params = calculateSubBassPunchParams(profileId, intensity);
    if (params.id === 'off') return 'Bypass (0 dB)';
    return `${params.name.split(' (')[0]} (+${params.gain.toFixed(1)} dB @ ${params.frequency} Hz · x${params.intensity.toFixed(1)})`;
  }

  function calculateLowFrequencyTransientDecay(frequency, q, decayMultiplier = 1.0) {
    const freq = Math.max(20, Math.min(200, Number(frequency) || 45));
    const qFactor = Math.max(0.1, Math.min(10.0, Number(q) || 1.0));
    const mult = Math.max(0.2, Math.min(3.0, Number(decayMultiplier) || 1.0));

    const dampingFactor = 1 / (2 * qFactor);
    const periodMs = 1000 / freq;
    const halfLifeMs = Math.round((periodMs * qFactor * 0.693 * mult) * 10) / 10;

    return {
      frequency: freq,
      q: qFactor,
      dampingFactor: Math.round(dampingFactor * 1000) / 1000,
      periodMs: Math.round(periodMs * 100) / 100,
      halfLifeMs
    };
  }

  // ── Pha C — Hệ Thống Gợi Ý Danh Sách Phát Ngữ Cảnh & Gắn Tag Tự Động ──

  const ACOUSTIC_TAG_TAXONOMY = {
    quality: [
      { id: 'dsd-master', label: 'DSD Direct Master', match: t => Boolean(t.isDsd || String(t.format || '').toLowerCase().includes('dsd') || /\.(dsf|dff)$/i.test(t.path || t.file || t.url || '')) },
      { id: 'hires-audio', label: 'Hi-Res 24-bit', match: t => Boolean(t.isHiRes || (t.sampleRate && t.sampleRate > 48000) || (t.bitDepth && t.bitDepth > 16)) },
      { id: 'lossless-flac', label: 'Lossless Studio', match: t => Boolean(String(t.format || '').toLowerCase().includes('flac') || String(t.format || '').toLowerCase().includes('wav') || t.qualityTier === 'lossless') },
      { id: 'compact-audio', label: 'Standard AAC/MP3', match: t => Boolean(String(t.format || '').toLowerCase().includes('mp3') || String(t.format || '').toLowerCase().includes('aac') || String(t.format || '').toLowerCase().includes('m4a')) }
    ],
    dynamics: [
      { id: 'dr-audiophile', label: 'Dynamic Master (DR12+)', match: (t, tel = {}) => Boolean(tel.drScore >= 12 || (t.dynamicRange && t.dynamicRange >= 12)) },
      { id: 'dr-standard', label: 'Natural Dynamic (DR8-11)', match: (t, tel = {}) => Boolean((tel.drScore >= 8 && tel.drScore < 12) || (t.dynamicRange >= 8 && t.dynamicRange < 12)) },
      { id: 'dr-club', label: 'Compressed Loudness', match: (t, tel = {}) => Boolean((tel.drScore > 0 && tel.drScore < 8) || (t.dynamicRange > 0 && t.dynamicRange < 8)) }
    ],
    acoustic: [
      { id: 'tag-vocal', label: 'Audiophile Vocal', match: t => /vocal|giọng ca|singer|acoustic/i.test(`${t.title || ''} ${t.artist || ''} ${t.genre || ''}`) },
      { id: 'tag-acoustic', label: 'Acoustic Unplugged', match: t => /acoustic|unplugged|guitar|piano|mộc/i.test(`${t.title || ''} ${t.artist || ''} ${t.genre || ''}`) },
      { id: 'tag-electronic', label: 'Sub-Bass EDM', match: t => /edm|remix|house|techno|dance|synth/i.test(`${t.title || ''} ${t.artist || ''} ${t.genre || ''}`) },
      { id: 'tag-classical', label: 'Classical & Symphony', match: t => /classical|symphony|orchestra|concerto|piano/i.test(`${t.title || ''} ${t.artist || ''} ${t.genre || ''}`) },
      { id: 'tag-jazz', label: 'Vintage Jazz & Blues', match: t => /jazz|blues|soul|sax/i.test(`${t.title || ''} ${t.artist || ''} ${t.genre || ''}`) }
    ],
    daypart: [
      { id: 'daypart-morning', label: 'Khởi đầu Năng lượng (Morning)', match: t => /pop|rock|energy|dance/i.test(`${t.genre || ''} ${t.title || ''}`) },
      { id: 'daypart-focus', label: 'Tập trung Sâu (Deep Focus)', match: t => (Number(t.duration) >= 200 && /acoustic|piano|classical|jazz|ambient|instrumental/i.test(`${t.genre || ''} ${t.title || ''}`)) },
      { id: 'daypart-latenight', label: 'Đêm khuya Audiophile (Late Night)', match: t => Boolean(t.isDsd || t.isHiRes || /vocal|ballad|trữ tình|jazz|slow/i.test(`${t.genre || ''} ${t.title || ''}`)) }
    ]
  };

  function autoTagTrackAcoustics(track, telemetry = {}) {
    if (!track) {
      return {
        tags: ['Audio'],
        categoryMap: { quality: ['Audio'], dynamics: [], acoustic: [], daypart: [] },
        dominantTag: 'Audio',
        confidenceScore: 0.5
      };
    }

    const categoryMap = {
      quality: [],
      dynamics: [],
      acoustic: [],
      daypart: []
    };

    for (const [cat, tagDefs] of Object.entries(ACOUSTIC_TAG_TAXONOMY)) {
      for (const def of tagDefs) {
        try {
          if (typeof def.match === 'function' && def.match(track, telemetry)) {
            categoryMap[cat].push(def.label);
          }
        } catch (_) {}
      }
    }

    if (categoryMap.quality.length === 0) {
      categoryMap.quality.push(track.format ? String(track.format).toUpperCase() : 'Stereo Audio');
    }
    if (categoryMap.acoustic.length === 0) {
      const moodGenre = detectTrackMoodAndGenre(track);
      if (moodGenre.genres && moodGenre.genres.length) {
        categoryMap.acoustic.push(moodGenre.genres[0]);
      }
    }

    const allTags = [
      ...categoryMap.quality,
      ...categoryMap.dynamics,
      ...categoryMap.acoustic,
      ...categoryMap.daypart
    ];

    const dominantTag = categoryMap.quality[0] || categoryMap.acoustic[0] || 'Audiophile Track';
    const confidenceScore = Math.min(1.0, Math.max(0.6, 0.5 + allTags.length * 0.1));

    return {
      tags: allTags,
      categoryMap,
      dominantTag,
      confidenceScore: Math.round(confidenceScore * 100) / 100
    };
  }

  const CONTEXTUAL_PLAYLIST_PRESETS = {
    'late-night': {
      id: 'late-night',
      title: 'Đêm Khuya Audiophile',
      subtitle: 'Không gian tĩnh lặng · Chi tiết ấm áp',
      description: 'Tuyển tập các bản thu Vocal, Jazz và Ballad sâu lắng với dải động tự nhiên, lý tưởng cho trải nghiệm nghe tai nghe đêm muộn.',
      badge: 'LATE NIGHT',
      icon: '🌙',
      filter: t => {
        const text = `${t.genre || ''} ${t.title || ''} ${t.artist || ''}`.toLowerCase();
        return Boolean(t.isDsd || t.isHiRes || /vocal|jazz|ballad|trữ tình|acoustic|blues|slow/i.test(text));
      },
      sort: (a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0)
    },
    'deep-focus': {
      id: 'deep-focus',
      title: 'Tập Trung Sâu & Dòng Chảy',
      subtitle: 'Không lời · Nhịp điệu điều hòa',
      description: 'Âm nhạc mộc, cổ điển, jazz êm dịu và âm thanh khí quyển giúp não bộ duy trì trạng thái tập trung sâu.',
      badge: 'DEEP FOCUS',
      icon: '🧠',
      filter: t => {
        const text = `${t.genre || ''} ${t.title || ''} ${t.artist || ''}`.toLowerCase();
        return /acoustic|piano|guitar|classical|instrumental|ambient|lo-fi|jazz/i.test(text);
      },
      sort: (a, b) => ((b.rating || 0) - (a.rating || 0))
    },
    'high-energy': {
      id: 'high-energy',
      title: 'Năng Lượng Bùng Nổ',
      subtitle: 'Xung lực dải trầm · Tiết tấu sôi động',
      description: 'Nhịp điệu dồn dập, bass uy lực và tiết tấu hưng phấn tiếp lửa cho các hoạt động thể thao hoặc khởi động ngày mới.',
      badge: 'HIGH ENERGY',
      icon: '⚡',
      filter: t => {
        const text = `${t.genre || ''} ${t.title || ''} ${t.artist || ''}`.toLowerCase();
        return /edm|rock|pop|remix|house|techno|dance|electronic|bùng nổ/i.test(text);
      },
      sort: (a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0)
    },
    'hi-res-master': {
      id: 'hi-res-master',
      title: 'Trình Diễn Master & DSD',
      subtitle: 'Chuẩn âm học phòng thu 24-bit / DSD',
      description: 'Tận dụng tối đa băng thông DAC cao cấp với các bản thu FLAC 24-bit 96kHz+ và DSD Direct Stream Digital nguyên bản.',
      badge: 'HI-RES MASTER',
      icon: '💎',
      filter: t => Boolean(t.isDsd || t.isHiRes || (t.sampleRate && t.sampleRate > 48000) || (t.bitDepth && t.bitDepth > 16) || t.qualityTier === 'dsd' || t.qualityTier === 'highres'),
      sort: (a, b) => (compareTrackQuality ? compareTrackQuality(b, a) : 0)
    },
    'analog-warmth': {
      id: 'analog-warmth',
      title: 'Hồn Thu Âm Hoài Niệm (Vinyl Vintage)',
      subtitle: 'Chất âm mộc mạc · Giàu nhạc tính thập niên',
      description: 'Giai điệu vàng của những thập niên 70s-90s với âm hưởng mộc mạc, ngọt ngào và dải trầm analog ấm áp.',
      badge: 'VINTAGE VINYL',
      icon: '📻',
      filter: t => {
        const dec = extractDecade ? extractDecade(t) : null;
        const text = `${t.genre || ''} ${t.title || ''} ${t.artist || ''} ${t.album || ''}`.toLowerCase();
        return Boolean((dec && ['1960s', '1970s', '1980s', '1990s'].includes(dec)) || /retro|vintage|oldies|classic|xưa|hoài niệm|bất hủ/i.test(text));
      },
      sort: (a, b) => (Number(a.year || 9999) - Number(b.year || 9999))
    }
  };

  function recommendContextualPlaylist(tracks, options = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      const preset = CONTEXTUAL_PLAYLIST_PRESETS['late-night'];
      return {
        id: preset.id,
        title: preset.title,
        subtitle: preset.subtitle,
        description: preset.description,
        badge: preset.badge,
        icon: preset.icon,
        tracks: [],
        totalTracks: 0,
        totalDurationSec: 0,
        formattedDuration: '0:00',
        matchScore: 0
      };
    }

    let presetKey = options.context;
    if (!presetKey || presetKey === 'auto') {
      const hour = Number.isFinite(options.hour) ? options.hour : new Date().getHours();
      if (hour >= 22 || hour < 5) {
        presetKey = 'late-night';
      } else if (hour >= 5 && hour < 11) {
        presetKey = 'high-energy';
      } else if (hour >= 11 && hour < 17) {
        presetKey = 'deep-focus';
      } else {
        presetKey = 'late-night';
      }
    }

    const preset = CONTEXTUAL_PLAYLIST_PRESETS[presetKey] || CONTEXTUAL_PLAYLIST_PRESETS['late-night'];
    const maxTracks = Number.isFinite(options.maxTracks) ? Math.max(1, options.maxTracks) : 25;
    const excludeIds = new Set(Array.isArray(options.excludeIds) ? options.excludeIds : []);

    let filtered = tracks.filter(t => t && !excludeIds.has(t.id));

    if (options.seedTrackId) {
      const seed = tracks.find(t => t && t.id === options.seedTrackId);
      if (seed) {
        const seedArtist = String(seed.artist || '').toLowerCase().trim();
        const seedGenre = String(seed.genre || '').toLowerCase().trim();
        filtered.sort((a, b) => {
          let scoreA = 0, scoreB = 0;
          if (seedArtist && String(a.artist || '').toLowerCase().includes(seedArtist)) scoreA += 3;
          if (seedArtist && String(b.artist || '').toLowerCase().includes(seedArtist)) scoreB += 3;
          if (seedGenre && String(a.genre || '').toLowerCase().includes(seedGenre)) scoreA += 2;
          if (seedGenre && String(b.genre || '').toLowerCase().includes(seedGenre)) scoreB += 2;
          if (seed.isHiRes && a.isHiRes) scoreA += 1;
          if (seed.isHiRes && b.isHiRes) scoreB += 1;
          return scoreB - scoreA;
        });
      }
    }

    let matchedTracks = filtered.filter(preset.filter);

    if (matchedTracks.length < Math.min(5, filtered.length)) {
      const remaining = filtered.filter(t => !matchedTracks.some(m => m.id === t.id));
      matchedTracks = matchedTracks.concat(remaining.slice(0, 5 - matchedTracks.length));
    }

    if (typeof preset.sort === 'function' && !options.seedTrackId) {
      try { matchedTracks.sort(preset.sort); } catch (_) {}
    } else if (options.seedTrackId) {
      const seedIndex = matchedTracks.findIndex(t => t && t.id === options.seedTrackId);
      if (seedIndex > 0) {
        const [seedItem] = matchedTracks.splice(seedIndex, 1);
        matchedTracks.unshift(seedItem);
      }
    }

    const selectedTracks = matchedTracks.slice(0, maxTracks);
    const totalDurationSec = selectedTracks.reduce((acc, t) => acc + (Number(t.duration) || 0), 0);
    const formattedDuration = formatAlbumDuration ? formatAlbumDuration(totalDurationSec) : `${Math.round(totalDurationSec / 60)} phút`;
    const matchScore = tracks.length > 0 ? Math.min(1.0, Math.round((selectedTracks.length / Math.min(maxTracks, tracks.length)) * 100) / 100) : 0;

    return {
      id: preset.id,
      title: preset.title,
      subtitle: preset.subtitle,
      description: preset.description,
      badge: preset.badge,
      icon: preset.icon,
      tracks: selectedTracks,
      totalTracks: selectedTracks.length,
      totalDurationSec,
      formattedDuration,
      matchScore
    };
  }

  function formatContextualRecommendationBadge(rec) {
    if (!rec) return 'Gợi ý Ngữ cảnh';
    const title = rec.title || 'Danh sách Thông minh';
    const count = rec.totalTracks !== undefined ? rec.totalTracks : 0;
    const dur = rec.formattedDuration || '0:00';
    return `${rec.icon || '🎵'} ${title} (${count} bài · ${dur})`;
  }

  // ── Pha D — Tối Ưu Hóa Nạp Trước Bộ Nhớ Đệm Đa Tầng & Khả Năng Thích Ứng Khi Băng Thông Mạng Chập Chờn ──

  function calculateNetworkThroughputAdaptiveProfile(measurements = [], currentNetworkState = {}) {
    const isOnline = currentNetworkState.isOnline !== false;
    if (!isOnline) {
      return {
        measuredBps: 0,
        kbps: 0,
        mbps: 0,
        tier: 'offline',
        label: 'Ngoại tuyến',
        recommendedPrefetchTracks: 0,
        recommendedSliceBytes: 0,
        lookaheadTargetSeconds: 0,
        allowMetadataEnrichment: false,
        isThrottled: true,
        saveDataActive: Boolean(currentNetworkState.saveData)
      };
    }

    let measuredBps = 0;
    const validSamples = Array.isArray(measurements) ? measurements.filter(m => m && Number(m.bytes) > 0 && Number(m.durationMs) > 0) : [];

    if (validSamples.length > 0) {
      let totalWeight = 0;
      let weightedSpeedSum = 0;
      let weight = 1.0;
      for (let i = validSamples.length - 1; i >= 0; i--) {
        const sample = validSamples[i];
        const sampleBps = (Number(sample.bytes) * 8) / (Number(sample.durationMs) / 1000);
        weightedSpeedSum += sampleBps * weight;
        totalWeight += weight;
        weight *= 0.6;
      }
      measuredBps = totalWeight > 0 ? weightedSpeedSum / totalWeight : 2500000;
    } else if (Number.isFinite(currentNetworkState.downlink) && currentNetworkState.downlink > 0) {
      measuredBps = currentNetworkState.downlink * 1000000;
    } else {
      const typeSpeedMap = {
        '4g': 4000000,
        '3g': 1200000,
        '2g': 250000,
        'slow-2g': 64000
      };
      measuredBps = typeSpeedMap[currentNetworkState.effectiveType] || 3000000;
    }

    let tier = 'stable';
    if (measuredBps >= 5000000) {
      tier = 'high-speed';
    } else if (measuredBps >= 1500000) {
      tier = 'stable';
    } else if (measuredBps >= 400000) {
      tier = 'constrained';
    } else {
      tier = 'throttled';
    }

    if (currentNetworkState.saveData && (tier === 'high-speed' || tier === 'stable')) {
      tier = 'constrained';
    }

    const tierConfigMap = {
      'high-speed': {
        recommendedPrefetchTracks: 3,
        recommendedSliceBytes: 1048576,
        lookaheadTargetSeconds: 45,
        allowMetadataEnrichment: true,
        label: 'Băng thông Cao'
      },
      'stable': {
        recommendedPrefetchTracks: 2,
        recommendedSliceBytes: 524288,
        lookaheadTargetSeconds: 30,
        allowMetadataEnrichment: true,
        label: 'Ổn định'
      },
      'constrained': {
        recommendedPrefetchTracks: 1,
        recommendedSliceBytes: 262144,
        lookaheadTargetSeconds: 16,
        allowMetadataEnrichment: false,
        label: 'Băng thông Hạn chế'
      },
      'throttled': {
        recommendedPrefetchTracks: 0,
        recommendedSliceBytes: 131072,
        lookaheadTargetSeconds: 8,
        allowMetadataEnrichment: false,
        label: 'Nghẽn mạng / Chậm'
      }
    };

    const config = tierConfigMap[tier] || tierConfigMap['stable'];
    const kbps = Math.round(measuredBps / 1000);
    const mbps = Math.round((measuredBps / 1000000) * 100) / 100;

    return {
      measuredBps: Math.round(measuredBps),
      kbps,
      mbps,
      tier,
      label: config.label,
      recommendedPrefetchTracks: config.recommendedPrefetchTracks,
      recommendedSliceBytes: config.recommendedSliceBytes,
      lookaheadTargetSeconds: config.lookaheadTargetSeconds,
      allowMetadataEnrichment: config.allowMetadataEnrichment,
      isThrottled: tier === 'throttled',
      saveDataActive: Boolean(currentNetworkState.saveData)
    };
  }

  function calculateThrottlingBackoff(failureCount = 1, baseDelayMs = 800, maxDelayMs = 15000, options = {}) {
    const count = Math.max(1, Number(failureCount) || 1);
    const base = Math.max(100, Number(baseDelayMs) || 800);
    const max = Math.max(base, Number(maxDelayMs) || 15000);
    const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 5;

    const expDelay = Math.min(max, base * Math.pow(2, count - 1));
    const jitterRatio = Number.isFinite(options.jitter) ? Math.max(0, Math.min(0.5, options.jitter)) : 0.15;
    const randomFactor = 1 + (Math.random() * 2 - 1) * jitterRatio;
    const delayMs = Math.max(100, Math.min(Math.round(max * 1.3), Math.round(expDelay * randomFactor)));

    let backoffLevel = 'immediate';
    if (delayMs > 8000) {
      backoffLevel = 'extended';
    } else if (delayMs > 4000) {
      backoffLevel = 'moderate';
    } else if (delayMs > 1500) {
      backoffLevel = 'quick';
    }

    return {
      delayMs,
      baseDelayMs: base,
      failureCount: count,
      retryAllowed: count <= maxRetries,
      nextAttemptInSec: Math.round((delayMs / 1000) * 10) / 10,
      backoffLevel
    };
  }

  function evaluateLookaheadBufferPipeline(activeDeckState = {}, nextTrackPreloadState = {}, queueLength = 0, networkProfile = {}) {
    const curTime = Math.max(0, Number(activeDeckState.currentTime) || 0);
    const dur = Math.max(0, Number(activeDeckState.duration) || 0);
    const bufEnd = Math.max(0, Number(activeDeckState.bufferedEnd) || 0);
    const isPlaying = Boolean(activeDeckState.isPlaying);

    const activeHeadroomSec = Math.max(0, bufEnd - curTime);
    const remainingTrackSec = Math.max(0, dur - curTime);
    const isUnderflowRisk = Boolean(isPlaying && activeHeadroomSec < 4.0 && remainingTrackSec > 5.0);

    let nextTrackReadiness = 0;
    if (nextTrackPreloadState) {
      if (nextTrackPreloadState.isReady) {
        nextTrackReadiness = 1.0;
      } else if (Number(nextTrackPreloadState.ratio) >= 0) {
        nextTrackReadiness = Math.min(1.0, Math.max(0, Number(nextTrackPreloadState.ratio)));
      } else if (Number(nextTrackPreloadState.bytesLoaded) > 0 && Number(nextTrackPreloadState.totalBytes) > 0) {
        nextTrackReadiness = Math.min(1.0, Math.max(0, nextTrackPreloadState.bytesLoaded / nextTrackPreloadState.totalBytes));
      }
    }

    let pipelineHealth = 'healthy';
    if (isPlaying && activeHeadroomSec < 2.0 && remainingTrackSec > 3.0) {
      pipelineHealth = 'starving';
    } else if (isUnderflowRisk || (networkProfile.isThrottled && activeHeadroomSec < 8.0)) {
      pipelineHealth = 'vulnerable';
    } else if (activeHeadroomSec >= 15.0 && (nextTrackReadiness >= 0.8 || queueLength === 0)) {
      pipelineHealth = 'optimal';
    } else {
      pipelineHealth = 'healthy';
    }

    let recommendedAction = 'normal';
    if (pipelineHealth === 'starving') {
      recommendedAction = 'emergency_fallback';
    } else if (pipelineHealth === 'vulnerable') {
      recommendedAction = 'boost_active_buffer';
    } else if (networkProfile.isThrottled) {
      recommendedAction = 'throttle_lookahead';
    }

    return {
      activeHeadroomSec: Math.round(activeHeadroomSec * 10) / 10,
      isUnderflowRisk,
      nextTrackReadiness: Math.round(nextTrackReadiness * 100) / 100,
      pipelineHealth,
      recommendedAction,
      networkTier: networkProfile.tier || 'stable',
      recommendedSliceBytes: networkProfile.recommendedSliceBytes || 524288
    };
  }

  function formatLookaheadPipelineTelemetry(pipelineReport) {
    if (!pipelineReport) return '⚡ Đệm: Đang tải...';
    const headroom = pipelineReport.activeHeadroomSec !== undefined ? `${pipelineReport.activeHeadroomSec}s` : '--';
    const readiness = pipelineReport.nextTrackReadiness !== undefined ? `${Math.round(pipelineReport.nextTrackReadiness * 100)}%` : '--';

    switch (pipelineReport.pipelineHealth) {
      case 'starving':
        return `🚨 Đệm cạn kiệt (${headroom}) · Nguy cơ dừng nhạc`;
      case 'vulnerable':
        return `⚠️ Đệm mỏng (${headroom}) · Đang nạp gấp`;
      case 'optimal':
        return `⚡ Đệm dồi dào (${headroom}) · Kế tiếp ${readiness}`;
      case 'healthy':
      default:
        return `🟢 Đệm ổn định (${headroom}) · Kế tiếp ${readiness}`;
    }
  }

  // ── Pha A — Cân Bằng Độ Lớn Tự Thích Ứng Chuẩn Phòng Thu (Dynamic ReplayGain & Loudness Normalization with True-Peak Auto-Guard) ──

  const LOUDNESS_STANDARDS = {
    'ebu-r128': {
      id: 'ebu-r128',
      label: 'EBU R128 (-23 LUFS)',
      targetLuFS: -23.0,
      maxTruePeakDb: -1.0,
      description: 'Tiêu chuẩn phát thanh truyền hình châu Âu; dải động rộng, âm lượng cân bằng tự nhiên.'
    },
    'itu-bs1770': {
      id: 'itu-bs1770',
      label: 'ITU-R BS.1770 (-24 LUFS)',
      targetLuFS: -24.0,
      maxTruePeakDb: -2.0,
      description: 'Tiêu chuẩn quốc tế phòng thu và phim ảnh; bảo toàn tối đa khoảng lặng và độ động gốc.'
    },
    'audiophile-album': {
      id: 'audiophile-album',
      label: 'Roon Audiophile Album (-18 LUFS)',
      targetLuFS: -18.0,
      maxTruePeakDb: -0.5,
      description: 'Chuẩn âm học tham chiếu Audiophile; giữ trọn tỷ lệ tương quan giữa các bài trong cùng album.'
    },
    'streaming-standard': {
      id: 'streaming-standard',
      label: 'Streaming Dịch vụ (-14 LUFS)',
      targetLuFS: -14.0,
      maxTruePeakDb: -1.0,
      description: 'Chuẩn độ lớn phổ biến trên Spotify & Apple Music; âm lượng đồng đều cho môi trường di động.'
    },
    'legacy-replaygain': {
      id: 'legacy-replaygain',
      label: 'ReplayGain 2.0 (89 dB SPL)',
      targetLuFS: -18.0,
      maxTruePeakDb: 0.0,
      description: 'Chuẩn ReplayGain truyền thống 89 dB SPL nguyên bản.'
    }
  };

  function getLoudnessStandard(id) {
    if (!id || typeof id !== 'string') return LOUDNESS_STANDARDS['audiophile-album'];
    return LOUDNESS_STANDARDS[id] || LOUDNESS_STANDARDS['audiophile-album'];
  }

  function listLoudnessStandards() {
    return Object.values(LOUDNESS_STANDARDS);
  }

  function calculateTruePeakAutoGuard(gainDb = 0, measuredTruePeakDb = -96, maxAllowedTruePeakDb = -0.5) {
    const rawGain = Number.isFinite(gainDb) ? gainDb : 0;
    const tp = Number.isFinite(measuredTruePeakDb) ? measuredTruePeakDb : -96;
    const maxTp = Number.isFinite(maxAllowedTruePeakDb) ? maxAllowedTruePeakDb : -0.5;

    const projectedTruePeakDb = tp + rawGain;
    let guardReductionDb = 0;
    let isGuardActive = false;

    if (projectedTruePeakDb > maxTp) {
      guardReductionDb = Math.round((projectedTruePeakDb - maxTp) * 100) / 100;
      isGuardActive = true;
    }

    const guardedGainDb = Math.round((rawGain - guardReductionDb) * 100) / 100;

    return {
      rawGainDb: Math.round(rawGain * 100) / 100,
      measuredTruePeakDb: Math.round(tp * 100) / 100,
      projectedTruePeakDb: Math.round(projectedTruePeakDb * 100) / 100,
      maxAllowedTruePeakDb: maxTp,
      guardReductionDb,
      guardedGainDb,
      isGuardActive
    };
  }

  function estimateLoudnessLUFS(rmsDb = -96, crestFactorDb = 10, options = {}) {
    const rms = Number.isFinite(rmsDb) ? Math.max(-96, Math.min(0, rmsDb)) : -96;
    const crest = Number.isFinite(crestFactorDb) ? Math.max(1, Math.min(25, crestFactorDb)) : 10;
    const kOffset = crest >= 14 ? -0.8 : (crest >= 10 ? -0.5 : -0.2);
    const estimatedLuFS = Math.round((rms + kOffset) * 10) / 10;
    return Math.max(-96, Math.min(0, estimatedLuFS));
  }

  function calculateDynamicReplayGain(trackOrTags, options = {}) {
    const standardId = options.standard || 'audiophile-album';
    const standard = getLoudnessStandard(standardId);
    const mode = options.mode === 'album' ? 'album' : 'track';
    const enabled = options.enabled !== false;
    const preampDb = Number.isFinite(options.preampDb) ? Number(options.preampDb) : 0;
    const autoGuard = options.truePeakAutoGuard !== false;

    if (!enabled) {
      return {
        multiplier: 1.0,
        appliedGainDb: 0,
        rawGainDb: 0,
        preampDb: 0,
        guardReductionDb: 0,
        targetLuFS: standard.targetLuFS,
        estimatedLuFS: null,
        standard: standard.id,
        standardLabel: standard.label,
        isGuardActive: false,
        isEstimated: false,
        mode
      };
    }

    const parsedRg = parseReplayGain(trackOrTags);
    let rawGainDb = 0;
    let isEstimated = false;
    let estimatedLuFS = null;

    if (parsedRg && parsedRg.hasReplayGain) {
      const baseGain = mode === 'album' ? parsedRg.albumGain : parsedRg.trackGain;
      const targetOffsetDb = standard.targetLuFS - (-18.0);
      rawGainDb = baseGain + targetOffsetDb;
    } else {
      isEstimated = true;
      const rmsDb = Number.isFinite(options.rmsDb) ? options.rmsDb : -18.0;
      const crestDb = Number.isFinite(options.crestFactorDb) ? options.crestFactorDb : 10.0;
      estimatedLuFS = estimateLoudnessLUFS(rmsDb, crestDb);
      rawGainDb = standard.targetLuFS - estimatedLuFS;
      rawGainDb = Math.max(-12.0, Math.min(9.0, rawGainDb));
    }

    const combinedGainDb = rawGainDb + preampDb;

    const measuredTp = Number.isFinite(options.measuredTruePeakDb)
      ? options.measuredTruePeakDb
      : (parsedRg && parsedRg.trackPeak ? 20 * Math.log10(Math.max(0.0001, parsedRg.trackPeak)) : 0);

    let guardResult = { guardedGainDb: combinedGainDb, guardReductionDb: 0, isGuardActive: false };
    if (autoGuard) {
      guardResult = calculateTruePeakAutoGuard(combinedGainDb, measuredTp, standard.maxTruePeakDb);
    }

    const finalGainDb = guardResult.guardedGainDb;
    let multiplier = Math.pow(10, finalGainDb / 20);
    multiplier = Math.max(0.0316, Math.min(5.62, multiplier));

    return {
      multiplier: Math.round(multiplier * 10000) / 10000,
      appliedGainDb: Math.round(finalGainDb * 10) / 10,
      rawGainDb: Math.round(rawGainDb * 10) / 10,
      preampDb: Math.round(preampDb * 10) / 10,
      guardReductionDb: guardResult.guardReductionDb,
      targetLuFS: standard.targetLuFS,
      estimatedLuFS,
      standard: standard.id,
      standardLabel: standard.label,
      isGuardActive: guardResult.isGuardActive,
      isEstimated,
      mode
    };
  }

  function formatDynamicReplayGainSummary(result) {
    if (!result) return 'Chuẩn hóa: Tắt';
    const gainStr = (result.appliedGainDb >= 0 ? `+${result.appliedGainDb.toFixed(1)}` : `${result.appliedGainDb.toFixed(1)}`) + ' dB';
    const tagInfo = result.isEstimated ? 'Ước tính R128' : (result.mode === 'album' ? 'Album' : 'Track');
    const guardInfo = result.isGuardActive ? ` · TP Guard (-${result.guardReductionDb.toFixed(1)} dB)` : '';
    return `${result.standardLabel} · ${gainStr} (${tagInfo}${guardInfo})`;
  }

  // ── Pha B — Sân Khấu Ánh Sáng Vũ Trường & Visualizer Strobe Đa Tần Số (Multi-Band Reactive Strobe & Beat-Synchronized Ambient Aura) ──

  const STAGE_AURA_PRESETS = {
    'club-laser': {
      id: 'club-laser',
      name: 'Vũ Trường Laser (Club Strobe)',
      bassThreshold: 0.58,
      vocalThreshold: 0.45,
      trebleThreshold: 0.40,
      decayRate: 0.85,
      trebleParticleCount: 24,
      pulseExpansion: 1.12,
      description: 'Phản ứng chớp giật năng lượng cao theo nhịp trống kick và cymbal lấp lánh.'
    },
    'lounge-ambient': {
      id: 'lounge-ambient',
      name: 'Phòng Trà Thư Giãn (Lounge Glow)',
      bassThreshold: 0.68,
      vocalThreshold: 0.35,
      trebleThreshold: 0.55,
      decayRate: 0.94,
      trebleParticleCount: 8,
      pulseExpansion: 1.04,
      description: 'Hào quang lan tỏa êm dịu, ưu tiên rung cảm trung âm và phân rã chậm.'
    },
    'studio-monitor': {
      id: 'studio-monitor',
      name: 'Kiểm Âm Phòng Thu (Linear Studio)',
      bassThreshold: 0.50,
      vocalThreshold: 0.50,
      trebleThreshold: 0.50,
      decayRate: 0.90,
      trebleParticleCount: 16,
      pulseExpansion: 1.06,
      description: 'Hiển thị chính xác tỷ lệ năng lượng 3 dải tần theo thang đo kỹ thuật.'
    },
    'psychedelic-wave': {
      id: 'psychedelic-wave',
      name: 'Sóng Ảo Giác Đa Sắc (Psychedelic Prism)',
      bassThreshold: 0.55,
      vocalThreshold: 0.40,
      trebleThreshold: 0.45,
      decayRate: 0.91,
      trebleParticleCount: 32,
      pulseExpansion: 1.10,
      description: 'Xoay tròn quang phổ và phát xung đa tầng đồng điệu theo từng nốt nhạc.'
    }
  };

  function getStageAuraPreset(presetId) {
    if (!presetId || typeof presetId !== 'string') return STAGE_AURA_PRESETS['club-laser'];
    return STAGE_AURA_PRESETS[presetId] || STAGE_AURA_PRESETS['club-laser'];
  }

  function listStageAuraPresets() {
    return Object.values(STAGE_AURA_PRESETS);
  }

  function calculateMultiBandStrobe(energyOrFrequencyData, prevStrobe = {}, options = {}) {
    const preset = getStageAuraPreset(options.preset || options.presetId);
    let bass = 0, vocal = 0, treble = 0, isBeatPulse = false;

    if (energyOrFrequencyData && typeof energyOrFrequencyData.bass === 'number') {
      bass = Math.max(0, Math.min(1, energyOrFrequencyData.bass));
      vocal = Math.max(0, Math.min(1, Number(energyOrFrequencyData.vocal) || 0));
      treble = Math.max(0, Math.min(1, Number(energyOrFrequencyData.treble) || 0));
      isBeatPulse = Boolean(energyOrFrequencyData.isBeatPulse);
    } else if (Array.isArray(energyOrFrequencyData) || (energyOrFrequencyData && typeof energyOrFrequencyData.length === 'number')) {
      const bands = calculateAudioEnergyBands(energyOrFrequencyData, options.sampleRate || 44100, options.fftSize || 256);
      bass = bands.bass;
      vocal = bands.vocal;
      treble = bands.treble;
      isBeatPulse = bands.isBeatPulse;
    }

    const decay = Number(options.decayRate) || preset.decayRate;
    const prevBass = Number(prevStrobe?.bassIntensity) || 0;
    const prevVocal = Number(prevStrobe?.vocalIntensity) || 0;
    const prevTreble = Number(prevStrobe?.trebleIntensity) || 0;

    let bassIntensity = prevBass * decay;
    let vocalIntensity = prevVocal * decay;
    let trebleIntensity = prevTreble * decay;

    let bassTriggered = false;
    if (bass >= preset.bassThreshold || isBeatPulse) {
      const boost = Math.min(1.0, 0.4 + (bass - preset.bassThreshold) * 1.8);
      bassIntensity = Math.min(1.0, Math.max(bassIntensity, boost));
      bassTriggered = true;
    }

    let vocalTriggered = false;
    if (vocal >= preset.vocalThreshold) {
      const boost = Math.min(1.0, 0.3 + (vocal - preset.vocalThreshold) * 1.5);
      vocalIntensity = Math.min(1.0, Math.max(vocalIntensity, boost));
      vocalTriggered = true;
    }

    let trebleTriggered = false;
    if (treble >= preset.trebleThreshold) {
      const boost = Math.min(1.0, 0.3 + (treble - preset.trebleThreshold) * 1.6);
      trebleIntensity = Math.min(1.0, Math.max(trebleIntensity, boost));
      trebleTriggered = true;
    }

    if (bassIntensity < 0.02) bassIntensity = 0;
    if (vocalIntensity < 0.02) vocalIntensity = 0;
    if (trebleIntensity < 0.02) trebleIntensity = 0;

    const maxExpansion = preset.pulseExpansion - 1.0;
    const bassPulseScale = Math.round((1.0 + Math.min(maxExpansion, bassIntensity * maxExpansion)) * 1000) / 1000;
    const vocalRippleRadius = Math.round((0.35 + vocalIntensity * 0.45) * 1000) / 1000;
    const activeSparkles = Math.round(trebleIntensity * preset.trebleParticleCount);

    let dominantBand = 'balanced';
    if (bassIntensity > vocalIntensity && bassIntensity > trebleIntensity && bassIntensity > 0.3) {
      dominantBand = 'bass';
    } else if (vocalIntensity > bassIntensity && vocalIntensity > trebleIntensity && vocalIntensity > 0.3) {
      dominantBand = 'vocal';
    } else if (trebleIntensity > bassIntensity && trebleIntensity > vocalIntensity && trebleIntensity > 0.3) {
      dominantBand = 'treble';
    }

    const isStrobeTriggered = bassTriggered || vocalTriggered || trebleTriggered || bassIntensity > 0.35;

    return {
      presetId: preset.id,
      presetName: preset.name,
      bassIntensity: Math.round(bassIntensity * 1000) / 1000,
      vocalIntensity: Math.round(vocalIntensity * 1000) / 1000,
      trebleIntensity: Math.round(trebleIntensity * 1000) / 1000,
      bassPulseScale,
      vocalRippleRadius,
      activeSparkles,
      dominantBand,
      isStrobeTriggered,
      bassEnergy: Math.round(bass * 1000) / 1000,
      vocalEnergy: Math.round(vocal * 1000) / 1000,
      trebleEnergy: Math.round(treble * 1000) / 1000
    };
  }

  function renderMultiBandAmbientAura(context, options = {}) {
    if (!context || !options) return false;
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;
    if (width <= 0 || height <= 0) return false;

    const strobe = options.strobe || calculateMultiBandStrobe(options.energy);
    if (!strobe || (!strobe.isStrobeTriggered && strobe.bassIntensity < 0.03 && strobe.vocalIntensity < 0.03)) {
      return false;
    }

    const theme = getVisualizerTheme(options.theme);
    const primaryColor = theme.peakColor || '#c084fc';
    const centerX = width / 2;
    const centerY = height * 0.5;
    const baseRadius = Math.min(width, height) * 0.45;

    try {
      if (typeof context.save === 'function') context.save();

      // Layer 1: Bass Radial Core Pulse
      if (strobe.bassIntensity > 0.03) {
        const pulseRadius = baseRadius * (strobe.bassPulseScale || 1.0);
        const bassGrad = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, pulseRadius);
        const bassAlpha = Math.min(0.35, strobe.bassIntensity * 0.32);
        bassGrad.addColorStop(0, hexToRgba(primaryColor, bassAlpha));
        bassGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = bassGrad;
        context.fillRect(0, 0, width, height);
      }

      // Layer 2: Vocal Harmonic Resonant Halo Ring
      if (strobe.vocalIntensity > 0.05 && typeof context.beginPath === 'function') {
        const ringRadius = baseRadius * (strobe.vocalRippleRadius || 0.5);
        context.beginPath();
        context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        const ringAlpha = Math.min(0.4, strobe.vocalIntensity * 0.38);
        context.strokeStyle = hexToRgba('#38bdf8', ringAlpha);
        context.lineWidth = Math.max(1.5, strobe.vocalIntensity * 4.0);
        context.stroke();
      }

      // Layer 3: Treble Shimmer Star Sparkles
      if (strobe.activeSparkles > 0 && typeof context.beginPath === 'function') {
        const count = strobe.activeSparkles;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + (options.time || 0) * 0.001;
          const dist = baseRadius * (0.6 + 0.35 * Math.sin(i * 1.7));
          const px = centerX + Math.cos(angle) * dist;
          const py = centerY + Math.sin(angle) * dist;
          const sparkSize = 1.0 + Math.sin(i + (options.time || 0) * 0.005) * 1.5;
          context.beginPath();
          context.arc(px, py, Math.max(0.5, sparkSize), 0, Math.PI * 2);
          context.fillStyle = 'rgba(255, 255, 255, 0.75)';
          context.fill();
        }
      }

      // Layer 4: Chromatic Aura & Concentric Resonant Ripples
      if (typeof calculateBeatStrobeChromaticAura === 'function') {
        const chromaticAura = calculateBeatStrobeChromaticAura(strobe, {
          primaryColor,
          timeSeconds: (options.time || 0) * 0.001
        });
        if (chromaticAura && chromaticAura.concentricRipples && chromaticAura.concentricRipples.length > 0 && typeof context.beginPath === 'function') {
          for (const ripple of chromaticAura.concentricRipples) {
            const rRadius = baseRadius * ripple.radiusMultiplier;
            context.beginPath();
            context.arc(centerX, centerY, rRadius, 0, Math.PI * 2);
            context.strokeStyle = hexToRgba(ripple.colorHex, ripple.alpha);
            context.lineWidth = 1.5;
            context.stroke();
          }
        }
      }

      if (typeof context.restore === 'function') context.restore();
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatMultiBandAuraSummary(strobeReport) {
    if (!strobeReport) return 'Sân khấu ánh sáng: Tĩnh';
    const presetName = strobeReport.presetName || 'Laser Vũ Trường';
    const bassPct = Math.round((strobeReport.bassIntensity || 0) * 100);
    const vocalPct = Math.round((strobeReport.vocalIntensity || 0) * 100);
    const treblePct = Math.round((strobeReport.trebleIntensity || 0) * 100);

    let dominantStr = 'Cân bằng';
    if (strobeReport.dominantBand === 'bass') dominantStr = 'Đỉnh Trầm';
    else if (strobeReport.dominantBand === 'vocal') dominantStr = 'Sáng Vocal';
    else if (strobeReport.dominantBand === 'treble') dominantStr = 'Lấp lánh Treble';

    return `${presetName} · B:${bassPct}% V:${vocalPct}% T:${treblePct}% (${dominantStr})`;
  }

  // ── Pha C — Quản Lý & Tự Động Khớp Lời Bài Hát Đa Nguồn Mờ (Fuzzy Multi-Source Lyrics Matcher & Synchronized LRC Offline Vault) ──

  function cleanLyricsSearchKey(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\.(mp3|flac|wav|m4a|dsf|dff|aac|ogg|opus)$/i, '')
      .replace(/[\(\[](?:feat|ft|official|audio|video|lyrics|explicit|remastered|remaster|live|karaoke)[^\)\]]*[\)\]]/gi, '')
      .replace(/^[0-9\.\-\s_]+/, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function calculateStringSimilarity(strA, strB) {
    const a = cleanLyricsSearchKey(strA);
    const b = cleanLyricsSearchKey(strB);
    if (!a && !b) return 1.0;
    if (!a || !b) return 0.0;
    if (a === b) return 1.0;
    if (a.includes(b) || b.includes(a)) {
      return Math.round((Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.5 + 0.5) * 100) / 100;
    }
    const wordsA = a.split(' ').filter(Boolean);
    const wordsB = b.split(' ').filter(Boolean);
    if (!wordsA.length || !wordsB.length) return 0;
    let intersect = 0;
    for (const w of wordsA) {
      if (wordsB.includes(w)) intersect++;
    }
    return Math.round(((2 * intersect) / (wordsA.length + wordsB.length)) * 100) / 100;
  }

  function scoreLyricsCandidateMatch(track = {}, candidate = {}) {
    const meta = trackMetadata(track) || {};
    const trackTitle = meta.title || track.title || '';
    const trackArtist = meta.artist || track.artist || '';
    const trackDur = Number(track.duration) || 0;

    const candTitle = candidate.trackName || candidate.name || candidate.title || '';
    const candArtist = candidate.artistName || candidate.artist || '';
    const candDur = Number(candidate.duration) || 0;

    const titleSim = calculateStringSimilarity(trackTitle, candTitle);
    const artistSim = calculateStringSimilarity(trackArtist, candArtist);

    let durationScore = 1.0;
    if (trackDur > 0 && candDur > 0) {
      const diff = Math.abs(trackDur - candDur);
      if (diff <= 2) durationScore = 1.0;
      else if (diff <= 5) durationScore = 0.85;
      else if (diff <= 10) durationScore = 0.65;
      else if (diff <= 20) durationScore = 0.35;
      else durationScore = 0.0;
    }

    const hasSynced = Boolean(candidate.syncedLyrics || (typeof candidate.lyricsText === 'string' && /\[\d{1,2}:\d{2}/.test(candidate.lyricsText)));
    const syncedBonus = hasSynced ? 1.0 : 0.7;

    // Weighted match score 0-100
    const weighted = (titleSim * 0.50) + (artistSim * 0.30) + (durationScore * 0.15) + (syncedBonus * 0.05);
    const matchScore = Math.round(weighted * 100);

    let confidence = 'low';
    if (matchScore >= 80) confidence = 'high';
    else if (matchScore >= 60) confidence = 'medium';

    return {
      matchScore,
      isAcceptable: matchScore >= 55,
      confidence,
      isSynced: hasSynced,
      titleSimilarity: titleSim,
      artistSimilarity: artistSim,
      durationDeltaSec: trackDur > 0 && candDur > 0 ? Math.round(Math.abs(trackDur - candDur)) : null
    };
  }

  function normalizeAndSanitizeLrc(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) return '';
    const cleanLines = [];
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    const spamPatterns = [
      /lyrics\s*by/i,
      /synchronized\s*by/i,
      /qq:\s*\d+/i,
      /www\.[a-z0-9\-]+\.[a-z]+/i,
      /https?:\/\//i,
      /lrc\s*editor/i
    ];

    const lines = rawText.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const timeRows = [];
    const headerRows = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let isSpam = false;
      for (const pattern of spamPatterns) {
        if (pattern.test(trimmed)) {
          isSpam = true;
          break;
        }
      }
      if (isSpam) continue;

      if (/^\[(ti|ar|al|by|offset|length):/i.test(trimmed)) {
        headerRows.push(trimmed);
        continue;
      }

      const matches = [...trimmed.matchAll(timeRegex)];
      if (matches.length > 0) {
        const lyricText = trimmed.replace(timeRegex, '').trim();
        for (const m of matches) {
          const mins = parseInt(m[1], 10);
          const secs = parseInt(m[2], 10);
          const msRaw = m[3] || '00';
          const ms = msRaw.length === 3 ? parseInt(msRaw, 10) / 1000 : parseInt(msRaw.padEnd(2, '0'), 10) / 100;
          const totalSec = mins * 60 + secs + ms;
          timeRows.push({
            time: totalSec,
            formattedTag: `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(Math.floor(ms * 100)).padStart(2, '0')}]`,
            text: lyricText
          });
        }
      } else {
        // Plain text lyric line
        cleanLines.push(trimmed);
      }
    }

    if (timeRows.length > 0) {
      timeRows.sort((a, b) => a.time - b.time);
      const formattedTimeLines = timeRows.map(r => `${r.formattedTag} ${r.text}`.trimEnd());
      return [...headerRows, ...formattedTimeLines].join('\n');
    }

    return [...headerRows, ...cleanLines].join('\n');
  }

  function createLyricsVaultEntry(track, lrcText, options = {}) {
    const meta = trackMetadata(track) || {};
    const trackId = track?.id || meta.id || 'unknown';
    const title = meta.title || track?.title || 'Unknown Title';
    const artist = meta.artist || track?.artist || UNKNOWN_ARTIST;
    const sanitized = normalizeAndSanitizeLrc(lrcText);
    const isSynced = /\[\d{1,2}:\d{2}\.\d{2}\]/.test(sanitized);
    const lines = sanitized.split('\n').filter(l => l.trim().length > 0);

    return {
      version: 1,
      trackId: String(trackId),
      title,
      artist,
      source: options.source || 'lrclib',
      lrcText: sanitized,
      isSynced,
      linesCount: lines.length,
      matchScore: Number(options.matchScore) || (isSynced ? 95 : 70),
      savedAt: Date.now(),
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000)
    };
  }

  function validateLyricsVaultEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return { isValid: false, reason: 'Entry must be an object' };
    }
    if (!entry.trackId || typeof entry.trackId !== 'string') {
      return { isValid: false, reason: 'Missing or invalid trackId' };
    }
    if (!entry.lrcText || typeof entry.lrcText !== 'string' || entry.lrcText.trim().length < 5) {
      return { isValid: false, reason: 'LRC text is empty or too short' };
    }
    if (typeof entry.linesCount !== 'number' || entry.linesCount <= 0) {
      return { isValid: false, reason: 'Invalid lines count' };
    }
    return { isValid: true };
  }

  function formatLyricsVaultTelemetry(vaultEntry) {
    if (!vaultEntry || !vaultEntry.lrcText) return 'Lời bài hát: Chưa có';
    const src = (vaultEntry.source || 'lrclib').toUpperCase();
    const syncStatus = vaultEntry.isSynced ? 'Đồng bộ' : 'Văn xuôi';
    const score = vaultEntry.matchScore ? ` · ${vaultEntry.matchScore}% khớp` : '';
    const lines = vaultEntry.linesCount ? ` · ${vaultEntry.linesCount} câu` : '';
    return `⚡ ${syncStatus} (${src}${score}${lines})`;
  }

  function scheduleQueueLyricsPreload(queue = [], currentId = null, options = {}) {
    if (!Array.isArray(queue) || queue.length === 0) return [];
    const maxPreload = Number(options.maxPreload) || 3;
    const curIdx = queue.findIndex(t => t && (t.id === currentId || String(t.id) === String(currentId)));
    const startIdx = curIdx >= 0 ? curIdx + 1 : 0;
    const candidates = queue.slice(startIdx, startIdx + maxPreload);

    return candidates.filter(t => {
      if (!t || !t.id) return false;
      if (t.lyricsText && t.lyricsText.length > 10) return false;
      if (options.cachedTrackIds instanceof Set && options.cachedTrackIds.has(t.id)) return false;
      return true;
    });
  }

  // ── Pha D: Nén & Lập Chỉ Mục Thư Viện Đa Luồng Web Worker (IndexedDB Compact Indexing & Web Worker Asynchronous Library Scan) ──
  const FORMAT_CODES = Object.freeze({
    'FLAC': 1,
    'MP3': 2,
    'WAV': 3,
    'ALAC': 4,
    'AAC': 5,
    'OGG': 6,
    'OPUS': 7,
    'DSF': 8,
    'DFF': 9,
    'AIFF': 10,
    'AIF': 10,
    'M4A': 11,
    'WMA': 12
  });

  const REVERSE_FORMAT_CODES = Object.freeze({
    1: 'FLAC',
    2: 'MP3',
    3: 'WAV',
    4: 'ALAC',
    5: 'AAC',
    6: 'OGG',
    7: 'OPUS',
    8: 'DSF',
    9: 'DFF',
    10: 'AIFF',
    11: 'M4A',
    12: 'WMA'
  });

  const SOURCE_CODES = Object.freeze({
    'local': 1,
    'subsonic': 2,
    'jellyfin': 3,
    'gdrive': 4,
    'onedrive': 5,
    'url': 6,
    'blackcandy': 7
  });

  const REVERSE_SOURCE_CODES = Object.freeze({
    1: 'local',
    2: 'subsonic',
    3: 'jellyfin',
    4: 'gdrive',
    5: 'onedrive',
    6: 'url',
    7: 'blackcandy'
  });

  function compressLibraryTrackIndex(track) {
    if (!track || typeof track !== 'object') return null;
    const id = track.id || '';
    if (!id) return null;

    const fmtStr = String(track.format || '').toUpperCase();
    const fmtCode = FORMAT_CODES[fmtStr] || 0;

    const srcStr = String(track.source || 'local').toLowerCase();
    const srcCode = SOURCE_CODES[srcStr] || 1;

    return {
      i: String(id),
      t: String(track.title || '').trim(),
      a: String(track.artist || '').trim(),
      al: String(track.album || '').trim(),
      d: Math.round(Math.max(0, Number(track.duration) || 0)),
      f: fmtCode,
      s: srcCode,
      q: Math.round(Math.max(0, Number(track.qualityScore) || 0)),
      c: (track.cover || track.picture) ? 1 : 0
    };
  }

  function decompressLibraryTrackIndex(compact) {
    if (!compact || typeof compact !== 'object' || !compact.i) return null;
    const formatName = REVERSE_FORMAT_CODES[compact.f] || 'UNKNOWN';
    const sourceName = REVERSE_SOURCE_CODES[compact.s] || 'local';

    return {
      id: String(compact.i),
      title: compact.t || 'Unknown Title',
      artist: compact.a || UNKNOWN_ARTIST,
      album: compact.al || UNKNOWN_ALBUM,
      duration: Number(compact.d) || 0,
      format: formatName,
      source: sourceName,
      qualityScore: Number(compact.q) || 0,
      hasCover: Boolean(compact.c)
    };
  }

  function tokenizeIndexString(str = '') {
    if (!str || typeof str !== 'string') return [];
    const normalized = str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');
    return normalized
      .split(/[\s,._\-\/\\()+&|:;!?'"\[\]{}]+/)
      .map(tok => tok.trim())
      .filter(tok => tok.length >= 2);
  }

  function buildLibraryInvertedIndex(tracks = []) {
    if (!Array.isArray(tracks)) return { index: {}, totalTokens: 0, totalTracks: 0 };
    const index = {};
    let totalTokens = 0;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track || !track.id) continue;
      const trackId = String(track.id);

      const titleTokens = tokenizeIndexString(track.title);
      const artistTokens = tokenizeIndexString(track.artist);
      const albumTokens = tokenizeIndexString(track.album);

      const uniqueTokens = new Set([...titleTokens, ...artistTokens, ...albumTokens]);
      for (const token of uniqueTokens) {
        if (!index[token]) {
          index[token] = [];
          totalTokens++;
        }
        index[token].push(trackId);
      }
    }

    return {
      index,
      totalTokens,
      totalTracks: tracks.length
    };
  }

  function queryInvertedIndex(invertedIndexObj, query = '') {
    if (!invertedIndexObj || typeof invertedIndexObj !== 'object' || !invertedIndexObj.index) return [];
    const index = invertedIndexObj.index;
    const queryTokens = tokenizeIndexString(query);
    if (queryTokens.length === 0) return [];

    const tokenMatches = queryTokens.map(tok => {
      if (index[tok]) return index[tok];
      const matchedIds = [];
      const keys = Object.keys(index);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].startsWith(tok) || (tok.length >= 3 && keys[i].includes(tok))) {
          matchedIds.push(...index[keys[i]]);
        }
      }
      return matchedIds;
    });

    if (tokenMatches.some(arr => !arr || arr.length === 0)) {
      return [];
    }

    let candidateSet = new Set(tokenMatches[0]);
    for (let i = 1; i < tokenMatches.length; i++) {
      const currentSet = new Set(tokenMatches[i]);
      candidateSet = new Set([...candidateSet].filter(id => currentSet.has(id)));
      if (candidateSet.size === 0) break;
    }

    return Array.from(candidateSet);
  }

  function batchProcessLibraryScan(items = [], options = {}) {
    if (!Array.isArray(items)) return { batches: 0, processedCount: 0, totalDurationMs: 0, results: [] };
    const chunkSize = Math.max(1, Math.min(500, Number(options.chunkSize) || 50));
    const processFn = typeof options.processFn === 'function' ? options.processFn : (item => item);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    const startTime = Date.now();
    const results = [];
    let processedCount = 0;
    const total = items.length;
    let batchIndex = 0;

    for (let i = 0; i < total; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      for (let j = 0; j < chunk.length; j++) {
        results.push(processFn(chunk[j], processedCount));
        processedCount++;
      }
      batchIndex++;
      if (onProgress) {
        onProgress({
          processed: processedCount,
          total,
          percent: total > 0 ? Math.round((processedCount / total) * 100) : 100,
          batchIndex
        });
      }
    }

    return {
      batches: batchIndex,
      processedCount,
      totalDurationMs: Math.max(0, Date.now() - startTime),
      results
    };
  }

  function evaluateLibraryIndexHealth(tracks = [], compactEntries = [], invertedIndex = {}) {
    const trackCount = Array.isArray(tracks) ? tracks.length : 0;
    const compactCount = Array.isArray(compactEntries) ? compactEntries.length : 0;
    const totalTokens = (invertedIndex && typeof invertedIndex.totalTokens === 'number') ? invertedIndex.totalTokens : 0;

    const rawEstimatedBytes = trackCount * 450;
    const compactEstimatedBytes = compactCount * 135;
    const compressionRatio = rawEstimatedBytes > 0
      ? Math.max(0, Math.min(1, 1 - (compactEstimatedBytes / rawEstimatedBytes)))
      : 0;

    const indexCoverage = trackCount > 0 ? Math.min(1, compactCount / trackCount) : 1;
    let score = 100;
    if (indexCoverage < 0.99) score -= Math.round((1 - indexCoverage) * 50);
    if (trackCount > 10 && totalTokens < Math.round(trackCount * 0.5)) score -= 15;
    score = Math.max(0, Math.min(100, score));

    let status = 'OPTIMAL';
    if (score < 50) status = 'DEGRADED';
    else if (score < 75) status = 'NEEDS_REINDEX';
    else if (score < 85) status = 'GOOD';

    return {
      status,
      score,
      trackCount,
      compactCount,
      totalTokens,
      compressionRatio: Math.round(compressionRatio * 100),
      spaceSavedBytes: Math.max(0, rawEstimatedBytes - compactEstimatedBytes)
    };
  }

  function formatLibraryIndexHealthReport(healthReport) {
    if (!healthReport || typeof healthReport !== 'object') return 'Chỉ mục: Chưa phân tích';
    const st = healthReport.status || 'UNKNOWN';
    const score = healthReport.score ?? 100;
    const ratio = healthReport.compressionRatio ?? 0;
    const tokens = healthReport.totalTokens ?? 0;
    return `⚡ Chỉ mục ${st} (${score}/100) · Nén -${ratio}% · ${tokens} tokens`;
  }

  const BPM_TEMPO_TIERS = {
    ambient_slow: { id: 'ambient_slow', name: 'Thong thả / Ru êm (Ambient & Slow)', minBpm: 40, maxBpm: 80, badgeColor: '#38bdf8' },
    groove_mid: { id: 'groove_mid', name: 'Nhịp điệu Thư thái (Groove & Mid-tempo)', minBpm: 80, maxBpm: 115, badgeColor: '#34d399' },
    upbeat_dance: { id: 'upbeat_dance', name: 'Sôi động / Nhảy (Upbeat Dance)', minBpm: 115, maxBpm: 140, badgeColor: '#f59e0b' },
    hyper_fast: { id: 'hyper_fast', name: 'Cường độ Cao (Fast & Driving)', minBpm: 140, maxBpm: 240, badgeColor: '#ef4444' }
  };

  function getTempoTier(bpm) {
    const val = Number(bpm) || 0;
    if (val < 80) return BPM_TEMPO_TIERS.ambient_slow;
    if (val < 115) return BPM_TEMPO_TIERS.groove_mid;
    if (val < 140) return BPM_TEMPO_TIERS.upbeat_dance;
    return BPM_TEMPO_TIERS.hyper_fast;
  }

  function estimateTrackBpmFromEnergyHistory(energyHistory, options = {}) {
    if (!energyHistory || energyHistory.length < 16) {
      return { bpm: 0, confidence: 0, tempoTier: getTempoTier(0), rawLag: 0 };
    }
    const fps = Math.max(10, Math.min(120, Number(options.fps) || 30));
    const minBpm = Math.max(40, Number(options.minBpm) || 55);
    const maxBpm = Math.min(220, Number(options.maxBpm) || 190);

    const minLag = Math.max(2, Math.floor((60 * fps) / maxBpm));
    const maxLag = Math.min(energyHistory.length - 1, Math.ceil((60 * fps) / minBpm));

    const n = energyHistory.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(energyHistory[i]) || 0;
    const mean = sum / n;

    const corrs = new Float32Array(maxLag + 1);
    let maxCorr = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += (energyHistory[i] - mean) * (energyHistory[i + lag] - mean);
        count++;
      }
      const normCorr = count > 0 ? (corr / count) : 0;
      corrs[lag] = normCorr;
      if (normCorr > maxCorr) {
        maxCorr = normCorr;
      }
    }

    if (maxCorr <= 0) {
      return { bpm: 0, confidence: 0, tempoTier: getTempoTier(0), rawLag: 0 };
    }

    // Detect fundamental peak (first significant local maximum above 70% maxCorr)
    let bestLag = 0;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (corrs[lag] > corrs[lag - 1] && corrs[lag] >= corrs[lag + 1] && corrs[lag] >= maxCorr * 0.7) {
        bestLag = lag;
        break;
      }
    }
    if (bestLag === 0) {
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (corrs[lag] === maxCorr) {
          bestLag = lag;
          break;
        }
      }
    }

    let calculatedBpm = Math.round((60 * fps) / bestLag);
    while (calculatedBpm < minBpm) calculatedBpm *= 2;
    while (calculatedBpm > maxBpm) calculatedBpm = Math.round(calculatedBpm / 2);

    const confidence = Math.max(0, Math.min(1.0, maxCorr / (mean * mean + 0.001)));
    return {
      bpm: calculatedBpm,
      confidence: Number(confidence.toFixed(2)),
      tempoTier: getTempoTier(calculatedBpm),
      rawLag: bestLag
    };
  }

  function formatTempoEnergyBadge(bpmInfo) {
    if (!bpmInfo || !bpmInfo.bpm) return '🎵 Tiết tấu: Chưa xác định';
    const tier = bpmInfo.tempoTier || getTempoTier(bpmInfo.bpm);
    const confPct = Math.round((bpmInfo.confidence || 0) * 100);
    return `🎵 ${bpmInfo.bpm} BPM · ${tier.name.split(' (')[0]} (${confPct}% tin cậy)`;
  }

  function sequenceHarmonicBpmQueue(tracks = [], currentTrack = null, mode = 'smooth_asc') {
    if (!Array.isArray(tracks) || tracks.length <= 1) return tracks ? [...tracks] : [];

    const getBpm = (t) => {
      if (!t) return 100;
      if (typeof t.bpm === 'number' && t.bpm > 0) return t.bpm;
      if (t.bpmInfo && typeof t.bpmInfo.bpm === 'number') return t.bpmInfo.bpm;
      return 100;
    };

    const remaining = [...tracks];
    const result = [];

    if (currentTrack) {
      const curIdx = remaining.findIndex(t => t && (t.id === currentTrack.id || String(t.id) === String(currentTrack.id)));
      if (curIdx >= 0) {
        result.push(remaining.splice(curIdx, 1)[0]);
      }
    }

    if (mode === 'smooth_asc') {
      remaining.sort((a, b) => getBpm(a) - getBpm(b));
      return result.concat(remaining);
    } else if (mode === 'smooth_desc') {
      remaining.sort((a, b) => getBpm(b) - getBpm(a));
      return result.concat(remaining);
    } else if (mode === 'nearest_neighbor') {
      let currentBpm = result.length > 0 ? getBpm(result[0]) : 100;
      while (remaining.length > 0) {
        let nearestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const diff = Math.abs(getBpm(remaining[i]) - currentBpm);
          if (diff < minDiff) {
            minDiff = diff;
            nearestIdx = i;
          }
        }
        const nextTrack = remaining.splice(nearestIdx, 1)[0];
        result.push(nextTrack);
        currentBpm = getBpm(nextTrack);
      }
      return result;
    }

    return result.concat(remaining);
  }

  function filterTracksByBpmTier(tracks = [], tierId = 'upbeat_dance') {
    if (!Array.isArray(tracks)) return [];
    const tier = BPM_TEMPO_TIERS[tierId];
    if (!tier) return [...tracks];

    return tracks.filter(t => {
      const bpm = (t && typeof t.bpm === 'number' && t.bpm > 0) ? t.bpm : 100;
      return bpm >= tier.minBpm && bpm < tier.maxBpm;
    });
  }

  function computeLibraryDifferentialDelta(cachedEntries = [], incomingEntries = [], options = {}) {
    const cachedList = Array.isArray(cachedEntries) ? cachedEntries : [];
    const incomingList = Array.isArray(incomingEntries) ? incomingEntries : [];
    const keyField = options.keyField || 'id';

    const cachedMap = new Map();
    for (const item of cachedList) {
      if (item && item[keyField]) cachedMap.set(String(item[keyField]), item);
    }

    const incomingMap = new Map();
    const added = [];
    const modified = [];
    let unchangedCount = 0;

    for (const item of incomingList) {
      if (!item || !item[keyField]) continue;
      const key = String(item[keyField]);
      incomingMap.set(key, item);

      const existing = cachedMap.get(key);
      if (!existing) {
        added.push(item);
      } else {
        const isModified = (item.mtime && existing.mtime && item.mtime !== existing.mtime) ||
          (item.hash && existing.hash && item.hash !== existing.hash) ||
          (item.duration && existing.duration && Math.abs(item.duration - existing.duration) > 1) ||
          (item.quality && existing.quality && item.quality !== existing.quality) ||
          (item.title && existing.title && item.title !== existing.title);

        if (isModified) {
          modified.push(item);
        } else {
          unchangedCount++;
        }
      }
    }

    const removed = [];
    for (const [key, item] of cachedMap.entries()) {
      if (!incomingMap.has(key)) {
        removed.push(item);
      }
    }

    const total = incomingList.length;
    const savings = total > 0 ? Math.round((unchangedCount / total) * 100) : 100;
    const hasChanges = added.length > 0 || modified.length > 0 || removed.length > 0;

    return {
      added,
      modified,
      removed,
      unchangedCount,
      totalIncoming: total,
      bandwidthSavingsPercent: savings,
      hasChanges
    };
  }

  function mergeDifferentialCatalog(cachedEntries = [], delta = {}) {
    const result = Array.isArray(cachedEntries) ? [...cachedEntries] : [];
    if (!delta || typeof delta !== 'object') return result;

    const removedSet = new Set((delta.removed || []).map(r => r && String(r.id || '')));
    const filtered = result.filter(item => item && !removedSet.has(String(item.id || '')));

    const modifiedMap = new Map((delta.modified || []).map(m => [String(m.id || ''), m]));
    for (let i = 0; i < filtered.length; i++) {
      const id = String(filtered[i].id || '');
      if (modifiedMap.has(id)) {
        filtered[i] = Object.assign({}, filtered[i], modifiedMap.get(id));
      }
    }

    if (Array.isArray(delta.added) && delta.added.length > 0) {
      filtered.push(...delta.added);
    }

    return filtered;
  }

  function formatDifferentialSyncTelemetry(deltaReport) {
    if (!deltaReport || typeof deltaReport !== 'object') return 'Đồng bộ Delta: Chưa xác định';
    if (!deltaReport.hasChanges) {
      return `⚡ Thư viện hoàn hảo · 0 thay đổi (tiết kiệm 100% băng thông)`;
    }
    const a = deltaReport.added ? deltaReport.added.length : 0;
    const m = deltaReport.modified ? deltaReport.modified.length : 0;
    const r = deltaReport.removed ? deltaReport.removed.length : 0;
    const s = deltaReport.bandwidthSavingsPercent ?? 0;
    return `⚡ Đồng bộ Delta: +${a} mới · ${m} cập nhật · ${r} đã xóa (tiết kiệm ${s}% băng thông)`;
  }

  function estimateOfflineStorageAvailability(storageEstimate = {}, options = {}) {
    const quota = Number(storageEstimate?.quota) || 0;
    const usage = Number(storageEstimate?.usage) || 0;
    const safetyMargin = Number(options?.safetyMarginBytes) || (200 * 1024 * 1024);
    const avgFlac = Number(options?.avgFlacSizeBytes) || (35 * 1024 * 1024);
    const avgMp3 = Number(options?.avgMp3SizeBytes) || (8 * 1024 * 1024);

    const rawRemaining = Math.max(0, quota - usage);
    const usableBytes = Math.max(0, rawRemaining - safetyMargin);

    const estimatedFlacCount = avgFlac > 0 ? Math.floor(usableBytes / avgFlac) : 0;
    const estimatedMp3Count = avgMp3 > 0 ? Math.floor(usableBytes / avgMp3) : 0;
    const isStorageConstrained = usableBytes < (50 * 1024 * 1024);

    return {
      quotaBytes: quota,
      usageBytes: usage,
      rawRemainingBytes: rawRemaining,
      usableBytes,
      safetyMarginBytes: safetyMargin,
      estimatedFlacCount,
      estimatedMp3Count,
      isStorageConstrained
    };
  }

  function formatStorageCapacityForecast(capacityInfo) {
    if (!capacityInfo || typeof capacityInfo !== 'object') return 'Sức chứa ngoại tuyến: Chưa đo';
    const usableStr = formatStorageBytes(capacityInfo.usableBytes || 0);
    if (capacityInfo.isStorageConstrained) {
      return `⚠️ Bộ nhớ hạn hẹp (${usableStr}) · Cần dọn dẹp thêm trước khi lưu offline`;
    }
    return `💾 Khả dụng: ${usableStr} · Dự kiến: ~${capacityInfo.estimatedFlacCount} bài FLAC / ~${capacityInfo.estimatedMp3Count} bài MP3`;
  }

  const TUBE_EMULATION_PROFILES = {
    off: {
      id: 'off',
      name: 'Bypass (Thuần số Bit-Perfect)',
      badge: 'OFF',
      drive: 0,
      bias: 0,
      blend: 0,
      secondHarmonic: 0,
      description: 'Không áp dụng mô phỏng đèn, giữ nguyên độ trung thực số bit-perfect.'
    },
    warm_triode: {
      id: 'warm_triode',
      name: 'Triode 300B Ấm Áp (Single-Ended Triode)',
      badge: '300B',
      drive: 1.25,
      bias: 0.12,
      blend: 0.32,
      secondHarmonic: 0.14,
      description: 'Dồi dào hài bậc chẵn H2, trung âm dày dặn, ấm áp và ngọt ngào đặc trưng đèn 300B huyền thoại.'
    },
    vintage_el34: {
      id: 'vintage_el34',
      name: 'Vintage EL34 Mộc Mạc (Push-Pull Classic)',
      badge: 'EL34',
      drive: 1.45,
      bias: 0.08,
      blend: 0.38,
      secondHarmonic: 0.10,
      description: 'Âm sắc ấm áp cổ điển thập niên 70, dải trầm căng nẩy, giàu năng lượng truyền cảm.'
    },
    modern_kt88: {
      id: 'modern_kt88',
      name: 'Modern KT88 Hi-End (Audiophile Linear Tube)',
      badge: 'KT88',
      drive: 1.15,
      bias: 0.04,
      blend: 0.22,
      secondHarmonic: 0.06,
      description: 'Độ tuyến tính cao, âm trường thoáng đạt, chi tiết tinh khiết với vi lượng hài đèn tinh tế.'
    }
  };

  function getTubeEmulationProfile(profileKey) {
    const key = String(profileKey || 'off').toLowerCase();
    return TUBE_EMULATION_PROFILES[key] || TUBE_EMULATION_PROFILES.off;
  }

  function listTubeEmulationProfiles() {
    return Object.values(TUBE_EMULATION_PROFILES);
  }

  function generateTubeTransferCurve(samplesCount = 1024, profileOrKey = 'warm_triode') {
    const count = Math.max(256, Math.min(8192, Number(samplesCount) || 1024));
    const curve = new Float32Array(count);
    const profile = typeof profileOrKey === 'object' ? profileOrKey : getTubeEmulationProfile(profileOrKey);

    if (!profile || profile.id === 'off' || profile.blend <= 0) {
      for (let i = 0; i < count; i++) {
        curve[i] = (i / (count - 1)) * 2 - 1;
      }
      return curve;
    }

    const drive = Math.max(0.5, Math.min(3.0, Number(profile.drive) || 1.2));
    const bias = Math.max(0, Math.min(0.4, Number(profile.bias) || 0.1));
    const blend = Math.max(0, Math.min(1.0, Number(profile.blend) || 0.3));
    const h2 = Math.max(0, Math.min(0.3, Number(profile.secondHarmonic) || 0.1));

    const offsetDenom = 1.0 - Math.tanh(drive * bias);
    const denom = offsetDenom > 0.001 ? offsetDenom : 1.0;

    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * 2 - 1;
      const sat = (Math.tanh(drive * (x + bias)) - Math.tanh(drive * bias)) / denom;
      const evenHarmonic = h2 * (x * x) * (x >= 0 ? 1 : -1);
      const shaped = sat + evenHarmonic;
      const y = (1.0 - blend) * x + blend * shaped;
      curve[i] = Math.max(-1.0, Math.min(1.0, y));
    }
    return curve;
  }

  function formatTubeEmulationSummary(profileOrKey) {
    const p = typeof profileOrKey === 'object' ? profileOrKey : getTubeEmulationProfile(profileOrKey);
    if (!p || p.id === 'off') return 'Mạch Đèn: Tắt (Bit-Perfect Direct)';
    const drivePct = Math.round((p.drive || 1.0) * 100);
    const blendPct = Math.round((p.blend || 0) * 100);
    return `📻 ${p.name.split(' (')[0]} · Bão hòa ${drivePct}% · Hòa âm ${blendPct}%`;
  }

  function calculateMiniHudScrubFraction(offsetX, width) {
    if (typeof offsetX !== 'number' || typeof width !== 'number' || width <= 0 || !Number.isFinite(offsetX) || !Number.isFinite(width)) {
      return 0;
    }
    return Math.max(0, Math.min(1, offsetX / width));
  }

  function calculateMiniHudScrubTime(fraction, duration) {
    const f = (typeof fraction === 'number' && Number.isFinite(fraction)) ? Math.max(0, Math.min(1, fraction)) : 0;
    const d = (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) ? duration : 0;
    return f * d;
  }

  function renderMiniHudWaveformScrubber(canvas, peaks, currentProgress, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const width = canvas.width || 72;
    const height = canvas.height || 26;
    if (width <= 0 || height <= 0) return false;

    ctx.clearRect(0, 0, width, height);

    const progress = (typeof currentProgress === 'number' && Number.isFinite(currentProgress))
      ? Math.max(0, Math.min(1, currentProgress))
      : 0;
    const hoverFraction = (typeof options.hoverFraction === 'number' && Number.isFinite(options.hoverFraction))
      ? Math.max(0, Math.min(1, options.hoverFraction))
      : null;

    const barCount = 18;
    const gap = 1;
    const totalGap = gap * (barCount - 1);
    const barWidth = Math.max(1, (width - totalGap) / barCount);
    const midY = height / 2;

    const defaultBarColor = options.barColor || 'rgba(255, 255, 255, 0.22)';
    const defaultPlayedColor = options.playedColor || 'rgba(167, 139, 250, 0.9)';
    const hoverColor = options.hoverColor || 'rgba(244, 114, 182, 0.85)';
    const playheadColor = options.playheadColor || '#ffffff';

    const hasPeaks = Array.isArray(peaks) || (peaks && typeof peaks.length === 'number' && peaks.length > 0);

    for (let i = 0; i < barCount; i++) {
      const barFraction = (i + 0.5) / barCount;
      let amp = 0.5;
      if (hasPeaks) {
        const peakIdx = Math.floor(i * (peaks.length / barCount));
        amp = peaks[peakIdx] !== undefined ? Math.abs(peaks[peakIdx]) : 0.5;
      } else {
        amp = 0.3 + 0.6 * Math.abs(Math.sin((i + 1) * 0.72));
      }
      amp = Math.max(0.15, Math.min(1, amp));
      const barHeight = Math.max(2, amp * (height - 4));
      const x = i * (barWidth + gap);
      const y = midY - barHeight / 2;

      const isPlayed = barFraction <= progress;
      const isHovered = hoverFraction !== null && barFraction <= hoverFraction;

      if (isHovered && !isPlayed) {
        ctx.fillStyle = hoverColor;
      } else if (isPlayed) {
        ctx.fillStyle = defaultPlayedColor;
      } else {
        ctx.fillStyle = defaultBarColor;
      }

      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(barWidth)), Math.round(barHeight));
    }

    const playheadX = Math.round(progress * width);
    ctx.fillStyle = playheadColor;
    ctx.fillRect(Math.max(0, Math.min(width - 1.5, playheadX - 0.75)), 0, 1.5, height);

    if (hoverFraction !== null) {
      const hoverX = Math.round(hoverFraction * width);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(Math.max(0, Math.min(width - 1, hoverX - 0.5)), 0, 1, height);
    }

    return true;
  }

  function calculateVuGravityBallistics(currentValues, prevPeaks, prevHoldCounters, prevVelocities, options = {}) {
    const holdFrames = typeof options.holdFrames === 'number' ? Math.max(1, options.holdFrames) : 10;
    const gravity = typeof options.gravity === 'number' ? Math.max(0.0001, options.gravity) : 0.006;
    const maxVelocity = typeof options.maxVelocity === 'number' ? Math.max(0.01, options.maxVelocity) : 0.075;

    const len = Array.isArray(currentValues) || (currentValues && typeof currentValues.length === 'number')
      ? currentValues.length
      : 0;

    const peaks = new Float32Array(len);
    const holdCounters = new Int32Array(len);
    const velocities = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      const cur = (typeof currentValues[i] === 'number' && Number.isFinite(currentValues[i]))
        ? Math.max(0, Math.min(1, currentValues[i]))
        : 0;

      const pPeak = (prevPeaks && typeof prevPeaks[i] === 'number' && Number.isFinite(prevPeaks[i]))
        ? Math.max(0, Math.min(1, prevPeaks[i]))
        : 0;

      const pHold = (prevHoldCounters && typeof prevHoldCounters[i] === 'number')
        ? Math.max(0, prevHoldCounters[i])
        : 0;

      const pVel = (prevVelocities && typeof prevVelocities[i] === 'number')
        ? Math.max(0, prevVelocities[i])
        : 0;

      if (cur >= pPeak) {
        peaks[i] = cur;
        holdCounters[i] = holdFrames;
        velocities[i] = 0;
      } else if (pHold > 0) {
        peaks[i] = pPeak;
        holdCounters[i] = pHold - 1;
        velocities[i] = 0;
      } else {
        const vel = Math.min(maxVelocity, pVel + gravity);
        peaks[i] = Math.max(cur, pPeak - vel);
        holdCounters[i] = 0;
        velocities[i] = vel;
      }
    }

    return { peaks, holdCounters, velocities };
  }

  function formatVuBallisticsTelemetry(leftPeak, rightPeak, leftVal, rightVal) {
    const toDb = (val) => {
      if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0.00001) return -96.0;
      return Math.max(-96.0, Math.min(0.0, 20 * Math.log10(val)));
    };
    const lValDb = toDb(leftVal).toFixed(1);
    const lPkDb = toDb(leftPeak).toFixed(1);
    const rValDb = toDb(rightVal).toFixed(1);
    const rPkDb = toDb(rightPeak).toFixed(1);

    return `VU L: ${lValDb} dB (Pk ${lPkDb} dB) · R: ${rValDb} dB (Pk ${rPkDb} dB)`;
  }

  function calculateSonicSimilarityScore(trackA, trackB, options = {}) {
    if (!trackA || !trackB) return 0;
    if (trackA === trackB || (trackA.id && trackB.id && trackA.id === trackB.id)) return 100;

    let score = 0;

    // 1. BPM / Tempo Affinity (Max 35 points)
    const bpmA = (typeof trackA.bpm === 'number' && trackA.bpm > 0) ? trackA.bpm : (typeof trackA.estimatedBpm === 'number' ? trackA.estimatedBpm : 0);
    const bpmB = (typeof trackB.bpm === 'number' && trackB.bpm > 0) ? trackB.bpm : (typeof trackB.estimatedBpm === 'number' ? trackB.estimatedBpm : 0);

    if (bpmA > 0 && bpmB > 0) {
      const diff = Math.abs(bpmA - bpmB);
      if (diff <= 5) score += 35;
      else if (diff <= 12) score += 28;
      else if (diff <= 22) score += 18;
      else if (diff <= 35) score += 10;
      else score += Math.max(0, 35 - Math.round(diff));
    } else {
      score += 20;
    }

    // 2. Genre & Mood Compatibility (Max 30 points)
    const mgA = typeof detectTrackMoodAndGenre === 'function' ? detectTrackMoodAndGenre(trackA) : { genres: [], moods: [] };
    const mgB = typeof detectTrackMoodAndGenre === 'function' ? detectTrackMoodAndGenre(trackB) : { genres: [], moods: [] };

    let genreMatch = false;
    if (mgA.genres && mgB.genres) {
      for (const ga of mgA.genres) {
        if (mgB.genres.includes(ga)) {
          genreMatch = true;
          break;
        }
      }
    }

    let moodMatch = false;
    if (mgA.moods && mgB.moods) {
      for (const ma of mgA.moods) {
        if (mgB.moods.includes(ma)) {
          moodMatch = true;
          break;
        }
      }
    }

    if (genreMatch && moodMatch) score += 30;
    else if (genreMatch) score += 20;
    else if (moodMatch) score += 15;
    else score += 5;

    // 3. Dynamic Range & Format Quality (Max 20 points)
    const isHiResA = trackA.isDsd || (trackA.format && ['flac', 'dsd', 'wav', 'alac'].includes(String(trackA.format).toLowerCase())) || (trackA.sampleRate && trackA.sampleRate > 44100);
    const isHiResB = trackB.isDsd || (trackB.format && ['flac', 'dsd', 'wav', 'alac'].includes(String(trackB.format).toLowerCase())) || (trackB.sampleRate && trackB.sampleRate > 44100);

    if (isHiResA === isHiResB) score += 10;
    else score += 4;

    const durA = Number(trackA.duration) || 0;
    const durB = Number(trackB.duration) || 0;
    if (durA > 0 && durB > 0) {
      const durDiff = Math.abs(durA - durB);
      if (durDiff <= 45) score += 10;
      else if (durDiff <= 90) score += 7;
      else score += 3;
    } else {
      score += 6;
    }

    // 4. Artist Variety & Cooldown (Max 15 points)
    const artistA = String(trackA.artist || '').trim().toLowerCase();
    const artistB = String(trackB.artist || '').trim().toLowerCase();
    if (artistA && artistB) {
      if (artistA !== artistB) {
        score += 15;
      } else {
        score += 8;
      }
    } else {
      score += 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function generateSonicFlowQueue(seedTrack, candidateTracks = [], options = {}) {
    if (!Array.isArray(candidateTracks) || candidateTracks.length === 0) {
      return { orderedTracks: [], avgSimilarityScore: 0, transitions: [] };
    }

    const pool = [...candidateTracks];
    const orderedTracks = [];
    const transitions = [];
    let current = seedTrack || pool[0];

    const seedIdx = pool.findIndex(t => t && seedTrack && (t.id === seedTrack.id || t === seedTrack));
    if (seedIdx >= 0) {
      pool.splice(seedIdx, 1);
    }

    let totalScore = 0;
    let transitionCount = 0;

    while (pool.length > 0) {
      let bestIdx = 0;
      let highestScore = -1;

      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        const score = calculateSonicSimilarityScore(current, candidate, options);
        if (score > highestScore) {
          highestScore = score;
          bestIdx = i;
        }
      }

      const nextTrack = pool.splice(bestIdx, 1)[0];
      orderedTracks.push(nextTrack);

      transitions.push({
        fromId: current ? current.id : null,
        toId: nextTrack.id,
        score: highestScore >= 0 ? highestScore : 50
      });

      totalScore += (highestScore >= 0 ? highestScore : 50);
      transitionCount++;
      current = nextTrack;
    }

    const avgSimilarityScore = transitionCount > 0 ? Math.round(totalScore / transitionCount) : 0;
    return {
      orderedTracks,
      avgSimilarityScore,
      transitions
    };
  }

  function formatSonicFlowBadge(score, avgOrTransition = 'avg') {
    const s = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
    if (s >= 80) return `🌊 Sonic Flow: ${s}% Hòa quyện · Tương đồng Nhịp & Tâm trạng`;
    if (s >= 65) return `🌊 Sonic Flow: ${s}% Tương thích tốt · Chuyển tiếp mượt`;
    return `🌊 Sonic Flow: ${s}% Đa dạng phong cách`;
  }

  function filterTracksBySonicRange(centerTrack, candidateTracks = [], minScore = 60) {
    if (!centerTrack || !Array.isArray(candidateTracks)) return [];
    return candidateTracks
      .map(track => ({ track, score: calculateSonicSimilarityScore(centerTrack, track) }))
      .filter(item => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .map(item => item.track);
  }

  function evaluateAudioMemoryBudget(cachedChunks = [], currentTrackId = null, options = {}) {
    const maxBudgetBytes = Number(options?.maxBudgetBytes) || (256 * 1024 * 1024);
    const chunks = Array.isArray(cachedChunks) ? cachedChunks : [];

    let totalAllocatedBytes = 0;
    const chunkStats = [];

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] || {};
      const size = Number(c.sizeBytes) || 0;
      totalAllocatedBytes += size;
      chunkStats.push({
        key: c.key || `chunk_${i}`,
        trackId: c.trackId || null,
        sizeBytes: size,
        lastAccessTime: Number(c.lastAccessTime) || 0,
        isPlaying: Boolean(c.isPlaying || (currentTrackId && c.trackId === currentTrackId))
      });
    }

    const utilizationRatio = maxBudgetBytes > 0 ? (totalAllocatedBytes / maxBudgetBytes) : 0;
    const utilizationPercent = Math.min(100, Math.round(utilizationRatio * 100));

    let pressureLevel = 'safe';
    if (utilizationRatio > 0.85) pressureLevel = 'critical';
    else if (utilizationRatio > 0.60) pressureLevel = 'moderate';

    const evictionKeys = [];
    let bytesToReclaim = 0;

    if (pressureLevel === 'critical' || options?.forceEviction) {
      const evictable = chunkStats.filter(c => !c.isPlaying);
      evictable.sort((a, b) => a.lastAccessTime - b.lastAccessTime);

      const targetBytes = maxBudgetBytes * 0.65;
      let remainingBytes = totalAllocatedBytes;

      for (const c of evictable) {
        if (remainingBytes <= targetBytes && !options?.forceEviction) break;
        evictionKeys.push(c.key);
        bytesToReclaim += c.sizeBytes;
        remainingBytes -= c.sizeBytes;
        if (options?.forceEviction && evictionKeys.length >= (options.maxEvictCount || 50)) break;
      }
    }

    return {
      totalAllocatedBytes,
      maxBudgetBytes,
      utilizationRatio: Math.round(utilizationRatio * 1000) / 1000,
      utilizationPercent,
      pressureLevel,
      chunkCount: chunks.length,
      evictionKeys,
      bytesToReclaim
    };
  }

  function compressChunkMetadataMap(chunkList = []) {
    const list = Array.isArray(chunkList) ? chunkList : [];
    const packed = [];
    let uncompressedBytes = 0;

    for (const item of list) {
      if (!item) continue;
      const trackId = String(item.trackId || '');
      const idx = Number(item.chunkIndex) || 0;
      const size = Number(item.sizeBytes) || 0;
      const fmt = String(item.formatCode || 'f');
      const timeSec = Math.floor((Number(item.lastAccessTime) || Date.now()) / 1000);

      uncompressedBytes += (trackId.length + 32);
      packed.push([trackId, idx, size, fmt, timeSec]);
    }

    const compressedBytes = packed.length * 16;
    const savingsRatio = uncompressedBytes > 0 ? Math.round((1 - compressedBytes / uncompressedBytes) * 100) : 0;

    return {
      packed,
      count: packed.length,
      uncompressedBytes,
      compressedBytes,
      savingsRatio: Math.max(0, savingsRatio)
    };
  }

  function decompressChunkMetadataMap(packedList = []) {
    const list = Array.isArray(packedList) ? packedList : [];
    return list.map(item => {
      if (!Array.isArray(item)) return null;
      return {
        trackId: item[0] || '',
        chunkIndex: item[1] || 0,
        sizeBytes: item[2] || 0,
        formatCode: item[3] || 'f',
        lastAccessTime: (item[4] || 0) * 1000
      };
    }).filter(Boolean);
  }

  function formatAudioMemoryBudgetTelemetry(report) {
    if (!report || typeof report !== 'object') return '💾 Bộ đệm RAM: Chưa có dữ liệu';
    const allocMb = (report.totalAllocatedBytes / (1024 * 1024)).toFixed(1);
    const budgetMb = Math.round(report.maxBudgetBytes / (1024 * 1024));
    const label = report.pressureLevel === 'safe' ? 'An toàn' : report.pressureLevel === 'moderate' ? 'Cảnh báo' : 'Quá tải';
    const evictCount = Array.isArray(report.evictionKeys) ? report.evictionKeys.length : 0;

    return `💾 Bộ đệm RAM: ${allocMb}/${budgetMb} MB (${label} ${report.utilizationPercent}%) · ${evictCount} lát cần thu hồi`;
  }

  const DSD_ULTRASONIC_FILTERS = {
    bypass: {
      id: 'bypass',
      name: 'Bypass (Không lọc / Native DAC Direct)',
      badge: 'BYPASS',
      cutoffHz: 0,
      qFactor: 0.707,
      slopeDbPerOct: 0,
      description: 'Không lọc siêu âm, dữ liệu DSD/PCM truyền nguyên bản tới DAC.'
    },
    sacd_standard: {
      id: 'sacd_standard',
      name: 'Chuẩn SACD Scarlett Book (30 kHz Gentle Roll-off)',
      badge: 'SACD 30k',
      cutoffHz: 30000,
      qFactor: 0.707,
      slopeDbPerOct: 24,
      description: 'Cắt dốc tự nhiên tại 30 kHz (-24 dB/oct), triệt tiêu nhiễu cao tần Delta-Sigma mà không làm suy giảm độ thoáng âm hình.'
    },
    hi_res_extended: {
      id: 'hi_res_extended',
      name: 'Mở rộng Dải thông Hi-Res (50 kHz Extended)',
      badge: 'HI-RES 50k',
      cutoffHz: 50000,
      qFactor: 0.707,
      slopeDbPerOct: 24,
      description: 'Bảo toàn tối đa vi chi tiết dải siêu âm tới 50 kHz, chỉ lọc bỏ nhiễu lượng tử hóa cực cao trên hệ thống loa ribbon/beryllium.'
    },
    analog_smooth: {
      id: 'analog_smooth',
      name: 'Analog Mượt mà (24 kHz Studio Linear Phase)',
      badge: 'ANALOG 24k',
      cutoffHz: 24000,
      qFactor: 0.707,
      slopeDbPerOct: 24,
      description: 'Roll-off êm ái tại 24 kHz, khử sạch méo xuyên điều chế (IMD) trên ampli đèn và tai nghe trở kháng thấp.'
    }
  };

  function getDsdUltrasonicFilter(filterKey) {
    const key = String(filterKey || 'bypass').toLowerCase();
    return DSD_ULTRASONIC_FILTERS[key] || DSD_ULTRASONIC_FILTERS.bypass;
  }

  function listDsdUltrasonicFilters() {
    return Object.values(DSD_ULTRASONIC_FILTERS);
  }

  function calculateUltrasonicFilterResponse(filterOrKey = 'sacd_standard', frequencyHz = 30000) {
    const filter = typeof filterOrKey === 'object' && filterOrKey !== null ? filterOrKey : getDsdUltrasonicFilter(filterOrKey);
    const f = Math.max(1, Number(frequencyHz) || 1000);
    if (!filter || filter.id === 'bypass' || !filter.cutoffHz) {
      return { frequencyHz: f, attenuationDb: 0, isFiltered: false };
    }
    const fc = filter.cutoffHz;
    // 4th order cascaded Butterworth (-24 dB/octave slope)
    const ratio = f / fc;
    const power = Math.pow(ratio, 8);
    const gainLinear = 1 / Math.sqrt(1 + power);
    const attenuationDb = Math.round(20 * Math.log10(Math.max(1e-6, gainLinear)) * 10) / 10;
    return {
      frequencyHz: f,
      cutoffHz: fc,
      attenuationDb,
      isFiltered: true
    };
  }

  function formatDsdUltrasonicFilterTelemetry(filterOrKey) {
    const filter = typeof filterOrKey === 'object' && filterOrKey !== null ? filterOrKey : getDsdUltrasonicFilter(filterOrKey);
    if (!filter || filter.id === 'bypass') {
      return '🛡️ Lọc DSD: Bypass Bit-Perfect (Không áp dụng lọc siêu âm)';
    }
    return `🛡️ Lọc DSD: ${filter.name.split(' (')[0]} (${filter.badge} · Cắt ${filter.cutoffHz / 1000} kHz · -${filter.slopeDbPerOct} dB/oct)`;
  }

  function calculateSpatialVectorSpectrogram(timeDataLeft, timeDataRight, options = {}) {
    const left = (timeDataLeft && timeDataLeft.length) ? timeDataLeft : new Uint8Array(64).fill(128);
    const right = (timeDataRight && timeDataRight.length) ? timeDataRight : new Uint8Array(64).fill(128);
    const numSamples = Math.min(left.length, right.length);

    let sumMidSq = 0;
    let sumSideSq = 0;
    let sumLeftSq = 0;
    let sumRightSq = 0;
    let sumDot = 0;

    const pointsCount = Math.min(32, Math.floor(numSamples / 2));
    const points = [];
    const step = Math.max(1, Math.floor(numSamples / pointsCount));

    for (let i = 0; i < numSamples; i++) {
      const l = (left[i] - 128) / 128;
      const r = (right[i] - 128) / 128;

      const mid = (l + r) * 0.707106;
      const side = (l - r) * 0.707106;

      sumMidSq += mid * mid;
      sumSideSq += side * side;
      sumLeftSq += l * l;
      sumRightSq += r * r;
      sumDot += l * r;

      if (i % step === 0 && points.length < pointsCount) {
        points.push({
          x: Math.round((r - l) * 0.707106 * 1000) / 1000,
          y: Math.round((l + r) * 0.707106 * 1000) / 1000
        });
      }
    }

    const rmsLeft = Math.sqrt(sumLeftSq / Math.max(1, numSamples));
    const rmsRight = Math.sqrt(sumRightSq / Math.max(1, numSamples));
    const rmsMid = Math.sqrt(sumMidSq / Math.max(1, numSamples));
    const rmsSide = Math.sqrt(sumSideSq / Math.max(1, numSamples));

    const denom = sumLeftSq + sumRightSq;
    const correlation = denom > 1e-6 ? Math.max(-1, Math.min(1, (2 * sumDot) / denom)) : 1.0;

    const widthRatio = (rmsMid + rmsSide) > 1e-6 ? (rmsSide / (rmsMid + rmsSide)) * 2 : 0;
    const soundstageSpread = Math.min(100, Math.round(widthRatio * 100));

    const totalRms = rmsLeft + rmsRight;
    const azimuthDegrees = totalRms > 1e-5 ? Math.round(((rmsRight - rmsLeft) / totalRms) * 450) / 10 : 0;

    let soundstageState = 'balanced';
    if (correlation < 0) soundstageState = 'phase_warning';
    else if (soundstageSpread > 75) soundstageState = 'ultra_wide';
    else if (soundstageSpread < 20) soundstageState = 'mono_focused';

    return {
      points,
      correlation: Math.round(correlation * 100) / 100,
      soundstageSpread,
      azimuthDegrees,
      soundstageState,
      rmsLeft: Math.round(rmsLeft * 1000) / 1000,
      rmsRight: Math.round(rmsRight * 1000) / 1000,
      rmsMid: Math.round(rmsMid * 1000) / 1000,
      rmsSide: Math.round(rmsSide * 1000) / 1000
    };
  }

  function formatSpatialVectorTelemetry(report) {
    if (!report || typeof report !== 'object') return '🧭 Âm hình 3D: Chưa có dữ liệu';
    const az = report.azimuthDegrees;
    const azText = az === 0 ? 'Trung tâm (Center 0°)' : az < 0 ? `Lệch Trái ${Math.abs(az)}°` : `Lệch Phải ${az}°`;
    const phaseLabel = report.correlation >= 0.8 ? 'Đồng pha tuyệt đối' : report.correlation >= 0 ? 'Stereo tự nhiên' : 'Cảnh báo lệch pha (Ø Warning)';
    return `🧭 Âm hình 3D: ${azText} · Độ mở ${report.soundstageSpread}% · ${phaseLabel} (r=${report.correlation >= 0 ? '+' : ''}${report.correlation.toFixed(2)})`;
  }

  function renderSpatialVectorCanvas(canvas, vectorReport, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const w = canvas.width || 300;
    const h = canvas.height || 150;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) * 0.85;

    if (typeof ctx.clearRect === 'function') {
      ctx.clearRect(0, 0, w, h);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach(rRatio => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * rRatio, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.stroke();

    const report = vectorReport || calculateSpatialVectorSpectrogram(null, null);
    const points = Array.isArray(report.points) ? report.points : [];

    if (points.length > 0) {
      const isWarn = report.soundstageState === 'phase_warning';
      const strokeColor = isWarn ? 'rgba(244, 63, 94, 0.85)' : 'rgba(168, 85, 247, 0.85)';
      const glowColor = isWarn ? 'rgba(244, 63, 94, 0.4)' : 'rgba(168, 85, 247, 0.35)';

      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = glowColor;
      ctx.lineWidth = 1.8;

      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const px = cx + (pt.x * radius);
        const py = cy - (pt.y * radius);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(168, 85, 247, 0.9)';
      ctx.shadowColor = 'rgba(168, 85, 247, 0.85)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();

      if (typeof ctx.fillText === 'function') {
        ctx.save();
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(168, 85, 247, 0.8)';
        ctx.fillText('STANDBY', cx, cy + 22);
        ctx.restore();
      }
    }
    return true;
  }

  // Pha C — Multi-Tier Favorites Collections & Smart Track Engagement Rating Analytics
  function calculateTrackEngagementRating(track, userRating, playStats) {
    const rawRating = Number(userRating || 0);
    const validUserRating = (Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5) ? Math.round(rawRating) : 0;
    const stats = (playStats && typeof playStats === 'object') ? playStats : {};
    const playCount = Math.max(0, Math.round(Number(stats.playCount || 0)));
    const skipCount = Math.max(0, Math.round(Number(stats.skipCount || 0)));
    const completionRate = Math.max(0, Math.min(1, Number(stats.completionRate ?? 1)));
    const isFavorite = Boolean(stats.isFavorite);

    // 1. Điểm đánh giá chủ quan từ người dùng (45% max)
    const ratingPoints = validUserRating > 0 ? (validUserRating / 5) * 45 : 0;

    // 2. Điểm tương tác phát nhạc thực tế (35% max)
    const playPoints = Math.min(15, playCount * 3);
    const completionPoints = completionRate * 15;
    const skipPenalty = Math.min(12, skipCount * 4);
    const behaviorPoints = Math.max(0, playPoints + completionPoints - skipPenalty);

    // 3. Điểm thưởng danh sách Yêu thích Heart/Bookmark (15% max)
    const favoritePoints = isFavorite ? 15 : 0;

    // 4. Điểm thưởng định dạng Audiophile Hi-Res (5% max)
    let audiophileBonus = 0;
    const fmt = (track && (track.format || track.title || '')).toString().toUpperCase();
    if (fmt.includes('DSD') || fmt.includes('DSF') || fmt.includes('DFF') || fmt.includes('FLAC') || fmt.includes('ALAC') || fmt.includes('WAV')) {
      audiophileBonus = 5;
    } else {
      audiophileBonus = 2;
    }

    let totalScore = ratingPoints + behaviorPoints + favoritePoints + audiophileBonus;
    if (validUserRating === 0 && playCount === 0 && !isFavorite) {
      totalScore = 0;
    }
    const engagementScore = Math.min(100, Math.max(0, Math.round(totalScore)));

    let compositeStars = 0;
    if (validUserRating > 0 && engagementScore > 0) {
      compositeStars = (validUserRating * 0.6) + ((engagementScore / 20) * 0.4);
    } else if (validUserRating > 0) {
      compositeStars = validUserRating;
    } else if (engagementScore > 0) {
      compositeStars = engagementScore / 20;
    } else {
      compositeStars = 0;
    }
    compositeStars = Math.min(5.0, Math.max(0.0, Math.round(compositeStars * 10) / 10));

    let tier = 'unranked';
    let tierLabel = 'Chưa xếp hạng';
    if (engagementScore >= 85 || validUserRating === 5) {
      tier = 'masterpiece';
      tierLabel = 'Tuyệt tác Masterpiece';
    } else if (engagementScore >= 65 || validUserRating === 4) {
      tier = 'loved_gem';
      tierLabel = 'Ngọc quý yêu thích';
    } else if (engagementScore >= 40 || validUserRating === 3) {
      tier = 'engaged';
      tierLabel = 'Gắn kết thường xuyên';
    } else if (engagementScore >= 15 || validUserRating >= 1) {
      tier = 'casual';
      tierLabel = 'Nghe phổ thông';
    }

    return {
      engagementScore,
      compositeStars,
      validUserRating,
      tier,
      tierLabel,
      isFavorite,
      playCount,
      skipCount,
      completionRate,
      audiophileBonus
    };
  }

  function categorizeFavoritesByMoodQuality(tracks, favoritesSet, ratingsMap, playStatsMap) {
    const list = Array.isArray(tracks) ? tracks : [];
    const favSet = (favoritesSet instanceof Set) ? favoritesSet : new Set(Array.isArray(favoritesSet) ? favoritesSet : []);
    const ratings = (ratingsMap && typeof ratingsMap === 'object') ? ratingsMap : {};
    const stats = (playStatsMap && typeof playStatsMap === 'object') ? playStatsMap : {};

    const all = [];
    const masterpieces = [];
    const audiophileLossless = [];
    const frequentGems = [];
    const rediscover = [];

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.id) continue;
      const tid = String(t.id);
      const isFav = favSet.has(tid) || favSet.has(Number(tid));
      const uRating = Number(ratings[tid] || ratings[Number(tid)] || t.rating || 0);
      const tStats = stats[tid] || stats[Number(tid)] || {};
      const engagement = calculateTrackEngagementRating(t, uRating, {
        playCount: tStats.playCount ?? t.playCount ?? 0,
        skipCount: tStats.skipCount ?? t.skipCount ?? 0,
        completionRate: tStats.completionRate ?? 1,
        isFavorite: isFav
      });

      if (!isFav && uRating < 4 && engagement.engagementScore < 70) {
        continue;
      }

      all.push(t);

      if (uRating === 5 || engagement.engagementScore >= 85) {
        masterpieces.push(t);
      }

      const fmt = (t.format || t.title || '').toString().toUpperCase();
      if (fmt.includes('DSD') || fmt.includes('DSF') || fmt.includes('DFF') || fmt.includes('FLAC') || fmt.includes('ALAC') || fmt.includes('WAV')) {
        audiophileLossless.push(t);
      }

      const pCount = Number(tStats.playCount ?? t.playCount ?? 0);
      const sCount = Number(tStats.skipCount ?? t.skipCount ?? 0);
      if (pCount >= 3 && sCount <= 1) {
        frequentGems.push(t);
      }

      if (isFav && pCount <= 1) {
        rediscover.push(t);
      }
    }

    return {
      all,
      masterpieces,
      audiophileLossless,
      frequentGems,
      rediscover,
      counts: {
        all: all.length,
        masterpieces: masterpieces.length,
        audiophileLossless: audiophileLossless.length,
        frequentGems: frequentGems.length,
        rediscover: rediscover.length
      }
    };
  }

  function formatTrackEngagementTelemetry(engagementResult) {
    if (!engagementResult || typeof engagementResult !== 'object') {
      return '⭐ Đánh giá: --★ (Chưa xếp hạng)';
    }
    const stars = Number(engagementResult.compositeStars || 0).toFixed(1);
    const score = Math.round(Number(engagementResult.engagementScore || 0));
    const label = engagementResult.tierLabel || 'Chưa xếp hạng';
    const uRating = engagementResult.validUserRating > 0 ? `${engagementResult.validUserRating}★ Thủ công` : 'Tự động';
    const plays = Math.round(Number(engagementResult.playCount || 0));
    return `⭐ Đánh giá: ${stars}★ (Độ gắn kết ${score}% · ${label} · ${uRating} · Nghe ${plays} lượt)`;
  }

  // Pha D — Priority-Weighted Offline Queue Prefetch Scheduler & Adaptive Concurrency Pipeline
  function calculatePrefetchPriorityScore(track, queueIndex, options = {}) {
    if (!track || typeof queueIndex !== 'number' || queueIndex < 1) {
      return { priorityScore: 0, priorityTier: 'low', reason: 'Invalid track or index' };
    }

    const networkTier = String(options.networkTier || 'high-speed').toLowerCase();
    const isSaveData = Boolean(options.saveData);
    const isFav = Boolean(options.isFavorite || track.isFavorite);
    const uRating = Number(options.userRating ?? track.rating ?? 0);

    if (networkTier === 'offline') {
      return { priorityScore: 0, priorityTier: 'low', reason: 'Network offline' };
    }

    if ((isSaveData || networkTier === 'constrained' || networkTier === 'throttled') && queueIndex > 1) {
      return { priorityScore: 0, priorityTier: 'low', reason: 'Constrained network defer' };
    }

    // 1. Điểm suy giảm theo khoảng cách hàng đợi (Queue Distance Decay: max 50 pts)
    let distanceScore = 0;
    if (queueIndex === 1) distanceScore = 50;
    else if (queueIndex === 2) distanceScore = 30;
    else if (queueIndex === 3) distanceScore = 15;
    else distanceScore = Math.max(2, 20 - (queueIndex * 3));

    // 2. Điểm yêu thích & rating (max 25 pts)
    const favoriteScore = isFav ? 12 : 0;
    const ratingScore = Math.min(13, Math.max(0, uRating * 2.6));

    // 3. Trọng tải Audiophile Hi-Res/DSD (max 10 pts)
    let audiophileScore = 0;
    const fmt = (track.format || track.title || '').toString().toUpperCase();
    if (track.isDsd || fmt.includes('DSD') || fmt.includes('DSF') || fmt.includes('DFF')) {
      audiophileScore = 10;
    } else if (fmt.includes('FLAC') || fmt.includes('ALAC') || fmt.includes('WAV') || (track.sampleRate && track.sampleRate > 48000)) {
      audiophileScore = 6;
    } else {
      audiophileScore = 2;
    }

    // 4. Điểm điều kiện mạng hiện tại (max 15 pts)
    let networkBonus = 0;
    if (networkTier === 'high-speed' || networkTier === 'high-bandwidth') {
      networkBonus = 15;
    } else if (networkTier === 'stable' || networkTier === 'standard') {
      networkBonus = 8;
    } else {
      networkBonus = 2;
    }

    let totalScore = distanceScore + favoriteScore + ratingScore + audiophileScore + networkBonus;
    const priorityScore = Math.min(100, Math.max(0, Math.round(totalScore)));

    let priorityTier = 'low';
    if (priorityScore >= 75) priorityTier = 'critical';
    else if (priorityScore >= 50) priorityTier = 'high';
    else if (priorityScore >= 25) priorityTier = 'normal';

    return {
      priorityScore,
      priorityTier,
      distanceScore,
      favoriteScore,
      ratingScore,
      audiophileScore,
      networkBonus
    };
  }

  function evaluateCachePipelineConcurrency(isAudioPlaying, networkTier) {
    const tier = String(networkTier || 'high-speed').toLowerCase();
    if (tier === 'offline') {
      return { maxConcurrent: 0, safeDelayMs: 0, isAudioPlaying: Boolean(isAudioPlaying), networkTier: tier };
    }

    if (isAudioPlaying) {
      return {
        maxConcurrent: 1,
        safeDelayMs: tier === 'constrained' || tier === 'throttled' ? 600 : 250,
        isAudioPlaying: true,
        networkTier: tier
      };
    }

    if (tier === 'high-speed' || tier === 'high-bandwidth') {
      return { maxConcurrent: 3, safeDelayMs: 50, isAudioPlaying: false, networkTier: tier };
    } else if (tier === 'stable' || tier === 'standard') {
      return { maxConcurrent: 2, safeDelayMs: 120, isAudioPlaying: false, networkTier: tier };
    } else {
      return { maxConcurrent: 1, safeDelayMs: 400, isAudioPlaying: false, networkTier: tier };
    }
  }

  function scheduleOfflineQueuePrefetch(queue, currentTrackId, cacheCatalog = new Set(), options = {}) {
    const q = Array.isArray(queue) ? queue : [];
    const cached = (cacheCatalog instanceof Set) ? cacheCatalog : new Set(Array.isArray(cacheCatalog) ? cacheCatalog : []);
    const isAudioPlaying = Boolean(options.isAudioPlaying);
    const networkTier = String(options.networkTier || 'high-speed').toLowerCase();
    const maxLookahead = Math.max(1, Math.min(10, Number(options.maxLookahead) || 5));
    const favSet = (options.favorites instanceof Set) ? options.favorites : new Set(Array.isArray(options.favorites) ? options.favorites : []);
    const ratings = (options.ratings && typeof options.ratings === 'object') ? options.ratings : {};

    let currIdx = -1;
    if (currentTrackId !== undefined && currentTrackId !== null) {
      currIdx = q.findIndex(t => (t && (String(t.id) === String(currentTrackId) || String(t) === String(currentTrackId))));
    }

    const startIdx = currIdx >= 0 ? currIdx + 1 : 0;
    const candidates = q.slice(startIdx, startIdx + maxLookahead);

    const tasks = [];
    let cachedCount = 0;
    let totalEstimatedBytes = 0;

    for (let i = 0; i < candidates.length; i++) {
      const track = typeof candidates[i] === 'object' && candidates[i] !== null ? candidates[i] : { id: candidates[i] };
      const tid = String(track.id);
      const isAlreadyCached = cached.has(tid) || cached.has(Number(tid));

      if (isAlreadyCached) {
        cachedCount++;
        continue;
      }

      const queueIndex = i + 1;
      const isFav = favSet.has(tid) || favSet.has(Number(tid)) || Boolean(track.isFavorite);
      const uRating = Number(ratings[tid] || ratings[Number(tid)] || track.rating || 0);

      const priority = calculatePrefetchPriorityScore(track, queueIndex, {
        networkTier,
        saveData: options.saveData,
        isAudioPlaying,
        isFavorite: isFav,
        userRating: uRating
      });

      if (priority.priorityScore <= 0) continue;

      const fmt = (track.format || track.title || '').toString().toUpperCase();
      const isDsd = track.isDsd || fmt.includes('DSD') || fmt.includes('DSF') || fmt.includes('DFF');
      const fetchMode = (priority.priorityScore >= 75 && networkTier !== 'constrained') ? 'full_track' : 'first_slice';

      let estBytes = 0;
      if (fetchMode === 'first_slice') {
        estBytes = isDsd ? 3 * 1024 * 1024 : 1024 * 1024;
      } else {
        estBytes = isDsd ? 80 * 1024 * 1024 : 28 * 1024 * 1024;
      }
      totalEstimatedBytes += estBytes;

      tasks.push({
        trackId: tid,
        track,
        queueIndex,
        priorityScore: priority.priorityScore,
        priorityTier: priority.priorityTier,
        fetchMode,
        estimatedBytes: estBytes
      });
    }

    tasks.sort((a, b) => b.priorityScore - a.priorityScore);

    const concurrency = evaluateCachePipelineConcurrency(isAudioPlaying, networkTier);

    return {
      tasks,
      cachedCount,
      pendingCount: tasks.length,
      totalEstimatedBytes,
      concurrency,
      timestamp: Date.now()
    };
  }

  function formatPrefetchQueueTelemetry(prefetchReport) {
    if (!prefetchReport || typeof prefetchReport !== 'object') {
      return '⚡ Lập lịch nạp: Không có bài chờ';
    }
    const pending = Number(prefetchReport.pendingCount || 0);
    const cached = Number(prefetchReport.cachedCount || 0);
    const conc = prefetchReport.concurrency || {};
    const maxC = conc.maxConcurrent || 0;
    const playingStr = conc.isAudioPlaying ? 'Đang phát' : 'Chờ';
    const mb = (Number(prefetchReport.totalEstimatedBytes || 0) / (1024 * 1024)).toFixed(1);

    return `⚡ Nạp ngầm hàng đợi: ${pending} bài chờ · ${maxC} luồng (${playingStr}) · ${cached} bài sẵn · Ước tính: ~${mb} MB`;
  }

  // Pha A — Sub-Bass Phase Alignment & Analog Bass Exciter Harmonic Generator
  const SUB_BASS_PHASE_PROFILES = {
    bypass: {
      id: 'bypass',
      name: 'Bypass (Nguyên bản Bit-Perfect)',
      phaseShiftDeg: 0,
      cutoffHz: 0,
      exciterDrive: 0,
      mixGain: 0,
      badge: 'BYPASS',
      description: 'Không can thiệp pha dải trầm, giữ nguyên bản tín hiệu tới DAC.'
    },
    tight_45: {
      id: 'tight_45',
      name: 'Bù pha +45° (Gọn chắc Kick)',
      phaseShiftDeg: 45,
      cutoffHz: 65,
      exciterDrive: 0.22,
      mixGain: 0.85,
      badge: 'PHASE +45°',
      description: 'Bù pha +45° tại 65Hz chống triệt tiêu pha âm học, tái tạo tiếng kick dứt khoát.'
    },
    deep_90: {
      id: 'deep_90',
      name: 'Bù pha +90° (Siêu trầm Sâu lắng)',
      phaseShiftDeg: 90,
      cutoffHz: 45,
      exciterDrive: 0.35,
      mixGain: 1.0,
      badge: 'DEEP +90°',
      description: 'Dịch chuyển pha +90° tại 45Hz mở rộng độ sâu dải sub-bass cho phim và giao hưởng.'
    },
    analog_exciter: {
      id: 'analog_exciter',
      name: 'Kích thích Hài âm Analog (Missing Fundamental)',
      phaseShiftDeg: 60,
      cutoffHz: 80,
      exciterDrive: 0.48,
      mixGain: 0.9,
      badge: 'EXCITER',
      description: 'Bơm hài âm bậc hai H2 và bậc ba H3 tái tạo dải trầm ấm áp trên mọi tai nghe và loa.'
    }
  };

  function getSubBassPhaseProfile(profileKey) {
    if (!profileKey || typeof profileKey !== 'string') return SUB_BASS_PHASE_PROFILES.bypass;
    return SUB_BASS_PHASE_PROFILES[profileKey] || SUB_BASS_PHASE_PROFILES.bypass;
  }

  function listSubBassPhaseProfiles() {
    return Object.values(SUB_BASS_PHASE_PROFILES);
  }

  function calculateSubBassPhaseParams(profileKey, options = {}) {
    const profile = getSubBassPhaseProfile(profileKey);
    if (profile.id === 'bypass') {
      return {
        profileId: 'bypass',
        phaseShiftDeg: 0,
        cutoffHz: 0,
        exciterDrive: 0,
        mixGain: 0,
        isActive: false
      };
    }

    const driveMultiplier = Math.max(0.2, Math.min(2.0, Number(options.intensity || 1.0)));
    const finalDrive = Math.min(0.95, Math.max(0.05, profile.exciterDrive * driveMultiplier));
    const finalCutoff = Number(options.cutoffHz || profile.cutoffHz);

    return {
      profileId: profile.id,
      phaseShiftDeg: profile.phaseShiftDeg,
      cutoffHz: finalCutoff,
      exciterDrive: Math.round(finalDrive * 100) / 100,
      mixGain: profile.mixGain,
      isActive: true
    };
  }

  function generateBassExciterTransferCurve(drive = 0.3, samples = 512) {
    const n = Math.max(128, Math.min(2048, Math.round(samples)));
    const curve = new Float32Array(n);
    const d = Math.max(0, Math.min(1.0, Number(drive)));

    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      if (d === 0) {
        curve[i] = x;
      } else {
        const softTanh = Math.tanh(x * (1 + d * 0.8));
        const harmonicH2 = 0.18 * d * (2 * x * x - 1);
        curve[i] = Math.max(-1.0, Math.min(1.0, softTanh + harmonicH2));
      }
    }
    return curve;
  }

  function formatSubBassPhaseTelemetry(profileKey, params = {}) {
    const profile = getSubBassPhaseProfile(profileKey);
    if (profile.id === 'bypass') {
      return '🔊 Pha Trầm: Bypass (Nguyên bản Bit-Perfect)';
    }
    const deg = params.phaseShiftDeg !== undefined ? params.phaseShiftDeg : profile.phaseShiftDeg;
    const hz = params.cutoffHz || profile.cutoffHz;
    const drivePct = Math.round((params.exciterDrive !== undefined ? params.exciterDrive : profile.exciterDrive) * 100);
    return `🔊 Pha Trầm: ${profile.name} (${deg >= 0 ? '+' : ''}${deg}° · Cắt ${hz} Hz · Hài âm ${drivePct}%)`;
  }

  // ── Pha B — UI/UX: 3D Polar Radar Soundstage Visualizer & Dynamic Phase Field Hologram ──
  const POLAR_RADAR_MODES = {
    contour: { id: 'contour', name: 'Khung Đa Giác Phân Cực (Polar Contour)' },
    hologram: { id: 'hologram', name: 'Đám Mây Hologram (Holographic Field)' },
    spectral: { id: 'spectral', name: 'Vành Đai Quang Phổ (Spectral Rings)' }
  };

  function getPolarRadarMode(modeId) {
    if (!modeId || typeof modeId !== 'string') return POLAR_RADAR_MODES.contour;
    return POLAR_RADAR_MODES[modeId.toLowerCase()] || POLAR_RADAR_MODES.contour;
  }

  function calculatePolarRadarSoundstage(timeDataLeft, timeDataRight, freqData, options = {}) {
    const left = (timeDataLeft && timeDataLeft.length) ? timeDataLeft : new Uint8Array(64).fill(128);
    const right = (timeDataRight && timeDataRight.length) ? timeDataRight : new Uint8Array(64).fill(128);
    const numSamples = Math.min(left.length, right.length);
    const numBins = Math.max(8, Math.min(32, Number(options.numBins) || 16));

    const bins = [];
    const binWidthDeg = 180 / numBins;
    for (let b = 0; b < numBins; b++) {
      const centerAngleDeg = -90 + (b + 0.5) * binWidthDeg;
      bins.push({
        binIndex: b,
        angleDeg: Math.round(centerAngleDeg),
        angleRad: (centerAngleDeg * Math.PI) / 180,
        energySum: 0,
        count: 0,
        radius: 0,
        coherence: 1.0
      });
    }

    let totalEnergy = 0;
    let weightedAngleSum = 0;
    let antiPhaseCount = 0;
    let sumL2 = 0, sumR2 = 0, sumLR = 0;

    const sampleStep = numSamples > 256 ? Math.floor(numSamples / 128) : 1;
    let processedSamples = 0;

    for (let i = 0; i < numSamples; i += sampleStep) {
      const l = (left[i] - 128) / 128;
      const r = (right[i] - 128) / 128;

      sumL2 += l * l;
      sumR2 += r * r;
      sumLR += l * r;
      processedSamples++;

      const mid = (l + r) / 1.4142;
      const side = (r - l) / 1.4142;
      const amp = Math.sqrt(mid * mid + side * side);

      if (amp < 0.005) continue;

      const sign = mid < 0 ? -1 : 1;
      const m = mid * sign;
      const s = side * sign;
      const thetaDeg = Math.max(-90, Math.min(90, (Math.atan2(s, Math.max(1e-6, m)) * 180 / Math.PI) * 2));

      if (l * r < -0.02 && Math.abs(l) > 0.08 && Math.abs(r) > 0.08) {
        antiPhaseCount++;
      }

      totalEnergy += amp;
      weightedAngleSum += thetaDeg * amp;

      const normBin = Math.max(0, Math.min(numBins - 1, Math.floor(((thetaDeg + 90) / 180) * numBins)));
      bins[normBin].energySum += amp;
      bins[normBin].count++;
    }

    let maxBinEnergy = 0.001;
    bins.forEach(b => {
      const avgE = b.count > 0 ? b.energySum / b.count : 0;
      b.radius = Math.min(1.0, avgE * 2.2);
      if (b.radius > maxBinEnergy) maxBinEnergy = b.radius;
    });

    bins.forEach(b => {
      b.radius = Math.min(1.0, Math.max(0.06, b.radius));
    });

    const centroidAzimuthDeg = totalEnergy > 0 ? Math.round(weightedAngleSum / totalEnergy) : 0;
    const denom = Math.sqrt(sumL2 * sumR2);
    const correlation = denom > 1e-6 ? Math.max(-1.0, Math.min(1.0, sumLR / denom)) : 1.0;
    const antiPhaseRatio = processedSamples > 0 ? antiPhaseCount / processedSamples : 0;

    let activeBins = 0;
    bins.forEach(b => { if (b.radius > 0.12) activeBins++; });
    const soundstageApertureDeg = Math.round(Math.min(180, Math.max(20, (activeBins / numBins) * 180)));
    const polarDepth = Math.round(Math.min(100, (totalEnergy / (processedSamples || 1)) * 300));

    let soundstageState = 'balanced_stereo';
    let statusLabel = 'Stereo Cân bằng';
    if (antiPhaseRatio > 0.28 || correlation < -0.1) {
      soundstageState = 'anti_phase_alert';
      statusLabel = 'Cảnh báo lệch pha (Anti-phase Alert)';
    } else if (soundstageApertureDeg >= 75) {
      soundstageState = 'wide_holographic';
      statusLabel = 'Sân khấu 3D Rộng Mở (Wide Holographic)';
    } else if (soundstageApertureDeg <= 30) {
      soundstageState = 'mono_focused';
      statusLabel = 'Âm hình Trung tâm Hội tụ (Mono Center)';
    }

    let spectralBands = { subBass: 0.5, mid: 0.5, high: 0.5 };
    if (freqData && freqData.length) {
      const fl = freqData.length;
      let eSub = 0, eMid = 0, eHigh = 0;
      const subEnd = Math.floor(fl * 0.1);
      const midEnd = Math.floor(fl * 0.5);
      for (let i = 0; i < subEnd; i++) eSub += freqData[i];
      for (let i = subEnd; i < midEnd; i++) eMid += freqData[i];
      for (let i = midEnd; i < fl; i++) eHigh += freqData[i];
      spectralBands = {
        subBass: Math.min(1.0, (eSub / (subEnd || 1)) / 180),
        mid: Math.min(1.0, (eMid / ((midEnd - subEnd) || 1)) / 180),
        high: Math.min(1.0, (eHigh / ((fl - midEnd) || 1)) / 180)
      };
    }

    return {
      centroidAzimuthDeg,
      soundstageApertureDeg,
      polarDepth,
      correlation: Number(correlation.toFixed(3)),
      antiPhaseRatio: Number(antiPhaseRatio.toFixed(3)),
      soundstageState,
      statusLabel,
      spectralBands,
      bins,
      totalEnergy: Number(totalEnergy.toFixed(2))
    };
  }

  function formatPolarRadarTelemetry(report) {
    if (!report || typeof report !== 'object') return '🎯 Radar Âm Hình: Chưa có dữ liệu';
    const az = report.centroidAzimuthDeg;
    const azStr = az === 0 ? 'Trung tâm (0°)' : az < 0 ? `Lệch Trái ${Math.abs(az)}°` : `Lệch Phải ${az}°`;
    const corrSign = report.correlation >= 0 ? '+' : '';
    const corrStr = `r=${corrSign}${report.correlation.toFixed(2)}`;
    return `🎯 Radar Âm Hình: ${azStr} · Khẩu độ ${report.soundstageApertureDeg}° · ${report.statusLabel} (${corrStr})`;
  }

  function renderPolarRadarCanvas(canvas, polarReport, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const w = canvas.width || 600;
    const h = canvas.height || 340;
    const cx = w / 2;
    const cy = h * 0.85;
    const maxR = Math.min(w * 0.44, h * 0.75);

    if (typeof ctx.clearRect === 'function') {
      ctx.clearRect(0, 0, w, h);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(10, 11, 16, 0.35)';
    ctx.fillRect(0, 0, w, h);

    const rings = [
      { rPct: 0.25, label: '-24 dB' },
      { rPct: 0.50, label: '-12 dB' },
      { rPct: 0.75, label: '-6 dB' },
      { rPct: 1.00, label: '0 dB' }
    ];

    ctx.lineWidth = 1;
    rings.forEach((ring, idx) => {
      const ringR = maxR * ring.rPct;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, Math.PI, 0, false);
      ctx.strokeStyle = idx === rings.length - 1 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.20)';
      ctx.stroke();

      ctx.fillStyle = 'rgba(212, 212, 216, 0.85)';
      ctx.font = '9px monospace';
      if (typeof ctx.fillText === 'function') {
        ctx.fillText(ring.label, cx + 4, cy - ringR + 10);
      }
    });

    const azimuthAngles = [-60, -45, -30, 0, 30, 45, 60];
    azimuthAngles.forEach(deg => {
      const rad = ((deg - 90) * Math.PI) / 180;
      const x2 = cx + maxR * Math.cos(rad);
      const y2 = cy + maxR * Math.sin(rad);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = deg === 0 ? 'rgba(168, 85, 247, 0.60)' : 'rgba(255, 255, 255, 0.20)';
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash(deg === 0 ? [] : [2, 4]);
      }
      ctx.stroke();
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([]);
      }

      const labelX = cx + (maxR + 12) * Math.cos(rad);
      const labelY = cy + (maxR + 12) * Math.sin(rad);
      ctx.fillStyle = deg === 0 ? 'rgba(192, 132, 252, 0.90)' : 'rgba(161, 161, 170, 0.75)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      if (typeof ctx.fillText === 'function') {
        ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, labelX, labelY + 3);
      }
    });

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(244, 114, 182, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('◄ TRÁI (L -90°)', cx - maxR - 10, cy + 14);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('PHẢI (R +90°) ►', cx + maxR + 10, cy + 14);

    const sweepAngle = options.sweepAngle !== undefined
      ? options.sweepAngle
      : ((Date.now() / 25) % 180) - 90;
    const sweepRad = ((sweepAngle - 90) * Math.PI) / 180;

    let sweepGrad = 'rgba(168, 85, 247, 0.25)';
    if (typeof ctx.createRadialGradient === 'function') {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      if (g && typeof g.addColorStop === 'function') {
        g.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
        g.addColorStop(0.8, 'rgba(56, 189, 248, 0.12)');
        g.addColorStop(1, 'rgba(56, 189, 248, 0)');
        sweepGrad = g;
      }
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, sweepRad - 0.15, sweepRad + 0.15);
    if (typeof ctx.closePath === 'function') ctx.closePath();
    ctx.fillStyle = sweepGrad;
    ctx.fill();

    const report = polarReport || calculatePolarRadarSoundstage(null, null, null);
    const bins = Array.isArray(report.bins) ? report.bins : [];

    if (bins.length > 0) {
      const isAntiPhase = report.soundstageState === 'anti_phase_alert';
      let polyGrad = isAntiPhase ? 'rgba(244, 63, 94, 0.35)' : 'rgba(168, 85, 247, 0.35)';
      if (typeof ctx.createRadialGradient === 'function') {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
        if (g && typeof g.addColorStop === 'function') {
          if (isAntiPhase) {
            g.addColorStop(0, 'rgba(244, 63, 94, 0.45)');
            g.addColorStop(1, 'rgba(244, 63, 94, 0.05)');
          } else {
            g.addColorStop(0, 'rgba(168, 85, 247, 0.40)');
            g.addColorStop(0.6, 'rgba(56, 189, 248, 0.25)');
            g.addColorStop(1, 'rgba(34, 197, 94, 0.05)');
          }
          polyGrad = g;
        }
      }

      ctx.beginPath();
      ctx.moveTo(cx, cy);

      const pts = [];
      bins.forEach(b => {
        const rad = ((b.angleDeg - 90) * Math.PI) / 180;
        const r = maxR * Math.max(0.08, Math.min(1.0, b.radius));
        const px = cx + r * Math.cos(rad);
        const py = cy + r * Math.sin(rad);
        pts.push({ x: px, y: py, r, rad, angleDeg: b.angleDeg });
      });

      pts.forEach((pt, i) => {
        if (i === 0) ctx.lineTo(pt.x, pt.y);
        else {
          const prev = pts[i - 1];
          const midX = (prev.x + pt.x) / 2;
          const midY = (prev.y + pt.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
      });
      if (pts.length > 0) {
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      ctx.lineTo(cx, cy);
      if (typeof ctx.closePath === 'function') ctx.closePath();

      ctx.fillStyle = polyGrad;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = isAntiPhase ? 'rgba(244, 63, 94, 0.9)' : 'rgba(192, 132, 252, 0.85)';
      ctx.stroke();

      pts.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = isAntiPhase ? '#fb7185' : '#c084fc';
        ctx.shadowColor = isAntiPhase ? '#f43f5e' : '#a855f7';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    }

    const azRad = ((report.centroidAzimuthDeg - 90) * Math.PI) / 180;
    const azX = cx + (maxR * 0.92) * Math.cos(azRad);
    const azY = cy + (maxR * 0.92) * Math.sin(azRad);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(azX, azY);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(azX, azY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
    return true;
  }

  function createOptimisticTrackState(track, previousState = {}) {
    if (!track) return previousState;
    return {
      ...previousState,
      currentId: track.id,
      playbackStatus: 'buffering',
      optimisticLoading: true,
      currentTime: 0,
      seekFraction: 0,
      activeTrack: track
    };
  }

  function formatSelectionLatency(latencyMs) {
    const ms = Number(latencyMs) || 0;
    if (ms < 16) return `< 16ms · Phản hồi tức thì (< 1 khung hình 60fps)`;
    return `${ms.toFixed(1)}ms · Phản hồi giao diện`;
  }

  function canStartInstantPlayback(track, cacheIndex = {}) {
    if (!track) return { instant: false, reason: 'no_track', mode: 'none' };
    if (track.source === 'local' || track.file || (track.url && String(track.url).startsWith('blob:'))) {
      return { instant: true, reason: 'local_file_in_memory', mode: 'local' };
    }
    if (track.firstSliceCached || (cacheIndex && cacheIndex[track.id])) {
      return { instant: true, reason: 'first_slice_cached_in_storage', mode: 'cached-slice' };
    }
    if (track.isPreloaded) {
      return { instant: true, reason: 'preloaded_standby_deck', mode: 'preload' };
    }
    return { instant: false, reason: 'requires_range_fetch', mode: 'network' };
  }

  function scheduleNonBlockingTask(taskFn, options = {}) {
    if (typeof taskFn !== 'function') return null;
    const preferIdle = Boolean(options && options.preferIdle);
    if (preferIdle && typeof requestIdleCallback === 'function') {
      return requestIdleCallback(taskFn, { timeout: options.timeout || 100 });
    }
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(taskFn);
    }
    return setTimeout(taskFn, 0);
  }

  function buildAlbumKey(track) {
    if (!track || typeof track !== 'object') return ':::';
    const artist = ((track.artist || track.albumArtist || '') + '').trim().toLowerCase();
    const album = ((track.album || track.albumName || '') + '').trim().toLowerCase();
    return `${artist}:::${album}`;
  }

  function isBetterCover(candidate, current) {
    if (!candidate || typeof candidate !== 'string' || candidate.trim() === '' || candidate === '♫') return false;
    if (!current || typeof current !== 'string' || current.trim() === '' || current === '♫') return true;
    if (candidate === current) return false;
    return candidate.length > current.length;
  }

  function propagateAlbumCovers(tracks, coverMap) {
    if (!coverMap) coverMap = new Map();
    const isMap = coverMap instanceof Map;
    const getCover = key => isMap ? coverMap.get(key) : (coverMap ? coverMap[key] : undefined);
    const setCover = (key, val) => {
      if (isMap) coverMap.set(key, val);
      else if (coverMap && typeof coverMap === 'object') coverMap[key] = val;
    };

    if (!Array.isArray(tracks)) {
      return { updatedCount: 0, coverMap };
    }

    for (const track of tracks) {
      if (!track || typeof track !== 'object') continue;
      const key = buildAlbumKey(track);
      if (!key || key === ':::') continue;
      if (track.cover && track.cover !== '♫') {
        const existing = getCover(key);
        if (!existing || isBetterCover(track.cover, existing)) {
          setCover(key, track.cover);
        }
      }
    }

    let updatedCount = 0;
    for (const track of tracks) {
      if (!track || typeof track !== 'object') continue;
      const key = buildAlbumKey(track);
      if (!key || key === ':::') continue;
      const best = getCover(key);
      if (best) {
        if (!track.cover || isBetterCover(best, track.cover)) {
          track.cover = best;
          updatedCount++;
        }
      }
    }

    return { updatedCount, coverMap };
  }

  function resolveTrackCover(track, coverMap, allTracks) {
    if (!track || typeof track !== 'object') return null;
    if (track.cover && track.cover !== '♫') return track.cover;

    const isMap = coverMap instanceof Map;
    const getCover = key => isMap ? coverMap.get(key) : (coverMap ? coverMap[key] : undefined);
    const setCover = (key, val) => {
      if (isMap) coverMap.set(key, val);
      else if (coverMap && typeof coverMap === 'object') coverMap[key] = val;
    };

    const key = buildAlbumKey(track);
    let resolved = null;

    if (key && key !== ':::') {
      const fromMap = getCover(key);
      if (fromMap && fromMap !== '♫') {
        resolved = fromMap;
      }
    }

    if (!resolved && Array.isArray(allTracks) && key && key !== ':::') {
      for (const sibling of allTracks) {
        if (!sibling || sibling === track || !sibling.cover || sibling.cover === '♫') continue;
        if (buildAlbumKey(sibling) === key) {
          resolved = sibling.cover;
          break;
        }
      }
    }

    if (!resolved && track.album) {
      const albumClean = String(track.album).trim().toLowerCase();
      if (albumClean && albumClean !== '—' && albumClean !== 'unknown album') {
        if (Array.isArray(allTracks)) {
          for (const sibling of allTracks) {
            if (!sibling || sibling === track || !sibling.cover || sibling.cover === '♫') continue;
            const sibAlbum = String(sibling.album || '').trim().toLowerCase();
            if (sibAlbum === albumClean) {
              resolved = sibling.cover;
              break;
            }
          }
        }
      }
    }

    if (resolved) {
      track.cover = resolved;
      if (key && key !== ':::' && coverMap) {
        setCover(key, resolved);
      }
    }

    return resolved || null;
  }

  function extractFolderArtCandidates(files) {
    if (!files) return [];
    const list = Array.from(files).filter(Boolean);
    const imageRegex = /\.(jpe?g|png|webp|bmp|gif)$/i;
    const candidates = [];

    for (const file of list) {
      if (!file || typeof file !== 'object') continue;
      const fileName = file.name || '';
      if (!fileName || !imageRegex.test(fileName)) continue;

      const fullPath = file.relativePath || file.webkitRelativePath || fileName || '';
      let dir = '';
      if (fullPath.includes('/')) {
        dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
      } else if (fullPath.includes('\\')) {
        dir = fullPath.slice(0, fullPath.lastIndexOf('\\'));
      }

      const baseName = fileName.replace(/\.[^.]+$/, '').toLowerCase().trim();

      let score = 10;
      if (baseName === 'cover') score = 100;
      else if (baseName === 'folder') score = 95;
      else if (baseName === 'front') score = 90;
      else if (baseName === 'albumart' || baseName === 'album_art' || baseName === 'album art') score = 85;
      else if (baseName === 'album' || baseName === 'artwork') score = 80;
      else if (baseName.includes('cover')) score = 75;
      else if (baseName.includes('front')) score = 70;
      else if (baseName.includes('folder')) score = 65;
      else if (baseName.includes('art')) score = 50;

      let item = file;
      try {
        file.file = file;
        file.directory = dir;
        file.score = score;
      } catch (_) {
        item = Object.assign(Object.create(file), {
          name: fileName,
          file: file,
          directory: dir,
          score: score
        });
      }

      candidates.push(item);
    }

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    return candidates;
  }

  function extractTrackDirectory(track) {
    if (!track) return '';
    const fullPath = track.path || track.relativePath || track.webkitRelativePath || track.filePath || track.url || '';
    if (typeof fullPath !== 'string') return '';
    if (fullPath.includes('/')) return fullPath.slice(0, fullPath.lastIndexOf('/'));
    if (fullPath.includes('\\')) return fullPath.slice(0, fullPath.lastIndexOf('\\'));
    return '';
  }

  function instantResolveTrackCover(track, coverMap, allTracks) {
    if (!track || typeof track !== 'object') return null;

    // Tier 1: Direct cover
    if (track.cover && track.cover !== '♫') return track.cover;

    const isMap = coverMap instanceof Map;
    const getCover = key => isMap ? coverMap.get(key) : (coverMap ? coverMap[key] : undefined);
    const setCover = (key, val) => {
      if (isMap) coverMap.set(key, val);
      else if (coverMap && typeof coverMap === 'object') coverMap[key] = val;
    };

    const albumKey = buildAlbumKey(track);

    // Tier 2: Album key lookup in coverMap
    if (albumKey && albumKey !== ':::') {
      const fromMap = getCover(albumKey);
      if (fromMap && fromMap !== '♫') {
        track.cover = fromMap;
        return fromMap;
      }
    }

    let resolved = null;
    const tracksList = Array.isArray(allTracks) ? allTracks : [];

    // Tier 3: Normalized Album Title matching
    const albumClean = track.album ? String(track.album).trim().toLowerCase() : '';
    const hasValidAlbum = albumClean && albumClean !== '—' && albumClean !== 'unknown album' && albumClean !== 'unknown';

    if (!resolved && hasValidAlbum && tracksList.length > 0) {
      for (let i = 0; i < tracksList.length; i++) {
        const sibling = tracksList[i];
        if (!sibling || sibling === track || !sibling.cover || sibling.cover === '♫') continue;
        const sibAlbum = String(sibling.album || '').trim().toLowerCase();
        if (sibAlbum === albumClean) {
          resolved = sibling.cover;
          break;
        }
      }
    }

    // Tier 4: Folder/Directory match
    const trackDir = extractTrackDirectory(track);
    if (!resolved && trackDir && tracksList.length > 0) {
      for (let i = 0; i < tracksList.length; i++) {
        const sibling = tracksList[i];
        if (!sibling || sibling === track || !sibling.cover || sibling.cover === '♫') continue;
        const sibDir = extractTrackDirectory(sibling);
        if (sibDir && sibDir === trackDir) {
          resolved = sibling.cover;
          break;
        }
      }
    }

    // Tier 5: Artist unique cover (fallback)
    const artistClean = track.artist ? String(track.artist).trim().toLowerCase() : '';
    const hasValidArtist = artistClean && artistClean !== '—' && artistClean !== 'unknown artist' && artistClean !== 'unknown';
    if (!resolved && hasValidArtist && tracksList.length > 0) {
      for (let i = 0; i < tracksList.length; i++) {
        const sibling = tracksList[i];
        if (!sibling || sibling === track || !sibling.cover || sibling.cover === '♫') continue;
        const sibArtist = String(sibling.artist || '').trim().toLowerCase();
        if (sibArtist === artistClean) {
          resolved = sibling.cover;
          break;
        }
      }
    }

    // Tier 6: Cache into coverMap
    if (resolved) {
      track.cover = resolved;
      if (albumKey && albumKey !== ':::' && coverMap) {
        setCover(albumKey, resolved);
      }
      if (albumClean && coverMap) {
        setCover(`album::${albumClean}`, resolved);
      }
    }

    return resolved || null;
  }

  function instantPropagateCovers(tracks, coverMap) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return { updatedCount: 0, updatedTracks: [], updatedTrackIds: [], coverMap };
    }

    const isMap = coverMap instanceof Map;
    const getCover = key => isMap ? coverMap.get(key) : (coverMap ? coverMap[key] : undefined);
    const setCover = (key, val) => {
      if (isMap) coverMap.set(key, val);
      else if (coverMap && typeof coverMap === 'object') coverMap[key] = val;
    };

    const albumKeyMap = new Map();
    const albumTitleMap = new Map();
    const dirMap = new Map();

    if (isMap) {
      for (const [k, v] of coverMap.entries()) {
        if (v && v !== '♫') albumKeyMap.set(k, v);
      }
    } else if (coverMap && typeof coverMap === 'object') {
      for (const k of Object.keys(coverMap)) {
        const v = coverMap[k];
        if (v && v !== '♫') albumKeyMap.set(k, v);
      }
    }

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t || typeof t !== 'object') continue;
      const c = t.cover;
      if (!c || c === '♫') continue;

      const aKey = buildAlbumKey(t);
      if (aKey && aKey !== ':::') {
        if (!albumKeyMap.has(aKey) || isBetterCover(c, albumKeyMap.get(aKey))) {
          albumKeyMap.set(aKey, c);
          setCover(aKey, c);
        }
      }

      if (t.album) {
        const aClean = String(t.album).trim().toLowerCase();
        if (aClean && aClean !== '—' && aClean !== 'unknown album') {
          if (!albumTitleMap.has(aClean) || isBetterCover(c, albumTitleMap.get(aClean))) {
            albumTitleMap.set(aClean, c);
          }
        }
      }

      const dir = extractTrackDirectory(t);
      if (dir) {
        if (!dirMap.has(dir) || isBetterCover(c, dirMap.get(dir))) {
          dirMap.set(dir, c);
        }
      }
    }

    const updatedTracks = [];
    const updatedTrackIds = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t || typeof t !== 'object') continue;
      if (t.cover && t.cover !== '♫') continue;

      let found = null;
      const aKey = buildAlbumKey(t);
      if (aKey && aKey !== ':::') {
        found = albumKeyMap.get(aKey);
      }

      if (!found && t.album) {
        const aClean = String(t.album).trim().toLowerCase();
        if (aClean) found = albumTitleMap.get(aClean);
      }

      if (!found) {
        const dir = extractTrackDirectory(t);
        if (dir) found = dirMap.get(dir);
      }

      if (found) {
        t.cover = found;
        updatedTracks.push(t);
        if (t.id !== undefined) updatedTrackIds.push(t.id);
        if (aKey && aKey !== ':::') setCover(aKey, found);
      }
    }

    return {
      updatedCount: updatedTracks.length,
      updatedTracks,
      updatedTrackIds,
      coverMap
    };
  }

  // FiiO M11S & Android Audiophile DAP Helpers
  function createFiioTrack(file) {
    if (!file || typeof file !== 'object') return null;
    const path = file.path || '';
    const name = file.name || (path ? path.split(/[/\\]/).pop() : 'Unknown Track');
    const title = name.replace(/\.[^/.]+$/, '');
    const encoded = encodeURIComponent(path);
    let b64 = '';
    try {
      b64 = (typeof btoa === 'function') ? btoa(encoded) : Buffer.from(encoded).toString('base64');
    } catch (_) {
      b64 = Math.random().toString(36).slice(2, 10);
    }
    const safeBase = b64.replace(/=/g, '').slice(-16);
    const randPart = Math.random().toString(36).slice(2, 6);
    const id = 'fiio_' + safeBase + '_' + randPart;

    return {
      id,
      title,
      name: title,
      path,
      source: 'local',
      url: 'https://appassets.androidplatform.net/local-media?path=' + encoded,
      size: Number(file.size) || 0,
      isDsd: /\.(dsf|dff)$/i.test(name),
      format: name.split('.').pop().toUpperCase(),
      artist: 'Unknown Artist',
      album: 'FiiO Internal & SD Card',
      duration: 0
    };
  }

  function parseFiioScanResults(rawFiles) {
    if (!rawFiles) return [];
    let files = rawFiles;
    if (typeof rawFiles === 'string') {
      try {
        files = JSON.parse(rawFiles);
      } catch (_) {
        return [];
      }
    }
    if (!Array.isArray(files)) return [];
    const seen = new Set();
    const tracks = [];
    for (const f of files) {
      if (!f || !f.path) continue;
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const track = createFiioTrack(f);
      if (track) tracks.push(track);
    }
    return tracks;
  }

  function isFiioDapEnvironment(win) {
    const targetWin = win || (typeof window !== 'undefined' ? window : null);
    if (!targetWin) return false;
    return Boolean(targetWin.isNativeAndroid || targetWin.NocturneNative);
  }

  function getFiioDapMode(storage, win) {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const isNative = isFiioDapEnvironment(win);
    if (!s) return isNative;
    try {
      const val = s.getItem('nocturne-fiio-dap-mode');
      if (val !== null && val !== undefined) return val === 'true';
    } catch (_) {}
    return isNative;
  }

  function formatFiioScanTelemetry(totalFound, addedCount) {
    const found = Math.max(0, Number(totalFound) || 0);
    return `Đã quét xong: tìm thấy ${found} bài hát trên bộ nhớ FiiO & thẻ MicroSD.`;
  }

  // Cloud OAuth Token Parser & Error Diagnostics (Google Drive & Microsoft OneDrive)
  function parseCloudAuthTokenInput(rawInput, provider = 'generic') {
    const defaultExpires = 3600;
    const stripOuterQuotes = str => String(str || '').trim().replace(/^['"`]+|['"`]+$/g, '').trim();
    const stripBearer = str => {
      const unquoted = stripOuterQuotes(str);
      if (/^bearer(?:\s+|$)/i.test(unquoted)) {
        return { value: stripOuterQuotes(unquoted.replace(/^bearer\s*/i, '')), hadBearer: true };
      }
      return { value: unquoted, hadBearer: false };
    };
    const parseExpires = val => {
      const num = Number(val);
      return Number.isFinite(num) && num > 0 ? Math.floor(num) : defaultExpires;
    };
    const isValidTokenString = (tok, fmt) => {
      if (!tok || typeof tok !== 'string') return false;
      if (/\s/.test(tok) || /[<>{}"'`]/.test(tok)) return false;
      if (/^https?:\/\//i.test(tok) || /^[?#&]/.test(tok) || /^error=/i.test(tok)) return false;
      if (fmt === 'url' || fmt === 'json' || fmt === 'bearer') return tok.length >= 2;
      if (/^(?:ya29\.|Ew|eyJ|1\/\/)/i.test(tok)) return tok.length >= 4;
      return tok.length >= 3;
    };

    if (rawInput && typeof rawInput === 'object') {
      const rawTok = rawInput.access_token ?? rawInput.accessToken ?? rawInput.token ?? '';
      const cleaned = stripBearer(rawTok).value;
      const expiresInSeconds = parseExpires(rawInput.expires_in ?? rawInput.expiresIn ?? rawInput.expiresInSeconds);
      const isValidFormat = isValidTokenString(cleaned, 'json');
      return {
        token: isValidFormat ? cleaned : '',
        expiresInSeconds,
        sourceFormat: 'json',
        isValidFormat
      };
    }

    if (typeof rawInput !== 'string') {
      return { token: '', expiresInSeconds: defaultExpires, sourceFormat: 'empty', isValidFormat: false };
    }

    const trimmed = rawInput.trim();
    if (!trimmed) {
      return { token: '', expiresInSeconds: defaultExpires, sourceFormat: 'empty', isValidFormat: false };
    }

    if (trimmed.startsWith('{') || /"(?:access_token|accessToken|token)"\s*:/i.test(trimmed)) {
      let parsedObj = null;
      try {
        parsedObj = JSON.parse(trimmed);
      } catch (_) {
        try {
          parsedObj = JSON.parse(`{${trimmed.replace(/^[,\s]+|[,\s]+$/g, '')}}`);
        } catch (_2) {}
      }
      if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
        const rawTok = parsedObj.access_token ?? parsedObj.accessToken ?? parsedObj.token ?? '';
        const cleaned = stripBearer(rawTok).value;
        const expiresInSeconds = parseExpires(parsedObj.expires_in ?? parsedObj.expiresIn ?? parsedObj.expiresInSeconds);
        const isValidFormat = isValidTokenString(cleaned, 'json');
        return {
          token: isValidFormat ? cleaned : '',
          expiresInSeconds,
          sourceFormat: 'json',
          isValidFormat
        };
      }
      const tokenSnippetMatch = trimmed.match(/"(?:access_token|accessToken|token)"\s*:\s*"([^"]*)"/i);
      if (tokenSnippetMatch) {
        const cleaned = stripBearer(tokenSnippetMatch[1]).value;
        const expMatch = trimmed.match(/"(?:expires_in|expiresIn|expiresInSeconds)"\s*:\s*"?(\d+)"?/i);
        const expiresInSeconds = expMatch ? parseExpires(expMatch[1]) : defaultExpires;
        const isValidFormat = isValidTokenString(cleaned, 'json');
        return {
          token: isValidFormat ? cleaned : '',
          expiresInSeconds,
          sourceFormat: 'json',
          isValidFormat
        };
      }
      if (trimmed.startsWith('{')) {
        return { token: '', expiresInSeconds: defaultExpires, sourceFormat: 'json', isValidFormat: false };
      }
    }

    const unquoted = stripOuterQuotes(trimmed);
    const hasAccessTokenParam = /(?:^|[?#&\s])access_token\s*=/i.test(unquoted);
    const looksLikeUrlOrParams = /^https?:\/\//i.test(unquoted) || /^[?#]/.test(unquoted) || hasAccessTokenParam;
    if (looksLikeUrlOrParams) {
      const tokenMatch = unquoted.match(/(?:^|[?#&\s])access_token\s*=\s*([^&#]*)/i);
      const expMatch = unquoted.match(/(?:^|[?#&\s])expires_in\s*=\s*(\d+)/i);
      const expiresInSeconds = expMatch ? parseExpires(expMatch[1]) : defaultExpires;
      if (tokenMatch) {
        let decoded = tokenMatch[1].trim();
        try {
          decoded = decodeURIComponent(decoded).trim();
        } catch (_) {}
        const cleaned = stripBearer(decoded).value;
        const isValidFormat = isValidTokenString(cleaned, 'url');
        return {
          token: isValidFormat ? cleaned : '',
          expiresInSeconds,
          sourceFormat: 'url',
          isValidFormat
        };
      }
      return { token: '', expiresInSeconds, sourceFormat: 'url', isValidFormat: false };
    }

    const bearerResult = stripBearer(unquoted);
    if (bearerResult.hadBearer) {
      const isValidFormat = isValidTokenString(bearerResult.value, 'bearer');
      return {
        token: isValidFormat ? bearerResult.value : '',
        expiresInSeconds: defaultExpires,
        sourceFormat: 'bearer',
        isValidFormat
      };
    }

    const rawCandidate = bearerResult.value;
    if (!rawCandidate) {
      return { token: '', expiresInSeconds: defaultExpires, sourceFormat: 'empty', isValidFormat: false };
    }
    const isValidFormat = isValidTokenString(rawCandidate, 'raw');
    return {
      token: isValidFormat ? rawCandidate : '',
      expiresInSeconds: defaultExpires,
      sourceFormat: 'raw',
      isValidFormat
    };
  }

  function diagnoseCloudAuthError(provider, errorInput, env = {}) {
    const normProvider = String(provider || 'generic').toLowerCase().trim();
    const isGoogle = normProvider === 'google' || normProvider === 'gdrive' || normProvider === 'drive';
    const isMicrosoft = normProvider === 'microsoft' || normProvider === 'onedrive' || normProvider === 'msal';
    const providerLabel = isGoogle ? 'Google Drive' : (isMicrosoft ? 'OneDrive' : 'Cloud');
    const safeEnv = env && typeof env === 'object' ? env : {};

    const parts = [];
    if (typeof errorInput === 'string') {
      parts.push(errorInput);
    } else if (errorInput && typeof errorInput === 'object') {
      for (const key of ['errorCode', 'error', 'subError', 'code', 'status', 'name', 'message', 'error_description', 'errorMessage', 'type']) {
        if (errorInput[key] !== undefined && errorInput[key] !== null) {
          parts.push(String(errorInput[key]));
        }
      }
    } else if (errorInput !== undefined && errorInput !== null) {
      parts.push(String(errorInput));
    }
    const rawText = parts.join(' ').replace(/\s+/g, ' ').trim();

    if (safeEnv.isSecureContext === false || /insecure_context|crypto\.subtle|pkce.*https/i.test(rawText)) {
      return {
        code: 'insecure_context',
        title: `Yêu cầu kết nối bảo mật HTTPS / Localhost (${providerLabel})`,
        reasonVi: 'Trình duyệt chặn xác thực OAuth 2.0 PKCE / WebCrypto khi trang web chạy trên giao thức HTTP không bảo mật (ngoài localhost).',
        actionVi: 'Hãy mở ứng dụng qua địa chỉ HTTPS hoặc localhost, hoặc dùng ngay mục [🔑 Dán Token Siêu Tốc] bên dưới để kết nối trực tiếp.',
        recommendFastToken: true
      };
    }

    if (/disallowed_useragent|embedded\s*webview/i.test(rawText) || Boolean(safeEnv.isNativeAndroid)) {
      return {
        code: 'webview_disallowed',
        title: `${providerLabel} chặn đăng nhập trong WebView nhúng`,
        reasonVi: 'Google và Microsoft chặn cửa sổ OAuth nhúng bên trong Android WebView (lỗi disallowed_useragent trên máy nghe nhạc DAP FiiO / Android) vì lý do bảo mật.',
        actionVi: 'Hãy dùng ngay mục [🔑 Dán Token Siêu Tốc] bên dưới: nhấn nút mở trình duyệt ngoài để lấy mã rồi chạm [📋 Dán & Kết nối].',
        recommendFastToken: true
      };
    }

    if (/unauthorized_client|not enabled for consumers|invalid_client|oauth client was not found|aadsts700016|aadsts70002/i.test(rawText)) {
      return {
        code: 'unauthorized_consumer_client',
        title: `Client ID ${providerLabel} chưa bật cho tài khoản cá nhân (Consumer)`,
        reasonVi: 'Client ID hiện tại chưa được đăng ký cho tài khoản cá nhân (Personal Microsoft / Google Consumer Account) hoặc không tồn tại trên hệ thống OAuth.',
        actionVi: 'Khuyên dùng: Sử dụng mục [🔑 Dán Token Siêu Tốc] bên dưới (lấy Token từ Graph Explorer / OAuth Playground trong 10 giây), hoặc nhập Client ID riêng tại mục [⚙ Cấu hình Client ID tự tạo].',
        recommendFastToken: true
      };
    }

    if (/origin_mismatch|redirect_uri_mismatch|redirect_uri|invalid_request|aadsts50011|storagerelay/i.test(rawText)) {
      return {
        code: 'origin_or_redirect_mismatch',
        title: `Lệch địa chỉ Origin / Redirect URI (${providerLabel})`,
        reasonVi: 'Địa chỉ trang web hiện tại chưa khớp với danh sách Authorized JavaScript Origins hoặc SPA Redirect URI đã khai báo cho Client ID.',
        actionVi: 'Hãy dùng ngay mục [🔑 Dán Token Siêu Tốc] bên dưới để kết nối tức thì không phụ thuộc Redirect URI, hoặc thêm Origin hiện tại vào Google Cloud Console / Azure Portal.',
        recommendFastToken: true
      };
    }

    if (/access_denied|not completed the google verification process|\b403\b|verification process|unverified_app/i.test(rawText)) {
      return {
        code: 'testing_or_access_denied',
        title: `Ứng dụng OAuth đang ở chế độ Testing hoặc bị từ chối (${providerLabel})`,
        reasonVi: 'Dự án trên Google Cloud Console đang ở chế độ "Testing" (chưa chuyển sang "In Production" hoặc tài khoản chưa được thêm vào danh sách Test Users), hoặc quyền truy cập đã bị từ chối.',
        actionVi: 'Hãy dùng ngay mục [🔑 Dán Token Siêu Tốc] bên dưới để kết nối nhanh, hoặc vào Google Cloud Console -> OAuth consent screen chuyển sang "In Production" / thêm email vào Test Users.',
        recommendFastToken: true
      };
    }

    if (/popup_window_error|popup_blocked|popup_failed_to_open|popup_closed|user_cancelled|user_canceled|access_token_not_returned/i.test(rawText)) {
      return {
        code: 'popup_blocked',
        title: `Cửa sổ đăng nhập Popup bị chặn hoặc đã đóng (${providerLabel})`,
        reasonVi: 'Trình duyệt hoặc thiết bị DAP đã chặn cửa sổ bật lên (Popup), hoặc bạn đã đóng cửa sổ đăng nhập trước khi hoàn tất.',
        actionVi: 'Hãy cho phép mở popup trên trình duyệt, hoặc dùng ngay mục [🔑 Dán Token Siêu Tốc] bên dưới để kết nối trực tiếp không cần popup.',
        recommendFastToken: true
      };
    }

    return {
      code: 'generic',
      title: `Không thể đăng nhập 1-Chạm ${providerLabel}`,
      reasonVi: rawText
        ? `Xác thực OAuth gặp sự cố (${rawText.slice(0, 140)}).`
        : `Quá trình đăng nhập 1-Chạm ${providerLabel} không phản hồi hoặc bị gián đoạn.`,
      actionVi: 'Hãy chuyển xuống mục [🔑 Dán Token Siêu Tốc] bên dưới để lấy và dán Access Token kết nối trực tiếp.',
      recommendFastToken: true
    };
  }

  // ── BUG-01: Leak-Free ObjectURL Registry & Abortable Track Loader ──
  function safeRevokeObjectUrlRegistry(options = {}) {
    const maxRetained = Math.max(1, Number(options.maxRetained) || 8);
    const defaultRevoke = url => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }
    };
    const revokeFn = typeof options.revokeFn === 'function' ? options.revokeFn : defaultRevoke;
    const registry = new Map();
    let revokedCount = 0;

    const isBlobUrl = url => typeof url === 'string' && url.trim().startsWith('blob:');

    function revoke(url) {
      if (!isBlobUrl(url)) return false;
      const clean = url.trim();
      const existed = registry.delete(clean);
      try { revokeFn(clean); } catch (_) {}
      revokedCount++;
      return existed || true;
    }

    function track(url, ownerId = '', meta = {}) {
      if (!isBlobUrl(url)) return false;
      const clean = url.trim();
      if (registry.has(clean)) {
        const entry = registry.get(clean);
        entry.ownerId = ownerId || entry.ownerId;
        entry.touchedAt = Date.now();
        return true;
      }
      registry.set(clean, {
        url: clean,
        ownerId: String(ownerId || ''),
        createdAt: Date.now(),
        touchedAt: Date.now(),
        pinned: Boolean(meta && meta.pinned)
      });
      if (registry.size > maxRetained) {
        for (const [candidateUrl, entry] of registry.entries()) {
          if (registry.size <= maxRetained) break;
          if (entry.pinned || candidateUrl === clean) continue;
          revoke(candidateUrl);
        }
      }
      return true;
    }

    function revokeByOwner(ownerId, keepUrl = null) {
      const targetOwner = String(ownerId || '');
      const revoked = [];
      for (const [candidateUrl, entry] of [...registry.entries()]) {
        if (entry.ownerId === targetOwner && candidateUrl !== keepUrl) {
          revoke(candidateUrl);
          revoked.push(candidateUrl);
        }
      }
      return revoked;
    }

    function revokeAllExcept(keepUrls = []) {
      const keepSet = new Set(
        (Array.isArray(keepUrls) ? keepUrls : [keepUrls])
          .filter(u => typeof u === 'string' && u.trim())
          .map(u => u.trim())
      );
      const revoked = [];
      for (const candidateUrl of [...registry.keys()]) {
        if (!keepSet.has(candidateUrl)) {
          revoke(candidateUrl);
          revoked.push(candidateUrl);
        }
      }
      return revoked;
    }

    function revokeAll() {
      return revokeAllExcept([]);
    }

    function stats() {
      return {
        activeCount: registry.size,
        revokedCount,
        urls: [...registry.keys()]
      };
    }

    return {
      track,
      revoke,
      revokeByOwner,
      revokeAllExcept,
      revokeAll,
      stats
    };
  }

  function createAbortableTrackLoader(options = {}) {
    const urlRegistry = options.urlRegistry || safeRevokeObjectUrlRegistry(options);
    let currentGeneration = 0;
    let activeController = null;
    let activeTrackId = '';
    let activeUrl = null;
    let standbyUrl = null;
    let abortedCount = 0;

    function createController() {
      if (typeof AbortController === 'function') {
        return new AbortController();
      }
      const listeners = new Set();
      const signal = {
        aborted: false,
        reason: undefined,
        addEventListener(type, fn) {
          if (type === 'abort' && typeof fn === 'function') listeners.add(fn);
        },
        removeEventListener(type, fn) {
          if (type === 'abort') listeners.delete(fn);
        }
      };
      return {
        signal,
        abort(reason) {
          if (signal.aborted) return;
          signal.aborted = true;
          signal.reason = reason;
          for (const fn of [...listeners]) {
            try { fn({ type: 'abort', target: signal }); } catch (_) {}
          }
        }
      };
    }

    function beginLoad(trackId = '') {
      currentGeneration += 1;
      const generationId = currentGeneration;
      if (activeController && activeController.signal && !activeController.signal.aborted) {
        try {
          activeController.abort(new Error(`Superseded by generation ${generationId}`));
        } catch (_) {}
        abortedCount += 1;
      }
      const controller = createController();
      activeController = controller;
      activeTrackId = String(trackId || '');

      return {
        generationId,
        trackId: activeTrackId,
        controller,
        signal: controller.signal,
        isCurrent() {
          return generationId === currentGeneration && !controller.signal.aborted;
        },
        registerObjectUrl(url) {
          if (!url || typeof url !== 'string') return url;
          urlRegistry.track(url, `gen:${generationId}`);
          if (generationId !== currentGeneration || controller.signal.aborted) {
            urlRegistry.revoke(url);
            return null;
          }
          return url;
        }
      };
    }

    function registerObjectUrl(url, ownerId = '') {
      const owner = ownerId || `gen:${currentGeneration}`;
      urlRegistry.track(url, owner);
      return url;
    }

    function commitLoad(generationId, nextActiveUrl = null, nextStandbyUrl = null) {
      const isStale = generationId !== currentGeneration ||
        Boolean(activeController && activeController.signal && activeController.signal.aborted);
      if (isStale) {
        if (nextActiveUrl && nextActiveUrl !== activeUrl && nextActiveUrl !== standbyUrl) {
          urlRegistry.revoke(nextActiveUrl);
        }
        return {
          committed: false,
          stale: true,
          generationId,
          currentGeneration,
          revokedUrls: nextActiveUrl ? [nextActiveUrl] : []
        };
      }

      if (nextActiveUrl) {
        urlRegistry.track(nextActiveUrl, `gen:${generationId}`, { pinned: true });
      }
      if (nextStandbyUrl) {
        urlRegistry.track(nextStandbyUrl, `standby:${generationId}`, { pinned: true });
      }
      activeUrl = nextActiveUrl || null;
      standbyUrl = nextStandbyUrl || null;
      const keep = [activeUrl, standbyUrl].filter(Boolean);
      const revokedUrls = urlRegistry.revokeAllExcept(keep);

      return {
        committed: true,
        stale: false,
        generationId,
        activeUrl,
        standbyUrl,
        revokedUrls
      };
    }

    function abortAll(reason = 'aborted') {
      currentGeneration += 1;
      if (activeController && activeController.signal && !activeController.signal.aborted) {
        try { activeController.abort(reason); } catch (_) {}
        abortedCount += 1;
      }
      activeController = null;
      activeTrackId = '';
      activeUrl = null;
      standbyUrl = null;
      const revokedUrls = urlRegistry.revokeAll();
      return { generationId: currentGeneration, abortedCount, revokedUrls };
    }

    function getState() {
      const regStats = urlRegistry.stats();
      return {
        generationId: currentGeneration,
        activeTrackId,
        activeUrl,
        standbyUrl,
        abortedCount,
        activeUrlCount: regStats.activeCount,
        revokedUrlCount: regStats.revokedCount,
        trackedUrls: regStats.urls
      };
    }

    return {
      beginLoad,
      registerObjectUrl,
      commitLoad,
      abortAll,
      getState,
      urlRegistry
    };
  }

  // ── BUG-02: Safe DataView Bounds Validation for Binary Hi-Res Audio Headers (FLAC / WAV / DSF / DFF) ──
  function validateBinaryAudioHeaderBounds(input, options = {}) {
    if (!input) {
      return { valid: false, format: 'unknown', truncated: true, byteLength: 0, error: 'empty_buffer', blocks: [] };
    }

    let u8 = null;
    if (input instanceof Uint8Array) {
      u8 = input;
    } else if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer) {
      u8 = new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength || 0);
    } else if (input instanceof ArrayBuffer) {
      u8 = new Uint8Array(input);
    } else if (Array.isArray(input)) {
      u8 = Uint8Array.from(input);
    } else {
      return { valid: false, format: 'unknown', truncated: true, byteLength: 0, error: 'invalid_buffer_type', blocks: [] };
    }

    const byteLength = u8.byteLength;
    if (byteLength === 0) {
      return { valid: false, format: 'unknown', truncated: true, byteLength: 0, error: 'empty_buffer', blocks: [] };
    }

    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const canRead = (offset, length) =>
      Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0 && (offset + length) <= byteLength;

    const readAscii = (offset, length) => {
      if (!canRead(offset, length)) return '';
      let out = '';
      for (let i = 0; i < length; i++) {
        out += String.fromCharCode(u8[offset + i]);
      }
      return out;
    };

    const readU32BE = offset => canRead(offset, 4) ? view.getUint32(offset, false) : null;
    const readU32LE = offset => canRead(offset, 4) ? view.getUint32(offset, true) : null;
    const readU64LE = offset => {
      if (!canRead(offset, 8)) return null;
      const lo = view.getUint32(offset, true);
      const hi = view.getUint32(offset + 4, true);
      return hi * 4294967296 + lo;
    };
    const readU64BE = offset => {
      if (!canRead(offset, 8)) return null;
      const hi = view.getUint32(offset, false);
      const lo = view.getUint32(offset + 4, false);
      return hi * 4294967296 + lo;
    };

    let baseOffset = 0;
    if (canRead(0, 3) && readAscii(0, 3) === 'ID3') {
      if (!canRead(0, 10)) {
        return { valid: false, format: 'id3', truncated: true, byteLength, requiredBytes: 10, error: 'truncated_id3_header', blocks: [] };
      }
      const tagSize = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
      const footerSize = (u8[5] & 0x10) ? 10 : 0;
      baseOffset = 10 + tagSize + footerSize;
      if (baseOffset > byteLength) {
        return { valid: false, format: 'id3', truncated: true, byteLength, requiredBytes: baseOffset, error: 'truncated_id3_body', blocks: [] };
      }
    }

    if (!canRead(baseOffset, 4)) {
      return { valid: false, format: 'unknown', truncated: true, byteLength, requiredBytes: baseOffset + 4, error: 'truncated_magic_header', blocks: [] };
    }

    const magic = readAscii(baseOffset, 4);

    // 1. FLAC ('fLaC')
    if (magic === 'fLaC') {
      let pos = baseOffset + 4;
      const blocks = [];
      let sampleRate = 0;
      let channels = 0;
      let bitsPerSample = 0;
      let hasStreamInfo = false;
      const maxBlocks = Math.max(1, Number(options.maxBlocks) || 128);

      for (let i = 0; i < maxBlocks; i++) {
        if (!canRead(pos, 4)) {
          return {
            valid: false,
            format: 'flac',
            truncated: true,
            byteLength,
            requiredBytes: pos + 4,
            error: 'truncated_flac_block_header',
            blocks
          };
        }
        const headerByte = u8[pos];
        const isLast = (headerByte & 0x80) !== 0;
        const blockType = headerByte & 0x7f;
        const blockLength = (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3];
        const bodyOffset = pos + 4;
        const blockEnd = bodyOffset + blockLength;

        if (blockType === 127) {
          return { valid: false, format: 'flac', truncated: false, byteLength, error: 'invalid_flac_block_type_127', blocks };
        }

        if (!canRead(bodyOffset, blockLength)) {
          return {
            valid: false,
            format: 'flac',
            truncated: true,
            byteLength,
            requiredBytes: blockEnd,
            blockType,
            error: blockType === 6 ? 'truncated_flac_picture_block' : 'truncated_flac_metadata_block',
            blocks
          };
        }

        if (blockType === 0) {
          if (blockLength < 34) {
            return {
              valid: false,
              format: 'flac',
              truncated: true,
              byteLength,
              requiredBytes: bodyOffset + 34,
              error: 'invalid_flac_streaminfo_length',
              blocks
            };
          }
          sampleRate = (u8[bodyOffset + 10] << 12) | (u8[bodyOffset + 11] << 4) | (u8[bodyOffset + 12] >> 4);
          channels = ((u8[bodyOffset + 12] >> 1) & 0x07) + 1;
          bitsPerSample = (((u8[bodyOffset + 12] & 0x01) << 4) | (u8[bodyOffset + 13] >> 4)) + 1;
          hasStreamInfo = true;
        } else if (blockType === 6) {
          if (blockLength < 32) {
            return {
              valid: false,
              format: 'flac',
              truncated: true,
              byteLength,
              requiredBytes: bodyOffset + 32,
              error: 'corrupt_flac_picture_bounds',
              blocks
            };
          }
          let picPos = bodyOffset + 4; // skip pictureType
          const mimeLen = readU32BE(picPos);
          picPos += 4;
          if (mimeLen === null || picPos + mimeLen + 4 > blockEnd) {
            return { valid: false, format: 'flac', truncated: true, byteLength, error: 'corrupt_flac_picture_bounds', blocks };
          }
          picPos += mimeLen;
          const descLen = readU32BE(picPos);
          picPos += 4;
          if (descLen === null || picPos + descLen + 20 > blockEnd) {
            return { valid: false, format: 'flac', truncated: true, byteLength, error: 'corrupt_flac_picture_bounds', blocks };
          }
          picPos += descLen + 16; // skip width(4), height(4), depth(4), colors(4)
          const dataLen = readU32BE(picPos);
          picPos += 4;
          if (dataLen === null || picPos + dataLen > blockEnd) {
            return { valid: false, format: 'flac', truncated: true, byteLength, error: 'corrupt_flac_picture_bounds', blocks };
          }
        }

        blocks.push({ type: blockType, isLast, offset: bodyOffset, length: blockLength });
        pos = blockEnd;
        if (isLast) {
          if (!hasStreamInfo) {
            return { valid: false, format: 'flac', truncated: false, byteLength, error: 'missing_flac_streaminfo', blocks };
          }
          return {
            valid: true,
            format: 'flac',
            truncated: false,
            byteLength,
            audioOffset: pos,
            sampleRate,
            channels,
            bitsPerSample,
            blocks
          };
        }
      }
      return { valid: false, format: 'flac', truncated: true, byteLength, error: 'unterminated_flac_metadata', blocks };
    }

    // 2. WAV ('RIFF' / 'RF64' ... 'WAVE')
    if (magic === 'RIFF' || magic === 'RF64') {
      if (!canRead(baseOffset, 12) || readAscii(baseOffset + 8, 4) !== 'WAVE') {
        return {
          valid: false,
          format: 'wav',
          truncated: !canRead(baseOffset, 12),
          byteLength,
          requiredBytes: baseOffset + 12,
          error: 'truncated_wav_riff_header',
          chunks: []
        };
      }
      let pos = baseOffset + 12;
      const chunks = [];
      let fmt = null;
      let dataChunk = null;

      while (pos < byteLength) {
        if (!canRead(pos, 8)) {
          return {
            valid: false,
            format: 'wav',
            truncated: true,
            byteLength,
            requiredBytes: pos + 8,
            error: 'truncated_wav_chunk_header',
            chunks
          };
        }
        const chunkId = readAscii(pos, 4);
        const chunkSize = readU32LE(pos + 4);
        const bodyOffset = pos + 8;

        if (chunkId === 'fmt ') {
          if (chunkSize < 16 || !canRead(bodyOffset, chunkSize)) {
            return {
              valid: false,
              format: 'wav',
              truncated: true,
              byteLength,
              requiredBytes: bodyOffset + Math.max(16, chunkSize),
              error: 'truncated_wav_fmt_chunk',
              chunks
            };
          }
          fmt = {
            audioFormat: view.getUint16(bodyOffset, true),
            channels: view.getUint16(bodyOffset + 2, true),
            sampleRate: view.getUint32(bodyOffset + 4, true),
            bitsPerSample: view.getUint16(bodyOffset + 14, true)
          };
          chunks.push({ id: chunkId.trim(), offset: bodyOffset, size: chunkSize });
        } else if (chunkId === 'data') {
          dataChunk = { offset: bodyOffset, size: chunkSize };
          chunks.push({ id: 'data', offset: bodyOffset, size: chunkSize });
          if (options.requireFullData && !canRead(bodyOffset, chunkSize)) {
            return {
              valid: false,
              format: 'wav',
              truncated: true,
              byteLength,
              requiredBytes: bodyOffset + chunkSize,
              error: 'truncated_wav_data_chunk',
              chunks
            };
          }
          break;
        } else {
          if (!canRead(bodyOffset, chunkSize)) {
            return {
              valid: false,
              format: 'wav',
              truncated: true,
              byteLength,
              requiredBytes: bodyOffset + chunkSize,
              chunkId: chunkId.trim(),
              error: 'truncated_wav_chunk_body',
              chunks
            };
          }
          chunks.push({ id: chunkId.trim(), offset: bodyOffset, size: chunkSize });
        }
        pos = bodyOffset + chunkSize + (chunkSize & 1);
      }

      if (!fmt || !dataChunk) {
        return {
          valid: false,
          format: 'wav',
          truncated: true,
          byteLength,
          error: !fmt ? 'missing_wav_fmt_chunk' : 'missing_wav_data_chunk',
          chunks
        };
      }

      return {
        valid: true,
        format: 'wav',
        truncated: false,
        byteLength,
        audioFormat: fmt.audioFormat,
        channels: fmt.channels,
        sampleRate: fmt.sampleRate,
        bitsPerSample: fmt.bitsPerSample,
        dataOffset: dataChunk.offset,
        dataSize: dataChunk.size,
        chunks
      };
    }

    // 3. DSF ('DSD ' — LSB-first Sony DSF container)
    if (magic === 'DSD ') {
      if (!canRead(baseOffset, 28)) {
        return {
          valid: false,
          format: 'dsf',
          truncated: true,
          byteLength,
          requiredBytes: baseOffset + 28,
          error: 'truncated_dsf_dsd_chunk'
        };
      }
      const fmtOffset = baseOffset + 28;
      if (!canRead(fmtOffset, 52) || readAscii(fmtOffset, 4) !== 'fmt ') {
        return {
          valid: false,
          format: 'dsf',
          truncated: !canRead(fmtOffset, 52),
          byteLength,
          requiredBytes: fmtOffset + 52,
          error: 'truncated_dsf_fmt_chunk'
        };
      }
      const channels = readU32LE(fmtOffset + 24);
      const sampleRate = readU32LE(fmtOffset + 28);
      const bitsPerSample = readU32LE(fmtOffset + 32);
      const dataHeaderOffset = fmtOffset + 52;
      if (!canRead(dataHeaderOffset, 12) || readAscii(dataHeaderOffset, 4) !== 'data') {
        return {
          valid: false,
          format: 'dsf',
          truncated: true,
          byteLength,
          requiredBytes: dataHeaderOffset + 12,
          error: 'truncated_dsf_data_header'
        };
      }
      const dataChunkSize = readU64LE(dataHeaderOffset + 4);
      return {
        valid: true,
        format: 'dsf',
        truncated: false,
        byteLength,
        bitOrder: bitsPerSample === 8 ? 'msb' : 'lsb',
        channels,
        sampleRate,
        bitsPerSample,
        dataOffset: dataHeaderOffset + 12,
        dataSize: Math.max(0, (dataChunkSize || 12) - 12)
      };
    }

    // 4. DFF ('FRM8' ... 'DSD ' — MSB-first Philips DSDIFF container)
    if (magic === 'FRM8') {
      if (!canRead(baseOffset, 16) || readAscii(baseOffset + 12, 4) !== 'DSD ') {
        return {
          valid: false,
          format: 'dff',
          truncated: !canRead(baseOffset, 16),
          byteLength,
          requiredBytes: baseOffset + 16,
          error: 'truncated_dff_frm8_header'
        };
      }
      let pos = baseOffset + 16;
      let sampleRate = 2822400;
      let channels = 2;
      let dataOffset = -1;
      let dataSize = 0;
      const chunks = [];

      while (pos < byteLength) {
        if (!canRead(pos, 12)) {
          return {
            valid: false,
            format: 'dff',
            truncated: true,
            byteLength,
            requiredBytes: pos + 12,
            error: 'truncated_dff_chunk_header',
            chunks
          };
        }
        const chunkId = readAscii(pos, 4);
        const chunkSize = readU64BE(pos + 4);
        const bodyOffset = pos + 12;

        if (chunkId === 'DSD ' || chunkId === 'DST ') {
          dataOffset = bodyOffset;
          dataSize = chunkSize;
          chunks.push({ id: chunkId.trim(), offset: bodyOffset, size: chunkSize });
          break;
        }
        if (!canRead(bodyOffset, chunkSize)) {
          return {
            valid: false,
            format: 'dff',
            truncated: true,
            byteLength,
            requiredBytes: bodyOffset + chunkSize,
            chunkId: chunkId.trim(),
            error: 'truncated_dff_chunk_body',
            chunks
          };
        }
        if (chunkId === 'PROP' && chunkSize >= 4 && readAscii(bodyOffset, 4) === 'SND ') {
          let subPos = bodyOffset + 4;
          const propEnd = bodyOffset + chunkSize;
          while (subPos + 12 <= propEnd) {
            const subId = readAscii(subPos, 4);
            const subSize = readU64BE(subPos + 4);
            const subBody = subPos + 12;
            if (subBody + subSize > propEnd) break;
            if (subId === 'FS  ' && subSize >= 4) {
              sampleRate = readU32BE(subBody);
            } else if (subId === 'CHNL' && subSize >= 2) {
              channels = view.getUint16(subBody, false);
            }
            subPos = subBody + subSize + (subSize & 1);
          }
        }
        chunks.push({ id: chunkId.trim(), offset: bodyOffset, size: chunkSize });
        pos = bodyOffset + chunkSize + (chunkSize & 1);
      }

      if (dataOffset < 0) {
        return {
          valid: false,
          format: 'dff',
          truncated: true,
          byteLength,
          error: 'missing_dff_dsd_data_chunk',
          chunks
        };
      }

      return {
        valid: true,
        format: 'dff',
        truncated: false,
        byteLength,
        bitOrder: 'msb',
        channels,
        sampleRate,
        bitsPerSample: 1,
        dataOffset,
        dataSize,
        chunks
      };
    }

    return {
      valid: false,
      format: 'unknown',
      truncated: false,
      byteLength,
      error: 'unsupported_header_magic',
      blocks: []
    };
  }

  // ── UPG-01: LRCLIB 429/503 Retry-After + Exponential Jitter, Lyricsfile YAML 1.0 & O(log N) Binary Syncer ──
  const LRCLIB_RETRY_BASE_MS = 1000;
  const LRCLIB_RETRY_MAX_MS = 60000;
  const LRCLIB_MAX_JITTER_RATIO = 0.30;

  function computeLrclibRetryDelayMs(retryAfterHeader, attemptIndex = 0, randomFn = Math.random, options = {}) {
    const baseDelayMs = Number.isFinite(options.baseDelayMs) && options.baseDelayMs >= 0
      ? options.baseDelayMs
      : LRCLIB_RETRY_BASE_MS;
    const maxDelayMs = Number.isFinite(options.maxDelayMs) && options.maxDelayMs > 0
      ? options.maxDelayMs
      : LRCLIB_RETRY_MAX_MS;
    const maxJitterRatio = Number.isFinite(options.maxJitterRatio) && options.maxJitterRatio >= 0
      ? Math.min(1, options.maxJitterRatio)
      : LRCLIB_MAX_JITTER_RATIO;
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const safeAttempt = Math.max(0, Math.min(20, Math.floor(Number(attemptIndex) || 0)));

    let rawHeader = retryAfterHeader;
    if (rawHeader && typeof rawHeader === 'object') {
      if (rawHeader.headers) {
        const hdrs = rawHeader.headers;
        rawHeader = typeof hdrs.get === 'function'
          ? hdrs.get('Retry-After')
          : (hdrs['retry-after'] ?? hdrs['Retry-After'] ?? null);
      } else if (typeof rawHeader.get === 'function') {
        rawHeader = rawHeader.get('Retry-After');
      } else {
        rawHeader = rawHeader['retry-after'] ?? rawHeader['Retry-After'] ?? null;
      }
    }

    let parsedRetryMs = null;
    if (typeof rawHeader === 'number' && Number.isFinite(rawHeader) && rawHeader >= 0) {
      parsedRetryMs = rawHeader * 1000;
    } else if (typeof rawHeader === 'string') {
      const trimmed = rawHeader.trim();
      if (trimmed.length > 0) {
        if (/^\+?\d+(?:\.\d+)?$/.test(trimmed)) {
          parsedRetryMs = Number(trimmed) * 1000;
        } else {
          const parsedDateMs = Date.parse(trimmed);
          if (Number.isFinite(parsedDateMs)) {
            parsedRetryMs = Math.max(0, parsedDateMs - nowMs);
          }
        }
      }
    }

    const expBackoffMs = baseDelayMs * Math.pow(2, safeAttempt);
    const baseMs = parsedRetryMs !== null ? parsedRetryMs : expBackoffMs;

    let rand = 0;
    if (typeof randomFn === 'function') {
      const candidate = Number(randomFn());
      if (Number.isFinite(candidate)) {
        rand = Math.min(1, Math.max(0, candidate));
      }
    }
    const jitterMultiplier = 1 + rand * maxJitterRatio;
    const delayedMs = Math.round(Math.min(maxDelayMs, baseMs) * jitterMultiplier);
    return Math.min(maxDelayMs, Math.max(0, delayedMs));
  }

  function decodeLyricsfileYamlScalar(rawVal) {
    const str = String(rawVal ?? '').trim();
    if (!str) return '';
    if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
      const inner = str.slice(1, -1);
      return inner.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|["\\/bfnrt])/g, (_, esc) => {
        if (esc[0] === 'u' || esc[0] === 'U') {
          const cp = parseInt(esc.slice(1), 16);
          return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
        }
        switch (esc) {
          case '"': return '"';
          case '\\': return '\\';
          case '/': return '/';
          case 'b': return '\b';
          case 'f': return '\f';
          case 'n': return '\n';
          case 'r': return '\r';
          case 't': return '\t';
          default: return esc;
        }
      });
    }
    if (str.length >= 2 && str.startsWith("'") && str.endsWith("'")) {
      return str.slice(1, -1).replace(/''/g, "'");
    }
    const commentIdx = str.search(/\s+#/);
    return (commentIdx >= 0 ? str.slice(0, commentIdx) : str).trim();
  }

  function encodeLyricsfileYamlString(value) {
    const str = String(value ?? '');
    let out = '"';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '\\') out += '\\\\';
      else if (ch === '"') out += '\\"';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    }
    out += '"';
    return out;
  }

  function parseInlineYamlMap(inlineStr) {
    const inner = inlineStr.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
    const out = {};
    if (!inner) return out;
    let i = 0;
    const len = inner.length;
    while (i < len) {
      while (i < len && (inner[i] === ' ' || inner[i] === ',')) i++;
      if (i >= len) break;
      const colonIdx = inner.indexOf(':', i);
      if (colonIdx < 0) break;
      const key = inner.slice(i, colonIdx).trim();
      i = colonIdx + 1;
      while (i < len && inner[i] === ' ') i++;
      let val = '';
      if (inner[i] === '"' || inner[i] === "'") {
        const quote = inner[i];
        let j = i + 1;
        while (j < len) {
          if (quote === '"' && inner[j] === '\\') { j += 2; continue; }
          if (quote === "'" && inner[j] === "'" && inner[j + 1] === "'") { j += 2; continue; }
          if (inner[j] === quote) { j++; break; }
          j++;
        }
        val = inner.slice(i, j);
        i = j;
      } else {
        const commaIdx = inner.indexOf(',', i);
        if (commaIdx < 0) {
          val = inner.slice(i).trim();
          i = len;
        } else {
          val = inner.slice(i, commaIdx).trim();
          i = commaIdx + 1;
        }
      }
      if (key) out[key] = decodeLyricsfileYamlScalar(val);
    }
    return out;
  }

  function parseLyricsfileYaml(yamlText) {
    const emptyDoc = () => ({
      version: '1.0',
      metadata: {
        title: '',
        artist: '',
        album: '',
        duration_ms: 0,
        instrumental: false
      },
      lines: []
    });

    if (typeof yamlText !== 'string' || !yamlText.trim()) {
      return emptyDoc();
    }

    const doc = emptyDoc();
    const rawLines = yamlText.replace(/^\uFEFF/, '').split(/\r?\n/);
    let section = 'root';
    let currentLine = null;
    let currentWord = null;
    let lineDashIndent = -1;
    let inWordsBlock = false;
    let wordsKeyIndent = -1;
    let plainLines = null;
    let plainIndent = -1;

    const assignField = (target, key, rawVal, isRawDecoded = false) => {
      if (!target || !key) return;
      const val = isRawDecoded ? String(rawVal ?? '') : decodeLyricsfileYamlScalar(rawVal);
      if (key === 'start_ms' || key === 'end_ms' || key === 'duration_ms') {
        const num = Number(val);
        target[key] = Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
        if (key === 'end_ms') target._hasExplicitEnd = true;
      } else if (key === 'instrumental' || key === 'backing') {
        target[key] = val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
      } else if (key === 'text') {
        target.text = val;
      } else if (key === 'voice') {
        target.voice = val;
      } else {
        target[key] = val;
      }
    };

    for (let idx = 0; idx < rawLines.length; idx++) {
      const raw = rawLines[idx];
      const trimmed = raw.trim();
      if (trimmed === '---' || trimmed === '...') continue;
      if (trimmed.startsWith('#')) continue;

      const indent = raw.search(/\S/);

      if (section === 'plain') {
        if (indent === -1) {
          if (plainLines) plainLines.push('');
          continue;
        }
        if (plainIndent === -1) {
          if (indent > 0) plainIndent = indent;
          else section = 'root';
        }
        if (section === 'plain' && plainIndent > 0 && indent >= plainIndent) {
          plainLines.push(raw.slice(plainIndent));
          continue;
        }
        section = 'root';
      }

      if (!trimmed) continue;

      if (indent === 0) {
        currentLine = null;
        currentWord = null;
        inWordsBlock = false;
        const rootMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (rootMatch) {
          const rKey = rootMatch[1];
          const rVal = rootMatch[2].trim();
          if (rKey === 'version') {
            doc.version = decodeLyricsfileYamlScalar(rVal) || '1.0';
            section = 'root';
            continue;
          }
          if (rKey === 'metadata') {
            section = 'metadata';
            if (rVal.startsWith('{') && rVal.endsWith('}')) {
              const inlineMeta = parseInlineYamlMap(rVal);
              for (const [mk, mv] of Object.entries(inlineMeta)) assignField(doc.metadata, mk, mv, true);
              section = 'root';
            }
            continue;
          }
          if (rKey === 'lines') {
            section = 'lines';
            if (rVal === '[]' || /^\[\s*\]$/.test(rVal)) {
              doc.lines = [];
              section = 'root';
            }
            continue;
          }
          if (rKey === 'plain') {
            if (rVal === '|' || rVal === '|-') {
              section = 'plain';
              plainLines = [];
              plainIndent = -1;
            } else {
              doc.plain = decodeLyricsfileYamlScalar(rVal);
              section = 'root';
            }
            continue;
          }
        }
      }

      if (section === 'metadata') {
        const metaMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (metaMatch) {
          assignField(doc.metadata, metaMatch[1], metaMatch[2]);
        }
        continue;
      }

      if (section === 'lines') {
        const listMatch = raw.match(/^(\s*)-\s*(.*)$/);
        if (listMatch) {
          const dashPos = listMatch[1].length;
          const rest = listMatch[2].trim();

          const isWordEntry = inWordsBlock && currentLine !== null && dashPos > lineDashIndent;
          if (!isWordEntry) {
            inWordsBlock = false;
            currentWord = null;
            lineDashIndent = dashPos;
            currentLine = { start_ms: 0, end_ms: 0, text: '', _hasExplicitEnd: false };
            doc.lines.push(currentLine);

            if (rest.startsWith('{') && rest.endsWith('}')) {
              const inlineObj = parseInlineYamlMap(rest);
              for (const [lk, lv] of Object.entries(inlineObj)) assignField(currentLine, lk, lv, true);
            } else if (rest) {
              const kv = rest.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
              if (kv) {
                if (kv[1] === 'words') {
                  currentLine.words = [];
                  if (kv[2].trim() !== '[]') {
                    inWordsBlock = true;
                    wordsKeyIndent = dashPos + 2;
                  }
                } else {
                  assignField(currentLine, kv[1], kv[2]);
                }
              }
            }
          } else {
            if (!Array.isArray(currentLine.words)) currentLine.words = [];
            currentWord = { start_ms: 0, end_ms: 0, text: '', _hasExplicitEnd: false };
            currentLine.words.push(currentWord);

            if (rest.startsWith('{') && rest.endsWith('}')) {
              const inlineObj = parseInlineYamlMap(rest);
              for (const [wk, wv] of Object.entries(inlineObj)) assignField(currentWord, wk, wv, true);
            } else if (rest) {
              const kv = rest.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
              if (kv) assignField(currentWord, kv[1], kv[2]);
            }
          }
          continue;
        }

        const propMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (propMatch && currentLine) {
          const pKey = propMatch[1];
          const pVal = propMatch[2].trim();
          if (pKey === 'words' && (!inWordsBlock || indent <= wordsKeyIndent)) {
            currentLine.words = [];
            currentWord = null;
            if (pVal === '[]' || /^\[\s*\]$/.test(pVal)) {
              inWordsBlock = false;
            } else {
              inWordsBlock = true;
              wordsKeyIndent = indent;
            }
          } else if (inWordsBlock && currentWord && indent > wordsKeyIndent) {
            assignField(currentWord, pKey, pVal);
          } else {
            if (inWordsBlock && indent <= wordsKeyIndent) {
              inWordsBlock = false;
              currentWord = null;
            }
            assignField(currentLine, pKey, pVal);
          }
        }
      }
    }

    if (plainLines && plainLines.length > 0) {
      doc.plain = plainLines.join('\n');
    }

    if (doc.metadata.instrumental) {
      doc.lines = [];
      if (doc.plain !== undefined) doc.plain = '';
      return doc;
    }

    doc.lines = doc.lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => (a.line.start_ms - b.line.start_ms) || (a.index - b.index))
      .map(entry => entry.line);

    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      line.start_ms = Math.max(0, Math.round(Number(line.start_ms) || 0));

      if (Array.isArray(line.words) && line.words.length > 0) {
        line.words = line.words
          .map((w, idx) => ({ w, idx }))
          .sort((a, b) => (a.w.start_ms - b.w.start_ms) || (a.idx - b.idx))
          .map(entry => entry.w);
      }

      if (!line._hasExplicitEnd) {
        let inferredEnd = 0;
        if (Array.isArray(line.words) && line.words.length > 0) {
          const lastW = line.words[line.words.length - 1];
          if (lastW._hasExplicitEnd && lastW.end_ms > line.start_ms) {
            inferredEnd = lastW.end_ms;
          }
        }
        if (!inferredEnd) {
          if (i + 1 < doc.lines.length && doc.lines[i + 1].start_ms > line.start_ms) {
            inferredEnd = doc.lines[i + 1].start_ms;
          } else if (doc.metadata.duration_ms > line.start_ms) {
            inferredEnd = doc.metadata.duration_ms;
          } else {
            inferredEnd = line.start_ms + 3000;
          }
        }
        line.end_ms = inferredEnd;
      } else {
        line.end_ms = Math.max(line.start_ms, Math.round(Number(line.end_ms) || 0));
      }
      delete line._hasExplicitEnd;

      if (Array.isArray(line.words)) {
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          word.start_ms = Math.max(0, Math.round(Number(word.start_ms) || 0));
          if (!word._hasExplicitEnd) {
            if (w + 1 < line.words.length && line.words[w + 1].start_ms >= word.start_ms) {
              word.end_ms = line.words[w + 1].start_ms;
            } else {
              word.end_ms = Math.max(word.start_ms, line.end_ms);
            }
          } else {
            word.end_ms = Math.max(word.start_ms, Math.round(Number(word.end_ms) || 0));
          }
          delete word._hasExplicitEnd;
        }
        if (line.words.length === 0) delete line.words;
      }
    }

    return doc;
  }

  function serializeLyricsfileYaml(doc) {
    const safeDoc = (doc && typeof doc === 'object') ? doc : {};
    const version = String(safeDoc.version || '1.0');
    const meta = (safeDoc.metadata && typeof safeDoc.metadata === 'object') ? safeDoc.metadata : {};
    const isInstrumental = Boolean(meta.instrumental);
    const durationMs = Math.max(0, Math.round(Number(meta.duration_ms) || 0));

    const out = [
      `version: ${encodeLyricsfileYamlString(version)}`,
      'metadata:',
      `  title: ${encodeLyricsfileYamlString(meta.title || '')}`,
      `  artist: ${encodeLyricsfileYamlString(meta.artist || '')}`,
      `  album: ${encodeLyricsfileYamlString(meta.album || '')}`,
      `  duration_ms: ${durationMs}`,
      `  instrumental: ${isInstrumental ? 'true' : 'false'}`
    ];

    if (isInstrumental) {
      out.push('lines: []');
      return out.join('\n');
    }

    const rawLines = Array.isArray(safeDoc.lines) ? safeDoc.lines : [];
    const sortedLines = rawLines
      .map((line, index) => ({ line, index }))
      .filter(entry => entry.line && typeof entry.line === 'object')
      .sort((a, b) => ((Number(a.line.start_ms) || 0) - (Number(b.line.start_ms) || 0)) || (a.index - b.index))
      .map(entry => entry.line);

    if (sortedLines.length === 0) {
      out.push('lines: []');
      return out.join('\n');
    }

    out.push('lines:');
    for (let i = 0; i < sortedLines.length; i++) {
      const line = sortedLines[i];
      const startMs = Math.max(0, Math.round(Number(line.start_ms) || 0));
      const fallbackEnd = line.end_ms != null
        ? Number(line.end_ms)
        : (i + 1 < sortedLines.length ? Number(sortedLines[i + 1].start_ms) : (durationMs > startMs ? durationMs : startMs + 3000));
      const endMs = Math.max(startMs, Math.round(Number.isFinite(fallbackEnd) ? fallbackEnd : startMs));
      const text = String(line.text ?? '');

      out.push(`  - start_ms: ${startMs}`);
      out.push(`    end_ms: ${endMs}`);
      out.push(`    text: ${encodeLyricsfileYamlString(text)}`);
      if (line.voice !== undefined && line.voice !== null && String(line.voice) !== '') {
        out.push(`    voice: ${encodeLyricsfileYamlString(line.voice)}`);
      }
      if (line.backing === true) {
        out.push('    backing: true');
      }

      if (Array.isArray(line.words) && line.words.length > 0) {
        out.push('    words:');
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          if (!word || typeof word !== 'object') continue;
          const wStart = Math.max(0, Math.round(Number(word.start_ms) || 0));
          const wFallbackEnd = word.end_ms != null
            ? Number(word.end_ms)
            : (w + 1 < line.words.length ? Number(line.words[w + 1].start_ms) : endMs);
          const wEnd = Math.max(wStart, Math.round(Number.isFinite(wFallbackEnd) ? wFallbackEnd : wStart));
          out.push(`      - start_ms: ${wStart}`);
          out.push(`        end_ms: ${wEnd}`);
          out.push(`        text: ${encodeLyricsfileYamlString(word.text ?? '')}`);
          if (word.voice !== undefined && word.voice !== null && String(word.voice) !== '') {
            out.push(`        voice: ${encodeLyricsfileYamlString(word.voice)}`);
          }
        }
      }
    }

    return out.join('\n');
  }

  const LYRIC_SYNC_INDEX_CACHE = new WeakMap();

  function buildSegmentMaxTree(entries) {
    const n = entries.length;
    let size = 1;
    while (size < n) size <<= 1;
    const tree = new Float64Array(size * 2);
    tree.fill(-Infinity);
    for (let i = 0; i < n; i++) {
      tree[size + i] = entries[i].endMs;
    }
    for (let i = size - 1; i >= 1; i--) {
      const left = tree[i * 2];
      const right = tree[i * 2 + 1];
      tree[i] = left >= right ? left : right;
    }
    return { tree, size, count: n };
  }

  // Pure O(log N) rightmost query on [0..maxIndex] where endMs > timeMs
  function findRightmostSpanningInTree(seg, maxIndex, timeMs) {
    if (!seg || seg.count === 0 || maxIndex < 0) return -1;
    const limit = maxIndex < seg.count ? maxIndex : seg.count - 1;

    function descend(node, nodeLeft, nodeRight) {
      if (nodeLeft > limit || seg.tree[node] <= timeMs) return -1;
      if (nodeLeft === nodeRight) return nodeLeft;
      const mid = (nodeLeft + nodeRight) >> 1;
      const rightHit = descend(node * 2 + 1, mid + 1, nodeRight);
      if (rightHit !== -1) return rightHit;
      return descend(node * 2, nodeLeft, mid);
    }

    return descend(1, 0, seg.size - 1);
  }

  function buildWordsSyncIndex(words, parentEndMs) {
    if (!Array.isArray(words) || words.length === 0) return null;
    const normalized = new Array(words.length);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const startMs = w && w.start_ms !== undefined
        ? Number(w.start_ms)
        : (w && w.time !== undefined ? Number(w.time) * 1000 : 0);
      const safeStart = Number.isFinite(startMs) ? startMs : 0;
      normalized[i] = {
        origIndex: i,
        word: w,
        startMs: safeStart,
        rawEndMs: (w && w.end_ms !== undefined && w.end_ms !== null) ? Number(w.end_ms) : null
      };
    }
    normalized.sort((a, b) => (a.startMs - b.startMs) || (a.origIndex - b.origIndex));
    for (let i = 0; i < normalized.length; i++) {
      const cur = normalized[i];
      if (cur.rawEndMs !== null && Number.isFinite(cur.rawEndMs) && cur.rawEndMs >= cur.startMs) {
        cur.endMs = cur.rawEndMs;
      } else if (i + 1 < normalized.length && normalized[i + 1].startMs >= cur.startMs) {
        cur.endMs = normalized[i + 1].startMs;
      } else {
        cur.endMs = Math.max(cur.startMs, parentEndMs);
      }
    }
    return {
      sorted: normalized,
      seg: buildSegmentMaxTree(normalized)
    };
  }

  function getOrBuildLyricSyncIndex(lines) {
    const len = lines.length;
    const firstRef = len > 0 ? lines[0] : null;
    const lastRef = len > 0 ? lines[len - 1] : null;
    const cached = LYRIC_SYNC_INDEX_CACHE.get(lines);
    if (cached && cached.length === len && cached.firstRef === firstRef && cached.lastRef === lastRef) {
      return cached;
    }

    const sorted = new Array(len);
    for (let i = 0; i < len; i++) {
      const line = lines[i];
      const startMs = line && line.start_ms !== undefined
        ? Number(line.start_ms)
        : (line && line.time !== undefined ? Number(line.time) * 1000 : 0);
      const safeStart = Number.isFinite(startMs) ? startMs : 0;
      const isBacking = Boolean(
        line && (line.backing === true || /^(?:bg|backing|harmony|v2)$/i.test(String(line.voice || '')))
      );
      sorted[i] = {
        origIndex: i,
        line,
        startMs: safeStart,
        rawEndMs: (line && line.end_ms !== undefined && line.end_ms !== null) ? Number(line.end_ms) : null,
        isBacking,
        wordsIndex: null
      };
    }

    sorted.sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      if (a.isBacking !== b.isBacking) return a.isBacking ? 1 : -1;
      return a.origIndex - b.origIndex;
    });

    for (let i = 0; i < len; i++) {
      const item = sorted[i];
      if (item.rawEndMs !== null && Number.isFinite(item.rawEndMs) && item.rawEndMs >= item.startMs) {
        item.endMs = item.rawEndMs;
      } else if (i + 1 < len && sorted[i + 1].startMs > item.startMs) {
        item.endMs = sorted[i + 1].startMs;
      } else {
        item.endMs = item.startMs + 3000;
      }
      if (item.line && Array.isArray(item.line.words) && item.line.words.length > 0) {
        item.wordsIndex = buildWordsSyncIndex(item.line.words, item.endMs);
      }
    }

    const built = {
      length: len,
      firstRef,
      lastRef,
      sorted,
      seg: buildSegmentMaxTree(sorted)
    };
    LYRIC_SYNC_INDEX_CACHE.set(lines, built);
    return built;
  }

  function upperBoundStartMs(sorted, timeMs) {
    let low = 0;
    let high = sorted.length - 1;
    let ans = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].startMs <= timeMs) {
        ans = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return ans;
  }

  function findActiveLyricStateBinary(linesOrDoc, currentTimeMs, options = {}) {
    const lines = Array.isArray(linesOrDoc)
      ? linesOrDoc
      : (linesOrDoc && Array.isArray(linesOrDoc.lines) ? linesOrDoc.lines : null);

    if (!lines || lines.length === 0) {
      return { lineIndex: -1, wordIndex: -1, activeLine: null, activeWord: null, progress: 0 };
    }

    const t = Number(currentTimeMs);
    if (!Number.isFinite(t) || t < 0) {
      return { lineIndex: -1, wordIndex: -1, activeLine: null, activeWord: null, progress: 0 };
    }

    const indexData = getOrBuildLyricSyncIndex(lines);
    const { sorted, seg } = indexData;

    const r = upperBoundStartMs(sorted, t);
    if (r < 0) {
      return { lineIndex: -1, wordIndex: -1, activeLine: null, activeWord: null, progress: 0 };
    }

    const spanningIdx = findRightmostSpanningInTree(seg, r, t);
    let chosenEntry = null;
    if (spanningIdx !== -1) {
      chosenEntry = sorted[spanningIdx];
    } else if (options && options.strict) {
      return { lineIndex: -1, wordIndex: -1, activeLine: null, activeWord: null, progress: 0 };
    } else {
      chosenEntry = sorted[r];
    }

    const activeLine = chosenEntry.line;
    const lineIndex = chosenEntry.origIndex;
    const lineDuration = chosenEntry.endMs - chosenEntry.startMs;
    const lineProgress = lineDuration > 0
      ? Math.min(1, Math.max(0, (t - chosenEntry.startMs) / lineDuration))
      : 1;

    let wordIndex = -1;
    let activeWord = null;
    let progress = lineProgress;

    const wIdxData = chosenEntry.wordsIndex;
    if (wIdxData && wIdxData.sorted.length > 0) {
      const wr = upperBoundStartMs(wIdxData.sorted, t);
      if (wr >= 0) {
        const wSpanIdx = findRightmostSpanningInTree(wIdxData.seg, wr, t);
        const wordEntry = wSpanIdx !== -1
          ? wIdxData.sorted[wSpanIdx]
          : ((options && options.strict) ? null : wIdxData.sorted[wr]);
        if (wordEntry) {
          wordIndex = wordEntry.origIndex;
          activeWord = wordEntry.word;
          const wordDur = wordEntry.endMs - wordEntry.startMs;
          progress = wordDur > 0
            ? Math.min(1, Math.max(0, (t - wordEntry.startMs) / wordDur))
            : (t >= wordEntry.startMs ? 1 : 0);
        }
      } else {
        progress = 0;
      }
    }

    return {
      lineIndex,
      wordIndex,
      activeLine,
      activeWord,
      progress
    };
  }

  // ── OPT-01: Zero-Allocation 60fps Visualizer & Lyric-Sync Frame Scratchpad ──
  function createZeroAllocFrameScratchpad(fftBinCount = 256) {
    const clampBinCount = raw => {
      const n = Math.floor(Number(raw) || 0);
      if (n <= 0) return 256;
      return Math.max(16, Math.min(16384, n));
    };

    let currentBinCount = clampBinCount(fftBinCount);
    let currentFftSize = currentBinCount * 2;

    const telemetry = {
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
      overallEnergy: 0,
      rms: 0,
      peak: 0,
      rmsDb: -100,
      peakDb: -100,
      activeLyricLine: -1,
      activeLyricWord: -1,
      lyricProgress: 0,
      frameCount: 0
    };

    const pad = {
      binCount: currentBinCount,
      fftSize: currentFftSize,
      freqBytes: new Uint8Array(currentBinCount),
      timeBytes: new Uint8Array(currentFftSize),
      preLimiterTimeBytes: new Uint8Array(currentFftSize),
      leftTimeBytes: new Uint8Array(currentFftSize),
      rightTimeBytes: new Uint8Array(currentFftSize),
      leftFreqBytes: new Uint8Array(currentBinCount),
      rightFreqBytes: new Uint8Array(currentBinCount),
      oscBytes: new Uint8Array(currentBinCount),
      normalizedBins: new Float32Array(currentBinCount),
      timeFloats: new Float32Array(currentFftSize),
      telemetry,

      resizeIfNeeded(nextBinCount) {
        const parsed = Math.floor(Number(nextBinCount) || 0);
        if (parsed <= 0) return false;
        const safeBins = Math.max(16, Math.min(16384, parsed));
        if (safeBins === currentBinCount) return false;

        currentBinCount = safeBins;
        currentFftSize = safeBins * 2;
        pad.binCount = currentBinCount;
        pad.fftSize = currentFftSize;
        pad.freqBytes = new Uint8Array(currentBinCount);
        pad.timeBytes = new Uint8Array(currentFftSize);
        pad.preLimiterTimeBytes = new Uint8Array(currentFftSize);
        pad.leftTimeBytes = new Uint8Array(currentFftSize);
        pad.rightTimeBytes = new Uint8Array(currentFftSize);
        pad.leftFreqBytes = new Uint8Array(currentBinCount);
        pad.rightFreqBytes = new Uint8Array(currentBinCount);
        pad.oscBytes = new Uint8Array(currentBinCount);
        pad.normalizedBins = new Float32Array(currentBinCount);
        pad.timeFloats = new Float32Array(currentFftSize);
        return true;
      },

      computeBandEnergies(freqBytes, timeDomainData, sampleRate = 44100) {
        const srcFreq = freqBytes || pad.freqBytes;
        const len = srcFreq ? srcFreq.length : 0;
        if (len <= 0) {
          telemetry.bassEnergy = 0;
          telemetry.midEnergy = 0;
          telemetry.trebleEnergy = 0;
          telemetry.overallEnergy = 0;
          telemetry.rms = 0;
          telemetry.peak = 0;
          telemetry.rmsDb = -100;
          telemetry.peakDb = -100;
          telemetry.frameCount += 1;
          return telemetry;
        }

        const isFloatFreq = srcFreq instanceof Float32Array || srcFreq instanceof Float64Array;
        const normOut = pad.normalizedBins;
        const normCap = normOut.length;
        const sRate = sampleRate > 0 ? sampleRate : 44100;
        const fSize = len * 2;
        const binHz = sRate / fSize;

        let bassSum = 0;
        let bassCount = 0;
        let midSum = 0;
        let midCount = 0;
        let trebleSum = 0;
        let trebleCount = 0;
        let totalSum = 0;
        let freqSqSum = 0;
        let freqPeak = 0;

        for (let i = 0; i < len; i++) {
          const raw = srcFreq[i];
          let norm = isFloatFreq ? raw : (raw * 0.00392156862745098); // 1 / 255
          if (norm < 0) norm = 0;
          else if (norm > 1) norm = 1;

          if (i < normCap) normOut[i] = norm;
          totalSum += norm;
          freqSqSum += norm * norm;
          if (norm > freqPeak) freqPeak = norm;

          const hz = i * binHz;
          if (hz <= 260) {
            if (i > 0 || len <= 8) {
              bassSum += norm;
              bassCount += 1;
            }
          } else if (hz <= 4000) {
            midSum += norm;
            midCount += 1;
          } else {
            trebleSum += norm;
            trebleCount += 1;
          }
        }

        if (bassCount === 0) {
          bassSum = srcFreq[0] * (isFloatFreq ? 1 : 0.00392156862745098);
          if (bassSum < 0) bassSum = 0;
          else if (bassSum > 1) bassSum = 1;
          bassCount = 1;
        }

        telemetry.bassEnergy = bassCount > 0 ? bassSum / bassCount : 0;
        telemetry.midEnergy = midCount > 0 ? midSum / midCount : 0;
        telemetry.trebleEnergy = trebleCount > 0 ? trebleSum / trebleCount : 0;
        telemetry.overallEnergy = totalSum / len;

        if (timeDomainData && timeDomainData.length > 0) {
          const tLen = timeDomainData.length;
          const isFloatTime = timeDomainData instanceof Float32Array || timeDomainData instanceof Float64Array;
          const tFloats = pad.timeFloats;
          const tCap = tFloats.length;
          let sqSum = 0;
          let maxAbs = 0;
          for (let j = 0; j < tLen; j++) {
            const sample = isFloatTime ? timeDomainData[j] : ((timeDomainData[j] - 128) * 0.0078125);
            if (j < tCap) tFloats[j] = sample;
            const absVal = sample < 0 ? -sample : sample;
            if (absVal > maxAbs) maxAbs = absVal;
            sqSum += sample * sample;
          }
          telemetry.rms = Math.sqrt(sqSum / tLen);
          telemetry.peak = maxAbs > 1 ? 1 : maxAbs;
        } else {
          telemetry.rms = Math.sqrt(freqSqSum / len);
          telemetry.peak = freqPeak;
        }

        telemetry.rmsDb = telemetry.rms > 1e-5 ? 20 * Math.log10(telemetry.rms) : -100;
        telemetry.peakDb = telemetry.peak > 1e-5 ? 20 * Math.log10(telemetry.peak) : -100;
        telemetry.frameCount += 1;
        return telemetry;
      },

      syncLyricsInPlace(lines, currentTimeMs) {
        if (!Array.isArray(lines) || lines.length === 0) {
          telemetry.activeLyricLine = -1;
          telemetry.activeLyricWord = -1;
          telemetry.lyricProgress = 0;
          return telemetry;
        }
        const t = Number(currentTimeMs);
        if (!(t >= 0)) {
          telemetry.activeLyricLine = -1;
          telemetry.activeLyricWord = -1;
          telemetry.lyricProgress = 0;
          return telemetry;
        }
        const indexData = getOrBuildLyricSyncIndex(lines);
        const r = upperBoundStartMs(indexData.sorted, t);
        if (r < 0) {
          telemetry.activeLyricLine = -1;
          telemetry.activeLyricWord = -1;
          telemetry.lyricProgress = 0;
          return telemetry;
        }
        const spanIdx = findRightmostSpanningInTree(indexData.seg, r, t);
        const chosen = spanIdx !== -1 ? indexData.sorted[spanIdx] : indexData.sorted[r];
        telemetry.activeLyricLine = chosen.origIndex;
        const lineDur = chosen.endMs - chosen.startMs;
        let prog = lineDur > 0 ? (t - chosen.startMs) / lineDur : 1;
        if (prog < 0) prog = 0;
        else if (prog > 1) prog = 1;

        let wOrig = -1;
        const wData = chosen.wordsIndex;
        if (wData && wData.sorted.length > 0) {
          const wr = upperBoundStartMs(wData.sorted, t);
          if (wr >= 0) {
            const wSpan = findRightmostSpanningInTree(wData.seg, wr, t);
            const wChosen = wSpan !== -1 ? wData.sorted[wSpan] : wData.sorted[wr];
            wOrig = wChosen.origIndex;
            const wDur = wChosen.endMs - wChosen.startMs;
            prog = wDur > 0 ? (t - wChosen.startMs) / wDur : 1;
            if (prog < 0) prog = 0;
            else if (prog > 1) prog = 1;
          } else {
            prog = 0;
          }
        }
        telemetry.activeLyricWord = wOrig;
        telemetry.lyricProgress = prog;
        return telemetry;
      }
    };

    return pad;
  }

  // ── BUG-02: Deep Safe Container Metadata Parser (FLAC / WAV / RF64 / AIFF / DSF / DFF) ──
  function decodeIeee80ExtendedFloat(u8, offset) {
    if (!u8 || offset < 0 || offset + 10 > u8.byteLength) return 0;
    const sign = (u8[offset] & 0x80) ? -1 : 1;
    const exponent = ((u8[offset] & 0x7f) << 8) | u8[offset + 1];
    const hiMantissa = (
      (u8[offset + 2] * 16777216) +
      (u8[offset + 3] << 16) +
      (u8[offset + 4] << 8) +
      u8[offset + 5]
    ) >>> 0;
    const loMantissa = (
      (u8[offset + 6] * 16777216) +
      (u8[offset + 7] << 16) +
      (u8[offset + 8] << 8) +
      u8[offset + 9]
    ) >>> 0;
    if (exponent === 0 && hiMantissa === 0 && loMantissa === 0) return 0;
    if (exponent === 0x7fff) return 0;
    const value = (hiMantissa * Math.pow(2, exponent - 16383 - 31)) +
      (loMantissa * Math.pow(2, exponent - 16383 - 63));
    return Number.isFinite(value) ? sign * value : 0;
  }

  function resolveDsdRateLabel(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return '';
    for (const base of [44100, 48000]) {
      const mult = sampleRate / base;
      if (Number.isInteger(mult) && mult >= 32 && (mult & (mult - 1)) === 0) {
        return `DSD${mult}`;
      }
    }
    return 'DSD';
  }

  function parseSafeAudioContainerMetadata(buffer) {
    const emptyResult = (error = 'empty_buffer', byteLength = 0, truncated = true, format = 'UNKNOWN') => ({
      valid: false,
      format,
      sampleRate: 0,
      channels: 0,
      bitDepth: 0,
      durationSeconds: 0,
      byteLength,
      truncated,
      error
    });

    if (!buffer) return emptyResult('empty_buffer', 0, true);

    let u8 = null;
    try {
      if (buffer instanceof Uint8Array) {
        u8 = buffer;
      } else if (ArrayBuffer.isView(buffer) && buffer.buffer instanceof ArrayBuffer) {
        u8 = new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength || 0);
      } else if (buffer instanceof ArrayBuffer) {
        u8 = new Uint8Array(buffer);
      } else if (Array.isArray(buffer)) {
        u8 = Uint8Array.from(buffer);
      } else {
        return emptyResult('invalid_buffer_type', 0, true);
      }
    } catch (_) {
      return emptyResult('invalid_buffer_view', 0, true);
    }

    const byteLength = u8.byteLength;
    if (byteLength === 0) return emptyResult('empty_buffer', 0, true);

    const view = new DataView(u8.buffer, u8.byteOffset, byteLength);
    const hasBytes = (offset, length) =>
      Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0 && (offset + length) <= byteLength;

    const ascii = (offset, length) => {
      if (!hasBytes(offset, length)) return '';
      let out = '';
      for (let i = 0; i < length; i++) {
        out += String.fromCharCode(u8[offset + i]);
      }
      return out;
    };

    const u16LE = off => hasBytes(off, 2) ? view.getUint16(off, true) : null;
    const u16BE = off => hasBytes(off, 2) ? view.getUint16(off, false) : null;
    const u32LE = off => hasBytes(off, 4) ? view.getUint32(off, true) : null;
    const u32BE = off => hasBytes(off, 4) ? view.getUint32(off, false) : null;
    const u64LE = off => {
      if (!hasBytes(off, 8)) return null;
      const lo = view.getUint32(off, true);
      const hi = view.getUint32(off + 4, true);
      const combined = hi * 4294967296 + lo;
      return Number.isSafeInteger(combined) ? combined : Number.MAX_SAFE_INTEGER;
    };
    const u64BE = off => {
      if (!hasBytes(off, 8)) return null;
      const hi = view.getUint32(off, false);
      const lo = view.getUint32(off + 4, false);
      const combined = hi * 4294967296 + lo;
      return Number.isSafeInteger(combined) ? combined : Number.MAX_SAFE_INTEGER;
    };

    let baseOffset = 0;
    if (hasBytes(0, 3) && ascii(0, 3) === 'ID3') {
      if (!hasBytes(0, 10)) {
        return emptyResult('truncated_id3_header', byteLength, true, 'ID3');
      }
      const id3Size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
      const id3Footer = (u8[5] & 0x10) ? 10 : 0;
      baseOffset = 10 + id3Size + id3Footer;
      if (baseOffset >= byteLength) {
        return emptyResult('truncated_id3_body', byteLength, true, 'ID3');
      }
    }

    if (!hasBytes(baseOffset, 4)) {
      return emptyResult('truncated_magic_header', byteLength, true, 'UNKNOWN');
    }

    const magic = ascii(baseOffset, 4);

    // 1. FLAC ('fLaC')
    if (magic === 'fLaC') {
      let pos = baseOffset + 4;
      let sampleRate = 0;
      let channels = 0;
      let bitDepth = 0;
      let totalSamples = 0;
      let hasStreamInfo = false;
      let truncated = false;
      let skippedPictureBlocks = 0;
      let audioOffset = -1;

      for (let b = 0; b < 256; b++) {
        if (!hasBytes(pos, 4)) {
          truncated = true;
          break;
        }
        const headerByte = u8[pos];
        const isLast = (headerByte & 0x80) !== 0;
        const blockType = headerByte & 0x7f;
        const blockLen = (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3];
        const bodyOffset = pos + 4;
        const blockEnd = bodyOffset + blockLen;

        if (blockType === 127) {
          return {
            valid: hasStreamInfo,
            format: 'FLAC',
            sampleRate,
            channels,
            bitDepth,
            totalSamples,
            durationSeconds: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0,
            byteLength,
            truncated,
            skippedPictureBlocks,
            error: 'invalid_flac_block_type_127'
          };
        }

        if (blockType === 0) {
          if (!hasBytes(bodyOffset, 34) || blockLen < 34) {
            return {
              valid: false,
              format: 'FLAC',
              sampleRate: 0,
              channels: 0,
              bitDepth: 0,
              durationSeconds: 0,
              byteLength,
              truncated: true,
              skippedPictureBlocks,
              error: 'truncated_flac_streaminfo'
            };
          }
          sampleRate = (u8[bodyOffset + 10] << 12) | (u8[bodyOffset + 11] << 4) | (u8[bodyOffset + 12] >> 4);
          channels = ((u8[bodyOffset + 12] >> 1) & 0x07) + 1;
          bitDepth = (((u8[bodyOffset + 12] & 0x01) << 4) | (u8[bodyOffset + 13] >> 4)) + 1;
          const samplesHi = u8[bodyOffset + 13] & 0x0f;
          const samplesLo = view.getUint32(bodyOffset + 14, false);
          totalSamples = samplesHi * 4294967296 + samplesLo;
          hasStreamInfo = sampleRate > 0 && channels > 0 && bitDepth > 0;
        } else if (blockType === 6) {
          skippedPictureBlocks += 1;
        }

        if (!hasBytes(bodyOffset, blockLen)) {
          truncated = true;
          break;
        }

        pos = blockEnd;
        if (isLast) {
          audioOffset = pos;
          break;
        }
      }

      if (!hasStreamInfo) {
        return {
          valid: false,
          format: 'FLAC',
          sampleRate: 0,
          channels: 0,
          bitDepth: 0,
          durationSeconds: 0,
          byteLength,
          truncated: true,
          skippedPictureBlocks,
          error: 'missing_or_truncated_flac_streaminfo'
        };
      }

      return {
        valid: true,
        format: 'FLAC',
        sampleRate,
        channels,
        bitDepth,
        totalSamples,
        durationSeconds: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0,
        audioOffset,
        skippedPictureBlocks,
        byteLength,
        truncated
      };
    }

    // 2. WAV / RF64 ('RIFF' / 'RF64' / 'BW64' ... 'WAVE')
    if (magic === 'RIFF' || magic === 'RF64' || magic === 'BW64') {
      const containerFormat = (magic === 'RF64' || magic === 'BW64') ? 'RF64' : 'WAV';
      if (!hasBytes(baseOffset, 12) || ascii(baseOffset + 8, 4) !== 'WAVE') {
        return emptyResult('truncated_or_invalid_wave_header', byteLength, !hasBytes(baseOffset, 12), containerFormat);
      }

      let pos = baseOffset + 12;
      let sampleRate = 0;
      let channels = 0;
      let bitDepth = 0;
      let byteRate = 0;
      let audioFormat = 0;
      let hasFmt = false;
      let dataOffset = -1;
      let dataSize = 0;
      let rf64DataSize = null;
      let truncated = false;
      const skippedChunks = [];

      for (let c = 0; c < 512 && pos < byteLength; c++) {
        if (!hasBytes(pos, 8)) {
          truncated = true;
          break;
        }
        const chunkId = ascii(pos, 4);
        const chunkSize32 = u32LE(pos + 4);
        const bodyOffset = pos + 8;

        if (chunkId === 'ds64') {
          if (chunkSize32 >= 28 && hasBytes(bodyOffset, 28)) {
            rf64DataSize = u64LE(bodyOffset + 8);
          } else if (!hasBytes(bodyOffset, chunkSize32)) {
            truncated = true;
            break;
          }
        } else if (chunkId === 'fmt ') {
          if (chunkSize32 < 16 || !hasBytes(bodyOffset, 16)) {
            return emptyResult('truncated_wav_fmt_chunk', byteLength, true, containerFormat);
          }
          audioFormat = u16LE(bodyOffset);
          channels = u16LE(bodyOffset + 2);
          sampleRate = u32LE(bodyOffset + 4);
          byteRate = u32LE(bodyOffset + 8);
          bitDepth = u16LE(bodyOffset + 14);
          if (audioFormat === 0xfffe && chunkSize32 >= 40 && hasBytes(bodyOffset, 40)) {
            const validBits = u16LE(bodyOffset + 18);
            if (validBits > 0) bitDepth = validBits;
          }
          hasFmt = sampleRate > 0 && channels > 0;
          if (!hasBytes(bodyOffset, chunkSize32)) {
            truncated = true;
            break;
          }
        } else if (chunkId === 'data') {
          dataOffset = bodyOffset;
          dataSize = (chunkSize32 === 0xffffffff && rf64DataSize !== null) ? rf64DataSize : chunkSize32;
          if (!hasBytes(bodyOffset, dataSize)) {
            truncated = true;
          }
          break;
        } else {
          skippedChunks.push(chunkId.trim());
          if (!hasBytes(bodyOffset, chunkSize32)) {
            truncated = true;
            break;
          }
        }

        const paddedStep = chunkSize32 + (chunkSize32 & 1);
        const nextPos = bodyOffset + paddedStep;
        if (nextPos <= pos) break;
        pos = nextPos;
      }

      if (!hasFmt) {
        return {
          valid: false,
          format: containerFormat,
          sampleRate: 0,
          channels: 0,
          bitDepth: 0,
          durationSeconds: 0,
          skippedChunks,
          byteLength,
          truncated: true,
          error: 'missing_wav_fmt_chunk'
        };
      }

      const effectiveBytesPerSec = byteRate > 0
        ? byteRate
        : (channels > 0 && bitDepth > 0 && sampleRate > 0 ? sampleRate * channels * (bitDepth / 8) : 0);
      const durationSeconds = (effectiveBytesPerSec > 0 && dataSize > 0) ? (dataSize / effectiveBytesPerSec) : 0;

      return {
        valid: true,
        format: containerFormat,
        audioFormat,
        sampleRate,
        channels,
        bitDepth,
        durationSeconds,
        dataOffset,
        dataSize,
        skippedChunks,
        byteLength,
        truncated
      };
    }

    // 3. AIFF / AIFC ('FORM' ... 'AIFF' / 'AIFC')
    if (magic === 'FORM') {
      if (!hasBytes(baseOffset, 12)) {
        return emptyResult('truncated_aiff_form_header', byteLength, true, 'AIFF');
      }
      const formType = ascii(baseOffset + 8, 4);
      if (formType !== 'AIFF' && formType !== 'AIFC') {
        return emptyResult('unsupported_iff_form_type', byteLength, false, 'UNKNOWN');
      }

      let pos = baseOffset + 12;
      let sampleRate = 0;
      let channels = 0;
      let bitDepth = 0;
      let sampleFrames = 0;
      let hasComm = false;
      let dataOffset = -1;
      let truncated = false;

      for (let c = 0; c < 512 && pos < byteLength; c++) {
        if (!hasBytes(pos, 8)) {
          truncated = true;
          break;
        }
        const chunkId = ascii(pos, 4);
        const chunkSize = u32BE(pos + 4);
        const bodyOffset = pos + 8;

        if (chunkId === 'COMM') {
          if (chunkSize < 18 || !hasBytes(bodyOffset, 18)) {
            return emptyResult('truncated_aiff_comm_chunk', byteLength, true, 'AIFF');
          }
          channels = u16BE(bodyOffset);
          sampleFrames = u32BE(bodyOffset + 2);
          bitDepth = u16BE(bodyOffset + 6);
          sampleRate = Math.round(decodeIeee80ExtendedFloat(u8, bodyOffset + 8));
          hasComm = sampleRate > 0 && channels > 0;
        } else if (chunkId === 'SSND') {
          if (hasBytes(bodyOffset, 8)) {
            const ssndOffset = u32BE(bodyOffset) || 0;
            dataOffset = bodyOffset + 8 + ssndOffset;
          } else {
            dataOffset = bodyOffset;
          }
          if (!hasBytes(bodyOffset, chunkSize)) {
            truncated = true;
          }
          break;
        }

        if (!hasBytes(bodyOffset, chunkSize)) {
          truncated = true;
          break;
        }
        const nextPos = bodyOffset + chunkSize + (chunkSize & 1);
        if (nextPos <= pos) break;
        pos = nextPos;
      }

      if (!hasComm) {
        return emptyResult('missing_aiff_comm_chunk', byteLength, true, 'AIFF');
      }

      return {
        valid: true,
        format: 'AIFF',
        sampleRate,
        channels,
        bitDepth,
        sampleFrames,
        durationSeconds: sampleRate > 0 && sampleFrames > 0 ? sampleFrames / sampleRate : 0,
        dataOffset,
        byteLength,
        truncated
      };
    }

    // 4. DSF ('DSD ' — Sony DSF LSB-first / MSB-optional container)
    if (magic === 'DSD ') {
      if (!hasBytes(baseOffset, 28)) {
        return emptyResult('truncated_dsf_dsd_chunk', byteLength, true, 'DSF');
      }
      const dsdHeaderSize = u64LE(baseOffset + 4);
      const declaredTotalSize = u64LE(baseOffset + 12);
      const fmtOffset = baseOffset + (dsdHeaderSize >= 28 && dsdHeaderSize <= 1024 ? dsdHeaderSize : 28);

      if (!hasBytes(fmtOffset, 52) || ascii(fmtOffset, 4) !== 'fmt ') {
        return emptyResult('truncated_dsf_fmt_chunk', byteLength, !hasBytes(fmtOffset, 52), 'DSF');
      }
      const fmtChunkSize = u64LE(fmtOffset + 4);
      const channels = u32LE(fmtOffset + 24);
      const sampleRate = u32LE(fmtOffset + 28);
      const bitsPerSample = u32LE(fmtOffset + 32);
      const totalSamples = u64LE(fmtOffset + 36);
      const blockSizePerChannel = u32LE(fmtOffset + 44);

      if (!sampleRate || !channels) {
        return emptyResult('invalid_dsf_fmt_parameters', byteLength, false, 'DSF');
      }

      const dataHeaderOffset = fmtOffset + (fmtChunkSize >= 52 && fmtChunkSize <= 65536 ? fmtChunkSize : 52);
      let dataOffset = -1;
      let dataSize = 0;
      let truncated = declaredTotalSize > byteLength;

      if (hasBytes(dataHeaderOffset, 12) && ascii(dataHeaderOffset, 4) === 'data') {
        const rawDataChunkSize = u64LE(dataHeaderOffset + 4);
        dataOffset = dataHeaderOffset + 12;
        dataSize = rawDataChunkSize >= 12 ? rawDataChunkSize - 12 : 0;
        if (!hasBytes(dataOffset, dataSize)) {
          truncated = true;
        }
      } else {
        truncated = true;
      }

      return {
        valid: true,
        format: 'DSF',
        dsdRateLabel: resolveDsdRateLabel(sampleRate),
        bitOrder: bitsPerSample === 8 ? 'msb' : 'lsb',
        sampleRate,
        channels,
        bitDepth: 1,
        bitsPerSample,
        totalSamples,
        blockSizePerChannel,
        durationSeconds: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0,
        dataOffset,
        dataSize,
        byteLength,
        truncated
      };
    }

    // 5. DFF ('FRM8' ... 'DSD ' — Philips DSDIFF MSB-first container)
    if (magic === 'FRM8') {
      if (!hasBytes(baseOffset, 16) || ascii(baseOffset + 12, 4) !== 'DSD ') {
        return emptyResult('truncated_or_invalid_dff_header', byteLength, !hasBytes(baseOffset, 16), 'DFF');
      }
      const frm8Size = u64BE(baseOffset + 4);
      const declaredEnd = baseOffset + 12 + (frm8Size || 0);
      let pos = baseOffset + 16;
      let sampleRate = 0;
      let channels = 0;
      let compression = 'DSD ';
      let dataOffset = -1;
      let dataSize = 0;
      let truncated = declaredEnd > byteLength;

      for (let c = 0; c < 512 && pos < byteLength; c++) {
        if (!hasBytes(pos, 12)) {
          truncated = true;
          break;
        }
        const chunkId = ascii(pos, 4);
        const chunkSize = u64BE(pos + 4);
        const bodyOffset = pos + 12;

        if (chunkId === 'DSD ' || chunkId === 'DST ') {
          if (chunkId === 'DST ') compression = 'DST ';
          dataOffset = bodyOffset;
          dataSize = chunkSize;
          if (!hasBytes(bodyOffset, chunkSize)) {
            truncated = true;
          }
          break;
        }

        if (chunkId === 'PROP') {
          if (chunkSize >= 4 && hasBytes(bodyOffset, 4) && ascii(bodyOffset, 4) === 'SND ') {
            const propLimit = Math.min(byteLength, bodyOffset + chunkSize);
            let subPos = bodyOffset + 4;
            for (let s = 0; s < 128 && subPos < propLimit; s++) {
              if (subPos + 12 > propLimit) {
                truncated = true;
                break;
              }
              const subId = ascii(subPos, 4);
              const subSize = u64BE(subPos + 4);
              const subBody = subPos + 12;
              if (subBody + subSize > propLimit) {
                truncated = true;
                break;
              }
              if (subId === 'FS  ' && subSize >= 4) {
                sampleRate = u32BE(subBody) || 0;
              } else if (subId === 'CHNL' && subSize >= 2) {
                channels = u16BE(subBody) || 0;
              } else if (subId === 'CMPR' && subSize >= 4) {
                compression = ascii(subBody, 4);
              }
              const nextSub = subBody + subSize + (subSize & 1);
              if (nextSub <= subPos) break;
              subPos = nextSub;
            }
          } else if (!hasBytes(bodyOffset, chunkSize)) {
            truncated = true;
            break;
          }
        }

        if (!hasBytes(bodyOffset, chunkSize)) {
          truncated = true;
          break;
        }
        const nextPos = bodyOffset + chunkSize + (chunkSize & 1);
        if (nextPos <= pos) break;
        pos = nextPos;
      }

      if (!sampleRate && dataOffset >= 0) sampleRate = 2822400;
      if (!channels && dataOffset >= 0) channels = 2;

      if (!sampleRate || !channels) {
        return emptyResult('missing_dff_prop_audio_info', byteLength, true, 'DFF');
      }

      const durationSeconds = (dataSize > 0 && channels > 0 && sampleRate > 0 && compression === 'DSD ')
        ? (dataSize * 8) / (channels * sampleRate)
        : 0;

      return {
        valid: true,
        format: 'DFF',
        dsdRateLabel: resolveDsdRateLabel(sampleRate),
        bitOrder: 'msb',
        compression: compression.trim(),
        sampleRate,
        channels,
        bitDepth: 1,
        durationSeconds,
        dataOffset,
        dataSize,
        byteLength,
        truncated
      };
    }

    return emptyResult('unsupported_container_format', byteLength, false, 'UNKNOWN');
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, normalizeSearchKey: metadataKey, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, fetchAudioFirstSlice, FIRST_SLICE_BYTES, flacFirstFrameOffset, FIRST_SLICE_FRAME_ALLOWANCE_BYTES, FIRST_SLICE_MAX_BYTES, fetchAudioRetryDelayMs, isFetchAudioRetryable, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks, compareTrackQuality, groupTrackVersions, parseLyrics, parseKaraokeWords, lyricWordAt, lyricLineAt, shouldScrollLyricIntoView, parseCloudConfig, PRELOAD_LEAD_SECONDS, shouldPreloadNext, clampSeekTime, CROSSFADE_MAX_SECONDS, crossfadeGains, calculateCrossfadeGains, CROSSFADE_CURVE_PROFILES, formatCrossfadeSummary, clampCrossfadeSeconds, shouldAutoCrossfade, MAX_CLOUD_CATALOG_ENTRIES, pruneCatalogEntries, MAX_CATALOG_COVER_TOTAL_CHARS, capCatalogCovers, prepareRestoredCatalog, FIRST_SLICE_CACHE_MAX_ENTRIES, FIRST_SLICE_CACHE_MAX_BYTES, DSD_FIRST_SLICE_CACHE_MAX_BYTES, sliceCacheMetaMatches, pruneSliceCacheEntries, peakRmsFromTimeDomain, queueDisplayOrder, clampBalance, formatBalance, CROSSFEED_CUTOFF_HZ, CROSSFEED_DELAY_S, CROSSFEED_MAX_GAIN, clampCrossfeed, crossfeedCrossGain, formatCrossfeed, computeSignalPath, selectRoonRadioTrack, extractDominantColors, parseReplayGain, computeReplayGainMultiplier, formatReplayGain, summarizeAlbum, formatAlbumDuration, DEFAULT_SLEEP_FADEOUT_MS, calculateSleepFadeGain, formatSleepRemaining, formatSleepCountdownCompact, calculateAlbumRemainingSeconds, extendSleepTimer, calculateAdaptiveSleepStage, isOnlineState, formatNetworkStatus, canPlayOffline, TONE_BASS_FREQ_HZ, TONE_TREBLE_FREQ_HZ, TONE_GAIN_MIN_DB, TONE_GAIN_MAX_DB, clampToneGain, formatToneGain, formatToneSummary, generateWaveformPeaks, renderWaveformCanvas, calculateHoverSeekFraction, calculateHoverSeekTime, formatHoverTime, formatWaveformStatus, generatePinkNoiseBuffer, generateBrownNoiseBuffer, generateCampfireCrackleBuffer, createAmbientChannel, clampAmbientVolume, formatAmbientVolume, formatAmbientSummary, createZoneModel, formatRoonThreeLine, parseRoonCoreEndpoint, createRoonMooMessage, parseRoonMooMessage, formatRoonZoneStatus, filterTracksByFocus, countFocusCategories, formatFocusBadge, computeRoonSignalLed, buildRoonSignalPathStages, AUTOEQ_PROFILES, getAutoEqProfile, listAutoEqProfiles, calculateAutoEqPreamp, formatAutoEqProfile, clampPhaseInvert, formatPhaseInvert, cleanSearchQuery, generateDeterministicWaveform, parseCueSheet, evaluateSmartPlaylist, clampRating, formatRating, calculateDynamicRange, formatDynamicRange, calculateBufferLookahead, formatBufferLookahead, calculateGaplessReadiness, buildSubsonicUrl, parseSubsonicSong, extractDecade, filterTracksByDecade, isScrobbleEligible, buildListenBrainzPayload, buildJellyfinUrl, parseJellyfinItem, groupTracksByAlbumArtist, calculatePlaybackRate, buildBlackCandyAuthHeader, buildBlackCandyUrl, parseBlackCandySong, parseLrcWithOffsetAndTags, smartQueuePlayNext, smartQueueAppend, smartQueueReorder, reorderQueueByIds, savePlaybackSession, restorePlaybackSession, formatResumePrompt, LIMITER_PROFILES, getLimiterProfile, applyLimiterParams, formatLimiterSummary, VISUALIZER_THEMES, getVisualizerTheme, cycleVisualizerTheme, updateVisualizerPeaks, renderVisualizerSpectrum, matchSearchQuery, scoreSearchMatch, highlightSearchMatch, SEARCH_HISTORY_KEY, getSearchHistory, addSearchHistory, clearSearchHistory, formatStorageBytes, getStorageEstimate, auditOfflineStorage, getOfflineTrackList, shouldPreloadTrack, getNextPlayableTrack, calculateAudioEnergyBands, AMBIENT_STAGE_MODES, calculateAmbientPulseTransform, formatAmbientStageSummary, calculateTrackPlaybackPosition, calculateSeekTargetTime, resolveMediaSessionPositionState, GENRE_MOOD_DEFINITIONS, detectTrackMoodAndGenre, groupTracksByGenreMood, STORAGE_TIERS, categorizeStorageItem, calculateStorageTierMetrics, auditMemoryLeaks, pruneUnreferencedObjectUrls, formatMemoryAuditSummary, STANDARD_EQ_FREQUENCIES, sanitizeBiquadFilterParams, calculateBiquadFrequencyResponse, calculateCombinedEqCurve, formatEqCurveSummary, calculateStereoPhaseCorrelation, calculateStereoSoundstageWidth, formatStereoCorrelationBadge, calculateLyricsOffsetTime, clampLyricsOffset, formatLyricsOffset, calculateLyricsLineOpacity, calculateAdaptiveCacheLimits, computeLruCacheEviction, formatCacheTelemetry, evaluateStorageHealth, calculateInterSamplePeak, calculateTruePeakHeadroom, formatTruePeakBadge, calculateSwipeGesture, calculateSpringTransform, formatSwipeHint, renderVisualizerOscilloscope, calculateQueueMetrics, formatQueueSummaryBadge, calculateLyricWordProgress, generateLrcExportContent, exportAppConfiguration, validateAndParseConfiguration, mergeRestoredConfiguration, calculateAudioMemoryFootprint, ROOM_ACOUSTIC_PROFILES, getRoomAcousticProfile, listRoomAcousticProfiles, clampAcousticWet, calculateAcousticWetDry, formatAcousticSummary, generateImpulseResponse, calculateVuBallistics, cycleVisualizerMode, formatVisualizerMode, renderVisualizerVuMeter, scheduleMultiTrackPreload, defragmentCacheDatabase, calculatePreloadReadiness, formatPreloadReadinessBadge, PARAMETRIC_EQ_PRESETS, getParametricEqPreset, listParametricEqPresets, calculatePresetAutoPreamp, formatParametricEqSummary, hexToRgba, calculateVisualizerStrobe, renderVisualizerBackdropGlow, formatVisualizerThemeSummary, resolveAlbumPlaybackQueue, resolveNextSequentialTrack, shouldEnforceSequentialPlayback, formatPlaybackContextSummary, buildShareablePlaylistPayload, encodeShareablePlaylistLink, parseShareablePlaylistPayload, matchPlaylistWithLibrary, exportPlaylistM3u8, parseM3u8Playlist, calculateAudioChunkRanges, shouldCacheAudioStream, formatStreamChunkStatus, buildServiceWorkerCacheManifest, SUB_BASS_PUNCH_PROFILES, getSubBassPunchProfile, calculateSubBassPunchParams, formatSubBassPunchSummary, calculateLowFrequencyTransientDecay, calculateThermalBallistics, formatThermalBallisticsBadge, calculateSoundstageAcousticVectors, formatSoundstageVectorsSummary, renderAcousticSoundstageCanvas, ACOUSTIC_TAG_TAXONOMY, autoTagTrackAcoustics, CONTEXTUAL_PLAYLIST_PRESETS, recommendContextualPlaylist, formatContextualRecommendationBadge, calculateNetworkThroughputAdaptiveProfile, calculateThrottlingBackoff, evaluateLookaheadBufferPipeline, formatLookaheadPipelineTelemetry, LOUDNESS_STANDARDS, getLoudnessStandard, listLoudnessStandards, calculateTruePeakAutoGuard, estimateLoudnessLUFS, calculateDynamicReplayGain, formatDynamicReplayGainSummary, STAGE_AURA_PRESETS, getStageAuraPreset, listStageAuraPresets, calculateMultiBandStrobe, renderMultiBandAmbientAura, formatMultiBandAuraSummary, cleanLyricsSearchKey, calculateStringSimilarity, scoreLyricsCandidateMatch, normalizeAndSanitizeLrc, createLyricsVaultEntry, validateLyricsVaultEntry, formatLyricsVaultTelemetry, scheduleQueueLyricsPreload, FORMAT_CODES, REVERSE_FORMAT_CODES, SOURCE_CODES, REVERSE_SOURCE_CODES, compressLibraryTrackIndex, decompressLibraryTrackIndex, buildLibraryInvertedIndex, queryInvertedIndex, batchProcessLibraryScan, evaluateLibraryIndexHealth, formatLibraryIndexHealthReport, CROSSFEED_PRESETS, getCrossfeedPreset, listCrossfeedPresets, calculateCrossfeedMatrixParams, formatCrossfeedMatrixSummary, calculateAdaptiveRoomWetDry, calculateLogarithmicFrequencyBins, calculateBallisticSpectrumDynamics, calculateBeatStrobeChromaticAura, BPM_TEMPO_TIERS, getTempoTier, estimateTrackBpmFromEnergyHistory, formatTempoEnergyBadge, sequenceHarmonicBpmQueue, filterTracksByBpmTier, computeLibraryDifferentialDelta, mergeDifferentialCatalog, formatDifferentialSyncTelemetry, estimateOfflineStorageAvailability, formatStorageCapacityForecast, TUBE_EMULATION_PROFILES, getTubeEmulationProfile, listTubeEmulationProfiles, generateTubeTransferCurve, formatTubeEmulationSummary, calculateMiniHudScrubFraction, calculateMiniHudScrubTime, renderMiniHudWaveformScrubber, calculateVuGravityBallistics, formatVuBallisticsTelemetry, calculateSonicSimilarityScore, generateSonicFlowQueue, formatSonicFlowBadge, filterTracksBySonicRange, evaluateAudioMemoryBudget, compressChunkMetadataMap, decompressChunkMetadataMap, formatAudioMemoryBudgetTelemetry, DSD_ULTRASONIC_FILTERS, getDsdUltrasonicFilter, listDsdUltrasonicFilters, calculateUltrasonicFilterResponse, formatDsdUltrasonicFilterTelemetry, calculateSpatialVectorSpectrogram, formatSpatialVectorTelemetry, renderSpatialVectorCanvas, calculateTrackEngagementRating, categorizeFavoritesByMoodQuality, formatTrackEngagementTelemetry, calculatePrefetchPriorityScore, evaluateCachePipelineConcurrency, scheduleOfflineQueuePrefetch, formatPrefetchQueueTelemetry, SUB_BASS_PHASE_PROFILES, getSubBassPhaseProfile, listSubBassPhaseProfiles, calculateSubBassPhaseParams, generateBassExciterTransferCurve, formatSubBassPhaseTelemetry, POLAR_RADAR_MODES, getPolarRadarMode, calculatePolarRadarSoundstage, formatPolarRadarTelemetry, renderPolarRadarCanvas, createOptimisticTrackState, formatSelectionLatency, canStartInstantPlayback, scheduleNonBlockingTask, buildAlbumKey, propagateAlbumCovers, resolveTrackCover, extractFolderArtCandidates, instantResolveTrackCover, instantPropagateCovers, createFiioTrack, parseFiioScanResults, isFiioDapEnvironment, getFiioDapMode, formatFiioScanTelemetry, parseCloudAuthTokenInput, diagnoseCloudAuthError, buildTrackAnnotationKey, normalizeTrackAnnotation, formatAnnotationSummary, mergeTrackAnnotations, filterTracksByAnnotationQuery, safeRevokeObjectUrlRegistry, createAbortableTrackLoader, validateBinaryAudioHeaderBounds, computeLrclibRetryDelayMs, parseLyricsfileYaml, serializeLyricsfileYaml, findActiveLyricStateBinary, createZeroAllocFrameScratchpad, parseSafeAudioContainerMetadata};
});
