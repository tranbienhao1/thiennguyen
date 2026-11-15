const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha A: PARAMETRIC_EQ_PRESETS defines 6 audiophile sound signatures with valid biquad parameters', () => {
  const presets = library.PARAMETRIC_EQ_PRESETS;
  assert.ok(presets, 'PARAMETRIC_EQ_PRESETS must exist');

  const expectedKeys = [
    'peq-sub-bass-slam',
    'peq-vocal-clarity',
    'peq-acoustic-intimate',
    'peq-analog-tube',
    'peq-de-esser',
    'peq-orchestral'
  ];

  for (const key of expectedKeys) {
    const preset = presets[key];
    assert.ok(preset, `Preset ${key} must exist`);
    assert.ok(preset.name, `Preset ${key} must have a name`);
    assert.ok(preset.description, `Preset ${key} must have description`);
    assert.ok(Number.isFinite(preset.preamp), `Preset ${key} must have numeric preamp`);
    assert.ok(Array.isArray(preset.bands) && preset.bands.length > 0, `Preset ${key} must have bands`);

    for (const band of preset.bands) {
      assert.ok(['peaking', 'lowshelf', 'highshelf'].includes(band.type), `Band type ${band.type} valid`);
      assert.ok(band.frequency >= 20 && band.frequency <= 20000, `Freq ${band.frequency} in audible range`);
      assert.ok(band.gain >= -24 && band.gain <= 24, `Gain ${band.gain} within safe range`);
      assert.ok(band.q >= 0.1 && band.q <= 18, `Q ${band.q} within biquad range`);
    }
  }
});

test('Pha A: getParametricEqPreset, listParametricEqPresets & formatParametricEqSummary validate cleanly', () => {
  // 1. List presets
  const list = library.listParametricEqPresets();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 6);
  assert.ok(list.some(p => p.id === 'peq-vocal-clarity'));

  // 2. Get preset with or without prefix
  const vocal = library.getParametricEqPreset('vocal-clarity');
  assert.ok(vocal);
  assert.equal(vocal.id, 'peq-vocal-clarity');
  assert.equal(vocal.name, 'Vocal Clarity & Air');
  assert.ok(vocal.bands.length >= 3);

  // 3. Format summary
  const summary = library.formatParametricEqSummary(vocal);
  assert.match(summary, /Vocal Clarity & Air · \d+ dải · Preamp -3\.0 dB/);

  // 4. Invalid preset lookup
  assert.equal(library.getParametricEqPreset('non-existent'), null);
  assert.equal(library.getParametricEqPreset(null), null);
});

test('Pha A: calculatePresetAutoPreamp computes safe negative headroom to prevent digital clipping', () => {
  const bands = [
    { type: 'lowshelf', frequency: 35, gain: 4.5, q: 0.71 },
    { type: 'peaking', frequency: 2800, gain: 2.0, q: 1.8 }
  ];

  const preamp = library.calculatePresetAutoPreamp(bands);
  assert.equal(preamp, -4.5, 'Preamp must compensate maximum positive boost');

  const flatBands = [
    { type: 'peaking', frequency: 1000, gain: -2.0, q: 1.0 }
  ];
  assert.equal(library.calculatePresetAutoPreamp(flatBands), 0, 'No positive boost means 0dB preamp');
  assert.equal(library.calculatePresetAutoPreamp([]), 0);
});

test('Pha A: calculateCombinedEqCurve calculates coherent cumulative response for PEQ presets', () => {
  const subBass = library.getParametricEqPreset('peq-sub-bass-slam');
  const curve = library.calculateCombinedEqCurve(subBass.bands);

  assert.ok(Array.isArray(curve.frequencies));
  assert.ok(Array.isArray(curve.curve));
  assert.equal(curve.frequencies.length, curve.curve.length);
  assert.ok(curve.frequencies.length >= 20);

  // All values must be valid numbers (no NaN or Infinity)
  for (const point of curve.curve) {
    assert.ok(Number.isFinite(point.gainDb), 'Gain response must be finite');
    assert.ok(Number.isFinite(point.frequency), 'Frequency must be finite');
  }

  // Peak boost must be positive for sub-bass slam
  assert.ok(curve.peakBoostDb > 0, 'Sub-bass slam has positive peak boost');
  assert.ok(curve.recommendedPreampDb <= 0, 'Recommended preamp must be negative or zero');
});

test('Pha A & Audio Engine Invariant: UI Integration & Audio Graph Invariant Preservation', () => {
  // 1. UI Elements in index.html
  assert.ok(indexHtml.includes('label="── Trường phái âm học PEQ (Parametric EQ Presets) ──"'));
  assert.ok(indexHtml.includes('value="peq-sub-bass-slam"'));
  assert.ok(indexHtml.includes('value="peq-vocal-clarity"'));
  assert.ok(indexHtml.includes('value="peq-acoustic-intimate"'));
  assert.ok(indexHtml.includes('value="peq-analog-tube"'));
  assert.ok(indexHtml.includes('value="peq-de-esser"'));
  assert.ok(indexHtml.includes('value="peq-orchestral"'));

  // 2. CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});
