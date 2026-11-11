'use strict';

// Pha C — prefetch lát đầu bài kế ngay khi bài DSD bắt đầu phát (Pha kế
// theo log 17:35, ưu tiên Melissa chọn 23:23): đường phát thường gọi
// preloadNext(true) trong finishPlaybackStart nên bài kế được tải lát đầu
// + tải nền file đầy đủ ngay từ đầu bài; đường DSD (playDsdTrack) trước
// đây không gọi preloadNext ở đâu cả — bài kế chỉ được tải khi timeupdate
// thấy gần hết bài (shouldPreloadNext), với kết nối Drive chậm thì không
// đủ thời gian tải nền, bấm Next / tự chuyển bài phải chờ tải lát đầu từ
// đầu. Bản sửa gọi preloadNext(true) khi lát PCM đầu phát được và khi file
// DSD ngắn (không có lát đầu) phát được; phát lỗi thì không prefetch.

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
    this.playReject = null;
  }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  removeEventListener() {}
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
  async play() {
    if (this.playReject) throw this.playReject;
    this.playCalls++; this.paused = false;
  }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() {}
}

function makeHarness() {
  const calls = {toasts: [], skipped: [], preloadNext: [], cached: []};
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
  const nextTrack = {id: 'flac-next', format: 'flac', title: 'Rio', source: 'google'};
  const state = {
    tracks: [track, nextTrack], currentId: null, playGeneration: 1,
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
    preloadNext: (...args) => { calls.preloadNext.push(args); },
    stopDsdWorker: () => {},
    setupAudio: () => {},
    displayTrack: () => {},
    scheduleTrackRender: () => {},
    recordTimeToFirstAudio: () => {},
    recordHistory: () => {},
    releaseTrackUrl: () => {},
    releaseUnusedCloudUrl: () => {},
    releaseUnusedLocalUrl: () => {},
    renderRoomSignal: () => {},
    skipFailedTrack: (generation, message) => calls.skipped.push(message),
    toast: message => calls.toasts.push(message),
    $,
    Worker: FakeWorker,
    // Pha C — playDsdTrack đọc cache lát đầu trước khi tạo worker và ghi
    // cache khi lát của worker về; sandbox này không có lát cache sẵn.
    getCachedFirstSlice: async () => null,
    cacheFirstSlice: (...args) => { calls.cached.push(args); },
    library: {DSD_FIRST_SLICE_CACHE_MAX_BYTES: 3 * 1024 * 1024},
  };
  vm.createContext(context);
  // Pha C — lát PCM đầu được phát qua helper dùng chung playDsdFirstSlice
  // (từ worker hoặc từ cache); nạp helper thật để đường lát đầu chạy như
  // trong app thay vì stub.
  vm.runInContext(extractFunction(appCode, 'playDsdFirstSlice'), context, {filename: 'play-dsd-first-slice.js'});
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

(async () => {
  // Lát PCM đầu vừa phát được thì prefetch bài kế ngay, không đợi gần
  // hết bài; trước khi lát phát thì chưa prefetch.
  {
    const harness = makeHarness();
    const {context, track, audio, calls} = harness;
    const playPromise = context.playDsdTrack(track, 1, 0);
    await tick(); await tick();
    const worker = harness.getWorker();
    assert.ok(worker, 'playDsdTrack should start a decode worker');
    assert.equal(calls.preloadNext.length, 0, 'The next track should not be prefetched before the DSD first slice starts playing');
    worker.onmessage({data: {type: 'first-slice', blob: new Blob(['slice-pcm']), duration: 2.02, sliceDecodeMs: 120}});
    await tick(); await tick();
    assert.ok(audio.src.startsWith('blob:'), 'The first PCM slice should start playing on the main deck');
    assert.equal(calls.preloadNext.length, 1, 'Prefetching the next track should start as soon as the DSD first slice plays');
    assert.deepEqual(calls.preloadNext[0], [true], 'The DSD prefetch should force preloadNext like finishPlaybackStart does');
    await playPromise;
  }

  // File DSD ngắn (không có lát đầu): 'done' về, file PCM đầy đủ phát
  // được thì prefetch bài kế ngay; 'done' về nhưng chưa phát thì chưa.
  {
    const harness = makeHarness();
    const {context, track, audio, calls} = harness;
    const playPromise = context.playDsdTrack(track, 1, 0);
    await tick(); await tick();
    const worker = harness.getWorker();
    worker.onmessage({data: doneMessage()});
    await tick(); await tick();
    assert.ok(audio.src.startsWith('blob:'), 'The short DSD file should play from the full decoded PCM');
    assert.equal(calls.preloadNext.length, 1, 'Prefetching the next track should start as soon as a short DSD file plays');
    assert.deepEqual(calls.preloadNext[0], [true], 'The short-DSD prefetch should force preloadNext');
    await playPromise;
  }

  // Lát đầu phát lỗi (play() reject): không prefetch, bài bị bỏ qua như
  // trước — prefetch chỉ chạy khi phát thật sự bắt đầu.
  {
    const harness = makeHarness();
    const {context, track, audio, calls} = harness;
    audio.playReject = new Error('NotSupportedError');
    const playPromise = context.playDsdTrack(track, 1, 0);
    await tick(); await tick();
    const worker = harness.getWorker();
    worker.onmessage({data: {type: 'first-slice', blob: new Blob(['slice-pcm']), duration: 2.02, sliceDecodeMs: 120}});
    await tick(); await tick();
    assert.equal(calls.preloadNext.length, 0, 'A failed first slice must not prefetch the next track');
    assert.equal(calls.skipped.length, 1, 'A failed first slice should still skip the track');
    await playPromise;
  }

  // Nối dây tĩnh: cả hai đường phát của DSD (lát đầu + file ngắn) đều
  // gọi preloadNext(true) sau khi phát thành công — lệnh của lát đầu giờ
  // nằm trong helper dùng chung playDsdFirstSlice, không còn trong
  // playDsdTrack nữa nên đếm gộp cả hai hàm.
  const dsdSource = extractFunction(appCode, 'playDsdTrack') + extractFunction(appCode, 'playDsdFirstSlice');
  assert.equal((dsdSource.match(/preloadNext\(true\)/g) || []).length, 2, 'Both DSD playback paths (first slice and short file) should prefetch the next track');
})().catch(error => { console.error(error); process.exit(1); });
