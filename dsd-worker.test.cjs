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
function makeDsf(rate = RATE, blockSize = 16, sampleCount = SAMPLE_COUNT, options = {}) {
  const dataOffset = 96, dataBytesPerChannel = Math.ceil(sampleCount / 8);
  const blocks = Math.ceil(dataBytesPerChannel / blockSize);
  const dataBytes = (options.padded ? blocks * blockSize : dataBytesPerChannel) * CHANNELS;
  const trailingBytes = options.trailingBytes || 0;
  const buffer = new ArrayBuffer(dataOffset + 12 + dataBytes + trailingBytes);
  const view = new DataView(buffer);
  writeTag(view, 0, 'DSD '); writeU64(view, 4, 28, true); writeU64(view, 12, buffer.byteLength, true);
  writeTag(view, 28, 'fmt '); writeU64(view, 32, 52, true);
  view.setUint32(40, 1, true); view.setUint32(44, 0, true); view.setUint32(48, 2, true);
  view.setUint32(52, CHANNELS, true); view.setUint32(56, rate, true); view.setUint32(60, 1, true);
  writeU64(view, 64, sampleCount, true); view.setUint32(72, blockSize, true); view.setUint32(76, 0, true);
  writeTag(view, 80, 'meta'); writeU64(view, 84, 16, true);
  writeTag(view, dataOffset, 'data'); writeU64(view, dataOffset + 4, 12 + dataBytes, true);
  for (let i = dataOffset + 12; i < dataOffset + 12 + dataBytes; i++) view.setUint8(i, i % 2 ? 0x96 : 0x69);
  for (let i = dataOffset + 12 + dataBytes; i < buffer.byteLength; i++) view.setUint8(i, 0x49);
  return new Blob([buffer]);
}
function makeDff(compression = 'DSD ', rate = RATE, sampleCount = SAMPLE_COUNT) {
  const propSize = 4 + (12 + 4) + (12 + 2) + (12 + 4);
  const propOffset = 16, dataOffset = propOffset + 12 + propSize;
  const dataBytes = sampleCount / 8 * CHANNELS;
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
  assert.equal((source.match(/self\.onmessage\s*=/g) || []).length, 1, 'DSD worker should register exactly one message handler so a cancel message is never mistaken for a decode request');
  {
    const posted = [];
    const self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const context = vm.createContext({self, Blob});
    vm.runInContext(source, context, {filename: 'dsd-worker.js'});
    self.onmessage({data: {type: 'cancel'}});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(posted.length, 0, 'A cancel message should not start a decode or post a spurious error');
    assert.equal(self.cancelled, true, 'A cancel message should flag the running decode as cancelled');
    const done = new Promise((resolve, reject) => {
      const originalPost = self.postMessage.bind(self);
      self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    self.onmessage({data: {file: makeDsf(), format: 'dsf', targetRate: 44100, bitDepth: 16}});
    const result = await done;
    assert.equal(result.type, 'done', 'A decode after cancel should still complete once the handler resets the cancel flag');
  }
  {
    const probeSelf = {cancelled: false, onmessage: null, postMessage() {}};
    const probeContext = vm.createContext({self: probeSelf, Blob});
    vm.runInContext(source, probeContext, {filename: 'dsd-worker.js'});
    const nextChunkBytes = probeContext.nextChunkBytes;
    assert.equal(typeof nextChunkBytes, 'function', 'DSD worker should expose nextChunkBytes for chunk-size audit tests');
    assert.equal(nextChunkBytes(262144, 120, 2), 131072, 'Chunk over 50 ms should halve');
    assert.equal(nextChunkBytes(262144, 120, 3), 131070, 'Halved chunk should stay a multiple of the channel count');
    assert.equal(nextChunkBytes(32768, 120, 2), 32768, 'Chunk should not shrink below the 32 KiB floor');
    assert.equal(nextChunkBytes(32768, 5, 2), 65536, 'Fast chunk under 10 ms should double');
    assert.equal(nextChunkBytes(262144, 5, 2), 262144, 'Chunk should not grow above the 256 KiB cap');
    assert.equal(nextChunkBytes(131072, 30, 2), 131072, 'Chunk within the time budget should stay unchanged');
    assert.equal(nextChunkBytes(100000, 5, 6), 199998, 'Grown chunk should stay a multiple of the channel count');
    assert.equal(nextChunkBytes(262144, NaN, 2), 262144, 'Invalid chunk time should leave the chunk unchanged');
    assert.equal(nextChunkBytes(262144, 120, 8), 131072, 'Chunk halving should work for 8 channels');
    const audit = probeContext.newChunkAudit();
    assert.equal(audit.maxChunkMs, 0, 'A fresh chunk audit should start with no slowest chunk');
    assert.equal(audit.chunkCount, 0, 'A fresh chunk audit should start with no counted chunks');
    assert.equal(audit.chunksOverBudget, 0, 'A fresh chunk audit should start with no over-budget chunks');
    assert.equal(audit.totalInputBytes, 0, 'A fresh chunk audit should start with no decoded input bytes');
    assert.equal(audit.totalChunkMs, 0, 'A fresh chunk audit should start with no counted decode time');
    assert.equal(audit.consecutiveOverBudget, 0, 'A fresh chunk audit should start with no over-budget streak');
    assert.equal(audit.maxConsecutiveOverBudget, 0, 'A fresh chunk audit should start with no longest over-budget streak');
    assert.equal(audit.minSliceThroughputMBps, 0, 'A fresh chunk audit should start with no slowest-slice throughput');
    const throughputAudit = probeContext.newChunkAudit();
    assert.equal(probeContext.decodeThroughputMBps(throughputAudit), 0, 'Throughput should be 0 MB/s before any chunk is decoded');
    assert.equal(probeContext.decodeThroughputMBps(null), 0, 'Throughput without an audit object should be 0 MB/s instead of throwing');
    probeContext.recordChunkAudit(throughputAudit, 1000, 1048576);
    assert.equal(throughputAudit.totalInputBytes, 1048576, 'A recorded chunk should accumulate its decoded input bytes');
    assert.equal(throughputAudit.totalChunkMs, 1000, 'A recorded chunk should accumulate its decode time');
    assert.equal(probeContext.decodeThroughputMBps(throughputAudit), 1, '1 MiB decoded in 1000 ms should measure 1 MB/s');
    probeContext.recordChunkAudit(throughputAudit, 1000, 1048576);
    assert.equal(probeContext.decodeThroughputMBps(throughputAudit), 1, 'A second identical chunk should keep throughput at 1 MB/s');
    probeContext.recordChunkAudit(throughputAudit, 500, NaN);
    assert.equal(throughputAudit.totalInputBytes, 2097152, 'An invalid input byte count should not change the accumulated bytes');
    assert.equal(throughputAudit.totalChunkMs, 2500, 'A chunk with invalid input bytes should still count its decode time');
    assert.ok(Math.abs(probeContext.decodeThroughputMBps(throughputAudit) - 2097152 / 2.5 / 1048576) < 1e-9, 'Throughput should divide total bytes by total decode time');
    assert.equal(throughputAudit.minSliceThroughputMBps, 1, 'The slowest slice should measure 1 MB/s after two identical 1 MiB/1000 ms chunks');
    probeContext.recordChunkAudit(throughputAudit, 250, 1048576);
    assert.equal(throughputAudit.minSliceThroughputMBps, 1, 'A faster 4 MB/s slice should not raise the slowest-slice throughput');
    probeContext.recordChunkAudit(throughputAudit, 2000, 1048576);
    assert.equal(throughputAudit.minSliceThroughputMBps, 0.5, 'A slower 0.5 MB/s slice should lower the slowest-slice throughput');
    probeContext.recordChunkAudit(throughputAudit, 2000, NaN);
    assert.equal(throughputAudit.minSliceThroughputMBps, 0.5, 'A slice without input bytes should not change the slowest-slice throughput');
    probeContext.recordChunkAudit(throughputAudit, 0, 1048576);
    assert.equal(throughputAudit.minSliceThroughputMBps, 0.5, 'A zero-time slice should not change the slowest-slice throughput');
    const initialChunkBytes = probeContext.initialChunkBytes;
    assert.equal(typeof initialChunkBytes, 'function', 'DSD worker should expose initialChunkBytes for first-chunk audit tests');
    assert.equal(typeof probeContext.nowMs, 'function', 'DSD worker should expose nowMs for sub-millisecond timing tests');
    assert.ok(Number.isFinite(probeContext.nowMs()) && probeContext.nowMs() >= 0, 'nowMs should return a finite non-negative timestamp');
    assert.equal(initialChunkBytes(2, 0), 262144, 'No measured throughput should start with the maximum chunk');
    assert.equal(initialChunkBytes(2, NaN), 262144, 'Invalid throughput should start with the maximum chunk');
    assert.equal(initialChunkBytes(2, 100), 262144, 'A fast device should cap the first chunk at 256 KiB');
    assert.equal(initialChunkBytes(2, 1), 52428, '1 MB/s should size the first chunk to about 50 ms of decode');
    assert.equal(initialChunkBytes(2, 0.1), 32768, 'A slow device should not start below the 32 KiB floor');
    assert.equal(initialChunkBytes(3, 1), 52428, 'The first chunk should stay a multiple of the channel count');
    assert.equal(initialChunkBytes(6, 0.5), 32766, 'A slow 6-channel device should floor then align the first chunk');
    probeContext.recordChunkAudit(audit, 5);
    assert.equal(audit.maxChunkMs, 5, 'A fast chunk should set the slowest chunk');
    assert.equal(audit.chunkCount, 1, 'A fast chunk should be counted');
    assert.equal(audit.chunksOverBudget, 0, 'A fast chunk should not raise the over-budget count');
    probeContext.recordChunkAudit(audit, 120);
    assert.equal(audit.maxChunkMs, 120, 'A slow chunk should raise the slowest chunk');
    assert.equal(audit.chunkCount, 2, 'A slow chunk should be counted');
    assert.equal(audit.chunksOverBudget, 1, 'A chunk over 50 ms should raise the over-budget count');
    probeContext.recordChunkAudit(audit, 80);
    assert.equal(audit.maxChunkMs, 120, 'A second slow chunk should keep the slowest chunk');
    assert.equal(audit.chunkCount, 3, 'A second slow chunk should be counted');
    assert.equal(audit.chunksOverBudget, 2, 'A second slow chunk should raise the over-budget count again');
    probeContext.recordChunkAudit(audit, NaN);
    assert.equal(audit.chunkCount, 3, 'An invalid chunk time should not be counted');
    assert.equal(audit.maxConsecutiveOverBudget, 2, 'Two slow chunks in a row should raise the longest over-budget streak to 2');
    assert.equal(audit.minSliceThroughputMBps, 0, 'Chunks recorded without input bytes should leave the slowest-slice throughput unmeasured');
    probeContext.recordChunkAudit(audit, 5);
    assert.equal(audit.consecutiveOverBudget, 0, 'A fast chunk should reset the over-budget streak');
    assert.equal(audit.maxConsecutiveOverBudget, 2, 'Resetting the streak should keep the longest streak');
    probeContext.recordChunkAudit(audit, 60);
    probeContext.recordChunkAudit(audit, 70);
    probeContext.recordChunkAudit(audit, 90);
    assert.equal(audit.consecutiveOverBudget, 3, 'Three slow chunks in a row should build a streak of 3');
    assert.equal(audit.maxConsecutiveOverBudget, 3, 'A longer streak should raise the longest over-budget streak');
    assert.equal(probeContext.recordChunkAudit(null, 120), null, 'Recording without an audit object should return null instead of throwing');
  }
  for (const [sourceRate, baseRate, targetRates] of [[RATE, 44100, [44100, 88200, 176400]], [3072000, 48000, [48000, 96000, 192000]], [11289600, 44100, [44100, 88200, 176400]], [12288000, 48000, [48000, 96000, 192000]], [22579200, 44100, [44100, 88200, 176400]], [24576000, 48000, [48000, 96000, 192000]]]) {
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
        assert.equal(result.multiplier, sourceRate / baseRate, `${format} source DSD multiplier`);
        assert.ok(Number.isFinite(result.decodeMs) && result.decodeMs >= 0, `${format} decodeMs should be a measured non-negative time`);
        assert.ok(Number.isFinite(result.maxChunkMs) && result.maxChunkMs >= 0, `${format} maxChunkMs should be a measured non-negative time`);
        assert.ok(Number.isInteger(result.chunkCount) && result.chunkCount >= 1, `${format} chunkCount should count at least one decoded chunk`);
        assert.ok(Number.isInteger(result.chunksOverBudget) && result.chunksOverBudget >= 0 && result.chunksOverBudget <= result.chunkCount, `${format} chunksOverBudget should be a count within the decoded chunks`);
        assert.ok(Number.isInteger(result.finalChunkBytes) && result.finalChunkBytes >= 32768 && result.finalChunkBytes <= 262144 && result.finalChunkBytes % CHANNELS === 0, `${format} finalChunkBytes should stay within the adaptive chunk limits and aligned to channels`);
        assert.ok(Number.isFinite(result.decodeThroughputMBps) && result.decodeThroughputMBps >= 0, `${format} decodeThroughputMBps should be a measured non-negative MB/s`);
        assert.ok(Number.isInteger(result.initialChunkBytes) && result.initialChunkBytes >= 32768 && result.initialChunkBytes <= 262144 && result.initialChunkBytes % CHANNELS === 0, `${format} initialChunkBytes should stay within the adaptive chunk limits and aligned to channels`);
        assert.ok(Number.isInteger(result.maxConsecutiveOverBudget) && result.maxConsecutiveOverBudget >= 0 && result.maxConsecutiveOverBudget <= result.chunkCount, `${format} maxConsecutiveOverBudget should be a streak count within the decoded chunks`);
        assert.ok(Number.isFinite(result.minSliceThroughputMBps) && result.minSliceThroughputMBps >= 0, `${format} minSliceThroughputMBps should be a measured non-negative MB/s`);
      }
    }
  }
  // Pha A — khối DSF lớn phải chia thành lát con: một DSF 2 kênh với
  // blockSize 140000 byte (vượt lát 131072 byte/kênh) vẫn giải mã đúng và
  // phải báo tiến độ ít nhất 2 lần (đã chia lát), thay vì 1 lần như trước.
  {
    const posted = [];
    const bigSelf = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const bigContext = vm.createContext({self: bigSelf, Blob});
    vm.runInContext(source, bigContext, {filename: 'dsd-worker.js'});
    const bigDone = new Promise((resolve, reject) => {
      const originalPost = bigSelf.postMessage.bind(bigSelf);
      bigSelf.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    bigSelf.onmessage({data: {file: makeDsf(RATE, 140000, 8 * 140000), format: 'dsf', targetRate: 44100, bitDepth: 16}});
    const bigResult = await bigDone;
    const progressPosts = posted.filter(message => message.type === 'progress');
    assert.ok(progressPosts.length >= 2, `Large DSF block should decode in at least 2 sub-chunks (got ${progressPosts.length} progress posts)`);
    assert.equal(bigResult.blob.size, 44 + bigResult.duration * 44100 * CHANNELS * 2, 'Large-block DSF should decode to the expected PCM size');
    assert.ok(Number.isFinite(bigResult.maxChunkMs) && bigResult.maxChunkMs >= 0, 'Large-block DSF should report maxChunkMs');
    assert.ok(Number.isInteger(bigResult.chunkCount) && bigResult.chunkCount >= 2, 'Large-block DSF should decode in at least 2 counted chunks');
    assert.ok(Number.isInteger(bigResult.chunksOverBudget) && bigResult.chunksOverBudget <= bigResult.chunkCount, 'Large-block DSF should report an over-budget chunk count within the chunk count');
    assert.ok(Number.isFinite(bigResult.decodeThroughputMBps) && bigResult.decodeThroughputMBps >= 0, 'Large-block DSF should report a non-negative decode throughput');
    assert.ok(Number.isInteger(bigResult.maxConsecutiveOverBudget) && bigResult.maxConsecutiveOverBudget >= 0 && bigResult.maxConsecutiveOverBudget <= bigResult.chunkCount, 'Large-block DSF should report an over-budget streak within the chunk count');
    assert.ok(Number.isFinite(bigResult.minSliceThroughputMBps) && bigResult.minSliceThroughputMBps >= 0, 'Large-block DSF should report a non-negative slowest-slice throughput');
  }
  // Pha A — kiểm toán worker với file DSD256 lớn (backlog): DSF 3 giây
  // DSD256 stereo (~8,5 MB, 33,9 triệu mẫu) phải giải mã đúng sang PCM
  // 44,1 kHz 16-bit (multiplier 256, đúng duration/kích thước), chia
  // nhiều lát và gửi đúng 1 lát PCM đầu (~2 giây) trước 'done' — như
  // DSD64, thay vì rớt hoặc sai hệ số decimation ở tốc độ cao.
  {
    const posted = [];
    const big256Self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const big256Context = vm.createContext({self: big256Self, Blob});
    vm.runInContext(source, big256Context, {filename: 'dsd-worker.js'});
    const big256Done = new Promise((resolve, reject) => {
      const originalPost = big256Self.postMessage.bind(big256Self);
      big256Self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    big256Self.onmessage({data: {file: makeDsf(11289600, 4096, 11289600 * 3), format: 'dsf', targetRate: 44100, bitDepth: 16}});
    const big256Result = await big256Done;
    assert.equal(big256Result.multiplier, 256, 'DSD256 should decode with multiplier 256');
    assert.equal(big256Result.duration, 3, 'A 3 s DSD256 file should report 3 s duration');
    assert.equal(big256Result.blob.size, 44 + 3 * 44100 * CHANNELS * 2, 'A 3 s DSD256 file should decode to the expected PCM size');
    assert.ok(big256Result.chunkCount >= 2, `A large DSD256 file should decode in multiple chunks (got ${big256Result.chunkCount})`);
    const slices256 = posted.filter(message => message.type === 'first-slice');
    assert.equal(slices256.length, 1, 'A 3 s DSD256 file should send exactly one first slice before done');
    assert.ok(slices256[0].duration >= 2 && slices256[0].duration < 2.5, `The DSD256 first slice should hold about 2 s of PCM (got ${slices256[0].duration} s)`);
  }
  // Pha A — kiểm toán worker với file DSD512 lớn (backlog): DSF 2 giây
  // DSD512 stereo (~11,3 MB, 45,2 triệu mẫu) phải giải mã đúng sang PCM
  // 44,1 kHz 16-bit (multiplier 512, đúng duration/kích thước), chia
  // nhiều lát và gửi đúng 1 lát PCM đầu (~2 giây) trước 'done' — như
  // DSD256, thay vì rớt hoặc sai hệ số decimation ở tốc độ cao nhất.
  {
    const posted = [];
    const big512Self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const big512Context = vm.createContext({self: big512Self, Blob});
    vm.runInContext(source, big512Context, {filename: 'dsd-worker.js'});
    const big512Done = new Promise((resolve, reject) => {
      const originalPost = big512Self.postMessage.bind(big512Self);
      big512Self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    big512Self.onmessage({data: {file: makeDsf(22579200, 4096, 22579200 * 2), format: 'dsf', targetRate: 44100, bitDepth: 16}});
    const big512Result = await big512Done;
    assert.equal(big512Result.multiplier, 512, 'DSD512 should decode with multiplier 512');
    assert.equal(big512Result.duration, 2, 'A 2 s DSD512 file should report 2 s duration');
    assert.equal(big512Result.blob.size, 44 + 2 * 44100 * CHANNELS * 2, 'A 2 s DSD512 file should decode to the expected PCM size');
    assert.ok(big512Result.chunkCount >= 2, `A large DSD512 file should decode in multiple chunks (got ${big512Result.chunkCount})`);
    const slices512 = posted.filter(message => message.type === 'first-slice');
    assert.equal(slices512.length, 1, 'A 2 s DSD512 file should send exactly one first slice before done');
    assert.ok(slices512[0].duration >= 2 && slices512[0].duration < 2.5, `The DSD512 first slice should hold about 2 s of PCM (got ${slices512[0].duration} s)`);
  }
  // Pha A — kiểm toán worker với file DSD512 24-bit (backlog): DSF 2 giây
  // DSD512 stereo (~11,3 MB, 45,2 triệu mẫu) phải giải mã đúng sang PCM
  // 44,1 kHz 24-bit (multiplier 512, đúng duration/kích thước 3
  // byte/mẫu, header WAV ghi 24-bit), chia nhiều lát và gửi đúng 1 lát
  // PCM đầu (~2 giây, cũng 24-bit) trước 'done' — như bản 16-bit, thay
  // vì sai căn chỉnh khung hoặc ghi nhầm độ sâu bit ở tốc độ cao nhất.
  {
    const posted = [];
    const big51224Self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const big51224Context = vm.createContext({self: big51224Self, Blob});
    vm.runInContext(source, big51224Context, {filename: 'dsd-worker.js'});
    const big51224Done = new Promise((resolve, reject) => {
      const originalPost = big51224Self.postMessage.bind(big51224Self);
      big51224Self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    big51224Self.onmessage({data: {file: makeDsf(22579200, 4096, 22579200 * 2), format: 'dsf', targetRate: 44100, bitDepth: 24}});
    const big51224Result = await big51224Done;
    assert.equal(big51224Result.multiplier, 512, 'DSD512 should decode with multiplier 512 at 24-bit');
    assert.equal(big51224Result.duration, 2, 'A 2 s DSD512 file should report 2 s duration at 24-bit');
    assert.equal(big51224Result.bitDepth, 24, 'A DSD512 file decoded at 24-bit should report 24-bit depth');
    assert.equal(big51224Result.blob.size, 44 + 2 * 44100 * CHANNELS * 3, 'A 2 s DSD512 file should decode to the expected 24-bit PCM size');
    const big51224Wav = new DataView(await big51224Result.blob.slice(0, 44).arrayBuffer());
    assert.equal(big51224Wav.getUint16(34, true), 24, 'A DSD512 file decoded at 24-bit should write 24-bit depth in the WAV header');
    assert.equal(big51224Wav.getUint32(40, true), big51224Result.blob.size - 44, 'A DSD512 24-bit WAV should declare its full PCM data size');
    assert.ok(big51224Result.chunkCount >= 2, `A large DSD512 file should decode in multiple chunks at 24-bit (got ${big51224Result.chunkCount})`);
    const slices51224 = posted.filter(message => message.type === 'first-slice');
    assert.equal(slices51224.length, 1, 'A 2 s DSD512 file should send exactly one first slice before done at 24-bit');
    assert.ok(slices51224[0].duration >= 2 && slices51224[0].duration < 2.5, `The DSD512 first slice should hold about 2 s of PCM at 24-bit (got ${slices51224[0].duration} s)`);
    const slice51224Wav = new DataView(await slices51224[0].blob.slice(0, 44).arrayBuffer());
    assert.equal(slice51224Wav.getUint16(34, true), 24, 'The DSD512 first slice should also be 24-bit in the WAV header');
    assert.equal(slices51224[0].blob.size, 44 + Math.round(slices51224[0].duration * 44100) * CHANNELS * 3, 'The DSD512 first slice should hold the expected 24-bit PCM frames');
  }
  // Pha D — kiểm toán worker với file DFF DSD256 24-bit (backlog): DFF
  // 2,5 giây DSD256 stereo (~7,1 MB, 28,2 triệu mẫu) phải giải mã đúng
  // sang PCM 88,2 kHz 24-bit (multiplier 256, đúng duration/kích thước
  // 3 byte/mẫu, header WAV ghi 24-bit), chia nhiều lát và gửi đúng 1 lát
  // PCM đầu (~2 giây, cũng 24-bit) trước 'done' — như bản DSF DSD512
  // 24-bit, thay vì sai đường đọc chunk DSDIFF (FRM8/PROP/DSD, MSB-first)
  // hay ghi nhầm độ sâu bit ở container DFF.
  {
    const posted = [];
    const dff25624Self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const dff25624Context = vm.createContext({self: dff25624Self, Blob});
    vm.runInContext(source, dff25624Context, {filename: 'dsd-worker.js'});
    const dff25624Done = new Promise((resolve, reject) => {
      const originalPost = dff25624Self.postMessage.bind(dff25624Self);
      dff25624Self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    dff25624Self.onmessage({data: {file: makeDff('DSD ', 11289600, 11289600 * 2.5), format: 'dff', targetRate: 88200, bitDepth: 24}});
    const dff25624Result = await dff25624Done;
    assert.equal(dff25624Result.multiplier, 256, 'DFF DSD256 should decode with multiplier 256 at 24-bit');
    assert.equal(dff25624Result.duration, 2.5, 'A 2.5 s DFF DSD256 file should report 2.5 s duration at 24-bit');
    assert.equal(dff25624Result.bitDepth, 24, 'A DFF DSD256 file decoded at 24-bit should report 24-bit depth');
    assert.equal(dff25624Result.blob.size, 44 + 2.5 * 88200 * CHANNELS * 3, 'A 2.5 s DFF DSD256 file should decode to the expected 24-bit PCM size');
    const dff25624Wav = new DataView(await dff25624Result.blob.slice(0, 44).arrayBuffer());
    assert.equal(dff25624Wav.getUint32(24, true), 88200, 'A DFF DSD256 file decoded at 24-bit should write 88.2 kHz in the WAV header');
    assert.equal(dff25624Wav.getUint16(34, true), 24, 'A DFF DSD256 file decoded at 24-bit should write 24-bit depth in the WAV header');
    assert.equal(dff25624Wav.getUint32(40, true), dff25624Result.blob.size - 44, 'A DFF DSD256 24-bit WAV should declare its full PCM data size');
    assert.ok(dff25624Result.chunkCount >= 2, `A large DFF DSD256 file should decode in multiple chunks at 24-bit (got ${dff25624Result.chunkCount})`);
    const slicesDff25624 = posted.filter(message => message.type === 'first-slice');
    assert.equal(slicesDff25624.length, 1, 'A 2.5 s DFF DSD256 file should send exactly one first slice before done at 24-bit');
    assert.ok(slicesDff25624[0].duration >= 2 && slicesDff25624[0].duration < 2.5, `The DFF DSD256 first slice should hold about 2 s of PCM at 24-bit (got ${slicesDff25624[0].duration} s)`);
    const sliceDff25624Wav = new DataView(await slicesDff25624[0].blob.slice(0, 44).arrayBuffer());
    assert.equal(sliceDff25624Wav.getUint16(34, true), 24, 'The DFF DSD256 first slice should also be 24-bit in the WAV header');
    assert.equal(slicesDff25624[0].blob.size, 44 + Math.round(slicesDff25624[0].duration * 88200) * CHANNELS * 3, 'The DFF DSD256 first slice should hold the expected 24-bit PCM frames');
  }
  // Pha D — kiểm toán worker với file DFF DSD512 24-bit (backlog): DFF
  // 2 giây DSD512 stereo (~10,8 MB, 45,2 triệu mẫu) phải giải mã đúng
  // sang PCM 44,1 kHz 24-bit (multiplier 512, đúng duration/kích thước
  // 3 byte/mẫu, header WAV ghi 24-bit), chia nhiều lát và gửi đúng 1 lát
  // PCM đầu (~2 giây, cũng 24-bit) trước 'done' — như bản DSF DSD512
  // 24-bit, thay vì sai đường đọc chunk DSDIFF (FRM8/PROP/DSD, MSB-first)
  // hay rớt ở tốc độ lấy mẫu cao nhất 22,5792 MHz.
  {
    const posted = [];
    const dff51224Self = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const dff51224Context = vm.createContext({self: dff51224Self, Blob});
    vm.runInContext(source, dff51224Context, {filename: 'dsd-worker.js'});
    const dff51224Done = new Promise((resolve, reject) => {
      const originalPost = dff51224Self.postMessage.bind(dff51224Self);
      dff51224Self.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    dff51224Self.onmessage({data: {file: makeDff('DSD ', 22579200, 22579200 * 2), format: 'dff', targetRate: 44100, bitDepth: 24}});
    const dff51224Result = await dff51224Done;
    assert.equal(dff51224Result.multiplier, 512, 'DFF DSD512 should decode with multiplier 512 at 24-bit');
    assert.equal(dff51224Result.duration, 2, 'A 2 s DFF DSD512 file should report 2 s duration at 24-bit');
    assert.equal(dff51224Result.bitDepth, 24, 'A DFF DSD512 file decoded at 24-bit should report 24-bit depth');
    assert.equal(dff51224Result.blob.size, 44 + 2 * 44100 * CHANNELS * 3, 'A 2 s DFF DSD512 file should decode to the expected 24-bit PCM size');
    const dff51224Wav = new DataView(await dff51224Result.blob.slice(0, 44).arrayBuffer());
    assert.equal(dff51224Wav.getUint32(24, true), 44100, 'A DFF DSD512 file decoded at 24-bit should write 44.1 kHz in the WAV header');
    assert.equal(dff51224Wav.getUint16(34, true), 24, 'A DFF DSD512 file decoded at 24-bit should write 24-bit depth in the WAV header');
    assert.equal(dff51224Wav.getUint32(40, true), dff51224Result.blob.size - 44, 'A DFF DSD512 24-bit WAV should declare its full PCM data size');
    assert.ok(dff51224Result.chunkCount >= 2, `A large DFF DSD512 file should decode in multiple chunks at 24-bit (got ${dff51224Result.chunkCount})`);
    const slicesDff51224 = posted.filter(message => message.type === 'first-slice');
    assert.equal(slicesDff51224.length, 1, 'A 2 s DFF DSD512 file should send exactly one first slice before done at 24-bit');
    assert.ok(slicesDff51224[0].duration >= 2 && slicesDff51224[0].duration < 2.5, `The DFF DSD512 first slice should hold about 2 s of PCM at 24-bit (got ${slicesDff51224[0].duration} s)`);
    const sliceDff51224Wav = new DataView(await slicesDff51224[0].blob.slice(0, 44).arrayBuffer());
    assert.equal(sliceDff51224Wav.getUint16(34, true), 24, 'The DFF DSD512 first slice should also be 24-bit in the WAV header');
    assert.equal(slicesDff51224[0].blob.size, 44 + Math.round(slicesDff51224[0].duration * 44100) * CHANNELS * 3, 'The DFF DSD512 first slice should hold the expected 24-bit PCM frames');
  }
  // Pha A — worker giữ throughput giữa các lần giải mã trong cùng phiên:
  // lần đầu chưa có số đo nên lát đầu là tối đa, lần sau lát đầu vẫn nằm
  // trong giới hạn thích nghi và chia hết cho số kênh (nhỏ hơn nếu máy chậm).
  {
    const posted = [];
    const sameSelf = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
    const sameContext = vm.createContext({self: sameSelf, Blob});
    vm.runInContext(source, sameContext, {filename: 'dsd-worker.js'});
    function decodeInContext(file, format) {
      return new Promise((resolve, reject) => {
        const originalPost = sameSelf.postMessage.bind(sameSelf);
        sameSelf.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
        sameSelf.onmessage({data: {file, format, targetRate: 44100, bitDepth: 16}});
      });
    }
    const first = await decodeInContext(makeDsf(RATE, 16, 65536), 'dsf');
    assert.equal(first.initialChunkBytes, 262144, 'The first decode in a fresh worker should start with the maximum chunk');
    const second = await decodeInContext(makeDsf(RATE, 16, 65536), 'dsf');
    assert.ok(Number.isInteger(second.initialChunkBytes) && second.initialChunkBytes >= 32768 && second.initialChunkBytes <= 262144 && second.initialChunkBytes % CHANNELS === 0, 'The second decode should size its first chunk from the measured throughput within the adaptive limits');
  }
  // Pha D — worker đo thời gian bằng performance.now(): với đồng hồ giả
  // tăng đúng 7 ms mỗi lần gọi, mọi lát giải mã đều phải đo đúng 7 ms
  // (Date.now() làm tròn 1 ms sẽ cho 0–1 ms, không bao giờ đúng 7 ms).
  {
    let fakeNow = 0;
    const fakeSelf = {cancelled: false, onmessage: null, postMessage(message) {}};
    const fakeContext = vm.createContext({self: fakeSelf, Blob, performance: {now: () => (fakeNow += 7)}});
    vm.runInContext(source, fakeContext, {filename: 'dsd-worker.js'});
    const fakeDone = new Promise((resolve, reject) => {
      const originalPost = fakeSelf.postMessage.bind(fakeSelf);
      fakeSelf.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
    });
    fakeSelf.onmessage({data: {file: makeDsf(), format: 'dsf', targetRate: 44100, bitDepth: 16}});
    const fakeResult = await fakeDone;
    assert.equal(fakeResult.chunkCount, 4, 'The fake-clock DSF should decode in 4 chunks');
    assert.equal(fakeResult.maxChunkMs, 7, 'Every chunk should measure exactly 7 ms on the fake performance clock');
    assert.equal(fakeResult.chunksOverBudget, 0, '7 ms chunks should stay within the 50 ms budget');
    assert.equal(fakeResult.decodeMs, 63, 'Total decode time should follow the fake performance clock');
  }
  // Pha D — khối DSF cuối lẻ (file thật: 3 giây DSD64 stereo, blockSize
  // 4096, 1.058.400 byte/kênh nên khối cuối chỉ còn 1612 byte/kênh):
  // ffmpeg (dsfdec.c) đọc cả 2 dạng file thật — chèn đệm (data chunk lớn
  // hơn số mẫu thật, khối cuối đủ blockSize mỗi kênh) và không chèn đệm
  // (data chunk đúng bằng số mẫu, kênh sau nằm sát sau kênh trước trong
  // khối cuối). Worker cũ luôn dùng bước nhảy blockSize nên với file không
  // chèn đệm đọc quá cuối chunk dữ liệu và ném 'Không đọc đủ dữ liệu DSF.'
  // ở khối cuối — bài DSD bị bỏ qua sau khi đã giải mã gần xong.
  {
    const expectedSize = 44 + 3 * 44100 * CHANNELS * 2;
    const unpadded = await decode(makeDsf(RATE, 4096, RATE * 3), 'dsf', 44100, 16);
    assert.equal(unpadded.blob.size, expectedSize, 'Unpadded DSF with a partial last block should decode to the full 3 s PCM');
    assert.equal(unpadded.duration, 3, 'Unpadded DSF should report the full 3 s duration');
    const padded = await decode(makeDsf(RATE, 4096, RATE * 3, {padded: true}), 'dsf', 44100, 16);
    assert.equal(padded.blob.size, expectedSize, 'Padded DSF with a partial last block should decode to the full 3 s PCM');
    assert.equal(padded.duration, 3, 'Padded DSF should report the full 3 s duration');
    const withId3 = await decode(makeDsf(RATE, 4096, RATE * 3, {trailingBytes: 8192}), 'dsf', 44100, 16);
    assert.equal(withId3.blob.size, expectedSize, 'Unpadded DSF with trailing ID3 bytes should decode to the full 3 s PCM');
    assert.deepEqual(new Uint8Array(await withId3.blob.arrayBuffer()), new Uint8Array(await unpadded.blob.arrayBuffer()), 'Trailing ID3 bytes must not leak into the decoded PCM tail');
  }
  // Pha A — DSD phát từ lát PCM đầu: DSF 3 giây gửi đúng 1 tin 'first-slice'
  // trước 'done' (WAV hợp lệ, ~2 giây PCM); file ngắn hơn 2 giây thì chỉ 'done'.
  {
    async function decodeCollecting(file, format) {
      const posted = [];
      const collectSelf = {cancelled: false, onmessage: null, postMessage(message) { posted.push(message); }};
      const collectContext = vm.createContext({self: collectSelf, Blob});
      vm.runInContext(source, collectContext, {filename: 'dsd-worker.js'});
      const done = new Promise((resolve, reject) => {
        const originalPost = collectSelf.postMessage.bind(collectSelf);
        collectSelf.postMessage = message => { originalPost(message); if (message.type === 'done') resolve(message); else if (message.type === 'error') reject(new Error(message.message)); };
      });
      collectSelf.onmessage({data: {file, format, targetRate: 44100, bitDepth: 16}});
      await done;
      return posted;
    }
    const longPosted = await decodeCollecting(makeDsf(RATE, 4096, RATE * 3), 'dsf');
    const slices = longPosted.filter(message => message.type === 'first-slice');
    assert.equal(slices.length, 1, 'A 3 s DSF should send exactly one first slice before done');
    assert.ok(longPosted.findIndex(message => message.type === 'first-slice') < longPosted.findIndex(message => message.type === 'done'), 'The first slice should arrive before the full decode finishes');
    const slice = slices[0];
    assert.equal(String.fromCharCode(...new Uint8Array(await slice.blob.slice(0, 4).arrayBuffer())), 'RIFF', 'The first slice should be a valid WAV blob');
    const sliceHeader = new DataView(await slice.blob.slice(0, 44).arrayBuffer());
    assert.equal(sliceHeader.getUint32(40, true), slice.blob.size - 44, 'The first-slice WAV header should size its own PCM data');
    assert.ok(slice.duration >= 2 && slice.duration < 2.5, `The first slice should hold about 2 s of PCM (got ${slice.duration} s)`);
    assert.equal(slice.blob.size, 44 + Math.round(slice.duration * 44100) * CHANNELS * 2, 'The first-slice PCM size should match its reported duration');
    const shortPosted = await decodeCollecting(makeDsf(), 'dsf');
    assert.equal(shortPosted.filter(message => message.type === 'first-slice').length, 0, 'A file shorter than the first slice should send no first slice');
    assert.equal(shortPosted.filter(message => message.type === 'done').length, 1, 'A short file should still finish with one done message');
  }
  await assert.rejects(decode(makeDsf(), 'dsf', 32000, 16), /PCM chỉ hỗ trợ/);
  await assert.rejects(decode(makeDsf(), 'dsf', 48000, 16), /thuộc họ 44.1 kHz/);
  await assert.rejects(decode(makeDff('DSD ', 3072000), 'dff', 44100, 16), /thuộc họ 48 kHz/);
  await assert.rejects(decode(makeDff('DST '), 'dff', 44100, 16), /DST chưa hỗ trợ/);
  console.log('DSD worker tests passed: DSF/DFF, DSD64 in 44.1/48 kHz families, PCM 44.1–192 kHz, 16/24-bit, family mismatch and DST rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
