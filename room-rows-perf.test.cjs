'use strict';

// Pha D — hiển thị số đo render danh sách trong Phòng nghe khi danh sách
// quá chậm: renderTrackRows đã ghi mili-giây/số hàng/đường nhẹ vào
// state.lastTrackRowsMs/Count/Skipped từ lần đo hiệu năng trước, nhưng
// chưa hiện ở đâu cho người dùng thấy. Bản sửa thêm trackRowsPerfText:
// chỉ trả dòng "danh sách N bài dựng lại trong X ms" khi lần dựng lại
// gần nhất từ 100 ms trở lên (đường nhẹ và render nhanh thì ẩn để không
// làm rối dòng tín hiệu), và renderRoomSignal gắn dòng đó vào cuối tín
// hiệu Phòng nghe.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

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

// Nối dây tĩnh: helper phải tồn tại và Phòng nghe phải gắn dòng số đo.
assert.ok(appCode.includes('function trackRowsPerfText()'), 'trackRowsPerfText should be defined in the app script');
assert.ok(appCode.includes('trackRowsPerfText()'), 'The room signal should include the track-rows render measurement');

const trackRowsPerfTextSource = extractFunction(appCode, 'trackRowsPerfText');
function perfTextFor(state) {
  return new Function('state', `${trackRowsPerfTextSource}\nreturn trackRowsPerfText;`)(state)();
}

// Chưa có số đo thì không hiện gì.
{
  const state = {};
  assert.equal(perfTextFor(state), '', 'Without any render measurement the room signal should show nothing');
}

// Render nhanh (7 ms, 2000 bài) thì không hiện.
{
  const state = {lastTrackRowsMs: 7, lastTrackRowsCount: 2000, lastTrackRowsSkipped: false};
  assert.equal(perfTextFor(state), '', 'A fast full rebuild should not clutter the room signal');
}

// Dựng lại chậm (150 ms, 2000 bài) thì hiện đúng số đo.
{
  const state = {lastTrackRowsMs: 150, lastTrackRowsCount: 2000, lastTrackRowsSkipped: false};
  assert.equal(perfTextFor(state), 'danh sách 2000 bài dựng lại trong 150 ms', 'A slow full rebuild should show the row count and milliseconds');
}

// Ngưỡng 100 ms: đúng 100 ms thì hiện, 99 ms thì không.
{
  const atThreshold = {lastTrackRowsMs: 100, lastTrackRowsCount: 500, lastTrackRowsSkipped: false};
  assert.equal(perfTextFor(atThreshold), 'danh sách 500 bài dựng lại trong 100 ms', 'A rebuild at exactly the 100 ms threshold should show');
  const belowThreshold = {lastTrackRowsMs: 99, lastTrackRowsCount: 500, lastTrackRowsSkipped: false};
  assert.equal(perfTextFor(belowThreshold), '', 'A rebuild just below the threshold should not show');
}

// Đường nhẹ dù chậm cũng không hiện: nó không dựng lại nên không phải
// nguyên nhân làm chậm giao diện.
{
  const state = {lastTrackRowsMs: 250, lastTrackRowsCount: 2000, lastTrackRowsSkipped: true};
  assert.equal(perfTextFor(state), '', 'The light path should never show even with a large recorded time');
}

// Dữ liệu biên: số hàng 0, ms không phải số, thiếu trường đều ẩn.
{
  assert.equal(perfTextFor({lastTrackRowsMs: 150, lastTrackRowsCount: 0, lastTrackRowsSkipped: false}), '', 'Zero rows should not show');
  assert.equal(perfTextFor({lastTrackRowsMs: NaN, lastTrackRowsCount: 2000, lastTrackRowsSkipped: false}), '', 'A non-numeric measurement should not show');
  assert.equal(perfTextFor({lastTrackRowsMs: 150, lastTrackRowsSkipped: false}), '', 'A missing row count should not show');
  assert.equal(perfTextFor({lastTrackRowsMs: 150.6, lastTrackRowsCount: 2000, lastTrackRowsSkipped: false}), 'danh sách 2000 bài dựng lại trong 151 ms', 'Milliseconds should round to whole numbers');
}

console.log('room-rows-perf: all assertions passed');
