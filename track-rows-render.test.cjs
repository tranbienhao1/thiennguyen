'use strict';

// Pha D — hiệu năng render danh sách hàng nghìn bài: renderTrackRows dựng
// lại toàn bộ innerHTML + gắn lại hàng nghìn listener mỗi lần
// scheduleTrackRender() chạy, kể cả khi chỉ đổi bài đang phát (bấm
// phát/bài kế, loadedmetadata...). Bản sửa tính chữ ký của các hàng đang
// hiển thị (thứ tự đã sắp xếp, tiêu đề/nghệ sĩ/album, bìa, thời lượng,
// nhãn chất lượng, trạng thái hàng đợi) và bỏ qua việc dựng lại khi chữ
// ký không đổi; bài đang phát chỉ đổi class 'active'/màu tiêu đề/lớp phủ
// ♫ tại chỗ qua updateCurrentTrackIndicator. Bài đang phát cố tình không
// nằm trong chữ ký, nhưng bài trong hàng đợi mà trở thành bài đang phát
// thì có (nút "Phát tiếp theo" đổi thành chỉ báo hàng đợi).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

// Nối dây tĩnh: chữ ký phải tồn tại, đường dựng lại phải kiểm tra chữ ký
// đã lưu + số hàng trước khi gán innerHTML, và phải lưu chữ ký sau khi
// dựng lại; dấu hiệu bài đang phát phải đồng bộ cả màu tiêu đề và lớp phủ.
assert.ok(appCode.includes('function trackRowsSignature(tracks)'), 'trackRowsSignature should exist');
assert.ok(appCode.includes('list.dataset.trackRowsSignature === signature'), 'renderTrackRows should compare the stored row signature before rebuilding');
assert.ok(appCode.includes('list.dataset.trackRowsSignature = signature'), 'renderTrackRows should store the signature after rebuilding');
assert.ok(appCode.includes("querySelector('.track-title')"), 'The active-row indicator should sync the row title colour in place');
assert.ok(appCode.includes("querySelector('.track-playing-overlay')"), 'The active-row indicator should sync the playing overlay in place');
assert.ok(appCode.includes("class=\"track-title block truncate text-sm font-medium"), 'The row template should mark the title span for in-place updates');
assert.ok(appCode.includes('track-playing-overlay absolute inset-0'), 'The row template should mark the playing overlay for in-place updates');

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
    this.removed = false;
    this.parent = null;
  }
  addEventListener() {}
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() {
    this.removed = true;
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
    }
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function makeTracks() {
  return [
    {id: 'a', title: 'Alpha', artist: 'Ca sĩ A', album: 'Album 1', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 197, cover: 'blob:cover-a'},
    {id: 'b', title: 'Beta', artist: 'Ca sĩ B', album: 'Album 1', format: 'FLAC', sampleRate: 96000, bitDepth: 24, duration: 52},
  ];
}

const libraryStub = {trackMetadata: track => ({title: track.title, artist: track.artist, album: track.album})};
const qualityStub = track => ({label: (track.sampleRate || 0) > 48000 ? 'HI-RES' : 'LOSSLESS', tone: ''});

// Chữ ký: ổn định khi gọi lại, không đổi khi chỉ đổi bài đang phát,
// đổi khi bìa/thời lượng/hướng sắp xếp đổi, và khi bài trong hàng đợi
// trở thành bài đang phát (chỉ báo hàng đợi đổi).
{
  const state = {sortAsc: true, groupBy: '', currentId: 'a', queueTrackIds: []};
  const signature = new Function('state', 'library', 'quality', `${extractFunction(appCode, 'trackRowsSignature')}\nreturn trackRowsSignature;`)(state, libraryStub, qualityStub);
  const tracks = makeTracks();
  const first = signature(tracks);
  assert.equal(signature(tracks), first, 'The signature should be stable for unchanged rows');
  state.currentId = 'b';
  assert.equal(signature(tracks), first, 'Changing only the playing track must not change the signature (in-place update handles it)');
  state.currentId = 'a';
  state.queueTrackIds = ['b'];
  const queuedSig = signature(tracks);
  assert.notEqual(queuedSig, first, 'Adding a track to the queue must change the signature so the queue indicator shows');
  state.currentId = 'b';
  assert.notEqual(signature(tracks), queuedSig, 'A queued track becoming the playing track changes its queue indicator, so the signature must change');
  assert.equal(signature(tracks), first, 'Once the queued track is playing, the rows look as before so the signature returns');
  state.queueTrackIds = [];
  state.currentId = 'a';
  assert.equal(signature(tracks), first, 'Restoring the queue and the playing track should restore the signature');
  // Pha B — trạng thái cache lát đầu nằm trong chữ ký để đường nhẹ dựng
  // lại hàng khi tooltip huy hiệu đổi (code cũ không có nên chữ ký giữ
  // nguyên, tooltip không bao giờ xuất hiện).
  tracks[0].firstSliceCached = true;
  assert.notEqual(signature(tracks), first, 'A newly known cache status must change the signature so the badge tooltip rebuilds');
  tracks[0].firstSliceCached = false;
  assert.notEqual(signature(tracks), first, 'A cache status flipping to uncached must also change the signature');
  delete tracks[0].firstSliceCached;
  assert.equal(signature(tracks), first, 'Forgetting the cache status should restore the signature');
  tracks[1].cover = 'blob:cover-b';
  assert.notEqual(signature(tracks), first, 'A cover arriving later must change the signature so the row rebuilds with the cover');
  tracks[1].cover = undefined;
  tracks[0].duration = 198;
  assert.notEqual(signature(tracks), first, 'A duration arriving later must change the signature so the row shows it');
  tracks[0].duration = 197;
  state.sortAsc = false;
  assert.notEqual(signature(tracks), first, 'Flipping the sort direction must change the signature so the rows reorder');
  state.sortAsc = true;
  delete state.queueTrackIds;
  assert.equal(signature(tracks), first, 'A missing queue list must not throw and must not change the signature');
}

// updateCurrentTrackIndicator: đổi bài thì hàng cũ mất 'active'/màu tím/
// lớp phủ ♫, hàng mới nhận đủ ba thứ; gọi lại cùng bài thì không nhân
// đôi lớp phủ.
function makeIndicatorRow(id) {
  const row = new FakeElement();
  row.dataset.trackId = id;
  row.title = new FakeElement();
  row.title.classList.add('text-zinc-200');
  row.art = new FakeElement();
  row.querySelector = selector => {
    if (selector === '.track-title') return row.title;
    if (selector === '.track-art') return row.art;
    if (selector === '.track-playing-overlay') return row.art.children.find(child => child.className.includes('track-playing-overlay')) || null;
    return null;
  };
  row.art.querySelector = selector => (selector === '.track-playing-overlay' ? row.art.children.find(child => child.className.includes('track-playing-overlay')) || null : null);
  return row;
}
{
  const rowA = makeIndicatorRow('a');
  const rowB = makeIndicatorRow('b');
  const list = new FakeElement();
  list.querySelector = selector => {
    const match = selector.match(/data-track-id="([^"]+)"/);
    if (!match) return null;
    return match[1] === 'a' ? rowA : match[1] === 'b' ? rowB : null;
  };
  const state = {currentId: 'a'};
  const context = {
    console,
    $: id => (id === 'track-list' ? list : null),
    CSS: {escape: value => String(value)},
    document: {createElement: () => new FakeElement()},
    state,
  };
  vm.createContext(context);
  vm.runInContext(`let previousTrackRow = null;\n${extractFunction(appCode, 'updateCurrentTrackIndicator')}`, context, {filename: 'indicator.js'});
  const call = () => vm.runInContext('updateCurrentTrackIndicator()', context);
  call();
  assert.equal(rowA.classList.contains('active'), true, 'The playing row should gain the active class');
  assert.equal(rowA.title.classList.contains('text-violet-200'), true, 'The playing row title should turn violet');
  assert.equal(rowA.title.classList.contains('text-zinc-200'), false, 'The playing row title should lose the idle colour');
  assert.equal(rowA.art.children.length, 1, 'The playing row cover should gain the playing overlay');
  state.currentId = 'b';
  call();
  assert.equal(rowA.classList.contains('active'), false, 'The previous row should lose the active class');
  assert.equal(rowA.title.classList.contains('text-violet-200'), false, 'The previous row title should lose the violet colour');
  assert.equal(rowA.title.classList.contains('text-zinc-200'), true, 'The previous row title should return to the idle colour');
  assert.equal(rowA.art.children.length, 0, 'The previous row cover should lose the playing overlay');
  assert.equal(rowB.classList.contains('active'), true, 'The new playing row should gain the active class');
  assert.equal(rowB.art.children.length, 1, 'The new playing row cover should gain the playing overlay');
  call();
  assert.equal(rowB.art.children.length, 1, 'Calling again for the same track must not duplicate the playing overlay');
}

// renderTrackRows: lần đầu dựng lại, đổi bài đang phát thì đi đường nhẹ
// (không gán lại innerHTML), bìa về sau và bài trong hàng đợi thành bài
// đang phát thì dựng lại; danh sách rỗng cũng ổn định sau lần đầu.
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
{
  const list = new FakeList();
  const state = {sortAsc: true, groupBy: '', currentId: 'a', queueTrackIds: []};
  const calls = {renderQueue: 0, indicator: 0};
  const renderTrackRows = new Function(
    'state', '$', 'library', 'groupTracks', 'quality', 'escapeHtml', 'sourceLabel', 'formatTime',
    'renderQueue', 'updateCurrentTrackIndicator', 'metadataUI', 'addToQueue', 'playTrack', 'removeFromQueue',
    'usesFirstSliceCache', 'firstSliceCacheText',
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
    track => !!track && (!!track.isDsd || track.source === 'google' || track.source === 'onedrive'),
    cached => cached === true ? 'lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại' : cached === false ? 'lát đầu chưa lưu trong bộ nhớ' : '',
  );
  const tracks = makeTracks();
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 1, 'The first render should build the rows');
  assert.ok(typeof list.dataset.trackRowsSignature === 'string' && list.dataset.trackRowsSignature.length > 0, 'The first render should store the row signature');
  assert.equal(calls.renderQueue, 1, 'The first render should refresh the queue panel');
  state.currentId = 'b';
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 1, 'Changing only the playing track must take the light path and not rebuild the rows');
  assert.equal(calls.indicator, 1, 'The light path should still refresh the playing-row indicator');
  assert.equal(calls.renderQueue, 2, 'The light path should still refresh the queue panel');
  tracks[1].cover = 'blob:cover-b';
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 2, 'A cover arriving later must rebuild the rows');
  state.queueTrackIds = ['a'];
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 3, 'Adding a track to the queue must rebuild the rows');
  state.currentId = 'a';
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 4, 'A queued track becoming the playing track must rebuild the rows');
  renderTrackRows([]);
  assert.equal(list.htmlSets, 5, 'An empty scope must rebuild once to clear the rows');
  renderTrackRows([]);
  assert.equal(list.htmlSets, 5, 'Repeating an empty render must take the light path');
  // Pha B — tooltip huy hiệu chất lượng mang trạng thái cache lát đầu:
  // bài cloud đã biết đã lưu/chưa lưu thì title có dòng trạng thái, bài
  // chưa kiểm tra thì không có (code cũ không có dòng này).
  tracks[0].source = 'google'; tracks[0].firstSliceCached = true;
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 6, 'A newly known cache status must rebuild the rows');
  assert.ok(list.innerHTML.includes('title="lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại"'), 'A cached cloud track should show the cached status in its quality-badge tooltip');
  tracks[0].firstSliceCached = false;
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 7, 'A cache status flip must rebuild the rows');
  assert.ok(list.innerHTML.includes('title="lát đầu chưa lưu trong bộ nhớ"'), 'An uncached cloud track should show the uncached status in its quality-badge tooltip');
  delete tracks[0].firstSliceCached;
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 8, 'Forgetting the cache status must rebuild the rows');
  assert.ok(!list.innerHTML.includes('lát đầu'), 'A track with unknown cache status should show no cache line in its tooltip');
}
