'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('formatStorageBytes - định dạng dung lượng bộ nhớ lưu trữ', async (t) => {
  await t.test('xử lý an toàn khi giá trị không hợp lệ hoặc <= 0', () => {
    assert.equal(library.formatStorageBytes(0), '0 B');
    assert.equal(library.formatStorageBytes(-100), '0 B');
    assert.equal(library.formatStorageBytes(NaN), '0 B');
    assert.equal(library.formatStorageBytes(null), '0 B');
  });

  await t.test('định dạng đúng các cấp dung lượng B, KB, MB, GB', () => {
    assert.equal(library.formatStorageBytes(512), '512 B');
    assert.equal(library.formatStorageBytes(2048), '2.0 KB');
    assert.equal(library.formatStorageBytes(15 * 1024 * 1024), '15.0 MB');
    assert.equal(library.formatStorageBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB');
  });
});

test('getStorageEstimate - truy vấn hạn ngạch lưu trữ trình duyệt', async (t) => {
  await t.test('xử lý an toàn khi navigator.storage không hỗ trợ', async () => {
    const res = await library.getStorageEstimate(null);
    assert.equal(res.supported, false);
    assert.equal(res.usage, 0);
    assert.equal(res.quota, 0);
    assert.equal(res.percent, 0);
    assert.equal(res.isLowSpace, false);
  });

  await t.test('tính toán chính xác phần trăm và định dạng dung lượng từ mock StorageManager', async () => {
    const mockSm = {
      estimate: async () => ({
        usage: 250 * 1024 * 1024, // 250 MB
        quota: 1000 * 1024 * 1024  // 1000 MB (1 GB)
      })
    };
    const res = await library.getStorageEstimate(mockSm);
    assert.equal(res.supported, true);
    assert.equal(res.usage, 250 * 1024 * 1024);
    assert.equal(res.quota, 1000 * 1024 * 1024);
    assert.equal(res.percent, 25);
    assert.equal(res.formattedUsage, '250.0 MB');
    assert.equal(res.formattedQuota, '1000.0 MB');
    assert.equal(res.isLowSpace, false);
  });

  await t.test('nhận diện cảnh báo khi bộ nhớ sắp đầy (isLowSpace: true)', async () => {
    const mockLowSpace = {
      estimate: async () => ({
        usage: 950 * 1024 * 1024,
        quota: 1000 * 1024 * 1024 // còn 50MB (< 100MB và >= 90%)
      })
    };
    const res = await library.getStorageEstimate(mockLowSpace);
    assert.equal(res.percent, 95);
    assert.equal(res.isLowSpace, true);
  });
});

test('auditOfflineStorage - kiểm toán tài nguyên nghe nhạc ngoại tuyến', async (t) => {
  const tracks = [
    { id: '1', title: 'Local Song', source: 'local' },
    { id: '2', title: 'Cloud Cached', source: 'google', file: new Uint8Array([1, 2, 3]) },
    { id: '3', title: 'Slice Cached', source: 'microsoft', firstSliceCached: true },
    { id: '4', title: 'Cloud Online Only', source: 'google' }
  ];

  await t.test('xử lý an toàn mảng rỗng hoặc null', () => {
    const res = library.auditOfflineStorage(null);
    assert.equal(res.totalTracks, 0);
    assert.equal(res.offlineTracks, 0);
    assert.equal(res.offlinePercent, 0);
  });

  await t.test('phân tích chính xác số lượng và tỷ lệ bài phát được ngoại tuyến', () => {
    const res = library.auditOfflineStorage(tracks);
    assert.equal(res.totalTracks, 4);
    assert.equal(res.offlineTracks, 3);
    assert.equal(res.offlinePercent, 75);
    assert.equal(res.localCount, 1);
    assert.equal(res.cachedCloudCount, 1);
    assert.equal(res.sliceCount, 1);
  });
});

test('Roon Focus Offline - tích hợp bộ lọc ngoại tuyến', async (t) => {
  const tracks = [
    { id: '1', title: 'Song 1', source: 'local' },
    { id: '2', title: 'Song 2', source: 'google', firstSliceCached: true },
    { id: '3', title: 'Song 3', source: 'google' }
  ];

  await t.test('filterTracksByFocus lọc chính xác các bài hát ngoại tuyến', () => {
    const offlineOnly = library.filterTracksByFocus(tracks, 'offline');
    assert.equal(offlineOnly.length, 2);
    assert.equal(offlineOnly[0].id, '1');
    assert.equal(offlineOnly[1].id, '2');
  });

  await t.test('countFocusCategories đếm đúng số lượng bài ngoại tuyến', () => {
    const counts = library.countFocusCategories(tracks);
    assert.equal(counts.offline, 2);
    assert.equal(counts.all, 3);
  });

  await t.test('formatFocusBadge trả về nhãn tiếng Việt chuẩn', () => {
    assert.equal(library.formatFocusBadge('offline'), 'Ngoại tuyến (Offline)');
  });
});

test('DOM & Script Integration: PWA Storage Quota & Offline Support', async (t) => {
  await t.test('các phần tử HTML quản lý hạn ngạch bộ nhớ tồn tại trong settings-modal', () => {
    assert.match(indexHtml, /id="storage-quota-section"/, 'Section quản lý storage phải tồn tại');
    assert.match(indexHtml, /id="storage-quota-badge"/, 'Badge trạng thái storage phải tồn tại');
    assert.match(indexHtml, /id="storage-usage-val"/, 'Hiển thị dung lượng đã dùng phải tồn tại');
    assert.match(indexHtml, /id="storage-quota-val"/, 'Hiển thị hạn ngạch phải tồn tại');
    assert.match(indexHtml, /id="storage-percent-val"/, 'Hiển thị phần trăm phải tồn tại');
    assert.match(indexHtml, /id="storage-progress-bar"/, 'Thanh tiến trình bộ nhớ phải tồn tại');
    assert.match(indexHtml, /id="refresh-storage-btn"/, 'Nút kiểm tra dung lượng phải tồn tại');
    assert.match(indexHtml, /id="prune-cache-btn"/, 'Nút dọn dẹp bộ đệm lát phải tồn tại');
  });

  await t.test('nút lọc Ngoại tuyến tồn tại trong #roon-focus-bar', () => {
    assert.match(indexHtml, /data-focus="offline"/, 'Focus button offline phải tồn tại');
    assert.match(indexHtml, /id="focus-count-offline"/, 'Thẻ đếm số lượng offline phải tồn tại');
  });

  await t.test('hàm updateStorageQuotaDisplay được khai báo trong script', () => {
    assert.ok(indexHtml.includes('async function updateStorageQuotaDisplay('), 'updateStorageQuotaDisplay phải được khai báo');
    assert.ok(indexHtml.includes('library.getStorageEstimate'), 'updateStorageQuotaDisplay phải gọi library.getStorageEstimate');
  });

  await t.test('click vào #offline-banner chuyển đổi nhanh bộ lọc ngoại tuyến', () => {
    assert.ok(indexHtml.includes("$('offline-banner')?.addEventListener('click'"), 'Banner offline phải hỗ trợ click để lọc bài');
  });

  await t.test('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến đồ thị âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên'
    );
  });
});
