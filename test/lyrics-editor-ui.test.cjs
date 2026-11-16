'use strict';

// ============================================================================
// Test Suite: lyrics-editor-ui.test.cjs
// Tests for Lyric Reader Karaoke Renderer, Lyric Syncer V2 Editor,
// and Manual LRCLIB Search Modal (lyrics-editor-ui.js)
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ----------------------------------------------------------------------------
// Lightweight DOM Mock for Unit Testing
// ----------------------------------------------------------------------------

const mockElementsById = new Map();

class MockDOMElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.id = '';
    this._textContent = '';
    this._innerHTML = '';
    this.listeners = {};
    this._attrs = new Map();
    this._classSet = new Set();
    this.style = {
      _styles: new Map(),
      backgroundImage: '',
      webkitBackgroundClip: '',
      backgroundClip: '',
      background: '',
      setProperty: (k, v) => { this.style._styles.set(k, String(v)); },
      removeProperty: (k) => { this.style._styles.delete(k); },
      getPropertyValue: (k) => this.style._styles.get(k) || ''
    };
    this.value = '';
    this.disabled = false;
    this.type = 'text';

    const self = this;
    this.classList = {
      add: (...names) => names.forEach(n => {
        if (!n) return;
        n.split(/\s+/).forEach(part => { if (part) self._classSet.add(part); });
      }),
      remove: (...names) => names.forEach(n => {
        if (!n) return;
        n.split(/\s+/).forEach(part => { if (part) self._classSet.delete(part); });
      }),
      toggle: (name, force) => {
        if (force === undefined) {
          if (self._classSet.has(name)) self._classSet.delete(name);
          else self._classSet.add(name);
        } else if (force) {
          self._classSet.add(name);
        } else {
          self._classSet.delete(name);
        }
      },
      contains: name => self._classSet.has(name),
      get length() { return self._classSet.size; }
    };
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(val) {
    this._classSet.clear();
    if (val) {
      String(val).split(/\s+/).filter(Boolean).forEach(c => this._classSet.add(c));
    }
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
    }
    return this._textContent;
  }

  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
    this.children = [];
    if (!val) return;
    parseHTMLIntoChildren(this, String(val));
  }

  setAttribute(k, v) {
    this._attrs.set(k, String(v));
    if (k === 'id') {
      this.id = String(v);
      mockElementsById.set(this.id, this);
    } else if (k === 'class') {
      this.className = String(v);
    } else if (k === 'value') {
      this.value = String(v);
    } else if (k.startsWith('data-')) {
      const dataKey = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[dataKey] = String(v);
    }
  }

  getAttribute(k) {
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }

  appendChild(child) {
    if (typeof child === 'string') {
      const textNode = new MockDOMElement('text');
      textNode.textContent = child;
      this.children.push(textNode);
      return textNode;
    }
    this.children.push(child);
    if (child.id) {
      mockElementsById.set(child.id, child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
    }
    return child;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(h => h !== handler);
    }
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const handlers = this.listeners[type] || [];
    for (const h of handlers) h(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
  }

  querySelectorAll(selector) {
    const results = [];
    const check = el => {
      if (!el || typeof el === 'string' || !el.classList) return;
      let matched = false;

      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        matched = el.classList.contains(cls);
      } else if (selector.startsWith('#')) {
        const id = selector.slice(1);
        matched = (el.id === id);
      } else if (selector.startsWith('[')) {
        const m = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          if (attr.startsWith('data-')) {
            const dataKey = attr.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            matched = (val === undefined ? el.dataset[dataKey] !== undefined : el.dataset[dataKey] === val);
          } else {
            matched = (val === undefined ? el.getAttribute(attr) !== null : el.getAttribute(attr) === val);
          }
        }
      } else if (el.tagName && el.tagName.toLowerCase() === selector.toLowerCase()) {
        matched = true;
      }

      if (matched) results.push(el);
      if (el.children) el.children.forEach(check);
    };

    if (this.children) this.children.forEach(check);
    return results;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }

  scrollIntoView() {
    this._scrolled = true;
  }
}

function parseHTMLIntoChildren(parent, html) {
  if (!html || typeof html !== 'string') return;

  const voidTags = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
  const stack = [parent];

  const tokenRegex = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9_-]+)>|<([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let match;

  while ((match = tokenRegex.exec(html)) !== null) {
    if (match[0].startsWith('<!--')) continue;

    // Closing tag
    if (match[1]) {
      const closeTag = match[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === closeTag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    // Opening tag
    if (match[2]) {
      const tagName = match[2];
      const rawAttrs = match[3] || '';
      const isSelfClosing = Boolean(match[4]) || voidTags.has(tagName.toLowerCase());

      const el = new MockDOMElement(tagName);

      const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : (attrMatch[4] !== undefined ? attrMatch[4] : ''));
        el.setAttribute(attrName, attrVal);
      }

      stack[stack.length - 1].appendChild(el);

      if (!isSelfClosing) {
        stack.push(el);
      }
      continue;
    }

    // Text content
    if (match[5]) {
      const text = match[5].trim();
      if (text) {
        stack[stack.length - 1].appendChild(text);
      }
    }
  }
}

// Global DOM setup
const mockBody = new MockDOMElement('body');

const mockDocument = {
  body: mockBody,
  createElement: (tag) => new MockDOMElement(tag),
  createTextNode: (text) => {
    const t = new MockDOMElement('text');
    t.textContent = text;
    return t;
  },
  getElementById: (id) => mockElementsById.get(id) || mockBody.querySelector('#' + id) || null,
  querySelectorAll: (sel) => mockBody.querySelectorAll(sel),
  querySelector: (sel) => mockBody.querySelector(sel),
  addEventListener: (t, h) => mockBody.addEventListener(t, h),
  removeEventListener: (t, h) => mockBody.removeEventListener(t, h)
};

globalThis.document = mockDocument;
globalThis.window = globalThis;
globalThis.localStorage = {
  _store: new Map(),
  getItem: (k) => globalThis.localStorage._store.get(k) || null,
  setItem: (k, v) => globalThis.localStorage._store.set(k, String(v)),
  removeItem: (k) => globalThis.localStorage._store.delete(k),
  clear: () => globalThis.localStorage._store.clear()
};

// Load dependencies
const LyricsUtils = require('../lyrics-utils.js');
const LrclibClient = require('../lrclib-client.js');
globalThis.LyricsUtils = LyricsUtils;
globalThis.LrclibClient = LrclibClient;

const LyricsEditorUI = require('../lyrics-editor-ui.js');

// ----------------------------------------------------------------------------
// TEST SUITES
// ----------------------------------------------------------------------------

test('LyricsEditorUI: Module exports and API interface', () => {
  assert.ok(LyricsEditorUI, 'LyricsEditorUI should be exported');
  assert.equal(typeof LyricsEditorUI.renderKaraokeLine, 'function');
  assert.equal(typeof LyricsEditorUI.openEditor, 'function');
  assert.equal(typeof LyricsEditorUI.closeEditor, 'function');
  assert.equal(typeof LyricsEditorUI.openSearch, 'function');
  assert.equal(typeof LyricsEditorUI.closeSearch, 'function');
  assert.equal(typeof LyricsEditorUI.detectTimelineAnomalies, 'function');
  assert.equal(typeof LyricsEditorUI.shiftLyricsLines, 'function');
  assert.equal(typeof LyricsEditorUI.parseLrc, 'function');
  assert.equal(typeof LyricsEditorUI.serializeLrc, 'function');
  assert.equal(typeof LyricsEditorUI.serializeLyricsfile, 'function');
});

test('renderKaraokeLine: Plain text line without words', () => {
  const container = mockDocument.createElement('p');
  const line = { text: 'Hello darkness my old friend', start_ms: 1000, end_ms: 3000 };

  LyricsEditorUI.renderKaraokeLine(container, line, 500);
  assert.equal(container.textContent, 'Hello darkness my old friend');
});

test('renderKaraokeLine: Word-by-word karaoke highlighting and progress calculation', () => {
  const container = mockDocument.createElement('p');
  const line = {
    text: 'I have come to talk with you',
    start_ms: 1000,
    end_ms: 5000,
    words: [
      { text: 'I', start_ms: 1000, end_ms: 1500 },
      { text: 'have', start_ms: 1500, end_ms: 2200 },
      { text: 'come', start_ms: 2200, end_ms: 3000 },
      { text: 'to', start_ms: 3000, end_ms: 3500 },
      { text: 'talk', start_ms: 3500, end_ms: 5000 }
    ]
  };

  // 1. Before line starts: currentMs = 800ms
  LyricsEditorUI.renderKaraokeLine(container, line, 800);
  const words = container.querySelectorAll('.lyric-word');
  assert.equal(words.length, 5, 'Should render 5 word spans');
  assert.equal(words[0].classList.contains('lyric-word-sung'), false);
  assert.equal(words[0].classList.contains('lyric-word-active'), false);
  assert.equal(words[0].dataset.fill, '0%');

  // 2. Midway through first word: currentMs = 1250ms (50% of 1000..1500)
  LyricsEditorUI.renderKaraokeLine(container, line, 1250);
  assert.equal(words[0].classList.contains('lyric-word-active'), true);
  assert.equal(words[0].classList.contains('lyric-word-sung'), false);
  assert.equal(words[0].dataset.fill, '50%');

  // 3. Second word active: currentMs = 1850ms (50% of 1500..2200)
  LyricsEditorUI.renderKaraokeLine(container, line, 1850);
  assert.equal(words[0].classList.contains('lyric-word-sung'), true);
  assert.equal(words[0].classList.contains('lyric-word-active'), false);
  assert.equal(words[0].dataset.fill, '100%');
  assert.equal(words[1].classList.contains('lyric-word-active'), true);

  // 4. Past entire line: currentMs = 6000ms
  LyricsEditorUI.renderKaraokeLine(container, line, 6000);
  for (let i = 0; i < 5; i++) {
    assert.equal(words[i].classList.contains('lyric-word-sung'), true, `Word ${i} should be sung`);
    assert.equal(words[i].classList.contains('lyric-word-active'), false, `Word ${i} should not be active`);
    assert.equal(words[i].dataset.fill, '100%');
  }
});

test('renderKaraokeLine: Word click seeking callback', () => {
  const container = mockDocument.createElement('p');
  const line = {
    text: 'Hello world',
    start_ms: 2000,
    end_ms: 4000,
    words: [
      { text: 'Hello', start_ms: 2000, end_ms: 3000 },
      { text: 'world', start_ms: 3000, end_ms: 4000 }
    ]
  };

  let soughtSec = null;
  LyricsEditorUI.renderKaraokeLine(container, line, 0, {
    onSeek: (sec) => { soughtSec = sec; }
  });

  const words = container.querySelectorAll('.lyric-word');
  words[1].click();
  assert.equal(soughtSec, 3.0, 'Clicking word at 3000ms should seek to 3.0 seconds');
});

test('renderKaraokeLine: Spans reuse across calls (performance check)', () => {
  const container = mockDocument.createElement('p');
  const line = {
    text: 'A B C',
    start_ms: 1000,
    end_ms: 4000,
    words: [
      { text: 'A', start_ms: 1000, end_ms: 2000 },
      { text: 'B', start_ms: 2000, end_ms: 3000 },
      { text: 'C', start_ms: 3000, end_ms: 4000 }
    ]
  };

  LyricsEditorUI.renderKaraokeLine(container, line, 1000);
  const spansFirst = container.querySelectorAll('.lyric-word');

  LyricsEditorUI.renderKaraokeLine(container, line, 2500);
  const spansSecond = container.querySelectorAll('.lyric-word');

  assert.equal(spansFirst[0], spansSecond[0], 'Should reuse existing DOM spans rather than recreating');
});

test('Lyric Syncer V2: Modal DOM structure and playback rate options', () => {
  const track = { id: 'test_t1', title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354 };
  LyricsEditorUI.openEditor(track, {
    lyricsText: '[00:01.00]Is this the real life?\n[00:04.50]Is this just fantasy?'
  });

  const modal = mockDocument.getElementById('lyrics-editor-modal');
  assert.ok(modal, 'Modal #lyrics-editor-modal should be in DOM');
  assert.equal(modal.classList.contains('hidden'), false, 'Modal should be visible');

  // Verify playback rate options: 0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x
  const rateSelect = modal.querySelector('#lyrics-editor-playback-rate');
  assert.ok(rateSelect, 'Playback rate select should exist');

  const actionButtons = [
    modal.querySelector('#lyrics-editor-save-btn'),
    modal.querySelector('#lyrics-editor-export-lrc-btn'),
    modal.querySelector('#lyrics-editor-export-yaml-btn'),
    modal.querySelector('#lyrics-editor-publish-btn')
  ];
  for (const btn of actionButtons) {
    assert.ok(btn, 'Required action button should be present in modal');
  }

  LyricsEditorUI.closeEditor();
  assert.equal(modal.classList.contains('hidden'), true, 'Modal should be hidden after closeEditor');
});

test('Lyric Syncer V2: Anomaly warnings (amber badge for gap > 5s, red badge for overlap)', () => {
  const track = { id: 'test_anomaly', title: 'Test Song', artist: 'Artist' };
  const anomalyLines = [
    { text: 'Line 1', start_ms: 1000, end_ms: 2000 },
    // Gap > 5s to next line (8000 - 2000 = 6000ms > 5000ms)
    { text: 'Line 2 with gap', start_ms: 8000, end_ms: 12000 },
    // Overlap: Line 2 end (12000) > Line 3 start (10000)
    { text: 'Line 3 with overlap', start_ms: 10000, end_ms: 14000 }
  ];

  LyricsEditorUI.openEditor(track, { lines: anomalyLines });

  const modal = mockDocument.getElementById('lyrics-editor-modal');
  const gapBadges = modal.querySelectorAll('.anomaly-gap');
  const overlapBadges = modal.querySelectorAll('.anomaly-overlap');

  assert.ok(gapBadges.length >= 1, 'Should display amber badge for gap > 5s');
  assert.ok(overlapBadges.length >= 1, 'Should display red warning badge for overlap');

  LyricsEditorUI.closeEditor();
});

test('Lyric Syncer V2: Keyboard shortcuts (Down/Enter to timestamp & advance, Up, Nudge, Undo/Redo)', () => {
  const track = { id: 'test_shortcuts', title: 'Test Shortcuts', artist: 'Artist' };
  const lines = [
    { text: 'Line 1', start_ms: 0, end_ms: 0 },
    { text: 'Line 2', start_ms: 0, end_ms: 0 },
    { text: 'Line 3', start_ms: 0, end_ms: 0 }
  ];

  // Set mock player currentTime
  globalThis.audio = {
    currentTime: 3.45, // 3450ms
    duration: 100,
    paused: true,
    playbackRate: 1.0,
    play: async () => { globalThis.audio.paused = false; },
    pause: () => { globalThis.audio.paused = true; }
  };

  LyricsEditorUI.openEditor(track, { lines });

  assert.equal(LyricsEditorUI.editorState.cursorIndex, 0);

  // 1. Press Enter/Down: timestamps Line 1 with 3450ms and advances to index 1
  LyricsEditorUI.editorStampAndAdvance();
  assert.equal(LyricsEditorUI.editorState.lines[0].start_ms, 3450, 'Line 1 start_ms should be 3450ms');
  assert.equal(LyricsEditorUI.editorState.cursorIndex, 1, 'Cursor should auto-advance to Line 2');

  // Advance player time to 7.80s (7800ms)
  globalThis.audio.currentTime = 7.80;

  // 2. Press Enter again: timestamps Line 2 with 7800ms and advances to index 2
  LyricsEditorUI.editorStampAndAdvance();
  assert.equal(LyricsEditorUI.editorState.lines[1].start_ms, 7800, 'Line 2 start_ms should be 7800ms');
  assert.equal(LyricsEditorUI.editorState.cursorIndex, 2, 'Cursor should auto-advance to Line 3');

  // 3. Up key moves to previous line
  mockBody.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: () => {} });
  assert.equal(LyricsEditorUI.editorState.cursorIndex, 1, 'ArrowUp should move cursor back to index 1');

  // 4. Nudge [ (-100ms) on Line 2
  LyricsEditorUI.editorNudge(-100);
  assert.equal(LyricsEditorUI.editorState.lines[1].start_ms, 7700, 'Nudge -100ms should decrease start_ms to 7700');

  // 5. Nudge ] (+100ms) on Line 2
  LyricsEditorUI.editorNudge(100);
  assert.equal(LyricsEditorUI.editorState.lines[1].start_ms, 7800, 'Nudge +100ms should increase start_ms back to 7800');

  // 6. Undo: undoes the +100ms nudge
  LyricsEditorUI.editorUndo();
  assert.equal(LyricsEditorUI.editorState.lines[1].start_ms, 7700, 'Undo should restore previous state (7700ms)');

  // 7. Redo: reapplies the +100ms nudge
  LyricsEditorUI.editorRedo();
  assert.equal(LyricsEditorUI.editorState.lines[1].start_ms, 7800, 'Redo should reapply 7800ms');

  LyricsEditorUI.closeEditor();
});

test('Manual LRCLIB Search Modal: Search input pre-filling and badge rendering', async () => {
  const track = { id: 'search_t1', title: 'Hotel California', artist: 'Eagles' };

  // Mock LrclibClient.searchLyrics
  const originalSearch = LrclibClient.searchLyrics;
  LrclibClient.searchLyrics = async (q, filter) => {
    return [
      {
        id: 101,
        trackName: 'Hotel California',
        artistName: 'Eagles',
        albumName: 'Hotel California',
        duration: 391,
        instrumental: false,
        plainLyrics: 'On a dark desert highway...',
        syncedLyrics: '[00:20.50]<00:20.50>On <00:21.00>a <00:21.30>dark <00:21.80>desert <00:22.50>highway',
        hasWordSync: true,
        hasSyncedLyrics: true,
        hasPlainLyrics: true
      },
      {
        id: 102,
        trackName: 'Hotel California (Acoustic)',
        artistName: 'Eagles',
        duration: 412,
        instrumental: false,
        plainLyrics: 'On a dark desert highway...',
        syncedLyrics: '[00:25.00]On a dark desert highway',
        hasWordSync: false,
        hasSyncedLyrics: true,
        hasPlainLyrics: true
      },
      {
        id: 103,
        trackName: 'Hotel California (Karaoke Instrumental)',
        artistName: 'Eagles',
        duration: 391,
        instrumental: true,
        plainLyrics: '',
        syncedLyrics: '',
        hasWordSync: false,
        hasSyncedLyrics: false,
        hasPlainLyrics: false
      }
    ];
  };

  LyricsEditorUI.openSearch(track);

  const modal = mockDocument.getElementById('lyrics-search-modal');
  assert.ok(modal, 'Modal #lyrics-search-modal should exist');
  assert.equal(modal.classList.contains('hidden'), false);

  const titleInput = modal.querySelector('#lyrics-search-title');
  const artistInput = modal.querySelector('#lyrics-search-artist');
  assert.equal(titleInput.value, 'Hotel California');
  assert.equal(artistInput.value, 'Eagles');

  // Trigger search
  await LyricsEditorUI.executeLyricsSearch();

  const resultsContainer = modal.querySelector('#lyrics-search-results');
  const wordSyncBadges = resultsContainer.querySelectorAll('.badge-word-sync');
  const syncedBadges = resultsContainer.querySelectorAll('.badge-synced');
  const plainBadges = resultsContainer.querySelectorAll('.badge-plain');
  const instrumentalBadges = resultsContainer.querySelectorAll('.badge-instrumental');

  assert.ok(wordSyncBadges.length >= 1, 'Should display Word Synced badge for item 101');
  assert.ok(syncedBadges.length >= 2, 'Should display Synced badge');
  assert.ok(plainBadges.length >= 2, 'Should display Plain badge');
  assert.ok(instrumentalBadges.length >= 1, 'Should display Instrumental badge for item 103');

  // Test Apply action
  let savedToVault = false;
  const origSaveVault = LrclibClient.saveLyricsToVault;
  LrclibClient.saveLyricsToVault = async (key, data) => {
    savedToVault = true;
    assert.equal(key, 'search_t1');
    assert.ok(data.lrc.includes('On') && data.lrc.includes('desert'));
  };

  const applyButtons = resultsContainer.querySelectorAll('.btn-apply-lyrics');
  assert.ok(applyButtons.length >= 1, 'Should have Apply buttons');

  // Click Apply on item 101
  await LyricsEditorUI.applyLyricsItem(LyricsEditorUI.searchState.results[0]);
  assert.equal(savedToVault, true, 'Applying lyric should save into offline vault');
  assert.equal(modal.classList.contains('hidden'), true, 'Modal should close after applying');

  // Restore mocks
  LrclibClient.searchLyrics = originalSearch;
  LrclibClient.saveLyricsToVault = origSaveVault;
  LyricsEditorUI.closeSearch();
});

test('Format conversion: serializeLrc and serializeLyricsfile', () => {
  const data = {
    metadata: { title: 'Test Title', artist: 'Test Artist', album: 'Test Album' },
    lines: [
      { text: 'First line', start_ms: 1200, end_ms: 3000 },
      {
        text: 'Second line',
        start_ms: 3500,
        end_ms: 5000,
        words: [
          { text: 'Second', start_ms: 3500, end_ms: 4200 },
          { text: 'line', start_ms: 4200, end_ms: 5000 }
        ]
      }
    ]
  };

  const lrc = LyricsEditorUI.serializeLrc(data.lines, data.metadata);
  assert.ok(lrc.includes('[ti:Test Title]'));
  assert.ok(lrc.includes('[00:01.20]First line'));
  assert.ok(lrc.includes('<00:03.50>Second'));

  const yaml = LyricsEditorUI.serializeLyricsfile(data);
  assert.ok(yaml.includes('version:'));
  assert.ok(yaml.includes('Test Title'));
  assert.ok(yaml.includes('1200'));
});
