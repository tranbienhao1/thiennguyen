'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'dsd-worker.js'), 'utf8');
const RATE = 2822400; // DSD64
const SAMPLE_COUNT = 512;
const CHANNELS = 2;

function writeTag(view, offset, value) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}
function writeU64(view, offset, value, littleEndian) {
  view.setBigUint64(offset, BigInt(value), littleEndian);
}
function makeDsf(rate = RATE) {
  const dataOffset = 96, dataBytesPerChannel = SAMPLE_COUNT / 8;
  const buffer = new ArrayBuffer(dataOffset + 12 + dataBytesPerChannel * CHANNELS);
  const view = new DataView(buffer);
  writeTag(view, 0, 'DSD '); writeU64(view, 4, 28, true); writeU64(view, 12, buffer.byteLength, true);
  writeTag(view, 28, 'fmt '); writeU64(view, 32, 52, true);
  view.setUint32(40, 1, true); view.setUint32(44, 0, true); view.setUint32(48, 2, true);
  view.setUint32(52, CHANNELS, true); view.setUint32(56, rate, true); view.setUint32(60, 1, true);
  writeU64(view, 64, SAMPLE_COUNT, true); view.setUint32(72, 16, true); view.setUint32(76, 0, true);
  writeTag(view, 80, 'meta'); writeU64(view, 84, 16, true);
  writeTag(view, dataOffset, 'data'); writeU64(view, dataOffset + 4, 12 + dataBytesPerChannel * CHANNELS, true);
  for (let i = dataOffset + 12; i < buffer.byteLength; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  return new Blob([buffer]);
}
function makeDff(compression = 'DSD ', rate = RATE) {
  const propSize = 4 + (12 + 4) + (12 + 2) + (12 + 4);
  const propOffset = 16, dataOffset = propOffset + 12 + propSize;
  const dataBytes = SAMPLE_COUNT / 8 * CHANNELS;
  const buffer = new ArrayBuffer(dataOffset + 12 + dataBytes);
  const view = new DataView(buffer);
  writeTag(view, 0, 'FRM8'); writeU64(view, 4, buffer.byteLength - 12, false); writeTag(view, 12, 'DSD ');
  writeTag(view, propOffset, 'PROP'); writeU64(view, propOffset + 4, propSize, false); writeTag(view, propOffset + 12, 'SND ');
  let offset = propOffset + 16;
  writeTag(view, offset, 'FS  '); writeU64(view, offset + 4, 4, false); view.setUint32(offset + 12, rate, false); offset += 16;
  writeTag(view, offset, 'CHNL'); writeU64(view, offset + 4, 2, false); view.setUint16(offset + 12, CHANNELS, false); offset += 14;
  writeTag(view, offset, 'CMPR'); writeU64(view, offset + 4, 4, false); writeTag(view, offset + 12, compression);
  writeTag(view, dataOffset, 'DSD '); writeU64(view, dataOffset + 4, dataBytes, false);
  for (let i = dataOffset + 12; i < buffer.byteLength; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  return new Blob([buffer]);
}
function decode(file, format, targetRate, bitDepth) {
  return new Promise((resolve, reject) => {
    const self = {
      cancelled: false,
      onmessage: null,
      postMessage(message) {
        if (message.type === 'done') resolve(message);
        else if (message.type === 'error') reject(new Error(message.message));
      }
    };
    const context = vm.createContext({self, Blob});
    vm.runInContext(source, context, {filename: 'dsd-worker.js'});
    self.onmessage({data: {file, format, targetRate, bitDepth}});
  });
}

(async () => {
  for (const [sourceRate, targetRates] of [[RATE, [44100, 88200, 176400]], [3072000, [48000, 96000, 192000]]]) {
    const files = [['dsf', makeDsf(sourceRate)], ['dff', makeDff('DSD ', sourceRate)]];
    for (const rate of targetRates) for (const depth of [16, 24]) {
      for (const [format, file] of files) {
        const result = await decode(file, format, rate, depth);
        const wav = new DataView(await result.blob.slice(0, 44).arrayBuffer());
        assert.equal(String.fromCharCode(...new Uint8Array(await result.blob.slice(0, 4).arrayBuffer())), 'RIFF');
        assert.equal(wav.getUint32(24, true), rate, `${format} ${rate} Hz rate`);
        assert.equal(wav.getUint16(22, true), CHANNELS, `${format} channel count`);
        assert.equal(wav.getUint16(34, true), depth, `${format} PCM depth`);
        assert.equal(wav.getUint32(40, true), result.blob.size - 44, `${format} PCM data size`);
        assert.equal(result.blob.size, 44 + result.duration * rate * CHANNELS * (depth / 8), `${format} PCM frame alignment`);
        assert.equal(result.multiplier, sourceRate / (sourceRate === RATE ? 44100 : 48000), `${format} source DSD multiplier`);
      }
    }
  }
  await assert.rejects(decode(makeDsf(), 'dsf', 32000, 16), /PCM chỉ hỗ trợ/);
  await assert.rejects(decode(makeDsf(), 'dsf', 48000, 16), /thuộc họ 44.1 kHz/);
  await assert.rejects(decode(makeDff('DSD ', 3072000), 'dff', 44100, 16), /thuộc họ 48 kHz/);
  await assert.rejects(decode(makeDff('DST '), 'dff', 44100, 16), /DST chưa hỗ trợ/);
  console.log('DSD worker tests passed: DSF/DFF, DSD64 in 44.1/48 kHz families, PCM 44.1–192 kHz, 16/24-bit, family mismatch and DST rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
