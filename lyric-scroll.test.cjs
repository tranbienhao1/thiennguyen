'use strict';

// Pha B — chỉ tự cuộn dòng lời đang hát khi nó nằm ngoài khung nhìn của
// panel lời: dòng đã hiện đủ thì giữ nguyên vị trí cuộn do người dùng
// chọn (đọc trước/sau), tránh scrollIntoView giật khung mỗi lần đổi dòng.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utils = require('./library-utils.js');
new vm.Script(fs.readFileSync(path.join(__dirname, 'library-utils.js'), 'utf8'), {filename: 'library-utils.js'});
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const rect = (top, bottom) => ({top, bottom, left: 0, right: 100, width: 100, height: bottom - top});

// Dòng nằm gọn trong khung nhìn thì không cuộn.
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(150, 178)), false);
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(100, 128)), false, 'Dòng chạm đúng mép trên vẫn tính là đang hiện');
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(272, 300)), false, 'Dòng chạm đúng mép dưới vẫn tính là đang hiện');
// Dòng thò ra ngoài khung nhìn thì cuộn.
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(90, 118)), true);
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(290, 318)), true);
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(310, 338)), true);
// Dòng cao hơn cả khung nhìn thì cuộn để căn giữa.
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(50, 350)), true);
// Rect bẩn thì không cuộn (không ném lỗi, không giật khung).
assert.equal(utils.shouldScrollLyricIntoView(null, rect(150, 178)), false);
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), null), false);
assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), {top: NaN, bottom: 178}), false);
assert.equal(utils.shouldScrollLyricIntoView(rect(300, 300), rect(150, 178)), false, 'Khung nhìn rỗng (top == bottom) thì không cuộn');

// Nối vào giao diện: updateLyricsHighlight chỉ gọi scrollIntoView khi
// dòng đang hát nằm ngoài khung nhìn, không gọi vô điều kiện mỗi lần đổi dòng.
assert.ok(appCode.includes('function updateLyricsHighlight()'), 'Lyrics highlight updater should exist');
assert.ok(appCode.includes('library.shouldScrollLyricIntoView(container.getBoundingClientRect(), activeRow.getBoundingClientRect())'), 'Highlight should ask the helper whether the active line is outside the lyrics viewport');
assert.ok(!appCode.includes("rows[index].scrollIntoView({block: 'center'});"), 'Highlight should no longer scroll unconditionally on every line change');
