const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const library = require(libraryPath);

test('Pha B: VISUALIZER_THEMES contains new audiophile palettes', () => {
  const themes = library.VISUALIZER_THEMES;
  assert.ok(themes.emerald, 'McIntosh Vintage Green theme should exist');
  assert.ok(themes.amber, 'Vacuum Tube Warmth theme should exist');
  assert.ok(themes.ocean, 'Pacific Hi-Res Blue theme should exist');

  assert.equal(library.getVisualizerTheme('emerald').name, 'McIntosh Vintage Green');
  assert.equal(library.getVisualizerTheme('amber').name, 'Vacuum Tube Warmth');
  assert.equal(library.getVisualizerTheme('ocean').name, 'Pacific Hi-Res Blue');

  // Verify gradient stops and peakColor
  for (const id of ['emerald', 'amber', 'ocean']) {
    const t = themes[id];
    assert.equal(t.id, id);
    assert.ok(t.stops.length >= 3);
    assert.ok(typeof t.peakColor === 'string');
  }
});

test('Pha B: calculateVuBallistics computes accurate needle ballistics and overload detection', () => {
  // Silent signal
  const silent = library.calculateVuBallistics(0, 0);
  assert.equal(silent.level, 0);
  assert.equal(silent.db, -40);
  assert.equal(silent.needleAngle, -45);
  assert.equal(silent.isOverload, false);

  // Moderate signal (0.5 normalized)
  const mid = library.calculateVuBallistics(0.5, 0);
  assert.ok(mid.level > 0 && mid.level <= 0.5);
  assert.ok(mid.db > -40 && mid.db < 0);
  assert.ok(mid.needleAngle > -45 && mid.needleAngle < 45);
  assert.equal(mid.isOverload, false);

  // Peak / Overload signal (1.0 normalized)
  const peak = library.calculateVuBallistics(1.0, 0.95);
  assert.ok(peak.level >= 0.95);
  assert.ok(peak.db >= -0.5);
  assert.equal(peak.isOverload, true);
  assert.ok(peak.needleAngle >= 35);

  // Ballistics decay test
  const decaying = library.calculateVuBallistics(0, 0.8);
  assert.ok(decaying.level < 0.8);
  assert.ok(decaying.level >= 0.7);
});

test('Pha B: cycleVisualizerMode & formatVisualizerMode cycle modes cleanly', () => {
  assert.equal(library.cycleVisualizerMode('spectrum'), 'oscilloscope');
  assert.equal(library.cycleVisualizerMode('oscilloscope'), 'vumeter');
  assert.equal(library.cycleVisualizerMode('vumeter'), 'spectrum');
  assert.equal(library.cycleVisualizerMode('unknown'), 'spectrum');

  assert.ok(library.formatVisualizerMode('spectrum').includes('Phổ'));
  assert.ok(library.formatVisualizerMode('oscilloscope').includes('Dao động'));
  assert.ok(library.formatVisualizerMode('vumeter').includes('VU'));
});

test('Pha B: renderVisualizerVuMeter renders dual stereophonic analog VU meters onto canvas', () => {
  const drawCalls = { arc: 0, stroke: 0, fill: 0, moveTo: 0, lineTo: 0, fillText: 0 };
  const mockContext = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    lineCap: '',
    shadowBlur: 0,
    shadowColor: '',
    clearRect() {},
    beginPath() {},
    arc() { drawCalls.arc++; },
    stroke() { drawCalls.stroke++; },
    fill() { drawCalls.fill++; },
    moveTo() { drawCalls.moveTo++; },
    lineTo() { drawCalls.lineTo++; },
    fillText() { drawCalls.fillText++; }
  };

  // Dual stereo render (width = 200, height = 80)
  const renderedDual = library.renderVisualizerVuMeter(mockContext, {
    width: 200,
    height: 80,
    leftAngle: -10,
    rightAngle: 15,
    isOverloadLeft: false,
    isOverloadRight: true,
    theme: 'emerald'
  });
  assert.equal(renderedDual, true);
  assert.ok(drawCalls.arc >= 4); // 2 meter plates + 2 overload LEDs + 2 pivots
  assert.ok(drawCalls.fillText >= 2); // 'L' and 'R'
  assert.ok(drawCalls.stroke >= 4);

  // Single centered render (narrow width = 100)
  const renderedSingle = library.renderVisualizerVuMeter(mockContext, {
    width: 100,
    height: 60,
    leftAngle: 0,
    theme: 'amber'
  });
  assert.equal(renderedSingle, true);

  // Invalid cases
  assert.equal(library.renderVisualizerVuMeter(null), false);
  assert.equal(library.renderVisualizerVuMeter(mockContext, { width: 0, height: 60 }), false);
});

test('Pha B & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: AudioContext Graph invariant must remain intact!'
  );
  assert.ok(
    indexHtml.includes("state.visualizerMode === 'vumeter'"),
    'VU meter visualizer mode must be wired into render loop in index.html'
  );
  assert.ok(
    indexHtml.includes("e.key === 'v' || e.key === 'V'"),
    "Keyboard shortcut 'v' for visualizer mode switching must exist in index.html"
  );
});
