'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

// ── 1. Unit tests cho extractDominantColors ──

describe('extractDominantColors', () => {
  it('trả về mảng rỗng nếu tất cả pixel quá tối', () => {
    // 2x2 pixel, toàn đen (luminance < 25)
    const data = new Uint8ClampedArray([
      10, 10, 10, 255, 5, 5, 5, 255,
      0, 0, 0, 255, 15, 15, 15, 255
    ]);
    const result = library.extractDominantColors(data, 2, 2, 3);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('trả về mảng rỗng nếu tất cả pixel quá sáng', () => {
    const data = new Uint8ClampedArray([
      250, 250, 250, 255, 240, 240, 240, 255,
      255, 255, 255, 255, 245, 245, 245, 255
    ]);
    const result = library.extractDominantColors(data, 2, 2, 3);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('trích xuất đúng màu chủ đạo từ pixel đồng nhất', () => {
    // 4 pixel cùng màu xanh dương trung bình
    const data = new Uint8ClampedArray([
      60, 90, 160, 255, 60, 90, 160, 255,
      60, 90, 160, 255, 60, 90, 160, 255
    ]);
    const result = library.extractDominantColors(data, 2, 2, 3);
    assert.ok(result.length >= 1);
    // Phải trả về khoảng [60, 90, 160]
    const [r, g, b] = result[0];
    assert.ok(Math.abs(r - 60) <= 2);
    assert.ok(Math.abs(g - 90) <= 2);
    assert.ok(Math.abs(b - 160) <= 2);
  });

  it('sắp xếp theo tần suất giảm dần', () => {
    // 3 pixel đỏ, 1 pixel xanh lá → đỏ phải đứng đầu
    const data = new Uint8ClampedArray([
      180, 50, 50, 255, 180, 50, 50, 255,
      180, 50, 50, 255, 50, 160, 50, 255
    ]);
    const result = library.extractDominantColors(data, 2, 2, 3);
    assert.ok(result.length >= 1);
    // Màu đầu tiên phải gần đỏ (r > g, r > b)
    assert.ok(result[0][0] > result[0][1]);
    assert.ok(result[0][0] > result[0][2]);
  });

  it('bỏ qua pixel trong suốt (alpha < 128)', () => {
    const data = new Uint8ClampedArray([
      100, 50, 50, 50, 100, 50, 50, 50,    // alpha = 50 → bỏ qua
      50, 100, 150, 255, 50, 100, 150, 255   // alpha = 255 → giữ
    ]);
    const result = library.extractDominantColors(data, 2, 2, 2);
    assert.ok(result.length >= 1);
    // Chỉ có pixel xanh (50,100,150) được đếm
    assert.ok(result[0][2] > result[0][0]); // b > r
  });

  it('giới hạn kết quả theo count', () => {
    // 3 nhóm màu khác nhau
    const data = new Uint8ClampedArray([
      180, 50, 50, 255,  // đỏ
      50, 180, 50, 255,  // xanh lá
      50, 50, 180, 255,  // xanh dương
      180, 50, 50, 255   // đỏ (lặp)
    ]);
    const result = library.extractDominantColors(data, 2, 2, 2);
    assert.ok(result.length <= 2);
  });

  it('xử lý tốt mảng rỗng (0x0)', () => {
    const result = library.extractDominantColors(new Uint8ClampedArray([]), 0, 0, 3);
    assert.deepEqual(result, []);
  });
});

// ── 2. Kiểm tra HTML có các element cần thiết ──

describe('Ambient Glow DOM elements', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  it('có element #ambient-glow trong listening-room', () => {
    assert.ok(html.includes('id="ambient-glow"'));
  });

  it('có CSS cho #ambient-glow', () => {
    assert.ok(html.includes('#ambient-glow'));
    assert.ok(html.includes('#ambient-glow.active'));
  });

  it('có hàm applyAmbientGlow trong script', () => {
    assert.ok(html.includes('function applyAmbientGlow'));
  });

  it('displayTrack gọi applyAmbientGlow', () => {
    assert.ok(html.includes('applyAmbientGlow(track)'));
  });
});

// ── 3. Kiểm tra extractDominantColors được export ──

describe('library-utils exports', () => {
  it('xuất extractDominantColors', () => {
    assert.equal(typeof library.extractDominantColors, 'function');
  });
});
