'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: formatAlbumDuration ──

describe('formatAlbumDuration', () => {
  it('định dạng đúng thời lượng dưới 1 giờ', () => {
    assert.equal(library.formatAlbumDuration(0), '0 phút');
    assert.equal(library.formatAlbumDuration(45), '0 phút 45 giây');
    assert.equal(library.formatAlbumDuration(150), '2 phút 30 giây');
    assert.equal(library.formatAlbumDuration(1800), '30 phút');
  });

  it('định dạng đúng thời lượng từ 1 giờ trở lên', () => {
    assert.equal(library.formatAlbumDuration(3600), '1 giờ 0 phút');
    assert.equal(library.formatAlbumDuration(3665), '1 giờ 1 phút');
    assert.equal(library.formatAlbumDuration(7500), '2 giờ 5 phút');
  });

  it('xử lý an toàn khi thời lượng âm, NaN hoặc rỗng', () => {
    assert.equal(library.formatAlbumDuration(NaN), '0 phút');
    assert.equal(library.formatAlbumDuration(-10), '0 phút');
    assert.equal(library.formatAlbumDuration(null), '0 phút');
  });
});

// ── 2. Unit tests: summarizeAlbum ──

describe('summarizeAlbum', () => {
  it('xử lý tốt mảng rỗng hoặc không hợp lệ', () => {
    const empty = library.summarizeAlbum([]);
    assert.equal(empty.trackCount, 0);
    assert.equal(empty.totalDuration, 0);
    assert.equal(empty.highestQuality.tier, 'standard');
    assert.equal(empty.highestQuality.label, 'STANDARD');
  });

  it('tổng hợp đúng thời lượng và số bài', () => {
    const tracks = [
      { id: '1', title: 'Track 1', duration: 180, format: 'MP3' },
      { id: '2', title: 'Track 2', duration: 220, format: 'MP3' },
      { id: '3', title: 'Track 3', duration: 200, format: 'MP3' }
    ];
    const summary = library.summarizeAlbum(tracks);
    assert.equal(summary.trackCount, 3);
    assert.equal(summary.totalDuration, 600);
    assert.equal(summary.formattedDuration, '10 phút');
    assert.equal(summary.highestQuality.tier, 'standard');
    assert.deepEqual(summary.formats, ['MP3']);
  });

  it('nhận diện tầng chất lượng cao nhất là LOSSLESS cho FLAC 16/44.1', () => {
    const tracks = [
      { id: '1', duration: 200, format: 'FLAC', sampleRate: 44100, bitDepth: 16 }
    ];
    const summary = library.summarizeAlbum(tracks);
    assert.equal(summary.highestQuality.tier, 'lossless');
    assert.equal(summary.highestQuality.label, 'LOSSLESS');
  });

  it('nhận diện tầng chất lượng cao nhất là HI-RES khi có bài >48kHz hoặc >16-bit', () => {
    const tracks = [
      { id: '1', duration: 200, format: 'FLAC', sampleRate: 44100, bitDepth: 16 },
      { id: '2', duration: 300, format: 'FLAC', sampleRate: 96000, bitDepth: 24 }
    ];
    const summary = library.summarizeAlbum(tracks);
    assert.equal(summary.highestQuality.tier, 'highres');
    assert.equal(summary.highestQuality.label, 'HI-RES');
    assert.deepEqual(summary.formats, ['FLAC']);
  });

  it('ưu tiên DSD lên đầu bậc chất lượng', () => {
    const tracks = [
      { id: '1', duration: 200, format: 'FLAC', sampleRate: 96000, bitDepth: 24 },
      { id: '2', duration: 240, format: 'DSF', isDsd: true, sampleRate: 2822400 }
    ];
    const summary = library.summarizeAlbum(tracks);
    assert.equal(summary.highestQuality.tier, 'dsd');
    assert.equal(summary.highestQuality.label, 'DSD');
    assert.ok(summary.formats.includes('DSF'));
    assert.ok(summary.formats.includes('FLAC'));
  });
});

// ── 3. DOM & HTML Integration tests ──

describe('Album View Roon-style DOM & Script integration', () => {
  it('chứa đầy đủ các thẻ markup của #album-hero', () => {
    assert.ok(html.includes('id="album-hero"'), 'Có container #album-hero');
    assert.ok(html.includes('id="album-hero-cover"'), 'Có khung ảnh bìa album');
    assert.ok(html.includes('id="album-hero-type"'), 'Có nhãn loại bộ sưu tập (ALBUM / ARTIST)');
    assert.ok(html.includes('id="album-hero-quality"'), 'Có huy hiệu chất lượng cao nhất');
    assert.ok(html.includes('id="album-hero-title"'), 'Có tiêu đề album');
    assert.ok(html.includes('id="album-hero-artist"'), 'Có tên nghệ sĩ album');
    assert.ok(html.includes('id="album-hero-tracks"'), 'Có nhãn số lượng bài');
    assert.ok(html.includes('id="album-hero-duration"'), 'Có nhãn tổng thời lượng');
    assert.ok(html.includes('id="album-hero-play"'), 'Có nút phát toàn bộ album');
    assert.ok(html.includes('id="album-hero-queue"'), 'Có nút thêm album vào hàng đợi');
    assert.ok(html.includes('id="album-hero-back"'), 'Có nút quay lại danh sách');
  });

  it('định nghĩa hàm showAlbumHero trong script', () => {
    assert.ok(html.includes('function showAlbumHero'), 'Script có hàm showAlbumHero');
    assert.ok(html.includes('showAlbumHero(entry, card.dataset.collectionAction)'), 'Click thẻ album gọi showAlbumHero');
  });

  it('ẩn #album-hero khi chuyển view hoặc bấm nút quay lại', () => {
    assert.ok(html.includes("$('album-hero')?.classList.add('hidden')"), 'Tự động ẩn #album-hero khi thoát ngữ cảnh album');
  });
});
