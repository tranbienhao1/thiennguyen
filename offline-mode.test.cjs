'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: isOnlineState ──

describe('isOnlineState', () => {
  it('nhận diện đúng khi thiết bị có kết nối mạng', () => {
    assert.equal(library.isOnlineState({ onLine: true }), true);
  });

  it('nhận diện đúng khi thiết bị mất mạng (offline)', () => {
    assert.equal(library.isOnlineState({ onLine: false }), false);
  });

  it('xử lý an toàn khi đối tượng navigator không xác định hoặc null', () => {
    assert.equal(library.isOnlineState(null), true);
    assert.equal(library.isOnlineState(undefined), true);
    assert.equal(library.isOnlineState({}), true);
  });
});

// ── 2. Unit tests: formatNetworkStatus ──

describe('formatNetworkStatus', () => {
  it('định dạng đúng thông tin trạng thái online', () => {
    const res = library.formatNetworkStatus(true);
    assert.equal(res.online, true);
    assert.equal(res.status, 'online');
    assert.equal(res.label, 'Trực tuyến');
    assert.match(res.message, /Đã kết nối Internet/);
  });

  it('định dạng đúng thông tin trạng thái offline', () => {
    const res = library.formatNetworkStatus(false);
    assert.equal(res.online, false);
    assert.equal(res.status, 'offline');
    assert.equal(res.label, 'Ngoại tuyến');
    assert.match(res.message, /ngắt kết nối mạng/);
  });
});

// ── 3. Unit tests: canPlayOffline ──

describe('canPlayOffline', () => {
  it('bài hát local luôn có thể phát ngoại tuyến', () => {
    assert.equal(library.canPlayOffline({ source: 'local', title: 'Local Song' }), true);
  });

  it('bài hát cloud đã có File hoặc Blob trong bộ nhớ phát được ngoại tuyến', () => {
    assert.equal(library.canPlayOffline({ source: 'google', file: new Uint8Array([1, 2, 3]) }), true);
    assert.equal(library.canPlayOffline({ source: 'microsoft', blob: new Uint8Array([1, 2, 3]) }), true);
  });

  it('bài hát cloud đã có lát đầu hoặc cache IndexedDB phát được ngoại tuyến', () => {
    assert.equal(library.canPlayOffline({ source: 'google', hasCachedSlice: true }), true);
    assert.equal(library.canPlayOffline({ source: 'microsoft', firstSliceCached: true }), true);
  });

  it('bài hát cloud chưa tải và chưa cache không thể phát ngoại tuyến', () => {
    assert.equal(library.canPlayOffline({ source: 'google', id: 'drive-123' }), false);
    assert.equal(library.canPlayOffline({ source: 'microsoft', id: 'onedrive-456' }), false);
  });

  it('xử lý an toàn khi tham số null hoặc rỗng', () => {
    assert.equal(library.canPlayOffline(null), false);
    assert.equal(library.canPlayOffline(undefined), false);
    assert.equal(library.canPlayOffline({}), false);
  });
});

// ── 4. DOM & Script Integration Tests ──

describe('DOM & Script Integration: Network Status & Offline Mode', () => {
  it('thành phần #offline-banner và #offline-banner-text tồn tại trong HTML', () => {
    assert.match(html, /id=["']offline-banner["']/);
    assert.match(html, /id=["']offline-banner-text["']/);
    assert.match(html, /Ngoại tuyến · Chỉ phát nhạc cục bộ & bộ nhớ đệm/);
  });

  it('hàm updateNetworkStatus được định nghĩa trong script', () => {
    assert.match(html, /function updateNetworkStatus\(/);
  });

  it('lắng nghe sự kiện online và offline trên window', () => {
    assert.match(html, /window\.addEventListener\(['"]online['"]/);
    assert.match(html, /window\.addEventListener\(['"]offline['"]/);
  });

  it('playTrack tích hợp kiểm tra canPlayOffline để báo lỗi thân thiện khi mất mạng', () => {
    assert.match(html, /canPlayOffline/);
    assert.match(html, /Đang ngoại tuyến/);
  });
});
