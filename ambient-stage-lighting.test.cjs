'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('calculateAudioEnergyBands - phân tích năng lượng âm học thời gian thực theo dải tần số', async (t) => {
  await t.test('xử lý an toàn khi mảng rỗng hoặc không hợp lệ', () => {
    const empty1 = library.calculateAudioEnergyBands(null);
    assert.deepEqual(empty1, { bass: 0, vocal: 0, treble: 0, overall: 0, isBeatPulse: false });

    const empty2 = library.calculateAudioEnergyBands([]);
    assert.deepEqual(empty2, { bass: 0, vocal: 0, treble: 0, overall: 0, isBeatPulse: false });
  });

  await t.test('nhận diện chính xác xung nhịp Bass (Kick drum / Sub-bass)', () => {
    // 128 bins (fftSize = 256, sampleRate = 44100 -> ~172 Hz / bin)
    // Bin 0, 1 nằm trong dải 0 - 260 Hz
    const data = new Uint8Array(128);
    data[0] = 255;
    data[1] = 240;

    const res = library.calculateAudioEnergyBands(data, 44100, 256);
    assert.ok(res.bass >= 0.9, 'Năng lượng bass phải rất cao');
    assert.equal(res.treble, 0, 'Dải cao không có tín hiệu');
    assert.equal(res.isBeatPulse, true, 'Xung nhịp beat phải kích hoạt khi bass áp đảo');
  });

  await t.test('nhận diện chính xác dải trung / giọng hát (Vocal 260 Hz - 4000 Hz)', () => {
    const data = new Uint8Array(128);
    // Bins từ ~2 đến 23 (344 Hz đến 3956 Hz)
    for (let i = 2; i <= 23; i++) data[i] = 200;

    const res = library.calculateAudioEnergyBands(data, 44100, 256);
    assert.ok(res.vocal >= 0.7, 'Năng lượng vocal phải cao');
    assert.equal(res.treble, 0, 'Dải treble không có tín hiệu');
  });

  await t.test('nhận diện chính xác dải kim / Treble (> 4000 Hz)', () => {
    const data = new Uint8Array(128);
    for (let i = 25; i < 128; i++) data[i] = 220;

    const res = library.calculateAudioEnergyBands(data, 44100, 256);
    assert.ok(res.treble >= 0.8, 'Năng lượng treble phải cao');
    assert.equal(res.bass, 0, 'Dải bass không có tín hiệu');
  });
});

test('AMBIENT_STAGE_MODES - định nghĩa 4 chế độ ánh sáng sân khấu chuyên nghiệp', () => {
  assert.ok(library.AMBIENT_STAGE_MODES);
  const modes = library.AMBIENT_STAGE_MODES;

  assert.ok(modes.reactive, 'Hỗ trợ mode reactive');
  assert.ok(modes.subtle, 'Hỗ trợ mode subtle');
  assert.ok(modes.static, 'Hỗ trợ mode static');
  assert.ok(modes.off, 'Hỗ trợ mode off');

  for (const [key, profile] of Object.entries(modes)) {
    assert.equal(profile.id, key);
    assert.ok(profile.name && typeof profile.name === 'string');
    assert.ok(profile.description && typeof profile.description === 'string');
  }
});

test('calculateAmbientPulseTransform - tính toán tỷ lệ phóng to (scale), độ trong suốt (opacity) và bộ lọc (filter)', async (t) => {
  await t.test('chế độ off triệt tiêu hoàn toàn hào quang (opacity = 0)', () => {
    const energy = { bass: 0.9, vocal: 0.8, treble: 0.5, overall: 0.8, isBeatPulse: true };
    const res = library.calculateAmbientPulseTransform(energy, 'off');
    assert.equal(res.scale, 1);
    assert.equal(res.opacity, 0);
  });

  await t.test('chế độ static giữ nguyên kích thước và độ sáng cố định', () => {
    const energy = { bass: 0.9, vocal: 0.8, treble: 0.5, overall: 0.8, isBeatPulse: true };
    const res = library.calculateAmbientPulseTransform(energy, 'static');
    assert.equal(res.scale, 1);
    assert.equal(res.opacity, 0.35);
    assert.equal(res.blur, 24);
  });

  await t.test('chế độ subtle chuyển động êm dịu, không vượt ngưỡng phân tâm', () => {
    const energy = { bass: 0.8, vocal: 0.5, treble: 0.2, overall: 0.5, isBeatPulse: false };
    const res = library.calculateAmbientPulseTransform(energy, 'subtle');
    assert.ok(res.scale >= 1.0 && res.scale <= 1.02);
    assert.ok(res.opacity >= 0.25 && res.opacity <= 0.45);
  });

  await t.test('chế độ reactive phập phồng mạnh mẽ khi có Beat Pulse', () => {
    const beatEnergy = { bass: 0.95, vocal: 0.7, treble: 0.3, overall: 0.65, isBeatPulse: true };
    const res = library.calculateAmbientPulseTransform(beatEnergy, 'reactive');
    assert.ok(res.scale >= 1.04, 'Scale phải nở rộng khi có nhịp bass');
    assert.ok(res.opacity >= 0.5, 'Độ trong suốt tăng khi âm nhạc bùng nổ');
    assert.ok(res.transform.includes('scale('));
    assert.ok(res.filter.includes('blur('));
  });
});

test('formatAmbientStageSummary - định dạng trạng thái ánh sáng sân khấu trực quan', () => {
  assert.equal(library.formatAmbientStageSummary('off'), 'Ánh sáng nền: Tắt');
  const reactiveText = library.formatAmbientStageSummary('reactive', true);
  assert.ok(reactiveText.includes('Vũ trường Ánh sáng'));
  assert.ok(reactiveText.includes('Đang phát'));
  const subtleText = library.formatAmbientStageSummary('subtle', false);
  assert.ok(subtleText.includes('Phòng nghe Tinh tế'));
  assert.ok(subtleText.includes('Tạm dừng'));
});

test('index.html DOM & Script Wiring for Ambient Stage Lighting', () => {
  // Phần tử nền toàn trang
  assert.ok(html.includes('id="app-ambient-backdrop"'), 'Cần có #app-ambient-backdrop làm phông nền toàn trang');
  assert.ok(html.includes('#app-ambient-backdrop'), 'CSS cần định kiểu cho #app-ambient-backdrop');
  assert.ok(html.includes('#app-ambient-backdrop.active'), 'CSS cần có class #app-ambient-backdrop.active');

  // Giao diện chọn chế độ trong Cài đặt
  assert.ok(html.includes('id="ambient-stage-mode-select"'), 'Cần có #ambient-stage-mode-select');
  assert.ok(html.includes('id="ambient-stage-mode-desc"'), 'Cần có #ambient-stage-mode-desc');
  assert.ok(html.includes('value="reactive"'), 'Tùy chọn reactive');
  assert.ok(html.includes('value="subtle"'), 'Tùy chọn subtle');

  // State và xử lý thời gian thực
  assert.ok(html.includes('ambientStageMode:'), 'State cần lưu trữ ambientStageMode');
  assert.ok(html.includes('nocturne-ambient-stage-mode'), 'Cần lưu trữ và phục hồi qua localStorage');
  assert.ok(html.includes('calculateAudioEnergyBands'), 'Vòng lặp visualizer cần gọi calculateAudioEnergyBands');
  assert.ok(html.includes('calculateAmbientPulseTransform'), 'Vòng lặp visualizer cần gọi calculateAmbientPulseTransform');

  // Bất biến tối cao AudioContext Graph
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Bất biến AudioContext Graph: state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên vẹn!'
  );
});
