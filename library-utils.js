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

  function parseFilenameMetadata(filename) {
    const pathParts = normalize(filename).replace(/\\/g, '/').split('/').filter(Boolean);
    const originalName = pathParts.pop() || '';
    const baseName = stripTrackPrefix(originalName.replace(/\.[^.]+$/, ''));
    const parts = baseName.split(/\s+[–—-]\s+/).map(stripTrackPrefix).filter(Boolean);
    if (parts.length >= 2) {
      const title = cleanMetadataValue(parts[parts.length - 1], 'Bài hát không tên');
      return {
        title,
        artist:cleanMetadataValue(parts[0], UNKNOWN_ARTIST),
        album:parts.length > 2 ? cleanMetadataValue(parts.slice(1, -1).join(' - '), UNKNOWN_ALBUM) : UNKNOWN_ALBUM
      };
    }
    const metadataFolders = pathParts.filter(part => !/^(?:cd|disc|disk)\s*\d+$/i.test(normalize(part)));
    if (metadataFolders.length >= 2) {
      return {
        title:cleanMetadataValue(baseName, 'Bài hát không tên'),
        artist:cleanMetadataValue(metadataFolders[metadataFolders.length - 2], UNKNOWN_ARTIST),
        album:cleanMetadataValue(metadataFolders[metadataFolders.length - 1], UNKNOWN_ALBUM)
      };
    }
    return {title:cleanMetadataValue(baseName, 'Bài hát không tên'), artist:UNKNOWN_ARTIST, album:UNKNOWN_ALBUM};
  }

  function resolveTrackMetadata(tags = {}, fallback = {}) {
    const fallbackMetadata = {
      title:cleanMetadataValue(fallback.title, 'Bài hát không tên'),
      artist:cleanMetadataValue(fallback.artist, UNKNOWN_ARTIST),
      album:cleanMetadataValue(fallback.album, UNKNOWN_ALBUM)
    };
    return {
      title:cleanMetadataValue(tags.title, fallbackMetadata.title),
      artist:cleanMetadataValue(tags.artist, fallbackMetadata.artist),
      album:cleanMetadataValue(tags.album, fallbackMetadata.album)
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

  function trackMetadata(track) {
    return {
      title:cleanMetadataValue(track && track.title, 'Bài hát không tên'),
      artist:cleanMetadataValue(track && track.artist, UNKNOWN_ARTIST),
      album:cleanMetadataValue(track && track.album, UNKNOWN_ALBUM)
    };
  }

  function metadataOptions(tracks, field, fallback) {
    const options = new Map();
    for (const track of tracks) {
      const metadata = trackMetadata(track);
      if (field === 'album') {
        const albumKey = metadataKey(metadata.album || fallback);
        const artistKey = metadataKey(metadata.artist);
        const key = `${albumKey}\t${artistKey}`;
        const label = metadata.album === UNKNOWN_ALBUM
          ? metadata.artist === UNKNOWN_ARTIST ? 'Chưa rõ nghệ sĩ / album' : `${metadata.artist} — Chưa rõ album`
          : metadata.artist === UNKNOWN_ARTIST ? metadata.album : `${metadata.artist} — ${metadata.album}`;
        if (!options.has(key)) options.set(key, label);
        continue;
      }
      const cleaned = cleanMetadataValue(track && track[field], fallback);
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
    return tracks.filter(track => {
      const metadata = trackMetadata(track);
      const trackAlbumKey = metadataKey(metadata.album);
      const trackArtistKey = metadataKey(metadata.artist);
      const albumMatches = !filters.album || filters.album === '*' || (selectedAlbumArtistKey
        ? trackAlbumKey === selectedAlbumKey && trackArtistKey === selectedAlbumArtistKey
        : trackAlbumKey === selectedAlbumKey);
      return (!filters.source || filters.source === 'all' || track.source === filters.source) &&
        (!filters.artist || filters.artist === '*' || trackArtistKey === artistKey) &&
        albumMatches &&
        (!filters.favoritesOnly || filters.isFavorite && filters.isFavorite(track)) &&
        (!query || metadataKey(`${metadata.title} ${metadata.artist} ${metadata.album}`).includes(query));
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
        const label = metadata.album === UNKNOWN_ALBUM
          ? metadata.artist === UNKNOWN_ARTIST ? 'Chưa rõ nghệ sĩ / album' : `${metadata.artist} — Chưa rõ album`
          : metadata.artist === UNKNOWN_ARTIST ? metadata.album : `${metadata.artist} — ${metadata.album}`;
        if (!groups.has(key)) groups.set(key, {label, tracks:[]});
        groups.get(key).tracks.push(track);
      }
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, trackMetadata, metadataOptions, filterTracks, groupTracks};
});
