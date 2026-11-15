'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

test('Pha B: 3D Soundstage Vector Spectrogram & Spatial Goniometer Visualizer Test Suite', async (t) => {
  await t.test('1. calculateSpatialVectorSpectrogram computes accurate polar coordinates & soundstage metrics', () => {
    assert.equal(typeof library.calculateSpatialVectorSpectrogram, 'function');

    // Empty input fallback
    const emptyReport = library.calculateSpatialVectorSpectrogram(null, null);
    assert.ok(Array.isArray(emptyReport.points));
    assert.equal(emptyReport.correlation, 1.0);
    assert.equal(emptyReport.azimuthDegrees, 0);

    // Identical Mono L = R signals
    const monoL = new Uint8Array(64).fill(200);
    const monoR = new Uint8Array(64).fill(200);
    const monoReport = library.calculateSpatialVectorSpectrogram(monoL, monoR);
    assert.equal(monoReport.correlation, 1.0);
    assert.equal(monoReport.azimuthDegrees, 0);
    assert.ok(monoReport.rmsSide < 0.001, 'Side component in mono must be zero');
    assert.ok(monoReport.rmsMid > 0, 'Mid component in mono must be positive');

    // Hard out-of-phase L = -R signals (180 deg inverted)
    const invL = new Uint8Array(64).fill(228); // +100 offset
    const invR = new Uint8Array(64).fill(28);  // -100 offset
    const invReport = library.calculateSpatialVectorSpectrogram(invL, invR);
    assert.equal(invReport.correlation, -1.0, 'Anti-phase signals must yield correlation -1.0');
    assert.equal(invReport.soundstageState, 'phase_warning');

    // Panned Right (L quiet, R loud)
    const panL = new Uint8Array(64).fill(130);
    const panR = new Uint8Array(64).fill(220);
    const panRight = library.calculateSpatialVectorSpectrogram(panL, panR);
    assert.ok(panRight.azimuthDegrees > 0, 'Panned right must have positive azimuth');

    // Panned Left (L loud, R quiet)
    const panLeft = library.calculateSpatialVectorSpectrogram(panR, panL);
    assert.ok(panLeft.azimuthDegrees < 0, 'Panned left must have negative azimuth');
  });

  await t.test('2. formatSpatialVectorTelemetry produces comprehensive localized readout', () => {
    assert.equal(typeof library.formatSpatialVectorTelemetry, 'function');

    assert.equal(library.formatSpatialVectorTelemetry(null), '🧭 Âm hình 3D: Chưa có dữ liệu');

    const balancedText = library.formatSpatialVectorTelemetry({
      azimuthDegrees: 0,
      soundstageSpread: 45,
      correlation: 0.95
    });
    assert.ok(balancedText.includes('Trung tâm'));
    assert.ok(balancedText.includes('Độ mở 45%'));
    assert.ok(balancedText.includes('Đồng pha tuyệt đối'));
    assert.ok(balancedText.includes('r=+0.95'));

    const warningText = library.formatSpatialVectorTelemetry({
      azimuthDegrees: -12.5,
      soundstageSpread: 80,
      correlation: -0.45
    });
    assert.ok(warningText.includes('Lệch Trái 12.5°'));
    assert.ok(warningText.includes('Cảnh báo lệch pha'));
  });

  await t.test('3. renderSpatialVectorCanvas safely handles contexts and draws vector scope', () => {
    assert.equal(typeof library.renderSpatialVectorCanvas, 'function');

    // Invalid canvas fallback
    assert.equal(library.renderSpatialVectorCanvas(null), false);
    assert.equal(library.renderSpatialVectorCanvas({}), false);

    // Mock canvas context
    const drawnMethods = [];
    const mockCtx = {
      clearRect: () => drawnMethods.push('clearRect'),
      beginPath: () => drawnMethods.push('beginPath'),
      arc: () => drawnMethods.push('arc'),
      moveTo: () => drawnMethods.push('moveTo'),
      lineTo: () => drawnMethods.push('lineTo'),
      closePath: () => drawnMethods.push('closePath'),
      stroke: () => drawnMethods.push('stroke'),
      fill: () => drawnMethods.push('fill'),
      save: () => drawnMethods.push('save'),
      restore: () => drawnMethods.push('restore')
    };
    const mockCanvas = {
      width: 400,
      height: 200,
      getContext: (type) => (type === '2d' ? mockCtx : null)
    };

    const mockReport = {
      points: [{ x: 0, y: 0.5 }, { x: 0.3, y: 0.2 }, { x: -0.3, y: 0.2 }],
      soundstageState: 'balanced'
    };
    const res = library.renderSpatialVectorCanvas(mockCanvas, mockReport);
    assert.equal(res, true);
    assert.ok(drawnMethods.includes('clearRect'));
    assert.ok(drawnMethods.includes('arc'));
    assert.ok(drawnMethods.includes('stroke'));
  });

  await t.test('4. VISUALIZER_THEMES includes aurora_borealis and monochrome_studio (15 total themes)', () => {
    assert.ok(library.VISUALIZER_THEMES.aurora_borealis);
    assert.ok(library.VISUALIZER_THEMES.monochrome_studio);
    assert.equal(library.getVisualizerTheme('aurora_borealis').id, 'aurora_borealis');
    assert.equal(library.getVisualizerTheme('monochrome_studio').id, 'monochrome_studio');

    const totalThemes = Object.keys(library.VISUALIZER_THEMES).length;
    assert.equal(totalThemes, 15, 'VISUALIZER_THEMES must contain 15 audiophile themes');

    const cycled = library.cycleVisualizerTheme('solar_flare', { all: true });
    assert.equal(cycled, 'aurora_borealis');
    const cycledNext = library.cycleVisualizerTheme('aurora_borealis', { all: true });
    assert.equal(cycledNext, 'monochrome_studio');
  });

  await t.test('5. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    assert.ok(indexHtml.includes('id="fs-stage-mode-vector"'), '#fs-stage-mode-vector button must exist in Fullscreen Stage');
    assert.ok(indexHtml.includes('Goniometer 3D'), 'Goniometer 3D label must exist');
    assert.ok(indexHtml.includes('calculateSpatialVectorSpectrogram'), 'calculateSpatialVectorSpectrogram must be integrated');
    assert.ok(indexHtml.includes('renderSpatialVectorCanvas'), 'renderSpatialVectorCanvas must be integrated');

    // CRITICAL AUDIO GRAPH INVARIANT
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: crossfeedNodes.output must connect directly to context.destination'
    );
  });
});
