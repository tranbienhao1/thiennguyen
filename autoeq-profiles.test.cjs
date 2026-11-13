// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library-utils.js');

test('AutoEQ Headphone Profiles - Library pure utilities', async t => {
  await t.test('listAutoEqProfiles returns all available headphone models', () => {
    const list = library.listAutoEqProfiles();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 8);
    const ids = list.map(item => item.id);
    assert.ok(ids.includes('none'));
    assert.ok(ids.includes('sennheiser-hd600'));
    assert.ok(ids.includes('sennheiser-hd650'));
    assert.ok(ids.includes('ath-m50x'));
    assert.ok(ids.includes('sony-wh1000xm4'));
    assert.ok(ids.includes('beyer-dt770'));
    assert.ok(ids.includes('airpods-pro'));
    assert.ok(ids.includes('hifiman-sundara'));
  });

  await t.test('getAutoEqProfile returns valid profile with safe parameters', () => {
    const p = library.getAutoEqProfile('sennheiser-hd600');
    assert.ok(p);
    assert.equal(p.id, 'sennheiser-hd600');
    assert.equal(p.name, 'Sennheiser HD 600');
    assert.ok(p.preamp <= 0, 'Preamp must be <= 0 dB to avoid digital clipping');
    assert.ok(Array.isArray(p.bands));
    assert.ok(p.bands.length >= 4);

    p.bands.forEach(b => {
      assert.ok(['peaking', 'lowshelf', 'highshelf'].includes(b.type));
      assert.ok(b.frequency >= 20 && b.frequency <= 20000);
      assert.ok(b.gain >= -24 && b.gain <= 24);
      assert.ok(b.q >= 0.1 && b.q <= 18);
    });
  });

  await t.test('getAutoEqProfile handles none and invalid gracefully', () => {
    const none = library.getAutoEqProfile('none');
    assert.ok(none);
    assert.equal(none.bands.length, 0);
    assert.equal(none.preamp, 0);

    const invalid = library.getAutoEqProfile('invalid-headphone-id');
    assert.equal(invalid, null);
  });

  await t.test('calculateAutoEqPreamp calculates safe headroom against max boost', () => {
    const bandsWithBoost = [
      { frequency: 100, gain: 4.5 },
      { frequency: 1000, gain: -2.0 },
      { frequency: 3000, gain: 3.0 }
    ];
    const preamp = library.calculateAutoEqPreamp(bandsWithBoost);
    assert.equal(preamp, -4.5);

    const flatBands = [
      { frequency: 100, gain: -2.0 },
      { frequency: 1000, gain: -5.0 }
    ];
    assert.equal(library.calculateAutoEqPreamp(flatBands), 0);
    assert.equal(library.calculateAutoEqPreamp([]), 0);
  });

  await t.test('formatAutoEqProfile produces clear audiophile summary string', () => {
    const profile = library.getAutoEqProfile('ath-m50x');
    const formatted = library.formatAutoEqProfile(profile);
    assert.ok(formatted.includes('Audio-Technica ATH-M50x'));
    assert.ok(formatted.includes('dB'));
    assert.equal(library.formatAutoEqProfile({ id: 'none' }), 'Không cân chỉnh (Bypass)');
  });

  await t.test('computeSignalPath includes AutoEQ info in DSP stage', () => {
    const track = { title: 'Test Track', format: 'FLAC', sampleRate: 96000, bitDepth: 24 };
    const pathData = library.computeSignalPath(track, {
      autoEqProfile: 'sennheiser-hd600'
    });
    assert.equal(pathData.hasDsp, true);
    const dspStep = pathData.steps.find(s => s.stage === 'dsp');
    assert.ok(dspStep);
    assert.ok(dspStep.description.includes('AutoEQ: Sennheiser HD 600'));
  });
});

test('AutoEQ Headphone Profiles - DOM and Script Integration', async t => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  await t.test('DOM elements exist in #eq-panel', () => {
    assert.ok(html.includes('id="autoeq-select"'), 'Select element #autoeq-select must exist');
    assert.ok(html.includes('id="autoeq-badge"'), 'Badge #autoeq-badge must exist');
    assert.ok(html.includes('id="autoeq-desc"'), 'Description #autoeq-desc must exist');
    assert.ok(html.includes('value="sennheiser-hd600"'), 'Option sennheiser-hd600 must exist');
    assert.ok(html.includes('value="beyer-dt770"'), 'Option beyer-dt770 must exist');
    assert.ok(html.includes('value="sony-wh1000xm4"'), 'Option sony-wh1000xm4 must exist');
  });

  await t.test('Script declares applyAutoEqProfile and autoEqProfile in state', () => {
    assert.ok(html.includes('function applyAutoEqProfile('), 'applyAutoEqProfile must be declared');
    assert.ok(html.includes("autoEqProfile: 'none'"), 'state must initialize autoEqProfile');
    assert.ok(html.includes('nocturne-autoeq-profile'), 'localStorage key nocturne-autoeq-profile must be used');
  });

  await t.test('Audio Graph routing invariant is preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio graph invariant must be strictly preserved'
    );
  });
});
