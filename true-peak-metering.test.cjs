const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library-utils.js');

test('Pha A: calculateInterSamplePeak detects true peak overshoots from audio samples', () => {
  // Empty or invalid input
  const empty = library.calculateInterSamplePeak([]);
  assert.equal(empty.samplePeakDb, -96);
  assert.equal(empty.truePeakDbtp, -96);
  assert.equal(empty.isClipping, false);

  // Normal safe sine wave samples at -6 dB (amplitude 0.5)
  const safeSamples = new Float32Array(32);
  for (let i = 0; i < safeSamples.length; i++) {
    safeSamples[i] = 0.5 * Math.sin((2 * Math.PI * i) / 8);
  }
  const safeResult = library.calculateInterSamplePeak(safeSamples);
  assert.ok(safeResult.samplePeakDb <= -5.9 && safeResult.samplePeakDb >= -6.1);
  assert.ok(safeResult.truePeakDbtp <= -5.8);
  assert.equal(safeResult.isClipping, false);

  // High-frequency inter-sample overshoot pattern:
  // Samples alternating near +/- 0.95 with phase offset: reconstructed continuous peak exceeds 1.0 (clipping)
  const ispSamples = new Float32Array([0.0, 0.95, 0.95, 0.0, -0.95, -0.95, 0.0, 0.95, 0.95, 0.0]);
  const ispResult = library.calculateInterSamplePeak(ispSamples, 4);
  assert.ok(ispResult.truePeakDbtp > ispResult.samplePeakDb, 'True peak must detect inter-sample overshoot between adjacent high samples');
  assert.ok(ispResult.interSampleOvershootDb >= 0);

  // Uint8Array byte time-domain format (128 = silence)
  const byteSamples = new Uint8Array([128, 255, 128, 1, 128]);
  const byteResult = library.calculateInterSamplePeak(byteSamples);
  assert.ok(byteResult.samplePeakDb >= -0.1, 'Peak sample near byte 255 should approach 0 dBFS');
});

test('Pha A: calculateTruePeakHeadroom computes safe attenuation margin', () => {
  // True Peak at +1.5 dBTP (severe clipping risk) with -1.0 dBTP target
  const clipped = library.calculateTruePeakHeadroom(1.5, -1.0);
  assert.equal(clipped.hasHeadroom, false);
  assert.equal(clipped.recommendedAttenuationDb, -2.5);

  // True Peak at -0.5 dBTP with -1.0 dBTP target
  const slight = library.calculateTruePeakHeadroom(-0.5, -1.0);
  assert.equal(slight.hasHeadroom, false);
  assert.equal(slight.recommendedAttenuationDb, -0.5);

  // True Peak safe at -3.2 dBTP
  const safe = library.calculateTruePeakHeadroom(-3.2, -1.0);
  assert.equal(safe.hasHeadroom, true);
  assert.equal(safe.recommendedAttenuationDb, 0);
});

test('Pha A: formatTruePeakBadge formats audiophile display strings', () => {
  assert.equal(library.formatTruePeakBadge(-96), 'TP --');
  assert.equal(library.formatTruePeakBadge(NaN), 'TP --');
  assert.equal(library.formatTruePeakBadge(-1.2), 'TP -1.2 dBTP');
  assert.equal(library.formatTruePeakBadge(0.0), 'TP 0.0 dBTP');
  assert.equal(library.formatTruePeakBadge(0.8), 'TP +0.8 ⚠');
});

test('Pha A & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  // CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});
