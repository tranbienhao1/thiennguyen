'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

function makeMockParam(initial) {
  return {
    value: initial,
    targets: [],
    steps: [],
    setTargetAtTime(v, t, tc) { this.targets.push({ v, t, tc }); },
    setValueAtTime(v, t) { this.steps.push({ v, t }); }
  };
}

function makeMockNode(name) {
  return {
    name,
    connected: [],
    disconnectCalls: 0,
    connect(dest) { this.connected.push(dest); },
    disconnect() { this.disconnectCalls++; this.connected = []; }
  };
}

test('1. rebuildAudioRoutes eliminates Bit-Perfect +6dB double-routing and stays null-safe with setTargetAtTime', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function rebuildAudioRoutes() {');
  const end = html.indexOf('function setupAudio() {', start);
  assert.ok(start !== -1 && end > start, 'rebuildAudioRoutes must exist');
  const src = html.slice(start, end);

  assert.ok(!src.includes('deck.preamp.gain.value ='), 'Never hard-assign deck.preamp.gain.value');
  assert.ok(!src.includes('deck.direct.gain.value ='), 'Never hard-assign deck.direct.gain.value');

  const directAnalyser = makeMockNode('directAnalyser');
  const panner = makeMockNode('panner');
  const destination = makeMockNode('destination');
  const analyser = makeMockNode('analyser');
  const filter = { type: 'peaking', frequency: makeMockParam(350), Q: makeMockParam(1), gain: makeMockParam(0) };
  const deckA = { filters: [filter], preamp: { gain: makeMockParam(1) }, direct: { gain: makeMockParam(0) } };
  const audio = { volume: 0.7 };
  const standbyAudio = { volume: 0.7 };

  const state = {
    context: { currentTime: 5.0, sampleRate: 96000, destination },
    deckA,
    deckB: null, // Verify null-safe iteration when deckB is absent
    bands: [{ type: 'peaking', frequency: 1000, q: 1.4, gain: 3 }],
    directAnalyser,
    panner,
    analyser,
    activeAnalyser: null,
    bitPerfectEnabled: true,
    phaseInvert: false
  };

  const fn = new Function('state', '$', 'rebuildDeckRoute', 'audio', 'standbyAudio', src + '\nreturn rebuildAudioRoutes;')(
    state,
    (id) => (id === 'eq-preamp' ? { value: '0' } : { checked: true }),
    () => {},
    audio,
    standbyAudio
  );

  // Bit-Perfect ON: directAnalyser must be disconnected from panner so direct signal is NOT summed twice!
  fn();
  assert.equal(directAnalyser.disconnectCalls, 1, 'Bit-Perfect must disconnect directAnalyser from downstream');
  assert.equal(directAnalyser.connected.length, 0, 'Bit-Perfect must leave directAnalyser unrouted downstream');
  assert.equal(deckA.preamp.gain.targets[deckA.preamp.gain.targets.length - 1].v, 0);
  assert.equal(deckA.direct.gain.targets[deckA.direct.gain.targets.length - 1].v, 1.0);
  assert.equal(state.activeAnalyser, directAnalyser);
  assert.equal(audio.volume, 1.0);

  // Bit-Perfect OFF: directAnalyser must reconnect to panner
  state.bitPerfectEnabled = false;
  fn();
  assert.deepEqual(directAnalyser.connected, [panner], 'Exiting Bit-Perfect must reconnect directAnalyser to panner');
  assert.equal(state.activeAnalyser, analyser);
});

test('2. applyEq respects state.bitPerfectEnabled without accidentally re-enabling EQ path', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function applyEq() {');
  const end = html.indexOf('const EQ_PRESETS = {', start);
  assert.ok(start !== -1 && end > start, 'applyEq must exist');
  const src = html.slice(start, end);

  const filter = { type: 'peaking', frequency: makeMockParam(1000), Q: makeMockParam(1), gain: makeMockParam(0) };
  const deckA = { filters: [filter], preamp: { gain: makeMockParam(0) }, direct: { gain: makeMockParam(1) } };
  const state = {
    context: { currentTime: 8.0, sampleRate: 48000 },
    deckA,
    deckB: null,
    bands: [{ type: 'peaking', frequency: 1000, q: 1, gain: 4 }],
    analyser: { name: 'analyser' },
    directAnalyser: { name: 'directAnalyser' },
    activeAnalyser: null,
    bitPerfectEnabled: true,
    phaseInvert: true
  };
  const dom = {
    'eq-preamp': { value: '0' },
    'eq-headroom': { textContent: '', className: '' },
    'eq-enabled': { checked: true }
  };

  const applyEq = new Function('state', '$', 'rebuildAudioRoutes', src + '\nreturn applyEq;')(
    state,
    (id) => dom[id] || null,
    () => {}
  );
  applyEq();

  assert.equal(deckA.preamp.gain.targets[0].v, 0, 'Preamp must remain muted (0) during Bit-Perfect mode');
  assert.equal(deckA.direct.gain.targets[0].v, 1, 'Direct unity gain (+1) must remain active during Bit-Perfect mode');
  assert.equal(state.activeAnalyser, state.directAnalyser, 'Active analyser must stay on directAnalyser in Bit-Perfect mode');
});

test('3. Click-free DSP: applyRoomAcoustics & applyDsdUltrasonicFilter ramp with setTargetAtTime', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  const roomStart = html.indexOf('function applyRoomAcoustics(profileKey, wetLevel) {');
  const roomEnd = html.indexOf('function updateRoomAcousticsUi() {', roomStart);
  assert.ok(roomStart !== -1 && roomEnd > roomStart);
  const roomSrc = html.slice(roomStart, roomEnd);

  const dryGain = makeMockParam(1.0);
  const wetGain = makeMockParam(0.0);
  const roomState = {
    context: { currentTime: 3.25, sampleRate: 48000 },
    roomAcousticNodes: { dryGain: { gain: dryGain }, wetGain: { gain: wetGain }, convolver: null },
    tracks: [],
    currentId: null
  };
  const applyRoomAcoustics = new Function('state', 'library', 'updateRoomAcousticsUi', roomSrc + '\nreturn applyRoomAcoustics;')(
    roomState,
    {
      ROOM_ACOUSTIC_PROFILES: { studio: { id: 'studio' }, bypass: { id: 'bypass' } },
      clampAcousticWet: (w) => w,
      calculateAcousticWetDry: () => ({ dryGain: 0.85, wetGain: 0.35 })
    },
    () => {}
  );
  applyRoomAcoustics('studio', 0.35);

  assert.equal(dryGain.steps.length, 0, 'Room dryGain must not hard-step via setValueAtTime');
  assert.equal(wetGain.steps.length, 0, 'Room wetGain must not hard-step via setValueAtTime');
  assert.equal(dryGain.targets.length, 1);
  assert.equal(dryGain.targets[0].v, 0.85);
  assert.equal(dryGain.targets[0].tc, 0.015);
  assert.equal(wetGain.targets.length, 1);
  assert.equal(wetGain.targets[0].v, 0.35);

  const dsdStart = html.indexOf('function applyDsdUltrasonicFilter(filterKey) {');
  const dsdEnd = html.indexOf('function updateDsdUltrasonicUi(filter) {', dsdStart);
  assert.ok(dsdStart !== -1 && dsdEnd > dsdStart);
  const dsdSrc = html.slice(dsdStart, dsdEnd);

  const freqParam = makeMockParam(23760);
  const qParam = makeMockParam(0.707);
  const dsdState = {
    context: { currentTime: 6.0, sampleRate: 96000 },
    dsdUltrasonicNodes: { filter: { frequency: freqParam, Q: qParam } },
    tracks: [],
    currentId: null
  };
  const applyDsdUltrasonicFilter = new Function('state', 'library', 'updateDsdUltrasonicUi', dsdSrc + '\nreturn applyDsdUltrasonicFilter;')(
    dsdState,
    {
      getDsdUltrasonicFilter: (k) => k === 'sacd_30k'
        ? { id: 'sacd_30k', cutoffHz: 30000, qFactor: 0.85 }
        : { id: 'bypass', cutoffHz: 0, qFactor: 0.707 }
    },
    () => {}
  );
  applyDsdUltrasonicFilter('sacd_30k');
  assert.equal(freqParam.targets.length, 1);
  assert.equal(freqParam.targets[0].v, 30000);
  assert.equal(freqParam.targets[0].tc, 0.015);
  assert.equal(qParam.targets[0].v, 0.85);
  assert.equal(freqParam.value, 23760, 'Filter frequency must not hard-assign .value when setTargetAtTime exists');

  applyDsdUltrasonicFilter('bypass');
  assert.equal(qParam.targets[1].v, 0.707, 'Bypass must smoothly reset Q back to 0.707');
});

test('4. applyToneControls avoids click-inducing redundant disconnect/connect & setupAudio restores tone + deduplicates visibility listener', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function applyToneControls() {');
  const end = html.indexOf('function setToneBass(value) {', start);
  assert.ok(start !== -1 && end > start);
  const src = html.slice(start, end);

  const crossfeedOut = makeMockNode('crossfeedOut');
  const destination = makeMockNode('destination');
  const toneInput = makeMockNode('toneInput');
  const toneNodes = {
    bass: { gain: makeMockParam(0) },
    treble: { gain: makeMockParam(0) },
    input: toneInput,
    _routedToTone: false
  };
  const state = {
    context: { currentTime: 1.0, destination },
    toneNodes,
    crossfeedNodes: { output: crossfeedOut },
    toneBass: 2.0,
    toneTreble: 0,
    tracks: [],
    currentId: null
  };
  const applyToneControls = new Function('state', '$', 'library', src + '\nreturn applyToneControls;')(
    state,
    () => null,
    { formatToneGain: String, formatToneSummary: () => '' }
  );

  // First non-zero tone: wires crossfeedOut -> toneInput (1 disconnect)
  applyToneControls();
  assert.equal(crossfeedOut.disconnectCalls, 1);
  assert.deepEqual(crossfeedOut.connected, [toneInput]);

  // Continuous slider drag while still non-zero: ZERO disconnect/connect dropouts!
  state.toneBass = 3.5;
  applyToneControls();
  state.toneTreble = 1.5;
  applyToneControls();
  assert.equal(crossfeedOut.disconnectCalls, 1, 'Dragging tone sliders must not repeatedly disconnect/reconnect live audio graph');

  // Returning to flat (0 dB): switches cleanly back to direct destination (2nd disconnect)
  state.toneBass = 0;
  state.toneTreble = 0;
  applyToneControls();
  assert.equal(crossfeedOut.disconnectCalls, 2);
  assert.deepEqual(crossfeedOut.connected, [destination]);

  // Verify setupAudio invokes applyToneControls() and guards visibilitychange listener
  assert.ok(html.includes('if (state.toneNodes && typeof applyToneControls === \'function\') {\n        applyToneControls();\n      }'), 'setupAudio must restore persisted tone routing after createToneNodes');
  assert.ok(html.includes('if (!state._audioVisibilityBound) {'), 'setupAudio must not leak duplicate visibilitychange listeners on sample-rate recreation');
});

test('5. Version sync v3.9.17 (versionCode 71), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const assetSw = fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.17';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.17';"));
  assert.ok(gradle.includes('versionCode = 71'));
  assert.ok(gradle.includes('versionName = "3.9.17"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.equal(html, assetHtml);
  assert.equal(sw, assetSw);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
