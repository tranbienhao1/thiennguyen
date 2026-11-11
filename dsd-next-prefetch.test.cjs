'use strict';

// Pha C — prefetch bài kế khi bài kế là DSD (ưu tiên Melissa chọn 23:23,
// tiếp nối lần 18:30 đã prefetch bài kế khi bài hiện tại là DSD):
// preloadNext cũ bỏ qua hẳn bài kế là DSD (điều kiện next.isDsd trong
// guard đầu hàm) vì DSD không phát được qua deck chờ — cần giải mã worker
// sang PCM trước. Hậu quả: hết bài hiện tại mới bắt đầu tải toàn file
// DSD từ Drive rồi mới giải mã, bấm Next / tự chuyển bài phải chờ lâu
// (đặc biệt với Drive chậm). Bản sửa tải trước file DSD vào track.file
// qua preloadDsdNext để playTrack bỏ qua bước tải và giải mã ngay khi
// chuyển bài; không chạm deck chờ, không tải lại khi file đã có hoặc
// đang tải, lỗi tải thì để playTrack thử lại lúc chuyển bài.

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

function makeHarness({next, currentId = 'flac-now'} = {}) {
  const calls = {loads: 0, cleared: 0, released: []};
  const currentTrack = {id: 'flac-now', format: 'FLAC', title: 'Intro', source: 'google', url: 'blob:https://example/now'};
  const state = {
    tracks: [currentTrack, next], currentId, autoplay: true, repeat: 0, shuffle: false,
    queueTrackIds: [], preloadTrackId: null, preloadBusyId: null, preloadReadyUrl: null,
    preloadGeneration: 0, crossfadeUntil: 0,
    context: {currentTime: 100}, deckA: makeDeck(), deckB: makeDeck(), activeDeck: null,
    objectUrls: new Set(),
  };
  state.activeDeck = state.deckA;
  const audio = new FakeAudio();
  const standbyAudio = new FakeAudio();
  const location = {href: 'https://example.test/thiennguyen/'};
  const clearStalePreload = () => {
    calls.cleared++;
    ++state.preloadGeneration; state.preloadTrackId = null; state.preloadReadyUrl = null; state.preloadBusyId = null;
  };
  const factory = new Function('state', 'audio', 'standbyAudio', 'location', 'queueTracks', 'clearStalePreload', 'releaseUnusedCloudUrl', 'console',
    `${extractFunction(appCode, 'queueIndex')}\n${extractFunction(appCode, 'preloadDsdNext')}\n${extractFunction(appCode, 'preloadNext')}\nreturn preloadNext;`);
  const preloadNext = factory(state, audio, standbyAudio, location, () => [], clearStalePreload,
    item => calls.released.push(item && item.id), console);
  return {calls, state, audio, standbyAudio, currentTrack, preloadNext};
}

const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // Bài kế là DSD cloud: tải trước file vào track.file, ghi preloadTrackId,
  // không chạm deck chờ (DSD không phát qua deck), xong tải thì hết bận.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; await tick(); next.file = new Blob(['fake-dsd-bytes']); };
    await harness.preloadNext(true);
    assert.equal(harness.calls.loads, 1, 'The DSD next track should be downloaded once in the background');
    assert.ok(next.file, 'The downloaded DSD file should be kept on the track so playTrack can decode it immediately');
    assert.equal(harness.state.preloadTrackId, 'dsd-next', 'The DSD next track should be recorded as preloaded');
    assert.equal(harness.state.preloadBusyId, null, 'The preload should no longer be busy once the DSD file is downloaded');
    assert.equal(harness.standbyAudio.src, '', 'Prefetching a DSD track must not touch the standby deck (DSD cannot play through it)');
    assert.equal(harness.state.preloadReadyUrl, null, 'A DSD prefetch has no deck URL to mark ready');
  }

  // File đã có (tải trước đó hoặc tải lại trang vẫn giữ file): không tải lại.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: new Blob(['fake-dsd-bytes'])};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; };
    await harness.preloadNext(true);
    await harness.preloadNext(true);
    assert.equal(harness.calls.loads, 0, 'A DSD next track that already has its file must not be downloaded again');
    assert.equal(harness.state.preloadTrackId, 'dsd-next', 'An already-downloaded DSD next track should still be recorded as preloaded');
  }

  // Đang tải dở: lần gọi thứ hai (timeupdate gọi liên tục) không tải trùng.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null};
    const harness = makeHarness({next});
    let resolveLoad;
    const gate = new Promise(resolve => { resolveLoad = resolve; });
    next.load = async () => { harness.calls.loads++; await gate; next.file = new Blob(['fake-dsd-bytes']); };
    const first = harness.preloadNext(true);
    const second = harness.preloadNext(true);
    resolveLoad();
    await first; await second;
    assert.equal(harness.calls.loads, 1, 'Concurrent preload calls must not start a second DSD download');
    assert.ok(next.file, 'The single in-flight download should still finish and keep the file');
    assert.equal(harness.state.preloadBusyId, null, 'The preload should clear its busy flag once the download finishes');
  }

  // Tải lỗi (Drive hết phiên, mạng rớt): không ném ra ngoài, hết bận để
  // lần gọi sau thử lại; playTrack sẽ thử tải lại lúc chuyển bài.
  {
    const next = {id: 'dsd-next', format: 'DSF', isDsd: true, source: 'google', title: 'DSD kế', file: null};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; throw new Error('Phiên Google Drive đã hết hạn'); };
    await harness.preloadNext(true);
    assert.equal(harness.calls.loads, 1, 'A failed DSD preload should attempt the download once');
    assert.equal(harness.state.preloadBusyId, null, 'A failed DSD preload must clear its busy flag');
    assert.equal(harness.state.preloadTrackId, 'dsd-next', 'A failed DSD preload keeps the track registered so the next call retries it');
    await harness.preloadNext(true);
    assert.equal(harness.calls.loads, 2, 'The next preload call should retry a failed DSD download');
  }

  // Dữ liệu biên: bài kế là DSD local, đã có file gốc, không có load —
  // không làm gì, không lỗi.
  {
    const next = {id: 'dsd-local', format: 'DFF', isDsd: true, source: 'local', title: 'DSD local', file: new Blob(['local-dsd'])};
    const harness = makeHarness({next});
    await harness.preloadNext(true);
    assert.equal(harness.state.preloadTrackId, null, 'A local DSD next track without a loader must not be registered as preloaded');
    assert.equal(harness.standbyAudio.src, '', 'A local DSD next track must not touch the standby deck');
  }

  // Hồi quy: bài kế không phải DSD vẫn preload qua deck chờ như trước.
  {
    const next = {id: 'flac-next', format: 'FLAC', isDsd: false, source: 'google', title: 'FLAC kế', url: ''};
    const harness = makeHarness({next});
    next.load = async () => { harness.calls.loads++; next.url = 'blob:https://example/flac-next'; };
    await harness.preloadNext(true);
    assert.equal(harness.calls.loads, 1, 'A non-DSD next track should still be loaded for preload');
    assert.equal(harness.standbyAudio.src, 'blob:https://example/flac-next', 'A non-DSD next track should still be preloaded onto the standby deck');
    assert.equal(harness.state.preloadTrackId, 'flac-next', 'A non-DSD next track should still be recorded as preloaded');
    assert.equal(harness.state.preloadBusyId, null, 'A non-DSD preload should clear its busy flag');
  }

  // Nối dây tĩnh: preloadNext phải rẽ sang preloadDsdNext khi bài kế là
  // DSD, và guard cũ bỏ qua DSD không còn chặn đường này nữa.
  const preloadSource = extractFunction(appCode, 'preloadNext');
  assert.ok(preloadSource.includes('preloadDsdNext(next)'), 'preloadNext should hand a DSD next track to preloadDsdNext');
  assert.ok(!preloadSource.includes('next.id === state.currentId || next.isDsd'), 'The old guard that skipped DSD next tracks must be gone');
  assert.ok(appCode.includes('async function preloadDsdNext(next)'), 'preloadDsdNext should be defined in the app script');
})().catch(error => { console.error(error); process.exit(1); });
