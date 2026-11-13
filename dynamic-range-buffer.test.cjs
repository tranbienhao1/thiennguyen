const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexPath = path.join(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

test('calculateDynamicRange - tính toán chính xác Crest Factor (Peak - RMS) theo dB', () => {
  assert.equal(typeof library.calculateDynamicRange, 'function');

  // Bản thu Audiophile Reference (độ động rất cao, ví dụ giao hưởng / jazz không nén)
  const drRef = library.calculateDynamicRange(-0.5, -15.5);
  assert.equal(drRef, 15.0);

  // Bản thu High Dynamic Range (chuẩn audiophile tự nhiên)
  const drHigh = library.calculateDynamicRange(-1.2, -12.4);
  assert.equal(drHigh, 11.2);

  // Bản thu tiêu chuẩn / nén nhẹ
  const drStd = library.calculateDynamicRange(-0.1, -8.3);
  assert.equal(drStd, 8.2);

  // Bản thu bị nén mạnh (loudness war)
  const drComp = library.calculateDynamicRange(0.0, -5.2);
  assert.equal(drComp, 5.2);

  // Xử lý an toàn khi tín hiệu im lặng hoặc lỗi (-96 dB hoặc NaN)
  assert.equal(library.calculateDynamicRange(-96, -96), 0);
  assert.equal(library.calculateDynamicRange(-92, -95), 0);
  assert.equal(library.calculateDynamicRange(NaN, -12), 0);
  assert.equal(library.calculateDynamicRange(-3, null), 0);
});

test('formatDynamicRange - phân cấp và định dạng nhãn Audiophile chuyên nghiệp', () => {
  assert.equal(typeof library.formatDynamicRange, 'function');

  const f0 = library.formatDynamicRange(0);
  assert.equal(f0.label, 'DR --');
  assert.equal(f0.grade, 'Chờ tín hiệu');

  const fRef = library.formatDynamicRange(14.8);
  assert.equal(fRef.label, 'DR15');
  assert.equal(fRef.grade, 'Audiophile Ref');
  assert.ok(fRef.badgeClass.includes('emerald'));

  const fHigh = library.formatDynamicRange(11.2);
  assert.equal(fHigh.label, 'DR11');
  assert.equal(fHigh.grade, 'Tự nhiên');
  assert.ok(fHigh.badgeClass.includes('violet'));

  const fStd = library.formatDynamicRange(8.5);
  assert.equal(fStd.label, 'DR9');
  assert.equal(fStd.grade, 'Tiêu chuẩn');
  assert.ok(fStd.badgeClass.includes('amber'));

  const fComp = library.formatDynamicRange(5.4);
  assert.equal(fComp.label, 'DR5');
  assert.equal(fComp.grade, 'Nén mạnh');
  assert.ok(fComp.badgeClass.includes('rose'));
});

test('calculateBufferLookahead - tính toán số giây audio đã nạp trước trong bộ đệm', () => {
  assert.equal(typeof library.calculateBufferLookahead, 'function');

  // Giả lập TimeRanges object với 1 khoảng đệm từ 0s tới 25s
  const mockRanges1 = {
    length: 1,
    start: (i) => [0][i],
    end: (i) => [25.4][i]
  };
  // Khi đang ở giây thứ 10.0, lookahead = 15.4s
  const lookahead1 = library.calculateBufferLookahead(10.0, mockRanges1);
  assert.equal(lookahead1, 15.4);

  // Giả lập nhiều dải đệm ngắt quãng
  const mockRanges2 = {
    length: 2,
    start: (i) => [0, 40][i],
    end: (i) => [20, 65][i]
  };
  assert.equal(library.calculateBufferLookahead(45.0, mockRanges2), 20.0);

  // Vị trí nằm ngoài các dải đệm
  assert.equal(library.calculateBufferLookahead(30.0, mockRanges2), 0);

  // Xử lý an toàn khi mảng rỗng hoặc đầu vào không hợp lệ
  assert.equal(library.calculateBufferLookahead(10, null), 0);
  assert.equal(library.calculateBufferLookahead(10, { length: 0 }), 0);
  assert.equal(library.calculateBufferLookahead(-5, mockRanges1), 0);
});

test('formatBufferLookahead - hiển thị trạng thái phát liền mạch và đệm âm thanh', () => {
  assert.equal(typeof library.formatBufferLookahead, 'function');

  assert.equal(library.formatBufferLookahead(0), 'Đang nạp luồng...');
  assert.ok(library.formatBufferLookahead(15.2, false).includes('Đệm 15.2s (Sẵn sàng Gapless)'));
  assert.ok(library.formatBufferLookahead(4.5, false).includes('Đang phát (4.5s đệm)'));
  assert.ok(library.formatBufferLookahead(1.8, false).includes('Đang nạp (1.8s)'));
  assert.ok(library.formatBufferLookahead(3.0, true).includes('Sẵn sàng Gapless'));
});

test('index.html DOM & Script Integration - Dynamic Range Meter & Buffer Monitor', () => {
  assert.ok(indexHtml.includes('id="room-dr-badge"'), 'Phòng nghe phải có #room-dr-badge');
  assert.ok(indexHtml.includes('id="room-crest-detail"'), 'Phòng nghe phải có #room-crest-detail');
  assert.ok(indexHtml.includes('id="room-buffer-status"'), 'Phòng nghe phải có #room-buffer-status');
  assert.ok(indexHtml.includes('id="footer-dr-badge"'), 'Footer phải có #footer-dr-badge');

  assert.ok(indexHtml.includes('calculateDynamicRange(level.peakDb, level.rmsDb)'), 'Visualizer loop phải tính toán Dynamic Range');
  assert.ok(indexHtml.includes('calculateBufferLookahead(element.currentTime, element.buffered)'), 'timeupdate phải đo buffer lookahead');
  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Bất biến Audio Routing phải được bảo toàn');
});
