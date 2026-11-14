const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library-utils.js');

test('Pha C: calculateLyricsOffsetTime correctly applies positive and negative offsets', () => {
  // Positive offset: music at 10.0s, offset +0.5s -> effective lyrics time is 10.5s (lyrics display earlier / compensate slow lyrics)
  assert.equal(library.calculateLyricsOffsetTime(10, 0.5), 10.5);
  // Negative offset: music at 10.0s, offset -0.5s -> effective lyrics time is 9.5s
  assert.equal(library.calculateLyricsOffsetTime(10, -0.5), 9.5);
  // Zero offset
  assert.equal(library.calculateLyricsOffsetTime(10, 0), 10);
  // Clamped at 0 (cannot be negative)
  assert.equal(library.calculateLyricsOffsetTime(0.2, -0.8), 0);
  // Fallbacks with NaN/invalid
  assert.equal(library.calculateLyricsOffsetTime(NaN, 1), 1);
  assert.equal(library.calculateLyricsOffsetTime(5, undefined), 5);
});

test('Pha C: clampLyricsOffset enforces safe audiophile bounds', () => {
  assert.equal(library.clampLyricsOffset(0.555), 0.56);
  assert.equal(library.clampLyricsOffset(15), 10);
  assert.equal(library.clampLyricsOffset(-25), -10);
  assert.equal(library.clampLyricsOffset(-0.25), -0.25);
  assert.equal(library.clampLyricsOffset(NaN), 0);
});

test('Pha C: formatLyricsOffset produces human-readable labels', () => {
  assert.equal(library.formatLyricsOffset(0), 'Chuẩn (0ms)');
  assert.equal(library.formatLyricsOffset(0.0001), 'Chuẩn (0ms)');
  assert.equal(library.formatLyricsOffset(0.5), '+500ms');
  assert.equal(library.formatLyricsOffset(-0.25), '-250ms');
  assert.equal(library.formatLyricsOffset(1.2), '+1200ms');
});

test('Pha C: calculateLyricsLineOpacity implements smooth vocal focus distance', () => {
  // Current active line: full brightness
  assert.equal(library.calculateLyricsLineOpacity(3, 3), 1.0);
  // 1 line away: 0.65
  assert.equal(library.calculateLyricsLineOpacity(2, 3), 0.65);
  assert.equal(library.calculateLyricsLineOpacity(4, 3), 0.65);
  // 2 lines away: 0.45
  assert.equal(library.calculateLyricsLineOpacity(1, 3), 0.45);
  assert.equal(library.calculateLyricsLineOpacity(5, 3), 0.45);
  // Further: 0.25
  assert.equal(library.calculateLyricsLineOpacity(0, 3), 0.25);
  // No active line: neutral 0.6
  assert.equal(library.calculateLyricsLineOpacity(2, -1), 0.6);
});

test('Pha C & Audio Engine Invariant: Fullscreen Lyrics DOM & AudioContext Integrity', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  // Verify Fullscreen Stage switching DOM
  assert.match(html, /id="fullscreen-stage-art"/, 'Fullscreen view should have dedicated album art stage');
  assert.match(html, /id="fullscreen-stage-lyrics"/, 'Fullscreen view should have dedicated lyrics stage');
  assert.match(html, /id="fullscreen-view-art-btn"/, 'Top navigation bar should have art view switch button');
  assert.match(html, /id="fullscreen-view-lyrics-btn"/, 'Top navigation bar should have lyrics view switch button');
  assert.match(html, /id="fullscreen-lyrics-scroll"/, 'Fullscreen lyrics stage should have scrolling lyrics container');

  // Verify Offset Calibration Controls in both Fullscreen and Room
  assert.match(html, /id="fs-lyrics-offset-minus"/, 'Fullscreen view should have offset decrement button');
  assert.match(html, /id="fs-lyrics-offset-plus"/, 'Fullscreen view should have offset increment button');
  assert.match(html, /id="fs-lyrics-offset-val"/, 'Fullscreen view should have offset display readout');
  assert.match(html, /id="room-lyrics-offset-minus"/, 'Listening room should have offset decrement button');
  assert.match(html, /id="room-lyrics-offset-plus"/, 'Listening room should have offset increment button');
  assert.match(html, /id="room-lyrics-offset-badge"/, 'Listening room should have offset display badge');

  // CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});
