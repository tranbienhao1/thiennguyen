'use strict';

// Pha C — cache lát đầu DSD hết hạn khi thông số giải mã đổi: lát DSD
// là PCM đã giải mã nên chỉ hợp lệ với đúng tốc độ xuất PCM + bit depth
// lúc ghi (khác lát FLAC là byte gốc, không phụ thuộc thông số giải mã).
// Đổi tốc độ xuất (88.2 -> 176.4 kHz) hay bit depth (16 -> 24-bit) sau
// khi lát đã cache thì lần phát lại phải giải mã lại thay vì phát nhầm
// lát cũ ~2 giây đầu trong khi Phòng nghe hiện thông số mới; mục cache
// cũ (ghi trước bản này, không có meta) cũng hết hạn một lần rồi ghi
// lại meta mới. Kích thước file gốc đổi thì vẫn hết hạn như lát FLAC.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

// Hàm thuần đối chiếu meta cache (library-utils.js).
assert.equal(typeof library.sliceCacheMetaMatches, 'function', 'The slice cache meta matcher should be exported');
const match = library.sliceCacheMetaMatches;
assert.equal(match(null, undefined), true, 'No decode expectation (FLAC slice) should always match');
assert.equal(match(null, null), true, 'A null expectation should always match');
assert.equal(match({dsdRate: 88200, dsdDepth: 16}, undefined), true, 'A DSD entry should match when no settings are expected');
assert.equal(match({dsdRate: 88200, dsdDepth: 16}, {dsdRate: 88200, dsdDepth: 16}), true, 'A DSD slice should match when written with the current decode settings');
assert.equal(match({dsdRate: '88200', dsdDepth: '16'}, {dsdRate: 88200, dsdDepth: 16}), true, 'String-encoded settings should coerce to the same numbers');
assert.equal(match(null, {dsdRate: 88200, dsdDepth: 16}), false, 'An entry without meta (written before this change) should expire when settings are expected');
assert.equal(match(undefined, {dsdRate: 88200, dsdDepth: 16}), false, 'A missing entry meta should expire when settings are expected');
assert.equal(match({}, {dsdRate: 88200, dsdDepth: 16}), false, 'An empty entry meta should expire when settings are expected');
assert.equal(match('nope', {dsdRate: 88200, dsdDepth: 16}), false, 'A non-object entry meta should expire when settings are expected');
assert.equal(match({dsdRate: 176400, dsdDepth: 16}, {dsdRate: 88200, dsdDepth: 16}), false, 'A DSD slice should expire when the PCM output rate changed');
assert.equal(match({dsdRate: 88200, dsdDepth: 24}, {dsdRate: 88200, dsdDepth: 16}), false, 'A DSD slice should expire when the output bit depth changed');
assert.equal(match({dsdRate: NaN, dsdDepth: 16}, {dsdRate: 88200, dsdDepth: 16}), false, 'A DSD slice with a non-numeric rate should expire');
assert.equal(match({dsdRate: 88200}, {dsdRate: 88200, dsdDepth: 16}), false, 'A DSD slice missing the bit depth should expire');
assert.equal(match({dsdRate: 88200, dsdDepth: 16}, 'nope'), true, 'A non-object expectation should not expire anything (FLAC-style read)');

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
const settings88200 = {dsdRate: 88200, dsdDepth: 16};

(async () => {
  // Ghi lát DSD kèm meta 88.2 kHz/16-bit: đọc lại với đúng thông số thì
  // được blob; đổi tốc độ xuất hay bit depth thì hết hạn (null) dù kích
  // thước file gốc không đổi; đọc không kỳ vọng (kiểu FLAC) vẫn được.
  {
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    assert.equal(await cache.cacheFirstSlice(dsdTrack, dsdSliceBlob, dsdTrack.size, library.DSD_FIRST_SLICE_CACHE_MAX_BYTES, settings88200), true, 'A DSD first slice with decode settings should cache');
    const entry = [...rows.values()][0];
    assert.deepEqual(entry.meta, {dsdRate: 88200, dsdDepth: 16}, 'A cached DSD slice should store its decode settings');
    const cached = await cache.getCachedFirstSlice(dsdTrack, settings88200);
    assert.ok(cached && cached.size === 2304000, 'A cached DSD slice should read back with the same decode settings');
    assert.equal(await cache.getCachedFirstSlice(dsdTrack, {dsdRate: 176400, dsdDepth: 16}), null, 'A cached DSD slice should expire when the PCM output rate changed');
    assert.equal(await cache.getCachedFirstSlice(dsdTrack, {dsdRate: 88200, dsdDepth: 24}), null, 'A cached DSD slice should expire when the output bit depth changed');
    assert.equal(await cache.getCachedFirstSlice(dsdTrack), cached, 'A cached DSD slice should still read back without a decode expectation');
    assert.equal(await cache.getCachedFirstSlice({...dsdTrack, size: 19900000}, settings88200), null, 'A cached DSD slice should still expire when the source file size changes');
  }
  // Mục cache cũ (ghi trước bản này, không có meta): đọc với thông số
  // hiện tại thì hết hạn (giải mã lại một lần rồi ghi meta mới), đọc
  // không kỳ vọng vẫn được để đường FLAC không đổi.
  {
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    assert.equal(await cache.cacheFirstSlice(dsdTrack, dsdSliceBlob, dsdTrack.size, library.DSD_FIRST_SLICE_CACHE_MAX_BYTES), true, 'A DSD first slice without meta should still cache (old-build entry)');
    assert.equal([...rows.values()][0].meta, null, 'An entry written without meta should store a null meta');
    assert.equal(await cache.getCachedFirstSlice(dsdTrack, settings88200), null, 'A pre-change DSD cache entry should expire once settings are expected');
    assert.ok(await cache.getCachedFirstSlice(dsdTrack), 'A pre-change DSD cache entry should still read back without a decode expectation');
  }
  // Lát FLAC không truyền meta: ghi/đọc như cũ, không bị ảnh hưởng bởi
  // kiểm tra thông số giải mã của DSD.
  {
    const {rows, state} = makeSliceCacheHarness();
    const cache = makeCacheFns(state);
    const flacTrack = {id: 'google:f1', source: 'google', remoteId: 'f1', name: 'a.flac', size: 12000000};
    const flacSliceBlob = new Blob([new Uint8Array(1048576)], {type: 'audio/flac'});
    assert.equal(await cache.cacheFirstSlice(flacTrack, flacSliceBlob, 12000000), true, 'A FLAC first slice should still cache without meta');
    assert.equal([...rows.values()][0].meta, null, 'A FLAC cache entry should store a null meta');
    const cached = await cache.getCachedFirstSlice(flacTrack);
    assert.ok(cached && cached.size === 1048576, 'A cached FLAC slice should still read back');
  }

  // Đường nối: playDsdTrack đọc cache kèm thông số hiện tại, worker ghi
  // cache kèm thông số lúc giải mã, Phòng nghe cũng đối chiếu meta cho
  // bài DSD; đường đọc lát FLAC vẫn không truyền meta.
  assert.ok(appCode.includes('const cachedSlice = await getCachedFirstSlice(track, {dsdRate: state.dsdOutputRate, dsdDepth: state.dsdOutputDepth});'), 'DSD playback should read the cached slice with the current decode settings');
  assert.ok(appCode.includes('cacheFirstSlice(track, message.blob, track.size, library.DSD_FIRST_SLICE_CACHE_MAX_BYTES, {dsdRate: state.dsdOutputRate, dsdDepth: state.dsdOutputDepth})'), 'The worker first-slice handler should cache the slice with its decode settings');
  assert.ok(appCode.includes('const cached = await getCachedFirstSlice(track, track.isDsd ? {dsdRate: state.dsdOutputRate, dsdDepth: state.dsdOutputDepth} : undefined);'), 'The Room cache status should apply the decode-settings check for DSD tracks');
  assert.ok(appCode.includes('const cachedSlice = await getCachedFirstSlice(track);'), 'The FLAC first-slice read should stay meta-free');

  console.log('DSD first-slice cache expiry tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
