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
    return /^(?:|[-—?]|unknown(?: artist| album)?|nghệ sĩ không xác định|bài hát không tên|chưa rõ album|fiio internal & sd card|single\s*\/\s*chưa rõ album|<unknown>|n\/a)$/i.test(text) ? '' : text;
  };

  function isTrustedArtworkUrl(rawUrl, allowedHostSuffixes) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'https:') return '';
      const host = parsed.hostname.toLowerCase();
      for (let i = 0; i < allowedHostSuffixes.length; i++) {
        const suffix = allowedHostSuffixes[i];
        if (host === suffix || host.endsWith('.' + suffix)) return parsed.href;
      }
    } catch (_) {}
    return '';
  }

  function upgradeItunesArtworkUrl(rawUrl, sizePx) {
    const safe = isTrustedArtworkUrl(rawUrl, ['mzstatic.com']);
    if (!safe) return '';
    const px = Number(sizePx) >= 500 ? 500 : 300;
    return safe.replace(/\/\d+x\d+bb\.(jpe?g|png|webp)(\?.*)?$/i, '/' + px + 'x' + px + 'bb.$1$2');
  }

  function normMatchText(val) {
    return String(val || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  async function fetchOnlineAlbumCover(album, artist, options) {
    const opts = options || {};
    const fetchFn = opts.fetchImpl || (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (typeof fetchFn !== 'function') return '';
    const cleanAlbum = usableMetadata(album);
    const cleanArtist = usableMetadata(artist);
    const cleanTitle = usableMetadata(opts.title);
    const sizePx = Number(opts.size) || 300;
    if (!cleanAlbum && !(cleanArtist && cleanTitle)) return '';

    const runQuery = async function (term, entity, limit) {
      try {
        const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=' + entity + '&limit=' + limit;
        const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
        if (!res || !res.ok) return [];
        const data = await res.json();
        return data && Array.isArray(data.results) ? data.results : [];
      } catch (_) {
        return [];
      }
    };

    try {
      const albumNorm = normMatchText(cleanAlbum);
      const artistNorm = normMatchText(cleanArtist);
      if (cleanAlbum) {
        const primaryTerm = cleanArtist ? (cleanAlbum + ' ' + cleanArtist) : cleanAlbum;
        const results = await runQuery(primaryTerm, 'album', 4);
        let bestUrl = '';
        let bestScore = -1;
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          if (!item) continue;
          const art = upgradeItunesArtworkUrl(item.artworkUrl100 || item.artworkUrl60, sizePx);
          if (!art) continue;
          const itemCol = normMatchText(item.collectionName);
          const itemArt = normMatchText(item.artistName);
          let score = 0;
          if (albumNorm && itemCol && (itemCol.indexOf(albumNorm) >= 0 || albumNorm.indexOf(itemCol) >= 0)) score += 3;
          if (artistNorm && itemArt && (itemArt.indexOf(artistNorm) >= 0 || artistNorm.indexOf(itemArt) >= 0)) score += 2;
          if (!cleanArtist && itemCol) score += 1;
          if (score > bestScore) {
            bestScore = score;
            bestUrl = art;
          }
        }
        if (bestUrl && bestScore > 0) return bestUrl;
      }

      if (cleanTitle) {
        const songTerm = cleanArtist ? (cleanTitle + ' ' + cleanArtist) : cleanTitle;
        const songResults = await runQuery(songTerm, 'song', 3);
        const titleNorm = normMatchText(cleanTitle);
        for (let i = 0; i < songResults.length; i++) {
          const item = songResults[i];
          if (!item) continue;
          const art = upgradeItunesArtworkUrl(item.artworkUrl100 || item.artworkUrl60, sizePx);
          if (!art) continue;
          const itemTitle = normMatchText(item.trackName);
          const itemArt = normMatchText(item.artistName);
          const titleOk = titleNorm && itemTitle && (itemTitle.indexOf(titleNorm) >= 0 || titleNorm.indexOf(itemTitle) >= 0);
          const artistOk = !artistNorm || (itemArt && (itemArt.indexOf(artistNorm) >= 0 || artistNorm.indexOf(itemArt) >= 0));
          if (titleOk && artistOk) return art;
        }
      }
    } catch (_) {}
    return '';
  }

  async function fetchOnlineArtistPortrait(artist, options) {
    const opts = options || {};
    const fetchFn = opts.fetchImpl || (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (typeof fetchFn !== 'function') return '';
    const cleanArtist = usableMetadata(artist);
    if (!cleanArtist) return '';
    const sizePx = Number(opts.size) || 300;
    const slug = encodeURIComponent(cleanArtist.replace(/\s+/g, '_'));
    const wikiHosts = ['https://vi.wikipedia.org', 'https://en.wikipedia.org'];

    for (let w = 0; w < wikiHosts.length; w++) {
      try {
        const res = await fetchFn(wikiHosts[w] + '/api/rest_v1/page/summary/' + slug, {
          headers: { Accept: 'application/json' }
        });
        if (!res || !res.ok) continue;
        const data = await res.json();
        const thumbSrc = data && data.thumbnail && data.thumbnail.source;
        const safeThumb = isTrustedArtworkUrl(thumbSrc, ['upload.wikimedia.org']);
        if (safeThumb) return safeThumb;
      } catch (_) {}
    }

    try {
      const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(cleanArtist) + '&entity=album&limit=3';
      const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
      if (res && res.ok) {
        const data = await res.json();
        const list = data && Array.isArray(data.results) ? data.results : [];
        const artistNorm = normMatchText(cleanArtist);
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (!item) continue;
          const itemArt = normMatchText(item.artistName);
          if (artistNorm && itemArt && (itemArt.indexOf(artistNorm) >= 0 || artistNorm.indexOf(itemArt) >= 0)) {
            const art = upgradeItunesArtworkUrl(item.artworkUrl100 || item.artworkUrl60, sizePx);
            if (art) return art;
          }
        }
      }
    } catch (_) {}
    return '';
  }

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

  return {buildSearchQuery, createMetadataClient, fetchOnlineAlbumCover, fetchOnlineArtistPortrait};
});
