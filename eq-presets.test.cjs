'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.match(html, /id="eq-preset"/, 'EQ panel should offer a preset selector');
for (const preset of ['flat', 'bass', 'treble', 'vocal', 'rock', 'jazz', 'custom']) {
  assert.ok(html.includes(`value="${preset}"`), `EQ preset selector should offer ${preset}`);
}
assert.ok(appCode.includes("$('eq-preset').addEventListener('change'"), 'Changing the EQ preset should apply it');
assert.ok(appCode.includes("localStorage.setItem('nocturne-eq-preset'"), 'The chosen EQ preset should persist');
assert.ok(appCode.includes("localStorage.getItem('nocturne-eq-preset')"), 'The saved EQ preset should restore on load');
assert.ok(appCode.includes("presetSelect.value = 'custom'"), 'Manually editing a band should mark the preset as custom');

const presetsStart = appCode.indexOf('const EQ_PRESETS = {');
assert.ok(presetsStart >= 0, 'EQ presets should exist for regression checks');
const applyStart = appCode.indexOf('function applyEqPreset(name) {', presetsStart);
assert.ok(applyStart > presetsStart, 'eqPresetBands implementation should exist for regression checks');
const addStart = appCode.indexOf('function addEqBand(values = {}) {', applyStart);
assert.ok(addStart > applyStart, 'applyEqPreset implementation should exist for regression checks');
const presetsAndBands = appCode.slice(presetsStart, applyStart);
const applySource = appCode.slice(applyStart, addStart);

function buildPresetFns({state, renderEqBands, applyEq, storage, select} = {}) {
  const calls = {rendered: 0, applied: 0, stored: {}};
  const store = storage || {setItem: (key, value) => { calls.stored[key] = value; }, getItem: () => null};
  const stateStub = state || {bands: [], bandSerial: 0};
  const selectStub = select || {value: 'flat'};
  const factory = new Function('state', 'renderEqBands', 'applyEq', 'localStorage', '$', `${presetsAndBands}\n${applySource}\nreturn {eqPresetBands, applyEqPreset};`);
  const fns = factory(stateStub, renderEqBands || (() => calls.rendered++), applyEq || (() => calls.applied++), store, () => selectStub);
  return {fns, calls, stateStub, selectStub};
}

const {fns} = buildPresetFns();
const presetNames = ['flat', 'bass', 'treble', 'vocal', 'rock', 'jazz'];
for (const name of presetNames) {
  const bands = fns.eqPresetBands(name);
  assert.equal(bands.length, 5, `${name} preset should have exactly 5 bands`);
  for (const band of bands) {
    assert.ok(['peaking', 'lowshelf', 'highshelf'].includes(band.type), `${name} bands should use a supported BiquadFilter type`);
    assert.ok(band.frequency >= 20 && band.frequency <= 20000, `${name} band frequencies should stay in the audible range`);
    assert.ok(band.gain >= -24 && band.gain <= 24, `${name} band gains should stay within the EQ headroom limits`);
    assert.ok(band.q >= 0.1 && band.q <= 18, `${name} band Q values should stay within the UI limits`);
  }
}
assert.deepEqual(fns.eqPresetBands('flat').map(band => band.gain), [0, 0, 0, 0, 0], 'Flat preset should leave every band at 0 dB');
assert.equal(fns.eqPresetBands('bass')[0].gain, 6, 'Bass preset should boost the 60 Hz low shelf');
assert.equal(fns.eqPresetBands('bass')[0].type, 'lowshelf', 'Bass preset should boost with a low shelf');
assert.equal(fns.eqPresetBands('treble')[4].gain, 5, 'Treble preset should boost the 12 kHz high shelf');
assert.equal(fns.eqPresetBands('treble')[4].type, 'highshelf', 'Treble preset should boost with a high shelf');
assert.ok(fns.eqPresetBands('vocal')[3].gain >= fns.eqPresetBands('vocal')[0].gain, 'Vocal preset should favour the presence band over the low shelf');
assert.ok(presetNames.every(name => Math.max(...fns.eqPresetBands(name).map(band => band.gain)) <= 6), 'No preset should boost more than 6 dB so the preamp headroom guard stays effective');
assert.equal(fns.eqPresetBands('unknown'), null, 'An unknown preset name should return null instead of inventing bands');
assert.equal(fns.eqPresetBands('custom'), null, 'The custom marker is not a preset and should not resolve to bands');
assert.equal(fns.eqPresetBands(null), null, 'A null preset name should return null');
assert.equal(fns.eqPresetBands(42), null, 'A non-string preset name should return null');
const first = fns.eqPresetBands('rock');
first[0].gain = 99;
assert.equal(fns.eqPresetBands('rock')[0].gain, 5, 'Preset bands should be deep copies so editing a result cannot corrupt the preset table');

const fnStart = appCode.indexOf('function eqPresetBands(name) {');
const fnSource = appCode.slice(fnStart, applyStart);
const clamped = new Function('EQ_PRESETS', `${fnSource}\nreturn eqPresetBands;`)({evil: [{type: 'notch', frequency: 99999, gain: 99, q: 99}]});
assert.deepEqual(clamped('evil'), [{type: 'peaking', frequency: 20000, gain: 24, q: 18}], 'Out-of-range preset values should clamp to the supported BiquadFilter ranges');

const applied = buildPresetFns();
assert.equal(applied.fns.applyEqPreset('jazz'), true, 'Applying a known preset should succeed');
assert.equal(applied.stateStub.bands.length, 5, 'Applying a preset should replace the band list with 5 bands');
assert.deepEqual(applied.stateStub.bands.map(band => band.id), [1, 2, 3, 4, 5], 'Applied preset bands should get fresh sequential ids');
assert.equal(applied.calls.rendered, 1, 'Applying a preset should re-render the band rows');
assert.equal(applied.calls.applied, 1, 'Applying a preset should push the new gains to the BiquadFilters');
assert.equal(applied.calls.stored['nocturne-eq-preset'], 'jazz', 'Applying a preset should persist its name');
assert.equal(applied.selectStub.value, 'jazz', 'Applying a preset should show its name in the selector');
assert.deepEqual(applied.stateStub.bands.map(band => band.gain), fns.eqPresetBands('jazz').map(band => band.gain), 'Applied bands should match the preset definition');

const rejected = buildPresetFns();
rejected.stateStub.bands = [{id: 7, type: 'peaking', frequency: 1000, gain: 2, q: 1}];
rejected.stateStub.bandSerial = 7;
assert.equal(rejected.fns.applyEqPreset('unknown'), false, 'Applying an unknown preset should fail');
assert.equal(rejected.fns.applyEqPreset('custom'), false, 'Applying the custom marker should fail');
assert.equal(rejected.stateStub.bands.length, 1, 'A failed preset apply should leave the current bands untouched');
assert.equal(rejected.stateStub.bandSerial, 7, 'A failed preset apply should not consume band ids');
assert.equal(rejected.calls.rendered, 0, 'A failed preset apply should not re-render');
assert.equal(rejected.calls.applied, 0, 'A failed preset apply should not touch the audio chain');
assert.deepEqual(rejected.calls.stored, {}, 'A failed preset apply should not persist anything');
