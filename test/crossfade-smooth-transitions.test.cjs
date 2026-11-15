'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const inlineScripts = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

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

test('1. library.shouldAutoCrossfade - tính toán thời điểm bắt đầu hòa âm tự động', async t => {
  await t.test('không kích hoạt khi crossfade tắt (0s)', () => {
    assert.equal(library.shouldAutoCrossfade(195, 200, 0, { hasNextTrack: true }), false);
    assert.equal(library.shouldAutoCrossfade(199, 200, -1, { hasNextTrack: true }), false);
  });

  await t.test('không kích hoạt khi chưa đến ngưỡng lookahead', () => {
    // Bài 200s, crossfade 5s -> ngưỡng là 195s. Tại 190s chưa kích hoạt.
    assert.equal(library.shouldAutoCrossfade(190, 200, 5, { hasNextTrack: true }), false);
    assert.equal(library.shouldAutoCrossfade(194.5, 200, 5, { hasNextTrack: true }), false);
  });

  await t.test('kích hoạt chính xác khi currentTime >= duration - crossfadeSeconds', () => {
    assert.equal(library.shouldAutoCrossfade(195, 200, 5, { hasNextTrack: true }), true);
    assert.equal(library.shouldAutoCrossfade(197, 200, 5, { hasNextTrack: true }), true);
    assert.equal(library.shouldAutoCrossfade(199.9, 200, 5, { hasNextTrack: true }), true);
  });

  await t.test('chặn kích hoạt khi đang pause, lặp lại 1 bài (repeat=2), chờ lát đầu hoặc không có bài kế', () => {
    // Đang tạm dừng
    assert.equal(library.shouldAutoCrossfade(197, 200, 5, { hasNextTrack: true, isPaused: true }), false);
    // Chế độ lặp 1 bài (repeat single = 2)
    assert.equal(library.shouldAutoCrossfade(197, 200, 5, { hasNextTrack: true, repeatMode: 2 }), false);
    // Đang chờ file đầy đủ tải ngầm cho first slice
    assert.equal(library.shouldAutoCrossfade(197, 200, 5, { hasNextTrack: true, isSliceWaiting: true }), false);
    // Hết danh sách phát, không có bài kế tiếp
    assert.equal(library.shouldAutoCrossfade(197, 200, 5, { hasNextTrack: false }), false);
  });

  await t.test('kẹp thời lượng tối đa an toàn 5 giây theo chuẩn CROSSFADE_MAX_SECONDS', () => {
    // Crossfade 10s sẽ được kẹp về 5s -> tại 192s (duration 200s) chưa kích hoạt vì 200 - 5 = 195s
    assert.equal(library.shouldAutoCrossfade(192, 200, 10, { hasNextTrack: true }), false);
    assert.equal(library.shouldAutoCrossfade(195, 200, 10, { hasNextTrack: true }), true);
  });
});

test('2. applyCrossfade - AudioParam scheduling & bảo toàn gain khi deck trước đó về 0', async t => {
  const crossfadeFnStr = extractFunction(appCode, 'applyCrossfade');
  const factory = new Function('library', 'state', `${crossfadeFnStr}\nreturn applyCrossfade;`);

  function createMockAudioParam(initialValue = 1) {
    return {
      value: initialValue,
      calls: [],
      cancelScheduledValues(time) { this.calls.push({ method: 'cancelScheduledValues', time }); },
      cancelAndHoldAtTime(time) { this.calls.push({ method: 'cancelAndHoldAtTime', time }); },
      setValueAtTime(value, time) { this.calls.push({ method: 'setValueAtTime', value, time }); this.value = value; },
      setValueCurveAtTime(values, time, duration) { this.calls.push({ method: 'setValueCurveAtTime', values: Array.from(values), time, duration }); },
      setTargetAtTime(target, time, timeConstant) { this.calls.push({ method: 'setTargetAtTime', target, time, timeConstant }); }
    };
  }

  await t.test('Deck cũ có gain.value = 0 (từ lần chuyển bài trước) được chuẩn hóa về 1, không bị câm hoàn toàn outCurve', () => {
    const mockState = { crossfadeCurve: 'equal-power', crossfadeUntil: 0 };
    const applyCrossfade = factory(library, mockState);

    const oldParam = createMockAudioParam(0); // Deck cũ từng fade-out về 0
    const newParam = createMockAudioParam(0);

    const oldDeck = { router: { gain: oldParam } };
    const newDeck = { router: { gain: newParam } };
    const context = { currentTime: 50 };

    const duration = applyCrossfade(context, oldDeck, newDeck, 3);
    assert.equal(duration, 3);

    const oldCurveCall = oldParam.calls.find(c => c.method === 'setValueCurveAtTime');
    assert.ok(oldCurveCall, 'Phải lập lịch setValueCurveAtTime cho deck cũ');
    // Điểm bắt đầu phải là 1 (không phải 0!)
    assert.ok(Math.abs(oldCurveCall.values[0] - 1.0) < 1e-6, `Điểm bắt đầu outCurve phải là 1.0 thay vì 0, nhận được: ${oldCurveCall.values[0]}`);
    assert.ok(Math.abs(oldCurveCall.values[32] - 0.0) < 1e-6, 'Điểm kết thúc outCurve phải là 0.0');

    // Kiểm tra newDeck inCurve
    const newCurveCall = newParam.calls.find(c => c.method === 'setValueCurveAtTime');
    assert.ok(newCurveCall, 'Phải lập lịch setValueCurveAtTime cho deck mới');
    assert.ok(Math.abs(newCurveCall.values[0] - 0.0) < 1e-6, 'Điểm bắt đầu inCurve phải là 0.0');
    assert.ok(Math.abs(newCurveCall.values[32] - 1.0) < 1e-6, 'Điểm kết thúc inCurve phải là 1.0');
  });

  await t.test('Không xảy ra xung đột OverlappingEvents giữa setValueAtTime và setValueCurveAtTime tại cùng thời điểm', () => {
    const mockState = { crossfadeCurve: 'equal-power', crossfadeUntil: 0 };
    const applyCrossfade = factory(library, mockState);

    const oldParam = createMockAudioParam(1);
    const newParam = createMockAudioParam(0);
    const oldDeck = { router: { gain: oldParam } };
    const newDeck = { router: { gain: newParam } };
    const context = { currentTime: 100 };

    applyCrossfade(context, oldDeck, newDeck, 4);

    // Kiểm tra không có setValueAtTime nào tại thời điểm 100 gây xung đột với setValueCurveAtTime(..., 100, 4)
    const oldCollisions = oldParam.calls.filter(c => c.method === 'setValueAtTime' && c.time === 100);
    const newCollisions = newParam.calls.filter(c => c.method === 'setValueAtTime' && c.time === 100);
    assert.equal(oldCollisions.length, 0, 'Deck cũ không được gọi setValueAtTime tại cùng thời điểm bắt đầu curve');
    assert.equal(newCollisions.length, 0, 'Deck mới không được gọi setValueAtTime tại cùng thời điểm bắt đầu curve');

    // Điểm chốt cuối curve tại now + duration (104)
    const oldEndAnchor = oldParam.calls.find(c => c.method === 'setValueAtTime' && c.time === 104);
    assert.ok(oldEndAnchor && oldEndAnchor.value === 0, 'Deck cũ phải được chốt gain 0 tại cuối thời lượng fade');
    const newEndAnchor = newParam.calls.find(c => c.method === 'setValueAtTime' && c.time === 104);
    assert.ok(newEndAnchor && newEndAnchor.value === 1, 'Deck mới phải được chốt gain 1 tại cuối thời lượng fade');
  });

  await t.test('Khi ngắt ngang giữa chừng một crossfade đang chạy, deck chuyển mượt từ mức gain hiện tại', () => {
    // Giả lập crossfade đang chạy (crossfadeUntil > currentTime) với gain đang ở mức 0.6
    const mockState = { crossfadeCurve: 'equal-power', crossfadeUntil: 150 };
    const applyCrossfade = factory(library, mockState);

    const oldParam = createMockAudioParam(0.6);
    const newParam = createMockAudioParam(0);
    const oldDeck = { router: { gain: oldParam } };
    const newDeck = { router: { gain: newParam } };
    const context = { currentTime: 145 };

    applyCrossfade(context, oldDeck, newDeck, 2);

    const oldCurveCall = oldParam.calls.find(c => c.method === 'setValueCurveAtTime');
    assert.ok(Math.abs(oldCurveCall.values[0] - 0.6) < 1e-6, `Deck cũ phải ramp mượt từ mức 0.6 hiện tại, nhận được: ${oldCurveCall.values[0]}`);
  });
});

test('3. finishPlaybackStart - Khôi phục sạch router.gain = 1 sau crossfade và duy trì phát deck cũ', async t => {
  const finishFnStr = extractFunction(appCode, 'finishPlaybackStart');
  const applyCrossfadeFnStr = extractFunction(appCode, 'applyCrossfade');

  function createMockAudioParam(initialValue = 1) {
    return {
      value: initialValue,
      calls: [],
      cancelScheduledValues(time) { this.calls.push({ method: 'cancelScheduledValues', time }); },
      cancelAndHoldAtTime(time) { this.calls.push({ method: 'cancelAndHoldAtTime', time }); },
      setValueAtTime(value, time) { this.calls.push({ method: 'setValueAtTime', value, time }); this.value = value; },
      setValueCurveAtTime(values, time, duration) { this.calls.push({ method: 'setValueCurveAtTime', values: Array.from(values), time, duration }); },
      setTargetAtTime(target, time, timeConstant) { this.calls.push({ method: 'setTargetAtTime', target, time, timeConstant }); }
    };
  }

  class FakeAudioElement {
    constructor(src = '') {
      this.src = src;
      this.paused = false;
      this.muted = false;
      this.volume = 1;
      this.removed = [];
    }
    pause() { this.paused = true; }
    removeAttribute(attr) { this.removed.push(attr); if (attr === 'src') this.src = ''; }
    load() {}
  }

  const timeouts = [];
  const fakeSetTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };

  const deckA = { router: { gain: createMockAudioParam(1) } };
  const deckB = { router: { gain: createMockAudioParam(0) } };
  const prevTrack = { id: 'track-1', url: 'blob:https://track-1' };
  const nextTrack = { id: 'track-2', url: 'blob:https://track-2' };

  const mockState = {
    tracks: [prevTrack, nextTrack],
    currentId: 'track-2',
    deckA,
    deckB,
    activeDeck: deckA,
    context: { currentTime: 200 },
    crossfadeSeconds: 3,
    crossfadeUntil: 0,
    playGeneration: 5,
    preloadTrackId: null,
    preloadReadyUrl: null,
    objectUrls: new Set()
  };

  const oldElem = new FakeAudioElement('blob:https://track-1');
  const newElem = new FakeAudioElement('blob:https://track-2');

  const $ = () => ({ textContent: '', classList: { add() {}, remove() {} } });
  const factory = new Function('state', 'audio', 'standbyAudio', '$', 'library', 'recordHistory', 'scheduleTrackRender', 'preloadNext', 'releaseUnusedCloudUrl', 'releaseUnusedLocalUrl', 'setTimeout', 'location',
    `${applyCrossfadeFnStr}\n${finishFnStr}\nreturn finishPlaybackStart;`);

  const finishPlaybackStart = factory(
    mockState, oldElem, newElem, $, library,
    () => {}, () => {}, () => {}, () => {}, () => {},
    fakeSetTimeout, { href: 'https://nocturne.app/' }
  );

  const ok = finishPlaybackStart(nextTrack, 5, newElem, prevTrack);
  assert.equal(ok, true);

  // Deck cũ KHÔNG được phép bị pause, muted hay tháo gỡ src ngay lập tức khi fadeSeconds > 0!
  assert.equal(oldElem.paused, false, 'Element cũ phải tiếp tục phát trong suốt thời gian hòa âm');
  assert.equal(oldElem.muted, false, 'Element cũ không được phép bị mute');
  assert.equal(oldElem.src, 'blob:https://track-1', 'Element cũ phải giữ nguyên src để tiếp tục phát');

  // Đã lên lịch hẹn dọn dẹp sau 3050 ms
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].ms, 3050);

  // Kích hoạt timeout khi crossfade kết thúc
  timeouts[0].fn();

  // Element cũ dừng sạch sẽ sau fade
  assert.equal(oldElem.paused, true);
  assert.equal(oldElem.muted, true);
  assert.equal(oldElem.src, '');

  // CỰC KỲ QUAN TRỌNG: router.gain của deck cũ được đặt lại về 1.0 sạch sẽ, sẵn sàng cho các lần chuyển bài sau!
  assert.equal(deckA.router.gain.value, 1.0, 'router.gain của deck cũ phải được reset về 1.0 sau crossfade');
});

test('4. Auto-crossfade lookahead & Invariant Audio Graph trong index.html', () => {
  // Bất biến Web Audio API Graph tối cao
  assert.ok(
    appCode.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Bất biến cốt lõi Web Audio API state.crossfeedNodes.output.connect(state.context.destination) phải được duy trì 100%'
  );

  // Auto-crossfade lookahead trong timeupdate
  assert.ok(
    appCode.includes('element.currentTime >= element.duration - state.crossfadeSeconds') ||
    appCode.includes('shouldAutoCrossfade'),
    'timeupdate phải phát hiện ngưỡng kết thúc bài để bắt đầu hòa âm tự động'
  );

  // Guard chống kích hoạt trùng lặp
  assert.ok(
    appCode.includes('state.autoCrossfadeGeneration') || appCode.includes('autoCrossfadeTriggered'),
    'Phải có cơ chế guard chống gọi playNext nhiều lần trong các frame timeupdate liên tiếp'
  );

  // Khởi tạo deck và setTarget/setValueAtTime an toàn
  assert.ok(
    appCode.includes('state.activeDeck.router.gain') && appCode.includes('nextDeck.router.gain'),
    'playTrack phải quản lý an toàn gain của cả nextDeck và activeDeck'
  );
});
