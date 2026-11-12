'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Signal Path (Roon-style) — computeSignalPath pure logic tests', () => {
  assert.equal(typeof lib.computeSignalPath, 'function', 'computeSignalPath should be exported by NocturneLibrary');

  // Test 1: Empty / null track
  const empty = lib.computeSignalPath(null);
  assert.equal(empty.qualityTier, 'standard');
  assert.equal(empty.hasDsp, false);
  assert.equal(empty.steps.length, 0);

  // Test 2: Standard FLAC 44.1kHz/16-bit Bit-Perfect (no DSP)
  const cdFlac = { format: 'FLAC', sampleRate: 44100, bitDepth: 16, channels: 2, source: 'local' };
  const cdPath = lib.computeSignalPath(cdFlac, {
    contextRate: 44100,
    eqEnabled: false,
    stereoBalance: 0,
    crossfeedEnabled: false
  });
  assert.equal(cdPath.qualityTier, 'lossless');
  assert.equal(cdPath.qualityLabel, 'LOSSLESS');
  assert.equal(cdPath.hasDsp, false);
  assert.equal(cdPath.steps.length, 4);
  assert.equal(cdPath.steps[0].stage, 'source');
  assert.equal(cdPath.steps[1].stage, 'decode');
  assert.equal(cdPath.steps[2].stage, 'dsp');
  assert.equal(cdPath.steps[3].stage, 'output');
  assert.equal(cdPath.steps[2].badge, 'Bit-perfect');
  assert.equal(cdPath.steps[2].isEnhanced, false);

  // Test 3: Hi-Res FLAC 96kHz/24-bit with EQ, Balance & Crossfeed (Enhanced DSP)
  const hiResFlac = { format: 'FLAC', sampleRate: 96000, bitDepth: 24, channels: 2, source: 'google' };
  const dspPath = lib.computeSignalPath(hiResFlac, {
    contextRate: 48000,
    eqEnabled: true,
    eqPreset: 'bass',
    eqPresetLabels: { bass: 'Bass mạnh' },
    eqPreamp: -2.5,
    stereoBalance: -0.15,
    crossfeedEnabled: true,
    crossfeedAmount: 0.35
  });
  assert.equal(dspPath.qualityTier, 'highres');
  assert.equal(dspPath.qualityLabel, 'HI-RES · ENHANCED');
  assert.equal(dspPath.hasDsp, true);
  assert.equal(dspPath.steps[2].isEnhanced, true);
  assert.ok(dspPath.steps[2].description.includes('Bass mạnh'));
  assert.ok(dspPath.steps[2].description.includes('Preamp -2.5 dB'));
  assert.ok(dspPath.steps[2].description.includes('Trái 15%'));
  assert.ok(dspPath.steps[2].description.includes('35%'));

  // Test 4: DSD128 DSF track
  const dsdTrack = {
    isDsd: true,
    format: 'DSF',
    dsdMultiplier: 128,
    sampleRate: 5644800,
    channels: 2,
    source: 'local'
  };
  const dsdPath = lib.computeSignalPath(dsdTrack, {
    contextRate: 44100,
    dsdOutputRate: 88200,
    dsdOutputDepth: 24
  });
  assert.equal(dsdPath.qualityTier, 'dsd');
  assert.equal(dsdPath.qualityLabel, 'DSD');
  assert.ok(dsdPath.steps[0].description.includes('DSD128'));
  assert.equal(dsdPath.steps[1].badge, 'DSD → PCM');
  assert.ok(dsdPath.steps[1].description.includes('88.2 kHz'));
  assert.ok(dsdPath.steps[1].description.includes('24-bit'));
});

test('Signal Path (Roon-style) — UI markup and script integration tests', () => {
  // Verify HTML markup elements exist
  assert.ok(html.includes('id="signal-path-badge"'), 'HTML should contain #signal-path-badge element');
  assert.ok(html.includes('id="toggle-signal-path"'), 'HTML should contain #toggle-signal-path button');
  assert.ok(html.includes('id="room-signal-chain"'), 'HTML should contain #room-signal-chain container');

  // Verify script helpers and integration
  assert.ok(html.includes('function renderSignalPathChain(track)'), 'index.html should define renderSignalPathChain helper');
  assert.ok(html.includes('renderSignalPathChain(track)'), 'renderRoomSignal should invoke renderSignalPathChain');
  assert.ok(html.includes("$('toggle-signal-path').addEventListener('click'"), 'toggle-signal-path button should have a click listener');
});

console.log('Signal Path (Roon-style) unit & integration tests passed.');
