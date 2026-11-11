'use strict';

// Pha D — kiểm toán bộ giải mã DSD: file DSF/DFF bị cắt cụt hoặc khai
// chunk lớn hơn file thật phải báo lỗi rõ ràng (message 'error') thay vì
// treo worker, giải mã ra PCM sai, hoặc phát tiếng rè rồi mới lỗi.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const workerSource = fs.readFileSync(path.join(__dirname, 'dsd-worker.js'), 'utf8');

function writeTag(view, offset, value) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function makeDsf(sampleCount, dataBytesPerChannel) {
  const channels = 2, dataOffset = 96;
  const blocks = Math.ceil(dataBytesPerChannel / 4096);
  const dataBytes = blocks * 4096 * channels;
  const buffer = new ArrayBuffer(dataOffset + 12 + dataBytes);
  const view = new DataView(buffer);
  writeTag(view, 0, 'DSD '); view.setBigUint64(4, 28n, true); view.setBigUint64(12, BigInt(buffer.byteLength), true);
  writeTag(view, 28, 'fmt '); view.setBigUint64(32, 52n, true);
  view.setUint32(40, 1, true); view.setUint32(44, 0, true); view.setUint32(48, 2, true);
  view.setUint32(52, channels, true); view.setUint32(56, 2822400, true); view.setUint32(60, 1, true);
  view.setBigUint64(64, BigInt(sampleCount), true); view.setUint32(72, 4096, true); view.setUint32(76, 0, true);
  writeTag(view, 80, 'meta'); view.setBigUint64(84, 16n, true);
  writeTag(view, dataOffset, 'data'); view.setBigUint64(dataOffset + 4, BigInt(12 + dataBytes), true);
  for (let i = dataOffset + 12; i < dataOffset + 12 + dataBytes; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  return new Blob([buffer]);
}

function makeDff(dataBytesPerChannel, overrides = {}) {
  const channels = 2, rate = 2822400;
  const dataBytes = dataBytesPerChannel * channels;
  // PROP: 'SND ' + FS (12+4) + CHNL (12+2) + CMPR (12+4) = 50 byte.
  const propSize = 4 + 16 + 14 + 16;
  const propEnd = 16 + 12 + propSize;
  const dsdHeader = propEnd, dataOffset = dsdHeader + 12;
  const totalSize = dataOffset + dataBytes;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  writeTag(view, 0, 'FRM8');
  view.setBigUint64(4, BigInt(overrides.frm8Size !== undefined ? overrides.frm8Size : totalSize - 12), false);
  writeTag(view, 12, 'DSD ');
  writeTag(view, 16, 'PROP'); view.setBigUint64(20, BigInt(propSize), false);
  writeTag(view, 28, 'SND ');
  writeTag(view, 32, 'FS  '); view.setBigUint64(36, 4n, false); view.setUint32(44, rate, false);
  writeTag(view, 48, 'CHNL'); view.setBigUint64(52, 2n, false); view.setUint16(60, channels, false);
  writeTag(view, 62, 'CMPR'); view.setBigUint64(66, 4n, false); writeTag(view, 74, 'DSD ');
  writeTag(view, dsdHeader, 'DSD ');
  view.setBigUint64(dsdHeader + 4, BigInt(overrides.dsdChunkSize !== undefined ? overrides.dsdChunkSize : dataBytes), false);
  for (let i = dataOffset; i < dataOffset + dataBytes; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  return new Blob([buffer]);
}

function decode(file, format) {
  return new Promise((resolve, reject) => {
    const posted = [];
    const self = {
      cancelled: false,
      onmessage: null,
      postMessage(message) {
        posted.push(message);
        if (message.type === 'done') resolve(posted);
        else if (message.type === 'error') reject(new Error(message.message));
      },
    };
    const context = vm.createContext({self, Blob});
    vm.runInContext(workerSource, context, {filename: 'dsd-worker.js'});
    self.onmessage({data: {file, format, targetRate: 44100, bitDepth: 16}});
    setTimeout(() => reject(new Error(`Worker timed out after messages: ${posted.map(m => m.type).join(',') || 'none'}`)), 5000);
  });
}

(async () => {
  // Đối chứng: file DSF/DFF nguyên vẹn vẫn giải mã xong bình thường.
  const dsfDone = await decode(makeDsf(300000, Math.ceil(300000 / 8)), 'dsf');
  assert.equal(dsfDone.at(-1).type, 'done', 'A complete DSF should still decode to done');
  const dffDone = await decode(makeDff(4096), 'dff');
  assert.equal(dffDone.at(-1).type, 'done', 'A complete DFF should still decode to done');
  assert.ok(dffDone.at(-1).duration > 0, 'A complete DFF should report a positive duration');

  // DSF bị cắt giữa chunk data: header vẫn khai đủ kích thước.
  const fullDsf = makeDsf(300000, Math.ceil(300000 / 8));
  const cutDsf = fullDsf.slice(0, 96 + 12 + 8192);
  await assert.rejects(decode(cutDsf, 'dsf'), /Chunk DSF bị cắt hoặc vượt quá kích thước file/, 'A DSF cut inside its data chunk should report the truncation');

  // DSF khai sampleCount lớn hơn số byte data thật sự có.
  const shortDsf = makeDsf(300000, 4096);
  await assert.rejects(decode(shortDsf, 'dsf'), /Chunk data DSF ngắn hơn số mẫu được khai báo trong fmt/, 'A DSF whose data is shorter than its declared sample count should report the shortfall');

  // DSF chỉ còn header: không đủ chunk fmt/data.
  await assert.rejects(decode(new Blob([new Uint8Array(40)]), 'dsf'), /Header DSF không hợp lệ/, 'A DSF shorter than its header should report an invalid header');

  // DFF bị cắt giữa data: FRM8 vẫn khai kích thước gốc.
  const fullDff = makeDff(4096);
  const cutDff = fullDff.slice(0, 90 + 1024);
  await assert.rejects(decode(cutDff, 'dff'), /Header DSDIFF khai báo kích thước lớn hơn file/, 'A DFF cut inside its data should report that the FRM8 size exceeds the file');

  // DFF khai chunk DSD lớn hơn FRM8: chunk vượt giới hạn đã khai.
  const oversizedDff = makeDff(4096, {dsdChunkSize: 999999});
  await assert.rejects(decode(oversizedDff, 'dff'), /Chunk DSDIFF vượt quá kích thước FRM8/, 'A DFF whose DSD chunk exceeds its FRM8 size should report the overrun');

  // DFF chỉ còn header: không đủ chunk PROP/DSD.
  await assert.rejects(decode(new Blob([new Uint8Array(16)]), 'dff'), /Header DSDIFF không hợp lệ/, 'A DFF shorter than its header should report an invalid header');
})();
