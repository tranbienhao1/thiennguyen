'use strict';

// Pha B — Versions kiểu Roon (Melissa chọn 20:58): gộp các bản trùng của
// cùng một bài (cùng tiêu đề + nghệ sĩ đã chuẩn hoá, ví dụ 2 file Rio
// trùng nhau của cô ấy) thành 1 hàng chính + huy hiệu "N phiên bản";
// bấm huy hiệu thì mở rộng/thu gọn các bản còn lại ngay dưới hàng đó.
// Bản chính là bản chất lượng cao nhất (sample rate, rồi bit depth,
// rồi dung lượng). Các bản bị gộp vẫn phát được khi mở rộng, vẫn vào
// được hàng đợi, vẫn tìm được bằng tìm kiếm. Chữ ký hàng tính trên các
// hàng đang hiển thị nên mở rộng/thu gọn dựng lại, đổi bài thì không.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const utils = require('./library-utils.js');

assert.equal(typeof utils.groupTrackVersions, 'function', 'groupTrackVersions should exist in library-utils');
assert.equal(typeof utils.compareTrackQuality, 'function', 'compareTrackQuality should exist in library-utils');

// Dữ liệu thật: 2 file Rio trùng nhau của Melissa (cùng md5, cùng size).
const rioDir = path.join(__dirname, '..', 'user', 'files');
const rioPaths = [
  path.join(rioDir, '01_52Hz__Rio_-___I_1_k3al.flac'),
  path.join(rioDir, '01_52Hz__Rio_-___I_2_8iux.flac'),
];
const rioFiles = rioPaths.map(filePath => {
  const buffer = fs.readFileSync(filePath);
  return {filePath, buffer, size: buffer.length, md5: crypto.createHash('md5').update(buffer).digest('hex')};
});
assert.equal(rioFiles[0].size, 20770699, 'Rio file 1 should be 20,770,699 bytes as Melissa sent it');
assert.equal(rioFiles[1].size, 20770699, 'Rio file 2 should be 20,770,699 bytes as Melissa sent it');
assert.equal(rioFiles[0].md5, rioFiles[1].md5, 'The two Rio files should be byte-identical (same md5)');

// Đọc STREAMINFO thật của FLAC: 'fLaC' + block header 4 byte, rồi
// sample rate 20 bit ở byte 18-20 và bits-per-sample ở byte 20-21.
function parseFlacStreamInfo(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'fLaC', 'The file should start with the fLaC marker');
  const sampleRate = (buffer[18] << 12) | (buffer[19] << 4) | (buffer[20] >> 4);
  const bitDepth = (((buffer[20] & 0x01) << 4) | (buffer[21] >> 4)) + 1;
  return {sampleRate, bitDepth};
}
const rioInfo = rioFiles.map(file => parseFlacStreamInfo(file.buffer));
assert.deepEqual(rioInfo[0], {sampleRate: 44100, bitDepth: 16}, 'Rio should be 44.1 kHz / 16-bit from its real STREAMINFO');
assert.deepEqual(rioInfo[1], {sampleRate: 44100, bitDepth: 16}, 'Both Rio files should parse to the same format');

const rioTracks = rioFiles.map((file, index) => ({
  id: `rio-${index + 1}`,
  title: 'Rio',
  artist: '52Hz',
  album: 'Rio',
  format: 'FLAC',
  sampleRate: rioInfo[index].sampleRate,
  bitDepth: rioInfo[index].bitDepth,
  duration: 197,
  size: file.size,
  source: 'local',
}));

// Gộp: 2 file Rio trùng thành đúng 1 nhóm, 2 phiên bản, có bản chính.
{
  const groups = utils.groupTrackVersions(rioTracks);
  assert.equal(groups.length, 1, 'The two identical Rio files should group into exactly one version group');
  assert.equal(groups[0].versions.length, 2, 'The Rio group should hold 2 versions');
  assert.equal(groups[0].primary.id, 'rio-1', 'With identical quality and size the first file stays the primary');
  assert.equal(groups[0].key, 'rio\t52hz', 'The group key should be the normalized title + artist');
}

// Bản chính = chất lượng cao nhất: 24-bit/96 kHz thắng 16-bit/44,1 kHz;
// cùng sample rate + bit depth thì file lớn hơn thắng.
{
  const tracks = [
    {id: 'low', title: 'Rio', artist: '52Hz', sampleRate: 44100, bitDepth: 16, size: 20770699},
    {id: 'high', title: 'Rio', artist: '52Hz', sampleRate: 96000, bitDepth: 24, size: 15000000},
    {id: 'big', title: 'Rio', artist: '52Hz', sampleRate: 44100, bitDepth: 16, size: 30000000},
  ];
  const groups = utils.groupTrackVersions(tracks);
  assert.equal(groups.length, 1, 'Same title + artist should group regardless of quality');
  assert.equal(groups[0].primary.id, 'high', 'The 24-bit/96 kHz version should be the primary');
  assert.deepEqual(groups[0].versions.map(track => track.id), ['high', 'big', 'low'], 'Versions should be ordered best quality first, then largest');
  assert.ok(utils.compareTrackQuality(tracks[1], tracks[0]) < 0, 'compareTrackQuality should rank the higher-quality track first');
  assert.ok(utils.compareTrackQuality(tracks[0], tracks[2]) > 0, 'compareTrackQuality should rank the larger file first on a quality tie');
}

// Không gộp: khác tiêu đề, khác nghệ sĩ, khác dấu nhưng cùng chuẩn hoá
// thì vẫn gộp; bài không tên/nghệ sĩ không xác định thì không gộp.
{
  const tracks = [
    {id: 'a', title: 'Rio', artist: '52Hz', sampleRate: 44100, bitDepth: 16, size: 1},
    {id: 'b', title: 'RIO', artist: '52HZ', sampleRate: 44100, bitDepth: 16, size: 1},
    {id: 'c', title: 'Intro', artist: '52Hz', sampleRate: 44100, bitDepth: 16, size: 1},
    {id: 'd', title: 'Rio', artist: 'Khác', sampleRate: 44100, bitDepth: 16, size: 1},
    {id: 'e', title: '', artist: '', sampleRate: 44100, bitDepth: 16, size: 1},
    {id: 'f', title: '', artist: '', sampleRate: 44100, bitDepth: 16, size: 1},
  ];
  const groups = utils.groupTrackVersions(tracks);
  assert.equal(groups.length, 5, 'Accent/case variants should merge, different titles/artists should not, untitled tracks should stay separate');
  assert.equal(groups.find(group => group.key === 'rio\t52hz').versions.length, 2, 'Rio and RIO by 52Hz/52HZ should merge into one group');
}

// Dữ liệu biên: không phải mảng, mảng rỗng, phần tử bẩn.
assert.deepEqual(utils.groupTrackVersions(null), [], 'A non-array input should group into nothing');
assert.deepEqual(utils.groupTrackVersions([]), [], 'An empty list should group into nothing');
assert.equal(utils.groupTrackVersions([null, undefined, 'x', rioTracks[0]]).length, 1, 'Invalid entries should be skipped, valid tracks still grouped');

// Tìm kiếm vẫn tìm được cả hai bản Rio trùng nhau.
assert.equal(utils.filterTracks(rioTracks, {query: 'rio'}).length, 2, 'Searching "rio" should still find both duplicate files');
assert.equal(utils.filterTracks(rioTracks, {query: '52hz'}).length, 2, 'Searching by artist should still find both duplicate files');

// renderTrackRows: gộp thành 1 hàng + huy hiệu "2 phiên bản" khi thu
// gọn, mở rộng ra 2 hàng đều phát được (data-track-id), chữ ký đổi khi
// mở rộng nên dựng lại, gọi lại cùng trạng thái thì đi đường nhẹ.
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

class FakeElement {
  constructor() { this.dataset = {}; this.children = []; this.className = ''; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

class FakeList extends FakeElement {
  constructor() { super(); this._html = ''; this.rows = []; this.htmlSets = 0; }
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
  const state = {sortAsc: true, groupBy: '', currentId: null, queueTrackIds: [], expandedVersions: new Set()};
  const renderTrackRows = new Function(
    'state', '$', 'library', 'groupTracks', 'quality', 'escapeHtml', 'sourceLabel', 'formatTime',
    'renderQueue', 'updateCurrentTrackIndicator', 'metadataUI', 'addToQueue', 'playTrack', 'removeFromQueue',
    'usesFirstSliceCache', 'firstSliceCacheText',
    `${extractFunction(appCode, 'trackRowsSignature')}\n${extractFunction(appCode, 'recordTrackRowsRender')}\n${extractFunction(appCode, 'renderTrackRows')}\nreturn renderTrackRows;`,
  )(
    state,
    id => (id === 'track-list' ? list : null),
    utils,
    utils.groupTracks,
    track => ({label: (track.sampleRate || 0) > 48000 ? 'HI-RES' : 'LOSSLESS', tone: ''}),
    value => String(value),
    value => value,
    value => `${value}s`,
    () => {}, () => {}, {open: () => {}},
    () => {}, () => {}, () => {},
    track => !!track && (!!track.isDsd || track.source === 'google' || track.source === 'onedrive'),
    cached => cached === true ? 'lát đầu đã lưu trong bộ nhớ · phát ngay khi bấm lại' : cached === false ? 'lát đầu chưa lưu trong bộ nhớ' : '',
  );
  const tracks = [...rioTracks, {id: 'intro', title: 'Intro', artist: '52Hz', album: 'Rio', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 52, size: 3727828, source: 'local'}];
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 1, 'The first render should build the rows');
  assert.equal(list.rows.length, 2, 'Two Rio duplicates plus Intro should render as 2 rows when collapsed');
  assert.ok(list.innerHTML.includes('2 phiên bản'), 'The collapsed Rio row should show the "2 phiên bản" badge');
  assert.ok(list.innerHTML.includes('data-version-action="toggle"'), 'The versions badge should be a toggle button');
  assert.ok(list.innerHTML.includes('data-track-id="rio-1"'), 'The primary Rio version should keep its track id');
  assert.ok(!list.innerHTML.includes('data-track-id="rio-2"'), 'The duplicate Rio version should be hidden while collapsed');
  assert.ok(list.innerHTML.includes('data-track-id="intro"'), 'The unrelated Intro track should still render');

  // Mở rộng nhóm Rio: cả hai bản hiện ra, bản phụ thụt vào + dấu ↳.
  state.expandedVersions.add('rio\t52hz');
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 2, 'Expanding the versions should rebuild the rows (the signature changes)');
  assert.equal(list.rows.length, 3, 'Expanding should show both Rio versions plus Intro');
  assert.ok(list.innerHTML.includes('data-track-id="rio-2"'), 'The duplicate Rio version should render once expanded');
  assert.ok(list.innerHTML.includes('track-version-row'), 'The expanded version row should be marked as a version row');
  assert.ok(list.innerHTML.includes('↳'), 'The expanded version row should show the version marker');
  assert.ok(list.innerHTML.includes('2 phiên bản ▴'), 'The badge should show the expanded state');

  // Gọi lại cùng trạng thái mở rộng: đường nhẹ, không dựng lại.
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 2, 'Re-rendering with the same expansion state must take the light path');

  // Thu gọn lại: về 2 hàng, huy hiệu về trạng thái thu gọn.
  state.expandedVersions.delete('rio\t52hz');
  renderTrackRows(tracks);
  assert.equal(list.htmlSets, 3, 'Collapsing the versions should rebuild the rows again');
  assert.equal(list.rows.length, 2, 'Collapsing should hide the duplicate Rio version again');
  assert.ok(list.innerHTML.includes('2 phiên bản ▾'), 'The badge should show the collapsed state');
}

console.log('Versions (Roon-style duplicate grouping) tests passed.');
