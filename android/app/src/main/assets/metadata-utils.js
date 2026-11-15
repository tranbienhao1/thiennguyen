'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneMetadata = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
  const COVER_ART = 'https://coverartarchive.org';
  const quoteLucene = value => `"${String(value || '').replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1')}"`;
  const normalizeKind = kind => ({track:'recording', song:'recording', recording:'recording', album:'release', release:'release', artist:'artist'})[kind] || '';
  const usableMetadata = value => {
    const text = String(value || '').trim();
    return /^(?:|[-—?]|unknown(?: artist| album)?|nghệ sĩ không xác định|bài hát không tên|chưa rõ album|n\/a)$/i.test(text) ? '' : text;
  };

  function buildSearchQuery(kind, metadata = {}, query = '') {
    const entityKind = normalizeKind(kind);
    if (!entityKind) throw new Error('Loại tra cứu không hợp lệ.');
    const text = String(query || '').trim();
    if (text) return `${entityKind === 'recording' ? 'recording' : entityKind}:${quoteLucene(text)}`;
    const title = usableMetadata(entityKind === 'recording' ? metadata.title : entityKind === 'release' ? metadata.album : metadata.artist);
    const artist = usableMetadata(metadata.artist);
    if (!title) return '';
    const field = entityKind === 'recording' ? 'recording' : entityKind === 'release' ? 'release' : 'artist';
    const parts = [`${field}:${quoteLucene(title)}`];
    if (entityKind !== 'artist' && artist) parts.push(`artist:${quoteLucene(artist)}`);
    return parts.join(' AND ');
  }

  function createMetadataClient(options = {}) {
    const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
    const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(0, options.intervalMs) : 1100;
    const now = options.now || Date.now;
    const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    let nextMusicBrainzRequestAt = 0;

    async function requestJson(url, rateLimited = false) {
      if (rateLimited) {
        const scheduledAt = Math.max(now(), nextMusicBrainzRequestAt);
        const delay = scheduledAt - now();
        nextMusicBrainzRequestAt = scheduledAt + intervalMs;
        if (delay > 0) await wait(delay);
      }
      let response;
      try { response = await fetchImpl(url, {headers:{Accept:'application/json'}}); }
      catch (error) { throw new Error('Không thể kết nối dịch vụ tra cứu. Hãy kiểm tra mạng và thử lại.'); }
      if (!response || !response.ok) {
        const status = response && response.status;
        if (status === 404) return null;
        if (status === 503 || status === 429) throw new Error('MusicBrainz đang giới hạn truy cập. Vui lòng chờ một chút rồi thử lại.');
        throw new Error(`Dịch vụ tra cứu trả về lỗi${status ? ` HTTP ${status}` : ''}.`);
      }
      try { return await response.json(); }
      catch (error) { throw new Error('Dữ liệu từ dịch vụ tra cứu không hợp lệ.'); }
    }

    async function search(kind, metadata = {}, query = '') {
      const entityKind = normalizeKind(kind);
      const luceneQuery = buildSearchQuery(entityKind, metadata, query);
      if (!luceneQuery) return [];
      const resource = entityKind === 'recording' ? 'recording' : entityKind === 'release' ? 'release' : 'artist';
      const url = new URL(`${MUSICBRAINZ}/${resource}`);
      url.searchParams.set('query', luceneQuery);
      url.searchParams.set('fmt', 'json');
      url.searchParams.set('limit', '10');
      const data = await requestJson(url.href, true);
      const key = entityKind === 'recording' ? 'recordings' : entityKind === 'release' ? 'releases' : 'artists';
      if (entityKind === 'release' && data && Array.isArray(data.releases)) {
        await Promise.all(data.releases.slice(0, 5).map(async release => {
          if (!/^[\da-f-]{36}$/i.test(String(release.id || ''))) return;
          try {
            const cover = await requestJson(`${COVER_ART}/release/${release.id}`, false);
            const image = cover && Array.isArray(cover.images) && (cover.images.find(item => item.front) || cover.images[0]);
            const thumbnail = image && ((image.thumbnails || {})['250'] || image.image || '');
            try { const url = new URL(thumbnail); if (url.protocol === 'https:' && ['coverartarchive.org','archive.org'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) release.cover = url.href; } catch (error) {}
          } catch (error) { if (error.message && /giới hạn/.test(error.message)) throw error; }
        }));
      }
      return data && Array.isArray(data[key]) ? data[key] : [];
    }

    async function details(kind, mbid) {
      const entityKind = normalizeKind(kind);
      if (!entityKind || !/^[\da-f-]{36}$/i.test(String(mbid || ''))) throw new Error('Không thể mở thông tin MusicBrainz cho kết quả này.');
      const include = entityKind === 'recording'
        ? 'artists+artist-credits+releases+artist-rels+work-rels'
        : entityKind === 'release' ? 'artist-credits+recordings+labels+artist-rels+label-rels' : 'url-rels+release-groups';
      const url = new URL(`${MUSICBRAINZ}/${entityKind}/${mbid}`);
      url.searchParams.set('inc', include);
      url.searchParams.set('fmt', 'json');
      const data = await requestJson(url.href, true);
      return data && data[entityKind] ? data[entityKind] : null;
    }

    async function coverArt(mbid, kind = 'release') {
      if (!/^[\da-f-]{36}$/i.test(String(mbid || ''))) return null;
      const resource = kind === 'release-group' ? 'release-group' : 'release';
      const data = await requestJson(`${COVER_ART}/${resource}/${mbid}`, false);
      const images = data && Array.isArray(data.images) ? data.images : [];
      const image = images.find(item => item.front) || images.find(item => (item.types || []).includes('Front')) || images[0];
      const safe = value => { try { const url = new URL(value); return url.protocol === 'https:' && ['coverartarchive.org','archive.org'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : ''; } catch (error) { return ''; } };
      return image ? {url:safe(image.image), thumbnail:safe((image.thumbnails || {})['500']) || safe((image.thumbnails || {})['250']) || safe(image.image)} : null;
    }

    async function wikipediaSummary(pageUrl) {
      let page;
      try { page = new URL(pageUrl); } catch (error) { return null; }
      if (!/(^|\.)wikipedia\.org$/i.test(page.hostname) || !page.pathname.startsWith('/wiki/')) return null;
      const slug = page.pathname.slice('/wiki/'.length).split('/')[0];
      if (!slug) return null;
      const url = `${page.origin}/api/rest_v1/page/summary/${slug}`;
      const data = await requestJson(url, false);
      return data && data.extract ? {title:data.title || '', extract:data.extract, thumbnail:data.thumbnail && data.thumbnail.source || '', page:data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page || page.href} : null;
    }

    return {search, details, coverArt, wikipediaSummary};
  }

  return {buildSearchQuery, createMetadataClient};
});
