'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const deckEventsStart = appCode.indexOf('function attachDeckEvents(element) {');
const deckEventsEnd = appCode.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckEventsStart);
const deckEventsSource = appCode.slice(deckEventsStart, deckEventsEnd);

test('v2.6.3: FLAC first slice widens when metadata leaves < 256 KB of audio frames', async () => {
  const ranges = [];
  const flacHeaderAndCover = 960 * 1024; // 960 KB cover inside 1 MB slice -> only 64 KB audio!
  const totalBytes = 25 * 1024 * 1024;

  function buildFakeFlacSlice(byteLen) {
    const buf = new Uint8Array(byteLen);
    // "fLaC"
    buf[0] = 0x66; buf[1] = 0x4c; buf[2] = 0x61; buf[3] = 0x43;
    // Last metadata block (0x84 = last + PICTURE) of length (flacHeaderAndCover - 8)
    const blockLen = flacHeaderAndCover - 8;
    buf[4] = 0x84;
    buf[5] = (blockLen >> 16) & 0xff;
    buf[6] = (blockLen >> 8) & 0xff;
    buf[7] = blockLen & 0xff;
    // FLAC sync code 0xFF 0xF8 at flacHeaderAndCover
    if (byteLen > flacHeaderAndCover + 1) {
      buf[flacHeaderAndCover] = 0xff;
      buf[flacHeaderAndCover + 1] = 0xf8;
    }
    return buf;
  }

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const range = opts && opts.headers && opts.headers.Range;
    ranges.push(range);
    const m = String(range).match(/bytes=0-(\d+)/);
    const len = Number(m[1]) + 1;
    const bytes = buildFakeFlacSlice(len);
    return {
      ok: true,
      status: 206,
      headers: {
        get: name => {
          const k = String(name).toLowerCase();
          if (k === 'content-type') return 'audio/flac';
          if (k === 'content-length') return String(len);
          return null;
        }
      },
      blob: async () => new Blob([bytes], { type: 'audio/flac' })
    };
  };

  try {
    const res = await library.fetchAudioFirstSlice('https://example.test/mck.flac', { expectedTotalBytes: totalBytes }, 'Google Drive');
    assert.equal(ranges.length, 2, 'Should widen range once when audio frames < 256 KB');
    assert.ok(res.blob.size >= flacHeaderAndCover + 256 * 1024, 'Widened slice must contain at least 256 KB of audio frames');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('v2.6.3: Premature first-slice EOF does NOT push seekbar to 100% or flip play button to ▶', () => {
  const dom = {};
  const makeEl = () => ({
    textContent: '',
    value: '0',
    classList: { added: [], add(c) { this.added.push(c); }, remove() {} },
    style: { setProperty() {} },
    matches: () => false
  });
  const $ = id => (dom[id] ||= makeEl());

  const seekValues = [];
  const state = {
    tracks: [{ id: 'mck-1', title: 'Anh Khong Muon No De Dang', duration: 165, firstSlicePlayback: true, lastSlicePosition: null, fullAudioPromise: new Promise(() => {}) }],
    currentId: 'mck-1',
    isPlaybackLoading: false,
    isSeeking: false,
    errorSkipCount: 0,
    preloadTrackId: null,
    preloadReadyUrl: null
  };

  const makeDeck = () => ({
    handlers: {},
    dataset: { trackId: 'mck-1' },
    src: 'blob:slice',
    currentTime: 0,
    duration: 165,
    paused: false,
    ended: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    fire(type) { (this.handlers[type] || []).forEach(fn => fn()); }
  });
  const audio = makeDeck();
  const standbyAudio = makeDeck();

  globalThis.formatTime = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
  globalThis.formatRemainingTime = () => '-2:45';
  globalThis.lastDisplayedPlaybackSecond = -1;
  globalThis.lastPositionStateSecond = -1;
  globalThis.syncSeek = v => { seekValues.push(v); $('seek').value = String(v); };
  globalThis.paintSeek = () => {};
  globalThis.updateLyricsHighlight = () => {};
  globalThis.updateMetadataFilters = () => {};
  globalThis.scheduleTrackRender = () => {};
  globalThis.library = { shouldPreloadNext: () => false, PRELOAD_LEAD_SECONDS: 10 };
  globalThis.preloadNext = () => {};
  globalThis.location = { href: 'https://example.test/' };

  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio, () => {}, () => {}, () => {}, $, {}, () => {}
  );
  attachDeckEvents(audio);

  // Simulate Chromium hitting truncated FLAC EOF -> jumps currentTime straight to 165 (2:45), ended=true
  audio.currentTime = 165;
  audio.ended = true;
  audio.paused = true;
  audio.fire('timeupdate');
  audio.fire('pause');
  audio.fire('ended');

  assert.equal($('current-time').textContent, '0:00', 'Current time must stay at 0:00, not jump to 2:45');
  assert.equal($('seek').value, '0', 'Seek bar must stay at 0, not jump to 1000 (100%)');
  assert.ok(!seekValues.includes(1000), 'syncSeek(1000) must never be called on premature slice EOF');
  assert.equal($('play-button').textContent, '…', 'Play button must stay in loading state (…), not ▶');
});

test('v2.6.3: Stale old deck timeupdate is ignored while new track is loading', () => {
  const dom = {};
  const makeEl = () => ({
    textContent: '0:00',
    value: '0',
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    matches: () => false
  });
  const $ = id => (dom[id] ||= makeEl());

  const seekValues = [];
  const state = {
    tracks: [
      { id: 'old-track', duration: 165 },
      { id: 'new-track', duration: 210 }
    ],
    currentId: 'new-track',
    isPlaybackLoading: true,
    isSeeking: false,
    errorSkipCount: 0,
    preloadTrackId: null,
    preloadReadyUrl: null
  };
  const audio = {
    handlers: {},
    dataset: { trackId: 'old-track' },
    src: 'blob:old',
    currentTime: 165,
    duration: 165,
    paused: false,
    ended: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    fire(type) { (this.handlers[type] || []).forEach(fn => fn()); }
  };
  const standbyAudio = { paused: true, src: '' };

  globalThis.formatTime = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
  globalThis.formatRemainingTime = () => '-3:30';
  globalThis.lastDisplayedPlaybackSecond = -1;
  globalThis.lastPositionStateSecond = -1;
  globalThis.syncSeek = v => { seekValues.push(v); $('seek').value = String(v); };
  globalThis.paintSeek = () => {};
  globalThis.updateLyricsHighlight = () => {};
  globalThis.updateMetadataFilters = () => {};
  globalThis.scheduleTrackRender = () => {};
  globalThis.library = { shouldPreloadNext: () => false, PRELOAD_LEAD_SECONDS: 10 };
  globalThis.preloadNext = () => {};
  globalThis.location = { href: 'https://example.test/' };

  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio, () => {}, () => {}, () => {}, $, {}, () => {}
  );
  attachDeckEvents(audio);

  audio.fire('timeupdate');
  assert.equal($('current-time').textContent, '0:00', 'Old deck timeupdate must not overwrite new track time');
  assert.equal(seekValues.length, 0, 'Old deck timeupdate must not call syncSeek');
});

test('v2.6.3: Smart album sequential playback covers all album contexts and respects repeat before radio', () => {
  assert.ok(html.includes('const isFilteredAlbum = Boolean(state.album && state.album !== \'*\');'), 'Must detect filtered album context');
  assert.ok(html.includes('const isGroupedByAlbum = Boolean(state.groupBy === \'album\' && track);'), 'Must detect album-grouped context');
  assert.ok(html.includes('rawAlbumTracks = renderedTracks;'), 'Must preserve exact sorted renderedTracks order inside album view');
  // In playNext & queueIndex, repeat === 1 must appear before roonRadio inside seqResult.isEnd
  const qiStart = html.indexOf('function queueIndex() {');
  const qiBlock = html.slice(qiStart, qiStart + 3000);
  const qiEndIdx = qiBlock.indexOf('if (seqResult && seqResult.isEnd)');
  const qiEndSection = qiBlock.slice(qiEndIdx, qiEndIdx + 900);
  assert.ok(qiEndSection.indexOf('state.repeat === 1') < qiEndSection.indexOf('state.roonRadio'), 'queueIndex must check repeat === 1 before roonRadio at album end');
  assert.ok(!qiEndSection.includes('(current + 1) % state.tracks.length'), 'queueIndex must not jump to random outside track at album end');

  const pnStart = html.indexOf('function playNext(direction = 1, auto = false) {');
  const pnBlock = html.slice(pnStart, pnStart + 4500);
  const pnEndIdx = pnBlock.indexOf('if (seqResult && seqResult.isEnd && direction > 0)');
  const pnEndSection = pnBlock.slice(pnEndIdx, pnEndIdx + 1200);
  assert.ok(pnEndSection.indexOf('state.repeat === 1') < pnEndSection.indexOf('state.roonRadio'), 'playNext must check repeat === 1 before roonRadio at album end');
  assert.ok(!pnEndSection.includes('(currentIndex + 1) % state.tracks.length'), 'playNext must not jump to random outside track at album end');
});
