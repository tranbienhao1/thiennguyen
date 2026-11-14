'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('matchSearchQuery - tìm kiếm đa từ khóa không phân biệt dấu và thứ tự', async (t) => {
  await t.test('trả về true khi query rỗng hoặc null', () => {
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', ''), true);
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', null), true);
  });

  await t.test('khớp chuỗi con đơn lẻ', () => {
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', 'dien loan'), true);
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', 'thang'), true);
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', 'khong co'), false);
  });

  await t.test('khớp đa từ khóa không theo thứ tự (multi-token out-of-order)', () => {
    assert.equal(library.matchSearchQuery('nguoi tinh dien loan thang', 'thang nguoi tinh'), true);
    assert.equal(library.matchSearchQuery('mot doi 14 casper buitruonglinh', 'buitruonglinh mot doi'), true);
    assert.equal(library.matchSearchQuery('mot doi 14 casper buitruonglinh', '14 casper buitruonglinh mot doi'), true);
    assert.equal(library.matchSearchQuery('mot doi 14 casper buitruonglinh', 'casper 14 sai'), false);
  });
});

test('scoreSearchMatch & filterTracks with rankByRelevance', async (t) => {
  const tracks = [
    { id: '1', title: 'Điên', artist: 'Hồ', album: 'Album A' },
    { id: '2', title: 'Người Tình Điên Loạn', artist: 'Thắng', album: 'Album B' },
    { id: '3', title: 'Bài hát khác', artist: 'Điên Loạn', album: 'Album C' },
    { id: '4', title: 'Không liên quan', artist: 'Ca sĩ', album: 'Album D' }
  ];

  await t.test('tính điểm chuẩn xác: tiêu đề khớp chính xác > tiêu đề bắt đầu bằng query > chứa query', () => {
    const scoreExact = library.scoreSearchMatch({ id: '1', title: 'Điên', artist: 'Hồ' }, 'Điên');
    const scoreContains = library.scoreSearchMatch({ id: '2', title: 'Người Tình Điên Loạn', artist: 'Thắng' }, 'Điên');
    assert.ok(scoreExact > scoreContains, 'Điểm khớp tuyệt đối phải cao hơn điểm chứa chuỗi con');
    assert.ok(scoreContains > 0, 'Chứa chuỗi con phải có điểm dương');
    assert.equal(library.scoreSearchMatch({ id: '4', title: 'Không liên quan', artist: 'Ca sĩ' }, 'Điên'), 0);
  });

  await t.test('filterTracks với rankByRelevance xếp bài khớp tiêu đề lên trước bài chỉ khớp nghệ sĩ', () => {
    const filtered = library.filterTracks(tracks, { query: 'dien loan', rankByRelevance: true });
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].id, '2', 'Bài "Người Tình Điên Loạn" phải đứng trước bài nghệ sĩ "Điên Loạn"');
    assert.equal(filtered[1].id, '3');
  });

  await t.test('filterTracks giữ nguyên thứ tự khi không bật rankByRelevance', () => {
    const filtered = library.filterTracks(tracks, { query: 'dien loan' });
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].id, '2');
    assert.equal(filtered[1].id, '3');
  });
});

test('highlightSearchMatch - làm nổi bật từ khóa bảo toàn nguyên vẹn dấu tiếng Việt và chữ hoa/thường', async (t) => {
  await t.test('bảo toàn chữ hoa/thường và dấu tiếng Việt của văn bản gốc', () => {
    const original = 'Một Đời (Trên một đời) - 14 Casper';
    const highlighted = library.highlightSearchMatch(original, 'mot doi');
    assert.ok(
      highlighted.includes('<mark class="bg-violet-500/25 text-violet-200 font-medium rounded px-0.5">Một Đời</mark>'),
      'Phải giữ nguyên "Một Đời" gốc khi bọc thẻ mark'
    );
    assert.ok(
      highlighted.includes('<mark class="bg-violet-500/25 text-violet-200 font-medium rounded px-0.5">một đời</mark>'),
      'Phải giữ nguyên "một đời" gốc'
    );
  });

  await t.test('hỗ trợ tìm kiếm không dấu khớp có dấu và ngược lại', () => {
    const text = 'Người Tình Điên Loạn';
    const res1 = library.highlightSearchMatch(text, 'nguoi tinh');
    assert.ok(res1.includes('>Người Tình</mark>'));

    const res2 = library.highlightSearchMatch(text, 'Người Tình');
    assert.ok(res2.includes('>Người Tình</mark>'));
  });

  await t.test('thoát an toàn ký tự đặc biệt HTML (XSS prevention)', () => {
    const dangerous = '<script>alert("hack")</script> & Bài Hát';
    const res = library.highlightSearchMatch(dangerous, 'Bai Hat', { escape: true });
    assert.ok(!res.includes('<script>'), 'Không được để sót thẻ script nguyên bản');
    assert.ok(res.includes('&lt;script&gt;'), 'Thẻ script phải được escape thành &lt;script&gt;');
    assert.ok(res.includes('&amp;'), '& phải được escape thành &amp;');
    assert.ok(res.includes('>Bài Hát</mark>'));
  });

  await t.test('trả về chuỗi gốc đã escape khi query rỗng hoặc không khớp', () => {
    assert.equal(library.highlightSearchMatch('Hello & World', '', { escape: true }), 'Hello &amp; World');
    assert.equal(library.highlightSearchMatch('Hello World', 'xyz'), 'Hello World');
    assert.equal(library.highlightSearchMatch(null, 'xyz'), '');
  });
});

test('Search History - quản lý lịch sử tìm kiếm bền vững', async (t) => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  await t.test('getSearchHistory trả về mảng rỗng ban đầu', () => {
    assert.deepEqual(library.getSearchHistory(mockStorage), []);
  });

  await t.test('addSearchHistory thêm từ khóa, đẩy trùng lặp lên đầu và giới hạn số lượng', () => {
    library.addSearchHistory('low g', mockStorage);
    library.addSearchHistory('14 casper', mockStorage);
    library.addSearchHistory('thang', mockStorage);

    let hist = library.getSearchHistory(mockStorage);
    assert.deepEqual(hist, ['thang', '14 casper', 'low g']);

    // Thêm lại 'low g' -> đưa lên đầu
    library.addSearchHistory('LOW G', mockStorage);
    hist = library.getSearchHistory(mockStorage);
    assert.deepEqual(hist, ['LOW G', 'thang', '14 casper']);

    // Kiểm tra giới hạn max
    for (let i = 1; i <= 10; i++) {
      library.addSearchHistory(`query ${i}`, mockStorage, library.SEARCH_HISTORY_KEY, 5);
    }
    hist = library.getSearchHistory(mockStorage);
    assert.equal(hist.length, 5);
  });

  await t.test('clearSearchHistory xóa sạch lịch sử', () => {
    library.clearSearchHistory(mockStorage);
    assert.deepEqual(library.getSearchHistory(mockStorage), []);
  });
});

test('DOM & Script Integration: Smart Search', async (t) => {
  await t.test('markup HTML chứa các dropdown lịch sử tìm kiếm và nút xóa', () => {
    assert.match(indexHtml, /id="search-history-dropdown"/, 'Dropdown lịch sử desktop phải tồn tại');
    assert.match(indexHtml, /id="clear-search-history-btn"/, 'Nút xóa lịch sử desktop phải tồn tại');
    assert.match(indexHtml, /id="search-history-chips"/, 'Container chips desktop phải tồn tại');
    assert.match(indexHtml, /id="search-history-mobile-dropdown"/, 'Dropdown lịch sử mobile phải tồn tại');
    assert.match(indexHtml, /id="clear-search-history-mobile-btn"/, 'Nút xóa lịch sử mobile phải tồn tại');
    assert.match(indexHtml, /id="search-history-mobile-chips"/, 'Container chips mobile phải tồn tại');
  });

  await t.test('renderTrackRows áp dụng highlightSearchMatch cho tiêu đề, nghệ sĩ và album', () => {
    assert.ok(indexHtml.includes('library.highlightSearchMatch(metadata.title, state.query'), 'Phải highlight tiêu đề bài hát');
    assert.ok(indexHtml.includes('library.highlightSearchMatch(metadata.artist, state.query'), 'Phải highlight nghệ sĩ');
    assert.ok(indexHtml.includes('library.highlightSearchMatch(metadata.album, state.query'), 'Phải highlight album');
  });

  await t.test('filteredTracks kích hoạt rankByRelevance: true', () => {
    assert.ok(indexHtml.includes('rankByRelevance: true'), 'filteredTracks phải xếp hạng bài theo độ khớp');
  });

  await t.test('trackRowsSignature tính toán state.query để kích hoạt re-render highlight mượt mà', () => {
    assert.ok(indexHtml.includes('state.query || \'\''), 'trackRowsSignature phải bao gồm state.query');
  });

  await t.test('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến đồ thị âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên'
    );
  });
});
