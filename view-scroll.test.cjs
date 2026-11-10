'use strict';

// Pha B — ghi nhớ vị trí cuộn của danh sách bài hát khi chuyển view:
// setLibraryView lưu scrollTop của #content-col theo từng view trước khi
// rời view cũ và khôi phục lại khi quay về, thay vì luôn cuộn về đầu.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.ok(appCode.includes('viewScroll: {}'), 'state should hold a per-view scroll memory');
assert.ok(appCode.includes('function saveViewScroll()'), 'View switching should save the scroll position before leaving a view');
assert.ok(appCode.includes('function restoreViewScroll()'), 'View switching should restore the saved scroll position');
assert.ok(appCode.includes('saveViewScroll();\n      const supported'), 'setLibraryView should save scroll before changing the active view');
assert.ok(appCode.includes('restoreViewScroll();'), 'setLibraryView should restore scroll after rendering the new view');
assert.ok(!appCode.includes("$('content-col').scrollTop = 0;"), 'View switching should no longer force the list back to the top');

// Trích một khai báo function top-level bằng cách đếm dấu ngoặc nhọn.
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

const helpers = ['saveViewScroll', 'restoreViewScroll', 'setLibraryView']
  .map(name => extractFunction(appCode, name)).join('\n');
new vm.Script(helpers, {filename: 'view-scroll.helpers.js'});

const contentCol = {scrollTop: 0};
const state = {activeView: 'songs', viewScroll: {}, trackScope: 'album-1', groupBy: 'artist', recentHistory: []};
let pickFolderCalls = 0, renderCalls = 0, readHistoryCalls = 0;
const sidebarCalls = [];
const context = {
  state,
  $: id => (id === 'content-col' ? contentCol : null),
  pickFolder: () => { pickFolderCalls++; },
  renderTracks: () => { renderCalls++; },
  readHistory: () => { readHistoryCalls++; },
  setSidebarOpen: open => { sidebarCalls.push(open); },
  window: {matchMedia: () => ({matches: false})},
  console,
};
vm.createContext(context);
vm.runInContext(helpers, context);
const setLibraryView = vm.runInContext('setLibraryView', context);
const saveViewScroll = vm.runInContext('saveViewScroll', context);
const restoreViewScroll = vm.runInContext('restoreViewScroll', context);

// Rời khỏi view Bài hát ở vị trí 420, sang Album lần đầu phải về đầu trang.
contentCol.scrollTop = 420;
setLibraryView('albums');
assert.equal(state.viewScroll.songs, 420, 'Leaving Songs should remember its scroll position');
assert.equal(state.activeView, 'albums', 'Switching to Albums should change the active view');
assert.equal(contentCol.scrollTop, 0, 'First visit to a view should start at the top');
assert.equal(state.trackScope, null, 'Switching views should clear the album/track scope');
assert.equal(state.groupBy, 'none', 'Switching views should reset grouping');
assert.equal(renderCalls, 1, 'Switching views should re-render the list');

// Cuộn Album tới 150 rồi quay lại Bài hát: phải về đúng 420.
contentCol.scrollTop = 150;
setLibraryView('songs');
assert.equal(state.viewScroll.albums, 150, 'Leaving Albums should remember its scroll position');
assert.equal(state.activeView, 'songs', 'Switching back to Songs should change the active view');
assert.equal(contentCol.scrollTop, 420, 'Returning to Songs should restore its saved scroll position');

// View không hỗ trợ rơi về Albums và khôi phục vị trí đã lưu của Albums.
setLibraryView('unknown-view');
assert.equal(state.activeView, 'albums', 'An unsupported view should fall back to Albums');
assert.equal(contentCol.scrollTop, 150, 'Falling back to Albums should restore its saved scroll position');

// Chọn thư mục không đổi view, không lưu/khôi phục cuộn, không render lại.
const rendersBeforeFolders = renderCalls;
contentCol.scrollTop = 999;
setLibraryView('folders');
assert.equal(pickFolderCalls, 1, 'Choosing Folders should open the folder picker');
assert.equal(state.activeView, 'albums', 'Choosing Folders should not change the active view');
assert.equal(contentCol.scrollTop, 999, 'Choosing Folders should leave the scroll position alone');
assert.equal(renderCalls, rendersBeforeFolders, 'Choosing Folders should not re-render the list');

// Mở History khi chưa có lịch sử phải đọc lại lịch sử đã nghe.
state.recentHistory = [];
setLibraryView('history');
assert.equal(readHistoryCalls, 1, 'Opening an empty History view should reload the listening history');

// Biên: thiếu #content-col hoặc view rỗng thì không được ném lỗi.
context.$ = () => null;
assert.doesNotThrow(saveViewScroll, 'Saving scroll without the content column should not throw');
assert.doesNotThrow(restoreViewScroll, 'Restoring scroll without the content column should not throw');
context.$ = id => (id === 'content-col' ? contentCol : null);
state.activeView = '';
assert.doesNotThrow(saveViewScroll, 'Saving scroll without an active view should not throw');
assert.equal(Object.keys(state.viewScroll).length, 2, 'Saving without an active view should not record a position');

// Biên: vị trí âm đã lưu phải kẹp về 0 khi khôi phục.
state.activeView = 'songs';
state.viewScroll.songs = -30;
restoreViewScroll();
assert.equal(contentCol.scrollTop, 0, 'A negative saved position should clamp to the top');

console.log('View scroll memory tests passed.');
