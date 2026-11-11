'use strict';

// Pha B — hiển thị thời gian giải mã DSD / throughput trong chi tiết bài
// hát: huy hiệu chất lượng trong hàng bài hát của bài DSD mang tooltip
// là dòng kiểm toán giải mã đầy đủ (thời gian, lát chậm nhất, throughput
// MB/s) để xem tốc độ worker ngay trong danh sách mà không cần mở Phòng
// nghe. Số đo về sau khi worker giải mã xong nên phải nằm trong chữ ký
// hàng — nếu không, đường nhẹ bỏ qua dựng lại và tooltip không bao giờ
// xuất hiện. Bài chưa có số đo thì không tooltip.

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

// Nối dây tĩnh: hàng phải tính dòng kiểm toán cho bài DSD và gắn nó làm
// tooltip của huy hiệu chất lượng; chữ ký hàng phải gồm số đo giải mã.
assert.ok(appCode.includes('formatDecodeAudit(track.dsdDecodeMs, track.dsdMaxChunkMs, track.dsdChunksOverBudget, track.dsdThroughputMBps, track.dsdInitialChunkBytes, track.dsdMaxConsecutiveOverBudget, track.dsdMinSliceThroughputMBps, track.dsdFirstSliceMs)'), 'The row should compute the DSD decode audit from the track measurements');
assert.ok(appCode.includes('title="${escapeHtml(badgeTitle)}"'), 'The quality badge should carry the decode audit as its tooltip');
assert.ok(appCode.includes('track.dsdDecodeMs'), 'The row signature should include the DSD decode measurements');

const libraryStub = {trackMetadata: track => ({title: track.title, artist: track.artist, album: track.album})};
const qualityStub = track => ({label: track.isDsd ? `DSD${track.dsdMultiplier || 64}` : 'LOSSLESS', tone: ''});
const formatDecodeAudit = new Function(`${extractFunction(appCode, 'formatDecodeAudit')}\nreturn formatDecodeAudit;`)();

// Chữ ký: đổi khi số đo giải mã DSD về sau (worker 'done'), đổi khi chỉ
// có số đo lát đầu, ổn định khi không có số đo, và không đổi với bài
// không phải DSD dù có gán nhầm các trường dsd.
{
  const state = {sortAsc: true, groupBy: '', currentId: 'a', queueTrackIds: []};
  const signature = new Function('state', 'library', 'quality', `${extractFunction(appCode, 'trackRowsSignature')}\nreturn trackRowsSignature;`)(state, libraryStub, qualityStub);
  const dsd = {id: 'd', title: 'Sonata', artist: 'Ca sĩ D', album: 'Album D', format: 'DSF', isDsd: true, sampleRate: 2822400, duration: 180};
  const plain = {id: 'p', title: 'Rio', artist: 'Ca sĩ P', album: 'Album P', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 197};
  const tracks = [dsd, plain];
  const before = signature(tracks);
  dsd.dsdFirstSliceMs = 120;
  assert.notEqual(signature(tracks), before, 'The first-slice decode time arriving must change the signature so the row rebuilds with the tooltip');
  const withSlice = signature(tracks);
  dsd.dsdDecodeMs = 1200; dsd.dsdMaxChunkMs = 34; dsd.dsdThroughputMBps = 45.2;
  assert.notEqual(signature(tracks), withSlice, 'The full decode measurements arriving must change the signature so the row rebuilds with the full audit tooltip');
  const withFull = signature(tracks);
  dsd.dsdMinSliceThroughputMBps = 12.5;
  assert.notEqual(signature(tracks), withFull, 'The slowest-slice throughput arriving must change the signature too');
  assert.equal(signature(tracks), signature(tracks), 'The signature should be stable for unchanged measurements');
  plain.dsdDecodeMs = 999; plain.dsdThroughputMBps = 99;
  assert.equal(signature(tracks), signature(tracks), 'Stray DSD fields on a non-DSD track must not change the signature');
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

function badgeTitle(listHtml, trackId) {
  const row = [...listHtml.matchAll(/<div[^>]*data-track-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)]
    .find(match => match[1] === trackId);
  assert.ok(row, `Row for ${trackId} should be rendered`);
  const badge = row[2].match(/<span class="rounded-full border[^>]*>/);
  assert.ok(badge, `Row for ${trackId} should have a quality badge`);
  const title = badge[0].match(/ title="([^"]*)"/);
  return title ? title[1] : null;
}

function makeHarness() {
  const list = new FakeList();
  const state = {sortAsc: true, groupBy: '', currentId: 'a', queueTrackIds: []};
  const calls = {renderQueue: 0, indicator: 0};
  const renderTrackRows = new Function(
    'state', '$', 'library', 'groupTracks', 'quality', 'escapeHtml', 'sourceLabel', 'formatTime',
    'renderQueue', 'updateCurrentTrackIndicator', 'metadataUI', 'addToQueue', 'playTrack', 'removeFromQueue',
    'performance', 'formatDecodeAudit', 'usesFirstSliceCache', 'firstSliceCacheText',
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
    {now: () => 1000},
    formatDecodeAudit,
    track => !!track && (!!track.isDsd || track.source === 'google' || track.source === 'onedrive'),
    cached => cached === true ? 'lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại' : cached === false ? 'lát đầu chưa lưu trong bộ nhớ' : '',
  );
  return {list, state, calls, renderTrackRows};
}

// Bài DSD chưa có số đo thì huy hiệu không tooltip; khi số đo về, hàng
// được dựng lại (không đi đường nhẹ) và tooltip hiện đủ thời gian +
// throughput; bài FLAC không bao giờ có tooltip kiểm toán.
{
  const harness = makeHarness();
  const dsd = {id: 'd', title: 'Sonata', artist: 'Ca sĩ D', album: 'Album D', format: 'DSF', isDsd: true, dsdMultiplier: 64, sampleRate: 2822400, duration: 180};
  const flac = {id: 'p', title: 'Rio', artist: 'Ca sĩ P', album: 'Album P', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 197};
  const tracks = [dsd, flac];
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 1, 'The first render should build the rows');
  assert.equal(badgeTitle(harness.list.innerHTML, 'd'), null, 'A DSD track without measurements should have no audit tooltip');
  assert.equal(badgeTitle(harness.list.innerHTML, 'p'), null, 'A FLAC track should never have an audit tooltip');
  dsd.dsdFirstSliceMs = 120;
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 2, 'The first-slice measurement arriving must rebuild the rows instead of taking the light path');
  assert.ok((badgeTitle(harness.list.innerHTML, 'd') || '').includes('đang giải mã… lát đầu xong sau 120 ms'), 'The first-slice tooltip should show the first-slice decode time while the full decode is still running');
  dsd.dsdDecodeMs = 1200; dsd.dsdMaxChunkMs = 34; dsd.dsdThroughputMBps = 45.2; dsd.dsdFirstSliceMs = null;
  harness.renderTrackRows(tracks);
  assert.equal(harness.list.htmlSets, 3, 'The full decode measurements arriving must rebuild the rows again');
  const title = badgeTitle(harness.list.innerHTML, 'd');
  assert.ok(title && title.includes('giải mã 1.2 s'), 'The full audit tooltip should show the total decode time');
  assert.ok(title.includes('lát chậm nhất 34 ms'), 'The full audit tooltip should show the slowest chunk');
  assert.ok(title.includes('45.2 MB/s'), 'The full audit tooltip should show the decode throughput');
  assert.equal(badgeTitle(harness.list.innerHTML, 'p'), null, 'The FLAC track should still have no audit tooltip after the DSD measurements arrive');
}

console.log('dsd-row-audit: all assertions passed');
