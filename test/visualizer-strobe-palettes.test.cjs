'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha B: Bảng màu Audiophile Mới - Crimson Velvet Night & Deep Amethyst Glow', async (t) => {
  await t.test('định nghĩa đầy đủ bảng màu crimson và amethyst trong VISUALIZER_THEMES', () => {
    assert.ok(library.VISUALIZER_THEMES.crimson, 'Theme crimson phải tồn tại');
    assert.equal(library.VISUALIZER_THEMES.crimson.id, 'crimson');
    assert.equal(library.VISUALIZER_THEMES.crimson.name, 'Crimson Velvet Night');
    assert.equal(library.VISUALIZER_THEMES.crimson.peakColor, '#fecdd3');
    assert.equal(library.VISUALIZER_THEMES.crimson.stops.length, 3);

    assert.ok(library.VISUALIZER_THEMES.amethyst, 'Theme amethyst phải tồn tại');
    assert.equal(library.VISUALIZER_THEMES.amethyst.id, 'amethyst');
    assert.equal(library.VISUALIZER_THEMES.amethyst.name, 'Deep Amethyst Glow');
    assert.equal(library.VISUALIZER_THEMES.amethyst.peakColor, '#f5d0fe');
    assert.equal(library.VISUALIZER_THEMES.amethyst.stops.length, 3);
  });

  await t.test('getVisualizerTheme trả về đúng theme crimson & amethyst hoặc fallback', () => {
    assert.equal(library.getVisualizerTheme('crimson').id, 'crimson');
    assert.equal(library.getVisualizerTheme('amethyst').id, 'amethyst');
    assert.equal(library.getVisualizerTheme('CRIMSON').id, 'crimson');
  });

  await t.test('formatVisualizerThemeSummary định dạng thông tin bảng màu trực quan', () => {
    const crimsonSummary = library.formatVisualizerThemeSummary('crimson');
    assert.ok(crimsonSummary.includes('Crimson Velvet Night'));
    assert.ok(crimsonSummary.includes('3 bậc màu'));
    assert.ok(crimsonSummary.includes('#fecdd3'));

    const amethystSummary = library.formatVisualizerThemeSummary('amethyst');
    assert.ok(amethystSummary.includes('Deep Amethyst Glow'));
    assert.ok(amethystSummary.includes('#f5d0fe'));
  });
});

test('Pha B: hexToRgba chuyển đổi mã màu hex sang định dạng rgba an toàn', async (t) => {
  await t.test('chuyển đổi 6-ký tự hex có alpha chính xác', () => {
    assert.equal(library.hexToRgba('#991b1b', 0.5), 'rgba(153, 27, 27, 0.5)');
    assert.equal(library.hexToRgba('#ffffff', 1), 'rgba(255, 255, 255, 1)');
  });

  await t.test('chuyển đổi 3-ký tự hex viết tắt', () => {
    assert.equal(library.hexToRgba('#fff', 0.8), 'rgba(255, 255, 255, 0.8)');
  });

  await t.test('fallback an toàn khi dữ liệu đầu vào không hợp lệ', () => {
    assert.equal(library.hexToRgba(null, 0.4), 'rgba(255, 255, 255, 0.4)');
    assert.equal(library.hexToRgba('', 1), 'rgba(255, 255, 255, 1)');
  });
});

test('Pha B: calculateVisualizerStrobe tính toán xung nhịp chớp sáng vũ trường (Beat Strobe Pulse)', async (t) => {
  await t.test('nhận diện xung nhịp Bass mạnh từ đối tượng audio energy', () => {
    const energy = { bass: 0.88, isBeatPulse: true };
    const strobe = library.calculateVisualizerStrobe(energy);
    assert.equal(strobe.isStrobeTriggered, true);
    assert.ok(strobe.intensity > 0.4, 'Cường độ chớp phải lớn khi có kick bass');
    assert.ok(strobe.pulseScale > 1.0, 'Độ co giãn pulseScale phải > 1.0');
    assert.ok(strobe.flashOpacity > 0, 'Độ mờ flashOpacity phải > 0');
  });

  await t.test('tính toán năng lượng bass từ mảng byte tần số FFT Uint8Array', () => {
    const byteData = new Uint8Array(64);
    // 16 bins đầu có năng lượng bass cao (240 / 255 ~ 0.94)
    for (let i = 0; i < 16; i++) byteData[i] = 240;
    const strobe = library.calculateVisualizerStrobe(byteData);
    assert.equal(strobe.isStrobeTriggered, true);
    assert.ok(strobe.bassEnergy > 0.8, 'Năng lượng bass phải phản ánh chính xác các bin đầu');
  });

  await t.test('phân rã mượt mà (decay) qua các khung hình liên tiếp khi không có bass', () => {
    let strobe = { intensity: 1.0, pulseScale: 1.08 };
    const quietEnergy = { bass: 0.1, isBeatPulse: false };

    // Khung hình 1: phân rã theo decayRate 0.88 -> ~0.88
    strobe = library.calculateVisualizerStrobe(quietEnergy, strobe, { decayRate: 0.88 });
    assert.ok(strobe.intensity < 1.0 && strobe.intensity >= 0.85);

    // Sau nhiều khung hình tĩnh lặng, intensity suy giảm dần về 0
    for (let f = 0; f < 30; f++) {
      strobe = library.calculateVisualizerStrobe(quietEnergy, strobe, { decayRate: 0.85 });
    }
    assert.equal(strobe.intensity, 0, 'Cường độ chớp phải triệt tiêu hoàn toàn khi bài hát êm dịu');
  });
});

test('Pha B: renderVisualizerBackdropGlow kết xuất hào quang nền phập phồng trên canvas', async (t) => {
  await t.test('trả về false khi kích thước canvas hoặc cường độ strobe không hợp lệ', () => {
    assert.equal(library.renderVisualizerBackdropGlow(null, { width: 100, height: 40 }), false);
    const mockCtx = {};
    assert.equal(library.renderVisualizerBackdropGlow(mockCtx, { width: 0, height: 40 }), false);
    assert.equal(library.renderVisualizerBackdropGlow(mockCtx, { width: 100, height: 40, strobe: { intensity: 0.01 } }), false);
  });

  await t.test('vẽ radial gradient hào quang nền phủ rộng khi strobe kích hoạt', () => {
    const addedStops = [];
    let fillRectCalled = false;
    let saved = false, restored = false;

    const mockCtx = {
      save: () => { saved = true; },
      restore: () => { restored = true; },
      createRadialGradient: (x0, y0, r0, x1, y1, r1) => {
        assert.ok(x0 > 0 && y0 > 0);
        return {
          addColorStop: (offset, color) => addedStops.push({ offset, color })
        };
      },
      fillRect: (x, y, w, h) => {
        fillRectCalled = true;
        assert.equal(w, 200);
        assert.equal(h, 60);
      },
      fillStyle: ''
    };

    const strobe = { intensity: 0.8, pulseScale: 1.06 };
    const result = library.renderVisualizerBackdropGlow(mockCtx, {
      width: 200,
      height: 60,
      theme: 'amethyst',
      strobe
    });

    assert.equal(result, true, 'Render hào quang nền phải thành công');
    assert.ok(saved && restored, 'Canvas context phải được save và restore an toàn');
    assert.ok(fillRectCalled, 'Phải gọi fillRect để phủ hào quang nền');
    assert.ok(addedStops.length >= 2, 'Phải có ít nhất 2 gradient color stops');
    assert.ok(addedStops[0].color.includes('192, 132, 252') || addedStops[0].color.includes('245, 208, 254'), 'Phải sử dụng màu peakColor của amethyst');
  });
});

test('Pha B: cycleVisualizerTheme hỗ trợ tùy chọn all để xoay vòng toàn bộ bảng màu', async (t) => {
  await t.test('mặc định không có options.all duy trì 4 bảng màu gốc tương thích ngược', () => {
    assert.equal(library.cycleVisualizerTheme('cyber'), 'sunset');
    assert.equal(library.cycleVisualizerTheme('sunset'), 'aurora');
    assert.equal(library.cycleVisualizerTheme('aurora'), 'monochrome');
    assert.equal(library.cycleVisualizerTheme('monochrome'), 'cyber');
  });

  await t.test('với options.all = true xoay vòng tuần tự qua toàn bộ các bảng màu audiophile', () => {
    const allThemes = Object.keys(library.VISUALIZER_THEMES);
    assert.ok(allThemes.length >= 9, 'Phải có ít nhất 9 bảng màu trong VISUALIZER_THEMES');
    assert.ok(allThemes.includes('crimson'));
    assert.ok(allThemes.includes('amethyst'));
    assert.ok(allThemes.includes('neon_hologram'));
    assert.ok(allThemes.includes('golden_ember'));

    assert.equal(library.cycleVisualizerTheme('ocean', { all: true }), 'crimson');
    assert.equal(library.cycleVisualizerTheme('crimson', { all: true }), 'amethyst');
    assert.equal(library.cycleVisualizerTheme(allThemes[allThemes.length - 1], { all: true }), allThemes[0]);
  });
});

test('Pha B: Tích hợp DOM, Cấu hình Sao lưu & Bất biến Đồ thị Âm thanh', async (t) => {
  await t.test('index.html có toggle bật/tắt Strobe Pulse trong phần Sân khấu Ánh sáng Động', () => {
    assert.ok(indexHtml.includes('id="visualizer-strobe-toggle"'), 'Cần có #visualizer-strobe-toggle');
    assert.ok(indexHtml.includes('id="visualizer-strobe-desc"'), 'Cần có #visualizer-strobe-desc');
  });

  await t.test('state khởi tạo visualizerStrobeEnabled và lưu trữ localStorage', () => {
    assert.ok(indexHtml.includes('visualizerStrobeEnabled:'), 'state phải khai báo visualizerStrobeEnabled');
    assert.ok(indexHtml.includes('nocturne-visualizer-strobe'), 'Phải đọc và ghi localStorage nocturne-visualizer-strobe');
  });

  await t.test('setVisualizerRunning tích hợp calculateVisualizerStrobe và renderVisualizerBackdropGlow', () => {
    assert.ok(indexHtml.includes('library.calculateVisualizerStrobe'), 'Phải tính toán strobe nhịp âm thanh');
    assert.ok(indexHtml.includes('library.renderVisualizerBackdropGlow'), 'Phải kết xuất hào quang nền backdrop glow');
  });

  await t.test('phím tắt t / T xoay vòng toàn bộ bảng màu spectrum & glow', () => {
    assert.ok(indexHtml.includes("e.key === 't' || e.key === 'T'"), 'Cần có phím tắt t / T');
    assert.ok(indexHtml.includes("library.cycleVisualizerTheme(state.visualizerTheme, { all: true })"), 'Phím tắt t / T phải xoay vòng toàn bộ bảng màu');
  });

  await t.test('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant Preservation)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến đồ thị âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được bảo toàn 100%'
    );
  });
});
