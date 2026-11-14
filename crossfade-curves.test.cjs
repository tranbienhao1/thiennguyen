'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('CROSSFADE_CURVE_PROFILES - định nghĩa đầy đủ 4 bộ đặc tuyến hòa âm chuẩn audiophile', () => {
  assert.ok(library.CROSSFADE_CURVE_PROFILES, 'CROSSFADE_CURVE_PROFILES phải được export');
  const profiles = library.CROSSFADE_CURVE_PROFILES;

  assert.ok(profiles['equal-power'], 'Hỗ trợ profile equal-power');
  assert.ok(profiles['linear'], 'Hỗ trợ profile linear');
  assert.ok(profiles['exponential'], 'Hỗ trợ profile exponential');
  assert.ok(profiles['s-curve'], 'Hỗ trợ profile s-curve');

  for (const [key, profile] of Object.entries(profiles)) {
    assert.equal(profile.id, key);
    assert.ok(profile.name && typeof profile.name === 'string');
    assert.ok(profile.description && typeof profile.description === 'string');
    assert.ok(profile.formula && typeof profile.formula === 'string');
  }
});

test('calculateCrossfadeGains - kiểm tra giá trị gain và tính chất toán học cho từng profile', () => {
  // 1. Equal-power: cos/sin, bảo toàn tổng công suất: out^2 + in^2 = 1
  const ep0 = library.calculateCrossfadeGains(0, 'equal-power');
  assert.equal(ep0.out, 1);
  assert.equal(ep0.in, 0);

  const ep1 = library.calculateCrossfadeGains(1, 'equal-power');
  assert.ok(Math.abs(ep1.out) < 1e-12);
  assert.equal(ep1.in, 1);

  const epMid = library.calculateCrossfadeGains(0.5, 'equal-power');
  assert.ok(Math.abs(epMid.out - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(epMid.in - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs((epMid.out ** 2 + epMid.in ** 2) - 1) < 1e-12);

  // 2. Linear: out = 1 - t, in = t, bảo toàn biên độ tuyến tính: out + in = 1
  const lin0 = library.calculateCrossfadeGains(0, 'linear');
  assert.equal(lin0.out, 1);
  assert.equal(lin0.in, 0);

  const lin1 = library.calculateCrossfadeGains(1, 'linear');
  assert.equal(lin1.out, 0);
  assert.equal(lin1.in, 1);

  const linMid = library.calculateCrossfadeGains(0.5, 'linear');
  assert.equal(linMid.out, 0.5);
  assert.equal(linMid.in, 0.5);
  assert.equal(linMid.out + linMid.in, 1);

  // 3. Exponential: out = sqrt(1-t), in = sqrt(t)
  const exp0 = library.calculateCrossfadeGains(0, 'exponential');
  assert.equal(exp0.out, 1);
  assert.equal(exp0.in, 0);

  const exp1 = library.calculateCrossfadeGains(1, 'exponential');
  assert.equal(exp1.out, 0);
  assert.equal(exp1.in, 1);

  const expMid = library.calculateCrossfadeGains(0.5, 'exponential');
  assert.ok(Math.abs(expMid.out - Math.sqrt(0.5)) < 1e-12);
  assert.ok(Math.abs(expMid.in - Math.sqrt(0.5)) < 1e-12);

  // 4. S-Curve: Hermite smoothstep (3t^2 - 2t^3)
  const sc0 = library.calculateCrossfadeGains(0, 's-curve');
  assert.equal(sc0.out, 1);
  assert.equal(sc0.in, 0);

  const sc1 = library.calculateCrossfadeGains(1, 's-curve');
  assert.ok(Math.abs(sc1.out) < 1e-12);
  assert.equal(sc1.in, 1);

  const scMid = library.calculateCrossfadeGains(0.5, 's-curve');
  assert.ok(Math.abs(scMid.out - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(scMid.in - Math.SQRT1_2) < 1e-12);

  // Clamping biên: t < 0 kẹp về 0, t > 1 kẹp về 1, non-finite kẹp về 0
  const clampedLow = library.calculateCrossfadeGains(-0.5, 'linear');
  assert.equal(clampedLow.out, 1);
  assert.equal(clampedLow.in, 0);

  const clampedHigh = library.calculateCrossfadeGains(1.8, 'linear');
  assert.equal(clampedHigh.out, 0);
  assert.equal(clampedHigh.in, 1);

  const clampedNaN = library.calculateCrossfadeGains(NaN, 'linear');
  assert.equal(clampedNaN.out, 1);
  assert.equal(clampedNaN.in, 0);

  // Fallback profile không tồn tại về equal-power
  const fallbackGains = library.calculateCrossfadeGains(0.5, 'unknown-profile');
  assert.ok(Math.abs(fallbackGains.out - Math.SQRT1_2) < 1e-12);
});

test('crossfadeGains - duy trì tương thích ngược 100% với phiên bản cũ', () => {
  for (let t = 0; t <= 1; t += 0.1) {
    const legacy = library.crossfadeGains(t);
    const modern = library.calculateCrossfadeGains(t, 'equal-power');
    assert.equal(legacy.out, modern.out);
    assert.equal(legacy.in, modern.in);
  }
});

test('formatCrossfadeSummary - định dạng chuỗi mô tả trạng thái crossfade trực quan', () => {
  assert.equal(library.formatCrossfadeSummary(0), 'Tắt (Chuyển bài lập tức)');
  assert.equal(library.formatCrossfadeSummary(-1), 'Tắt (Chuyển bài lập tức)');
  assert.ok(library.formatCrossfadeSummary(2, 'equal-power').includes('2s · Đẳng công suất'));
  assert.ok(library.formatCrossfadeSummary(3, 's-curve').includes('3s · Mềm mại'));
  assert.ok(library.formatCrossfadeSummary(5, 'linear').includes('5s · Tuyến tính'));
  assert.ok(library.formatCrossfadeSummary(2, 'exponential').includes('2s · Mạnh mẽ'));
});

test('calculateGaplessReadiness - tính toán độ sẵn sàng chuyển bài liền mạch (Gapless Buffer Lead)', () => {
  // Trường hợp không có track tiếp theo
  const idleRes = library.calculateGaplessReadiness(null, null, null);
  assert.equal(idleRes.isReady, false);
  assert.equal(idleRes.status, 'idle');

  // Trường hợp không có standbyAudio
  const mockTrack = { id: 'track-2', title: 'Next Song' };
  const noStandbyRes = library.calculateGaplessReadiness(null, null, mockTrack);
  assert.equal(noStandbyRes.isReady, false);
  assert.equal(noStandbyRes.status, 'standby_missing');

  // Trường hợp standbyAudio đã buffer > 3 giây
  const mockStandbyBuffered = {
    readyState: 4,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 4.5
    }
  };
  const readyRes = library.calculateGaplessReadiness(null, mockStandbyBuffered, mockTrack);
  assert.equal(readyRes.isReady, true);
  assert.equal(readyRes.status, 'ready');
  assert.equal(readyRes.bufferLeadSeconds, 4.5);
  assert.ok(readyRes.qualityPercent >= 80);
  assert.ok(readyRes.label.includes('Sẵn sàng phát liền mạch'));

  // Trường hợp track đã cache blob và readyState >= 2
  const mockCachedTrack = { id: 'track-cached', file: new Blob() };
  const mockStandbyCached = { readyState: 2, buffered: { length: 0 } };
  const cachedReadyRes = library.calculateGaplessReadiness(null, mockStandbyCached, mockCachedTrack);
  assert.equal(cachedReadyRes.isReady, true);
});

test('index.html UI & Audio Engine wiring verification', () => {
  // Giao diện chọn đường cong crossfade
  assert.ok(html.includes('id="crossfade-curve-select"'), 'Cần có select #crossfade-curve-select trong Settings');
  assert.ok(html.includes('id="crossfade-curve-desc"'), 'Cần có nhãn mô tả #crossfade-curve-desc');
  assert.ok(html.includes('value="equal-power"'), 'Cần có tùy chọn equal-power');
  assert.ok(html.includes('value="linear"'), 'Cần có tùy chọn linear');
  assert.ok(html.includes('value="exponential"'), 'Cần có tùy chọn exponential');
  assert.ok(html.includes('value="s-curve"'), 'Cần có tùy chọn s-curve');

  // State & engine wiring
  assert.ok(html.includes('crossfadeCurve:'), 'state cần lưu trữ crossfadeCurve');
  assert.ok(html.includes('nocturne-crossfade-curve'), 'Cần lưu trữ và phục hồi crossfadeCurve qua localStorage');
  assert.ok(html.includes('calculateCrossfadeGains'), 'applyCrossfade cần sử dụng calculateCrossfadeGains');

  // Bất biến tối cao AudioContext Graph
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Bất biến AudioContext Graph: state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên vẹn!'
  );
});
