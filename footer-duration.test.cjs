'use strict';

// Pha B — footer không hiện thời gian bài nhạc (Melissa báo 19:48, ảnh
// chụp thanh footer 0:00 / 0:00): bài Google lần đầu chưa biết
// track.duration (track Google tạo ra không có duration, enrichment tag
// cũng không ghi duration), loadedmetadata lại bắn trên deck đích
// (standbyAudio) TRƯỚC khi đổi deck nên handler bỏ qua (element !==
// audio), còn timeupdate chỉ cập nhật room-duration chứ không chạm tới
// footer #duration/#duration-mobile. Kết quả: đang phát mà footer kẹt
// ở 0:00, trong khi Phòng nghe hiện đúng 3:17. Bản sửa: timeupdate
// đồng bộ luôn footer khi duration hữu hạn, và loadCloudMetadata đồng
// bộ footer khi metadata nền về mà đó vẫn là bài đang phát.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const deckEventsStart = appCode.indexOf('function attachDeckEvents(element) {');
const deckEventsEnd = appCode.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckEventsStart);
assert.ok(deckEventsStart >= 0 && deckEventsEnd > deckEventsStart, 'attachDeckEvents should be extractable');
const deckEventsSource = appCode.slice(deckEventsStart, deckEventsEnd);

// Nối dây tĩnh: timeupdate phải ghi cả footer, loadCloudMetadata phải
// đồng bộ footer khi metadata nền về cho bài đang phát.
assert.ok(deckEventsSource.includes("$('duration').textContent = formatTime(element.duration)"),
  'The timeupdate handler should sync the footer duration from the real media duration');
assert.ok(deckEventsSource.includes("$('duration-mobile').textContent = formatTime(element.duration)"),
  'The timeupdate handler should sync the mobile footer duration too');
const metaStart = appCode.indexOf('async function loadCloudMetadata(track, blob) {');
const metaEnd = appCode.indexOf('function finishCloudMetadataInBackground(track, blob) {', metaStart);
assert.ok(metaStart >= 0 && metaEnd > metaStart, 'loadCloudMetadata should be extractable');
const metaSource = appCode.slice(metaStart, metaEnd);
assert.ok(metaSource.includes('track.id === state.currentId') && metaSource.includes("$('duration').textContent = formatTime(track.duration)"),
  'loadCloudMetadata should sync the footer duration when background metadata arrives for the current track');

class FakeDeck {
  constructor() { this.handlers = {}; this.src = ''; this.currentTime = 0; this.duration = NaN; this.paused = true; this.playCalls = 0; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
  async play() { this.playCalls++; this.paused = false; }
}

function exerciseDeck({tracks, currentId = 'rio'} = {}) {
  const stubs = {};
  const $ = id => (stubs[id] ||= {textContent: '0:00', value: '0', matches: () => false});
  globalThis.formatTime = seconds => Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
  globalThis.formatRemainingTime = (current, duration) => Number.isFinite(duration) && duration > 0
    ? `-${globalThis.formatTime(Math.max(0, duration - (Number.isFinite(current) ? current : 0)))}` : '—';
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
  const state = {tracks, currentId, errorSkipCount: 0, preloadTrackId: null, preloadReadyUrl: null, isSeeking: false};
  const audio = new FakeDeck();
  const standbyAudio = new FakeDeck();
  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState',
    `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio, () => {}, () => {}, () => {}, $, {}, () => {});
  attachDeckEvents(audio);
  attachDeckEvents(standbyAudio);
  return {stubs, $, state, audio, standbyAudio};
}

test('footer duration appears during first play of a Google track with unknown duration', () => {
  // Mô phỏng đúng ảnh chụp của Melissa: bài Google lần đầu, duration
  // chưa biết (displayTrack ghi footer 0:00), loadedmetadata bắn trên
  // deck đích trước khi đổi deck nên bị bỏ qua, rồi phát tới 0:05/3:17.
  const {$, audio, standbyAudio} = exerciseDeck({
    tracks: [{id: 'rio', source: 'google', title: 'Rio', firstSlicePlayback: true}],
  });
  standbyAudio.duration = 197;
  standbyAudio.fire('loadedmetadata');
  assert.equal($('duration').textContent, '0:00', 'loadedmetadata on the standby deck must not set the footer yet');
  audio.src = 'blob:full'; audio.duration = 197; audio.currentTime = 5; audio.paused = false;
  audio.fire('timeupdate');
  assert.equal($('current-time').textContent, '0:05');
  assert.equal($('room-duration').textContent, '3:17');
  assert.equal($('duration').textContent, '3:17', 'The footer duration should follow the real media duration once playback starts');
  assert.equal($('duration-mobile').textContent, '3:17', 'The mobile footer duration should follow too');
});

test('loadedmetadata on the playing deck still sets the footer duration', () => {
  const {$, audio} = exerciseDeck({
    tracks: [{id: 'rio', source: 'google', title: 'Rio'}],
  });
  audio.duration = 197;
  audio.fire('loadedmetadata');
  assert.equal($('duration').textContent, '3:17');
  assert.equal($('duration-mobile').textContent, '3:17');
});
