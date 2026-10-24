'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utils = require('./library-utils.js');
new vm.Script(fs.readFileSync(path.join(__dirname, 'library-utils.js'), 'utf8'), {filename: 'library-utils.js'});

assert.deepStrictEqual(utils.parseFilenameMetadata('Adele - 25 - Hello.mp3'), {title:'Hello', artist:'Adele', album:'25'});
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').artist, utils.UNKNOWN_ARTIST);
assert.strictEqual(utils.parseFilenameMetadata('Hello.flac').title, 'Hello');

const tracks = [
  {title:'Hello', artist:'Adele', album:'25', source:'local'},
  {title:'Rolling', artist:'Adele', album:'21', source:'google'},
  {title:'Song', artist:'Other', album:'25', source:'local'}
];
assert.strictEqual(utils.filterTracks(tracks, {source:'all', artist:'Adele', album:'*', query:'', isFavorite:() => true}).length, 2);
assert.strictEqual(utils.filterTracks(tracks, {source:'local', artist:'*', album:'25', query:'', isFavorite:() => true}).length, 2);
assert.strictEqual(utils.groupTracks(tracks, 'album').length, 2);
assert.strictEqual(utils.groupTracks(tracks, 'none')[0].tracks.length, 3);

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
