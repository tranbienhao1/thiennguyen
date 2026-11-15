const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const library = require('../library-utils.js');

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Pha B — Acoustic Thermal Ballistics Calculations & Rating', async t => {
  await t.test('calculateThermalBallistics initializes and moves with attack and dissipation', () => {
    // Initial state from silence
    const res0 = library.calculateThermalBallistics(0, {});
    assert.equal(res0.level, 0);
    assert.equal(res0.db, -40);
    assert.equal(res0.needleAngle, -45);
    assert.equal(res0.temperatureC, 25);
    assert.equal(res0.thermalRating, 'cool');
    assert.equal(res0.isOverload, false);
    assert.equal(res0.isThermalWarning, false);

    // High input step: 0.8
    const res1 = library.calculateThermalBallistics(0.8, res0);
    assert.ok(res1.level > 0.2, 'Attack should move level towards 0.8');
    assert.ok(res1.db > -20, 'db should rise');
    assert.ok(res1.needleAngle > -45, 'needleAngle should move towards center/right');
    assert.ok(res1.thermalLoad > 0, 'thermal load should increase');
    assert.ok(res1.temperatureC >= 25, 'temperature should rise');

    // Repeated high load simulates sustained playback (heating up)
    let state = res1;
    for (let i = 0; i < 40; i++) {
      state = library.calculateThermalBallistics(1.0, state);
    }
    assert.ok(state.temperatureC >= 45, 'Sustained load should reach optimal or warm temp');
    assert.ok(['optimal', 'warm', 'hot'].includes(state.thermalRating));
    assert.equal(state.isOverload, true, 'Full scale 1.0 should trigger overload flag');

    // Extreme sustained clipping
    for (let i = 0; i < 60; i++) {
      state = library.calculateThermalBallistics(1.0, state);
    }
    assert.ok(state.temperatureC >= 70, 'Extreme load should increase heat towards warning');
    if (state.temperatureC >= 75) {
      assert.equal(state.isThermalWarning, true);
      assert.equal(state.thermalRating, 'hot');
    }

    // Cooling down with zero signal
    for (let i = 0; i < 100; i++) {
      state = library.calculateThermalBallistics(0, state);
    }
    assert.ok(state.temperatureC < 45, 'Cooling down should return to cool rating');
    assert.equal(state.thermalRating, 'cool');
    assert.equal(state.isOverload, false);
  });

  await t.test('formatThermalBallisticsBadge formats badges for all temperature states', () => {
    assert.equal(library.formatThermalBallisticsBadge(null), '25°C · Tĩnh');
    assert.ok(library.formatThermalBallisticsBadge({ temperatureC: 30, thermalRating: 'cool' }).includes('Mát mẻ'));
    assert.ok(library.formatThermalBallisticsBadge({ temperatureC: 50, thermalRating: 'optimal' }).includes('Tối ưu'));
    assert.ok(library.formatThermalBallisticsBadge({ temperatureC: 68, thermalRating: 'warm' }).includes('Ấm'));
    assert.ok(library.formatThermalBallisticsBadge({ temperatureC: 80, thermalRating: 'hot', isThermalWarning: true }).includes('Quá tải'));
  });
});

test('Pha B — 3D Soundstage Acoustic Vectors & Summaries', async t => {
  await t.test('calculateSoundstageAcousticVectors handles mono, stereo, and extreme out-of-phase signals', () => {
    // Fallback on empty
    const fallback = library.calculateSoundstageAcousticVectors([], []);
    assert.equal(fallback.azimuth, 0);
    assert.equal(fallback.soundstageType, 'balanced');

    // Pure Mono signal (L == R)
    const monoL = new Uint8Array(128).fill(160);
    const monoR = new Uint8Array(128).fill(160);
    const monoVec = library.calculateSoundstageAcousticVectors(monoL, monoR);
    assert.equal(monoVec.azimuth, 0, 'Mono should have 0 azimuth');
    assert.equal(monoVec.spread, 0, 'Pure mono side energy is 0, so spread is 0%');
    assert.equal(monoVec.soundstageType, 'intimate');
    assert.ok(monoVec.summary.includes('Gần Gũi'));

    // Panned Hard Right
    const rightHeavyL = new Uint8Array(128).fill(128);
    const rightHeavyR = new Uint8Array(128).fill(220);
    const rightVec = library.calculateSoundstageAcousticVectors(rightHeavyL, rightHeavyR);
    assert.ok(rightVec.azimuth > 15, 'Hard right should have positive azimuth');
    assert.ok(rightVec.summary.includes('Lệch Phải'));

    // Panned Hard Left
    const leftHeavyL = new Uint8Array(128).fill(220);
    const leftHeavyR = new Uint8Array(128).fill(128);
    const leftVec = library.calculateSoundstageAcousticVectors(leftHeavyL, leftHeavyR);
    assert.ok(leftVec.azimuth < -15, 'Hard left should have negative azimuth');
    assert.ok(leftVec.summary.includes('Lệch Trái'));

    // Rich Wide Stereo with Decorrelation
    const wideL = new Uint8Array(128);
    const wideR = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
      wideL[i] = Math.round(128 + 60 * Math.sin(i * 0.1));
      wideR[i] = Math.round(128 - 60 * Math.sin(i * 0.1));
    }
    const wideVec = library.calculateSoundstageAcousticVectors(wideL, wideR);
    assert.ok(wideVec.spread > 70, 'Opposite phase should have wide spread');
    assert.equal(wideVec.soundstageType, 'holographic');
    assert.ok(wideVec.summary.includes('Holographic'));
  });

  await t.test('renderAcousticSoundstageCanvas handles valid and edge-case contexts', () => {
    // Null context
    assert.equal(library.renderAcousticSoundstageCanvas(null), false);

    // Mock canvas context
    const mockCtx = {
      canvas: { width: 400, height: 300 },
      clearRect() {},
      beginPath() {},
      arc() {},
      stroke() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      fillText() {},
      save() {},
      restore() {},
      createRadialGradient() {
        return { addColorStop() {} };
      }
    };

    const rendered = library.renderAcousticSoundstageCanvas(mockCtx, {
      azimuth: 12,
      depth: 0.65,
      spread: 72,
      airiness: 0.8
    });
    assert.equal(rendered, true);
  });
});

test('Pha B — DOM & UI Integration & Web Audio Graph Invariants', async t => {
  await t.test('index.html contains Fullscreen Stage view controls and canvas', () => {
    assert.ok(indexHtml.includes('id="fullscreen-view-stage-btn"'), '#fullscreen-view-stage-btn must exist in top nav');
    assert.ok(indexHtml.includes('id="fullscreen-stage-visualizer"'), '#fullscreen-stage-visualizer must exist');
    assert.ok(indexHtml.includes('id="fullscreen-stage-canvas"'), '#fullscreen-stage-canvas must exist');
    assert.ok(indexHtml.includes('id="fs-soundstage-badge"'), '#fs-soundstage-badge must exist');
    assert.ok(indexHtml.includes('id="fs-thermal-badge"'), '#fs-thermal-badge must exist');
  });

  await t.test('index.html contains #room-thermal-badge in Listening Room', () => {
    assert.ok(indexHtml.includes('id="room-thermal-badge"'), '#room-thermal-badge must exist in #listening-room');
  });

  await t.test('CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
    );
  });
});
