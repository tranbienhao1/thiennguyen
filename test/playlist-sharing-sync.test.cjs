'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha C: buildShareablePlaylistPayload đóng gói danh sách phát chuẩn JSON', async (t) => {
  await t.test('tạo payload hợp lệ với metadata chi tiết', () => {
    const mockTracks = [
      { id: 'trk_1', name: 'Một đời', title: 'Một đời', artist: '14 Casper, buitruonglinh', album: 'Trên một đời', duration: 328, format: 'FLAC', sampleRate: 44100, bitDepth: 16 },
      { id: 'trk_2', name: 'Chất Gây Hại', title: 'Chất Gây Hại', artist: 'Quang Hùng MasterD', album: 'Chất Gây Hại', duration: 210, format: 'FLAC', sampleRate: 96000, bitDepth: 24 }
    ];

    const payload = library.buildShareablePlaylistPayload('Tuyển tập Đêm Khuya', mockTracks, {
      description: 'Danh sách tuyển chọn Audiophile'
    });

    assert.equal(payload.version, 1);
    assert.equal(payload.app, 'nocturne');
    assert.equal(payload.type, 'playlist');
    assert.equal(payload.name, 'Tuyển tập Đêm Khuya');
    assert.equal(payload.description, 'Danh sách tuyển chọn Audiophile');
    assert.equal(payload.trackCount, 2);
    assert.equal(payload.totalDuration, 538);
    assert.equal(payload.tracks.length, 2);
    assert.equal(payload.tracks[0].title, 'Một đời');
    assert.equal(payload.tracks[0].artist, '14 Casper, buitruonglinh');
    assert.equal(payload.tracks[1].sampleRate, 96000);
  });

  await t.test('xử lý an toàn khi danh sách rỗng hoặc dữ liệu thiếu sót', () => {
    const payload = library.buildShareablePlaylistPayload('', null);
    assert.equal(payload.name, 'Danh sách phát Nocturne');
    assert.equal(payload.trackCount, 0);
    assert.equal(payload.totalDuration, 0);
    assert.deepEqual(payload.tracks, []);
  });
});

test('Pha C: encodeShareablePlaylistLink & parseShareablePlaylistPayload mã hóa và giải mã liên kết chia sẻ', async (t) => {
  await t.test('mã hóa thành chuỗi link URL hash #playlist= và giải mã chính xác hỗ trợ Unicode tiếng Việt', () => {
    const originalPayload = library.buildShareablePlaylistPayload('Giai Điệu Thư Giãn (Tiếng Việt)', [
      { id: 'vn_1', title: 'Người Tình Điên Loạn', artist: 'Thắng', album: 'Người Tình Điên Loạn', duration: 245, format: 'FLAC' },
      { id: 'vn_2', title: 'Fashion Tán Gái', artist: 'Low G', album: 'Low G Single', duration: 185, format: 'MP3' }
    ]);

    const link = library.encodeShareablePlaylistLink(originalPayload, 'https://nocturne.app/player');
    assert.ok(link.startsWith('https://nocturne.app/player#playlist='), 'Link phải chứa tiền tố hash #playlist=');

    const parseResult = library.parseShareablePlaylistPayload(link);
    assert.equal(parseResult.isValid, true);
    assert.equal(parseResult.playlist.name, 'Giai Điệu Thư Giãn (Tiếng Việt)');
    assert.equal(parseResult.playlist.trackCount, 2);
    assert.equal(parseResult.playlist.tracks[0].title, 'Người Tình Điên Loạn');
    assert.equal(parseResult.playlist.tracks[0].artist, 'Thắng');
    assert.equal(parseResult.playlist.tracks[1].title, 'Fashion Tán Gái');
  });

  await t.test('giải mã từ đối tượng JSON, chuỗi JSON hoặc base64 thuần túy', () => {
    const jsonStr = JSON.stringify({
      version: 1,
      type: 'playlist',
      name: 'Test JSON Playlist',
      tracks: [{ id: 't_test', title: 'Test Song', artist: 'Artist X', duration: 120 }]
    });

    const resJson = library.parseShareablePlaylistPayload(jsonStr);
    assert.equal(resJson.isValid, true);
    assert.equal(resJson.playlist.name, 'Test JSON Playlist');

    const resObj = library.parseShareablePlaylistPayload(JSON.parse(jsonStr));
    assert.equal(resObj.isValid, true);
  });

  await t.test('từ chối an toàn các dữ liệu hỏng hoặc không phải playlist', () => {
    assert.equal(library.parseShareablePlaylistPayload(null).isValid, false);
    assert.equal(library.parseShareablePlaylistPayload('not-a-valid-data').isValid, false);
    assert.equal(library.parseShareablePlaylistPayload(JSON.stringify({ type: 'other' })).isValid, false);
  });
});

test('Pha C: matchPlaylistWithLibrary đối soát thông minh giữa playlist và thư viện máy nhận', async (t) => {
  await t.test('khớp chính xác theo ID hoặc chuẩn hóa Title + Artist', () => {
    const localLibrary = [
      { id: 'loc_1', name: 'Một đời', title: 'Một đời', artist: '14 Casper, buitruonglinh', album: 'Trên một đời' },
      { id: 'loc_2', name: 'Chất Gây Hại', title: 'Chất Gây Hại', artist: 'Quang Hùng MasterD', album: 'Chất Gây Hại' },
      { id: 'loc_3', name: 'Fashion Tán Gái', title: 'fashion tán gái', artist: 'Low G', album: 'Single' }
    ];

    const importedTracks = [
      { id: 'loc_1', title: 'Một đời', artist: '14 Casper' }, // Khớp qua ID
      { id: 'diff_id', title: 'Chất Gây Hại', artist: 'Quang Hùng MasterD' }, // Khớp qua Title + Artist
      { id: 'diff_id_2', title: 'Fashion Tán Gái', artist: 'Low G' }, // Khớp qua Normalized Title + Artist
      { id: 'missing_id', title: 'Bài Hát Chưa Tải', artist: 'Ca Sĩ Mới' } // Không khớp
    ];

    const result = library.matchPlaylistWithLibrary(importedTracks, localLibrary);
    assert.equal(result.matchedCount, 3);
    assert.equal(result.totalCount, 4);
    assert.equal(result.matchRate, 75); // 3/4 = 75%
    assert.ok(result.summary.includes('Đã khớp 3/4 bài (75%)'));
    assert.equal(result.unmatchedTracks.length, 1);
    assert.equal(result.unmatchedTracks[0].title, 'Bài Hát Chưa Tải');
  });

  await t.test('xử lý an toàn khi thư viện hoặc danh sách nhập rỗng', () => {
    const res = library.matchPlaylistWithLibrary([], []);
    assert.equal(res.matchedCount, 0);
    assert.equal(res.matchRate, 0);
    assert.equal(res.summary, 'Danh sách bài hát rỗng');
  });
});

test('Pha C: exportPlaylistM3u8 & parseM3u8Playlist xuất và nhập danh sách phát chuẩn Extended M3U8', async (t) => {
  await t.test('xuất file M3U8 chuẩn UTF-8 có đầy đủ thẻ #EXTINF, #EXTALBUM và #EXTFORMAT', () => {
    const mockTracks = [
      { id: 'm3u_1', name: 'Track1.flac', title: 'Song One', artist: 'Artist One', album: 'Album One', duration: 180, format: 'FLAC' },
      { id: 'm3u_2', name: 'Track2.dsf', title: 'Song Two', artist: 'Artist Two', album: 'Album Two', duration: 320, format: 'DSD' }
    ];

    const m3u8Text = library.exportPlaylistM3u8('My Audiophile M3U8', mockTracks);
    assert.ok(m3u8Text.includes('#EXTM3U'), 'Cần có header #EXTM3U');
    assert.ok(m3u8Text.includes('#EXTENC:UTF-8'), 'Cần có định dạng UTF-8');
    assert.ok(m3u8Text.includes('#PLAYLIST:My Audiophile M3U8'));
    assert.ok(m3u8Text.includes('#EXTINF:180,Artist One - Song One'));
    assert.ok(m3u8Text.includes('#EXTALBUM:Album One'));
    assert.ok(m3u8Text.includes('#EXTFORMAT:FLAC'));
    assert.ok(m3u8Text.includes('#EXTID:m3u_1'));
  });

  await t.test('phân tích tệp M3U8 thành danh sách bài hát có cấu trúc', () => {
    const rawM3u8 = `#EXTM3U
#EXTENC:UTF-8
#PLAYLIST:Tuyển Tập Nhạc Hay
#EXTINF:215,Nghệ Sĩ A - Bài Hát Tuyệt Vời
#EXTALBUM:Album Tuyệt Vời
#EXTFORMAT:FLAC
#EXTID:id_999
music/song1.flac
#EXTINF:190,Nghệ Sĩ B - Giai Điệu Mùa Thu
music/song2.mp3`;

    const parsed = library.parseM3u8Playlist(rawM3u8);
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.name, 'Tuyển Tập Nhạc Hay');
    assert.equal(parsed.trackCount, 2);
    assert.equal(parsed.tracks[0].title, 'Bài Hát Tuyệt Vời');
    assert.equal(parsed.tracks[0].artist, 'Nghệ Sĩ A');
    assert.equal(parsed.tracks[0].album, 'Album Tuyệt Vời');
    assert.equal(parsed.tracks[0].duration, 215);
    assert.equal(parsed.tracks[0].format, 'FLAC');
    assert.equal(parsed.tracks[0].file, 'music/song1.flac');

    assert.equal(parsed.tracks[1].title, 'Giai Điệu Mùa Thu');
    assert.equal(parsed.tracks[1].artist, 'Nghệ Sĩ B');
    assert.equal(parsed.tracks[1].file, 'music/song2.mp3');
  });

  await t.test('từ chối an toàn tệp không hợp lệ', () => {
    assert.equal(library.parseM3u8Playlist('').isValid, false);
    assert.equal(library.parseM3u8Playlist('random text without header').isValid, false);
  });
});

test('Pha C: Tích hợp Giao diện Người dùng, URL Hash & Bất biến Đồ thị Âm thanh', async (t) => {
  await t.test('nút chia sẻ album #album-hero-share tồn tại trong album hero', () => {
    assert.ok(indexHtml.includes('id="album-hero-share"'), 'Cần có #album-hero-share');
    assert.ok(indexHtml.includes('album-hero-share'), 'Script cần gán sự kiện cho #album-hero-share');
  });

  await t.test('các nút chia sẻ và nhập playlist tồn tại trong #queue-panel', () => {
    assert.ok(indexHtml.includes('id="queue-share-btn"'), 'Cần có #queue-share-btn');
    assert.ok(indexHtml.includes('id="queue-import-btn"'), 'Cần có #queue-import-btn');
    assert.ok(indexHtml.includes('id="playlist-import-file"'), 'Cần có #playlist-import-file');
  });

  await t.test('script tích hợp kiểm tra liên kết chia sẻ hash #playlist= khi tải trang hoặc hashchange', () => {
    assert.ok(indexHtml.includes('checkIncomingPlaylistLink'), 'Phải có hàm checkIncomingPlaylistLink');
    assert.ok(indexHtml.includes('window.location.hash.includes(\'playlist=\')'), 'Phải kiểm tra hash playlist=');
    assert.ok(indexHtml.includes('parseShareablePlaylistPayload'), 'Phải giải mã gói dữ liệu playlist');
    assert.ok(indexHtml.includes('matchPlaylistWithLibrary'), 'Phải đối soát bài hát với thư viện');
  });

  await t.test('bảo toàn nghiêm ngặt bất biến đồ thị âm thanh Web Audio API (Audio Invariant Preservation)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến đồ thị âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên 100%'
    );
  });
});
