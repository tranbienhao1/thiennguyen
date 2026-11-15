const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');

test('Pha B — STAGE_AURA_PRESETS registry and lookups', () => {
  assert.ok(lib.STAGE_AURA_PRESETS, 'STAGE_AURA_PRESETS must exist');
  const presets = lib.listStageAuraPresets();
  assert.equal(presets.length, 4, 'Must have 4 stage aura presets');

  const ids = presets.map(p => p.id);
  assert.ok(ids.includes('club-laser'));
  assert.ok(ids.includes('lounge-ambient'));
  assert.ok(ids.includes('studio-monitor'));
  assert.ok(ids.includes('psychedelic-wave'));

  const club = lib.getStageAuraPreset('club-laser');
  assert.equal(club.id, 'club-laser');
  assert.equal(club.pulseExpansion, 1.12);

  const fallback = lib.getStageAuraPreset('non-existent');
  assert.equal(fallback.id, 'club-laser', 'Fallback must be club-laser');
});

test('Pha B — calculateMultiBandStrobe handles energy and raw frequency arrays', () => {
  // Test 1: High bass energy triggers club strobe
  const highBassEnergy = { bass: 0.85, vocal: 0.2, treble: 0.1, isBeatPulse: true };
  const strobe1 = lib.calculateMultiBandStrobe(highBassEnergy, {}, { preset: 'club-laser' });
  assert.equal(strobe1.isStrobeTriggered, true);
  assert.ok(strobe1.bassIntensity > 0.6);
  assert.equal(strobe1.dominantBand, 'bass');
  assert.ok(strobe1.bassPulseScale > 1.05);

  // Test 2: High vocal / acoustic energy triggers vocal ripple
  const highVocalEnergy = { bass: 0.15, vocal: 0.75, treble: 0.2, isBeatPulse: false };
  const strobe2 = lib.calculateMultiBandStrobe(highVocalEnergy, {}, { preset: 'lounge-ambient' });
  assert.equal(strobe2.isStrobeTriggered, true);
  assert.ok(strobe2.vocalIntensity > 0.5);
  assert.equal(strobe2.dominantBand, 'vocal');
  assert.ok(strobe2.vocalRippleRadius > 0.4);

  // Test 3: Raw frequency array integration
  const rawFreqData = new Uint8Array(256);
  // High treble energy in upper bins
  for (let i = 180; i < 256; i++) rawFreqData[i] = 240;
  const strobe3 = lib.calculateMultiBandStrobe(rawFreqData, {}, { preset: 'studio-monitor' });
  assert.ok(strobe3.trebleEnergy > 0.3);
  assert.ok(strobe3.activeSparkles >= 0);

  // Test 4: Decay across steps when silent
  const decayed = lib.calculateMultiBandStrobe({ bass: 0, vocal: 0, treble: 0 }, strobe1, { preset: 'club-laser' });
  assert.ok(decayed.bassIntensity < strobe1.bassIntensity, 'Bass intensity must decay');
});

test('Pha B — renderMultiBandAmbientAura handles Canvas rendering cleanly', () => {
  // Test empty or zero dimension
  assert.equal(lib.renderMultiBandAmbientAura(null), false);
  assert.equal(lib.renderMultiBandAmbientAura({}, { width: 0, height: 0 }), false);

  // Test mock canvas 2D context
  const calls = [];
  const mockContext = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    arc: () => calls.push('arc'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    fillRect: () => calls.push('fillRect'),
    createRadialGradient: () => ({
      addColorStop: () => {}
    })
  };

  const activeStrobe = {
    isStrobeTriggered: true,
    bassIntensity: 0.8,
    vocalIntensity: 0.6,
    trebleIntensity: 0.5,
    bassPulseScale: 1.08,
    vocalRippleRadius: 0.55,
    activeSparkles: 6
  };

  const rendered = lib.renderMultiBandAmbientAura(mockContext, {
    width: 600,
    height: 300,
    strobe: activeStrobe,
    theme: 'amethyst'
  });

  assert.equal(rendered, true);
  assert.ok(calls.includes('save'));
  assert.ok(calls.includes('restore'));
  assert.ok(calls.includes('fillRect'));
  assert.ok(calls.includes('stroke'));
  assert.ok(calls.includes('fill'));
});

test('Pha B — formatMultiBandAuraSummary produces localized telemetry summary', () => {
  const strobe = {
    presetName: 'Vũ Trường Laser',
    bassIntensity: 0.82,
    vocalIntensity: 0.44,
    trebleIntensity: 0.28,
    dominantBand: 'bass'
  };
  const summary = lib.formatMultiBandAuraSummary(strobe);
  assert.ok(summary.includes('Vũ Trường Laser'));
  assert.ok(summary.includes('B:82%'));
  assert.ok(summary.includes('V:44%'));
  assert.ok(summary.includes('T:28%'));
  assert.ok(summary.includes('Đỉnh Trầm'));

  assert.equal(lib.formatMultiBandAuraSummary(null), 'Sân khấu ánh sáng: Tĩnh');
});

test('Pha B — DOM integration & Core Audio Graph Invariant in index.html', () => {
  const indexPath = path.join(__dirname, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Verify invariant
  assert.ok(
    indexContent.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Core audio invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
  );

  // Verify UI elements
  assert.ok(indexContent.includes('stage-aura-preset-select'), 'Must contain #stage-aura-preset-select');
  assert.ok(indexContent.includes('stage-aura-desc'), 'Must contain #stage-aura-desc');
  assert.ok(indexContent.includes('stageAuraPreset'), 'State must initialize stageAuraPreset');
});
