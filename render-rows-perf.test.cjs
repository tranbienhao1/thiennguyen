'use strict';

// Pha D — đo hiệu năng render danh sách lớn sau bản sửa chữ ký hàng
// (15:30): renderTrackRows đã có đường nhẹ bỏ qua dựng lại khi chữ ký
// không đổi, nhưng chưa có số đo nào chứng minh đường nhẹ nhanh hơn hẳn
// đường dựng lại. Bản sửa bấm giờ bằng performance.now() quanh cả hai
// đường và ghi lần render gần nhất (mili-giây, số hàng, có đi đường nhẹ
// hay không) vào state.lastTrackRowsMs / lastTrackRowsCount /
// lastTrackRowsSkipped để xem trong console và để test hồi quy đo được.

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

class FakeClassList {
  constructor(initial = []) { this.items = new Set(initial); }
  add(...names) { names.forEach(name => this.items.add(name)); }
  remove(...names) { names.forEach(name => this.items.delete(name)); }
  contains(name) { return this.items.has(name); }
}

class FakeElement {
  constructor() {
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.textContent = '';
    this.className = '';
  }
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

class FakeList extends FakeElement {
  constructor() {
    super();
    this._html = '';
    this.htmlSets = 0;
    this.rows = [];
  }
  set innerHTML(value) {
    this._html = value;
    this.htmlSets++;
    this.rows = [...value.matchAll(/data-track-index="\d+" data-track-id="([^"]+)"/g)].map(match => {
      const row = new FakeElement();
      row.dataset.trackId = match[1];
      return row;
    });
  }
  get innerHTML() { return this._html; }
  querySelectorAll(selector) {
    if (selector === '[data-track-id]') return this.rows;
    return [];
  }
  querySelector(selector) {
    const match = selector.match(/data-track-id="([^"]+)"/);
    if (!match) return null;
    return this.rows.find(row => row.dataset.trackId === match[1]) || null;
  }
}

const libraryStub = {trackMetadata: track => ({title: track.title, artist: track.artist, album: track.album})};
const qualityStub = track => ({label: (track.sampleRate || 0) > 48000 ? 'HI-RES' : 'LOSSLESS', tone: ''});

function makeTracks(count) {
  return Array.from({length: count}, (_, i) => ({
    id: `track-${i}`, title: `Bài ${String(i).padStart(4, '0')}`, artist: 'Ca sĩ A',
    album: 'Album 1', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 197,
  }));
}

function makeHarness(trackCount = 2) {
  const list = new FakeList();
  const state = {sortAsc: true, groupBy: '', currentId: 'track-0', queueTrackIds: []};
  const calls = {renderQueue: 0, indicator: 0};
  // Đồng hồ giả: mỗi lần đọc tăng 7 ms để số đo ghi lại là xác định.
  let now = 1000;
  const performance = {now: () => (now += 7)};
  const renderTrackRows = new Function(
    'state', '$', 'library', 'groupTracks', 'quality', 'escapeHtml', 'sourceLabel', 'formatTime',
    'renderQueue', 'updateCurrentTrackIndicator', 'metadataUI', 'addToQueue', 'playTrack', 'removeFromQueue',
    'performance',
    `${extractFunction(appCode, 'trackRowsSignature')}\n${extractFunction(appCode, 'recordTrackRowsRender')}\n${extractFunction(appCode, 'renderTrackRows')}\nreturn renderTrackRows;`,
  )(
    state,
    id => (id === 'track-list' ? list : null),
    libraryStub,
    (tracks) => [{label: '', tracks}],
    qualityStub,
    value => String(value),
    value => value,
    value => `${value}s`,
    () => { calls.renderQueue++; },
    () => { calls.indicator++; },
    {open: () => {}},
    () => {}, () => {}, () => {},
    performance,
  );
  return {list, state, calls, renderTrackRows};
}

// Đường dựng lại ghi số đo đầy đủ: mili-giây, số hàng, skipped = false.
{
  const harness = makeHarness();
  const tracks = makeTracks(2);
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 1, 'The first render should build the rows');
  assert.equal(harness.state.lastTrackRowsMs, 7, 'A full render should record the elapsed time between its two clock reads');
  assert.equal(harness.state.lastTrackRowsCount, 2, 'A full render should record how many rows it built');
  assert.equal(harness.state.lastTrackRowsSkipped, false, 'A full render should record that it did not take the light path');
}

// Đổi bài đang phát thì đi đường nhẹ: không dựng lại, số đo ghi skipped.
{
  const harness = makeHarness();
  const tracks = makeTracks(2);
  harness.renderTrackRows(tracks);
  harness.state.currentId = 'track-1';
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 1, 'Changing only the playing track must take the light path and not rebuild the rows');
  assert.equal(harness.state.lastTrackRowsMs, 7, 'The light path should still record its elapsed time');
  assert.equal(harness.state.lastTrackRowsCount, 2, 'The light path should still record the row count');
  assert.equal(harness.state.lastTrackRowsSkipped, true, 'The light path should record that it skipped the rebuild');
}

// Danh sách lớn (2000 bài): đường dựng lại ghi đúng số hàng, đường nhẹ
// sau đó ghi skipped mà không dựng lại.
{
  const harness = makeHarness();
  const tracks = makeTracks(2000);
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 1, 'A large first render should build the rows once');
  assert.equal(harness.state.lastTrackRowsCount, 2000, 'A large render should record all 2000 rows');
  assert.equal(harness.state.lastTrackRowsSkipped, false, 'A large first render should record a full rebuild');
  harness.state.currentId = 'track-1999';
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 1, 'Changing only the playing track in a large list must take the light path');
  assert.equal(harness.state.lastTrackRowsCount, 2000, 'The large light path should still record all 2000 rows');
  assert.equal(harness.state.lastTrackRowsSkipped, true, 'The large light path should record that it skipped the rebuild');
}

// Nối dây tĩnh: cả hai đường thoát của renderTrackRows đều ghi số đo, và
// helper ghi số đo phải tồn tại.
const renderSource = extractFunction(appCode, 'renderTrackRows');
assert.equal((renderSource.match(/recordTrackRowsRender\(/g) || []).length, 2, 'Both renderTrackRows exits (light path and full rebuild) should record the render measurement');
assert.ok(renderSource.includes('performance.now()'), 'renderTrackRows should time itself with performance.now()');
assert.ok(appCode.includes('function recordTrackRowsRender(ms, rows, skipped)'), 'recordTrackRowsRender should be defined in the app script');

console.log('render-rows-perf: all assertions passed');
