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

const vietnameseTracks = [
  {title:'Thiên Đường', artist:'Nguyễn Hồng Nhung', album:'Đà Lạt Hoàng Hôn', source:'local'},
  {title:'Hẹn Em Ở Lần Yêu Thứ 2', artist:'Low G', album:'—', source:'local'},
  {title:'Song', artist:'Other', album:'25', source:'local'}
];
assert.strictEqual(utils.normalizeSearchKey('Đà Lạt Hoàng Hôn'), 'da lat hoang hon', 'Search keys should strip Vietnamese diacritics and map đ to d');
assert.strictEqual(utils.normalizeSearchKey('  Thiên   Đường '), 'thien duong', 'Search keys should collapse whitespace');
assert.strictEqual(utils.normalizeSearchKey(null), '', 'Search keys should accept null');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'thien duong'}).length, 1, 'Search should match Vietnamese titles typed without diacritics');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'NGUYEN'}).length, 1, 'Search should match Vietnamese artists typed without diacritics');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'da lat'}).length, 1, 'Search should match đ when typed as d');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'thiên đường'}).length, 1, 'Search typed with diacritics should still match');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'hen em'}).length, 1, 'Search should match accented titles from plain queries');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:null}).length, 3, 'Null query should not filter tracks');
assert.strictEqual(utils.filterTracks([], {query:'thien'}).length, 0, 'Empty library should return no matches');
assert.strictEqual(utils.filterTracks(vietnameseTracks, {query:'khong co bai nay'}).length, 0, 'Unrelated query should return no matches');
assert.strictEqual(utils.metadataOptions([{artist:'Thiên'}, {artist:'Thien'}, {artist:'THIÊN'}], 'artist', utils.UNKNOWN_ARTIST).length, 1, 'Artist filter should merge accent variants into one option');
assert.strictEqual(utils.groupTracks([{artist:'Thiên', title:'A'}, {artist:'Thien', title:'B'}], 'artist').length, 1, 'Artist grouping should merge accent variants');
assert.strictEqual(utils.groupTracks([{artist:'Nguyễn', album:'Đà Lạt', title:'A'}, {artist:'Nguyen', album:'Da Lat', title:'B'}], 'album').length, 1, 'Album grouping should merge accent variants');


// Pha B — parseLyrics / lyricLineAt (.lrc đồng bộ, chưa có trong repo).
const lrc = '[ti:Test]\n[ar:Artist]\n[00:05.00]Second line\n[00:01.00][00:09.00]First and last\n[00:03.5]<00:03.50>Enhanced <00:04.00>words here\n[00:07.345]Three decimals\n[00:99.00]Bad seconds\n[00:08.00]   \nNo time tag here';
assert.deepStrictEqual(utils.parseLyrics(lrc), [
  {time:1, text:'First and last'},
  {time:3.5, text:'Enhanced words here'},
  {time:5, text:'Second line'},
  {time:7.345, text:'Three decimals'},
  {time:9, text:'First and last'}
], 'LRC should sort lines, expand multi-tag lines, strip Enhanced tags and drop bad/empty lines');
assert.deepStrictEqual(utils.parseLyrics('[offset:500]\n[00:01.00]Shifted'), [{time:1.5, text:'Shifted'}], 'LRC offset should shift every timestamp');
assert.deepStrictEqual(utils.parseLyrics('\uFEFF[00:01.00]BOM\r\n[00:02]No fraction'), [{time:1, text:'BOM'}, {time:2, text:'No fraction'}], 'LRC should accept BOM, CRLF and timestamps without fractions');
assert.deepStrictEqual(utils.parseLyrics(null), [], 'parseLyrics should accept null');
assert.deepStrictEqual(utils.parseLyrics(42), [], 'parseLyrics should accept non-string input');
assert.deepStrictEqual(utils.parseLyrics(''), [], 'parseLyrics should accept empty input');
assert.deepStrictEqual(utils.parseLyrics('[ti:Only metadata]'), [], 'parseLyrics should return no lines for metadata-only files');
const parsedLines = utils.parseLyrics('[00:01.00]One\n[00:03.00]Two\n[00:03.00]Two again\n[00:06.00]Three');
assert.strictEqual(utils.lyricLineAt(parsedLines, 0.99), -1, 'lyricLineAt should return -1 before the first line');
assert.strictEqual(utils.lyricLineAt(parsedLines, 1), 0, 'lyricLineAt should match an exact timestamp');
assert.strictEqual(utils.lyricLineAt(parsedLines, 3), 2, 'lyricLineAt should return the last line at a duplicated timestamp');
assert.strictEqual(utils.lyricLineAt(parsedLines, 5.99), 2, 'lyricLineAt should hold the current line until the next timestamp');
assert.strictEqual(utils.lyricLineAt(parsedLines, 99), 3, 'lyricLineAt should hold the last line after the song ends');
assert.strictEqual(utils.lyricLineAt(parsedLines, NaN), -1, 'lyricLineAt should accept NaN');
assert.strictEqual(utils.lyricLineAt(null, 5), -1, 'lyricLineAt should accept null lines');
assert.strictEqual(utils.lyricLineAt([], 5), -1, 'lyricLineAt should accept empty lines');

// Pha C — parseCloudConfig (cấu hình cloud lưu trong localStorage có thể bẩn).
assert.deepStrictEqual(utils.parseCloudConfig('{"clientId":"abc","other":1}'), {clientId:'abc', other:1}, 'parseCloudConfig should keep a valid config object');
assert.deepStrictEqual(utils.parseCloudConfig('{}'), {}, 'parseCloudConfig should accept an empty object');
assert.deepStrictEqual(utils.parseCloudConfig('{"clientId":'), {}, 'parseCloudConfig should return {} for truncated JSON');
assert.deepStrictEqual(utils.parseCloudConfig('{not json'), {}, 'parseCloudConfig should return {} for invalid JSON');
assert.deepStrictEqual(utils.parseCloudConfig(''), {}, 'parseCloudConfig should accept an empty string');
assert.deepStrictEqual(utils.parseCloudConfig('   '), {}, 'parseCloudConfig should accept whitespace only');
assert.deepStrictEqual(utils.parseCloudConfig(null), {}, 'parseCloudConfig should accept null');
assert.deepStrictEqual(utils.parseCloudConfig(undefined), {}, 'parseCloudConfig should accept undefined');
assert.deepStrictEqual(utils.parseCloudConfig(42), {}, 'parseCloudConfig should accept a non-string value');
assert.deepStrictEqual(utils.parseCloudConfig('"abc"'), {}, 'parseCloudConfig should reject a JSON string');
assert.deepStrictEqual(utils.parseCloudConfig('[1,2]'), {}, 'parseCloudConfig should reject a JSON array');
assert.deepStrictEqual(utils.parseCloudConfig('null'), {}, 'parseCloudConfig should reject JSON null');
assert.deepStrictEqual(utils.parseCloudConfig('42'), {}, 'parseCloudConfig should reject a JSON number');

// Pha A — shouldPreloadNext (nạp trước bài kế để phát gapless 0 ms).
assert.strictEqual(utils.PRELOAD_LEAD_SECONDS, 15, 'Preload should start 15 seconds before the current track ends');
assert.strictEqual(utils.shouldPreloadNext(200, 185), true, 'Preload is due exactly 15 seconds before the end');
assert.strictEqual(utils.shouldPreloadNext(200, 184.9), false, 'Preload is not due more than 15 seconds before the end');
assert.strictEqual(utils.shouldPreloadNext(200, 199.5), true, 'Preload stays due in the final seconds');
assert.strictEqual(utils.shouldPreloadNext(5, 0), true, 'Short tracks are due for preload immediately');
assert.strictEqual(utils.shouldPreloadNext(200, 190, 'https://cdn.example.com/a.flac', 'https://cdn.example.com/a.flac'), false, 'A ready standby deck should not preload again');
assert.strictEqual(utils.shouldPreloadNext(200, 190, 'https://cdn.example.com/a.flac', 'https://cdn.example.com/b.flac'), true, 'A standby deck holding another track should preload');
assert.strictEqual(utils.shouldPreloadNext(200, 190, '', 'https://cdn.example.com/a.flac'), true, 'An empty standby deck should preload');
assert.strictEqual(utils.shouldPreloadNext(200, 190, 'https://cdn.example.com/a.flac', ''), true, 'A missing ready URL should preload');
assert.strictEqual(utils.shouldPreloadNext(200, 190, 'https://site.example/music/a.flac', 'music/a.flac', 15, 'https://site.example/'), false, 'Relative ready URLs should resolve against the page URL before comparing');
assert.strictEqual(utils.shouldPreloadNext(200, 190, 'http://localhost/music/a.flac', 'music/a.flac'), false, 'Relative ready URLs should resolve against the default base');
assert.strictEqual(utils.shouldPreloadNext(Infinity, 100), false, 'Live streams without a finite duration should never preload');
assert.strictEqual(utils.shouldPreloadNext(NaN, 100), false, 'Unknown durations should never preload');
assert.strictEqual(utils.shouldPreloadNext(0, 0), false, 'Zero-length tracks should never preload');
assert.strictEqual(utils.shouldPreloadNext(200, NaN), false, 'Unknown positions should never preload');
assert.strictEqual(utils.shouldPreloadNext(200, -1), false, 'Negative positions should never preload');
assert.strictEqual(utils.shouldPreloadNext(200, 195, '', '', 5), true, 'A custom lead should be honored');
assert.strictEqual(utils.shouldPreloadNext(200, 190, '', '', 5), false, 'Remaining time above a custom lead should not preload');

// Pha B — clampSeekTime (phím [ ] / ← / → tua ±10 giây, kẹp trong [0, duration]).
assert.strictEqual(utils.clampSeekTime(100, 200, -10), 90, 'Seeking back 10 seconds should subtract from the current position');
assert.strictEqual(utils.clampSeekTime(100, 200, 10), 110, 'Seeking forward 10 seconds should add to the current position');
assert.strictEqual(utils.clampSeekTime(5, 200, -10), 0, 'Seeking back past the start should clamp to 0');
assert.strictEqual(utils.clampSeekTime(195, 200, 10), 200, 'Seeking forward past the end should clamp to the duration');
assert.strictEqual(utils.clampSeekTime(0, 200, -10), 0, 'Seeking back from 0 should stay at 0');
assert.strictEqual(utils.clampSeekTime(200, 200, 10), 200, 'Seeking forward from the end should stay at the duration');
assert.strictEqual(utils.clampSeekTime(100, Infinity, 10), 100, 'Live streams without a finite duration should not seek');
assert.strictEqual(utils.clampSeekTime(100, NaN, 10), 100, 'Unknown durations should not seek');
assert.strictEqual(utils.clampSeekTime(100, 0, 10), 100, 'Zero-length tracks should not seek');
assert.strictEqual(utils.clampSeekTime(NaN, 200, 10), 10, 'Unknown positions should seek from 0');
assert.strictEqual(utils.clampSeekTime(100, 200, NaN), 100, 'A non-finite step should leave the position unchanged');
assert.strictEqual(utils.clampSeekTime(100, 200, null), 100, 'A null step should leave the position unchanged');

// Pha A — crossfade đẳng công suất khi chuyển bài (cos/sin, tổng công suất = 1).
const gainsAt = progress => utils.crossfadeGains(progress);
assert.deepEqual(gainsAt(0), {out: 1, in: 0}, 'Crossfade should start with the old deck at full gain');
assert.ok(Math.abs(gainsAt(0.5).out - Math.SQRT1_2) < 1e-12 && Math.abs(gainsAt(0.5).in - Math.SQRT1_2) < 1e-12, 'Halfway through an equal-power crossfade both decks should sit at -3 dB');
assert.ok(Math.abs(gainsAt(1).out) < 1e-12 && Math.abs(gainsAt(1).in - 1) < 1e-12, 'Crossfade should end with the new deck at full gain');
assert.ok([0, 0.25, 0.5, 0.75, 1].every(p => Math.abs(gainsAt(p).out ** 2 + gainsAt(p).in ** 2 - 1) < 1e-12), 'Equal-power crossfade should keep total power constant');
assert.ok(Math.abs(gainsAt(-2).out - 1) < 1e-12 && Math.abs(gainsAt(2).in - 1) < 1e-12, 'Progress outside [0,1] should clamp to the fade ends');
assert.deepEqual(gainsAt(NaN), {out: 1, in: 0}, 'A non-numeric progress should not start the fade');
assert.strictEqual(utils.CROSSFADE_MAX_SECONDS, 5, 'Crossfade should cap at 5 seconds');
assert.strictEqual(utils.clampCrossfadeSeconds('2'), 2, 'A saved crossfade setting should parse as seconds');
assert.strictEqual(utils.clampCrossfadeSeconds(9), 5, 'Crossfade should cap at 5 seconds');
assert.strictEqual(utils.clampCrossfadeSeconds(-1), 0, 'A negative crossfade should turn the fade off');
assert.strictEqual(utils.clampCrossfadeSeconds('abc', 2), 2, 'An unreadable crossfade setting should fall back');
assert.strictEqual(utils.clampCrossfadeSeconds(undefined), 0, 'A missing crossfade setting should default to off');

// Pha C — pruneCatalogEntries (giới hạn danh mục cloud trong IndexedDB).
assert.strictEqual(utils.MAX_CLOUD_CATALOG_ENTRIES, 1000, 'The cloud catalog cap should be 1000 entries');
assert.deepStrictEqual(utils.pruneCatalogEntries([], 1000), [], 'An empty catalog prunes nothing');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a', savedAt:1}, {id:'b', savedAt:2}], 1000), [], 'A catalog under the cap prunes nothing');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a', savedAt:3}, {id:'b', savedAt:1}, {id:'c', savedAt:2}], 2), ['b'], 'The oldest entry should be pruned first');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a'}, {id:'b', savedAt:5}, {id:'c', savedAt:6}], 2), ['a'], 'Entries without savedAt (old catalogs) should be pruned first');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a', savedAt:1}, {id:'b', savedAt:1}, {id:'c', savedAt:1}], 1), ['a', 'b'], 'Equal timestamps should prune in insertion order');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a', savedAt:1}, {id:'b', savedAt:2}], 0), ['a', 'b'], 'A zero cap should prune everything');
assert.deepStrictEqual(utils.pruneCatalogEntries(null, 1000), [], 'A non-array catalog should prune nothing');
assert.deepStrictEqual(utils.pruneCatalogEntries([{savedAt:1}, {id:'', savedAt:2}, {id:'x', savedAt:3}], 1), [], 'Entries without an id should be ignored');
assert.deepStrictEqual(utils.pruneCatalogEntries([{id:'a', savedAt:NaN}, {id:'b', savedAt:2}], 1), ['a'], 'A NaN savedAt should count as oldest');

// Pha C — capCatalogCovers (tổng ngân sách ảnh bìa catalog cloud trong IndexedDB).
assert.strictEqual(utils.MAX_CATALOG_COVER_TOTAL_CHARS, 8 * 1024 * 1024, 'The catalog cover budget should be 8 MiB of characters');
const dataCover = size => `data:image/jpeg;base64,${'x'.repeat(size)}`;
assert.deepStrictEqual(utils.capCatalogCovers([], 100), [], 'An empty catalog caps nothing');
assert.deepStrictEqual(utils.capCatalogCovers(null), [], 'A non-array catalog caps nothing');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', savedAt:1, cover:dataCover(60)}, {id:'b', savedAt:2, cover:dataCover(60)}], 100).map(entry => entry.cover),
  [null, dataCover(60)], 'The oldest cover should be dropped first when the budget is exceeded');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', savedAt:1, cover:dataCover(60)}, {id:'b', savedAt:2, cover:dataCover(60)}], 166).map(entry => entry.cover),
  [dataCover(60), dataCover(60)], 'Covers that fit the budget exactly should all be kept');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', savedAt:1, cover:dataCover(60)}, {id:'b', savedAt:2, cover:'https://coverartarchive.org/x.jpg'}], 10).map(entry => entry.cover),
  [null, 'https://coverartarchive.org/x.jpg'], 'An https cover URL should not consume the budget or be dropped');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', cover:dataCover(60)}, {id:'b', savedAt:5, cover:dataCover(60)}], 100).map(entry => entry.cover),
  [null, dataCover(60)], 'An entry without savedAt (old catalog) should lose its cover first');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', savedAt:1, cover:dataCover(10)}, {id:'b', savedAt:2, cover:null}, {id:'c', savedAt:3}], 0).map(entry => entry.cover),
  [null, null, undefined], 'A zero budget should drop every data cover but leave null covers alone');
assert.deepStrictEqual(
  utils.capCatalogCovers([{id:'a', savedAt:1, cover:dataCover(60)}, {id:'b', savedAt:2, cover:dataCover(60)}], NaN).map(entry => entry.cover),
  [dataCover(60), dataCover(60)], 'A non-finite budget should fall back to the 8 MiB default');
const coverInput = [{id:'a', savedAt:1, cover:dataCover(60)}, {id:'b', savedAt:2, cover:dataCover(60)}];
const coverCapped = utils.capCatalogCovers(coverInput, 100);
assert.strictEqual(coverInput[0].cover, dataCover(60), 'Capping should not mutate the input entries');
assert.notStrictEqual(coverCapped[0], coverInput[0], 'A dropped cover should be returned as a new entry object');
assert.strictEqual(coverCapped[1], coverInput[1], 'An untouched entry should be returned as-is');
assert.deepStrictEqual(
  utils.capCatalogCovers([{savedAt:1, cover:dataCover(60)}, {id:'x', savedAt:2, cover:dataCover(60)}], 10).map(entry => entry.cover),
  [dataCover(60), null], 'Entries without an id should be ignored by the ranking but kept as-is');

// Pha A — peakRmsFromTimeDomain (đồng hồ đo mức Peak/RMS thật).
assert.deepStrictEqual(utils.peakRmsFromTimeDomain(new Uint8Array(2048).fill(128)), {peak:0, rms:0, peakDb:-96, rmsDb:-96}, 'Digital silence should read -96 dB');
assert.deepStrictEqual(utils.peakRmsFromTimeDomain([]), {peak:0, rms:0, peakDb:-96, rmsDb:-96}, 'Empty data should read -96 dB');
assert.deepStrictEqual(utils.peakRmsFromTimeDomain(null), {peak:0, rms:0, peakDb:-96, rmsDb:-96}, 'Null data should read -96 dB');
const fullScaleLevel = utils.peakRmsFromTimeDomain(new Uint8Array([255, 0, 255, 0]));
assert.ok(Math.abs(fullScaleLevel.peak - 1) < 0.01, 'Full-scale samples should peak at 1.0');
assert.ok(Math.abs(fullScaleLevel.peakDb - 0) < 0.1, 'A full-scale peak should read 0 dBFS');
assert.ok(Math.abs(fullScaleLevel.rms - 0.996) < 0.01, 'Alternating full-scale samples should RMS near 1.0');
const halfScaleLevel = utils.peakRmsFromTimeDomain(new Uint8Array([192, 64]));
assert.ok(Math.abs(halfScaleLevel.peak - 0.5) < 0.01, 'Half-scale samples should peak at 0.5');
assert.ok(Math.abs(halfScaleLevel.peakDb - (-6.02)) < 0.1, 'A half-scale peak should read about -6 dBFS');
assert.ok(Math.abs(halfScaleLevel.rms - 0.5) < 0.01, 'Half-scale samples should RMS at 0.5');

// Pha B — queueDisplayOrder (hàng đợi ghim bài đang phát đầu danh sách).
const nowTrack = {id: 'now'}, nextA = {id: 'a'}, nextB = {id: 'b'};
assert.deepStrictEqual(utils.queueDisplayOrder(nowTrack, [nextA, nextB]).map(track => track.id), ['now', 'a', 'b'], 'The playing track should pin first in the queue');
assert.deepStrictEqual(utils.queueDisplayOrder(null, [nextA, nextB]).map(track => track.id), ['a', 'b'], 'No playing track should leave the queue order unchanged');
assert.deepStrictEqual(utils.queueDisplayOrder(nowTrack, [nextA, nowTrack, nextB]).map(track => track.id), ['now', 'a', 'b'], 'The playing track should not repeat inside the queue');
assert.deepStrictEqual(utils.queueDisplayOrder(nowTrack, null), [nowTrack], 'A null queue should still show the playing track');
assert.deepStrictEqual(utils.queueDisplayOrder(null, null), [], 'No playing track and no queue should be empty');
assert.deepStrictEqual(utils.queueDisplayOrder(undefined, [null, nextA]).map(track => track.id), ['a'], 'Falsy queue entries should be dropped');

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
  assert.strictEqual(utils.fetchAudioRetryDelayMs(0), 400, 'First retry should wait 400 ms');
  assert.strictEqual(utils.fetchAudioRetryDelayMs(1), 800, 'Second retry should double the wait to 800 ms');
  assert.strictEqual(utils.isFetchAudioRetryable(Object.assign(new Error('net'), {retryable:true})), true, 'Network errors should be retryable');
  assert.strictEqual(utils.isFetchAudioRetryable(Object.assign(new Error('x'), {status:503})), true, 'HTTP 503 should be retryable');
  assert.strictEqual(utils.isFetchAudioRetryable(Object.assign(new Error('x'), {status:429})), true, 'HTTP 429 should be retryable');
  assert.strictEqual(utils.isFetchAudioRetryable(Object.assign(new Error('x'), {status:401})), false, 'HTTP 401 must not retry (token refresh is handled above)');
  assert.strictEqual(utils.isFetchAudioRetryable(Object.assign(new Error('x'), {status:404})), false, 'HTTP 404 must not retry');
  assert.strictEqual(utils.isFetchAudioRetryable(new Error('wrong type')), false, 'Deterministic errors must not retry');
  assert.strictEqual(utils.isFetchAudioRetryable(null), false, 'A missing error must not retry');
  let flakyCalls = 0;
  global.fetch = async () => {
    flakyCalls += 1;
    if (flakyCalls < 3) throw new TypeError('Failed to fetch');
    return {ok:true, headers:{get:() => 'audio/flac'}, blob:async () => ({size:7})};
  };
  const flakyBlob = await utils.fetchAudioBlob('https://example.com/a.flac', {}, 'Drive');
  assert.strictEqual(flakyBlob.size, 7, 'Two network failures should be retried before succeeding');
  assert.strictEqual(flakyCalls, 3, 'A flaky fetch should be attempted 3 times');
  delete global.fetch;
  let authCalls = 0;
  global.fetch = async () => { authCalls += 1; return {ok:false, status:401, text:async () => 'unauthorized'}; };
  await assert.rejects(() => utils.fetchAudioBlob('https://example.com/a.flac', {}, 'Drive'));
  assert.strictEqual(authCalls, 1, 'HTTP 401 should fail immediately without retry');
  delete global.fetch;
  // Pha C — lát đầu để phát ngay: chỉ tải 1 MB đầu bằng Range.
  assert.strictEqual(utils.FIRST_SLICE_BYTES, 1 * 1024 * 1024, 'The first slice should cover 1 MB of audio');
  const sliceHeaders = values => ({get: name => values[String(name).toLowerCase()] || ''});
  let sliceRequest = null;
  global.fetch = async (url, options) => {
    sliceRequest = {url, options};
    return {ok:true, status:206, headers:sliceHeaders({'content-type':'audio/flac', 'content-range':'bytes 0-1048575/12345678', 'content-length':'1048576'}), blob:async () => ({size:1048576, type:'audio/flac'})};
  };
  const slice = await utils.fetchAudioFirstSlice('https://example.com/a.flac', {headers:{Authorization:'Bearer token'}}, 'Drive');
  assert.strictEqual(slice.blob.size, 1048576, 'A 206 response should return the requested first slice');
  assert.strictEqual(slice.totalBytes, 12345678, 'The total file size should come from the Content-Range header');
  assert.strictEqual(slice.complete, false, 'A partial slice must not claim to hold the whole file');
  assert.strictEqual(sliceRequest.options.headers.Range, 'bytes=0-1048575', 'The first slice should request exactly 1 MB with a Range header');
  assert.strictEqual(sliceRequest.options.headers.Authorization, 'Bearer token', 'The first slice should keep the cloud authorization header');
  delete global.fetch;
  global.fetch = async () => ({ok:true, status:200, headers:sliceHeaders({'content-type':'audio/flac'}), blob:async () => ({size:1234, type:'audio/flac'})});
  const whole = await utils.fetchAudioFirstSlice('https://example.com/a.flac', {}, 'Drive');
  assert.strictEqual(whole.complete, true, 'A 200 response should count as the complete file');
  assert.strictEqual(whole.totalBytes, 1234, 'A 200 response should report the returned size as the total');
  delete global.fetch;
  global.fetch = async () => ({ok:false, status:416, text:async () => 'range not satisfiable'});
  await assert.rejects(() => utils.fetchAudioFirstSlice('https://example.com/a.flac', {}, 'Drive'), 'An unsatisfiable range should fail so the caller falls back to the full download');
  global.fetch = async () => ({ok:true, status:206, headers:sliceHeaders({'content-type':'application/json', 'content-range':'bytes 0-1048575/12345678'}), blob:async () => ({size:1048576})});
  await assert.rejects(() => utils.fetchAudioFirstSlice('https://example.com/a.flac', {}, 'Drive'), 'A non-audio first slice should fail like the full download');
  global.fetch = async () => ({ok:true, status:206, headers:sliceHeaders({'content-type':'audio/flac', 'content-range':'bytes 0-1048575/12345678'}), blob:async () => ({size:0})});
  await assert.rejects(() => utils.fetchAudioFirstSlice('https://example.com/a.flac', {}, 'Drive'), 'An empty first slice should fail so the caller falls back to the full download');
  delete global.fetch;
  console.log('Library metadata, filtering, grouping and audio fetch tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
