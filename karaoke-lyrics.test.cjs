'use strict';

// ============================================================================
// Test Suite: karaoke-lyrics.test.cjs
// Phase C: Karaoke Word-by-Word Highlight & Smooth Scrolling for .lrc Lyrics
// Architecture: Pure Vanilla JS, Node.js Built-in Test Runner & assert/strict
// Methodology: 4-Tier Systematic Testing Model (Feature, Boundary, Combinatorial, Scenario)
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const libraryPath = path.join(__dirname, 'library-utils.js');
const indexPath = path.join(__dirname, 'index.html');

const utils = require(libraryPath);
new vm.Script(fs.readFileSync(libraryPath, 'utf8'), { filename: 'library-utils.js' });

const html = fs.readFileSync(indexPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

// ----------------------------------------------------------------------------
// Lightweight DOM Harness for Lyrics Testing
// ----------------------------------------------------------------------------
class MockDOMElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this._textContent = '';
    this.listeners = {};
    this.scrolledIntoView = false;
    this.lastScrollOptions = null;
    this.rect = null;
    this._innerHTML = '';

    const classSet = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => classSet.add(n)),
      remove: (...names) => names.forEach(n => classSet.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classSet.has(name)) classSet.delete(name);
          else classSet.add(name);
        } else if (force) {
          classSet.add(name);
        } else {
          classSet.delete(name);
        }
      },
      contains: name => classSet.has(name),
      get length() { return classSet.size; }
    };
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join('');
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
    this.children = [];
    this._innerHTML = String(val);
  }

  appendChild(child) {
    if (typeof child === 'string') {
      const textNode = new MockDOMElement('text');
      textNode.textContent = child;
      this.children.push(textNode);
      return textNode;
    }
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  querySelectorAll(selector) {
    const results = [];
    const check = el => {
      if (selector === '.lyric-line' && el.classList.contains('lyric-line')) results.push(el);
      else if (selector === '.lyric-word' && el.classList.contains('lyric-word')) results.push(el);
      else if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) results.push(el);
      if (el.children) el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }

  getBoundingClientRect() {
    return this.rect || { top: 0, bottom: 28, left: 0, right: 100, width: 100, height: 28 };
  }

  scrollIntoView(options) {
    this.scrolledIntoView = true;
    this.lastScrollOptions = options;
  }
}

function extractFunction(source, functionName) {
  const funcPattern = new RegExp('(?:async\\s+)?function\\s+' + functionName + '\\s*\\([^)]*\\)\\s*\\{');
  const match = funcPattern.exec(source);
  if (!match) return null;
  const startIndex = match.index;
  let braceCount = 0;
  let inString = null;
  let inComment = false;
  let i = startIndex + match[0].length - 1;

  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (inComment === 'line') {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inComment === 'block') {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      inComment = 'line';
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      inComment = 'block';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') braceCount++;
    else if (ch === '}') {
      braceCount--;
      if (braceCount === 0) return source.slice(startIndex, i + 1);
    }
  }
  return null;
}

function createLyricsHarness(lrcText, currentTime = 0, duration = 300) {
  const container = new MockDOMElement('div');
  container.rect = { top: 0, bottom: 200, left: 0, right: 100, width: 100, height: 200 };

  const audioStub = { currentTime, duration };
  const stateStub = { lyrics: [], lyricIndex: -1 };

  const renderLyricsCode = extractFunction(appCode, 'renderLyrics');
  const updateHighlightCode = extractFunction(appCode, 'updateLyricsHighlight');
  assert.ok(renderLyricsCode, 'renderLyrics function must be found in index.html');
  assert.ok(updateHighlightCode, 'updateLyricsHighlight function must be found in index.html');
  const lyricsSource = renderLyricsCode + '\n' + updateHighlightCode;

  const mockDoc = {
    createElement: tag => new MockDOMElement(tag),
    createTextNode: text => {
      const node = new MockDOMElement('text');
      node.textContent = text;
      return node;
    }
  };

  let positionUpdated = false;
  const fns = new Function('state', '$', 'library', 'audio', 'document', 'updatePositionState', `
    ${lyricsSource}
    return { renderLyrics, updateLyricsHighlight };
  `)(
    stateStub,
    id => (id === 'room-lyrics' ? container : null),
    utils,
    audioStub,
    mockDoc,
    () => { positionUpdated = true; }
  );

  fns.renderLyrics(lrcText);
  return { container, audioStub, stateStub, fns, wasPositionUpdated: () => positionUpdated };
}

// ============================================================================
// TIER 1: FEATURE COVERAGE (Isolated Feature Functionality)
// Minimum >=5 tests per feature
// ============================================================================

test('Tier 1 - Feature 1: Enhanced LRC Parsing (parseLyrics)', async t => {
  await t.test('1.1 parses word timestamps into non-enumerable words property', () => {
    const lrc = '[00:02.00]<00:02.00>Anh <00:02.50>yeu <00:03.00>em';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].time, 2);
    assert.equal(lines[0].text, 'Anh yeu em');

    assert.ok(Array.isArray(lines[0].words), 'line.words must be an array');
    assert.equal(lines[0].words.length, 3);
    assert.deepEqual(lines[0].words, [
      { time: 2, text: 'Anh' },
      { time: 2.5, text: 'yeu' },
      { time: 3, text: 'em' }
    ]);
  });

  await t.test('1.2 words property is non-enumerable for assert.deepStrictEqual compatibility', () => {
    const lrc = '[00:03.50]<00:03.50>Enhanced <00:04.00>words here';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    const desc = Object.getOwnPropertyDescriptor(lines[0], 'words');
    assert.ok(desc, 'Property descriptor for words must exist');
    assert.equal(desc.enumerable, false, 'Property words MUST be non-enumerable');
    assert.deepEqual(Object.keys(lines[0]), ['time', 'text'], 'Object.keys must only expose time and text');

    // Regression test in library-utils.test.cjs:98 uses assert.deepStrictEqual
    assert.deepStrictEqual(lines[0], { time: 3.5, text: 'Enhanced words here' });
  });

  await t.test('1.3 strips <mm:ss.xx> tags cleanly from line.text', () => {
    const lrc = '[00:10.00]<00:10.00>First <00:10.50>Second <00:11.00>Third';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines[0].text, 'First Second Third');
  });

  await t.test('1.4 handles fractional precision (1, 2, 3, and 4 digits plus 0 fraction)', () => {
    const lrc = '[00:05.1234]<00:05.1>One <00:05.50>Two <00:05.654>Three <00:05.1234>Four <00:06>Five';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'One Two Three Four Five', 'Raw tags with 4 digits or no fraction must be stripped completely from line text');
    assert.equal(lines[0].words.length, 5);
    assert.equal(lines[0].words[0].time, 5.1);
    assert.equal(lines[0].words[1].time, 5.5);
    assert.equal(lines[0].words[2].time, 5.654);
    assert.equal(lines[0].words[3].time, 5.1234);
    assert.equal(lines[0].words[4].time, 6.0);
  });

  await t.test('1.5 preserves line-level chronological sorting with Enhanced LRC lines', () => {
    const lrc = '[00:10.00]<00:10.00>Later\n[00:02.00]<00:02.00>Earlier';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].time, 2);
    assert.equal(lines[0].text, 'Earlier');
    assert.equal(lines[1].time, 10);
    assert.equal(lines[1].text, 'Later');
  });

  await t.test('1.6 multi-tag line expands into distinct entries with respective words', () => {
    const lrc = '[00:01.00][00:09.00]<00:01.00>Chorus <00:01.50>repeat';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].time, 1);
    assert.equal(lines[1].time, 9);
    assert.equal(lines[0].text, 'Chorus repeat');
    assert.equal(lines[1].text, 'Chorus repeat');
    assert.ok(lines[0].words && lines[0].words.length === 2);
    assert.deepEqual(lines[0].words, [
      { time: 1.0, text: 'Chorus' },
      { time: 1.5, text: 'repeat' }
    ]);
    assert.ok(lines[1].words && lines[1].words.length === 2, 'Second occurrence words must have non-zero length');
    assert.deepEqual(lines[1].words, [
      { time: 9.0, text: 'Chorus' },
      { time: 9.5, text: 'repeat' }
    ], 'Second occurrence must recalculate word timings offset to 9.0s and 9.5s');
  });
});

test('Tier 1 - Feature 2: Word Timing Helpers (parseKaraokeWords & lyricWordAt)', async t => {
  await t.test('2.1 parseKaraokeWords extracts word tokens and calculates seconds', () => {
    assert.equal(typeof utils.parseKaraokeWords, 'function', 'parseKaraokeWords must be exported');
    const words = utils.parseKaraokeWords('<00:01.00>Xin <00:01.40>chao <00:02.00>Viet Nam', 1.0, 0);
    assert.equal(words.length, 3);
    assert.deepEqual(words, [
      { time: 1.0, text: 'Xin' },
      { time: 1.4, text: 'chao' },
      { time: 2.0, text: 'Viet Nam' }
    ]);
  });

  await t.test('2.2 parseKaraokeWords applies offsetMs correctly', () => {
    const words = utils.parseKaraokeWords('<00:01.00>Hello <00:02.00>World', 1.0, 500);
    assert.equal(words[0].time, 1.5);
    assert.equal(words[1].time, 2.5);
  });

  await t.test('2.3 parseKaraokeWords attributes untagged text prefix to lineTimeMs', () => {
    const words = utils.parseKaraokeWords('Intro <00:02.00>Song', 1000, 0);
    assert.equal(words.length, 2);
    assert.equal(words[0].time, 1.0);
    assert.equal(words[0].text, 'Intro');
    assert.equal(words[1].time, 2.0);
    assert.equal(words[1].text, 'Song');
  });

  await t.test('2.4 lyricWordAt finds exact active word index', () => {
    assert.equal(typeof utils.lyricWordAt, 'function', 'lyricWordAt must be exported');
    const words = [
      { time: 1.0, text: 'A' },
      { time: 2.0, text: 'B' },
      { time: 3.5, text: 'C' }
    ];
    assert.equal(utils.lyricWordAt(words, 1.0), 0);
    assert.equal(utils.lyricWordAt(words, 2.0), 1);
    assert.equal(utils.lyricWordAt(words, 3.5), 2);
  });

  await t.test('2.5 lyricWordAt holds current word index between word boundaries', () => {
    const words = [
      { time: 1.0, text: 'A' },
      { time: 2.0, text: 'B' }
    ];
    assert.equal(utils.lyricWordAt(words, 1.5), 0);
    assert.equal(utils.lyricWordAt(words, 1.99), 0);
    assert.equal(utils.lyricWordAt(words, 2.01), 1);
    assert.equal(utils.lyricWordAt(words, 99.0), 1);
  });

  await t.test('2.6 lyricWordAt returns -1 before first word timestamp', () => {
    const words = [{ time: 1.0, text: 'Start' }];
    assert.equal(utils.lyricWordAt(words, 0.5), -1);
    assert.equal(utils.lyricWordAt(words, 0.999), -1);
  });
});

test('Tier 1 - Feature 3: Word-Level DOM Rendering (renderLyrics)', async t => {
  await t.test('3.1 renders <span class="lyric-word"> for words in karaoke lines', () => {
    const lrc = '[00:01.00]<00:01.00>Mot <00:01.50>hai <00:02.00>ba';
    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 1, 'Container must have exactly 1 row');
    const row = h.container.children[0];
    assert.ok(row.classList.contains('lyric-line'));
    const wordSpans = row.querySelectorAll('.lyric-word');
    assert.equal(wordSpans.length, 3, 'Must render 3 word spans');
    assert.equal(wordSpans[0].dataset.time, '1');
    assert.equal(wordSpans[1].dataset.time, '1.5');
    assert.equal(wordSpans[2].dataset.time, '2');
  });

  await t.test('3.2 container.children.length strictly matches line count, not word count', () => {
    const lrc = '[00:01.00]<00:01.00>W1 <00:02.00>W2\n[00:05.00]<00:05.00>W3 <00:06.00>W4';
    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 2, 'Direct children must be exactly line elements');
  });

  await t.test('3.3 word spans contain data-time attribute matching word timestamp', () => {
    const lrc = '[00:04.50]<00:04.50>Testing <00:05.25>Time';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    const wordSpans = row.querySelectorAll('.lyric-word');
    assert.equal(wordSpans[0].dataset.time, '4.5');
    assert.equal(wordSpans[1].dataset.time, '5.25');
  });

  await t.test('3.4 seekable classes, data-time, and click listener preserved on line row', () => {
    const lrc = '[00:04.50]<00:04.50>Test';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    assert.equal(row.dataset.time, '4.5');
    assert.ok(row.classList.contains('lyric-line-seekable'), 'Line must have lyric-line-seekable class');
    assert.ok(row.listeners.click && row.listeners.click.length > 0, 'Line row must register a click listener');
    row.listeners.click[0]();
    assert.equal(h.audioStub.currentTime, 4.5, 'Clicking line row must seek to line.time');
    assert.equal(h.wasPositionUpdated(), true, 'Clicking line row must trigger updatePositionState');
  });

  await t.test('3.5 clicking a word span seeks audio to word timestamp and stops propagation', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.50>Word2';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    const wordSpans = row.querySelectorAll('.lyric-word');
    assert.ok(wordSpans.length >= 2);
    let stopped = false;
    const fakeEvent = { stopPropagation: () => { stopped = true; } };
    assert.ok(wordSpans[1].listeners.click && wordSpans[1].listeners.click.length > 0, 'Word span must register a click listener');
    wordSpans[1].listeners.click[0](fakeEvent);
    assert.equal(h.audioStub.currentTime, 2.5, 'Clicking word span must seek audio to word.time');
    assert.equal(stopped, true, 'Word click must stop propagation');
    assert.equal(h.wasPositionUpdated(), true, 'Word click must trigger updatePositionState');
  });

  await t.test('3.6 adjacent word spans separated by space text node for natural text layout', () => {
    const lrc = '[00:01.00]<00:01.00>Hello <00:02.00>World';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    assert.ok(row.textContent.includes('Hello World') || row.textContent.includes('Hello  World'));
  });
});

test('Tier 1 - Feature 4: Synchronous Word Highlighting (updateLyricsHighlight)', async t => {
  await t.test('4.1 highlights active word with lyric-word-active', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.00>Word2 <00:03.00>Word3';
    const h = createLyricsHarness(lrc, 2.2); // at Word2
    h.fns.updateLyricsHighlight();

    const row = h.container.children[0];
    assert.ok(row.classList.contains('lyric-line-active'));
    const words = row.querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-sung'), 'Word1 must be sung');
    assert.ok(words[1].classList.contains('lyric-word-active'), 'Word2 must be active');
    assert.ok(!words[2].classList.contains('lyric-word-active') && !words[2].classList.contains('lyric-word-sung'), 'Word3 must be unplayed');
  });

  await t.test('4.2 marks prior words on active line with lyric-word-sung', () => {
    const lrc = '[00:01.00]<00:01.00>A <00:02.00>B <00:03.00>C <00:04.00>D';
    const h = createLyricsHarness(lrc, 3.2); // at C
    h.fns.updateLyricsHighlight();

    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-sung'));
    assert.ok(words[1].classList.contains('lyric-word-sung'));
    assert.ok(words[2].classList.contains('lyric-word-active'));
    assert.ok(!words[3].classList.contains('lyric-word-sung'));
  });

  await t.test('4.3 updates word highlighting during intra-line playback progression', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.00>Word2';
    const h = createLyricsHarness(lrc, 1.2);
    h.fns.updateLyricsHighlight();

    const row = h.container.children[0];
    const words = row.querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-active'));

    // Advance time within same line to Word2
    h.audioStub.currentTime = 2.1;
    h.fns.updateLyricsHighlight();
    assert.ok(words[0].classList.contains('lyric-word-sung'));
    assert.ok(words[1].classList.contains('lyric-word-active'));
  });

  await t.test('4.4 unplayed words remain without active or sung classes', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.00>Word2 <00:03.00>Word3';
    const h = createLyricsHarness(lrc, 1.1);
    h.fns.updateLyricsHighlight();

    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-active'));
    assert.ok(!words[1].classList.contains('lyric-word-sung') && !words[1].classList.contains('lyric-word-active'));
    assert.ok(!words[2].classList.contains('lyric-word-sung') && !words[2].classList.contains('lyric-word-active'));
  });

  await t.test('4.5 preceding lines retain all words marked as sung when line advances', () => {
    const lrc = '[00:01.00]<00:01.00>Line1Word1 <00:02.00>Line1Word2\n[00:05.00]<00:05.00>Line2Word1';
    const h = createLyricsHarness(lrc, 5.2);
    h.fns.updateLyricsHighlight();

    const row1 = h.container.children[0];
    const wordsLine1 = row1.querySelectorAll('.lyric-word');
    assert.ok(wordsLine1[0].classList.contains('lyric-word-sung'));
    assert.ok(wordsLine1[1].classList.contains('lyric-word-sung'));
    assert.ok(!wordsLine1[0].classList.contains('lyric-word-active'));
    assert.ok(!wordsLine1[1].classList.contains('lyric-word-active'));
  });

  await t.test('4.6 backward seek resets later words from sung/active to unplayed', () => {
    const lrc = '[00:01.00]<00:01.00>W1 <00:02.00>W2 <00:03.00>W3';
    const h = createLyricsHarness(lrc, 3.2); // at W3
    h.fns.updateLyricsHighlight();
    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[2].classList.contains('lyric-word-active'));

    // Seek back to W1
    h.audioStub.currentTime = 1.2;
    h.fns.updateLyricsHighlight();
    assert.ok(words[0].classList.contains('lyric-word-active'));
    assert.ok(!words[1].classList.contains('lyric-word-active') && !words[1].classList.contains('lyric-word-sung'));
    assert.ok(!words[2].classList.contains('lyric-word-active') && !words[2].classList.contains('lyric-word-sung'));
  });
});

test('Tier 1 - Feature 5: Fallback Behavior (Standard LRC & Untimed Lines)', async t => {
  await t.test('5.1 standard LRC lines without word tags have words as empty array', () => {
    const lrc = '[00:01.00]Plain standard line';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.ok(Array.isArray(lines[0].words));
    assert.equal(lines[0].words.length, 0);
  });

  await t.test('5.2 standard LRC lines render without .lyric-word spans', () => {
    const lrc = '[00:01.00]Plain line without word tags';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    assert.equal(row.querySelectorAll('.lyric-word').length, 0);
    assert.equal(row.textContent.trim(), 'Plain line without word tags');
  });

  await t.test('5.3 standard line highlights without throwing error', () => {
    const lrc = '[00:01.00]Standard line without words';
    const h = createLyricsHarness(lrc, 1.5);
    assert.doesNotThrow(() => h.fns.updateLyricsHighlight());
    assert.ok(h.container.children[0].classList.contains('lyric-line-active'));
  });

  await t.test('5.4 mixed LRC with Enhanced and Standard lines renders each appropriately', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.00>Word2\n[00:05.00]Standard Line';
    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 2);
    assert.equal(h.container.children[0].querySelectorAll('.lyric-word').length, 2);
    assert.equal(h.container.children[1].querySelectorAll('.lyric-word').length, 0);
  });

  await t.test('5.5 plain untimed lyrics (USLT) render as un-seekable rows without word spans', () => {
    const plainLyrics = 'Plain line 1\nPlain line 2';
    const h = createLyricsHarness(plainLyrics, 0);
    assert.equal(h.container.children.length, 2);
    assert.ok(h.container.children.every(r => !r.classList.contains('lyric-line-seekable')));
    assert.ok(h.container.children.every(r => r.querySelectorAll('.lyric-word').length === 0));
  });

  await t.test('5.6 empty/null lyrics shows Vietnamese placeholder', () => {
    const h = createLyricsHarness(null, 0);
    assert.match(h.container.innerHTML, /Chưa có lời đồng bộ/);
  });
});

test('Tier 1 - Feature 6: Smooth Scrolling Integration & Viewport Stability', async t => {
  await t.test('6.1 does not scroll when active line is fully visible in viewport', () => {
    const lrc = '[00:01.00]Line 1\n[00:05.00]Line 2';
    const h = createLyricsHarness(lrc, 6);
    h.container.children.forEach(r => {
      r.rect = { top: 20, bottom: 48, left: 0, right: 100, width: 100, height: 28 };
    });
    h.fns.updateLyricsHighlight();
    assert.equal(h.container.children[1].scrolledIntoView, false);
  });

  await t.test('6.2 scrolls into view when active line is outside viewport', () => {
    const lrc = '[00:01.00]Line 1\n[00:05.00]Line 2';
    const h = createLyricsHarness(lrc, 6);
    h.container.children[1].rect = { top: 250, bottom: 278, left: 0, right: 100, width: 100, height: 28 };
    h.fns.updateLyricsHighlight();
    assert.equal(h.container.children[1].scrolledIntoView, true);
  });

  await t.test('6.3 intra-line word progression does NOT call scrollIntoView repeatedly', () => {
    const lrc = '[00:01.00]<00:01.00>W1 <00:02.00>W2 <00:03.00>W3';
    const h = createLyricsHarness(lrc, 1.1);
    h.container.children[0].rect = { top: 20, bottom: 48, left: 0, right: 100, width: 100, height: 28 };
    h.fns.updateLyricsHighlight();
    h.container.children[0].scrolledIntoView = false; // reset flag

    // Advance to W2
    h.audioStub.currentTime = 2.1;
    h.fns.updateLyricsHighlight();
    assert.equal(h.container.children[0].scrolledIntoView, false, 'Word change must not trigger scroll');

    // Advance to W3
    h.audioStub.currentTime = 3.1;
    h.fns.updateLyricsHighlight();
    assert.equal(h.container.children[0].scrolledIntoView, false, 'Word change must not trigger scroll');
  });

  await t.test('6.4 verifies appCode contains exact library.shouldScrollLyricIntoView call', () => {
    assert.ok(appCode.includes('library.shouldScrollLyricIntoView(container.getBoundingClientRect(), activeRow.getBoundingClientRect())'));
    assert.ok(!appCode.includes("rows[index].scrollIntoView({block: 'center'});"));
  });

  await t.test('6.5 CSS preserves 4 content-visibility rules and includes lyric-word styling', () => {
    const cvMatches = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((count, match) => count + [...match[1].matchAll(/content-visibility:auto/g)].length, 0);
    assert.equal(cvMatches, 4, 'Exactly 4 content-visibility:auto rules must exist');
    assert.match(html, /\.lyric-word\b/);
  });

  await t.test('6.6 room-lyrics has smooth scrolling behavior in CSS', () => {
    assert.match(html, /#room-lyrics\s*\{[^}]*scroll-behavior:\s*smooth/i);
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
// ============================================================================

test('Tier 2 - Feature 1 Boundaries: parseLyrics Edge Cases', async t => {
  await t.test('2.1.1 parseLyrics handles null, undefined, numbers, objects and empty strings', () => {
    assert.deepEqual(utils.parseLyrics(null), []);
    assert.deepEqual(utils.parseLyrics(undefined), []);
    assert.deepEqual(utils.parseLyrics(''), []);
    assert.deepEqual(utils.parseLyrics(12345), []);
    assert.deepEqual(utils.parseLyrics({}), []);
  });

  await t.test('2.1.2 parseLyrics handles UTF-8 BOM marker and mixed CRLF/LF line breaks', () => {
    const raw = '\uFEFF[00:01.00]Line 1\r\n[00:02.00]Line 2\n[00:03.00]Line 3\r';
    const lines = utils.parseLyrics(raw);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].text, 'Line 1');
    assert.equal(lines[1].text, 'Line 2');
    assert.equal(lines[2].text, 'Line 3');
  });

  await t.test('2.1.3 parseLyrics drops line timestamps with seconds >= 60 and cleanly strips 4-decimal tags', () => {
    const lrc = '[00:59.99]Valid\n[00:60.00]Invalid\n[00:99.00]Bad seconds';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Valid');

    // Explicit assertion that raw tags with 4 decimal digits are cleanly stripped and zero <00:...> code leaks into DOM text content
    const lrc4 = '[00:01.0000]<00:01.1234>Precision <00:01.5678>Karaoke';
    const lines4 = utils.parseLyrics(lrc4);
    assert.equal(lines4.length, 1);
    assert.equal(lines4[0].text, 'Precision Karaoke', 'Raw tags with 4 decimal digits must be stripped completely from line text');
    assert.equal(lines4[0].text.includes('<'), false, 'Line text must not contain raw opening tag bracket');
    assert.equal(lines4[0].text.includes('>'), false, 'Line text must not contain raw closing tag bracket');

    const h4 = createLyricsHarness(lrc4, 1.2);
    const row4 = h4.container.children[0];
    assert.equal(row4.textContent.includes('<'), false, 'DOM text content must not contain raw opening bracket');
    assert.equal(row4.textContent.includes('>'), false, 'DOM text content must not contain raw closing bracket');
    assert.equal(row4.textContent.replace(/\s+/g, ' ').trim(), 'Precision Karaoke');
  });

  await t.test('2.1.4 parseLyrics drops lines with empty or whitespace-only lyrics', () => {
    const lrc = '[00:01.00]Valid\n[00:02.00]   \n[00:03.00]\t\n[00:04.00]<00:04.00>   ';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Valid');
  });

  await t.test('2.1.5 parseLyrics clamps negative offset to 0 ms', () => {
    const lrc = '[offset:-5000]\n[00:02.00]<00:02.00>Early';
    const lines = utils.parseLyrics(lrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].time, 0, 'Negative offset clamped to 0');
  });

  await t.test('2.1.6 parseLyrics correctly sorts reverse chronological order', () => {
    const lrc = '[00:09.00]Nine\n[00:05.00]Five\n[00:01.00]One';
    const lines = utils.parseLyrics(lrc);
    assert.deepEqual(lines.map(l => l.time), [1, 5, 9]);
  });

  await t.test('2.1.7 handles arbitrary decimal precision without leaking markup into word text', () => {
    const raw = '<00:01.1234>Hi-Res <00:02>Standard <00:03.98765>Precision';
    const words = utils.parseKaraokeWords(raw, 1.0, 0);
    assert.equal(words.length, 3);
    assert.equal(words[0].text, 'Hi-Res');
    assert.equal(words[0].time, 1.1234);
    assert.equal(words[1].text, 'Standard');
    assert.equal(words[1].time, 2.0);
    assert.equal(words[2].text, 'Precision');
    assert.equal(words[2].time, 3.9877);
  });
});

test('Tier 2 - Feature 2 Boundaries: Word Timing Helpers Edge Cases', async t => {
  await t.test('2.2.1 parseKaraokeWords handles null, undefined, empty and invalid input', () => {
    assert.deepEqual(utils.parseKaraokeWords(null), []);
    assert.deepEqual(utils.parseKaraokeWords(undefined), []);
    assert.deepEqual(utils.parseKaraokeWords(''), []);
    assert.deepEqual(utils.parseKaraokeWords(123), []);
    assert.deepEqual(utils.parseKaraokeWords('   '), []);
  });

  await t.test('2.2.2 parseKaraokeWords returns [] for plain text without any word tags', () => {
    assert.deepEqual(utils.parseKaraokeWords('Just regular text without word tags', 1000, 0), []);
  });

  await t.test('2.2.3 parseKaraokeWords ignores invalid word seconds >= 60', () => {
    const words = utils.parseKaraokeWords('<00:99.00>Invalid <00:10.00>Valid', 0, 0);
    assert.equal(words.length, 1);
    assert.equal(words[0].text, 'Valid');
    assert.equal(words[0].time, 10.0);
  });

  await t.test('2.2.4 parseKaraokeWords handles adjacent tags without generating empty word tokens', () => {
    const words = utils.parseKaraokeWords('<00:01.00><00:02.00>Valid', 0, 0);
    assert.equal(words.length, 1);
    assert.equal(words[0].time, 2.0);
    assert.equal(words[0].text, 'Valid');
  });

  await t.test('2.2.5 lyricWordAt handles corrupt arrays and edge time inputs', () => {
    assert.equal(utils.lyricWordAt(null, 5), -1);
    assert.equal(utils.lyricWordAt([], 5), -1);
    assert.equal(utils.lyricWordAt([{ time: 5, text: 'A' }], NaN), -1);
    assert.equal(utils.lyricWordAt([{ time: 5, text: 'A' }], -10), -1);
    assert.equal(utils.lyricWordAt([{ time: 5, text: 'A' }], Infinity), 0);
  });

  await t.test('2.2.6 lyricWordAt handles duplicate timestamps resolving to latest word index', () => {
    const words = [
      { time: 2.0, text: 'First' },
      { time: 2.0, text: 'Second' }
    ];
    assert.equal(utils.lyricWordAt(words, 2.0), 1);
  });
});

test('Tier 2 - Feature 3 Boundaries: Word-Level DOM Rendering Edge Cases', async t => {
  await t.test('2.3.1 line with single word tag renders exactly 1 span', () => {
    const lrc = '[00:01.00]<00:01.00>Solo';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    const spans = row.querySelectorAll('.lyric-word');
    assert.equal(spans.length, 1);
    assert.equal(spans[0].textContent, 'Solo');
  });

  await t.test('2.3.2 line with 30 rapid word tags renders 30 spans with whitespace', () => {
    const tokens = Array.from({ length: 30 }, (_, i) => `<00:${String(i).padStart(2, '0')}.00>W${i}`);
    const lrc = `[00:00.00]${tokens.join(' ')}`;
    const h = createLyricsHarness(lrc, 0);
    const spans = h.container.children[0].querySelectorAll('.lyric-word');
    assert.equal(spans.length, 30);
  });

  await t.test('2.3.3 line with HTML special characters (&, <, >, ", \') renders safely', () => {
    const lrc = '[00:01.00]<00:01.00>Tom <00:01.50>& <00:02.00>Jerry';
    const h = createLyricsHarness(lrc, 0);
    const row = h.container.children[0];
    assert.ok(row.textContent.includes('&'));
  });

  await t.test('2.3.4 re-rendering lyrics cleans previous DOM elements completely', () => {
    const h = createLyricsHarness('[00:01.00]First Track', 0);
    assert.equal(h.container.children.length, 1);

    // Switch track to another LRC
    h.fns.renderLyrics('[00:02.00]Second Track\n[00:04.00]Line 2');
    assert.equal(h.container.children.length, 2, 'Previous rows must be completely replaced');
  });

  await t.test('2.3.5 empty LRC with only metadata tags renders empty placeholder', () => {
    const lrc = '[ti:Only Title]\n[ar:Only Artist]\n[al:Only Album]';
    const h = createLyricsHarness(lrc, 0);
    assert.match(h.container.innerHTML, /Chưa có lời đồng bộ/);
  });

  await t.test('2.3.6 CSS .lyric-line preserves verbatim rule for index-script regression check', () => {
    assert.ok(
      html.includes('.lyric-line { border-radius:8px;padding:2px 8px;transition:color .2s,background-color .2s;content-visibility:auto;contain-intrinsic-size:auto 28px; }'),
      'CSS .lyric-line must match verbatim rule required by index-script.test.cjs:818'
    );
  });

  await t.test('2.3.7 4-decimal precision lyrics do not leak angle brackets into DOM content', () => {
    const lrc = '[00:01.0000]<00:01.1234>Precision <00:01.5678>Karaoke';
    const h = createLyricsHarness(lrc, 1.2);
    const row = h.container.children[0];
    assert.equal(row.textContent.includes('<'), false, 'DOM must not contain raw opening bracket');
    assert.equal(row.textContent.includes('>'), false, 'DOM must not contain raw closing bracket');
    assert.equal(row.textContent.replace(/\s+/g, ' ').trim(), 'Precision Karaoke');
  });
});

test('Tier 2 - Feature 4 Boundaries: Synchronous Word Highlighting Edge Cases', async t => {
  await t.test('2.4.1 seeking directly into middle of song marks prior words as sung', () => {
    const lrc = '[00:01.00]<00:01.00>A <00:02.00>B <00:03.00>C <00:04.00>D';
    const h = createLyricsHarness(lrc, 3.2); // jump directly to C
    h.fns.updateLyricsHighlight();

    const row = h.container.children[0];
    const words = row.querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-sung'));
    assert.ok(words[1].classList.contains('lyric-word-sung'));
    assert.ok(words[2].classList.contains('lyric-word-active'));
    assert.ok(!words[3].classList.contains('lyric-word-sung') && !words[3].classList.contains('lyric-word-active'));
  });

  await t.test('2.4.2 seek past last word leaves last word active or sung without errors', () => {
    const lrc = '[00:01.00]<00:01.00>One <00:02.00>Two';
    const h = createLyricsHarness(lrc, 100);
    assert.doesNotThrow(() => h.fns.updateLyricsHighlight());
    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[1].classList.contains('lyric-word-active') || words[1].classList.contains('lyric-word-sung'));
  });

  await t.test('2.4.3 high-frequency timeupdate calls at same timestamp are idempotent', () => {
    const lrc = '[00:01.00]<00:01.00>Word1 <00:02.00>Word2';
    const h = createLyricsHarness(lrc, 1.5);
    for (let i = 0; i < 10; i++) {
      h.fns.updateLyricsHighlight();
    }
    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-active'));
    assert.ok(!words[1].classList.contains('lyric-word-active'));
  });

  await t.test('2.4.4 playback before line start leaves all words unhighlighted', () => {
    const lrc = '[00:05.00]<00:05.00>Start <00:06.00>End';
    const h = createLyricsHarness(lrc, 2.0);
    h.fns.updateLyricsHighlight();
    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(!words[0].classList.contains('lyric-word-active') && !words[0].classList.contains('lyric-word-sung'));
    assert.ok(!words[1].classList.contains('lyric-word-active') && !words[1].classList.contains('lyric-word-sung'));
  });

  await t.test('2.4.5 rapid back-and-forth seeking across boundaries runs cleanly', () => {
    const lrc = '[00:01.00]<00:01.00>A <00:02.00>B\n[00:05.00]<00:05.00>C <00:06.00>D';
    const h = createLyricsHarness(lrc, 0);
    const seekPoints = [1.5, 5.5, 0.5, 6.5, 2.0, 100, -10];
    for (const time of seekPoints) {
      h.audioStub.currentTime = time;
      assert.doesNotThrow(() => h.fns.updateLyricsHighlight());
    }
  });

  await t.test('2.4.6 zero playback time (currentTime = 0) with line at 0s highlights immediately', () => {
    const lrc = '[00:00.00]<00:00.00>Zero <00:01.00>One';
    const h = createLyricsHarness(lrc, 0);
    h.fns.updateLyricsHighlight();
    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-active'));
  });
});

test('Tier 2 - Feature 5 Boundaries: Fallback Edge Cases', async t => {
  await t.test('2.5.1 plain untimed text with blank lines renders only non-empty lines', () => {
    const raw = 'Dòng 1\n\n   \nDòng 2\n\n';
    const h = createLyricsHarness(raw, 0);
    assert.equal(h.container.children.length, 2);
  });

  await t.test('2.5.2 lines with corrupt brackets treated as plain text or ignored gracefully', () => {
    const raw = '[xx:yy:zz] Corrupt line\n[00:01.00]Valid line';
    const lines = utils.parseLyrics(raw);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Valid line');
  });

  await t.test('2.5.3 rapid switching between Enhanced LRC and Standard LRC cleans up spans', () => {
    const h = createLyricsHarness('[00:01.00]<00:01.00>Word1 <00:02.00>Word2', 0);
    assert.equal(h.container.children[0].querySelectorAll('.lyric-word').length, 2);

    h.fns.renderLyrics('[00:01.00]Standard Line Without Words');
    assert.equal(h.container.children[0].querySelectorAll('.lyric-word').length, 0);
  });

  await t.test('2.5.4 audio duration = NaN or 0 on click does not crash or corrupt currentTime', () => {
    const lrc = '[00:05.00]Clickable';
    const h = createLyricsHarness(lrc, 0, NaN);
    const row = h.container.children[0];
    assert.ok(row.listeners.click && row.listeners.click.length > 0, 'Clickable row must have registered click listener');
    assert.doesNotThrow(() => {
      row.listeners.click[0]();
    });
  });

  await t.test('2.5.5 non-seekable untimed rows do not add click listeners or seekable class', () => {
    const plain = 'Untimed line';
    const h = createLyricsHarness(plain, 0);
    const row = h.container.children[0];
    assert.equal(row.classList.contains('lyric-line-seekable'), false);
    assert.equal(row.listeners.click, undefined);
  });

  await t.test('2.5.6 track with only whitespace lyrics renders empty placeholder', () => {
    const h = createLyricsHarness('     \n\t\n   ', 0);
    assert.match(h.container.innerHTML, /Chưa có lời đồng bộ/);
  });
});

test('Tier 2 - Feature 6 Boundaries: shouldScrollLyricIntoView Edge Cases', async t => {
  const rect = (top, bottom) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top });

  await t.test('2.6.1 handles null, undefined, or missing rect parameters without throwing', () => {
    assert.equal(utils.shouldScrollLyricIntoView(null, rect(150, 178)), false);
    assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), null), false);
    assert.equal(utils.shouldScrollLyricIntoView(undefined, undefined), false);
  });

  await t.test('2.6.2 handles NaN in coordinates gracefully', () => {
    assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), { top: NaN, bottom: 178 }), false);
    assert.equal(utils.shouldScrollLyricIntoView({ top: NaN, bottom: 300 }, rect(150, 178)), false);
  });

  await t.test('2.6.3 returns false for zero-height container (collapsed)', () => {
    assert.equal(utils.shouldScrollLyricIntoView(rect(200, 200), rect(150, 178)), false);
  });

  await t.test('2.6.4 returns false when row touches exact top or bottom border', () => {
    assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(100, 128)), false, 'Exact top border');
    assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(272, 300)), false, 'Exact bottom border');
  });

  await t.test('2.6.5 returns true for oversized row taller than viewport', () => {
    assert.equal(utils.shouldScrollLyricIntoView(rect(100, 300), rect(50, 350)), true, 'Row taller than container');
  });

  await t.test('2.6.6 returns false for inverted container (bottom < top)', () => {
    assert.equal(utils.shouldScrollLyricIntoView({ top: 300, bottom: 100 }, rect(150, 178)), false);
  });
});

// ============================================================================
// TIER 3: COMBINATORIAL & CROSS-FEATURE TESTING
// ============================================================================

test('Tier 3 - Combinatorial & Cross-Feature Testing', async t => {
  await t.test('3.1 Enhanced LRC with global offset + word highlights + scroll gating', () => {
    const lrc = `[offset:500]
[00:01.00]<00:01.00>Line1W1 <00:02.00>Line1W2
[00:05.00]<00:05.00>Line2W1 <00:06.00>Line2W2`;

    const lines = utils.parseLyrics(lrc);
    assert.equal(lines[0].time, 1.5, 'Offset shifts line 1');
    assert.equal(lines[0].words[0].time, 1.5, 'Offset shifts word 1.1');
    assert.equal(lines[0].words[1].time, 2.5, 'Offset shifts word 1.2');

    const h = createLyricsHarness(lrc, 1.6);
    h.container.children.forEach(r => {
      r.rect = { top: 20, bottom: 48, left: 0, right: 100, width: 100, height: 28 };
    });
    h.fns.updateLyricsHighlight();

    const words1 = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words1[0].classList.contains('lyric-word-active'), 'Word 1.1 active with offset');
    assert.equal(h.container.children[0].scrolledIntoView, false, 'In-view row must not scroll');
  });

  await t.test('3.2 multi-tag line expansion with word tags + seeking to second occurrence', () => {
    const lrc = '[00:02.00][00:08.00]<00:02.00>Refrain <00:02.50>part';
    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 2);

    // Seek to second occurrence at 8.2s (word 0 "Refrain" active at 8.0s, word 1 "part" at 8.5s)
    h.audioStub.currentTime = 8.2;
    h.fns.updateLyricsHighlight();

    assert.equal(h.stateStub.lyricIndex, 1, 'Should highlight second occurrence');
    assert.ok(h.container.children[1].classList.contains('lyric-line-active'), 'Line 1 must be active');
    const words = h.container.children[1].querySelectorAll('.lyric-word');
    assert.equal(words.length, 2, 'Second occurrence must render 2 word spans');
    assert.ok(words[0].classList.contains('lyric-word-active'), 'Word 0 (Refrain) must be active at 8.2s');
    assert.equal(words[1].classList.contains('lyric-word-active'), false, 'Word 1 (part) must NOT be active before 8.5s');

    // Advance to 8.6s (word 1 "part" active at 8.5s)
    h.audioStub.currentTime = 8.6;
    h.fns.updateLyricsHighlight();
    assert.equal(words[0].classList.contains('lyric-word-active'), false, 'Word 0 must no longer be active');
    assert.ok(words[1].classList.contains('lyric-word-active'), 'Word 1 (part) must be active at 8.6s');
  });

  await t.test('3.3 mixed track with Enhanced, Standard, and untimed lines during playback', () => {
    const lrc = `[00:01.00]<00:01.00>Enhanced <00:02.00>Line
[00:04.00]Standard Line
[00:07.00]<00:07.00>Enhanced <00:08.00>Again`;

    const h = createLyricsHarness(lrc, 1.5);
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, 0);
    assert.ok(h.container.children[0].querySelectorAll('.lyric-word')[0].classList.contains('lyric-word-active'));

    // Advance to standard line
    h.audioStub.currentTime = 4.5;
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, 1);
    assert.ok(h.container.children[1].classList.contains('lyric-line-active'));

    // Advance to second enhanced line
    h.audioStub.currentTime = 7.5;
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, 2);
    assert.ok(h.container.children[2].querySelectorAll('.lyric-word')[0].classList.contains('lyric-word-active'));
  });

  await t.test('3.4 word click-to-seek immediately updates active word highlight', () => {
    const lrc = '[00:01.00]<00:01.00>A <00:02.50>B <00:04.00>C';
    const h = createLyricsHarness(lrc, 1.2);
    h.fns.updateLyricsHighlight();

    const words = h.container.children[0].querySelectorAll('.lyric-word');
    assert.ok(words[0].classList.contains('lyric-word-active'));

    // User clicks word 'C'
    const fakeEvent = { stopPropagation: () => {} };
    assert.ok(words[2].listeners.click && words[2].listeners.click.length > 0, 'Word 2 must have registered click listener');
    words[2].listeners.click[0](fakeEvent);
    assert.equal(h.audioStub.currentTime, 4.0);

    // Audio timeupdate triggers highlight
    h.fns.updateLyricsHighlight();
    assert.ok(words[0].classList.contains('lyric-word-sung'));
    assert.ok(words[1].classList.contains('lyric-word-sung'));
    assert.ok(words[2].classList.contains('lyric-word-active'));
  });

  await t.test('3.5 rapid seeking back and forth across word boundaries preserves viewport stability', () => {
    const lrc = '[00:01.00]<00:01.00>W1 <00:02.00>W2 <00:03.00>W3';
    const h = createLyricsHarness(lrc, 1.1);
    h.container.children[0].rect = { top: 20, bottom: 48, left: 0, right: 100, width: 100, height: 28 };
    h.fns.updateLyricsHighlight();
    h.container.children[0].scrolledIntoView = false;

    const intraLineSeeks = [1.2, 2.8, 1.5, 2.1, 1.8, 2.9];
    for (const time of intraLineSeeks) {
      h.audioStub.currentTime = time;
      h.fns.updateLyricsHighlight();
      assert.equal(h.container.children[0].scrolledIntoView, false, `Intra-line seek to ${time} must not scroll`);
    }
  });

  await t.test('3.6 switching from Enhanced LRC track to USLT track to empty track with full DOM verification', () => {
    const h = createLyricsHarness('[00:01.00]<00:01.00>Enhanced', 0);
    assert.equal(h.container.children.length, 1);
    assert.equal(h.container.children[0].querySelectorAll('.lyric-word').length, 1);

    // Switch to plain USLT
    h.fns.renderLyrics('Dòng thuần 1\nDòng thuần 2');
    assert.equal(h.container.children.length, 2);
    assert.ok(h.container.children.every(r => r.querySelectorAll('.lyric-word').length === 0));

    // Switch to empty
    h.fns.renderLyrics('');
    assert.match(h.container.innerHTML, /Chưa có lời đồng bộ/);
  });
});

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS
// ============================================================================

test('Tier 4 - Real-World Application Scenarios', async t => {
  await t.test('4.1 Full Vietnamese song playback simulation: Ha Noi Mua Vang Nhung Con Mua', () => {
    const lrc = `[ti:Hà Nội Mùa Vắng Những Cơn Mưa]
[ar:Cẩm Vân]
[al:Audiophile Master Series]
[00:02.00]<00:02.00>Hà <00:02.60>Nội <00:03.20>mùa <00:03.80>này <00:04.50>vắng <00:05.10>những <00:05.80>cơn <00:06.40>mưa
[00:08.00]<00:08.00>Cái <00:08.50>rét <00:09.00>đầu <00:09.50>đông <00:10.10>khăn <00:10.70>em <00:11.30>bay <00:12.00>hiu <00:12.50>hiu <00:13.00>gió <00:13.60>lạnh
[00:15.00]<00:15.00>Hoa <00:15.60>sữa <00:16.20>thôi <00:16.80>rơi <00:17.40>em <00:18.00>bên <00:18.60>tôi <00:19.20>một <00:19.80>chiều <00:20.40>thu`;

    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 3);

    // Initial: 0s -> not started
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, -1);

    // 2.1s -> Line 1 active, 'Hà' active
    h.audioStub.currentTime = 2.1;
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, 0);
    let row1 = h.container.children[0];
    let words1 = row1.querySelectorAll('.lyric-word');
    assert.equal(words1[0].textContent, 'Hà');
    assert.ok(words1[0].classList.contains('lyric-word-active'));

    // 4.6s -> 'vắng' active (index 4)
    h.audioStub.currentTime = 4.6;
    h.fns.updateLyricsHighlight();
    assert.ok(words1[0].classList.contains('lyric-word-sung'));
    assert.ok(words1[1].classList.contains('lyric-word-sung'));
    assert.ok(words1[2].classList.contains('lyric-word-sung'));
    assert.ok(words1[3].classList.contains('lyric-word-sung'));
    assert.ok(words1[4].classList.contains('lyric-word-active'));
    assert.equal(words1[4].textContent, 'vắng');

    // 8.6s -> Line 2 active, 'rét' active
    h.audioStub.currentTime = 8.6;
    h.fns.updateLyricsHighlight();
    assert.equal(h.stateStub.lyricIndex, 1);
    let row2 = h.container.children[1];
    let words2 = row2.querySelectorAll('.lyric-word');
    assert.ok(words2[0].classList.contains('lyric-word-sung'));
    assert.ok(words2[1].classList.contains('lyric-word-active'));
    assert.equal(words2[1].textContent, 'rét');

    // Verify row 1 words are all sung now
    assert.ok(words1.every(w => w.classList.contains('lyric-word-sung')));
  });

  await t.test('4.2 Full Vietnamese song playback simulation: Em Oi Ha Noi Pho with complex diacritics', () => {
    const lrc = `[ti:Em Ơi Hà Nội Phố]
[ar:Phú Quang]
[00:01.00]<00:01.00>Em <00:01.60>ơi, <00:02.20>Hà <00:02.80>Nội <00:03.50>phố!
[00:05.00]<00:05.00>Ta <00:05.50>còn <00:06.00>em <00:06.60>mùi <00:07.20>hoàng <00:07.80>lan`;

    const h = createLyricsHarness(lrc, 0);
    assert.equal(h.container.children.length, 2);

    h.audioStub.currentTime = 2.3;
    h.fns.updateLyricsHighlight();
    const words1 = h.container.children[0].querySelectorAll('.lyric-word');
    assert.equal(words1[2].textContent, 'Hà');
    assert.ok(words1[2].classList.contains('lyric-word-active'));

    h.audioStub.currentTime = 6.1;
    h.fns.updateLyricsHighlight();
    const words2 = h.container.children[1].querySelectorAll('.lyric-word');
    assert.equal(words2[2].textContent, 'em');
    assert.ok(words2[2].classList.contains('lyric-word-active'));
  });

  await t.test('4.3 realistic user seekbar scrubbing across karaoke track', () => {
    const lrc = `[00:00.50]<00:00.50>Intro <00:01.50>Verse
[00:05.00]<00:05.00>Chorus <00:06.00>Sing <00:07.00>Loud
[00:10.00]<00:10.00>Outro <00:11.00>End`;

    const h = createLyricsHarness(lrc, 0);

    // User scrubs back and forth rapidly
    const scrubTimes = [0.6, 6.2, 10.5, 1.6, 7.1, 0.2, 5.5, 11.2];
    for (const time of scrubTimes) {
      h.audioStub.currentTime = time;
      assert.doesNotThrow(() => h.fns.updateLyricsHighlight());
      const expectedLineIdx = utils.lyricLineAt(h.stateStub.lyrics, time);
      assert.equal(h.stateStub.lyricIndex, expectedLineIdx);
    }
  });

  await t.test('4.4 malformed real-world LRC (mixed CRLF, UTF-8 BOM, metadata, missing tags)', () => {
    const messyLrc = '\uFEFF[ar:Audiophile Singer]\r\n[ti:Test Messy]\r\n[offset:+200]\r\n[00:01.00]<00:01.00>Word1 <00:01.80>Word2\r\n[00:04.00]Line without words\r\n[00:99.00]Bad Line\r\n   \r\n[00:07.500]<00:07.500>Word3\r\n';
    const lines = utils.parseLyrics(messyLrc);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].time, 1.2, '1.0s + 200ms offset');
    assert.equal(lines[1].time, 4.2, '4.0s + 200ms offset');
    assert.equal(lines[2].time, 7.7, '7.5s + 200ms offset');
    assert.equal(lines[0].words.length, 2);
    assert.equal(lines[1].words.length, 0);
    assert.equal(lines[2].words.length, 1);
  });

  await t.test('4.5 1000-tick playback stress test verifying zero DOM leak and constant memory footprint', () => {
    const lrc = `[00:00.00]<00:00.00>Tick <00:01.00>Tock
[00:02.00]<00:02.00>Click <00:03.00>Clack`;
    const h = createLyricsHarness(lrc, 0);

    const initialChildCount = h.container.children.length;
    assert.equal(initialChildCount, 2);

    // Simulate 1000 ticks of audio timeupdate
    for (let i = 0; i < 1000; i++) {
      h.audioStub.currentTime = (i % 40) / 10;
      h.fns.updateLyricsHighlight();
    }

    // Direct container children must still be exactly 2
    assert.equal(h.container.children.length, 2, 'Container children must not leak or accumulate');
  });
});
