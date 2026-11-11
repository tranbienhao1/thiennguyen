'use strict';

// Pha A — kiểm toán gapless/crossfade khi chuyển bài trong lúc preload
// đang chạy: khi crossfade bật, finishPlaybackStart hẹn timeout
// (fade + 50ms) để dừng/xóa src deck cũ. Nhưng sau khi fade kết thúc,
// 'timeupdate' gọi preloadNext() và gán URL bài kế lên đúng deck cũ đó
// (giờ là deck chờ). Nếu 'timeupdate' rơi vào 50ms trước khi timeout
// chạy, timeout sẽ xóa src vừa preload xong: trạng thái preload
// (preloadTrackId/preloadReadyUrl) vẫn tưởng bài kế đã sẵn sàng, mất
// gapless và bấm Next phải tải lại bài kế từ đầu. Bản sửa chỉ dọn deck
// cũ khi nó vẫn còn giữ bài cũ, bỏ qua khi src đã là URL bài preload.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');
const library = require('./library-utils.js');

function extractFunction(code, name) {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should be defined in the app script`);
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

// Nối dây tĩnh: timeout dọn deck cũ sau crossfade phải bỏ qua khi deck
// đã bị preload chiếm, và vẫn thu hồi URL bài cũ trong cả hai trường hợp.
assert.ok(appCode.includes('claimedByPreload'), 'The crossfade cleanup should skip a deck already claimed by the next-track preload');
assert.ok(appCode.includes('preloadTrackId'), 'The crossfade cleanup should look up the preloaded track before clearing the old deck');

function makeGain() {
  return {value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, setValueCurveAtTime() {}};
}
function makeDeck() { return {router: {gain: makeGain()}}; }
class FakeElement {
  constructor(src = '') { this.src = src; this.paused = false; this.muted = false; this.removed = []; this.loads = 0; this.pauseCalls = 0; }
  pause() { this.pauseCalls++; this.paused = true; }
  removeAttribute(name) { this.removed.push(name); if (name === 'src') this.src = ''; }
  load() { this.loads++; }
}

function exerciseFinish({crossfadeSeconds = 5, preloadTrackId = null, preloadUrl = null} = {}) {
  const calls = {timeouts: [], history: [], renders: 0, preloads: 0, releasedCloud: [], releasedLocal: []};
  const deckA = makeDeck(), deckB = makeDeck();
  const previousTrack = {id: 'old', title: 'Bài cũ', url: 'blob:https://example/old'};
  const track = {id: 'now', title: 'Bài mới'};
  const nextTrack = {id: 'next', title: 'Bài kế', url: preloadUrl};
  const state = {
    tracks: [previousTrack, track, nextTrack], currentId: 'now',
    playGeneration: 1, crossfadeSeconds, crossfadeUntil: 0,
    context: {currentTime: 100}, deckA, deckB, activeDeck: deckA,
    preloadTrackId, preloadReadyUrl: null,
  };
  const oldElement = new FakeElement('blob:https://example/old');
  const newElement = new FakeElement('');
  const $ = () => ({textContent: ''});
  const location = {href: 'https://example.test/thiennguyen/'};
  const setTimeoutStub = (fn, ms) => { calls.timeouts.push({fn, ms}); return calls.timeouts.length; };
  const factory = new Function('state', 'audio', 'standbyAudio', '$', 'library', 'recordHistory', 'scheduleTrackRender', 'preloadNext', 'releaseUnusedCloudUrl', 'releaseUnusedLocalUrl', 'setTimeout', 'location',
    `${extractFunction(appCode, 'applyCrossfade')}\n${extractFunction(appCode, 'finishPlaybackStart')}\nreturn finishPlaybackStart;`);
  const finishPlaybackStart = factory(state, oldElement, newElement, $, library,
    item => calls.history.push(item.id), () => calls.renders++,
    () => calls.preloads++,
    item => calls.releasedCloud.push(item && item.id), item => calls.releasedLocal.push(item && item.id),
    setTimeoutStub, location);
  const started = finishPlaybackStart(track, 1, newElement, previousTrack);
  return {calls, state, oldElement, newElement, track, previousTrack, nextTrack, started};
}

// Mô phỏng đúng cửa sổ race: chuyển bài với crossfade 5 giây, fade vừa
// kết thúc thì 'timeupdate' gọi preloadNext gán URL bài kế lên deck cũ,
// rồi timeout dọn deck (fade + 50ms) chạy — src preload phải còn nguyên.
{
  const run = exerciseFinish({preloadUrl: 'blob:https://example/next'});
  assert.equal(run.started, true, 'finishPlaybackStart should complete the deck swap');
  assert.equal(run.calls.timeouts.length, 1, 'A crossfade switch should schedule exactly one old-deck cleanup');
  assert.equal(run.calls.timeouts[0].ms, 5050, 'The old-deck cleanup should run 50 ms after the fade ends');
  assert.equal(run.state.crossfadeUntil, 105, 'The crossfade window should end 5 seconds after the switch');
  // Preload chiếm deck cũ trong 50ms trước khi timeout chạy.
  run.state.preloadTrackId = 'next';
  run.oldElement.src = 'blob:https://example/next';
  run.calls.timeouts[0].fn();
  assert.equal(run.oldElement.src, 'blob:https://example/next', 'The cleanup must not wipe a preloaded next track off the old deck');
  assert.equal(run.oldElement.pauseCalls, 0, 'The cleanup must not pause a deck that the preload has claimed');
  assert.deepEqual(run.oldElement.removed, [], 'The cleanup must not detach the source of a deck that the preload has claimed');
  assert.deepEqual(run.calls.releasedCloud, ['old', 'old'], 'The old track cloud URL should still be released even when the preload keeps the deck (once at swap, once at cleanup)');
  assert.deepEqual(run.calls.releasedLocal, ['old', 'old'], 'The old track local URL should still be released even when the preload keeps the deck (once at swap, once at cleanup)');
}

// Không có preload: timeout dọn deck cũ như trước (dừng, gỡ src, load).
{
  const run = exerciseFinish();
  run.calls.timeouts[0].fn();
  assert.equal(run.oldElement.pauseCalls, 1, 'Without a preload the cleanup should pause the old deck');
  assert.equal(run.oldElement.src, '', 'Without a preload the cleanup should detach the old deck source');
  assert.deepEqual(run.oldElement.removed, ['src'], 'Without a preload the cleanup should remove the old deck source attribute');
  assert.equal(run.oldElement.loads, 1, 'Without a preload the cleanup should reload the old deck');
  assert.deepEqual(run.calls.releasedCloud, ['old', 'old'], 'Without a preload the old track cloud URL should be released (once at swap, once at cleanup)');
}

// Preload đang chạy dở (đã đăng ký nhưng chưa gán src vì còn chờ tải):
// deck cũ vẫn giữ URL bài cũ nên timeout vẫn dọn như thường; preload sẽ
// gán src sau khi tải xong.
{
  const run = exerciseFinish({preloadTrackId: 'next', preloadUrl: 'blob:https://example/next'});
  run.calls.timeouts[0].fn();
  assert.equal(run.oldElement.src, '', 'A preload that has not set its source yet must not block the old-deck cleanup');
  assert.equal(run.oldElement.pauseCalls, 1, 'A preload that has not set its source yet should still let the cleanup pause the old deck');
}

// Dữ liệu biên: bài preload chưa có URL thì không có gì để so khớp, dọn
// deck cũ như thường thay vì giữ lại src bài cũ.
{
  const run = exerciseFinish({preloadTrackId: 'next', preloadUrl: null});
  run.calls.timeouts[0].fn();
  assert.equal(run.oldElement.src, '', 'A preloaded track without a URL must not block the old-deck cleanup');
  assert.equal(run.oldElement.pauseCalls, 1, 'A preloaded track without a URL should still let the cleanup pause the old deck');
}

// Crossfade tắt: không có timeout dọn deck, chuyển bài ngay như trước.
{
  const run = exerciseFinish({crossfadeSeconds: 0});
  assert.equal(run.calls.timeouts.length, 0, 'With crossfade off there should be no delayed old-deck cleanup');
  assert.equal(run.oldElement.pauseCalls, 2, 'With crossfade off the old deck should be paused immediately (standby alias and previous element are the same deck)');
  assert.equal(run.oldElement.src, '', 'With crossfade off the old deck source should be detached immediately');
}

console.log('crossfade-preload: all assertions passed');
