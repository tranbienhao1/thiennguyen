'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('VISUALIZER_THEMES - cấu hình bảng màu Spectrum Audiophile', async (t) => {
  await t.test('định nghĩa đầy đủ 4 chủ đề màu sắc: cyber, sunset, aurora, monochrome', () => {
    assert.ok(library.VISUALIZER_THEMES, 'VISUALIZER_THEMES phải tồn tại');
    assert.ok(library.VISUALIZER_THEMES.cyber, 'Theme cyber phải tồn tại');
    assert.ok(library.VISUALIZER_THEMES.sunset, 'Theme sunset phải tồn tại');
    assert.ok(library.VISUALIZER_THEMES.aurora, 'Theme aurora phải tồn tại');
    assert.ok(library.VISUALIZER_THEMES.monochrome, 'Theme monochrome phải tồn tại');
  });

  await t.test('mỗi chủ đề có đủ stops, peakColor và tên hiển thị', () => {
    for (const [id, theme] of Object.entries(library.VISUALIZER_THEMES)) {
      assert.equal(theme.id, id, `ID của theme ${id} phải khớp`);
      assert.ok(theme.name && theme.name.length > 0, `Theme ${id} phải có tên hiển thị`);
      assert.ok(Array.isArray(theme.stops) && theme.stops.length >= 2, `Theme ${id} phải có ít nhất 2 gradient stops`);
      assert.ok(theme.peakColor && theme.peakColor.length > 0, `Theme ${id} phải có màu peakColor`);
      for (const stop of theme.stops) {
        assert.ok(typeof stop.offset === 'number' && stop.offset >= 0 && stop.offset <= 1, `Stop offset của ${id} phải trong [0, 1]`);
        assert.ok(typeof stop.color === 'string', `Stop color của ${id} phải là string`);
      }
    }
  });
});

test('getVisualizerTheme & cycleVisualizerTheme', async (t) => {
  await t.test('getVisualizerTheme trả về đúng theme hoặc fallback sang cyber', () => {
    assert.equal(library.getVisualizerTheme('sunset').id, 'sunset');
    assert.equal(library.getVisualizerTheme('aurora').id, 'aurora');
    assert.equal(library.getVisualizerTheme('monochrome').id, 'monochrome');
    assert.equal(library.getVisualizerTheme('non-existent').id, 'cyber');
    assert.equal(library.getVisualizerTheme(null).id, 'cyber');
  });

  await t.test('cycleVisualizerTheme xoay vòng tuần tự qua các theme', () => {
    assert.equal(library.cycleVisualizerTheme('cyber'), 'sunset');
    assert.equal(library.cycleVisualizerTheme('sunset'), 'aurora');
    assert.equal(library.cycleVisualizerTheme('aurora'), 'monochrome');
    assert.equal(library.cycleVisualizerTheme('monochrome'), 'cyber');
    assert.equal(library.cycleVisualizerTheme('invalid'), 'cyber');
  });
});

test('updateVisualizerPeaks - mô phỏng vật lý giữ đỉnh và phân rã rơi chậm (Peak Hold & Decay)', async (t) => {
  await t.test('đỉnh tăng ngay lập tức khi tín hiệu âm thanh cao hơn', () => {
    const prev = [{ val: 0.2, hold: 0 }];
    const current = [0.8];
    const updated = library.updateVisualizerPeaks(current, prev, { holdFrames: 5, decayRate: 0.02 });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].val, 0.8);
    assert.equal(updated[0].hold, 5);
  });

  await t.test('đỉnh được giữ nguyên giá trị trong thời gian holdFrames', () => {
    let peaks = [{ val: 0.9, hold: 3 }];
    const current = [0.1]; // Tín hiệu nhỏ hơn nhiều

    // Frame 1: giảm hold từ 3 xuống 2, val giữ nguyên
    peaks = library.updateVisualizerPeaks(current, peaks, { holdFrames: 5, decayRate: 0.05 });
    assert.equal(peaks[0].val, 0.9);
    assert.equal(peaks[0].hold, 2);

    // Frame 2: giảm hold từ 2 xuống 1, val giữ nguyên
    peaks = library.updateVisualizerPeaks(current, peaks, { holdFrames: 5, decayRate: 0.05 });
    assert.equal(peaks[0].val, 0.9);
    assert.equal(peaks[0].hold, 1);

    // Frame 3: giảm hold từ 1 xuống 0, val giữ nguyên
    peaks = library.updateVisualizerPeaks(current, peaks, { holdFrames: 5, decayRate: 0.05 });
    assert.equal(peaks[0].val, 0.9);
    assert.equal(peaks[0].hold, 0);

    // Frame 4: hold đã hết (<= 0), bắt đầu phân rã theo decayRate (0.9 - 0.05 = 0.85)
    peaks = library.updateVisualizerPeaks(current, peaks, { holdFrames: 5, decayRate: 0.05 });
    assert.ok(Math.abs(peaks[0].val - 0.85) < 0.001);
  });

  await t.test('xử lý an toàn khi prev rỗng hoặc mảng chưa khởi tạo', () => {
    const updated = library.updateVisualizerPeaks([0.5, 0.7], null);
    assert.equal(updated.length, 2);
    assert.equal(updated[0].val, 0.5);
    assert.equal(updated[1].val, 0.7);
  });
});

test('renderVisualizerSpectrum - render canvas 2D phổ tần số và vạch đỉnh', async (t) => {
  await t.test('trả về false khi context hoặc kích thước canvas không hợp lệ', () => {
    assert.equal(library.renderVisualizerSpectrum(null, { width: 100, height: 50 }), false);
    const mockCtx = {};
    assert.equal(library.renderVisualizerSpectrum(mockCtx, { width: 0, height: 50 }), false);
    assert.equal(library.renderVisualizerSpectrum(mockCtx, { width: 100, height: -1 }), false);
  });

  await t.test('vẽ các cột phổ và vạch đỉnh với gradient', () => {
    const rects = [];
    const addedStops = [];
    const mockCtx = {
      createLinearGradient: () => ({
        addColorStop: (offset, color) => addedStops.push({ offset, color })
      }),
      beginPath: () => {},
      roundRect: (x, y, w, h, r) => rects.push({ type: 'round', x, y, w, h }),
      fillRect: (x, y, w, h) => rects.push({ type: 'fill', x, y, w, h }),
      fill: () => {},
      fillStyle: ''
    };

    const data = new Uint8Array([100, 150, 200, 255]);
    const peaks = [{ val: 0.8 }, { val: 0.9 }, { val: 0.5 }, { val: 0.95 }];
    const result = library.renderVisualizerSpectrum(mockCtx, {
      data,
      peaks,
      width: 120,
      height: 32,
      bars: 4,
      gap: 2,
      theme: 'cyber',
      mode: 'mirror'
    });

    assert.equal(result, true, 'Render phải thành công');
    assert.ok(addedStops.length >= 2, 'Phải thêm các stops cho gradient');
    assert.ok(rects.length >= 4, 'Phải vẽ ít nhất 4 cột phổ');
  });
});

test('DOM & Script Integration: Multi-Theme Visualizer', async (t) => {
  await t.test('canvas #visualizer có giao diện tương tác đổi bảng màu', () => {
    assert.match(indexHtml, /<canvas id="visualizer"[^>]*cursor-pointer/, 'Canvas #visualizer phải có cursor-pointer');
    assert.match(indexHtml, /<canvas id="visualizer"[^>]*title="[^"]*Spectrum FFT/, 'Canvas #visualizer phải có tooltip hướng dẫn');
  });

  await t.test('state khởi tạo visualizerTheme và đọc từ localStorage', () => {
    assert.ok(indexHtml.includes('visualizerTheme:'), 'state phải khai báo visualizerTheme');
    assert.ok(indexHtml.includes('nocturne-visualizer-theme'), 'Phải đọc và ghi localStorage nocturne-visualizer-theme');
  });

  await t.test('setVisualizerRunning sử dụng renderVisualizerSpectrum và updateVisualizerPeaks', () => {
    assert.ok(indexHtml.includes('library.renderVisualizerSpectrum'), 'setVisualizerRunning phải gọi renderVisualizerSpectrum');
    assert.ok(indexHtml.includes('library.updateVisualizerPeaks'), 'setVisualizerRunning phải gọi updateVisualizerPeaks');
  });

  await t.test('sự kiện click trên #visualizer xoay vòng theme và hiển thị toast', () => {
    assert.ok(indexHtml.includes("library.cycleVisualizerTheme(state.visualizerTheme)"), 'Click listener phải xoay vòng theme');
    assert.ok(indexHtml.includes("Chủ đề Spectrum:"), 'Phải thông báo toast khi đổi theme');
  });

  await t.test('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến đồ thị âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên'
    );
  });
});
