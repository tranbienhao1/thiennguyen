const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');

test('Pha A - LOUDNESS_STANDARDS registry and lookup', () => {
  assert.ok(lib.LOUDNESS_STANDARDS, 'LOUDNESS_STANDARDS must be defined');
  const standards = lib.listLoudnessStandards();
  assert.ok(Array.isArray(standards), 'listLoudnessStandards must return an array');
  assert.ok(standards.length >= 5, 'Must have at least 5 standards');

  const standardIds = standards.map(s => s.id);
  assert.ok(standardIds.includes('ebu-r128'), 'Must include EBU R128');
  assert.ok(standardIds.includes('itu-bs1770'), 'Must include ITU-R BS.1770');
  assert.ok(standardIds.includes('audiophile-album'), 'Must include Roon Audiophile Album');
  assert.ok(standardIds.includes('streaming-standard'), 'Must include Streaming standard');
  assert.ok(standardIds.includes('legacy-replaygain'), 'Must include Legacy ReplayGain');

  const ebu = lib.getLoudnessStandard('ebu-r128');
  assert.equal(ebu.targetLuFS, -23.0);
  assert.equal(ebu.maxTruePeakDb, -1.0);

  const fallback = lib.getLoudnessStandard('unknown-standard');
  assert.equal(fallback.id, 'audiophile-album', 'Unknown standard must fallback to audiophile-album');
});

test('Pha A - calculateTruePeakAutoGuard protects DAC from inter-sample clipping', () => {
  // Safe condition: Gain 0 dB, True-Peak -3.0 dBTP, Max allowed -0.5 dBTP -> No guard needed
  const safeResult = lib.calculateTruePeakAutoGuard(0, -3.0, -0.5);
  assert.equal(safeResult.isGuardActive, false);
  assert.equal(safeResult.guardReductionDb, 0);
  assert.equal(safeResult.guardedGainDb, 0);

  // Dangerous condition: Gain +4.0 dB, Measured True-Peak -0.2 dBTP, Max allowed -0.5 dBTP
  // Projected TP = 3.8 dBTP -> Exceeds max by 4.3 dB!
  const dangerousResult = lib.calculateTruePeakAutoGuard(4.0, -0.2, -0.5);
  assert.equal(dangerousResult.isGuardActive, true);
  assert.equal(dangerousResult.projectedTruePeakDb, 3.8);
  assert.equal(dangerousResult.guardReductionDb, 4.3);
  assert.equal(dangerousResult.guardedGainDb, -0.3);
  assert.ok(dangerousResult.guardedGainDb + dangerousResult.measuredTruePeakDb <= dangerousResult.maxAllowedTruePeakDb + 0.001);
});

test('Pha A - estimateLoudnessLUFS calculates K-weighted loudness from RMS and Crest factor', () => {
  const lufsHighDynamics = lib.estimateLoudnessLUFS(-18.0, 15.0);
  assert.equal(lufsHighDynamics, -18.8);

  const lufsModerateDynamics = lib.estimateLoudnessLUFS(-14.0, 11.0);
  assert.equal(lufsModerateDynamics, -14.5);

  const lufsLowDynamics = lib.estimateLoudnessLUFS(-10.0, 6.0);
  assert.equal(lufsLowDynamics, -10.2);

  // Bounds checking
  const boundedSilence = lib.estimateLoudnessLUFS(-120, 10);
  assert.equal(boundedSilence, -96);
});

test('Pha A - calculateDynamicReplayGain handles tagged and untagged tracks with True-Peak Auto Guard', () => {
  // 1. Tagged track (ReplayGain track gain -4.5 dB)
  const taggedTrack = {
    replayGainTrackGain: -4.5,
    replayGainAlbumGain: -5.0,
    replayGainTrackPeak: 0.95
  };

  const taggedResult = lib.calculateDynamicReplayGain(taggedTrack, {
    standard: 'ebu-r128', // target -23 LUFS (offset -5 dB relative to -18 LUFS)
    mode: 'track',
    preampDb: 0,
    truePeakAutoGuard: true
  });

  assert.equal(taggedResult.isEstimated, false);
  assert.equal(taggedResult.standard, 'ebu-r128');
  assert.equal(taggedResult.targetLuFS, -23.0);
  // Base -4.5 + targetOffset (-23 - (-18) = -5) = -9.5 dB
  assert.equal(taggedResult.rawGainDb, -9.5);
  assert.ok(taggedResult.multiplier < 1.0);

  // 2. Untagged track (fallback estimation with RMS -12 dB, crest factor 8 dB)
  const untaggedTrack = {
    title: 'Modern Loud Master (No RG Tag)'
  };

  const untaggedResult = lib.calculateDynamicReplayGain(untaggedTrack, {
    standard: 'audiophile-album', // target -18 LUFS
    mode: 'track',
    rmsDb: -12.0,
    crestFactorDb: 8.0,
    truePeakAutoGuard: true
  });

  assert.equal(untaggedResult.isEstimated, true);
  assert.ok(untaggedResult.estimatedLuFS !== null);
  // Loud master should have negative gain applied to attenuate to -18 LUFS
  assert.ok(untaggedResult.appliedGainDb < 0);
  assert.ok(untaggedResult.multiplier < 1.0);

  // 3. True-Peak auto-guard attenuation test
  const clippedMaster = {
    replayGainTrackGain: +6.0,
    replayGainTrackPeak: 1.05 // Already over 0 dBFS
  };
  const guardProtected = lib.calculateDynamicReplayGain(clippedMaster, {
    standard: 'streaming-standard',
    preampDb: +2.0,
    truePeakAutoGuard: true,
    measuredTruePeakDb: +1.2
  });

  assert.equal(guardProtected.isGuardActive, true);
  assert.ok(guardProtected.guardReductionDb > 0);
  assert.ok(guardProtected.appliedGainDb < guardProtected.rawGainDb + guardProtected.preampDb);
});

test('Pha A - formatDynamicReplayGainSummary provides human-readable summary badge', () => {
  const result1 = {
    appliedGainDb: -3.2,
    mode: 'track',
    isEstimated: false,
    isGuardActive: false,
    guardReductionDb: 0,
    standardLabel: 'EBU R128 (-23 LUFS)'
  };
  const summary1 = lib.formatDynamicReplayGainSummary(result1);
  assert.ok(summary1.includes('EBU R128'));
  assert.ok(summary1.includes('-3.2 dB'));
  assert.ok(summary1.includes('Track'));

  const result2 = {
    appliedGainDb: +1.5,
    mode: 'track',
    isEstimated: true,
    isGuardActive: true,
    guardReductionDb: 1.8,
    standardLabel: 'Roon Audiophile Album (-18 LUFS)'
  };
  const summary2 = lib.formatDynamicReplayGainSummary(result2);
  assert.ok(summary2.includes('+1.5 dB'));
  assert.ok(summary2.includes('Ước tính R128'));
  assert.ok(summary2.includes('TP Guard (-1.8 dB)'));
});

test('Pha A - Core Web Audio API Invariant preservation in index.html', () => {
  const indexPath = path.join(__dirname, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Verify core audio routing invariant
  assert.ok(
    indexContent.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Core audio invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
  );

  // Verify new UI elements exist in index.html
  assert.ok(indexContent.includes('loudness-standard-select'), 'index.html must include #loudness-standard-select');
  assert.ok(indexContent.includes('loudness-guard-toggle'), 'index.html must include #loudness-guard-toggle');
});
