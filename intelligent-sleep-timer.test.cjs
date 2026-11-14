'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: formatSleepCountdownCompact ──

describe('formatSleepCountdownCompact', () => {
  it('trả về 0:00 khi giá trị âm, 0, NaN hoặc không hợp lệ', () => {
    assert.equal(library.formatSleepCountdownCompact(0), '0:00');
    assert.equal(library.formatSleepCountdownCompact(-1000), '0:00');
    assert.equal(library.formatSleepCountdownCompact(NaN), '0:00');
    assert.equal(library.formatSleepCountdownCompact(null), '0:00');
    assert.equal(library.formatSleepCountdownCompact(undefined), '0:00');
  });

  it('định dạng mm:ss khi thời gian dưới 1 giờ', () => {
    assert.equal(library.formatSleepCountdownCompact(5000), '0:05');
    assert.equal(library.formatSleepCountdownCompact(59000), '0:59');
    assert.equal(library.formatSleepCountdownCompact(65000), '1:05');
    assert.equal(library.formatSleepCountdownCompact(600000), '10:00');
    assert.equal(library.formatSleepCountdownCompact(900000), '15:00');
    assert.equal(library.formatSleepCountdownCompact(2700000), '45:00');
  });

  it('định dạng h:mm:ss khi thời gian từ 1 giờ trở lên', () => {
    assert.equal(library.formatSleepCountdownCompact(3600000), '1:00:00');
    assert.equal(library.formatSleepCountdownCompact(3665000), '1:01:05');
    assert.equal(library.formatSleepCountdownCompact(5400000), '1:30:00');
    assert.equal(library.formatSleepCountdownCompact(7200000), '2:00:00');
  });
});

// ── 2. Unit tests: calculateAlbumRemainingSeconds ──

describe('calculateAlbumRemainingSeconds', () => {
  const tracks = [
    { id: 't1', album: 'Album A', duration: 180 },
    { id: 't2', album: 'Album A', duration: 240 },
    { id: 't3', album: 'Album B', duration: 200 },
    { id: 't4', album: 'Album A', duration: 300 }
  ];

  it('tính chính xác thời gian còn lại của album theo track và vị trí phát hiện tại', () => {
    // Đang phát track t1 tại giây thứ 60: t1 còn 120s, sau đó là t2 (240s) và t4 (300s) -> Tổng: 120 + 240 + 300 = 660s
    const rem = library.calculateAlbumRemainingSeconds(tracks, 't1', 60);
    assert.equal(rem, 660);
  });

  it('tính chính xác khi đang ở bài cuối cùng của album', () => {
    // Đang phát track t4 tại giây thứ 100: còn 300 - 100 = 200s
    const rem = library.calculateAlbumRemainingSeconds(tracks, 't4', 100);
    assert.equal(rem, 200);
  });

  it('xử lý an toàn khi không tìm thấy track, danh sách rỗng hoặc không có album', () => {
    assert.equal(library.calculateAlbumRemainingSeconds([], 't1', 0), 0);
    assert.equal(library.calculateAlbumRemainingSeconds(null, 't1', 0), 0);
    assert.equal(library.calculateAlbumRemainingSeconds(tracks, 'unknown-id', 0), 0);
    const noAlbumTracks = [{ id: 'na1', duration: 150 }];
    assert.equal(library.calculateAlbumRemainingSeconds(noAlbumTracks, 'na1', 30), 120);
  });
});

// ── 3. Unit tests: extendSleepTimer ──

describe('extendSleepTimer', () => {
  it('gia hạn thêm số phút chính xác vào thời gian còn lại hiện tại', () => {
    // Đang còn 10 phút (600,000ms), gia hạn thêm 5 phút (300,000ms) -> 900,000ms
    assert.equal(library.extendSleepTimer(600000, 5), 900000);
    // Gia hạn thêm 15 phút
    assert.equal(library.extendSleepTimer(600000, 15), 1500000);
  });

  it('khởi tạo timer mới nếu thời gian hiện tại <= 0 hoặc không hợp lệ', () => {
    assert.equal(library.extendSleepTimer(0, 15), 900000);
    assert.equal(library.extendSleepTimer(-500, 5), 300000);
    assert.equal(library.extendSleepTimer(null, 30), 1800000);
  });

  it('kẹp trần thời gian tối đa là 360 phút (6 tiếng)', () => {
    const hugeMs = 400 * 60000;
    assert.equal(library.extendSleepTimer(hugeMs, 15), 360 * 60000);
  });
});

// ── 4. Unit tests: calculateAdaptiveSleepStage ──

describe('calculateAdaptiveSleepStage', () => {
  it('trả về stage ended khi remainingMs <= 0', () => {
    const res = library.calculateAdaptiveSleepStage(0, 1800000);
    assert.equal(res.stage, 'ended');
    assert.equal(res.musicGain, 0);
    assert.equal(res.ambientGain, 0);
  });

  it('trả về stage fadeout khi remainingMs <= fadeDurationMs', () => {
    const fadeDurationMs = 30000;
    const res = library.calculateAdaptiveSleepStage(15000, 1800000, fadeDurationMs, { ambientScene: true, ambientBaseVolume: 0.3 });
    assert.equal(res.stage, 'fadeout');
    assert.ok(res.musicGain > 0 && res.musicGain < 1);
    assert.ok(res.ambientGain > 0 && res.ambientGain < 0.3);
  });

  it('trả về stage ambient_transition khi trong cửa sổ chuyển tiếp ru ngủ', () => {
    // 30 phút timer, fade 30s. Window = Math.max(60s, min(10m, 12m)) = 10m = 600,000ms.
    // Thử ở phút thứ 5 (300,000ms còn lại)
    const res = library.calculateAdaptiveSleepStage(300000, 1800000, 30000, { ambientScene: true, ambientBaseVolume: 0.3 });
    assert.equal(res.stage, 'ambient_transition');
    assert.equal(res.musicGain, 1.0);
    assert.ok(res.ambientGain > 0 && res.ambientGain <= 0.3);
  });

  it('trả về stage active khi thời gian còn dài', () => {
    const res = library.calculateAdaptiveSleepStage(1500000, 1800000, 30000, { ambientScene: false });
    assert.equal(res.stage, 'active');
    assert.equal(res.musicGain, 1.0);
    assert.equal(res.ambientGain, 0);
  });
});

// ── 5. DOM & Script Integration Tests ──

describe('DOM & Script Integration: Intelligent Sleep Timer', () => {
  it('các phần tử điều khiển đa tầng tồn tại trong #sleep-panel', () => {
    assert.match(html, /id=["']sleep-panel["']/);
    assert.match(html, /id=["']sleep-badge["']/);
    assert.match(html, /id=["']sleep-album-end["']/);
    assert.match(html, /id=["']sleep-add-5m["']/);
    assert.match(html, /id=["']sleep-add-15m["']/);
    assert.match(html, /id=["']sleep-custom-input["']/);
    assert.match(html, /id=["']sleep-custom-btn["']/);
    assert.match(html, /id=["']sleep-fade-duration["']/);
    assert.match(html, /id=["']sleep-ambient-scene["']/);
  });

  it('state khởi tạo các biến mở rộng cho hẹn giờ ngủ thông minh', () => {
    assert.match(html, /sleepCountdownInterval:\s*null/);
    assert.match(html, /sleepOriginalGain:\s*null/);
  });

  it('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.match(html, /state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/);
  });
});
