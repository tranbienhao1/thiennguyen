'use strict';

// Pha B — hàng bài hát kiểu Tidal (Melissa chọn 20:35, ảnh danh sách
// "My Songs" 1251 bài: hàng cũ là thẻ bo tròn, bìa 40px, tiêu đề text-xs,
// số thứ tự tĩnh, huy hiệu chất lượng vuông, thời lượng text-[10px]).
// Hàng mới: phẳng, ngăn bằng hairline; bìa 48px; số thứ tự đổi thành ▶
// khi hover; tiêu đề text-sm rõ hơn nghệ sĩ text-xs; huy hiệu thành pill;
// thời lượng text-xs. Chỉ đổi class/hình thức, không đổi dữ liệu hàng
// nên chữ ký hàng và đường nhẹ của renderTrackRows giữ nguyên.

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

// Nối dây tĩnh trên CSS: hàng phẳng hairline, bìa 48px bo 4px.
const style = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
assert.ok(style.includes('#track-list .track-row { min-height:64px;border:0;border-bottom:1px solid #ffffff0a;padding:10px 16px;'), 'The Tidal row should be flat with a hairline divider instead of a rounded card');
assert.ok(style.includes('#track-list .track-row .track-art { width:48px;height:48px;border-radius:4px;'), 'The Tidal cover should be 48px with a small 4px radius');
assert.ok(!style.includes('#track-list .track-row { min-height:64px;border:1px solid transparent;'), 'The old rounded-card row rule must be gone');

class FakeElement {
  constructor() { this.dataset = {}; this.children = []; this.className = ''; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

class FakeList extends FakeElement {
  constructor() { super(); this._html = ''; this.rows = []; }
  set innerHTML(value) {
    this._html = value;
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

const list = new FakeList();
const state = {sortAsc: true, groupBy: '', currentId: 'a', queueTrackIds: []};
const tracks = [
  {id: 'a', title: 'Alpha', artist: 'Ca sĩ A', album: 'Album 1', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 197, cover: 'blob:cover-a'},
  {id: 'b', title: 'Beta', artist: 'Ca sĩ B', album: 'Album 1', format: 'FLAC', sampleRate: 96000, bitDepth: 24, duration: 52},
];
const renderTrackRows = new Function(
  'state', '$', 'library', 'groupTracks', 'quality', 'escapeHtml', 'sourceLabel', 'formatTime',
  'renderQueue', 'updateCurrentTrackIndicator', 'metadataUI', 'addToQueue', 'playTrack', 'removeFromQueue',
  `${extractFunction(appCode, 'trackRowsSignature')}\n${extractFunction(appCode, 'recordTrackRowsRender')}\n${extractFunction(appCode, 'renderTrackRows')}\nreturn renderTrackRows;`,
)(
  state,
  id => (id === 'track-list' ? list : null),
  {trackMetadata: track => ({title: track.title, artist: track.artist, album: track.album})},
  (shownTracks) => [{label: '', tracks: shownTracks}],
  track => ({label: (track.sampleRate || 0) > 48000 ? 'HI-RES' : 'LOSSLESS', tone: ''}),
  value => String(value),
  value => value,
  value => `${value}s`,
  () => {}, () => {}, {open: () => {}},
  () => {}, () => {}, () => {},
);
renderTrackRows(tracks);
const rowsHtml = list.innerHTML;
assert.ok(rowsHtml.includes('track-hover-play'), 'The track number should turn into a play button on hover');
assert.ok(rowsHtml.includes('group-hover:invisible'), 'The track number should hide when the hover play button shows');
assert.ok(rowsHtml.includes('track-art relative grid h-12 w-12'), 'The Tidal cover should be 48px (h-12 w-12)');
assert.ok(rowsHtml.includes('track-title block truncate text-sm font-medium'), 'The Tidal title should be text-sm, larger than the artist line');
assert.ok(rowsHtml.includes('mt-0.5 block truncate text-xs text-zinc-500'), 'The artist line should be text-xs under the larger title');
assert.ok(rowsHtml.includes('border-b border-white/[.06] px-4 py-2'), 'The Tidal row should be flat with a hairline bottom border');
assert.ok(!rowsHtml.includes('rounded-xl border border-transparent px-3 py-2.5'), 'The old rounded-card row must be gone');
assert.ok(rowsHtml.includes('rounded-full border px-2 py-0.5 text-[9px]'), 'The quality badge should be a small pill');
assert.ok(rowsHtml.includes('text-right text-xs tabular-nums text-zinc-400'), 'The duration should be text-xs in a muted tabular font');
assert.ok(rowsHtml.includes('data-track-id="a"') && rowsHtml.includes('data-track-id="b"'), 'Both tracks should still render with their ids');

console.log('Tidal-style track row tests passed.');
