'use strict';

// Pha C — lỗi FLAC cloud nhảy bài (Melissa báo 10:50, "đang chạy xong tự
// tua đến hết thanh thời gian rồi chuyển bài khác luôn"): khi lát đầu hết
// (~13s với file Rio), trình duyệt nhảy currentTime về duration (197s)
// rồi mới bắn 'ended'; lúc tải nền xong, upgradeSliceToFullAudio và
// resumeFullAudioFromSlice lấy currentTime lúc đó để seek file đầy đủ về
// cuối bài nên 'ended' bắn ngay và app nhảy bài im lặng. Bản sửa ghi lại
// vị trí phát thật trong handler 'timeupdate' (track.lastSlicePosition)
// rồi seek về đó khi đổi sang file đầy đủ sau khi lát đã hết sớm, đồng
// thời kẹp vị trí seek nhỏ hơn duration một chút.

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

// Nối dây tĩnh: vị trí thật phải được ghi trong 'timeupdate', dùng khi
// đổi sang file đầy đủ sau khi lát hết sớm, và kẹp dưới duration.
assert.ok(appCode.includes('lastSlicePosition = element.currentTime'), 'The timeupdate handler should record the real playback position while playing the first slice');
assert.ok(appCode.includes('track.lastSlicePosition = null'), 'The recorded slice position should reset when a new slice starts or after the swap');
const upgradeStart = appCode.indexOf('async function upgradeSliceToFullAudio(track, sliceUrl, url, options, provider) {');
const upgradeEnd = appCode.indexOf('async function fetchCloudTrack(track, url, options, provider) {', upgradeStart);
assert.ok(upgradeStart >= 0 && upgradeEnd > upgradeStart, 'upgradeSliceToFullAudio should be extractable');
const upgradeSource = appCode.slice(upgradeStart, upgradeEnd);
assert.ok(upgradeSource.includes('track.lastSlicePosition'), 'The background upgrade should resume from the recorded slice position when the slice already ended');
assert.ok(upgradeSource.includes('duration - 0.25'), 'The background upgrade should clamp the resume position below the track duration');
const deckEventsStart = appCode.indexOf('function attachDeckEvents(element) {');
const deckEventsEnd = appCode.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckEventsStart);
assert.ok(deckEventsStart >= 0 && deckEventsEnd > deckEventsStart, 'attachDeckEvents should be extractable');
const deckEventsSource = appCode.slice(deckEventsStart, deckEventsEnd);
assert.ok(deckEventsSource.includes('track.lastSlicePosition'), 'The deck guards should resume from the recorded slice position');

function makeUpgradeContext() {
  const state = {objectUrls: new Set(), currentId: 'rio'};
  const handlers = {};
  let playCalls = 0;
  const audio = {
    src: 'blob:slice', currentTime: 197, duration: 197, paused: false,
    addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
    async play() { playCalls++; },
  };
  const standbyAudio = {src: ''};
  const context = {
    console,
    setTimeout,
    URL,
    Blob,
    location: {href: 'https://example.test/thiennguyen/'},
    state,
    audio,
    standbyAudio,
    library: {
      fetchAudioBlob: async () => new Blob(['full-audio-bytes'], {type: 'audio/flac'}),
      normalizeAudioBlob: blob => blob,
    },
    getMicrosoftToken: async () => { throw new Error('No Microsoft token in test'); },
    isGraphContentUrl: url => typeof url === 'string' && url.startsWith('https://graph.microsoft.com/'),
    finishCloudMetadataInBackground: () => {},
    releaseTrackUrl: () => {},
  };
  context.__handlers = () => handlers;
  context.__playCalls = () => playCalls;
  vm.createContext(context);
  vm.runInContext(extractFunction(appCode, 'upgradeSliceToFullAudio'), context, {filename: 'upgrade-slice.js'});
  return context;
}

class FakeDeckElement {
  constructor() { this.handlers = {}; this.src = ''; this.currentTime = 0; this.duration = 197; this.paused = false; this.playCalls = 0; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
  async play() { this.playCalls++; this.paused = false; }
}

function exerciseDeck({tracks, currentId = 'rio'} = {}) {
  const calls = {toasts: [], playedNext: []};
  const state = {tracks, currentId, errorSkipCount: 0, preloadTrackId: null, preloadReadyUrl: null, isSeeking: false};
  const audio = new FakeDeckElement();
  const standbyAudio = new FakeDeckElement();
  const $ = () => ({textContent: '', value: '0', matches: () => false});
  globalThis.formatTime = seconds => `t${Math.floor(seconds || 0)}`;
  globalThis.lastDisplayedPlaybackSecond = -1;
  globalThis.lastPositionStateSecond = -1;
  globalThis.syncSeek = () => {};
  globalThis.paintSeek = () => {};
  globalThis.updateLyricsHighlight = () => {};
  globalThis.updateMetadataFilters = () => {};
  globalThis.scheduleTrackRender = () => {};
  globalThis.library = {shouldPreloadNext: () => false, PRELOAD_LEAD_SECONDS: 10};
  globalThis.preloadNext = () => {};
  globalThis.location = {href: 'https://example.test/thiennguyen/'};
  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio,
    message => calls.toasts.push(message),
    (direction, auto) => calls.playedNext.push([direction, auto]),
    () => {}, $, {}, () => {},
  );
  attachDeckEvents(audio);
  attachDeckEvents(standbyAudio);
  return {calls, state, audio, standbyAudio};
}

(async () => {
  // Mô phỏng đúng video của Melissa: lát Rio 1 MB phát được 12,96 giây
  // rồi hết; trình duyệt nhảy currentTime về duration 197s rồi bắn
  // 'ended'; tải nền xong thì đổi sang file đầy đủ phải phát tiếp từ
  // ~13s, không được seek về 197s rồi nhảy bài.
  {
    const ctx = makeUpgradeContext();
    const track = {id: 'rio', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', url: 'blob:slice', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
    await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    assert.equal(ctx.audio.src.startsWith('blob:'), true, 'The upgrade should switch the deck to the full file');
    for (const handler of ctx.__handlers().loadedmetadata || []) handler();
    assert.equal(ctx.audio.currentTime, 12.96, 'The upgrade should resume at the recorded slice position, not at the duration the browser jumped to when the slice ran out');
    assert.equal(ctx.__playCalls(), 1, 'The upgrade should resume playback after switching to the full file');
    assert.equal(track.lastSlicePosition, null, 'The recorded slice position should clear after the upgrade swap');
  }

  // Kẹp vị trí: lát hết khi đã gần cuối bài thì seek về duration - 0.25
  // để 'ended' không bắn ngay sau khi đổi sang file đầy đủ.
  {
    const ctx = makeUpgradeContext();
    const track = {id: 'rio', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', url: 'blob:slice', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 196.9};
    await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    for (const handler of ctx.__handlers().loadedmetadata || []) handler();
    assert.equal(ctx.audio.currentTime, 196.75, 'A resume position at the very end of the track should clamp just below the duration');
  }

  // Đường guard 'ended' khi swap bị bỏ lỡ: lát hết, currentTime đã là
  // duration, file đầy đủ đã sẵn sàng thì đổi sang file đầy đủ ở vị trí
  // đã ghi (~13s) rồi phát tiếp, không chuyển bài.
  {
    const deck = exerciseDeck({tracks: [{id: 'rio', title: 'Rio', firstSlicePlayback: true, sliceEndedEarly: true, fullAudioPromise: null, fullAudioUrl: 'blob:https://example/full', lastSlicePosition: 12.96}]});
    deck.audio.src = 'blob:https://example/slice';
    deck.audio.currentTime = 197;
    deck.audio.fire('ended');
    assert.deepEqual(deck.calls.playedNext, [], 'A missed swap after the slice ran out must not advance to the next track');
    assert.equal(deck.audio.src, 'blob:https://example/full', 'The missed swap should switch the deck to the ready full file');
    deck.audio.fire('loadedmetadata');
    assert.equal(deck.audio.currentTime, 12.96, 'The recovery swap should resume at the recorded slice position, not at the duration');
    assert.equal(deck.audio.playCalls, 1, 'The recovery swap should resume playback after switching to the full file');
  }

  // 'timeupdate' ghi vị trí thật trong lúc phát lát đầu, không ghi đè
  // khi currentTime đã nhảy về duration, và không ghi khi không còn
  // phát từ lát đầu.
  {
    const track = {id: 'rio', title: 'Rio', firstSlicePlayback: true};
    const deck = exerciseDeck({tracks: [track, {id: 'next', title: 'Bài sau'}]});
    deck.audio.currentTime = 10;
    deck.audio.fire('timeupdate');
    assert.equal(track.lastSlicePosition, 10, 'Timeupdate should record the real position while the first slice is playing');
    deck.audio.currentTime = 197;
    deck.audio.fire('timeupdate');
    assert.equal(track.lastSlicePosition, 10, 'Timeupdate must not overwrite the recorded position once currentTime jumps to the duration');
    track.firstSlicePlayback = false;
    deck.audio.currentTime = 50;
    deck.audio.fire('timeupdate');
    assert.equal(track.lastSlicePosition, 10, 'Timeupdate should only record while the track is still playing from its first slice');
  }

  // Dữ liệu biên: không có vị trí đã ghi thì rớt về currentTime như cũ
  // (kẹp dưới duration) thay vì seek về 0 hay NaN.
  {
    const ctx = makeUpgradeContext();
    const track = {id: 'rio', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', url: 'blob:slice', firstSlicePlayback: true, sliceEndedEarly: true};
    await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    for (const handler of ctx.__handlers().loadedmetadata || []) handler();
    assert.equal(ctx.audio.currentTime, 196.75, 'Without a recorded slice position the upgrade should fall back to the deck position clamped below the duration');
  }
})().catch(error => { console.error(error); process.exit(1); });
