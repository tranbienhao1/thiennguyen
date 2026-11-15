const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

test('Multi-Band Logarithmic Spectrum Dynamics & Beat Strobe Chromatic Aura Test Suite', async (t) => {
  await t.test('1. calculateLogarithmicFrequencyBins divides bins logarithmically and applies high-shelf tilt', () => {
    assert.equal(typeof library.calculateLogarithmicFrequencyBins, 'function');

    // Edge cases: null/empty data
    const emptyResult = library.calculateLogarithmicFrequencyBins(null, 32);
    assert.equal(emptyResult.length, 32);
    assert.equal(emptyResult[0], 0);

    // Simulated 512-bin FFT with equal energy across all frequencies
    const rawFft = new Uint8Array(512);
    rawFft.fill(128); // ~0.5 normalized

    const logBins = library.calculateLogarithmicFrequencyBins(rawFft, 32);
    assert.equal(logBins.length, 32);
    assert.ok(logBins instanceof Float32Array);

    // Verify all bins are valid numbers between 0 and 1
    for (let i = 0; i < logBins.length; i++) {
      assert.ok(logBins[i] >= 0 && logBins[i] <= 1, `bin[${i}] should be in [0, 1]`);
    }

    // High-shelf tilt ensures highest bin has higher multiplier than first bin
    assert.ok(logBins[31] > logBins[0], 'Highest bin should reflect subtle high-frequency tilt compensation');
  });

  await t.test('2. calculateBallisticSpectrumDynamics applies asymmetric Attack/Decay envelope', () => {
    assert.equal(typeof library.calculateBallisticSpectrumDynamics, 'function');

    const prev = new Float32Array([0.1, 0.8, 0.5]);
    const targetHigh = new Float32Array([0.9, 0.8, 0.9]);

    // Attack phase: target > prev
    const attackStep = library.calculateBallisticSpectrumDynamics(prev, targetHigh, { attackRate: 0.7, decayRate: 0.8 });
    // prev[0] = 0.1, target = 0.9 -> 0.1 + 0.7 * (0.9 - 0.1) = 0.66
    assert.ok(Math.abs(attackStep[0] - 0.66) < 0.01, `Attack value expected ~0.66, got ${attackStep[0]}`);

    // Decay phase: target < prev
    const targetLow = new Float32Array([0.0, 0.1, 0.0]);
    const decayStep = library.calculateBallisticSpectrumDynamics(prev, targetLow, { attackRate: 0.7, decayRate: 0.8 });
    // prev[1] = 0.8, target = 0.1 -> 0.8 * 0.8 = 0.64
    assert.ok(Math.abs(decayStep[1] - 0.64) < 0.01, `Decay value expected ~0.64, got ${decayStep[1]}`);

    // Residual cleanup (< 0.005 gets clamped to 0)
    const tinyPrev = new Float32Array([0.004]);
    const zeroTarget = new Float32Array([0.0]);
    const cleaned = library.calculateBallisticSpectrumDynamics(tinyPrev, zeroTarget, { decayRate: 0.5 });
    assert.equal(cleaned[0], 0, 'Residual below 0.005 should clamp to zero');
  });

  await t.test('3. calculateBeatStrobeChromaticAura generates concentric ripples & dynamic chromatic shifts', () => {
    assert.equal(typeof library.calculateBeatStrobeChromaticAura, 'function');

    // Quiet signal
    const quietAura = library.calculateBeatStrobeChromaticAura({ bassIntensity: 0.02, vocalIntensity: 0.01, trebleIntensity: 0.01 });
    assert.equal(quietAura.isAuraActive, false);
    assert.equal(quietAura.concentricRipples.length, 0);

    // Medium bass punch (bass = 0.25 -> 1 ripple)
    const mediumAura = library.calculateBeatStrobeChromaticAura({
      bassIntensity: 0.25,
      vocalIntensity: 0.15,
      trebleIntensity: 0.1,
      isStrobeTriggered: true
    }, { primaryColor: '#ec4899', timeSeconds: 10 });

    assert.equal(mediumAura.isAuraActive, true);
    assert.equal(mediumAura.concentricRipples.length, 1);
    assert.equal(mediumAura.concentricRipples[0].colorHex, '#ec4899');
    assert.ok(mediumAura.concentricRipples[0].radiusMultiplier > 1.0);

    // Heavy sub-bass drop (bass = 0.7 -> 2 ripples: inner and outer resonant halo)
    const heavyAura = library.calculateBeatStrobeChromaticAura({
      bassIntensity: 0.7,
      vocalIntensity: 0.4,
      trebleIntensity: 0.6
    }, { primaryColor: '#a855f7', timeSeconds: 20 });

    assert.equal(heavyAura.isAuraActive, true);
    assert.equal(heavyAura.concentricRipples.length, 2);
    assert.equal(heavyAura.concentricRipples[1].colorHex, '#38bdf8');
    assert.ok(heavyAura.chromaticOffsetDeg >= 0 && heavyAura.chromaticOffsetDeg <= 360);
    assert.ok(heavyAura.rimGlowAlpha > 0);
  });

  await t.test('4. VISUALIZER_THEMES includes neon_hologram & golden_ember and cycleVisualizerTheme handles all 11 themes', () => {
    assert.ok(library.VISUALIZER_THEMES.neon_hologram, 'VISUALIZER_THEMES must contain neon_hologram');
    assert.ok(library.VISUALIZER_THEMES.golden_ember, 'VISUALIZER_THEMES must contain golden_ember');

    assert.equal(library.VISUALIZER_THEMES.neon_hologram.name, 'Neon Hologram Cyber');
    assert.equal(library.VISUALIZER_THEMES.golden_ember.name, 'Golden Tube Ember');
    assert.equal(library.VISUALIZER_THEMES.neon_hologram.peakColor, '#67e8f9');

    // Check cycling across all themes
    const allThemeKeys = Object.keys(library.VISUALIZER_THEMES);
    assert.ok(allThemeKeys.length >= 11, `Expected at least 11 themes, got ${allThemeKeys.length}`);

    const cycled = library.cycleVisualizerTheme('neon_hologram', { all: true });
    assert.ok(typeof cycled === 'string' && cycled.length > 0);
  });

  await t.test('5. renderVisualizerSpectrum & renderMultiBandAmbientAura execute safely with new options', () => {
    // Mock 2D Canvas context
    const drawnRects = [];
    const drawnArcs = [];
    const mockContext = {
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x, y, w, h) => drawnRects.push({ x, y, w, h }),
      beginPath: () => {},
      roundRect: (x, y, w, h, r) => drawnRects.push({ x, y, w, h, r }),
      fill: () => {},
      stroke: () => {},
      arc: (x, y, r, sa, ea) => drawnArcs.push({ x, y, r, sa, ea }),
      save: () => {},
      restore: () => {},
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1
    };

    const testFft = new Uint8Array(128);
    for (let i = 0; i < 128; i++) testFft[i] = 100 + i;

    // Test spectrum with logarithmic & ballistics enabled
    const specResult = library.renderVisualizerSpectrum(mockContext, {
      width: 300,
      height: 100,
      bars: 32,
      data: testFft,
      logarithmic: true,
      ballistics: true,
      theme: 'neon_hologram',
      mode: 'mirror'
    });
    assert.equal(specResult, true);
    assert.ok(drawnRects.length > 0, 'Spectrum should render bars');

    // Test multi-band ambient aura with Layer 4 chromatic aura
    const auraResult = library.renderMultiBandAmbientAura(mockContext, {
      width: 400,
      height: 400,
      theme: 'neon_hologram',
      strobe: {
        bassIntensity: 0.5,
        vocalIntensity: 0.3,
        trebleIntensity: 0.4,
        isStrobeTriggered: true,
        bassPulseScale: 1.1,
        vocalRippleRadius: 0.7,
        activeSparkles: 4
      },
      time: 5000
    });
    assert.equal(auraResult, true);
    assert.ok(drawnArcs.length > 0, 'Ambient aura should render concentric arcs/ripples');
  });

  await t.test('6. Strictly preserves Web Audio API graph invariant', () => {
    const indexContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    // INVARIANT #1: state.crossfeedNodes.output.connect(state.context.destination)
    assert.ok(
      indexContent.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );

    // Verify integration of logarithmic & ballistics into index.html spectrum loop
    assert.ok(
      indexContent.includes('calculateLogarithmicFrequencyBins'),
      'index.html must invoke calculateLogarithmicFrequencyBins'
    );
    assert.ok(
      indexContent.includes('calculateBallisticSpectrumDynamics'),
      'index.html must invoke calculateBallisticSpectrumDynamics'
    );
  });
});
