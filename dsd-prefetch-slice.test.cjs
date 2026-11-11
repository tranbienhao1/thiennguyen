'use strict';

// Pha C — prefetch + cache lát đầu bài kế khi bài kế là DSD (tiếp nối
// lần 19:18 đã tải trước file DSD vào track.file qua preloadDsdNext):
// tải trước file mới chỉ bỏ bước tải từ Drive; khi chuyển bài,
// playDsdTrack vẫn phải chờ worker giải mã ~2 giây đầu mới nghe thấy
// tiếng (lát PCM đầu về qua message 'first-slice'). Bản sửa giải mã
// trước lát PCM đầu trong worker nền riêng ngay sau khi file DSD tải
// xong rồi ghi vào firstSliceCache (cùng meta tốc độ xuất/bit depth
// như đường phát DSD), để khi chuyển bài playDsdTrack đọc cache và
// phát ngay. Worker nền dừng ngay sau lát đầu — không giải mã toàn
// file ở nền để khỏi nhân đôi CPU với worker của bài đang phát; lát
// cache lỗi/hết hạn thì playDsdTrack giải mã lại như trước.

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function makeDeck() { return {router: {gain: {setTargetAtTime() {}}}}; }
class FakeAudio {
  constructor() { this.src = ''; this.volume = 0.8; this.muted = false; this.readyState = 0; this.pauseCalls = 0; this.loads = 0; }
  pause() { this.pauseCalls++; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; }
}

function makeHarness({next, currentId = 'flac-now', cachedSlice = null, protocol = 'https:'} = {}) {
  const calls = {loads: 0, cacheReads: 0, cacheWrites: []};
  const workers = [];
  class FakeWorker {
    constructor(url) { this.url = String(url); this.posted = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.posted.push(message); }
    terminate() { this.terminated = true; }
    deliver(message) { this.onmessage({data: message}); }
    fail(error) { if (typeof this.onerror === 'function') this.onerror(error); }
  }
  const currentTrack = {id: 'flac-now', format: 'FLAC', title: 'Intro', source: 'google', url: 'blob:https://example/now'};
  const state = {
    tracks: [currentTrack, next], currentId, autoplay: true, repeat: 0, shuffle: false,
    queueTrackIds: [], preloadTrackId: null, preloadBusyId: null, preloadReadyUrl: null,
    preloadGeneration: 0, preloadDsdSliceTrackId: null, preloadDsdSliceWorker: null,
    dsdOutputRate: 44100, dsdOutputDepth: 16, crossfadeUntil: 0,
    context: {currentTime: 100}, deckA: makeDeck(), deckB: makeDeck(), activeDeck: null,
    objectUrls: new Set(),
  };
  state.activeDeck = state.deckA;
  const audio = new FakeAudio();
  const standbyAudio = new FakeAudio();
  const location = {href: 'https://example.test/thiennguyen/', protocol};
  const clearStalePreload = () => {
    ++state.preloadGeneration; state.preloadTrackId = null; state.preloadReadyUrl = null; state.preloadBusyId = null;
  };
  const getCachedFirstSlice = async () => { calls.cacheReads++; await Promise.resolve(); return cachedSlice; };
  const cacheFirstSlice = (track, blob, totalBytes, maxBytes, meta) => {
    calls.cacheWrites.push({track, blob, totalBytes, maxBytes, meta});
    return Promise.resolve(true);
  };
  const library = {DSD_FIRST_SLICE_CACHE_MAX_BYTES: 3 * 1024 * 1024};
  const factory = new Function('state', 'audio', 'standbyAudio', 'location', 'queueTracks', 'clearStalePreload', 'releaseUnusedCloudUrl', 'console',
    'getCachedFirstSlice', 'cacheFirstSlice', 'Worker', 'library', 'dsdWorkerBaseUrl',
    `${extractFunction(appCode, 'queueIndex')}\n${extractFunction(appCode, 'stopPrefetchDsdSlice')}\n${extractFunction(appCode, 'prefetchDsdFirstSlice')}\n${extractFunction(appCode, 'preloadDsdNext')}\n${extractFunction(appCode, 'preloadNext')}\nreturn {preloadNext, prefetchDsdFirstSlice, stopPrefetchDsdSlice};`);
  const api = factory(state, audio, standbyAudio, location, () => [], clearStalePreload,
    () => {}, console, getCachedFirstSlice, cacheFirstSlice, FakeWorker, library, 'https://example.test/');
  return {calls, workers, state, audio, standbyAudio, currentTrack, ...api};
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async (count = 4) => { for (let i = 0; i < count; i++) await tick(); };

(async () => {
  // Bài kế là DSD cloud, tải xong, chưa có lát cache: mở worker nền
  // giải mã lát đầu; lát về thì ghi cache DSD (giới hạn 3 MB, meta tốc
  // độ xuất/bit depth) rồi dừng worker ngay, không giải mã toàn file.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null, size: 20123456};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.calls.loads, 1, 'The DSD next track should still be downloaded once in the background');
    assert.equal(harness.workers.length, 1, 'A slice-prefetch worker should start once the DSD file is downloaded');
    const worker = harness.workers[0];
    assert.ok(worker.url.endsWith('dsd-worker.js'), 'The slice-prefetch worker should decode with dsd-worker.js');
    assert.equal(worker.posted.length, 1, 'The slice-prefetch worker should receive exactly one decode request');
    assert.equal(worker.posted[0].file, next.file, 'The slice-prefetch worker should decode the downloaded DSD file');
    assert.equal(worker.posted[0].format, 'dsf', 'The slice-prefetch worker should receive the lowercase DSD format');
    assert.equal(worker.posted[0].targetRate, 44100, 'The slice-prefetch worker should decode at the current DSD output rate');
    assert.equal(worker.posted[0].bitDepth, 16, 'The slice-prefetch worker should decode at the current DSD output depth');
    const slice = new Blob(['fake-pcm-slice']);
    worker.deliver({type: 'first-slice', blob: slice});
    assert.equal(harness.calls.cacheWrites.length, 1, 'The decoded first slice should be written to the first-slice cache once');
    assert.equal(harness.calls.cacheWrites[0].track, next, 'The cached slice should belong to the DSD next track');
    assert.equal(harness.calls.cacheWrites[0].blob, slice, 'The cached slice should be the PCM blob from the worker');
    assert.equal(harness.calls.cacheWrites[0].totalBytes, 20123456, 'The cached slice should record the original DSD file size');
    assert.equal(harness.calls.cacheWrites[0].maxBytes, 3 * 1024 * 1024, 'A DSD first slice should use the 3 MB DSD cache limit');
    assert.deepEqual(harness.calls.cacheWrites[0].meta, {dsdRate: 44100, dsdDepth: 16}, 'The cached slice should record the decode settings so it expires when they change');
    assert.equal(worker.terminated, true, 'The slice-prefetch worker should stop right after the first slice instead of decoding the whole file');
    assert.equal(harness.state.preloadDsdSliceWorker, null, 'The prefetch worker should be cleared from state once it stops');
    assert.equal(harness.state.preloadDsdSliceTrackId, null, 'The prefetch track id should be cleared once the slice is cached');
  }

  // Lát đầu đã có trong cache: không mở worker giải mã lại.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null, size: 20123456};
    const harness = makeHarness({next, cachedSlice: new Blob(['cached-pcm-slice'])});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.calls.loads, 1, 'The DSD file should still be downloaded when its slice is already cached');
    assert.equal(harness.calls.cacheReads, 1, 'The slice cache should be checked before decoding');
    assert.equal(harness.workers.length, 0, 'No slice-prefetch worker should start when the first slice is already cached');
    assert.equal(harness.calls.cacheWrites.length, 0, 'A cached slice must not be rewritten');
  }

  // Worker báo lỗi giải mã: dừng worker, không ghi cache, không ném lỗi.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null, size: 20123456};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.workers.length, 1, 'A slice-prefetch worker should start before the error case');
    harness.workers[0].deliver({type: 'error', message: 'Header DSF không hợp lệ.'});
    assert.equal(harness.workers[0].terminated, true, 'A failed slice-prefetch worker should stop');
    assert.equal(harness.calls.cacheWrites.length, 0, 'A failed slice decode must not write to the cache');
    assert.equal(harness.state.preloadDsdSliceWorker, null, 'A failed slice prefetch should clear the worker from state');
  }

  // Đổi bài kế trước khi lát đầu về (generation đổi): lát về muộn thì
  // bỏ qua, không ghi nhầm cache cho bài không còn là bài kế.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null, size: 20123456};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.workers.length, 1, 'A slice-prefetch worker should start before the stale-generation case');
    ++harness.state.preloadGeneration;
    harness.workers[0].deliver({type: 'first-slice', blob: new Blob(['stale-pcm-slice'])});
    assert.equal(harness.calls.cacheWrites.length, 0, 'A first slice that arrives after the preload generation changed must not be cached');
    assert.equal(harness.workers[0].terminated, true, 'A stale slice-prefetch worker should stop when its late message arrives');
  }

  // Hai lần gọi prefetch đua nhau (timeupdate gọi liên tục): chỉ một
  // worker được mở — lần thứ hai kiểm tra lại sau khi đọc cache.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: new Blob(['fake-dsd-bytes']), size: 20123456};
    const harness = makeHarness({next});
    const first = harness.prefetchDsdFirstSlice(next, harness.state.preloadGeneration);
    const second = harness.prefetchDsdFirstSlice(next, harness.state.preloadGeneration);
    await first; await second; await flush();
    assert.equal(harness.workers.length, 1, 'Concurrent slice-prefetch calls for the same track must open only one worker');
  }

  // File DSD đã có sẵn (tải trước đó): vẫn prefetch lát đầu, không tải lại.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: new Blob(['fake-dsd-bytes']), size: 20123456};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.calls.loads, 0, 'A DSD next track that already has its file must not be downloaded again');
    assert.equal(harness.workers.length, 1, 'A DSD next track that already has its file should still get its first slice prefetched');
  }

  // Dữ liệu biên: mở qua file:// thì Worker không chạy được — không mở
  // worker, không lỗi.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null, size: 20123456};
    const harness = makeHarness({next, protocol: 'file:'});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    await flush();
    assert.equal(harness.workers.length, 0, 'No slice-prefetch worker should start when the page is not served over HTTP(S)');
    assert.equal(harness.calls.cacheWrites.length, 0, 'No slice should be cached when the prefetch never ran');
  }

  // Nối dây tĩnh: preloadDsdNext gọi prefetch sau khi tải xong (cả hai
  // nhánh file đã có và tải xong), và playTrack dừng worker prefetch
  // khi bài bắt đầu phát để khỏi giải mã trùng với worker của bài đó.
  const preloadDsdSource = extractFunction(appCode, 'preloadDsdNext');
  assert.ok(preloadDsdSource.includes('prefetchDsdFirstSlice(next, generation)'), 'preloadDsdNext should prefetch the first slice after the DSD file is downloaded');
  assert.ok(preloadDsdSource.includes('prefetchDsdFirstSlice(next, state.preloadGeneration)'), 'preloadDsdNext should also prefetch the first slice when the DSD file is already present');
  assert.ok(appCode.includes('async function prefetchDsdFirstSlice(next, generation)'), 'prefetchDsdFirstSlice should be defined in the app script');
  assert.ok(appCode.includes('function stopPrefetchDsdSlice()'), 'stopPrefetchDsdSlice should be defined in the app script');
  const playTrackSource = extractFunction(appCode, 'playTrack');
  assert.ok(playTrackSource.includes('stopPrefetchDsdSlice()'), 'playTrack should stop the slice-prefetch worker when a track starts playing');
})().catch(error => { console.error(error); process.exit(1); });
