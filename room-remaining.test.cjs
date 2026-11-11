'use strict';

// Pha B — hiển thị thời gian còn lại của bài trong Phòng nghe: nhãn
// '-m:ss' cạnh tổng thời lượng, cập nhật mỗi giây cùng nhãn đã phát,
// khi đổi bài, khi metadata về và khi kéo thanh tua để xem trước.
// (Lượt kế tiếp trong AUTO-SCHEDULE LOG 16:23.)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

// Nối dây tĩnh: phần tử còn lại phải tồn tại, helper phải có, và mọi
// nơi cập nhật thời gian trong Phòng nghe đều cập nhật cả nhãn còn lại.
assert.match(html, /id="room-remaining"/, 'The listening room should show the remaining time next to the total duration');
assert.ok(appCode.includes('const formatRemainingTime = '), 'formatRemainingTime should be defined next to formatTime');
assert.ok(appCode.includes(`$('room-remaining').textContent = formatRemainingTime(0, track.duration)`), 'Switching tracks should reset the remaining time from the known duration');
assert.ok(appCode.includes(`$('room-remaining').textContent = formatRemainingTime(element.currentTime, element.duration)`), 'The timeupdate and loadedmetadata handlers should refresh the remaining time');
assert.ok(appCode.includes(`$('room-remaining').textContent = formatRemainingTime(previewTime, audio.duration)`), 'Scrubbing the room seek bar should preview the remaining time');

// Hành vi thật của helper: chạy trực tiếp formatTime + formatRemainingTime
// trích từ app (không sao chép lại công thức vào test).
const formatTimeSrc = appCode.match(/const formatTime = [^;]+;/);
const formatRemainingSrc = appCode.match(/const formatRemainingTime = [^;]+;/);
assert.ok(formatTimeSrc && formatRemainingSrc, 'Both time formatters should be extractable from the app script');
function remaining(current, duration) {
  return vm.runInNewContext(`${formatTimeSrc[0]}\n${formatRemainingSrc[0]}\nformatRemainingTime(${current}, ${duration});`, {});
}
assert.equal(remaining(0, 197), '-3:17');
assert.equal(remaining(12.96, 197), '-3:04');
assert.equal(remaining(196.9, 197), '-0:00');
assert.equal(remaining(197, 197), '-0:00');
assert.equal(remaining(200, 197), '-0:00');
assert.equal(remaining(0, 0), '—');
assert.equal(remaining(0, NaN), '—');
assert.equal(remaining(0, undefined), '—');
assert.equal(remaining(NaN, 197), '-3:17');
