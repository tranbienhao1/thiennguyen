'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneLibrary = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const UNKNOWN_ARTIST = 'Nghệ sĩ không xác định';
  const UNKNOWN_ALBUM = '—';
  const normalize = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const metadataKey = value => normalize(value).normalize('NFKC').toLocaleLowerCase('vi');
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

  async function fetchAudioBlob(url, options = {}, provider = 'Cloud') {
    let response;
    try { response = await fetch(url, options); }
    catch (error) { throw new Error(`${provider} không thể tải âm thanh. Kiểm tra kết nối, quyền truy cập và cấu hình CORS rồi thử lại. (${error.message || error})`); }
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
    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error(`${provider} trả về file âm thanh rỗng.`);
    return blob;
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

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks};
});
