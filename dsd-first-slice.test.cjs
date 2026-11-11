'use strict';

// Pha B — Phòng nghe hiện thời gian giải mã DSD ngay khi lát PCM đầu
// phát được: worker gửi kèm sliceDecodeMs trong message 'first-slice',
// formatDecodeAudit hiện dòng "đang giải mã… lát đầu xong sau X" cho
// tới khi giải mã toàn file xong thì dòng tổng thay thế.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const workerSource = fs.readFileSync(path.join(__dirname, 'dsd-worker.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

function writeTag(view, offset, value) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}
function writeU64(view, offset, value, littleEndian) {
  view.setBigUint64(offset, BigInt(value), littleEndian);
}
// DSF DSD32 đủ dài để worker gửi lát đầu (~2 giây PCM) trước khi xong:
// target 44.1 kHz stereo 16-bit -> lát đầu = 44100*2*2*2 = 352800 byte
// PCM, cần sampleCount >= 352800*8 = 2822400 mẫu; lấy 3000000 cho chắc.
function makeLongDsf(rate = 1411200, blockSize = 4096, sampleCount = 3000000) {
  const channels = 2, dataOffset = 96, dataBytesPerChannel = Math.ceil(sampleCount / 8);
  const blocks = Math.ceil(dataBytesPerChannel / blockSize);
  const dataBytes = blocks * blockSize * channels;
  const buffer = new ArrayBuffer(dataOffset + 12 + dataBytes);
  const view = new DataView(buffer);
  writeTag(view, 0, 'DSD '); writeU64(view, 4, 28, true); writeU64(view, 12, buffer.byteLength, true);
  writeTag(view, 28, 'fmt '); writeU64(view, 32, 52, true);
  view.setUint32(40, 1, true); view.setUint32(44, 0, true); view.setUint32(48, 2, true);
  view.setUint32(52, channels, true); view.setUint32(56, rate, true); view.setUint32(60, 1, true);
  writeU64(view, 64, sampleCount, true); view.setUint32(72, blockSize, true); view.setUint32(76, 0, true);
  writeTag(view, 80, 'meta'); writeU64(view, 84, 16, true);
  writeTag(view, dataOffset, 'data'); writeU64(view, dataOffset + 4, 12 + dataBytes, true);
  for (let i = dataOffset + 12; i < dataOffset + 12 + dataBytes; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  return new Blob([buffer]);
}
function decodeAll(file, format, targetRate, bitDepth) {
  return new Promise((resolve, reject) => {
    const posted = [];
    const self = {
      cancelled: false,
      onmessage: null,
      postMessage(message) {
        posted.push(message);
        if (message.type === 'done') resolve(posted);
        else if (message.type === 'error') reject(new Error(message.message));
      }
    };
    const context = vm.createContext({self, Blob});
    vm.runInContext(workerSource, context, {filename: 'dsd-worker.js'});
    self.onmessage({data: {file, format, targetRate, bitDepth}});
  });
}

(async () => {
  // Worker phải đo thời gian giải mã lát đầu và gửi kèm message first-slice.
  assert.ok(workerSource.includes('sliceDecodeMs:nowMs()-startedAt'), 'DSD worker should measure the first-slice decode time from decode start');
  const posted = await decodeAll(makeLongDsf(), 'dsf', 44100, 16);
  const firstSlice = posted.find(message => message.type === 'first-slice');
  const done = posted.find(message => message.type === 'done');
  assert.ok(firstSlice, 'A long DSD file should emit a first-slice message before the full decode finishes');
  assert.ok(posted.indexOf(firstSlice) < posted.indexOf(done), 'The first slice should arrive before the done message');
  assert.ok(Number.isFinite(firstSlice.sliceDecodeMs) && firstSlice.sliceDecodeMs >= 0, 'The first-slice message should carry a measured decode time');
  assert.ok(firstSlice.sliceDecodeMs <= done.decodeMs, 'The first slice should take no longer to decode than the whole file');
  assert.ok(firstSlice.duration >= 2 && firstSlice.duration < 2.5, 'The first slice should hold about 2 seconds of PCM (at least the 2-second target, overshooting by at most one decode chunk)');
  assert.ok(Number.isFinite(done.decodeMs) && done.decodeMs > 0, 'The done message should still carry the total decode time');

  // formatDecodeAudit: dòng tổng không đổi; chưa có tổng thì hiện dòng lát đầu.
  const auditStart = appCode.indexOf('function formatDecodeAudit(decodeMs, maxChunkMs, chunksOverBudget, throughputMBps, initialChunkBytes, maxConsecutiveOverBudget, minSliceThroughputMBps, firstSliceMs) {');
  assert.ok(auditStart >= 0, 'DSD decode audit formatter should accept the first-slice decode time');
  const auditEnd = appCode.indexOf('function signalDescription(track) {', auditStart);
  assert.ok(auditEnd > auditStart, 'DSD decode audit formatter should be extractable for regression checks');
  const formatDecodeAudit = new Function(appCode.slice(auditStart, auditEnd) + '\nreturn formatDecodeAudit;')();
  assert.equal(formatDecodeAudit(1234, 34), 'giải mã 1.2 s · lát chậm nhất 34 ms', 'Slow DSD decode should show seconds and the slowest chunk');
  assert.equal(formatDecodeAudit(850, 12), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Fast DSD decode should show milliseconds');
  assert.equal(formatDecodeAudit(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 850), 'đang giải mã… lát đầu xong sau 850 ms', 'While the first DSD slice plays, the room should show how long that slice took to decode');
  assert.equal(formatDecodeAudit(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 2300), 'đang giải mã… lát đầu xong sau 2.3 s', 'A first slice slower than one second should use the seconds form');
  assert.equal(formatDecodeAudit(1234, 34, 0, 0, 0, 0, 0, 850), 'giải mã 1.2 s · lát chậm nhất 34 ms', 'Once the full decode finishes, the total audit should replace the first-slice line');
  assert.equal(formatDecodeAudit(undefined, undefined), '', 'Tracks decoded before the audit should show no audit line');
  assert.equal(formatDecodeAudit(undefined, undefined, undefined, undefined, undefined, undefined, undefined, -5), '', 'A negative first-slice time should hide the partial audit line');
  assert.equal(formatDecodeAudit(undefined, undefined, undefined, undefined, undefined, undefined, undefined, NaN), '', 'A missing first-slice time should hide the partial audit line');

  // Nối dây trong app: lưu sliceDecodeMs khi lát đầu tới, truyền vào audit,
  // xóa khi phát lại và khi giải mã xong để không hiện số đo cũ.
  assert.ok(appCode.includes('track.dsdFirstSliceMs = message.sliceDecodeMs'), 'The DSD first-slice handler should store the measured slice decode time on the track');
  assert.ok(appCode.includes(', track.dsdFirstSliceMs)'), 'Track detail should pass the first-slice decode time to the audit formatter');
  assert.ok((appCode.match(/track\.dsdFirstSliceMs = null/g) || []).length >= 2, 'The first-slice decode time should be cleared on replay and when the full decode finishes');
})();
