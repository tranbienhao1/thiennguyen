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

  function stripLeadingTrackNumber(value) {
    const text = normalize(value).replace(/^0\d{1,2}(?:\s+|[-_.\s]\s*)/, '');
    return stripTrackPrefix(text);
  }

  function primaryArtistName(value, fallback = UNKNOWN_ARTIST) {
    let text = stripLeadingTrackNumber(value);
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

  function parseFilenameMetadata(filename) {
    const pathParts = normalize(filename).replace(/\\/g, '/').split('/').filter(Boolean);
    const originalName = pathParts.pop() || '';
    const baseName = stripTrackPrefix(originalName.replace(/\.[^.]+$/, ''));
    const parts = baseName.split(/\s+[–—-]\s+/).map(stripTrackPrefix).filter(Boolean);
    if (parts.length >= 2) {
      const title = cleanMetadataValue(parts[parts.length - 1], 'Bài hát không tên');
      return {
        title,
        artist:primaryArtistName(parts[0]),
        album:parts.length > 2 ? primaryAlbumName(parts.slice(1, -1).join(' - ')) : UNKNOWN_ALBUM
      };
    }
    const metadataFolders = pathParts.filter(part => !/^(?:cd|disc|disk)\s*\d+$/i.test(normalize(part)));
    if (metadataFolders.length >= 2) {
      return {
        title:cleanMetadataValue(baseName, 'Bài hát không tên'),
        artist:primaryArtistName(metadataFolders[metadataFolders.length - 2]),
        album:primaryAlbumName(metadataFolders[metadataFolders.length - 1])
      };
    }
    return {title:cleanMetadataValue(baseName, 'Bài hát không tên'), artist:UNKNOWN_ARTIST, album:UNKNOWN_ALBUM};
  }

  function resolveTrackMetadata(tags = {}, fallback = {}) {
    const fallbackMetadata = {
      title:cleanMetadataValue(fallback.title, 'Bài hát không tên'),
      artist:primaryArtistName(fallback.artist),
      album:primaryAlbumName(fallback.album)
    };
    return {
      title:cleanMetadataValue(tags.title, fallbackMetadata.title),
      artist:primaryArtistName(tags.artist, fallbackMetadata.artist),
      album:primaryAlbumName(tags.album, fallbackMetadata.album)
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
      artist:primaryArtistName(track && track.artist),
      album:primaryAlbumName(track && track.album)
    };
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
        const label = metadata.album === UNKNOWN_ALBUM ? 'Chưa rõ album' : metadata.album;
        if (!groups.has(key)) groups.set(key, {label, tracks:[]});
        groups.get(key).tracks.push(track);
      }
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, parseFilenameMetadata, resolveTrackMetadata, normalizeAudioBlob, fetchAudioBlob, trackMetadata, historyTrackKey, metadataOptions, filterTracks, groupTracks};
});
