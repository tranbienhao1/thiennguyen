const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Pha B — Mini HUD Interactive Waveform Scrubbing & VU Meter Gravity Dynamics Test Suite', async (t) => {
  await t.test('1. calculateMiniHudScrubFraction clamps fraction correctly and handles edge cases', () => {
    assert.strictEqual(library.calculateMiniHudScrubFraction(36, 72), 0.5);
    assert.strictEqual(library.calculateMiniHudScrubFraction(0, 72), 0);
    assert.strictEqual(library.calculateMiniHudScrubFraction(72, 72), 1);
    assert.strictEqual(library.calculateMiniHudScrubFraction(-10, 72), 0);
    assert.strictEqual(library.calculateMiniHudScrubFraction(100, 72), 1);
    assert.strictEqual(library.calculateMiniHudScrubFraction(NaN, 72), 0);
    assert.strictEqual(library.calculateMiniHudScrubFraction(36, 0), 0);
    assert.strictEqual(library.calculateMiniHudScrubFraction(36, -50), 0);
  });

  await t.test('2. calculateMiniHudScrubTime maps fraction to audio duration safely', () => {
    assert.strictEqual(library.calculateMiniHudScrubTime(0.5, 200), 100);
    assert.strictEqual(library.calculateMiniHudScrubTime(0, 200), 0);
    assert.strictEqual(library.calculateMiniHudScrubTime(1, 200), 200);
    assert.strictEqual(library.calculateMiniHudScrubTime(-0.2, 200), 0);
    assert.strictEqual(library.calculateMiniHudScrubTime(1.5, 200), 200);
    assert.strictEqual(library.calculateMiniHudScrubTime(0.5, 0), 0);
    assert.strictEqual(library.calculateMiniHudScrubTime(0.5, -100), 0);
    assert.strictEqual(library.calculateMiniHudScrubTime(NaN, 200), 0);
  });

  await t.test('3. renderMiniHudWaveformScrubber renders waveform bars and playhead onto canvas context', () => {
    const drawCalls = [];
    const mockCtx = {
      clearRect: (x, y, w, h) => drawCalls.push({ type: 'clearRect', x, y, w, h }),
      fillRect: (x, y, w, h) => drawCalls.push({ type: 'fillRect', x, y, w, h, fillStyle: mockCtx.fillStyle }),
      fillStyle: ''
    };
    const mockCanvas = {
      width: 72,
      height: 26,
      getContext: (type) => (type === '2d' ? mockCtx : null)
    };

    const peaks = [0.2, 0.4, 0.8, 0.9, 0.6, 0.3, 0.5, 0.7, 0.95, 0.4, 0.3, 0.6, 0.7, 0.8, 0.5, 0.3, 0.4, 0.2];
    const ok = library.renderMiniHudWaveformScrubber(mockCanvas, peaks, 0.4, {
      hoverFraction: 0.7
    });

    assert.strictEqual(ok, true);
    assert.ok(drawCalls.some(c => c.type === 'clearRect'));
    assert.ok(drawCalls.filter(c => c.type === 'fillRect').length >= 18);

    // Invalid canvas checks
    assert.strictEqual(library.renderMiniHudWaveformScrubber(null, peaks, 0.5), false);
    assert.strictEqual(library.renderMiniHudWaveformScrubber({}, peaks, 0.5), false);
  });

  await t.test('4. calculateVuGravityBallistics models peak hold, gravity acceleration and zero-latency attack', () => {
    // Initial attack: signal rises from 0 to 0.8
    const step1 = library.calculateVuGravityBallistics([0.8], [0.0], [0], [0.0], { holdFrames: 3, gravity: 0.01 });
    assert.ok(Math.abs(step1.peaks[0] - 0.8) < 1e-5);
    assert.strictEqual(step1.holdCounters[0], 3);
    assert.strictEqual(step1.velocities[0], 0);

    // Signal drops to 0.2: peak must stay at 0.8 during hold countdown
    const step2 = library.calculateVuGravityBallistics([0.2], step1.peaks, step1.holdCounters, step1.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(Math.abs(step2.peaks[0] - 0.8) < 1e-5);
    assert.strictEqual(step2.holdCounters[0], 2);

    const step3 = library.calculateVuGravityBallistics([0.2], step2.peaks, step2.holdCounters, step2.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(Math.abs(step3.peaks[0] - 0.8) < 1e-5);
    assert.strictEqual(step3.holdCounters[0], 1);

    const step4 = library.calculateVuGravityBallistics([0.2], step3.peaks, step3.holdCounters, step3.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(Math.abs(step4.peaks[0] - 0.8) < 1e-5);
    assert.strictEqual(step4.holdCounters[0], 0);

    // Hold expired: peak begins accelerated gravity falloff
    const step5 = library.calculateVuGravityBallistics([0.2], step4.peaks, step4.holdCounters, step4.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(step5.peaks[0] < 0.8, 'Peak should fall after hold expires');
    assert.ok(Math.abs(step5.velocities[0] - 0.01) < 1e-5);

    const step6 = library.calculateVuGravityBallistics([0.2], step5.peaks, step5.holdCounters, step5.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(step6.peaks[0] < step5.peaks[0], 'Peak should continue falling faster');
    assert.ok(Math.abs(step6.velocities[0] - 0.02) < 1e-5);

    // Sudden loud transient: zero-latency immediate peak jump
    const step7 = library.calculateVuGravityBallistics([0.95], step6.peaks, step6.holdCounters, step6.velocities, { holdFrames: 3, gravity: 0.01 });
    assert.ok(Math.abs(step7.peaks[0] - 0.95) < 1e-5);
    assert.strictEqual(step7.holdCounters[0], 3);
    assert.strictEqual(step7.velocities[0], 0);
  });

  await t.test('5. formatVuBallisticsTelemetry formats dB metrics accurately', () => {
    const telemetry = library.formatVuBallisticsTelemetry(0.85, 0.79, 0.49, 0.45);
    assert.ok(telemetry.includes('VU L:'));
    assert.ok(telemetry.includes('Pk'));
    assert.ok(telemetry.includes('dB'));
  });

  await t.test('6. VISUALIZER_THEMES includes emerald_matrix & solar_flare and cycleVisualizerTheme iterates all themes', () => {
    const themes = library.VISUALIZER_THEMES;
    assert.ok(themes.emerald_matrix, 'emerald_matrix theme must exist');
    assert.ok(themes.solar_flare, 'solar_flare theme must exist');
    assert.strictEqual(themes.emerald_matrix.stops.length, 3);
    assert.strictEqual(themes.solar_flare.stops.length, 3);

    const nextTheme = library.cycleVisualizerTheme('golden_ember', { all: true });
    assert.strictEqual(nextTheme, 'emerald_matrix');

    const nextSolar = library.cycleVisualizerTheme('emerald_matrix', { all: true });
    assert.strictEqual(nextSolar, 'solar_flare');
  });

  await t.test('7. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    assert.ok(indexHtml.includes('miniHudHoverFraction: null'), 'state must initialize miniHudHoverFraction');
    assert.ok(indexHtml.includes('vuGravityState: null'), 'state must initialize vuGravityState');
    assert.ok(indexHtml.includes('renderMiniHudWaveformScrubber'), 'renderWaveformSeekbar must invoke renderMiniHudWaveformScrubber');
    assert.ok(indexHtml.includes('calculateMiniHudScrubFraction'), 'Mini waveform listeners must calculate scrub fraction');
    assert.ok(indexHtml.includes('calculateVuGravityBallistics'), 'setVisualizerRunning must integrate calculateVuGravityBallistics');

    // CRITICAL AUDIO INVARIANT
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio routing invariant state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved'
    );
  });
});
