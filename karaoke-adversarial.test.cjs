'use strict';

// ============================================================================
// Adversarial Stress Harness: karaoke-adversarial.test.cjs
// Challenger 1 — Milestone 1 (Phase C: Karaoke Lyrics)
// Verification: node --test karaoke-adversarial.test.cjs
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const libraryPath = path.join(__dirname, 'library-utils.js');
const indexPath = path.join(__dirname, 'index.html');

const utils = require(libraryPath);
const html = fs.readFileSync(indexPath, 'utf8');

// Extract inline scripts from index.html
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

// ----------------------------------------------------------------------------
// Comprehensive Mock DOM Harness
// ----------------------------------------------------------------------------
class MockDOMElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this._textContent = '';
    this.listeners = {};
    this.scrollCount = 0;
    this.lastScrollOptions = null;
    this.rect = null;
    this._innerHTML = '';

    const classSet = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => {
        if (n) classSet.add(n);
      }),
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

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
      if (event._propagationStopped) break;
    }
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
    this.scrollCount++;
    this.lastScrollOptions = options;
  }
}

function createHarness(lrcText = '', initialTime = 0, initialDuration = 300) {
  const container = new MockDOMElement('div');
  container.id = 'room-lyrics';
  container.rect = { top: 0, bottom: 300, left: 0, right: 200, width: 200, height: 300 };

  const audio = {
    currentTime: initialTime,
    duration: initialDuration,
    paused: false
  };

  const elements = {
    'room-lyrics': container,
    'player-footer': new MockDOMElement('div'),
    'now-title': new MockDOMElement('div'),
    'now-artist': new MockDOMElement('div'),
    'player-cover': new MockDOMElement('div'),
    'quality-badge': new MockDOMElement('div'),
    'mobile-quality': new MockDOMElement('div')
  };

  const sandbox = {
    document: {
      getElementById: id => elements[id] || null,
      createElement: tag => new MockDOMElement(tag),
      createTextNode: text => {
        const el = new MockDOMElement('text');
        el.textContent = text;
        return el;
      }
    },
    $: id => elements[id] || null,
    audio,
    library: utils,
    state: {
      lyrics: [],
      lyricIndex: -1
    },
    updatePositionState: () => {},
    console,
    Math,
    Number,
    Array,
    Object,
    String,
    Set
  };

  vm.createContext(sandbox);

  // Extract renderLyrics and updateLyricsHighlight functions
  const renderMatch = appCode.match(/function\s+renderLyrics\s*\([\s\S]*?\n\s{4}\}/);
  const updateMatch = appCode.match(/function\s+updateLyricsHighlight\s*\([\s\S]*?\n\s{4}\}/);

  if (!renderMatch || !updateMatch) {
    throw new Error('Failed to extract renderLyrics or updateLyricsHighlight from index.html');
  }

  vm.runInContext(renderMatch[0], sandbox);
  vm.runInContext(updateMatch[0], sandbox);

  if (lrcText) {
    sandbox.renderLyrics(lrcText);
    sandbox.updateLyricsHighlight();
  }

  return { sandbox, container, audio };
}

// ============================================================================
// CHALLENGE SUITE 1: Extreme LRC Inputs & Malformed Tokens
// ============================================================================
test('Adversarial 1: Extreme LRC Inputs & Malformed Tokens', async t => {
  await t.test('1.1 Malformed and corrupted tag structures', () => {
    const corruptInputs = [
      '[00:01.00]<not:a.tag> Hello <00:02.00> World',
      '[00:01.00]<::> Missing digits <00:02.00> Test',
      '[00:01.00]<00:60.00> Sixty seconds <00:02.00> Word',
      '[00:01.00]<00:99.999> Ninety nine <00:03.00> End',
      '[00:01.00]<<00:01.50>> Nested brackets',
      '[00:01.00]<00:01.50 Unclosed bracket',
      '[00:01.00]00:01.50> Unopened bracket',
      '[00:01.00]< 00:01.50 > Spaces in tag',
      '[00:01.00]<999:59.999> Huge minute value'
    ];

    for (const input of corruptInputs) {
      assert.doesNotThrow(() => {
        const lines = utils.parseLyrics(input);
        assert.ok(Array.isArray(lines));
        for (const line of lines) {
          assert.ok(Array.isArray(line.words));
          for (const w of line.words) {
            assert.ok(Number.isFinite(w.time) && w.time >= 0, `Word time must be non-negative finite: ${w.time}`);
            assert.ok(typeof w.text === 'string' && w.text.length > 0, `Word text must be non-empty`);
          }
        }
      }, `Must not throw on malformed input: ${input}`);
    }
  });

  await t.test('1.2 Decimal precision edge cases: 0, 1, 2, 3, and excess digits', () => {
    // 0 decimal digits: <00:01> -> 1.000s
    // 1 decimal digit: <00:01.5> -> 1.500s
    // 2 decimal digits: <00:01.05> -> 1.050s, <00:01.50> -> 1.500s
    // 3 decimal digits: <00:01.005> -> 1.005s, <00:01.123> -> 1.123s
    const words = utils.parseKaraokeWords(
      '<00:01>T0 <00:02.5>T1 <00:03.05>T2 <00:04.50>T3 <00:05.005>T4 <00:06.123>T5',
      0, 0
    );

    assert.equal(words.length, 6);
    assert.equal(words[0].time, 1.0);
    assert.equal(words[1].time, 2.5);
    assert.equal(words[2].time, 3.05);
    assert.equal(words[3].time, 4.5);
    assert.equal(words[4].time, 5.005);
    assert.equal(words[5].time, 6.123);
  });

  await t.test('1.3 Colon as decimal separator in word tags <mm:ss:xx>', () => {
    const words = utils.parseKaraokeWords('<00:02:50>ColonSep <00:03:750>ColonThree', 0, 0);
    assert.equal(words.length, 2);
    assert.equal(words[0].time, 2.5);
    assert.equal(words[1].time, 3.75);
  });

  await t.test('1.4 Out-of-order word timestamps within a single line', () => {
    // When word tags inside a line are disordered chronologically
    const lrc = '[00:01.00] <00:03.00> Third <00:01.50> First <00:02.00> Second';
    const words = utils.parseKaraokeWords(lrc, 1000, 0);
    assert.equal(words.length, 3);
    // Must be sorted in ascending chronological order:
    assert.equal(words[0].text, 'First');
    assert.equal(words[0].time, 1.5);
    assert.equal(words[1].text, 'Second');
    assert.equal(words[1].time, 2.0);
    assert.equal(words[2].text, 'Third');
    assert.equal(words[2].time, 3.0);
  });

  await t.test('1.5 Extreme offsets: positive, negative, and invalid', () => {
    // Extreme negative offset should clamp line and word times to 0 ms (no negative seconds)
    const negLrc = '[offset:-50000]\n[00:05.00]<00:06.00> Clamped';
    const negLines = utils.parseLyrics(negLrc);
    assert.equal(negLines.length, 1);
    assert.equal(negLines[0].time, 0, 'Line time clamped to 0');
    assert.equal(negLines[0].words[0].time, 0, 'Word time clamped to 0');

    // Extreme positive offset
    const posLrc = '[offset:60000]\n[00:01.00]<00:02.00> Future';
    const posLines = utils.parseLyrics(posLrc);
    assert.equal(posLines.length, 1);
    assert.equal(posLines[0].time, 61.0);
    assert.equal(posLines[0].words[0].time, 62.0);

    // Invalid non-numeric offset ignored (offsetMs = 0)
    const badOffset = '[offset:notanumber]\n[00:01.00]<00:02.00> Normal';
    const badLines = utils.parseLyrics(badOffset);
    assert.equal(badLines.length, 1);
    assert.equal(badLines[0].time, 1.0);
    assert.equal(badLines[0].words[0].time, 2.0);
  });

  await t.test('1.6 Consecutive tags and whitespace-only segments', () => {
    const lrc = '[00:01.00]<00:01.00>   <00:01.50>\t\t<00:02.00>RealWord<00:02.50>   ';
    const words = utils.parseKaraokeWords(lrc, 1000, 0);
    assert.equal(words.length, 1, 'Whitespace-only tokens must not produce empty words');
    assert.equal(words[0].text, 'RealWord');
    assert.equal(words[0].time, 2.0);
  });

  await t.test('1.7 Untagged prefix before first tag with complex characters and emojis', () => {
    const lrc = '🎵 Đêm lạnh mùa đông <00:02.50> Hà Nội <00:03.50> phố';
    const words = utils.parseKaraokeWords(lrc, 1000, 0);
    assert.equal(words.length, 3);
    assert.equal(words[0].text, '🎵 Đêm lạnh mùa đông');
    assert.equal(words[0].time, 1.0);
    assert.equal(words[1].text, 'Hà Nội');
    assert.equal(words[1].time, 2.5);
    assert.equal(words[2].text, 'phố');
    assert.equal(words[2].time, 3.5);
  });
});

// ============================================================================
// CHALLENGE SUITE 2: Timing Accuracy & lyricWordAt Monotonicity
// ============================================================================
test('Adversarial 2: Timing Accuracy & lyricWordAt Monotonicity', async t => {
  const words = [
    { time: 1.0, text: 'W1' },
    { time: 1.5, text: 'W2' },
    { time: 2.0, text: 'W3' },
    { time: 3.25, text: 'W4' },
    { time: 5.0, text: 'W5' }
  ];

  await t.test('2.1 Exact boundary accuracy (epsilon transitions)', () => {
    // Just before 1.0s
    assert.equal(utils.lyricWordAt(words, 0.9999), -1);
    // Exact at 1.0s
    assert.equal(utils.lyricWordAt(words, 1.0), 0);
    // Between 1.0 and 1.5
    assert.equal(utils.lyricWordAt(words, 1.0001), 0);
    assert.equal(utils.lyricWordAt(words, 1.4999), 0);
    // Exact at 1.5s
    assert.equal(utils.lyricWordAt(words, 1.5), 1);
    // Just past last word
    assert.equal(utils.lyricWordAt(words, 5.0), 4);
    assert.equal(utils.lyricWordAt(words, 5.0001), 4);
    assert.equal(utils.lyricWordAt(words, 100.0), 4);
  });

  await t.test('2.2 Monotonicity: index is non-decreasing as time advances continuously', () => {
    let lastIndex = -1;
    // Step time by 0.005s from 0.0s to 6.0s (1200 steps)
    for (let t = 0; t <= 6.0; t += 0.005) {
      const idx = utils.lyricWordAt(words, t);
      assert.ok(idx >= lastIndex, `Monotonicity violation at t=${t}: current ${idx} < last ${lastIndex}`);
      lastIndex = idx;
    }
    assert.equal(lastIndex, 4, 'Must reach final word index');
  });

  await t.test('2.3 Non-finite and extreme time values', () => {
    assert.equal(utils.lyricWordAt(words, -Infinity), -1);
    assert.equal(utils.lyricWordAt(words, -100), -1);
    assert.equal(utils.lyricWordAt(words, NaN), -1);
    assert.equal(utils.lyricWordAt(words, null), -1);
    assert.equal(utils.lyricWordAt(words, undefined), -1);
    assert.equal(utils.lyricWordAt(words, 'invalid'), -1);
    assert.equal(utils.lyricWordAt(words, Infinity), 4);
  });
});

// ============================================================================
// CHALLENGE SUITE 3: High-Frequency Seeking & Scrubbing Stress Test (1,000 Ops)
// ============================================================================
test('Adversarial 3: High-Frequency Seeking & Scrubbing Stress Test (1000 Ops)', async t => {
  // Build a realistic 10-line song with 4 words per line
  const lines = [];
  for (let l = 0; l < 10; l++) {
    const lineStart = l * 10;
    const w0 = lineStart + 1;
    const w1 = lineStart + 3;
    const w2 = lineStart + 5;
    const w3 = lineStart + 7;
    const pad = n => String(n).padStart(2, '0');
    lines.push(`[00:${pad(lineStart)}.00]<00:${pad(w0)}.00>Line${l}W0 <00:${pad(w1)}.00>Line${l}W1 <00:${pad(w2)}.00>Line${l}W2 <00:${pad(w3)}.00>Line${l}W3`);
  }
  const lrc = lines.join('\n');

  const { sandbox, container, audio } = createHarness(lrc, 0, 100);

  // Pseudo-random deterministic generator (xorshift32)
  let seed = 123456789;
  function rand() {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  // 1,000 randomized seeks across the song duration
  for (let step = 0; step < 1000; step++) {
    // Generate target seek time between -2s and 105s
    const targetTime = -2 + rand() * 107;
    audio.currentTime = targetTime;

    assert.doesNotThrow(() => {
      sandbox.updateLyricsHighlight();
    }, `Highlight update threw error at step ${step}, targetTime ${targetTime}`);

    const activeIndex = sandbox.state.lyricIndex;
    const domRows = container.querySelectorAll('.lyric-line');

    // INVARIANT 1: Exactly 1 row is active if activeIndex >= 0, else 0
    let activeRowCount = 0;
    domRows.forEach((row, i) => {
      const isActive = row.classList.contains('lyric-line-active');
      if (isActive) activeRowCount++;
      assert.equal(isActive, i === activeIndex, `Row ${i} active class mismatch at t=${targetTime}`);
    });
    assert.equal(activeRowCount, activeIndex >= 0 ? 1 : 0, `Expected ${activeIndex >= 0 ? 1 : 0} active rows, found ${activeRowCount}`);

    // INVARIANT 2: Preceding rows have all words sung, subsequent rows have no sung/active words
    domRows.forEach((row, i) => {
      const spans = row.querySelectorAll('.lyric-word');
      if (i < activeIndex) {
        spans.forEach(s => {
          assert.ok(s.classList.contains('lyric-word-sung'), `Preceding line ${i} span must be sung`);
          assert.ok(!s.classList.contains('lyric-word-active'), `Preceding line ${i} span must not be active`);
        });
      } else if (i > activeIndex) {
        spans.forEach(s => {
          assert.ok(!s.classList.contains('lyric-word-sung'), `Future line ${i} span must not be sung`);
          assert.ok(!s.classList.contains('lyric-word-active'), `Future line ${i} span must not be active`);
        });
      } else if (i === activeIndex) {
        // Active line word invariants
        const activeLineData = sandbox.state.lyrics[activeIndex];
        const activeWordIdx = utils.lyricWordAt(activeLineData.words, targetTime);
        spans.forEach((s, w) => {
          if (w < activeWordIdx) {
            assert.ok(s.classList.contains('lyric-word-sung'), `Sung word ${w} on active row`);
            assert.ok(!s.classList.contains('lyric-word-active'), `Sung word ${w} must not be active`);
          } else if (w === activeWordIdx) {
            assert.ok(s.classList.contains('lyric-word-active'), `Active word ${w} on active row`);
            assert.ok(!s.classList.contains('lyric-word-sung'), `Active word ${w} must not be sung`);
          } else {
            assert.ok(!s.classList.contains('lyric-word-sung'), `Unsung future word ${w}`);
            assert.ok(!s.classList.contains('lyric-word-active'), `Unsung future word ${w}`);
          }
        });
      }
    });
  }
});

// ============================================================================
// CHALLENGE SUITE 4: Intra-Line Word Progression NEVER Calls scrollIntoView
// ============================================================================
test('Adversarial 4: Intra-line word progression NEVER calls scrollIntoView', async t => {
  const lrc = '[00:10.00]<00:10.00>First <00:11.00>Second <00:12.00>Third <00:13.00>Fourth <00:14.00>Fifth\n[00:20.00]<00:20.00>Next line';

  const { sandbox, container, audio } = createHarness(lrc, 0, 100);
  const rows = container.querySelectorAll('.lyric-line');
  assert.equal(rows.length, 2);

  // Position row 0 outside viewport so line transition triggers scrollIntoView
  rows[0].rect = { top: 350, bottom: 378, left: 0, right: 100, width: 100, height: 28 };

  // Step 1: Transition into line 0 at t = 10.0
  audio.currentTime = 10.0;
  sandbox.updateLyricsHighlight();

  assert.equal(rows[0].scrollCount, 1, 'Line transition into row 0 must trigger scrollIntoView exactly once');

  // Now, position row 0 inside viewport or keep it wherever:
  // Simulate 500 high-frequency timeupdate ticks while staying inside line 0 (10.0s to 19.9s)
  const initialScrollCount = rows[0].scrollCount;

  for (let t = 10.01; t <= 19.9; t += 0.02) {
    audio.currentTime = t;
    sandbox.updateLyricsHighlight();

    // Verify scrollCount on row 0 has NOT increased
    assert.equal(
      rows[0].scrollCount,
      initialScrollCount,
      `scrollIntoView was called during intra-line progression at t=${t}! Total calls: ${rows[0].scrollCount}`
    );
  }

  // Also verify row 1 was never scrolled
  assert.equal(rows[1].scrollCount, 0, 'Row 1 was never scrolled yet');

  // Now transition to line 1: position row 1 outside viewport
  rows[1].rect = { top: 400, bottom: 428, left: 0, right: 100, width: 100, height: 28 };
  audio.currentTime = 20.0;
  sandbox.updateLyricsHighlight();

  assert.equal(rows[1].scrollCount, 1, 'Row 1 scrolled on transition');
  assert.equal(rows[0].scrollCount, initialScrollCount, 'Row 0 was not scrolled on row 1 transition');
});

// ============================================================================
// CHALLENGE SUITE 5: Word Click-To-Seek & Event Propagation Immunity
// ============================================================================
test('Adversarial 5: Word click-to-seek & event propagation immunity', async t => {
  const lrc = '[00:05.00]<00:05.00>Start <00:08.50>Middle <00:12.00>End';
  const { sandbox, container, audio } = createHarness(lrc, 0, 100);

  const row = container.querySelectorAll('.lyric-line')[0];
  const words = row.querySelectorAll('.lyric-word');

  let parentRowClicked = false;
  row.addEventListener('click', () => {
    parentRowClicked = true;
  });

  // Click on word 1 (Middle at 8.5s)
  const fakeEvent = {
    type: 'click',
    _propagationStopped: false,
    stopPropagation() {
      this._propagationStopped = true;
    }
  };

  words[1].dispatchEvent(fakeEvent);

  assert.ok(fakeEvent._propagationStopped, 'stopPropagation must be called on word click');
  assert.equal(parentRowClicked, false, 'Parent row click handler must NOT be invoked when word is clicked');
  assert.equal(audio.currentTime, 8.5, 'Audio currentTime must seek to clicked word timestamp (8.5s)');

  // Test edge case: audio.duration is NaN or 0
  audio.duration = NaN;
  audio.currentTime = 8.5;
  words[0].dispatchEvent(fakeEvent);
  // audio.currentTime should not become NaN
  assert.equal(audio.currentTime, 8.5, 'Must not set currentTime when audio.duration is NaN');
});

// ============================================================================
// CHALLENGE SUITE 6: Mixed Track Types & Viewport Scroll Gating
// ============================================================================
test('Adversarial 6: Mixed Track Types & Viewport Scroll Gating', async t => {
  // A complex mixed track:
  // Line 0: Enhanced LRC
  // Line 1: Standard LRC (no word tags)
  // Line 2: Enhanced LRC with negative offset
  // Line 3: Standard LRC
  const mixedLrc = `
[00:01.00]<00:01.00>Hello <00:02.00>World
[00:05.00]This is standard LRC without word tags
[00:10.00]<00:10.00>Back <00:11.00>To <00:12.00>Karaoke
[00:15.00]Final standard line
`.trim();

  const { sandbox, container, audio } = createHarness(mixedLrc, 0, 100);
  const rows = container.querySelectorAll('.lyric-line');
  assert.equal(rows.length, 4);

  // Line 0: Enhanced
  assert.equal(rows[0].querySelectorAll('.lyric-word').length, 2);
  // Line 1: Standard
  assert.equal(rows[1].querySelectorAll('.lyric-word').length, 0);
  // Line 2: Enhanced
  assert.equal(rows[2].querySelectorAll('.lyric-word').length, 3);
  // Line 3: Standard
  assert.equal(rows[3].querySelectorAll('.lyric-word').length, 0);

  // Playback through all lines: verify smooth transition between enhanced and standard
  const testPoints = [
    { t: 1.0, activeRow: 0, wordCount: 2, sungCount: 0, activeWord: 0 },
    { t: 2.0, activeRow: 0, wordCount: 2, sungCount: 1, activeWord: 1 },
    { t: 5.5, activeRow: 1, wordCount: 0, sungCount: 0, activeWord: -1 },
    { t: 10.5, activeRow: 2, wordCount: 3, sungCount: 0, activeWord: 0 },
    { t: 11.5, activeRow: 2, wordCount: 3, sungCount: 1, activeWord: 1 },
    { t: 15.5, activeRow: 3, wordCount: 0, sungCount: 0, activeWord: -1 }
  ];

  for (const pt of testPoints) {
    audio.currentTime = pt.t;
    sandbox.updateLyricsHighlight();

    assert.equal(sandbox.state.lyricIndex, pt.activeRow, `Active row mismatch at t=${pt.t}`);
    const activeRowEl = rows[pt.activeRow];
    assert.ok(activeRowEl.classList.contains('lyric-line-active'), `Active class on row ${pt.activeRow}`);

    const words = activeRowEl.querySelectorAll('.lyric-word');
    assert.equal(words.length, pt.wordCount, `Word count mismatch on row ${pt.activeRow}`);

    if (pt.wordCount > 0) {
      const sungWords = words.filter(w => w.classList.contains('lyric-word-sung'));
      const activeWords = words.filter(w => w.classList.contains('lyric-word-active'));
      assert.equal(sungWords.length, pt.sungCount, `Sung word count at t=${pt.t}`);
      assert.equal(activeWords.length, pt.activeWord >= 0 ? 1 : 0, `Active word count at t=${pt.t}`);
    }
  }
});

// ============================================================================
// CHALLENGE SUITE 7: Massive Dataset & Rapid Track Switching Stress
// ============================================================================
test('Adversarial 7: Massive Dataset & Rapid Track Switching Stress', async t => {
  await t.test('7.1 Real-world vs Large lyric file performance', () => {
    // 1. Typical real-world song (40 lines, ~200 words)
    const realLines = [];
    for (let l = 0; l < 40; l++) {
      const min = Math.floor(l / 6);
      const sec = (l % 6) * 10;
      const pad = n => String(n).padStart(2, '0');
      realLines.push(`[${pad(min)}:${pad(sec)}.00]<${pad(min)}:${pad(sec)}.00>WordA <${pad(min)}:${pad(sec + 2)}.00>WordB <${pad(min)}:${pad(sec + 4)}.00>WordC <${pad(min)}:${pad(sec + 6)}.00>WordD <${pad(min)}:${pad(sec + 8)}.00>WordE`);
    }
    const realLrc = realLines.join('\n');
    const { sandbox: realBox, audio: realAudio } = createHarness(realLrc, 0, 300);

    realAudio.currentTime = 0;
    realBox.updateLyricsHighlight();

    const startReal = Date.now();
    for (let i = 0; i < 500; i++) {
      realAudio.currentTime = 0.01 * (i + 1);
      realBox.updateLyricsHighlight();
    }
    const realDuration = Date.now() - startReal;
    // 500 intra-line ticks for a normal song must take < 300ms (< 0.6ms/tick, well within 16.6ms frame budget)
    assert.ok(realDuration < 300, `500 intra-line updates for 40-line song took ${realDuration}ms (expected < 300ms)`);
  });

  await t.test('7.2 Rapid track switching stress (200 switches across diverse lyric formats)', () => {
    const tracks = [
      '[00:01.00]<00:01.00>Enhanced <00:02.00>Track',
      '[00:01.00]Standard Line 1\n[00:04.00]Standard Line 2',
      'Plain untimed lyrics line 1\nPlain untimed lyrics line 2',
      '',
      '[ti:Metadata Only]\n[ar:Artist Only]\n[al:Album Only]'
    ];

    const { sandbox, container, audio } = createHarness('', 0, 100);

    for (let i = 0; i < 200; i++) {
      const trackIndex = i % tracks.length;
      sandbox.renderLyrics(tracks[trackIndex]);
      audio.currentTime = (i % 10);
      sandbox.updateLyricsHighlight();

      if (trackIndex === 0) {
        assert.equal(container.children.length, 1);
        assert.equal(container.children[0].querySelectorAll('.lyric-word').length, 2);
      } else if (trackIndex === 1) {
        assert.equal(container.children.length, 2);
        assert.equal(container.children[0].querySelectorAll('.lyric-word').length, 0);
      } else if (trackIndex === 2) {
        assert.equal(container.children.length, 2);
        assert.equal(container.children[0].querySelectorAll('.lyric-word').length, 0);
      } else if (trackIndex === 3 || trackIndex === 4) {
        assert.ok(container.innerHTML.includes('Chưa có lời đồng bộ'));
      }
    }
  });

  await t.test('7.3 Continuous reverse scrubbing (backward time progression: 100s -> 0s)', () => {
    const lrc = `
[00:00.00]<00:00.00>Zero <00:01.00>One <00:02.00>Two
[00:05.00]<00:05.00>Five <00:06.00>Six <00:07.00>Seven
[00:10.00]<00:10.00>Ten <00:11.00>Eleven <00:12.00>Twelve
`.trim();

    const { sandbox, container, audio } = createHarness(lrc, 15, 20);
    // Start at t = 15: all rows and words are sung
    sandbox.updateLyricsHighlight();

    // Step backward by 0.1s from 15s down to 0s (150 ticks)
    for (let t = 15.0; t >= 0.0; t -= 0.1) {
      audio.currentTime = Math.max(0, t);
      sandbox.updateLyricsHighlight();

      const idx = sandbox.state.lyricIndex;
      const rows = container.querySelectorAll('.lyric-line');

      // Verify future lines have no sung or active words
      for (let r = idx + 1; r < rows.length; r++) {
        const words = rows[r].querySelectorAll('.lyric-word');
        for (const w of words) {
          assert.ok(!w.classList.contains('lyric-word-sung'), `Row ${r} word must not be sung during reverse scrub at t=${t}`);
          assert.ok(!w.classList.contains('lyric-word-active'), `Row ${r} word must not be active during reverse scrub at t=${t}`);
        }
      }
    }
  });
});
