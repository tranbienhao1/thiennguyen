'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Pha A: Sub-Bass Phase Alignment & Analog Bass Exciter Harmonic Generator', async (t) => {

  await t.test('1. SUB_BASS_PHASE_PROFILES registry and profile lookups', () => {
    assert.ok(lib.SUB_BASS_PHASE_PROFILES, 'SUB_BASS_PHASE_PROFILES must exist');
    assert.ok(lib.SUB_BASS_PHASE_PROFILES.bypass, 'bypass profile exists');
    assert.ok(lib.SUB_BASS_PHASE_PROFILES.tight_45, 'tight_45 profile exists');
    assert.ok(lib.SUB_BASS_PHASE_PROFILES.deep_90, 'deep_90 profile exists');
    assert.ok(lib.SUB_BASS_PHASE_PROFILES.analog_exciter, 'analog_exciter profile exists');

    const tight = lib.getSubBassPhaseProfile('tight_45');
    assert.equal(tight.id, 'tight_45');
    assert.equal(tight.phaseShiftDeg, 45);
    assert.equal(tight.cutoffHz, 65);
    assert.equal(tight.badge, 'PHASE +45°');

    const deep = lib.getSubBassPhaseProfile('deep_90');
    assert.equal(deep.id, 'deep_90');
    assert.equal(deep.phaseShiftDeg, 90);
    assert.equal(deep.cutoffHz, 45);

    const fallback = lib.getSubBassPhaseProfile('unknown_profile');
    assert.equal(fallback.id, 'bypass');

    const allProfiles = lib.listSubBassPhaseProfiles();
    assert.ok(Array.isArray(allProfiles));
    assert.ok(allProfiles.length >= 4);
  });

  await t.test('2. calculateSubBassPhaseParams calculates phase, cutoff, and exciter drive', () => {
    const bypassParams = lib.calculateSubBassPhaseParams('bypass');
    assert.equal(bypassParams.isActive, false);
    assert.equal(bypassParams.phaseShiftDeg, 0);
    assert.equal(bypassParams.exciterDrive, 0);

    const tightParams = lib.calculateSubBassPhaseParams('tight_45', { intensity: 1.2 });
    assert.equal(tightParams.isActive, true);
    assert.equal(tightParams.phaseShiftDeg, 45);
    assert.equal(tightParams.cutoffHz, 65);
    assert.ok(tightParams.exciterDrive > 0.2);

    const deepParams = lib.calculateSubBassPhaseParams('deep_90');
    assert.equal(deepParams.isActive, true);
    assert.equal(deepParams.phaseShiftDeg, 90);
    assert.equal(deepParams.cutoffHz, 45);
  });

  await t.test('3. generateBassExciterTransferCurve creates bounded Float32Array transfer curve', () => {
    const curve = lib.generateBassExciterTransferCurve(0.4, 256);
    assert.ok(curve instanceof Float32Array);
    assert.equal(curve.length, 256);

    // Bounded between -1.0 and +1.0
    for (let i = 0; i < curve.length; i++) {
      assert.ok(curve[i] >= -1.0 && curve[i] <= 1.0, `Value at ${i} should be within [-1, 1], got ${curve[i]}`);
    }

    // Monotonic soft-tanh behavior near origin
    const mid = Math.floor(curve.length / 2);
    assert.ok(curve[mid - 1] < curve[mid + 1]);

    // Zero drive produces linear transfer curve
    const linearCurve = lib.generateBassExciterTransferCurve(0, 256);
    assert.equal(Math.round(linearCurve[0] * 100) / 100, -1.0);
    assert.equal(Math.round(linearCurve[linearCurve.length - 1] * 100) / 100, 1.0);
  });

  await t.test('4. formatSubBassPhaseTelemetry formats descriptive localized string', () => {
    const bypassTel = lib.formatSubBassPhaseTelemetry('bypass');
    assert.ok(bypassTel.includes('Bypass'));
    assert.ok(bypassTel.includes('Bit-Perfect'));

    const tightTel = lib.formatSubBassPhaseTelemetry('tight_45');
    assert.ok(tightTel.includes('+45°'));
    assert.ok(tightTel.includes('65 Hz'));

    const deepTel = lib.formatSubBassPhaseTelemetry('deep_90');
    assert.ok(deepTel.includes('+90°'));
    assert.ok(deepTel.includes('45 Hz'));
  });

  await t.test('5. exportAppConfiguration and mergeRestoredConfiguration preserve subBassPhaseProfile', () => {
    const exported = lib.exportAppConfiguration({
      subBassPhaseProfile: 'deep_90',
      favorites: new Set(),
      trackRatings: {}
    });
    assert.ok(exported.settings);
    assert.equal(exported.settings.subBassPhaseProfile, 'deep_90');

    const targetState = { subBassPhaseProfile: 'bypass' };
    const merged = lib.mergeRestoredConfiguration(targetState, exported);
    assert.equal(targetState.subBassPhaseProfile, 'deep_90');
    assert.ok(merged.appliedSettingsCount >= 1);
  });

  await t.test('6. DOM integration in index.html contains UI controls and event bindings', () => {
    assert.ok(indexHtml.includes('id="sub-bass-phase-select"'), 'index.html must have #sub-bass-phase-select');
    assert.ok(indexHtml.includes('id="sub-bass-phase-badge"'), 'index.html must have #sub-bass-phase-badge');
    assert.ok(indexHtml.includes('id="sub-bass-phase-desc"'), 'index.html must have #sub-bass-phase-desc');
    assert.ok(indexHtml.includes('applySubBassPhaseProfile'), 'index.html must define applySubBassPhaseProfile');
    assert.ok(indexHtml.includes('updateSubBassPhaseUi'), 'index.html must define updateSubBassPhaseUi');
    assert.ok(indexHtml.includes('createSubBassPhaseNodes'), 'index.html must define createSubBassPhaseNodes');
  });

  await t.test('7. Web Audio Graph Invariant: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: crossfeedNodes output must connect directly to context.destination'
    );
  });
});
