const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Pha A: STANDARD_EQ_FREQUENCIES contains standard ISO 1/3-octave points', () => {
  assert.ok(Array.isArray(library.STANDARD_EQ_FREQUENCIES));
  assert.equal(library.STANDARD_EQ_FREQUENCIES.length, 31);
  assert.equal(library.STANDARD_EQ_FREQUENCIES[0], 20);
  assert.equal(library.STANDARD_EQ_FREQUENCIES[library.STANDARD_EQ_FREQUENCIES.length - 1], 20000);
});

test('Pha A: sanitizeBiquadFilterParams clamps frequency, gain, Q and protects against Nyquist explosion', () => {
  // Empty or invalid input fallback
  const fallback = library.sanitizeBiquadFilterParams(null);
  assert.equal(fallback.type, 'peaking');
  assert.equal(fallback.frequency, 1000);
  assert.equal(fallback.gain, 0);
  assert.equal(fallback.q, 1);

  // Normal safe band
  const safe = library.sanitizeBiquadFilterParams({ type: 'peaking', frequency: 1000, gain: 4.5, q: 1.5 });
  assert.equal(safe.type, 'peaking');
  assert.equal(safe.frequency, 1000);
  assert.equal(safe.gain, 4.5);
  assert.equal(safe.q, 1.5);

  // Frequency above Nyquist on 44.1kHz context (Nyquist = 22050Hz, maxSafe = 20000Hz or Nyquist-50)
  const overNyquist = library.sanitizeBiquadFilterParams({ frequency: 25000 }, 44100);
  assert.ok(overNyquist.frequency <= 20000);

  // Low context sampleRate (e.g. 32000Hz -> Nyquist = 16000Hz, maxSafe = 15950Hz)
  const lowSampleRate = library.sanitizeBiquadFilterParams({ frequency: 18000 }, 32000);
  assert.ok(lowSampleRate.frequency <= 15950);

  // Extreme gain and Q clamping
  const extreme = library.sanitizeBiquadFilterParams({ gain: 50, q: 99 });
  assert.equal(extreme.gain, 24);
  assert.equal(extreme.q, 18);

  const extremeLow = library.sanitizeBiquadFilterParams({ gain: -80, q: -5, frequency: 5 });
  assert.equal(extremeLow.gain, -24);
  assert.equal(extremeLow.q, 0.1);
  assert.equal(extremeLow.frequency, 20);
});

test('Pha A: calculateBiquadFrequencyResponse evaluates exact digital filter transfer function', () => {
  const Fs = 44100;

  // 1. Peaking filter: +6 dB at 1000 Hz, Q = 1
  const peakBand = { type: 'peaking', frequency: 1000, gain: 6, q: 1 };
  const peakResp = library.calculateBiquadFrequencyResponse(peakBand, [100, 1000, 10000], Fs);
  assert.equal(peakResp.length, 3);
  assert.ok(Math.abs(peakResp[1].gainDb - 6.0) < 0.1, `Peaking gain at f0 should be ~6 dB, got ${peakResp[1].gainDb}`);
  assert.ok(Math.abs(peakResp[0].gainDb) < 0.2, `Peaking gain far below f0 should be ~0 dB, got ${peakResp[0].gainDb}`);
  assert.ok(Math.abs(peakResp[2].gainDb) < 0.2, `Peaking gain far above f0 should be ~0 dB, got ${peakResp[2].gainDb}`);

  // 2. Lowshelf filter: +4 dB at 100 Hz, Q = 0.707
  const shelfBand = { type: 'lowshelf', frequency: 100, gain: 4, q: 0.707 };
  const shelfResp = library.calculateBiquadFrequencyResponse(shelfBand, [30, 100, 3000], Fs);
  assert.ok(shelfResp[0].gainDb >= 3.8, `Lowshelf at 30 Hz should be ~4 dB, got ${shelfResp[0].gainDb}`);
  assert.ok(Math.abs(shelfResp[1].gainDb - 2.0) < 0.2, `Lowshelf at cutoff should be ~2 dB, got ${shelfResp[1].gainDb}`);
  assert.ok(Math.abs(shelfResp[2].gainDb) < 0.1, `Lowshelf at 3000 Hz should be ~0 dB, got ${shelfResp[2].gainDb}`);

  // 3. Highshelf filter: +5 dB at 10000 Hz, Q = 0.707
  const highShelfBand = { type: 'highshelf', frequency: 10000, gain: 5, q: 0.707 };
  const highResp = library.calculateBiquadFrequencyResponse(highShelfBand, [100, 10000, 18000], Fs);
  assert.ok(Math.abs(highResp[0].gainDb) < 0.35, `Highshelf at 100 Hz should be ~0 dB, got ${highResp[0].gainDb}`);
  assert.ok(Math.abs(highResp[1].gainDb - 2.5) < 0.35, `Highshelf at cutoff should be ~2.5 dB, got ${highResp[1].gainDb}`);
  assert.ok(highResp[2].gainDb >= 4.8, `Highshelf at 18000 Hz should be ~5 dB, got ${highResp[2].gainDb}`);

  // 4. Lowpass filter: cutoff 1000 Hz, Q = 0.707
  const lpBand = { type: 'lowpass', frequency: 1000, q: 0.707 };
  const lpResp = library.calculateBiquadFrequencyResponse(lpBand, [100, 1000, 5000], Fs);
  assert.ok(Math.abs(lpResp[0].gainDb) < 0.1, `Lowpass in passband should be ~0 dB, got ${lpResp[0].gainDb}`);
  assert.ok(Math.abs(lpResp[1].gainDb - (-3.0)) < 0.2, `Lowpass at cutoff should be ~-3 dB, got ${lpResp[1].gainDb}`);
  assert.ok(lpResp[2].gainDb < -20, `Lowpass in stopband should be strongly attenuated, got ${lpResp[2].gainDb}`);
});

test('Pha A: calculateCombinedEqCurve calculates cumulative response and accurate compounding headroom', () => {
  // Empty bands -> flat 0 dB
  const flat = library.calculateCombinedEqCurve([]);
  assert.equal(flat.peakBoostDb, 0);
  assert.equal(flat.peakCutDb, 0);
  assert.equal(flat.recommendedPreampDb, 0);

  // Two compounding peaking filters at 1000 Hz (+3 dB each) -> combined boost is ~6 dB!
  const bands = [
    { type: 'peaking', frequency: 1000, gain: 3, q: 1 },
    { type: 'peaking', frequency: 1000, gain: 3, q: 1 },
    { type: 'peaking', frequency: 100, gain: -2.5, q: 1 }
  ];

  const combined = library.calculateCombinedEqCurve(bands);
  assert.ok(Math.abs(combined.peakBoostDb - 6.0) < 0.2, `Combined boost should be ~6 dB, got ${combined.peakBoostDb}`);
  assert.ok(combined.peakCutDb <= -2.0, `Combined cut should be <= -2 dB, got ${combined.peakCutDb}`);
  assert.equal(combined.recommendedPreampDb, -combined.peakBoostDb);

  // formatEqCurveSummary
  const summary = library.formatEqCurveSummary(combined);
  assert.ok(summary.includes('Đỉnh: +6.0 dB'));
  assert.ok(summary.includes('Trũng:'));

  const flatSummary = library.formatEqCurveSummary(flat);
  assert.equal(flatSummary, 'Phẳng (0 dB)');
});

test('Pha A & Engine Invariant: AudioContext Graph Destination & Parametric EQ UI Integration', () => {
  // SUPREME INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination);'),
    'AUDIO ENGINE INVARIANT: crossfeed output MUST connect to context destination'
  );

  // EQ UI markup
  assert.ok(indexHtml.includes('id="eq-curve-summary"'), 'Parametric EQ curve summary element must exist');
  assert.ok(indexHtml.includes('id="eq-curve-detail"'), 'Parametric EQ curve detail readout must exist');

  // Script integration
  assert.ok(indexHtml.includes('library.calculateCombinedEqCurve'), 'applyEq must use calculateCombinedEqCurve');
  assert.ok(indexHtml.includes('library.sanitizeBiquadFilterParams'), 'addEqBand / applyEq must use sanitizeBiquadFilterParams');
});
