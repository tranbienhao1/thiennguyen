'use strict';

// Pha C — DSD cũng mắc lỗi vị trí khi đổi từ lát PCM đầu sang file đầy
// đủ (Melissa xác nhận cả FLAC và DSD đều bị, 23:43): lát PCM đầu chỉ
// ~2 giây; khi lát hết sớm, currentTime nhảy về duration của lát (2s)
// rồi mới bắn 'ended'; handler 'done' của worker lấy audio.currentTime
// để seek file đầy đủ nên phát tiếp từ cuối lát thay vì vị trí thật đã
// ghi trong timeupdate, và không kẹp dưới duration như đường FLAC. Bản
// sửa dùng track.lastSlicePosition khi lát đã hết sớm + kẹp duration -
// 0.25, reset khi lát mới bắt đầu và xóa sau khi đổi sang file đầy đủ.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

function extractFunction(code, name) {
  let start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should be defined in the app script`);
  if (code.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
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

class FakeAudio {
  constructor() {
    this.handlers = {};
    this.src = '';
    this.currentTime = 0;
    this.duration = 0;
    this.paused = true;
    this.muted = false;
    this.playCalls = 0;
  }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  removeEventListener() {}
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
  async play() { this.playCalls++; this.paused = false; }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() {}
}

function makeHarness() {
  const calls = {toasts: [], skipped: []};
  const elements = {};
  const $ = id => (elements[id] ||= {textContent: '', value: ''});
  const audio = new FakeAudio();
  const standbyAudio = new FakeAudio();
  let workerInstance = null;
  class FakeWorker {
    constructor(url) { this.url = String(url); this.onmessage = null; this.onerror = null; workerInstance = this; this.terminated = false; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const track = {id: 'dsd1', format: 'dsf', sampleRate: 2822400, title: 'Test DSD', file: new Blob(['fake-dsd-bytes'])};
  const state = {
    tracks: [track], currentId: null, playGeneration: 1,
    dsdWorker: null, dsdUrl: null, dsdTrackId: null, dsdBlob: null,
    dsdOutputRate: 44100, dsdOutputDepth: 16,
    context: {state: 'running', currentTime: 0, resume: async () => {}},
    objectUrls: new Set(),
  };
  const context = {
    console, setTimeout, URL, Blob,
    location: {protocol: 'https:', href: 'https://example.test/thiennguyen/'},
    performance,
    state, audio, standbyAudio,
    dsdWorkerBaseUrl: 'https://example.test/thiennguyen/',
    dsdSourceInfo: () => ({baseRate: 44100, multiplier: 64}),
    clearStalePreload: () => {},
    // Pha C — đường DSD gọi preloadNext(true) khi lát đầu / file ngắn
    // bắt đầu phát; harness cũ không cần đếm, chỉ cần hàm tồn tại.
    preloadNext: () => {},
    stopDsdWorker: () => {},
    setupAudio: () => {},
    displayTrack: () => {},
    scheduleTrackRender: () => {},
    recordTimeToFirstAudio: () => {},
    recordHistory: () => {},
    releaseTrackUrl: () => {},
    releaseUnusedCloudUrl: () => {},
    releaseUnusedLocalUrl: () => {},
    skipFailedTrack: (generation, message) => calls.skipped.push(message),
    toast: message => calls.toasts.push(message),
    $,
    Worker: FakeWorker,
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(appCode, 'playDsdTrack'), context, {filename: 'play-dsd-track.js'});
  return {context, calls, audio, standbyAudio, track, state, getWorker: () => workerInstance};
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const doneMessage = (overrides = {}) => ({
  type: 'done', blob: new Blob(['full-pcm']), duration: 197, rate: 44100,
  channels: 2, multiplier: 64, targetRate: 44100, decimation: 64,
  bitDepth: 16, decodeMs: 5000, maxChunkMs: 10, chunkCount: 5,
  chunksOverBudget: 0, finalChunkBytes: 100, decodeThroughputMBps: 1,
  initialChunkBytes: 100, maxConsecutiveOverBudget: 0,
  minSliceThroughputMBps: 1, ...overrides,
});

async function startSlice(harness) {
  const {context, track, audio} = harness;
  const playPromise = context.playDsdTrack(track, 1, 0);
  await tick(); await tick();
  const worker = harness.getWorker();
  assert.ok(worker, 'playDsdTrack should start a decode worker');
  worker.onmessage({data: {type: 'first-slice', blob: new Blob(['slice-pcm']), duration: 2.02, sliceDecodeMs: 120}});
  await tick(); await tick();
  assert.ok(audio.src.startsWith('blob:'), 'The first PCM slice should start playing on the main deck');
  assert.equal(track.firstSlicePlayback, true, 'The DSD track should be marked as playing from its first slice');
  return {worker, playPromise};
}

(async () => {
  // Kịch bản chính (phải fail trên code cũ): lát PCM đầu hết sớm, 'done'
  // về sau — file đầy đủ phải phát tiếp từ vị trí thật đã ghi (1.9s),
  // không phải từ currentTime đã nhảy về duration của lát (2.02s).
  {
    const harness = makeHarness();
    const {track, audio} = harness;
    const {worker, playPromise} = await startSlice(harness);
    assert.equal(track.lastSlicePosition, null, 'Starting a DSD first slice should clear any stale recorded slice position');
    // timeupdate đã ghi vị trí thật 1.9s; lát hết -> currentTime nhảy về
    // duration 2.02s, guard 'ended' nhớ cờ sliceEndedEarly.
    track.lastSlicePosition = 1.9;
    audio.currentTime = 2.02; audio.duration = 2.02; audio.paused = true;
    track.sliceEndedEarly = true;
    worker.onmessage({data: doneMessage()});
    await tick(); await tick();
    assert.equal(track.firstSlicePlayback, false, 'The full decoded file should take over from the first slice');
    assert.equal(track.lastSlicePosition, null, 'The recorded slice position should be cleared after swapping to the full file');
    assert.equal(harness.calls.skipped.length, 0, 'Swapping to the full decoded file should not skip the track');
    audio.duration = 197;
    audio.fire('loadedmetadata');
    await tick();
    assert.equal(audio.currentTime, 1.9, 'After the first slice ended early, the full file should resume from the recorded slice position (1.9s), not from currentTime which had jumped to the slice duration (2.02s)');
    assert.ok(audio.playCalls > 0, 'Playback should resume after upgrading to the full decoded file');
    await playPromise;
  }

  // Lát chưa hết khi 'done' về: phát tiếp từ currentTime đang nghe, như
  // trước (không dùng vị trí đã ghi vì lát chưa hết).
  {
    const harness = makeHarness();
    const {track, audio} = harness;
    const {worker, playPromise} = await startSlice(harness);
    track.lastSlicePosition = 1.15;
    audio.currentTime = 1.2; audio.duration = 2.02; audio.paused = false;
    track.sliceEndedEarly = false;
    worker.onmessage({data: doneMessage()});
    await tick(); await tick();
    audio.duration = 197;
    audio.fire('loadedmetadata');
    await tick();
    assert.equal(audio.currentTime, 1.2, 'While the first slice is still playing, the full file should resume from the live currentTime');
    assert.ok(audio.playCalls > 0, 'Playback should keep going after upgrading mid-slice');
    await playPromise;
  }

  // File DSD chỉ hơn 2 giây một chút: vị trí phát tiếp phải kẹp dưới
  // duration của file đầy đủ để 'ended' không bắn ngay sau khi đổi.
  {
    const harness = makeHarness();
    const {track, audio} = harness;
    const {worker, playPromise} = await startSlice(harness);
    track.lastSlicePosition = 1.9;
    audio.currentTime = 2.02; audio.duration = 2.02; audio.paused = true;
    track.sliceEndedEarly = true;
    worker.onmessage({data: doneMessage({duration: 2.05})});
    await tick(); await tick();
    audio.duration = 2.05;
    audio.fire('loadedmetadata');
    await tick();
    assert.ok(Math.abs(audio.currentTime - 1.8) < 1e-9, `The resume position should be clamped below the full file duration (2.05s - 0.25s = 1.8s), got ${audio.currentTime}`);
    await playPromise;
  }

  // Nối dây tĩnh trong playDsdTrack: dùng vị trí đã ghi khi lát hết sớm,
  // kẹp dưới duration, reset khi lát mới bắt đầu và xóa sau khi đổi.
  const dsdSource = extractFunction(appCode, 'playDsdTrack');
  assert.ok(dsdSource.includes('sliceEndedEarly && Number.isFinite(track.lastSlicePosition)'), 'The DSD done handler should resume from the recorded slice position when the first slice already ended');
  assert.ok(dsdSource.includes('duration - 0.25'), 'The DSD done handler should clamp the resume position below the full file duration');
  assert.ok((dsdSource.match(/track\.lastSlicePosition = null/g) || []).length >= 2, 'The recorded DSD slice position should be reset when a new slice starts and cleared after swapping to the full file');
})();
