'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  VirtualTrackList,
  calculateVirtualWindow,
  renderVirtualizedTrackRows
} = require('../virtual-scroll.js');

const htmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(htmlPath, 'utf8');

test('1. Module Exports', () => {
  assert.equal(typeof calculateVirtualWindow, 'function', 'calculateVirtualWindow should be exported');
  assert.equal(typeof VirtualTrackList, 'function', 'VirtualTrackList class should be exported');
  assert.equal(typeof renderVirtualizedTrackRows, 'function', 'renderVirtualizedTrackRows should be exported');
});

test('2. calculateVirtualWindow Window Calculation & Mathematical Invariant', () => {
  const totalItems = 1251;
  const rowHeight = 64;
  const containerHeight = 640; // 10 rows visible
  const bufferCount = 5;

  // Initial window at top (scrollTop = 0)
  const initialWin = calculateVirtualWindow(totalItems, 0, containerHeight, rowHeight, bufferCount);
  assert.equal(initialWin.startIndex, 0, 'Start index at top should be 0');
  assert.equal(initialWin.endIndex, 15, 'End index should include 10 visible rows + 5 buffer rows');
  assert.equal(initialWin.topSpacerHeight, 0, 'Top spacer at top should be 0');
  assert.equal(initialWin.bottomSpacerHeight, (1251 - 15) * 64, 'Bottom spacer should cover remaining 1236 items');
  assert.equal(initialWin.visibleIndices.length, 15, 'visibleIndices array length should match endIndex - startIndex');
  assert.equal(initialWin.visibleIndices[0], 0, 'First index should be 0');
  assert.equal(initialWin.visibleIndices[14], 14, 'Last index should be 14');

  // Invariant verification: topSpacer + visibleRowsHeight + bottomSpacer === totalHeight
  const totalCalculatedHeight = initialWin.topSpacerHeight + (initialWin.endIndex - initialWin.startIndex) * rowHeight + initialWin.bottomSpacerHeight;
  assert.equal(totalCalculatedHeight, totalItems * rowHeight, 'Calculated total height must match totalItems * rowHeight');

  // Scrolled to middle (scrollTop = 3200, row 50)
  const midWin = calculateVirtualWindow(totalItems, 3200, containerHeight, rowHeight, bufferCount);
  assert.equal(midWin.startIndex, 45, 'Start index should be 50 - 5 buffer = 45');
  assert.equal(midWin.endIndex, 65, 'End index should be 50 + 10 visible + 5 buffer = 65');
  assert.equal(midWin.topSpacerHeight, 45 * 64, 'Top spacer should equal 45 * 64');
  assert.equal(midWin.bottomSpacerHeight, (1251 - 65) * 64, 'Bottom spacer should equal (1251 - 65) * 64');
  assert.equal(midWin.visibleIndices.length, 20, 'Should render 20 items in middle');
  const midTotalHeight = midWin.topSpacerHeight + (midWin.endIndex - midWin.startIndex) * rowHeight + midWin.bottomSpacerHeight;
  assert.equal(midTotalHeight, totalItems * rowHeight, 'Middle scroll total height invariant must hold');

  // Small list fitting completely on screen
  const smallWin = calculateVirtualWindow(10, 0, 800, 64, 5);
  assert.equal(smallWin.startIndex, 0);
  assert.equal(smallWin.endIndex, 10);
  assert.equal(smallWin.topSpacerHeight, 0);
  assert.equal(smallWin.bottomSpacerHeight, 0);
  assert.equal(smallWin.visibleIndices.length, 10);
});

test('3. Scroll Boundary Handling (Top, Bottom, Overscroll, Empty)', () => {
  const totalItems = 100;
  const rowHeight = 50;
  const containerHeight = 500; // 10 rows visible
  const bufferCount = 2;
  const maxScroll = totalItems * rowHeight - containerHeight; // 4500

  // Empty list (0 items)
  const emptyWin = calculateVirtualWindow(0, 0, containerHeight, rowHeight, bufferCount);
  assert.equal(emptyWin.startIndex, 0);
  assert.equal(emptyWin.endIndex, 0);
  assert.equal(emptyWin.topSpacerHeight, 0);
  assert.equal(emptyWin.bottomSpacerHeight, 0);
  assert.deepEqual(emptyWin.visibleIndices, []);

  // Top boundary with negative scroll (bounce / overscroll)
  const negativeWin = calculateVirtualWindow(totalItems, -250, containerHeight, rowHeight, bufferCount);
  assert.equal(negativeWin.startIndex, 0, 'Negative scrollTop must clamp to startIndex 0');
  assert.equal(negativeWin.topSpacerHeight, 0, 'Negative scrollTop top spacer must be 0');

  // Exact bottom boundary (scrollTop = maxScroll = 4500)
  const bottomWin = calculateVirtualWindow(totalItems, maxScroll, containerHeight, rowHeight, bufferCount);
  assert.equal(bottomWin.endIndex, totalItems, 'At bottom boundary, endIndex must equal totalItems');
  assert.equal(bottomWin.bottomSpacerHeight, 0, 'At bottom boundary, bottom spacer must be 0');
  assert.equal(bottomWin.startIndex, 88, 'Start index should be 90 - 2 buffer = 88');
  assert.equal(bottomWin.topSpacerHeight, 88 * 50, 'Top spacer should be 88 * 50 = 4400');
  assert.equal(bottomWin.topSpacerHeight + (bottomWin.endIndex - bottomWin.startIndex) * 50 + bottomWin.bottomSpacerHeight, 5000);

  // Past bottom boundary (huge overscroll: scrollTop = 100000)
  const overscrollWin = calculateVirtualWindow(totalItems, 100000, containerHeight, rowHeight, bufferCount);
  assert.equal(overscrollWin.endIndex, totalItems, 'Overscroll past bottom must clamp endIndex to totalItems');
  assert.equal(overscrollWin.bottomSpacerHeight, 0, 'Overscroll past bottom bottomSpacer must be 0');
  assert.ok(overscrollWin.visibleIndices.length > 0, 'Overscroll must still display bottom visible items');
});

// Mock DOM elements for virtual rendering tests
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(...names) { names.forEach(n => this.classes.add(n)); }
  remove(...names) { names.forEach(n => this.classes.delete(n)); }
  contains(name) { return this.classes.has(name); }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.className = '';
    this.classList = new MockClassList();
    this.style = {};
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this._innerHTML = '';
    this.listeners = {};
    this.scrollTop = 0;
    this.clientHeight = 640;
    this.scrollHeight = 640;
    this.parentElement = null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l !== listener);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    list.forEach(cb => cb(event));
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    
    // Parse top spacer
    if (html.includes('id="virtual-top-spacer"')) {
      const topSpacer = new MockElement('div');
      topSpacer.id = 'virtual-top-spacer';
      const heightMatch = html.match(/id="virtual-top-spacer"[^>]*style="height:([^;"]+)/);
      if (heightMatch) topSpacer.style.height = heightMatch[1];
      this.children.push(topSpacer);
    }

    // Parse track rows
    const rowMatches = [...html.matchAll(/class="([^"]*track-row[^"]*)"[^>]*data-track-index="(\d+)"[^>]*data-track-id="([^"]+)"/g)];
    for (const match of rowMatches) {
      const row = new MockElement('div');
      row.className = match[1];
      match[1].split(/\s+/).forEach(c => c && row.classList.add(c));
      row.dataset.trackIndex = match[2];
      row.dataset.trackId = match[3];

      const title = new MockElement('span');
      title.className = 'track-title';
      title.classList.add(match[1].includes('active') ? 'text-violet-200' : 'text-zinc-200');
      row.children.push(title);

      const art = new MockElement('span');
      art.className = 'track-art';
      if (html.includes('track-playing-overlay')) {
        const overlay = new MockElement('span');
        overlay.className = 'track-playing-overlay';
        art.children.push(overlay);
      }
      row.children.push(art);

      this.children.push(row);
    }

    // Parse bottom spacer
    if (html.includes('id="virtual-bottom-spacer"')) {
      const bottomSpacer = new MockElement('div');
      bottomSpacer.id = 'virtual-bottom-spacer';
      const heightMatch = html.match(/id="virtual-bottom-spacer"[^>]*style="height:([^;"]+)/);
      if (heightMatch) bottomSpacer.style.height = heightMatch[1];
      this.children.push(bottomSpacer);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '#virtual-top-spacer') return this.children.find(c => c.id === 'virtual-top-spacer') || null;
    if (selector === '#virtual-bottom-spacer') return this.children.find(c => c.id === 'virtual-bottom-spacer') || null;
    if (selector.startsWith('[data-track-id="')) {
      const id = selector.match(/data-track-id="([^"]+)"/)[1];
      return this.children.find(c => c.dataset && c.dataset.trackId === id) || null;
    }
    if (selector === '.track-title') return this.children.find(c => c.className === 'track-title') || null;
    if (selector === '.track-art') return this.children.find(c => c.className === 'track-art') || null;
    if (selector === '.track-playing-overlay') return this.children.find(c => c.className === 'track-playing-overlay') || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-track-id]') {
      return this.children.filter(c => c.dataset && c.dataset.trackId);
    }
    return [];
  }

  contains(el) {
    return this.children.includes(el);
  }
}

test('4. VirtualTrackList DOM Rendering with Spacers & Slicing', () => {
  const container = new MockElement('div');
  container.clientHeight = 640;
  container.scrollTop = 0;

  const tracks = Array.from({ length: 500 }, (_, i) => ({
    id: `track-${i}`,
    title: `Track ${i}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200
  }));

  const instance = renderVirtualizedTrackRows(container, tracks, {
    rowHeight: 64,
    bufferCount: 5,
    scrollTop: 0,
    containerHeight: 640
  });

  assert.ok(instance instanceof VirtualTrackList, 'Should return VirtualTrackList instance');
  assert.equal(container._virtualTrackList, instance, 'Should cache instance on container._virtualTrackList');

  // Verify spacers
  const topSpacer = container.querySelector('#virtual-top-spacer');
  const bottomSpacer = container.querySelector('#virtual-bottom-spacer');
  assert.ok(topSpacer, 'Top spacer must exist in DOM');
  assert.ok(bottomSpacer, 'Bottom spacer must exist in DOM');
  assert.equal(topSpacer.style.height, '0px', 'Initial top spacer height should be 0px');
  assert.equal(bottomSpacer.style.height, `${(500 - 15) * 64}px`, 'Bottom spacer should cover remaining tracks');

  // Verify only the visible slice (15 rows) is in the DOM, NOT 500 rows!
  const renderedRows = container.querySelectorAll('[data-track-id]');
  assert.equal(renderedRows.length, 15, 'Only 15 items should be rendered in the DOM out of 500 tracks');
  assert.equal(renderedRows[0].dataset.trackId, 'track-0');
  assert.equal(renderedRows[14].dataset.trackId, 'track-14');

  // Simulate scroll to middle
  instance.options.scrollTop = 3200; // row 50
  instance.render(true);

  const scrolledRows = container.querySelectorAll('[data-track-id]');
  assert.equal(scrolledRows.length, 20, 'Scrolled window renders 20 items (10 visible + 10 buffers)');
  assert.equal(scrolledRows[0].dataset.trackId, 'track-45', 'First scrolled track is track-45');
  assert.equal(scrolledRows[19].dataset.trackId, 'track-64', 'Last scrolled track is track-64');

  const scrolledTopSpacer = container.querySelector('#virtual-top-spacer');
  const scrolledBottomSpacer = container.querySelector('#virtual-bottom-spacer');
  assert.equal(scrolledTopSpacer.style.height, `${45 * 64}px`);
  assert.equal(scrolledBottomSpacer.style.height, `${(500 - 65) * 64}px`);
});

test('5. Scroll Event Throttling with requestAnimationFrame', () => {
  const container = new MockElement('div');
  let rafCallback = null;
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = cb => { rafCallback = cb; return 1; };

  try {
    const instance = new VirtualTrackList(container, {
      rowHeight: 64,
      bufferCount: 5,
      scrollTop: 0,
      containerHeight: 640
    });
    instance.setTracks(Array.from({ length: 100 }, (_, i) => ({ id: `t-${i}`, title: `T${i}` })));

    assert.equal(instance.rafPending, false);
    instance.onScroll();
    assert.equal(instance.rafPending, true, 'First onScroll sets rafPending to true');

    // Duplicate scroll call within same frame must be throttled
    instance.onScroll();
    assert.equal(instance.rafPending, true, 'Second onScroll remains throttled');

    // Execute animation frame callback
    assert.ok(typeof rafCallback === 'function');
    rafCallback();
    assert.equal(instance.rafPending, false, 'After RAF fires, rafPending resets to false');
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('6. Interactive Event Handlers & Playing Indicators', () => {
  const container = new MockElement('div');
  const clickedTrackIds = [];
  const contextMenuTrackIds = [];

  const tracks = [
    { id: 't-0', title: 'Song 0', artist: 'Artist A' },
    { id: 't-1', title: 'Song 1', artist: 'Artist B' }
  ];

  const instance = renderVirtualizedTrackRows(container, tracks, {
    rowHeight: 64,
    currentId: 't-0',
    onRowClick: trackId => clickedTrackIds.push(trackId),
    onRowContextMenu: trackId => contextMenuTrackIds.push(trackId)
  });

  // Verify initial active state on t-0
  const row0 = container.querySelector('[data-track-id="t-0"]');
  assert.ok(row0.classList.contains('active'), 'Playing track t-0 should have active class');

  // Test delegated click
  container.dispatchEvent({
    type: 'click',
    target: {
      closest: sel => (sel === '[data-track-id]' ? row0 : null)
    }
  });
  assert.equal(clickedTrackIds.length, 1);
  assert.equal(clickedTrackIds[0], 't-0');

  // Test delegated contextmenu
  container.dispatchEvent({
    type: 'contextmenu',
    clientX: 120,
    clientY: 240,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: {
      closest: sel => (sel === '[data-track-id]' ? row0 : null)
    }
  });
  assert.equal(contextMenuTrackIds.length, 1);
  assert.equal(contextMenuTrackIds[0], 't-0');

  // Test in-place indicator update when song switches to t-1
  instance.updateIndicators('t-1');
  const row1 = container.querySelector('[data-track-id="t-1"]');
  assert.equal(row0.classList.contains('active'), false, 'Previous track t-0 loses active class');
  assert.equal(row1.classList.contains('active'), true, 'New track t-1 gains active class');
});

test('7. index.html Integration: script inclusion & renderTrackRows compatibility', () => {
  assert.ok(
    indexHtml.includes('<script src="virtual-scroll.js"></script>'),
    'index.html must include <script src="virtual-scroll.js"></script>'
  );

  assert.ok(
    indexHtml.includes('tracks.length > 40 && typeof renderVirtualizedTrackRows === \'function\''),
    'index.html renderTrackRows must integrate renderVirtualizedTrackRows when tracks.length > 40'
  );

  assert.ok(
    indexHtml.includes('list.dataset.trackRowsSignature === signature'),
    'Signature verification before rebuilding must be preserved'
  );
  assert.ok(
    indexHtml.includes('list.dataset.trackRowsSignature = signature'),
    'Signature persistence must be preserved'
  );
});

test('8. CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)', () => {
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved'
  );
});
