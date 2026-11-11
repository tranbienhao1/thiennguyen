'use strict';

// Pha C — cache lát đầu DSD vào IndexedDB: worker ghi lát PCM đầu (~2 giây)
// vào firstSliceCache (giới hạn riêng 3 MB vì lát 192 kHz/24-bit nặng
// ~2.3 MB, vượt 1 MB của lát FLAC), lần phát lại sau khi tải lại trang
// phát ngay từ cache qua helper dùng chung playDsdFirstSlice; lát cache
// phát lỗi thì worker giải mã lại từ đầu.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

// Lát PCM đầu DSD 192 kHz/24-bit stereo ~2 giây nặng ~2.3 MB, giới hạn
// cache riêng phải đủ lớn (3 MB) nhưng vẫn trong ngân sách chung 20 MB.
assert.strictEqual(library.DSD_FIRST_SLICE_CACHE_MAX_BYTES, 3 * 1024 * 1024, 'The DSD first-slice cache limit should cover a 192 kHz 24-bit slice');

// Fake IndexedDB: Map trong RAM, request giả bắn onsuccess bất đồng bộ
// (qua queueMicrotask) như request thật để sliceCacheRequest resolve được.
function fakeRequest(result) {
  const request = {result, error: null};
  let handler = null;
  Object.defineProperty(request, 'onsuccess', {
    get: () => handler,
    set: fn => { handler = fn; if (typeof fn === 'function') queueMicrotask(() => fn()); },
  });
  request.onerror = null;
  return request;
}
function makeSliceCacheHarness() {
  const rows = new Map();
  const store = {
    get: key => fakeRequest(rows.has(key) ? rows.get(key) : undefined),
    put: entry => { rows.set(entry.key, entry); return fakeRequest(entry.key); },
    delete: key => { rows.delete(key); return fakeRequest(undefined); },
    getAll: () => fakeRequest([...rows.values()]),
  };
  const state = {db: {objectStoreNames: {contains: () => true}, transaction: () => ({objectStore: () => store})}};
  return {rows, state};
}
const cacheStart = appCode.indexOf('function sliceCacheTransaction(mode) {');
const cacheEnd = appCode.indexOf('function persistCloudCatalog(tracks) {', cacheStart);
assert.ok(cacheStart >= 0 && cacheEnd > cacheStart, 'The first-slice cache helpers should exist for regression checks');
function makeCacheFns(state) {
  return new Function('library', 'state', 'FIRST_SLICE_CACHE_STORE', `${appCode.slice(cacheStart, cacheEnd)}\nreturn {sliceCacheTransaction, sliceCacheRequest, getCachedFirstSlice, pruneSliceCache, cacheFirstSlice};`)(
    library, state, 'firstSliceCache',
  );
}
const dsdTrack = {id: 'google:dsd1', source: 'google', remoteId: 'dsd1', name: 'album.dsf', size: 19800000};
const dsdSliceBlob = new Blob([new Uint8Array(2304000)], {type: 'audio/wav'});
const flacSliceBlob = new Blob([new Uint8Array(1048576)], {type: 'audio/flac'});
const bigFlacSliceBlob = new Blob([new Uint8Array(1572864)], {type: 'audio/flac'});

(async () => {
  // Ghi lát DSD 2.3 MB với giới hạn riêng 3 MB: phải ghi được (code cũ
  // chỉ cho 1 MB nên trả false), đọc lại được đúng blob.
  {
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    assert.equal(await cache.cacheFirstSlice(dsdTrack, dsdSliceBlob, dsdTrack.size, library.DSD_FIRST_SLICE_CACHE_MAX_BYTES), true, 'A 2.3 MB DSD first slice should fit the 3 MB DSD cache limit');
    assert.equal(rows.size, 1, 'A cached DSD first slice should create one store entry');
    const cached = await cache.getCachedFirstSlice(dsdTrack);
    assert.ok(cached && cached.size === 2304000, 'A cached DSD first slice should read back with its full size');
    assert.equal(await cache.getCachedFirstSlice({...dsdTrack, size: 19900000}), null, 'A cached DSD first slice should expire when the source file size changes');
  }
  // Lát FLAC giữ giới hạn cũ 1 MB: lát 1 MB ghi được, lát 1.5 MB bị từ chối.
  {
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    assert.equal(await cache.cacheFirstSlice({id: 'google:f1', source: 'google', remoteId: 'f1', name: 'a.flac', size: 12000000}, flacSliceBlob, 12000000), true, 'A 1 MB FLAC first slice should still cache under the default limit');
    assert.equal(await cache.cacheFirstSlice({id: 'google:f2', source: 'google', remoteId: 'f2', name: 'b.flac', size: 13000000}, bigFlacSliceBlob, 13000000), false, 'A 1.5 MB FLAC first slice should still be rejected by the default 1 MB limit');
    assert.equal(rows.size, 1, 'Only the fitting FLAC slice should be stored');
    assert.equal(await cache.getCachedFirstSlice({id: 'google:missing', source: 'google', remoteId: 'missing', name: 'c.flac', size: 1}), null, 'A track with no cached slice should read back as empty');
    assert.equal(await cache.cacheFirstSlice({id: 'google:f3', source: 'google', remoteId: 'f3', name: 'd.flac', size: 1}, new Blob([]), 1), false, 'An empty slice should not be cached');
  }
  // Ngân sách chung 20 MB vẫn tính đúng với lát DSD lớn: 10 lát 2.3 MB
  // vượt 20 MB nên lát cũ nhất bị loại; dọn kho qua IndexedDB giả cũng
  // chỉ giữ 20 mục mới nhất.
  {
    const entries = Array.from({length: 10}, (_, index) => ({key: `k${index}`, size: 2304000, savedAt: index + 1}));
    assert.deepEqual(library.pruneSliceCacheEntries(entries, 20, 20 * 1024 * 1024), ['k0'], 'Ten 2.3 MB DSD slices should evict only the oldest slice over the 20 MB budget');
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    for (let index = 0; index < 21; index++) rows.set(`k${index}`, {key: `k${index}`, blob: flacSliceBlob, size: 1048576, totalBytes: 1, savedAt: index + 1});
    cache.pruneSliceCache();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rows.size, 20, 'Pruning the slice store should keep at most 20 entries');
    assert.ok(!rows.has('k0'), 'Pruning the slice store should drop the oldest entry first');
  }

  // Helper phát lát DSD dùng chung: chạy thật với deck giả, đồng hồ giả.
  const helperStart = appCode.indexOf('async function playDsdFirstSlice(track, sliceBlob, generation, playRequestedAt) {');
  const helperEnd = appCode.indexOf('async function playDsdTrack(track, generation, playRequestedAt) {', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'The shared DSD first-slice player should exist for regression checks');
  function makePlayHarness({playImpl} = {}) {
    const elements = {};
    const calls = {displayed: [], recorded: [], history: [], rendered: 0, preloaded: 0, setup: 0};
    const revoked = [];
    let urlCounter = 0;
    class FakeURL {
      static createObjectURL() { return `blob:fake/dsd-slice-${++urlCounter}`; }
      static revokeObjectURL(url) { revoked.push(url); }
    }
    const audio = {src: '', muted: false, paused: false, playCalls: 0, play: playImpl || (async function () { audio.playCalls++; })};
    const standbyAudio = {src: '', muted: false};
    const state = {objectUrls: new Set(), dsdUrl: null, dsdTrackId: null, playGeneration: 1, context: {state: 'running', resume: async () => {}}};
    const playDsdFirstSlice = new Function('state', 'audio', 'standbyAudio', 'URL', 'setupAudio', 'displayTrack', 'recordTimeToFirstAudio', 'recordHistory', 'scheduleTrackRender', 'preloadNext', '$', `${appCode.slice(helperStart, helperEnd)}\nreturn playDsdFirstSlice;`)(
      state, audio, standbyAudio, FakeURL,
      () => { calls.setup++; },
      track => { calls.displayed.push(track.id); },
      (track, startedAt, now, mode) => { calls.recorded.push(mode); return 100; },
      track => { calls.history.push(track.id); },
      () => { calls.rendered++; },
      () => { calls.preloaded++; },
      id => (elements[id] ||= {textContent: ''}),
    );
    return {elements, calls, revoked, audio, standbyAudio, state, playDsdFirstSlice};
  }
  // Lát cache phát được: trả URL, đặt cờ lát đầu, ghi số đo, tải bài kế.
  {
    const harness = makePlayHarness();
    const track = {id: 'google:dsd1', source: 'google', remoteId: 'dsd1', name: 'album.dsf', size: 19800000};
    const sliceUrl = await harness.playDsdFirstSlice(track, dsdSliceBlob, 1, 1000);
    assert.equal(sliceUrl, 'blob:fake/dsd-slice-1', 'Playing a cached DSD slice should return its object URL');
    assert.equal(track.url, sliceUrl, 'Playing a cached DSD slice should set it as the track URL');
    assert.equal(track.firstSlicePlayback, true, 'Playing a cached DSD slice should mark slice playback for the ended/error guards');
    assert.equal(track.lastSlicePosition, null, 'Playing a cached DSD slice should clear the saved slice position');
    assert.equal(harness.state.dsdUrl, sliceUrl, 'Playing a cached DSD slice should register it as the decoded DSD URL');
    assert.equal(harness.audio.src, sliceUrl, 'Playing a cached DSD slice should set it on the deck');
    assert.equal(harness.standbyAudio.muted, true, 'Playing a cached DSD slice should mute the standby deck');
    assert.deepEqual(harness.calls.recorded, ['dsd'], 'Playing a cached DSD slice should record time-to-first-audio as a DSD slice');
    assert.equal(harness.elements['play-button'].textContent, 'Ⅱ', 'Playing a cached DSD slice should show the pause icon');
    assert.deepEqual(harness.calls.history, ['google:dsd1'], 'Playing a cached DSD slice should record listening history');
    assert.equal(harness.calls.preloaded, 1, 'Playing a cached DSD slice should preload the next track');
    assert.ok(harness.state.objectUrls.has(sliceUrl), 'Playing a cached DSD slice should track its object URL');
  }
  // Lát phát lỗi (play() reject): ném lỗi, dọn URL để lát worker còn phát được.
  {
    const harness = makePlayHarness({playImpl: async () => { throw new Error('decode error'); }});
    const track = {id: 'google:dsd2', source: 'google', remoteId: 'dsd2', name: 'b.dsf', size: 10000000};
    await assert.rejects(harness.playDsdFirstSlice(track, dsdSliceBlob, 1, 1000), /decode error/, 'A failing DSD slice should surface the playback error');
    assert.equal(harness.state.dsdUrl, null, 'A failing DSD slice should clear the decoded URL so the worker slice can still play');
    assert.deepEqual(harness.revoked, ['blob:fake/dsd-slice-1'], 'A failing DSD slice should revoke its object URL');
    assert.equal(track.url, '', 'A failing DSD slice should clear the track URL');
    assert.equal(track.firstSlicePlayback, false, 'A failing DSD slice should clear the slice-playback flag');
  }
  // Dữ liệu biên: blob rỗng, thiếu context, generation đã đổi — đều trả
  // null mà không phát, không tạo URL.
  {
    const harness = makePlayHarness();
    const track = {id: 'google:dsd3', source: 'google', remoteId: 'dsd3', name: 'c.dsf', size: 10000000};
    assert.equal(await harness.playDsdFirstSlice(track, new Blob([]), 1, 1000), null, 'An empty DSD slice should not play');
    assert.equal(harness.audio.playCalls, 0, 'An empty DSD slice should not touch the deck');
    harness.state.context = null;
    assert.equal(await harness.playDsdFirstSlice(track, dsdSliceBlob, 1, 1000), null, 'A DSD slice should not play without an audio context');
    harness.state.context = {state: 'running', resume: async () => {}};
    harness.state.playGeneration = 2;
    assert.equal(await harness.playDsdFirstSlice(track, dsdSliceBlob, 1, 1000), null, 'A stale generation should not play its DSD slice');
    assert.equal(harness.state.objectUrls.size, 0, 'A stale generation should not create a slice URL');
  }

  // Đường nối: worker ghi cache khi lát đầu về, playDsdTrack đọc cache
  // trước khi tạo worker; số lần ghi số đo 'dsd' vẫn đúng 2 chỗ.
  assert.ok(appCode.includes('cacheFirstSlice(track, message.blob, track.size, library.DSD_FIRST_SLICE_CACHE_MAX_BYTES, {dsdRate: state.dsdOutputRate, dsdDepth: state.dsdOutputDepth})'), 'The worker first-slice handler should cache the decoded PCM slice with its decode settings');
  const dsdStart = appCode.indexOf('async function playDsdTrack(track, generation, playRequestedAt) {');
  const dsdEnd = appCode.indexOf('function playNext(', dsdStart);
  assert.ok(dsdStart >= 0 && dsdEnd > dsdStart, 'DSD playback should exist for regression checks');
  const dsdBody = appCode.slice(dsdStart, dsdEnd);
  assert.ok(dsdBody.includes('const cachedSlice = await getCachedFirstSlice(track, {dsdRate: state.dsdOutputRate, dsdDepth: state.dsdOutputDepth});'), 'DSD playback should read the cached first slice with the current decode settings before decoding');
  assert.ok(dsdBody.includes('playDsdFirstSlice(track, cachedSlice, generation, playRequestedAt)'), 'DSD playback should play the cached slice through the shared helper');
  assert.ok(dsdBody.indexOf('getCachedFirstSlice(track)') < dsdBody.indexOf('new Worker(new URL(\'dsd-worker.js\''), 'The cached DSD slice should play before the worker starts decoding');
  assert.equal(appCode.split("recordTimeToFirstAudio(track, playRequestedAt, performance.now(), 'dsd');").length - 1, 2, 'Both DSD playback starts (first slice and short-file full audio) should record time-to-first-audio');

  console.log('DSD first-slice cache tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
