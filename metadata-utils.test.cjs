'use strict';

const assert = require('node:assert/strict');
const metadata = require('./metadata-utils.js');

assert.equal(metadata.buildSearchQuery('track', {title:'Song', artist:'A / B'}), 'recording:"Song" AND artist:"A \\/ B"');
assert.equal(metadata.buildSearchQuery('album', {album:'25', artist:'Adele'}), 'release:"25" AND artist:"Adele"');
assert.equal(metadata.buildSearchQuery('artist', {artist:'Björk'}), 'artist:"Björk"');
assert.equal(metadata.buildSearchQuery('track', {}, '  Take Five  '), 'recording:"Take Five"');
assert.equal(metadata.buildSearchQuery('album', {}), '');
assert.equal(metadata.buildSearchQuery('track', {title:'Bài hát không tên',artist:'Nghệ sĩ không xác định'}), '');
assert.equal(metadata.buildSearchQuery('album', {album:'Chưa rõ album'}), '');
assert.throws(() => metadata.buildSearchQuery('genre', {}), /không hợp lệ/i);

const ids = {
  recording:'11111111-1111-4111-8111-111111111111',
  release:'22222222-2222-4222-8222-222222222222',
  artist:'33333333-3333-4333-8333-333333333333'
};
const requests = [];
const waits = [];
let lastOptions = null;
let clock = 0;
const client = metadata.createMetadataClient({
  intervalMs:1000,
  now:() => clock,
  wait:async milliseconds => { waits.push(milliseconds); clock += milliseconds; },
  fetchImpl:async (url, options) => {
    lastOptions = options;
    requests.push(new URL(url));
    const parsed = new URL(url);
    if (parsed.hostname === 'musicbrainz.org' && parsed.pathname.endsWith('/recording')) return {ok:true,json:async () => ({recordings:[{id:ids.recording,title:'Song'}]})};
    if (parsed.hostname === 'musicbrainz.org' && parsed.pathname.endsWith('/release')) return {ok:true,json:async () => ({releases:[{id:ids.release,title:'Album'}]})};
    if (parsed.hostname === 'coverartarchive.org' && parsed.pathname.endsWith(`/release/${ids.release}`)) return {ok:true,json:async () => ({images:[{front:true,image:'https://coverartarchive.org/album-front.jpg',thumbnails:{'250':'https://coverartarchive.org/album-250.jpg'}}]})};
    if (parsed.hostname === 'musicbrainz.org' && parsed.pathname.endsWith(`/recording/${ids.recording}`)) return {ok:true,json:async () => ({recording:{id:ids.recording,title:'Song',relations:[]}})};
    if (parsed.hostname === 'musicbrainz.org' && parsed.pathname.endsWith(`/release/${ids.release}`)) return {ok:true,json:async () => ({release:{id:ids.release,title:'Album'}})};
    if (parsed.hostname === 'musicbrainz.org' && parsed.pathname.endsWith(`/artist/${ids.artist}`)) return {ok:true,json:async () => ({artist:{id:ids.artist,name:'Artist'}})};
    if (parsed.hostname === 'coverartarchive.org') return {ok:true,json:async () => ({images:[{front:true,image:'https://coverartarchive.org/full.jpg',thumbnails:{'500':'https://coverartarchive.org/500.jpg'}}]})};
    if (parsed.hostname === 'en.wikipedia.org') return {ok:true,json:async () => ({title:'Artist',extract:'Biography',thumbnail:{source:'https://upload.wikimedia.org/artist.jpg'},content_urls:{desktop:{page:'https://en.wikipedia.org/wiki/Artist'}}})};
    return {ok:false,status:404,json:async () => ({})};
  }
});

(async () => {
  const results = await client.search('track', {title:'Song',artist:'Artist'});
  assert.match(requests.length >= 1 ? 'MusicBrainz request recorded' : '', /recorded/);
  assert.equal(lastOptions.headers.Accept, 'application/json');
  assert.equal(results[0].id, ids.recording);
  const albumResults = await client.search('album', {album:'Album',artist:'Artist'});
  assert.equal(albumResults[0].cover, 'https://coverartarchive.org/album-250.jpg');
  assert.equal(albumResults[0].id, ids.release);
  assert.equal(requests[0].hostname, 'musicbrainz.org');
  assert.equal(requests[0].pathname, '/ws/2/recording');
  assert.equal(requests[0].searchParams.get('fmt'), 'json');
  assert.equal(requests[0].searchParams.get('limit'), '10');
  assert.match(requests[0].searchParams.get('query'), /recording:/);
  assert.match((await (async () => { const response = await client.details('track', ids.recording); return response.title; })()), /Song/);
  assert.equal(waits.length, 2);
  assert.equal(waits[0], 1000);
  assert.equal(waits[1], 1000);
  await client.details('track', ids.recording);
  assert.match(requests.at(-1).searchParams.get('inc'), /artist-rels/);
  await client.details('album', ids.release);
  assert.match(requests.at(-1).searchParams.get('inc'), /recordings/);
  assert.match(requests.at(-1).searchParams.get('inc'), /artist-rels/);
  await client.details('artist', ids.artist);
  assert.match(requests.at(-1).searchParams.get('inc'), /url-rels/);
  assert.ok(waits.length >= 3 && waits.every(delay => delay >= 1000), 'MusicBrainz requests should be separated by at least one second');
  const cover = await client.coverArt(ids.release);
  assert.equal(cover.thumbnail, 'https://coverartarchive.org/album-250.jpg');
  assert.equal((await client.coverArt('not-an-mbid')), null);
  const unsafeArtClient = metadata.createMetadataClient({fetchImpl:async () => ({ok:true,json:async () => ({images:[{front:true,image:'javascript:alert(1)',thumbnails:{'500':'javascript:alert(1)'}}]})})});
  assert.deepEqual(await unsafeArtClient.coverArt(ids.release), {url:'',thumbnail:''}, 'Untrusted cover-art URLs should never be returned');
  const bio = await client.wikipediaSummary('https://en.wikipedia.org/wiki/Artist');
  assert.equal(bio.extract, 'Biography');
  assert.equal(await client.wikipediaSummary('https://example.org/wiki/Artist'), null);

  const missingClient = metadata.createMetadataClient({fetchImpl:async () => ({ok:false,status:404})});
  assert.equal(await missingClient.coverArt(ids.release), null, 'Missing cover art should not fail metadata lookup');
  const unavailableClient = metadata.createMetadataClient({fetchImpl:async () => ({ok:false,status:503})});
  await assert.rejects(() => unavailableClient.search('artist', {artist:'Artist'}), /giới hạn/i);
  await assert.rejects(() => client.details('artist', 'invalid'), /MusicBrainz/i);
  console.log('Music metadata query, rate-limit, detail, cover-art and biography tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
