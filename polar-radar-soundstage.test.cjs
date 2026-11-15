const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Pha B: 3D Polar Radar Soundstage Visualizer & Dynamic Phase Field Hologram', async (t) => {
  await t.test('1. POLAR_RADAR_MODES registry and lookups', () => {
    assert.ok(library.POLAR_RADAR_MODES, 'POLAR_RADAR_MODES must be defined');
    assert.ok(library.POLAR_RADAR_MODES.contour, 'contour mode must exist');
    assert.ok(library.POLAR_RADAR_MODES.hologram, 'hologram mode must exist');
    assert.ok(library.POLAR_RADAR_MODES.spectral, 'spectral mode must exist');

    assert.equal(library.getPolarRadarMode('contour').id, 'contour');
    assert.equal(library.getPolarRadarMode('hologram').id, 'hologram');
    assert.equal(library.getPolarRadarMode('UNKNOWN').id, 'contour');
  });

  await t.test('2. calculatePolarRadarSoundstage handles mono, wide stereo, panned and anti-phase signals', () => {
    const N = 128;
    // 2.1 Mono centered signal (L == R)
    const monoL = new Uint8Array(N);
    const monoR = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const val = Math.round(128 + 60 * Math.sin((i / 8) * Math.PI));
      monoL[i] = val;
      monoR[i] = val;
    }
    const monoReport = library.calculatePolarRadarSoundstage(monoL, monoR);
    assert.equal(typeof monoReport, 'object');
    assert.ok(Math.abs(monoReport.centroidAzimuthDeg) <= 5, 'Mono signal must have azimuth near 0°');
    assert.ok(monoReport.correlation >= 0.95, 'Mono signal must have correlation >= 0.95');
    assert.equal(monoReport.antiPhaseRatio, 0, 'Mono signal has zero anti-phase ratio');

    // 2.2 Hard left-panned signal
    const leftOnly = new Uint8Array(N);
    const rightSilent = new Uint8Array(N).fill(128);
    for (let i = 0; i < N; i++) {
      leftOnly[i] = Math.round(128 + 60 * Math.sin((i / 8) * Math.PI));
    }
    const leftReport = library.calculatePolarRadarSoundstage(leftOnly, rightSilent);
    assert.ok(leftReport.centroidAzimuthDeg < -30, 'Left-panned signal must have negative azimuth < -30°');

    // 2.3 Hard right-panned signal
    const rightReport = library.calculatePolarRadarSoundstage(rightSilent, leftOnly);
    assert.ok(rightReport.centroidAzimuthDeg > 30, 'Right-panned signal must have positive azimuth > 30°');

    // 2.4 Anti-phase signal (L == -R)
    const antiL = new Uint8Array(N);
    const antiR = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const delta = Math.round(60 * Math.sin((i / 8) * Math.PI));
      antiL[i] = 128 + delta;
      antiR[i] = 128 - delta;
    }
    const antiReport = library.calculatePolarRadarSoundstage(antiL, antiR);
    assert.ok(antiReport.correlation <= -0.8, 'Inverted signal must have strong negative correlation');
    assert.equal(antiReport.soundstageState, 'anti_phase_alert', 'Inverted signal must trigger anti_phase_alert');
    assert.ok(antiReport.statusLabel.includes('lệch pha'), 'Status label must warn about out-of-phase');
  });

  await t.test('3. calculatePolarRadarSoundstage integrates frequency data when provided', () => {
    const N = 128;
    const l = new Uint8Array(N).fill(140);
    const r = new Uint8Array(N).fill(140);
    const freq = new Uint8Array(64);
    for (let i = 0; i < 64; i++) freq[i] = i * 3; // increasing frequency energy

    const report = library.calculatePolarRadarSoundstage(l, r, freq);
    assert.ok(report.spectralBands, 'spectralBands must be present');
    assert.equal(typeof report.spectralBands.subBass, 'number');
    assert.equal(typeof report.spectralBands.mid, 'number');
    assert.equal(typeof report.spectralBands.high, 'number');
    assert.ok(Array.isArray(report.bins), 'bins must be an array');
    assert.ok(report.bins.length > 0, 'bins must not be empty');
  });

  await t.test('4. formatPolarRadarTelemetry produces localized, formatted strings', () => {
    const mockReport = {
      centroidAzimuthDeg: 4,
      soundstageApertureDeg: 68,
      statusLabel: 'Stereo Cân bằng',
      correlation: 0.96
    };
    const str = library.formatPolarRadarTelemetry(mockReport);
    assert.ok(str.includes('Radar Âm Hình'), 'Must include Radar header');
    assert.ok(str.includes('Lệch Phải 4°'), 'Must include azimuth text');
    assert.ok(str.includes('Khẩu độ 68°'), 'Must include aperture');
    assert.ok(str.includes('Stereo Cân bằng'), 'Must include status label');
    assert.ok(str.includes('r=+0.96'), 'Must include signed correlation');

    // Missing report fallback
    assert.equal(library.formatPolarRadarTelemetry(null), '🎯 Radar Âm Hình: Chưa có dữ liệu');
  });

  await t.test('5. renderPolarRadarCanvas operates cleanly on mock 2D canvas', () => {
    const mockCtx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      stroke: () => {},
      fill: () => {},
      fillText: () => {},
      setLineDash: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} })
    };
    const mockCanvas = {
      width: 600,
      height: 340,
      getContext: (type) => (type === '2d' ? mockCtx : null)
    };

    const report = library.calculatePolarRadarSoundstage(new Uint8Array(64).fill(140), new Uint8Array(64).fill(130));
    const result = library.renderPolarRadarCanvas(mockCanvas, report);
    assert.equal(result, true, 'renderPolarRadarCanvas must succeed on valid 2D canvas');

    // Invalid canvas checks
    assert.equal(library.renderPolarRadarCanvas(null, report), false);
    assert.equal(library.renderPolarRadarCanvas({}, report), false);
  });

  await t.test('6. DOM Integration in index.html', () => {
    assert.ok(indexHtml.includes('id="fs-stage-mode-radar"'), '#fs-stage-mode-radar button must exist in HTML');
    assert.ok(indexHtml.includes('library.renderPolarRadarCanvas'), 'index.html must invoke renderPolarRadarCanvas');
    assert.ok(indexHtml.includes('library.calculatePolarRadarSoundstage'), 'index.html must invoke calculatePolarRadarSoundstage');
    assert.ok(indexHtml.includes('fs-stage-telemetry-desc'), '#fs-stage-telemetry-desc must exist');
  });

  await t.test('7. Web Audio Graph Invariant Check', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output must connect directly to state.context.destination'
    );
  });
});
