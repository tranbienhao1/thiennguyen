'use strict';

// Pha D — hiển thị trạng thái cache lát đầu (FLAC/DSD) trong chi tiết bài
// hát (dòng tín hiệu Phòng nghe): bài cloud và bài DSD phát từ lát đầu
// được ghi vào IndexedDB nên lần bấm lại phát ngay; dòng chi tiết hiện
// "lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại" khi có cache,
// "lát đầu chưa lưu trong bộ nhớ" khi chưa có, và ẩn hẳn khi chưa kiểm
// tra xong hoặc bài không dùng lát đầu (file local không phải DSD).

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
  if (code.slice(start - 6, start) === 'async ') start -= 6; // giữ từ khóa async để await trong thân hàm còn hợp lệ
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

const usesSource = extractFunction(appCode, 'usesFirstSliceCache');
const cacheTextSource = extractFunction(appCode, 'firstSliceCacheText');
const refreshSource = extractFunction(appCode, 'refreshFirstSliceCacheStatus');
const auditSource = extractFunction(appCode, 'formatDecodeAudit');
const signalSource = extractFunction(appCode, 'signalDescription');

const {usesFirstSliceCache, firstSliceCacheText} = new Function(
  `${usesSource}\n${cacheTextSource}\nreturn {usesFirstSliceCache, firstSliceCacheText};`,
)();

// Dòng trạng thái: chỉ có 3 trạng thái, chưa biết thì ẩn để không hiện sai.
assert.equal(firstSliceCacheText(true), 'lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại', 'A cached first slice should say it plays instantly on replay');
assert.equal(firstSliceCacheText(false), 'lát đầu chưa lưu trong bộ nhớ', 'A missing first slice should say it is not cached yet');
assert.equal(firstSliceCacheText(null), '', 'An unknown cache state should hide the line instead of guessing');
assert.equal(firstSliceCacheText(undefined), '', 'A track never checked should hide the line');
assert.equal(firstSliceCacheText('yes'), '', 'A non-boolean cache state should hide the line');

// Bài nào dùng lát đầu: cloud (Drive/OneDrive) và mọi bài DSD (kể cả
// file local, vì playDsdTrack cũng đọc/ghi cache lát PCM đầu).
assert.equal(usesFirstSliceCache({source: 'google', format: 'FLAC'}), true, 'A Google Drive FLAC should use the first-slice cache');
assert.equal(usesFirstSliceCache({source: 'onedrive', format: 'FLAC'}), true, 'A OneDrive FLAC should use the first-slice cache');
assert.equal(usesFirstSliceCache({source: 'local', format: 'DSF', isDsd: true}), true, 'A local DSD file should use the first-slice cache');
assert.equal(usesFirstSliceCache({source: 'local', format: 'FLAC', isDsd: false}), false, 'A local FLAC should not use the first-slice cache');
assert.equal(usesFirstSliceCache({source: 'url', format: 'FLAC'}), false, 'A direct URL track should not use the first-slice cache');
assert.equal(usesFirstSliceCache(null), false, 'A missing track should not use the first-slice cache');
assert.equal(usesFirstSliceCache({}), false, 'A track with no source or DSD flag should not use the first-slice cache');

// Chi tiết bài hát: dòng kỹ thuật phải mang trạng thái cache khi bài
// dùng lát đầu, và ẩn khi bài không dùng lát đầu hoặc chưa kiểm tra.
const signalDescription = new Function(
  'library', 'dsdSourceInfo', 'sourceLabel', 'state',
  `${usesSource}\n${cacheTextSource}\n${auditSource}\n${signalSource}\nreturn signalDescription;`,
)(
  {trackMetadata: track => ({title: track.title || track.name || '', artist: track.artist || '', album: track.album || ''})},
  () => null,
  source => source,
  {dsdOutputDepth: 16},
);
const cloudFlac = {id: 'google:f1', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2, size: 19800000};
assert.ok(signalDescription({...cloudFlac, firstSliceCached: true}).sourceTechnical.includes('lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại'), 'A cached cloud FLAC should show the cached status in its technical line');
assert.ok(signalDescription({...cloudFlac, firstSliceCached: false}).sourceTechnical.includes('lát đầu chưa lưu trong bộ nhớ'), 'An uncached cloud FLAC should show the uncached status in its technical line');
assert.ok(!signalDescription({...cloudFlac}).sourceTechnical.includes('lát đầu'), 'A cloud FLAC not yet checked should hide the cache status');
assert.ok(!signalDescription({source: 'local', name: 'a.flac', format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2, firstSliceCached: true}).sourceTechnical.includes('lát đầu'), 'A local FLAC should never show a cache status, even with a stale flag');
assert.ok(signalDescription({source: 'local', name: 'a.dsf', format: 'DSF', isDsd: true, sampleRate: 2822400, channels: 2, firstSliceCached: false}).sourceTechnical.includes('lát đầu chưa lưu trong bộ nhớ'), 'A local DSD without a cached slice should show the uncached status');

(async () => {
  // Làm mới trạng thái: đọc kho một lần rồi vẽ lại Phòng nghe nếu bài
  // vẫn đang phát; bài đã biết trạng thái thì không đọc lại.
  function makeRefresh({cached = null, throws = false, currentId = 't1', deferred = null} = {}) {
    const calls = {cacheReads: 0, rendered: []};
    let resolveDeferred;
    const gate = deferred ? new Promise(resolve => { resolveDeferred = resolve; }) : null;
    const getCachedFirstSlice = async () => {
      calls.cacheReads++;
      if (deferred) await gate;
      if (throws) throw new Error('IndexedDB closed');
      return cached;
    };
    const state = {currentId};
    const refresh = new Function(
      'getCachedFirstSlice', 'renderRoomSignal', 'state',
      `${usesSource}\n${refreshSource}\nreturn refreshFirstSliceCacheStatus;`,
    )(getCachedFirstSlice, track => { calls.rendered.push(track.id); }, state);
    return {calls, refresh, resolveDeferred};
  }
  {
    const {calls, refresh} = makeRefresh({cached: {size: 1048576}});
    const track = {id: 't1', source: 'google', format: 'FLAC'};
    await refresh(track);
    assert.equal(track.firstSliceCached, true, 'A cached slice read should mark the track cached');
    assert.deepEqual(calls.rendered, ['t1'], 'A newly known status should refresh the room signal while the track is current');
    assert.equal(calls.cacheReads, 1, 'The cache should be read once for a status refresh');
  }
  {
    const {calls, refresh} = makeRefresh({cached: null});
    const track = {id: 't1', source: 'google', format: 'FLAC'};
    await refresh(track);
    assert.equal(track.firstSliceCached, false, 'A missing slice should mark the track uncached');
    assert.deepEqual(calls.rendered, ['t1'], 'A newly known uncached status should also refresh the room signal');
  }
  {
    const {calls, refresh} = makeRefresh({cached: {size: 1}});
    const track = {id: 't1', source: 'google', format: 'FLAC', firstSliceCached: true};
    await refresh(track);
    assert.equal(calls.cacheReads, 0, 'A track already known cached should not read the cache again');
    assert.deepEqual(calls.rendered, [], 'A known status should not trigger a room refresh');
    const uncachedTrack = {id: 't1', source: 'google', format: 'FLAC', firstSliceCached: false};
    await refresh(uncachedTrack);
    assert.equal(calls.cacheReads, 0, 'A track already known uncached should not read the cache again');
  }
  {
    const {calls, refresh} = makeRefresh({cached: {size: 1}, currentId: 'other'});
    const track = {id: 't1', source: 'google', format: 'FLAC'};
    await refresh(track);
    assert.equal(track.firstSliceCached, true, 'The flag should still update for a track that is no longer current');
    assert.deepEqual(calls.rendered, [], 'A stale track should not refresh the room signal');
  }
  {
    const {calls, refresh} = makeRefresh({throws: true});
    const track = {id: 't1', source: 'google', format: 'FLAC'};
    await refresh(track);
    assert.equal(track.firstSliceCached, undefined, 'A failed cache read should keep the status unknown instead of guessing');
    assert.deepEqual(calls.rendered, [], 'A failed cache read should not refresh the room signal');
  }
  {
    const {calls, refresh, resolveDeferred} = makeRefresh({cached: {size: 1}, deferred: true});
    const track = {id: 't1', source: 'google', format: 'FLAC'};
    const first = refresh(track);
    const second = refresh(track);
    assert.equal(calls.cacheReads, 1, 'Two refreshes racing should share one cache read');
    resolveDeferred();
    await Promise.all([first, second]);
    assert.equal(track.firstSliceCached, true, 'The shared cache read should still mark the track cached');
    assert.deepEqual(calls.rendered, ['t1'], 'The shared cache read should refresh the room once');
  }
  {
    const {calls, refresh} = makeRefresh({cached: {size: 1}});
    const track = {id: 't1', source: 'local', format: 'FLAC'};
    await refresh(track);
    assert.equal(calls.cacheReads, 0, 'A local FLAC should never trigger a cache read');
    assert.equal(track.firstSliceCached, undefined, 'A local FLAC should keep no cache status');
  }

  // Nối dây trong app: Phòng nghe gọi làm mới khi vẽ tín hiệu, chi tiết
  // bài hát gắn dòng trạng thái, và ghi cache thành công thì đánh dấu
  // bài đã lưu để dòng trạng thái đổi ngay không cần mở lại.
  assert.ok(appCode.includes('refreshFirstSliceCacheStatus(track);'), 'The room signal should refresh the first-slice cache status when it renders');
  assert.ok(appCode.includes('firstSliceCacheText(track.firstSliceCached)'), 'Track detail should pass the cached flag to the cache status formatter');
  assert.ok(appCode.includes('track.firstSliceCached = true;'), 'Writing a first slice to the cache should mark the track cached');
  assert.ok(appCode.includes('if (track.id === state.currentId) renderRoomSignal(track);'), 'A fresh cache write should refresh the room signal for the current track');
})();

console.log('slice-cache-status: all assertions passed');
