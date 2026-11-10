'use strict';

// Pha C — siết catalog cloud khi khôi phục từ IndexedDB: restore chỉ nạp
// 1000 mục mới nhất và bỏ ảnh bìa cũ vượt ngân sách 8 MiB trước khi đưa
// vào RAM, rồi dọn kho ở nền nếu có gì bị lọc bỏ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.ok(appCode.includes('const restoredCatalog = library.prepareRestoredCatalog(entries);'), 'restoreCloudCatalog should filter the catalog through prepareRestoredCatalog before loading it into memory');
assert.ok(appCode.includes('for (const entry of usable) {'), 'restoreCloudCatalog should iterate only the filtered entries');
assert.ok(appCode.includes('if (restoredCatalog.changed) pruneCloudCatalog();'), 'restoreCloudCatalog should clean the store in the background when filtering dropped anything');

const dataCover = size => `data:image/jpeg;base64,${'x'.repeat(size)}`;
const entry = (id, savedAt, coverSize) => ({id, savedAt, cover: coverSize ? dataCover(coverSize) : null});

// Catalog trong giới hạn: giữ nguyên, không cần dọn kho.
{
  const rows = [entry('a', 1, 1000), entry('b', 2, 1000), entry('c', 3, null)];
  const result = library.prepareRestoredCatalog(rows);
  assert.strictEqual(result.entries.length, 3, 'A catalog within limits should be restored whole');
  assert.strictEqual(result.changed, false, 'A catalog within limits should not trigger a background store prune');
  assert.deepEqual(result.entries.map(item => item.id), ['a', 'b', 'c'], 'Restore should keep the original entry order');
}

// 1001 mục × ~9 KiB ảnh vượt cả giới hạn 1000 mục lẫn ngân sách 8 MiB:
// mục cũ nhất bị bỏ hẳn, các mục cũ tiếp theo chỉ mất ảnh.
{
  const many = Array.from({length: 1001}, (_, index) => entry(`track-${index}`, index, 9000));
  const result = library.prepareRestoredCatalog(many);
  assert.strictEqual(result.entries.length, 1000, 'Restore should keep at most 1000 entries');
  assert.ok(!result.entries.some(row => row.id === 'track-0'), 'The oldest entry should be skipped on restore');
  assert.strictEqual(result.changed, true, 'Skipping stale entries should trigger a background store prune');
  const keptChars = result.entries.reduce((sum, row) => sum + (typeof row.cover === 'string' && row.cover.startsWith('data:image') ? row.cover.length : 0), 0);
  assert.ok(keptChars <= library.MAX_CATALOG_COVER_TOTAL_CHARS, `Kept covers should fit the 8 MiB budget (got ${keptChars})`);
  assert.strictEqual(result.entries.find(row => row.id === 'track-1').cover, null, 'The next-oldest covers should be dropped, not the entries');
  assert.ok(result.entries.find(row => row.id === 'track-1000').cover, 'The newest cover should be kept');
}

// Tổng 3 ảnh 3 MiB vượt ngân sách 8 MiB: chỉ ảnh cũ nhất bị bỏ, mục vẫn nạp.
{
  const rows = [entry('old', 1, 3 * 1024 * 1024), entry('mid', 2, 3 * 1024 * 1024), entry('new', 3, 3 * 1024 * 1024)];
  const result = library.prepareRestoredCatalog(rows);
  assert.strictEqual(result.entries.length, 3, 'Dropping a cover should not drop its entry');
  assert.strictEqual(result.entries.find(row => row.id === 'old').cover, null, 'The oldest cover should be dropped when the total exceeds 8 MiB');
  assert.ok(result.entries.find(row => row.id === 'new').cover, 'The newest cover should be kept');
  assert.strictEqual(result.changed, true, 'Dropping a cover should trigger a background store prune');
}

// Dữ liệu biên: không phải mảng, mục thiếu id, mục null.
assert.deepEqual(library.prepareRestoredCatalog(null), {entries: [], changed: false}, 'A non-array catalog should restore as empty without a prune');
assert.deepEqual(library.prepareRestoredCatalog('not-an-array'), {entries: [], changed: false}, 'A non-array catalog should restore as empty without a prune');
{
  const rows = [entry('ok', 1, 100), null, {savedAt: 2, cover: dataCover(100)}, {id: '', savedAt: 3}];
  const result = library.prepareRestoredCatalog(rows);
  assert.deepEqual(result.entries.map(item => item.id), ['ok'], 'Entries without a usable id should be skipped on restore');
  assert.strictEqual(result.changed, true, 'Skipping invalid entries should trigger a background store prune');
}
