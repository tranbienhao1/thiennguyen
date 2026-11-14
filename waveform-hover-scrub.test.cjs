// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library-utils.js');

test('Waveform Hover & Scrubbing Utilities - Pure Functions', async t => {
  await t.test('calculateHoverSeekFraction calculates correct fraction and clamps within [0, 1]', () => {
    const rect = { left: 100, width: 400 };

    assert.equal(library.calculateHoverSeekFraction(100, rect), 0);
    assert.equal(library.calculateHoverSeekFraction(300, rect), 0.5);
    assert.equal(library.calculateHoverSeekFraction(500, rect), 1);

    // Out of bounds clamping
    assert.equal(library.calculateHoverSeekFraction(50, rect), 0);
    assert.equal(library.calculateHoverSeekFraction(600, rect), 1);

    // Invalid rect safe fallbacks
    assert.equal(library.calculateHoverSeekFraction(200, null), 0);
    assert.equal(library.calculateHoverSeekFraction(200, { left: 0, width: 0 }), 0);
    assert.equal(library.calculateHoverSeekFraction(200, { left: 0, width: -10 }), 0);
  });

  await t.test('calculateHoverSeekTime calculates accurate seek timestamp', () => {
    const rect = { left: 0, width: 200 };
    const duration = 180; // 3 minutes

    assert.equal(library.calculateHoverSeekTime(0, rect, duration), 0);
    assert.equal(library.calculateHoverSeekTime(100, rect, duration), 90);
    assert.equal(library.calculateHoverSeekTime(200, rect, duration), 180);

    // Clamps
    assert.equal(library.calculateHoverSeekTime(250, rect, duration), 180);
    assert.equal(library.calculateHoverSeekTime(-50, rect, duration), 0);
  });

  await t.test('formatHoverTime produces clean m:ss timestamp format', () => {
    assert.equal(library.formatHoverTime(0), '0:00');
    assert.equal(library.formatHoverTime(5), '0:05');
    assert.equal(library.formatHoverTime(65), '1:05');
    assert.equal(library.formatHoverTime(328), '5:28');
    assert.equal(library.formatHoverTime(3600), '60:00');

    // Safe fallbacks for edge cases
    assert.equal(library.formatHoverTime(-10), '0:00');
    assert.equal(library.formatHoverTime(null), '0:00');
    assert.equal(library.formatHoverTime(undefined), '0:00');
  });

  await t.test('renderWaveformCanvas renders ghost playhead when hoverFraction is provided', () => {
    const fillRectCalls = [];
    const mockContext = {
      clearRect: () => {},
      fillRect: (x, y, w, h) => {
        fillRectCalls.push({ x, y, w, h, fillStyle: mockContext.fillStyle });
      },
      fillStyle: ''
    };

    const mockCanvas = {
      width: 400,
      height: 60,
      getContext: () => mockContext
    };

    const peaks = [0.2, 0.4, 0.8, 0.6, 0.3];
    library.renderWaveformCanvas(mockCanvas, peaks, 0.2, {
      hoverFraction: 0.7,
      colorGhostPlayhead: 'rgba(239, 68, 68, 0.55)',
      colorPlayhead: '#ef4444'
    });

    // Check that ghost playhead was drawn at 0.7 * 400 = 280
    const ghostCall = fillRectCalls.find(c => c.x === 279.5 && c.w === 1.5);
    assert.ok(ghostCall, 'Ghost playhead line should be drawn at hover fraction position');
    assert.equal(ghostCall.fillStyle, 'rgba(239, 68, 68, 0.55)');

    // Playhead was drawn at 0.2 * 400 = 80
    const playheadCall = fillRectCalls.find(c => c.x === 79 && c.w === 2);
    assert.ok(playheadCall, 'Playhead line should be drawn at playback fraction position');
    assert.equal(playheadCall.fillStyle, '#ef4444');
  });
});

test('Waveform Hover & Scrubbing - DOM & UI Integration', async t => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  await t.test('Tooltip elements exist in both Listening Room and Fullscreen Roon View', () => {
    assert.ok(html.includes('id="waveform-hover-tooltip"'), '#waveform-hover-tooltip must exist in Listening Room');
    assert.ok(html.includes('id="fullscreen-waveform-hover-tooltip"'), '#fullscreen-waveform-hover-tooltip must exist in Fullscreen View');
  });

  await t.test('State initializes waveform hover fractions', () => {
    assert.ok(html.includes('waveformHoverFraction: null'), 'state must have waveformHoverFraction');
    assert.ok(html.includes('fullscreenWaveformHoverFraction: null'), 'state must have fullscreenWaveformHoverFraction');
  });

  await t.test('Waveform canvas elements listen to mousemove and mouseleave events', () => {
    assert.ok(html.includes("wfCanvas.addEventListener('mousemove'"), 'waveform-canvas must listen to mousemove');
    assert.ok(html.includes("wfCanvas.addEventListener('mouseleave'"), 'waveform-canvas must listen to mouseleave');
    assert.ok(html.includes("fsWaveform.addEventListener('mousemove'"), 'fullscreen-waveform must listen to mousemove');
    assert.ok(html.includes("fsWaveform.addEventListener('mouseleave'"), 'fullscreen-waveform must listen to mouseleave');
  });

  await t.test('Drag-to-seek is supported when mouse button is held down', () => {
    assert.ok(html.includes('e.buttons === 1'), 'Must check e.buttons === 1 for continuous drag scrubbing');
    assert.ok(html.includes('state.isSeeking = true'), 'Must set state.isSeeking = true while dragging');
  });

  await t.test('Web Audio Graph Invariant is strictly preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph routing invariant must never be modified'
    );
  });
});
