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
assert.deepStrictEqual(utils.resolveTrackMetadata({title:' Track  1 ', artist:'unknown', album:'—'}, {title:'Song', artist:'Artist', album:'Album'}), {title:'Track 1', artist:'Artist', album:'Album'});
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').artist, utils.UNKNOWN_ARTIST);
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').title, 'Hello');

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
assert.strictEqual(utils.metadataOptions(tracks, 'album', utils.UNKNOWN_ALBUM).length, 3);
assert.strictEqual(utils.metadataOptions([{artist:'Adele'}, {artist:' adele  '}], 'artist', utils.UNKNOWN_ARTIST).length, 1);
const albumGroups = utils.groupTracks(tracks, 'album');
assert.strictEqual(albumGroups.length, 3, 'same album title by different artists should not be merged');
assert.ok(albumGroups.some(group => group.label === 'Adele — 25'));
assert.ok(albumGroups.some(group => group.label === 'Other — 25' && group.tracks.length === 2));
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
