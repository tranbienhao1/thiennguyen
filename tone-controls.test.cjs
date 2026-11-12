'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: clampToneGain ──

describe('clampToneGain', () => {
  it('kẹp giá trị vượt quá giới hạn ±6 dB', () => {
    assert.equal(library.clampToneGain(-10), -6);
    assert.equal(library.clampToneGain(12), 6);
    assert.equal(library.clampToneGain(-6), -6);
    assert.equal(library.clampToneGain(6), 6);
  });

  it('làm tròn về bước nhảy 0.5 dB', () => {
    assert.equal(library.clampToneGain(2.2), 2);
    assert.equal(library.clampToneGain(2.3), 2.5);
    assert.equal(library.clampToneGain(-1.8), -2);
    assert.equal(library.clampToneGain(0.24), 0);
  });

  it('xử lý an toàn khi giá trị không phải số hoặc NaN', () => {
    assert.equal(library.clampToneGain(NaN), 0);
    assert.equal(library.clampToneGain(null), 0);
    assert.equal(library.clampToneGain(undefined), 0);
    assert.equal(library.clampToneGain('invalid'), 0);
  });
});

// ── 2. Unit tests: formatToneGain ──

describe('formatToneGain', () => {
  it('định dạng đúng số 0 là 0 dB', () => {
    assert.equal(library.formatToneGain(0), '0 dB');
    assert.equal(library.formatToneGain(0.01), '0 dB');
    assert.equal(library.formatToneGain(-0.01), '0 dB');
  });

  it('định dạng đúng số dương với dấu cộng', () => {
    assert.equal(library.formatToneGain(3), '+3.0 dB');
    assert.equal(library.formatToneGain(2.5), '+2.5 dB');
  });

  it('định dạng đúng số âm với dấu trừ', () => {
    assert.equal(library.formatToneGain(-2), '-2.0 dB');
    assert.equal(library.formatToneGain(-4.5), '-4.5 dB');
  });
});

// ── 3. Unit tests: formatToneSummary ──

describe('formatToneSummary', () => {
  it('trả về 0 dB khi cả bass và treble đều bằng 0', () => {
    assert.equal(library.formatToneSummary(0, 0), '0 dB');
  });

  it('tổng hợp đúng khi chỉ có bass', () => {
    assert.equal(library.formatToneSummary(3, 0), 'Bass +3.0 dB');
  });

  it('tổng hợp đúng khi chỉ có treble', () => {
    assert.equal(library.formatToneSummary(0, -2.5), 'Treble -2.5 dB');
  });

  it('tổng hợp đúng cả hai kênh bass và treble', () => {
    assert.equal(library.formatToneSummary(2, -1.5), 'Bass +2.0 dB · Treble -1.5 dB');
  });
});

// ── 4. Unit tests: computeSignalPath with Tone Controls ──

describe('computeSignalPath with Tone Controls', () => {
  it('hiển thị thông tin Âm sắc trong DSP Stage khi có can thiệp', () => {
    const track = { format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2 };
    const pathData = library.computeSignalPath(track, {
      toneBass: 2.5,
      toneTreble: -1.0
    });
    assert.equal(pathData.hasDsp, true);
    assert.equal(pathData.steps[2].isEnhanced, true);
    assert.match(pathData.steps[2].description, /Âm sắc: Bass \+2\.5 dB · Treble -1\.0 dB/);
  });

  it('giữ nguyên Bit-perfect khi cả bass và treble bằng 0', () => {
    const track = { format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2 };
    const pathData = library.computeSignalPath(track, {
      toneBass: 0,
      toneTreble: 0
    });
    assert.equal(pathData.hasDsp, false);
    assert.equal(pathData.steps[2].badge, 'Bit-perfect');
  });
});

// ── 5. DOM & Script Integration Tests ──

describe('DOM & Script Integration: Tone Controls', () => {
  it('các thành phần UI của Tone Controls tồn tại trong #eq-panel', () => {
    assert.match(html, /id=["']tone-bass-slider["']/);
    assert.match(html, /id=["']tone-treble-slider["']/);
    assert.match(html, /id=["']tone-bass-val["']/);
    assert.match(html, /id=["']tone-treble-val["']/);
    assert.match(html, /id=["']tone-summary-label["']/);
    assert.match(html, /id=["']tone-bass-reset["']/);
    assert.match(html, /id=["']tone-treble-reset["']/);
  });

  it('các hàm quản lý Tone Controls được khai báo trong script', () => {
    assert.match(html, /function createToneNodes\(/);
    assert.match(html, /function applyToneControls\(/);
    assert.match(html, /function setToneBass\(/);
    assert.match(html, /function setToneTreble\(/);
    assert.match(html, /function resetToneControls\(/);
  });

  it('state khởi tạo toneBass, toneTreble và toneNodes', () => {
    assert.match(html, /toneBass:\s*0/);
    assert.match(html, /toneTreble:\s*0/);
    assert.match(html, /toneNodes:\s*null/);
  });

  it('giá trị Tone Controls được lưu và nạp từ localStorage', () => {
    assert.match(html, /nocturne-tone-bass/);
    assert.match(html, /nocturne-tone-treble/);
  });
});
