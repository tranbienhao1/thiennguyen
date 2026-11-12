'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: calculateSleepFadeGain ──

describe('calculateSleepFadeGain', () => {
  it('trả về 1 khi thời gian còn lại lớn hơn hoặc bằng thời lượng fade-out', () => {
    assert.equal(library.calculateSleepFadeGain(30000, 30000), 1);
    assert.equal(library.calculateSleepFadeGain(45000, 30000), 1);
    assert.equal(library.calculateSleepFadeGain(60000), 1);
  });

  it('trả về 0 khi thời gian còn lại <= 0 hoặc không hợp lệ', () => {
    assert.equal(library.calculateSleepFadeGain(0, 30000), 0);
    assert.equal(library.calculateSleepFadeGain(-500, 30000), 0);
    assert.equal(library.calculateSleepFadeGain(NaN, 30000), 0);
    assert.equal(library.calculateSleepFadeGain(null, 30000), 0);
    assert.equal(library.calculateSleepFadeGain(undefined, 30000), 0);
  });

  it('tính toán đường cong equal-power sine mượt mà', () => {
    // Tại điểm giữa (ratio = 0.5): sin(0.5 * pi / 2) = sin(pi / 4) = sqrt(2)/2 ≈ 0.7071
    const halfGain = library.calculateSleepFadeGain(15000, 30000);
    assert.ok(Math.abs(halfGain - Math.SQRT1_2) < 1e-4, `Expected ~0.7071, got ${halfGain}`);

    // Giảm dần đơn điệu
    const g3 = library.calculateSleepFadeGain(25000, 30000);
    const g2 = library.calculateSleepFadeGain(15000, 30000);
    const g1 = library.calculateSleepFadeGain(5000, 30000);
    assert.ok(g3 > g2, 'Gain at 25s should be greater than at 15s');
    assert.ok(g2 > g1, 'Gain at 15s should be greater than at 5s');
    assert.ok(g1 > 0, 'Gain at 5s should be greater than 0');
  });

  it('dùng DEFAULT_SLEEP_FADEOUT_MS (30000) khi không truyền tham số fadeDurationMs', () => {
    assert.equal(library.DEFAULT_SLEEP_FADEOUT_MS, 30000);
    assert.equal(library.calculateSleepFadeGain(30000), 1);
    const halfGain = library.calculateSleepFadeGain(15000);
    assert.ok(Math.abs(halfGain - Math.SQRT1_2) < 1e-4);
  });

  it('giới hạn tối thiểu fadeDurationMs là 1000ms', () => {
    // fadeDurationMs < 1000 sẽ được clamp thành 1000
    assert.equal(library.calculateSleepFadeGain(1000, 100), 1);
    const half = library.calculateSleepFadeGain(500, 100);
    assert.ok(Math.abs(half - Math.SQRT1_2) < 1e-4);
  });
});

// ── 2. Unit tests: formatSleepRemaining ──

describe('formatSleepRemaining', () => {
  it('định dạng đúng thời gian còn lại tính bằng giây', () => {
    assert.equal(library.formatSleepRemaining(45000), '45 giây');
    assert.equal(library.formatSleepRemaining(10000), '10 giây');
    assert.equal(library.formatSleepRemaining(1000), '1 giây');
  });

  it('định dạng đúng thời gian chẵn phút', () => {
    assert.equal(library.formatSleepRemaining(60000), '1 phút');
    assert.equal(library.formatSleepRemaining(300000), '5 phút');
    assert.equal(library.formatSleepRemaining(900000), '15 phút');
  });

  it('định dạng đúng phút và giây lẻ', () => {
    assert.equal(library.formatSleepRemaining(75000), '1 phút 15 giây');
    assert.equal(library.formatSleepRemaining(125000), '2 phút 5 giây');
  });

  it('xử lý an toàn khi hết giờ hoặc số âm/NaN', () => {
    assert.equal(library.formatSleepRemaining(0), 'Hết giờ');
    assert.equal(library.formatSleepRemaining(-500), 'Hết giờ');
    assert.equal(library.formatSleepRemaining(NaN), 'Hết giờ');
    assert.equal(library.formatSleepRemaining(null), 'Hết giờ');
  });
});

// ── 3. DOM & State Regression Tests ──

describe('DOM & Script Integration: Sleep Timer Fade-Out', () => {
  it('checkbox #sleep-fadeout tồn tại trong #sleep-panel với nhãn dễ hiểu', () => {
    assert.match(html, /id=["']sleep-fadeout["']/);
    assert.match(html, /Fade-out 30s cuối/);
  });

  it('các hàm setSleepTimer và clearSleepTimer được khai báo trong script', () => {
    assert.match(html, /function setSleepTimer\(/);
    assert.match(html, /function clearSleepTimer\(/);
  });

  it('state khởi tạo các biến sleepFadeTimer, sleepFadeInterval, sleepOriginalVolume', () => {
    assert.match(html, /sleepFadeTimer:\s*null/);
    assert.match(html, /sleepFadeInterval:\s*null/);
    assert.match(html, /sleepOriginalVolume:\s*null/);
  });

  it('setSleepTimer tích hợp calculateSleepFadeGain và bảo toàn âm lượng gốc', () => {
    assert.match(html, /calculateSleepFadeGain/);
    assert.match(html, /sleepOriginalVolume/);
    assert.match(html, /fade-out 30s cuối/);
  });

  it('clearSleepTimer và sleep-track-end dọn dẹp timer và khôi phục âm lượng', () => {
    assert.match(html, /clearTimeout\(state\.sleepFadeTimer\)/);
    assert.match(html, /clearInterval\(state\.sleepFadeInterval\)/);
  });
});
