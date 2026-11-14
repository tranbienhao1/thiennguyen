const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Pha B: calculateStereoPhaseCorrelation accurately detects stereo phase relationships', () => {
  // 1. Empty or silent input
  const emptyRes = library.calculateStereoPhaseCorrelation(null, null);
  assert.equal(emptyRes.correlation, 1.0);
  assert.equal(emptyRes.phaseCategory, 'IN_PHASE');

  // 2. Pure Mono (Identical In-Phase, Float32)
  const monoL = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const monoR = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const monoRes = library.calculateStereoPhaseCorrelation(monoL, monoR);
  assert.equal(monoRes.correlation, 1.0);
  assert.equal(monoRes.phaseCategory, 'IN_PHASE');

  // 3. Complete Anti-Phase (180° Inverted, Left = -Right)
  const antiL = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const antiR = new Float32Array([-0.5, -0.8, 0.2, 0.7]);
  const antiRes = library.calculateStereoPhaseCorrelation(antiL, antiR);
  assert.equal(antiRes.correlation, -1.0);
  assert.equal(antiRes.phaseCategory, 'PHASE_WARNING');
  assert.ok(antiRes.badgeClass.includes('rose'));

  // 4. Uncorrelated Wide Stereo (Orthogonal)
  const orthoL = new Float32Array([1.0, 0.0, -1.0, 0.0]);
  const orthoR = new Float32Array([0.0, 1.0, 0.0, -1.0]);
  const orthoRes = library.calculateStereoPhaseCorrelation(orthoL, orthoR);
  assert.equal(orthoRes.correlation, 0.0);
  assert.equal(orthoRes.phaseCategory, 'WIDE');

  // 5. Uint8Array Web Audio Byte Time Domain (128 = 0.0)
  const byteL = new Uint8Array([128 + 40, 128 + 60, 128 - 30, 128 - 50]);
  const byteR = new Uint8Array([128 + 40, 128 + 60, 128 - 30, 128 - 50]);
  const byteRes = library.calculateStereoPhaseCorrelation(byteL, byteR);
  assert.equal(byteRes.correlation, 1.0);
  assert.equal(byteRes.phaseCategory, 'IN_PHASE');
});

test('Pha B: calculateStereoSoundstageWidth calculates mid/side energy and soundstage width', () => {
  // Mono signal -> Side is 0 -> Width is 0%
  const monoL = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const monoR = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const monoWidth = library.calculateStereoSoundstageWidth(monoL, monoR);
  assert.equal(monoWidth.widthPercent, 0);
  assert.equal(monoWidth.sideEnergy, 0);
  assert.ok(monoWidth.label.includes('Đơn âm'));

  // Anti-phase signal -> Mid is 0 -> Width is 100%
  const antiL = new Float32Array([0.5, 0.8, -0.2, -0.7]);
  const antiR = new Float32Array([-0.5, -0.8, 0.2, 0.7]);
  const antiWidth = library.calculateStereoSoundstageWidth(antiL, antiR);
  assert.equal(antiWidth.widthPercent, 100);
  assert.equal(antiWidth.midEnergy, 0);
  assert.ok(antiWidth.label.includes('3D') || antiWidth.label.includes('100%'));

  // Normal stereo signal
  const stereoL = new Float32Array([0.8, 0.4, -0.1, -0.6]);
  const stereoR = new Float32Array([0.4, 0.8, -0.4, -0.3]);
  const stWidth = library.calculateStereoSoundstageWidth(stereoL, stereoR);
  assert.ok(stWidth.widthPercent > 10 && stWidth.widthPercent < 90);
});

test('Pha B: formatStereoCorrelationBadge produces clean audiophile badge strings', () => {
  assert.equal(library.formatStereoCorrelationBadge(null), 'Phase +1.0');
  assert.equal(library.formatStereoCorrelationBadge({ correlation: 0.85 }), 'Phase +0.85');
  assert.equal(library.formatStereoCorrelationBadge({ correlation: -0.42 }), 'Phase -0.42');
  assert.equal(library.formatStereoCorrelationBadge({ correlation: 0 }), 'Phase 0.00');
});

test('Pha B & Audio Engine Invariant: Stereo Phase Meter DOM & Script Integration', () => {
  // SUPREME INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination);'),
    'AUDIO ENGINE INVARIANT: crossfeed output MUST connect to context destination'
  );

  // Phase badges exist in HTML
  assert.ok(indexHtml.includes('id="room-phase-badge"'), 'Listening room must have #room-phase-badge');
  assert.ok(indexHtml.includes('id="footer-phase-badge"'), 'Footer must have #footer-phase-badge');

  // Script integration
  assert.ok(indexHtml.includes('leftAnalyser: null, rightAnalyser: null'), 'State must hold leftAnalyser and rightAnalyser');
  assert.ok(indexHtml.includes('state.leftAnalyser = state.context.createAnalyser()'), 'setupAudio must create left analyser');
  assert.ok(indexHtml.includes('state.rightAnalyser = state.context.createAnalyser()'), 'setupAudio must create right analyser');
  assert.ok(indexHtml.includes('library.calculateStereoPhaseCorrelation'), 'renderVisualizer must call calculateStereoPhaseCorrelation');
  assert.ok(indexHtml.includes('library.formatStereoCorrelationBadge'), 'renderVisualizer must call formatStereoCorrelationBadge');
});
