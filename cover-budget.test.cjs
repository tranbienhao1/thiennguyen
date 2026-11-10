'use strict';

// Pha C — tổng ngân sách ảnh bìa catalog cloud trong IndexedDB:
// pruneCloudCatalog sau mỗi lần ghi phải đặt cover = null cho các mục cũ
// nhất vượt 8 MiB ký tự, đồng thời không ghi lại mục vừa xóa vì quá hạn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.ok(appCode.includes('library.capCatalogCovers(all, library.MAX_CATALOG_COVER_TOTAL_CHARS)'), 'pruneCloudCatalog should cap total catalog cover art');
assert.ok(appCode.includes('for (const entry of changed) store.put(entry);'), 'pruneCloudCatalog should write back entries whose cover was capped');
assert.ok(appCode.includes('!staleSet.has(entry.id)'), 'pruneCloudCatalog should not re-insert entries deleted as stale');

// Trích một khai báo function top-level bằng cách đếm dấu ngoặc nhọn.
function extractFunction(code, name) {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should be defined in the app script`);
  const brace = code.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

function fakeStore(initialRows) {
  const tx = {oncomplete: null, onerror: null};
  const store = {
    transaction: tx,
    _rows: initialRows.map(row => ({...row})),
    getAll() {
      const request = {result: null, onsuccess: null, onerror: null};
      queueMicrotask(() => {
        request.result = store._rows.slice();
        if (request.onsuccess) request.onsuccess();
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
      });
      return request;
    },
    delete(id) { store._rows = store._rows.filter(row => row.id !== id); },
    put(entry) {
      const index = store._rows.findIndex(row => row.id === entry.id);
      if (index >= 0) store._rows[index] = {...entry};
      else store._rows.push({...entry});
    }
  };
  return store;
}

const dataCover = size => `data:image/jpeg;base64,${'x'.repeat(size)}`;

async function runPrune(rows) {
  const store = fakeStore(rows);
  const context = vm.createContext({library, catalogTransaction: () => store, Promise, console});
  const source = extractFunction(appCode, 'pruneCloudCatalog');
  vm.runInContext(source, context, {filename: 'pruneCloudCatalog.js'});
  await vm.runInContext('pruneCloudCatalog()', context, {filename: 'pruneCloudCatalog.call.js'});
  return store._rows;
}

(async () => {
  // Tổng 3 ảnh 3 MiB vượt ngân sách 8 MiB: chỉ ảnh cũ nhất bị bỏ.
  const rows = await runPrune([
    {id: 'old', savedAt: 1, cover: dataCover(3 * 1024 * 1024)},
    {id: 'mid', savedAt: 2, cover: dataCover(3 * 1024 * 1024)},
    {id: 'new', savedAt: 3, cover: dataCover(3 * 1024 * 1024)},
    {id: 'web', savedAt: 4, cover: 'https://coverartarchive.org/x.jpg'}
  ]);
  assert.strictEqual(rows.length, 4, 'Capping covers should not delete entries');
  assert.strictEqual(rows.find(row => row.id === 'old').cover, null, 'The oldest cover should be dropped when the total exceeds 8 MiB');
  assert.ok(rows.find(row => row.id === 'mid').cover, 'The middle cover should be kept within budget');
  assert.ok(rows.find(row => row.id === 'new').cover, 'The newest cover should be kept within budget');
  assert.strictEqual(rows.find(row => row.id === 'web').cover, 'https://coverartarchive.org/x.jpg', 'An https cover URL should survive capping');

  // 1001 mục × ~9 KiB ảnh vượt cả giới hạn 1000 mục lẫn ngân sách 8 MiB:
  // mục cũ nhất bị xóa hẳn, các mục cũ tiếp theo chỉ mất ảnh, không bị ghi lại.
  const many = Array.from({length: 1001}, (_, index) => ({id: `track-${index}`, savedAt: index, cover: dataCover(9000)}));
  const pruned = await runPrune(many);
  assert.strictEqual(pruned.length, 1000, 'The oldest entry should be deleted and never re-inserted');
  assert.ok(!pruned.some(row => row.id === 'track-0'), 'The stale entry should stay deleted');
  const keptChars = pruned.reduce((sum, row) => sum + (typeof row.cover === 'string' && row.cover.startsWith('data:image') ? row.cover.length : 0), 0);
  assert.ok(keptChars <= library.MAX_CATALOG_COVER_TOTAL_CHARS, `Kept covers should fit the 8 MiB budget (got ${keptChars})`);
  assert.strictEqual(pruned.find(row => row.id === 'track-1').cover, null, 'The next-oldest covers should be dropped, not the entries');
  assert.ok(pruned.find(row => row.id === 'track-1000').cover, 'The newest cover should be kept');
})().catch(error => { console.error(error); process.exit(1); });
