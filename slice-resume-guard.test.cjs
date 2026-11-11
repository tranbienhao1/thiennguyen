'use strict';

// Pha C — lỗi FLAC cloud nhảy bài, khe hở hẹp còn lại (kiểm tra 19:32
// trên bản 892b8d1): resumeFullAudioFromSlice chưa có guard deck/generation
// như hai đường anh em (upgradeSliceToFullAudio, handler 'done' DSD).
// Handler 'loadedmetadata' chạy bất đồng bộ sau khi gán element.src; nếu
// bấm Next hai lần trong vài chục ms lúc vừa resume thì deck đã phát bài
// mới, handler cũ vẫn seek/play deck đó ở vị trí lát cũ (~13 giây với
// lát Rio) nên bài mới bắt đầu sai ở ~13s thay vì từ đầu. Bản sửa chụp
// deck + playGeneration lúc resume và bỏ qua handler cũ khi deck, bài
// đang phát hoặc generation đã đổi.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
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

const resumeSource = extractFunction(appCode, 'resumeFullAudioFromSlice');
// Nối dây tĩnh: handler 'loadedmetadata' phải có cùng bộ guard như hai
// đường anh em — generation, deck đang phát, bài đang phát.
assert.ok(resumeSource.includes('generation !== state.playGeneration'), 'The resume handler should ignore a stale loadedmetadata after the play generation changed');
assert.ok(resumeSource.includes('deck !== audio'), 'The resume handler should ignore a stale loadedmetadata after the deck changed');
assert.ok(resumeSource.includes('track.id !== state.currentId'), 'The resume handler should ignore a stale loadedmetadata after the playing track changed');
assert.ok(resumeSource.includes('const deck = element, generation = state.playGeneration;'), 'The resume should capture the deck and generation before the async metadata wait');

class FakeDeckElement {
  constructor() { this.handlers = {}; this.src = ''; this.currentTime = 0; this.duration = 197; this.paused = false; this.playCalls = 0; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
  async play() { this.playCalls++; this.paused = false; }
}

function makeResume(element, state, audio) {
  return new Function('element', 'state', 'audio', `${resumeSource}\nreturn resumeFullAudioFromSlice;`)(element, state, audio);
}

// Resume bình thường: chưa đổi bài thì seek về vị trí lát đã ghi rồi phát.
{
  const audio = new FakeDeckElement();
  const state = {currentId: 'rio', playGeneration: 5};
  const resume = makeResume(audio, state, audio);
  const track = {id: 'rio', title: 'Rio', fullAudioUrl: 'blob:https://example/full', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
  resume(track, 197);
  assert.equal(audio.src, 'blob:https://example/full', 'The resume should switch the deck to the ready full file');
  audio.fire('loadedmetadata');
  assert.equal(audio.currentTime, 12.96, 'The resume should seek to the recorded slice position');
  assert.equal(audio.playCalls, 1, 'The resume should play after switching to the full file');
}

// Bấm Next trong lúc chờ metadata: generation tăng + bài đổi thì handler
// cũ không được seek/play deck mới ở vị trí lát cũ.
{
  const audio = new FakeDeckElement();
  const state = {currentId: 'rio', playGeneration: 5};
  const resume = makeResume(audio, state, audio);
  const track = {id: 'rio', title: 'Rio', fullAudioUrl: 'blob:https://example/full', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
  resume(track, 197);
  state.playGeneration = 6;
  state.currentId = 'next';
  audio.currentTime = 0;
  audio.fire('loadedmetadata');
  assert.equal(audio.currentTime, 0, 'A stale resume after pressing Next must not seek the new track to the old slice position');
  assert.equal(audio.playCalls, 0, 'A stale resume after pressing Next must not play the deck');
}

// Chỉ đổi bài đang phát (generation chưa kịp đổi) cũng đủ để bỏ qua.
{
  const audio = new FakeDeckElement();
  const state = {currentId: 'rio', playGeneration: 5};
  const resume = makeResume(audio, state, audio);
  const track = {id: 'rio', title: 'Rio', fullAudioUrl: 'blob:https://example/full', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
  resume(track, 197);
  state.currentId = 'next';
  audio.fire('loadedmetadata');
  assert.equal(audio.currentTime, 0, 'A resume for a track that is no longer playing must not seek the deck');
  assert.equal(audio.playCalls, 0, 'A resume for a track that is no longer playing must not play the deck');
}

// Deck đã đổi sang deck khác thì handler cũ cũng bỏ qua.
{
  const element = new FakeDeckElement();
  const otherDeck = new FakeDeckElement();
  const state = {currentId: 'rio', playGeneration: 5};
  const resume = makeResume(element, state, otherDeck);
  const track = {id: 'rio', title: 'Rio', fullAudioUrl: 'blob:https://example/full', firstSlicePlayback: true, sliceEndedEarly: true, lastSlicePosition: 12.96};
  resume(track, 197);
  element.fire('loadedmetadata');
  assert.equal(element.currentTime, 0, 'A resume on a deck that is no longer the playing deck must not seek it');
  assert.equal(element.playCalls, 0, 'A resume on a deck that is no longer the playing deck must not play it');
}

// Dữ liệu biên: không có vị trí đã ghi thì rớt về position truyền vào,
// kẹp dưới duration như cũ.
{
  const audio = new FakeDeckElement();
  const state = {currentId: 'rio', playGeneration: 5};
  const resume = makeResume(audio, state, audio);
  const track = {id: 'rio', title: 'Rio', fullAudioUrl: 'blob:https://example/full', firstSlicePlayback: true, sliceEndedEarly: true};
  resume(track, 197);
  audio.fire('loadedmetadata');
  assert.equal(audio.currentTime, 196.75, 'Without a recorded slice position the resume should fall back to the given position clamped below the duration');
  assert.equal(audio.playCalls, 1, 'The fallback resume should still play');
}

console.log('slice-resume-guard: all assertions passed');
