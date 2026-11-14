'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: LIMITER_PROFILES & getLimiterProfile ──

describe('LIMITER_PROFILES & getLimiterProfile', () => {
  it('định nghĩa đầy đủ 3 cấu hình chuẩn: transparent, soft, off', () => {
    assert.ok(library.LIMITER_PROFILES.transparent, 'Must have transparent profile');
    assert.ok(library.LIMITER_PROFILES.soft, 'Must have soft profile');
    assert.ok(library.LIMITER_PROFILES.off, 'Must have off profile');
  });

  it('cấu hình transparent có threshold -0.5 dBFS và tỷ lệ nén 20:1 chống clip tuyệt đối', () => {
    const prof = library.LIMITER_PROFILES.transparent;
    assert.equal(prof.threshold, -0.5);
    assert.equal(prof.ratio, 20);
    assert.equal(prof.attack, 0.001);
    assert.equal(prof.badge, 'BRICKWALL');
  });

  it('cấu hình soft có knee mềm 6 dB và threshold -3 dBFS kiểu đèn cổ điển', () => {
    const prof = library.LIMITER_PROFILES.soft;
    assert.equal(prof.threshold, -3.0);
    assert.equal(prof.knee, 6);
    assert.equal(prof.ratio, 12);
    assert.equal(prof.badge, 'SOFT-KNEE');
  });

  it('cấu hình off có tỷ lệ nén 1:1 hoàn toàn tuyến tính', () => {
    const prof = library.LIMITER_PROFILES.off;
    assert.equal(prof.threshold, 0);
    assert.equal(prof.ratio, 1);
    assert.equal(prof.badge, 'BYPASS');
  });

  it('getLimiterProfile trả về cấu hình an toàn cho mọi đầu vào', () => {
    assert.equal(library.getLimiterProfile('transparent').id, 'transparent');
    assert.equal(library.getLimiterProfile('SOFT').id, 'soft');
    assert.equal(library.getLimiterProfile('off').id, 'off');
    assert.equal(library.getLimiterProfile('invalid').id, 'transparent');
    assert.equal(library.getLimiterProfile(null).id, 'transparent');
    assert.equal(library.getLimiterProfile(undefined).id, 'transparent');
  });
});

// ── 2. Unit tests: applyLimiterParams & formatLimiterSummary ──

describe('applyLimiterParams & formatLimiterSummary', () => {
  it('áp dụng đúng tham số lên mock AudioParam node', () => {
    const mockParam = (init = 0) => {
      let val = init;
      return {
        get value() { return val; },
        set value(v) { val = v; },
        setTargetAtTime(target) { val = target; }
      };
    };

    const mockNode = {
      threshold: mockParam(0),
      knee: mockParam(0),
      ratio: mockParam(1),
      attack: mockParam(0),
      release: mockParam(0)
    };

    const ok = library.applyLimiterParams(mockNode, 'soft', 1.5);
    assert.equal(ok, true);
    assert.equal(mockNode.threshold.value, -3.0);
    assert.equal(mockNode.knee.value, 6);
    assert.equal(mockNode.ratio.value, 12);
  });

  it('xử lý an toàn khi node null hoặc không hợp lệ', () => {
    assert.equal(library.applyLimiterParams(null, 'soft'), false);
    assert.equal(library.applyLimiterParams(undefined, 'soft'), false);
  });

  it('formatLimiterSummary định dạng thông tin tóm tắt chuẩn xác', () => {
    assert.match(library.formatLimiterSummary('transparent'), /-0\.5 dBFS/);
    assert.match(library.formatLimiterSummary('soft'), /-3 dBFS/);
    assert.match(library.formatLimiterSummary('off'), /Bypass/);
  });
});

// ── 3. Integration tests: computeSignalPath with Limiter ──

describe('computeSignalPath with Limiter', () => {
  const cdFlac = { format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2, source: 'local' };

  it('giữ nguyên Bit-Perfect khi limiterMode là off hoặc không kích hoạt DSP', () => {
    const res = library.computeSignalPath(cdFlac, {
      contextRate: 44100,
      eqEnabled: false,
      stereoBalance: 0,
      crossfeedEnabled: false,
      limiterMode: 'off'
    });
    assert.equal(res.hasDsp, false);
    assert.equal(res.steps[2].badge, 'Bit-perfect');
  });

  it('thêm bước xử lý Peak Limiter vào DSP Stage khi bật limiter', () => {
    const res = library.computeSignalPath(cdFlac, {
      contextRate: 44100,
      eqEnabled: false,
      stereoBalance: 0,
      crossfeedEnabled: false,
      limiterMode: 'transparent'
    });
    assert.equal(res.hasDsp, true);
    assert.match(res.steps[2].description, /Peak Limiter: Brickwall/);
  });
});

// ── 4. DOM & Script Integration Tests ──

describe('DOM & Script Integration: Peak Limiter', () => {
  it('các phần tử điều khiển Limiter tồn tại trong #eq-panel', () => {
    assert.match(html, /id=["']limiter-mode-select["']/);
    assert.match(html, /id=["']limiter-badge["']/);
    assert.match(html, /id=["']limiter-desc["']/);
  });

  it('các hàm setLimiterMode và updateLimiterUi được khai báo trong script', () => {
    assert.match(html, /function setLimiterMode\(/);
    assert.match(html, /function updateLimiterUi\(/);
  });

  it('state khởi tạo limiterMode và lưu cấu hình vào localStorage', () => {
    assert.match(html, /limiterMode:\s*['"]transparent['"]/);
    assert.match(html, /localStorage\.setItem\(['"]nocturne-limiter-mode['"]/);
    assert.match(html, /localStorage\.getItem\(['"]nocturne-limiter-mode['"]/);
  });

  it('bảo toàn bắt buộc cho index-script.test.cjs: state.limiter = createSoftLimiter(state.context)', () => {
    assert.match(html, /state\.limiter = createSoftLimiter\(state\.context\)/);
  });

  it('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.match(html, /state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/);
  });
});
