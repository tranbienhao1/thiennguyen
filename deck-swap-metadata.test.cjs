'use strict';

// Pha A — kiểm toán deck swap khi crossfade (liên quan lỗi FLAC cloud
// nhảy bài): handler 'loadedmetadata' trong upgradeSliceToFullAudio và
// handler 'done' của worker DSD tham chiếu biến `audio` — biến này bị
// gán lại khi finishPlaybackStart đổi deck (người dùng bấm Next, hoặc
// bài tự chuyển). Nếu deck đổi trong khoảng từ lúc gán `audio.src =
// fullUrl` tới lúc 'loadedmetadata' bắn, handler sẽ seek + play() nhầm
// sang deck mới đang phát bài khác: bài mới bị tua về vị trí của bài cũ
// (vd ~13s) thay vì phát từ đầu. Bản sửa giữ đúng deck bằng `const deck
// = audio` rồi chỉ seek/play khi deck đó vẫn là deck đang phát của đúng
// bài (deck === audio và track còn là bài hiện tại).

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

// Nối dây tĩnh: cả hai đường đổi sang file đầy đủ phải giữ đúng deck và
// bỏ qua khi deck đã đổi bài.
const upgradeStart = appCode.indexOf('async function upgradeSliceToFullAudio(track, sliceUrl, url, options, provider) {');
const upgradeEnd = appCode.indexOf('async function fetchCloudTrack(track, url, options, provider) {', upgradeStart);
assert.ok(upgradeStart >= 0 && upgradeEnd > upgradeStart, 'upgradeSliceToFullAudio should be extractable');
const upgradeSource = appCode.slice(upgradeStart, upgradeEnd);
assert.ok(upgradeSource.includes('const deck = audio'), 'The background upgrade should capture the deck before attaching the loadedmetadata handler');
assert.ok(upgradeSource.includes('deck !== audio'), 'The background upgrade should skip the resume when the deck has been swapped away');
const dsdDoneStart = appCode.indexOf("if (message.type !== 'done') return;");
const dsdDoneEnd = appCode.indexOf('worker.onerror', dsdDoneStart);
assert.ok(dsdDoneStart >= 0 && dsdDoneEnd > dsdDoneStart, 'The DSD done handler should be extractable');
const dsdDoneSource = appCode.slice(dsdDoneStart, dsdDoneEnd);
assert.ok(dsdDoneSource.includes('const deck = audio'), 'The DSD done handler should capture the deck before attaching the loadedmetadata handler');
assert.ok(dsdDoneSource.includes('deck !== audio'), 'The DSD done handler should skip the resume when the deck has been swapped away');

function makeDeck(currentTime, duration) {
  let playCalls = 0;
  const handlers = {};
  const deck = {
    src: '', currentTime, duration, paused: false,
    addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
    fire(type) { for (const handler of handlers[type] || []) handler(); },
    async play() { playCalls++; this.paused = false; },
  };
  deck.__handlers = () => handlers;
  deck.__playCalls = () => playCalls;
  return deck;
}

function makeUpgradeContext() {
  const state = {objectUrls: new Set(), currentId: 'rio'};
  const audio = makeDeck(197, 197);
  audio.src = 'blob:slice';
  const standbyAudio = makeDeck(0, 0);
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
  vm.createContext(context);
  vm.runInContext(extractFunction(appCode, 'upgradeSliceToFullAudio'), context, {filename: 'upgrade-slice.js'});
  return context;
}

(async () => {
  // Deck đổi sau khi gán src file đầy đủ nhưng trước khi metadata tải
  // xong (bấm Next đúng lúc tải nền vừa xong, ~13s sau khi lát hết):
  // bài mới trên deck mới không được tua về vị trí 12.96s của bài cũ,
  // deck cũ bị bỏ cũng không được phát tiếp.
  {
    const ctx = makeUpgradeContext();
    const oldDeck = ctx.audio;
    const track = {id: 'rio', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', url: 'blob:slice', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
    await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    assert.equal(oldDeck.src.startsWith('blob:'), true, 'The upgrade should switch the old deck to the full file before the swap');
    const newDeck = makeDeck(0, 180);
    ctx.audio = newDeck;
    ctx.state.currentId = 'next';
    oldDeck.fire('loadedmetadata');
    assert.equal(newDeck.currentTime, 0, 'A deck swap before loadedmetadata must not seek the new track to the old track slice position');
    assert.equal(newDeck.__playCalls(), 0, 'A deck swap before loadedmetadata must not play the new deck from the stale resume handler');
    assert.equal(oldDeck.currentTime, 197, 'The stale resume handler must not seek the abandoned deck either');
    assert.equal(oldDeck.__playCalls(), 0, 'The stale resume handler must not resume playback on the abandoned deck');
  }

  // Không có deck swap: đổi sang file đầy đủ vẫn phát tiếp từ vị trí
  // đã ghi như trước (bảo vệ hồi quy cho bản sửa).
  {
    const ctx = makeUpgradeContext();
    const track = {id: 'rio', source: 'google', name: 'Rio.flac', title: 'Rio', format: 'FLAC', url: 'blob:slice', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
    await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    ctx.audio.fire('loadedmetadata');
    assert.equal(ctx.audio.currentTime, 12.96, 'Without a deck swap the upgrade should still resume at the recorded slice position');
    assert.equal(ctx.audio.__playCalls(), 1, 'Without a deck swap the upgrade should still resume playback after switching to the full file');
  }
})().catch(error => { console.error(error); process.exit(1); });
