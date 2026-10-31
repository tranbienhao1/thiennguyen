'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utils = require('./library-utils.js');
new vm.Script(fs.readFileSync(path.join(__dirname, 'library-utils.js'), 'utf8'), {filename: 'library-utils.js'});

assert.deepStrictEqual(utils.parseFilenameMetadata('Adele - 25 - Hello.mp3'), {title:'Hello', artist:'Adele', album:'25'});
assert.deepStrictEqual(utils.parseFilenameMetadata('03 - Hello.flac'), {title:'Hello', artist:utils.UNKNOWN_ARTIST, album:utils.UNKNOWN_ALBUM});
assert.deepStrictEqual(utils.parseFilenameMetadata('Artist/Album/CD 1/03 - Hello.flac'), {title:'Hello', artist:'Artist', album:'Album'});
assert.deepStrictEqual(utils.parseFilenameMetadata('01 52Hz, Rio - Song Name.flac'), {title:'Song Name', artist:'52Hz', album:utils.UNKNOWN_ALBUM});
assert.deepStrictEqual(utils.parseFilenameMetadata('01 14 Casper, Bon Nghiêm, buitruonglinh - Track.flac'), {title:'Track', artist:'14 Casper', album:utils.UNKNOWN_ALBUM});
assert.deepStrictEqual(utils.parseFilenameMetadata('01 Song.flac', '01'), {title:'Song', artist:utils.UNKNOWN_ARTIST, album:utils.UNKNOWN_ALBUM}, 'Matching numeric track tags should remove a bare filename track number');
assert.deepStrictEqual(utils.parseFilenameMetadata('10 Jvke.flac', '10'), {title:'Jvke', artist:utils.UNKNOWN_ARTIST, album:utils.UNKNOWN_ALBUM}, 'A track number matching the file tag should not leak into the filename title');
assert.deepStrictEqual(utils.parseFilenameMetadata('10 Jvke - Golden Hour.flac'), {title:'Golden Hour', artist:'Jvke', album:utils.UNKNOWN_ALBUM}, 'Track numbers 10–24 should be removed before the artist in an artist-title filename even if tags omit the track number');
assert.deepStrictEqual(utils.parseFilenameMetadata('24 Low G - Hẹn Em Ở Lần Yêu Thứ 2.flac'), {title:'Hẹn Em Ở Lần Yêu Thứ 2', artist:'Low G', album:utils.UNKNOWN_ALBUM}, 'Track number 24 should not be grouped as part of the artist name');
assert.deepStrictEqual(utils.parseFilenameMetadata('01 14 Casper - Track.flac'), {title:'Track', artist:'14 Casper', album:utils.UNKNOWN_ALBUM}, 'A legitimate numeric stage name should remain when a separate track prefix is present');
assert.deepStrictEqual(utils.parseFilenameMetadata('25 8Ball - Song.flac'), {title:'Song', artist:'25 8Ball', album:utils.UNKNOWN_ALBUM}, 'Numbers outside the affected 10–24 range should not be stripped');
assert.deepStrictEqual(utils.parseFilenameMetadata('Artist/Album/14 Casper - Song.flac', '10'), {title:'Song', artist:'14 Casper', album:'Album'}, 'A numeric artist name should survive when it does not match the track prefix');
assert.deepStrictEqual(utils.parseFilenameMetadata('Artist/Album/Artist - Song.flac'), {title:'Song', artist:'Artist', album:'Album'}, 'Folder album should supply a missing album for artist-title filenames');
assert.deepStrictEqual(utils.parseFilenameMetadata('Artists/10 Song.flac', '10'), {title:'Song', artist:utils.UNKNOWN_ARTIST, album:utils.UNKNOWN_ALBUM}, 'A single artist folder should not be misclassified as an album');
assert.deepStrictEqual(utils.resolveTrackMetadata({title:' Track  1 ', artist:'unknown', album:'—'}, {title:'Song', artist:'Artist', album:'Album'}), {title:'Track 1', artist:'Artist', album:'Album'});
assert.deepStrictEqual(utils.resolveTrackMetadata({title:'10 Song', artist:'10 Jvke', track:'10', album:'—'}, {title:'Song', artist:'10 Jvke', album:'Album'}), {title:'Song', artist:'Jvke', album:'Album'}, 'Matching track prefixes should be removed from tagged title and artist, while an unknown album falls back to the filename album');
assert.deepStrictEqual(utils.resolveTrackMetadata({title:'Song', artist:'unknown', album:'unknown', albumArtist:'Jvke', track:{no:'10', of:'12'}}, {title:'10 Song', artist:'10 Jvke', album:'Album'}), {title:'Song', artist:'Jvke', album:'Album'}, 'Alternate ID3 track and album-artist tags should resolve against filename metadata');
assert.deepStrictEqual(utils.resolveTrackMetadata({title:'Song', artist:'Jvke', album:{text:'Album'}}, {}), {title:'Song', artist:'Jvke', album:'Album'}, 'Structured Vorbis-style album values should be normalized');
assert.deepStrictEqual(utils.resolveTrackMetadata({title:'Song', artist:'24k.Right, KayC, RPT Orijinn', album:'Chưa rõ album'}, {title:'Fallback', artist:'Fallback Artist', album:'Fallback Album'}), {title:'Song', artist:'24k.Right', album:'Chưa rõ album'});
assert.deepStrictEqual(utils.trackMetadata({title:'T', artist:'01 buitruonglinh, Vũ Phụng Tiên, Đậu Tất Đạt', album:'—'}), {title:'T', artist:'buitruonglinh', album:utils.UNKNOWN_ALBUM});
assert.deepStrictEqual(utils.trackMetadata({title:'Thunder', artist:'AC/DC', album:'Back in Black'}), {title:'Thunder', artist:'AC/DC', album:'Back in Black'});
assert.deepStrictEqual(utils.trackMetadata({title:'Die With A Smile', artist:'Lady Gaga (feat. Bruno Mars)', album:'Single'}), {title:'Die With A Smile', artist:'Lady Gaga', album:'Single'});
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').artist, utils.UNKNOWN_ARTIST);
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').title, 'Hello');

const localHistoryTrack = {source:'local', relativePath:'Artist/Album/01 - Song.flac', size:1234};
const sameLocalHistoryTrack = {source:'local', relativePath:'artist/album/01 - song.flac', size:1234};
assert.strictEqual(utils.historyTrackKey(localHistoryTrack), utils.historyTrackKey(sameLocalHistoryTrack), 'Local history keys should normalize path case without retaining the path itself');
assert.ok(!utils.historyTrackKey(localHistoryTrack).includes('Artist/Album'), 'Local history keys must not expose local paths');
assert.notStrictEqual(utils.historyTrackKey(localHistoryTrack), utils.historyTrackKey({...localHistoryTrack, size:1235}), 'Different file sizes should not collide in local history');
assert.strictEqual(utils.historyTrackKey({source:'google', remoteId:'file-1'}), utils.historyTrackKey({source:'google', remoteId:'file-1'}), 'Cloud tracks should have stable history keys');
assert.notStrictEqual(utils.historyTrackKey({source:'google', remoteId:'file-1'}), utils.historyTrackKey({source:'onedrive', remoteId:'file-1'}), 'Cloud provider should be part of the history key');
assert.strictEqual(utils.historyTrackKey({source:'url', url:'https://example.com/song.mp3'}), null, 'Ephemeral direct URLs must not be persisted in listening history');
assert.strictEqual(utils.historyTrackKey({source:'local', name:''}), null, 'Local history keys require a usable file name or path');

const flacWithoutMime = utils.normalizeAudioBlob(new Blob(['flac-data'], {type:'application/octet-stream'}), 'Adele - Hello.FLAC');
assert.strictEqual(flacWithoutMime.type, 'audio/flac');
const mp3WithoutMime = utils.normalizeAudioBlob(new Blob(['mp3-data']), 'folder/Hello.mp3');
assert.strictEqual(mp3WithoutMime.type, 'audio/mpeg');
const audioMimeIsPreserved = utils.normalizeAudioBlob(new Blob(['audio-data'], {type:'audio/mp4'}), 'Hello.m4a');
assert.strictEqual(audioMimeIsPreserved.type, 'audio/mp4');
const unknownMimeIsPreserved = utils.normalizeAudioBlob(new Blob(['data']), 'track.unknown');
assert.strictEqual(unknownMimeIsPreserved.type, '');

const tracks = [
  {title:'Hello', artist:'Adele', album:'25', source:'local'},
  {title:'Rolling', artist:' adele ', album:'21', source:'google'},
  {title:'Song', artist:'Other', album:'25', source:'local'},
  {title:'Live', artist:'Other', album:'25', source:'local'}
];
assert.strictEqual(utils.filterTracks(tracks, {source:'all', artist:'Adele', album:'*', query:'', isFavorite:() => true}).length, 2);
assert.strictEqual(utils.filterTracks(tracks, {source:'local', artist:'*', album:'25', query:'', isFavorite:() => true}).length, 3);
assert.strictEqual(utils.filterTracks(tracks, {artist:'ADELE', album:'*', query:'HELLO'}).length, 1);
assert.deepStrictEqual(utils.filterTracks(tracks, {album:'25\tother'}).map(track => track.title).sort(), ['Live', 'Song']);
const cachedTrack = {title:' Original ', artist:' Artist ', album:' Record '};
const originalMetadata = utils.trackMetadata(cachedTrack);
assert.strictEqual(utils.trackMetadata(cachedTrack), originalMetadata, 'Unchanged track metadata should reuse its normalized metadata object');
assert.strictEqual(utils.filterTracks([cachedTrack], {query:'original artist'}).length, 1);
cachedTrack.title = 'Updated';
assert.strictEqual(utils.filterTracks([cachedTrack], {query:'original'}).length, 0, 'Metadata cache should invalidate when track tags change');
assert.strictEqual(utils.filterTracks([cachedTrack], {query:'updated artist'}).length, 1, 'Search normalization should refresh after tag changes');
const lazyTrack = {source:'local', get title() { throw new Error('metadata should not be normalized without search filters'); }};
assert.deepStrictEqual(utils.filterTracks([lazyTrack], {source:'all', artist:'*', album:'*'}), [lazyTrack], 'Unfiltered browse should avoid expensive metadata parsing');


assert.strictEqual(utils.metadataOptions(tracks, 'album', utils.UNKNOWN_ALBUM).length, 3);
assert.strictEqual(utils.metadataOptions([{artist:'Adele'}, {artist:' adele  '}], 'artist', utils.UNKNOWN_ARTIST).length, 1);
const albumGroups = utils.groupTracks(tracks, 'album');
assert.strictEqual(albumGroups.length, 3, 'same album title by different artists should not be merged');
assert.ok(albumGroups.some(group => group.label === '25' && group.tracks.length === 1));
assert.ok(albumGroups.some(group => group.label === '25' && group.tracks.length === 2), 'album labels should show only the album title even when grouped separately by artist');
assert.strictEqual(utils.groupTracks(tracks, 'artist').length, 2);
assert.strictEqual(utils.groupTracks(tracks, 'none')[0].tracks.length, 4);

async function expectFetchError(fetchImpl, headers, blobSize) {
  global.fetch = fetchImpl;
  await assert.rejects(() => utils.fetchAudioBlob('https://example.com/a.flac', {}, 'Drive'));
  delete global.fetch;
}
(async () => {
  await expectFetchError(async () => ({ok:false, status:401, text:async () => 'unauthorized'}));
  await expectFetchError(async () => ({ok:true, headers:{get:() => 'application/json'}, blob:async () => ({size:10})}));
  await expectFetchError(async () => ({ok:true, headers:{get:() => 'audio/flac'}, blob:async () => ({size:0})}));
  global.fetch = async () => ({ok:true, headers:{get:() => 'audio/flac'}, blob:async () => ({size:7})});
  const blob = await utils.fetchAudioBlob('https://example.com/a.flac', {}, 'Drive');
  assert.strictEqual(blob.size, 7);
  delete global.fetch;
  console.log('Library metadata, filtering, grouping and audio fetch tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
