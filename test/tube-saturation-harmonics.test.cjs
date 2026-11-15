const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');

test('Pha A: Vacuum Tube Saturation Harmonics & Analog Warmth Emulation Test Suite', async (t) => {
  await t.test('1. TUBE_EMULATION_PROFILES registry and lookups', () => {
    assert.ok(library.TUBE_EMULATION_PROFILES, 'TUBE_EMULATION_PROFILES must exist');
    assert.ok(library.TUBE_EMULATION_PROFILES.off);
    assert.ok(library.TUBE_EMULATION_PROFILES.warm_triode);
    assert.ok(library.TUBE_EMULATION_PROFILES.vintage_el34);
    assert.ok(library.TUBE_EMULATION_PROFILES.modern_kt88);

    assert.equal(library.getTubeEmulationProfile('warm_triode').badge, '300B');
    assert.equal(library.getTubeEmulationProfile('vintage_el34').badge, 'EL34');
    assert.equal(library.getTubeEmulationProfile('modern_kt88').badge, 'KT88');
    assert.equal(library.getTubeEmulationProfile('unknown_key').id, 'off');

    const all = library.listTubeEmulationProfiles();
    assert.equal(all.length, 4);
  });

  await t.test('2. generateTubeTransferCurve produces soft-saturation curve with even harmonics', () => {
    assert.equal(typeof library.generateTubeTransferCurve, 'function');

    // Bypass / Off: exact linear ramp
    const linearCurve = library.generateTubeTransferCurve(1024, 'off');
    assert.equal(linearCurve.length, 1024);
    assert.ok(Math.abs(linearCurve[0] - (-1)) < 0.001);
    assert.ok(Math.abs(linearCurve[511.5] || linearCurve[512]) < 0.01);
    assert.ok(Math.abs(linearCurve[1023] - 1) < 0.001);

    // Warm Triode (300B): non-linear transfer curve with second harmonic asymmetry
    const triodeCurve = library.generateTubeTransferCurve(1024, 'warm_triode');
    assert.equal(triodeCurve.length, 1024);
    assert.ok(triodeCurve instanceof Float32Array);

    // Ensure all points stay within [-1.0, +1.0]
    for (let i = 0; i < triodeCurve.length; i++) {
      assert.ok(triodeCurve[i] >= -1.0 && triodeCurve[i] <= 1.0, `curve[${i}] must be in [-1, 1]`);
    }

    // Verify non-linearity compared to linear ramp at mid-positive range (e.g. index 768 = +0.5)
    const midIdx = 768;
    assert.notEqual(triodeCurve[midIdx], linearCurve[midIdx]);
  });

  await t.test('3. formatTubeEmulationSummary produces localized telemetry summary', () => {
    assert.equal(typeof library.formatTubeEmulationSummary, 'function');

    const offText = library.formatTubeEmulationSummary('off');
    assert.ok(offText.includes('Tắt'));
    assert.ok(offText.includes('Bit-Perfect'));

    const triodeText = library.formatTubeEmulationSummary('warm_triode');
    assert.ok(triodeText.includes('Triode 300B'));
    assert.ok(triodeText.includes('Bão hòa'));
    assert.ok(triodeText.includes('Hòa âm'));
  });

  await t.test('4. computeSignalPath reflects Tube Warmth in Roon Signal Path', () => {
    const fakeTrack = { id: 't1', title: 'Audiophile Track', format: 'FLAC', bitDepth: 24, sampleRate: 96000 };

    // When off: Bit-Perfect direct
    const directPath = library.computeSignalPath(fakeTrack, {
      activeZone: { id: 'zone_dsp' },
      isEnhanced: false,
      tubeEmulationProfile: 'off'
    });
    const dspStepDirect = directPath.steps.find(s => s.stage === 'dsp');
    assert.ok(!dspStepDirect.description.includes('Tube Warmth'));

    // When warm_triode active: appears in DSP stage
    const tubePath = library.computeSignalPath(fakeTrack, {
      activeZone: { id: 'zone_dsp' },
      isEnhanced: true,
      tubeEmulationProfile: 'warm_triode'
    });
    const dspStepTube = tubePath.steps.find(s => s.stage === 'dsp');
    assert.ok(dspStepTube.description.includes('Tube Warmth'));
    assert.ok(dspStepTube.description.includes('300B'));
  });

  await t.test('5. exportAppConfiguration & mergeRestoredConfiguration preserves tubeEmulationProfile', () => {
    const exported = library.exportAppConfiguration({
      tubeEmulationProfile: 'vintage_el34'
    });
    assert.equal(exported.settings.tubeEmulationProfile, 'vintage_el34');

    const targetState = {};
    const res = library.mergeRestoredConfiguration(targetState, exported);
    assert.equal(targetState.tubeEmulationProfile, 'vintage_el34');
    assert.ok(res.appliedSettingsCount > 0);
  });

  await t.test('6. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // UI elements
    assert.ok(indexHtml.includes('id="tube-emulation-select"'), 'index.html must contain #tube-emulation-select');
    assert.ok(indexHtml.includes('id="tube-emulation-badge"'), 'index.html must contain #tube-emulation-badge');
    assert.ok(indexHtml.includes('id="tube-emulation-desc"'), 'index.html must contain #tube-emulation-desc');

    // Integration of helper functions
    assert.ok(indexHtml.includes('createTubeEmulationNodes'), 'index.html must define createTubeEmulationNodes');
    assert.ok(indexHtml.includes('applyTubeEmulation'), 'index.html must define applyTubeEmulation');

    // CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});
