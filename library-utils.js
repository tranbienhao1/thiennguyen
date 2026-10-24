'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneLibrary = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const UNKNOWN_ARTIST = 'Nghệ sĩ không xác định';
  const UNKNOWN_ALBUM = '—';
  const normalize = value => String(value || '').trim();

  function parseFilenameMetadata(filename) {
    const baseName = normalize(filename).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').trim();
    const parts = baseName.split(/\s+[–—-]\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return {title:baseName || 'Bài hát không tên', artist:UNKNOWN_ARTIST, album:UNKNOWN_ALBUM};
    return {title:parts[parts.length - 1] || baseName, artist:parts[0] || UNKNOWN_ARTIST, album:parts.length > 2 ? parts.slice(1, -1).join(' - ') : UNKNOWN_ALBUM};
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

  function filterTracks(tracks, filters = {}) {
    const query = normalize(filters.query).toLocaleLowerCase();
    return tracks.filter(track =>
      (!filters.source || filters.source === 'all' || track.source === filters.source) &&
      (!filters.artist || filters.artist === '*' || normalize(track.artist || UNKNOWN_ARTIST) === filters.artist) &&
      (!filters.album || filters.album === '*' || normalize(track.album || UNKNOWN_ALBUM) === filters.album) &&
      (!filters.favoritesOnly || filters.isFavorite && filters.isFavorite(track)) &&
      (!query || `${track.title || ''} ${track.artist || ''} ${track.album || ''}`.toLocaleLowerCase().includes(query))
    );
  }

  function groupTracks(tracks, groupBy = 'none') {
    if (groupBy !== 'artist' && groupBy !== 'album') return [{label:'', tracks}];
    const groups = new Map();
    for (const track of tracks) {
      const label = normalize(track[groupBy]) || (groupBy === 'artist' ? UNKNOWN_ARTIST : UNKNOWN_ALBUM);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(track);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({label, tracks:items}));
  }

  return {UNKNOWN_ARTIST, UNKNOWN_ALBUM, parseFilenameMetadata, fetchAudioBlob, filterTracks, groupTracks};
});
