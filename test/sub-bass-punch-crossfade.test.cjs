const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha A — Sub-Bass Transient Punch Profiles & Parametric Calculations', async t => {
  await t.test('SUB_BASS_PUNCH_PROFILES contains all standard audiophile punch profiles', () => {
    assert.ok(library.SUB_BASS_PUNCH_PROFILES, 'SUB_BASS_PUNCH_PROFILES must exist');
    const expected = ['off', 'sub-punch', 'deep-rumble', 'tight-slam'];
    expected.forEach(id => {
      assert.ok(library.SUB_BASS_PUNCH_PROFILES[id], `Profile ${id} must exist`);
      const p = library.SUB_BASS_PUNCH_PROFILES[id];
      assert.equal(p.id, id);
      assert.ok(typeof p.name === 'string');
      assert.ok(typeof p.description === 'string');
    });
  });

  await t.test('getSubBassPunchProfile retrieves profile safely with fallback', () => {
    const punch = library.getSubBassPunchProfile('sub-punch');
    assert.equal(punch.id, 'sub-punch');
    assert.equal(punch.frequency, 45);

    const fallback = library.getSubBassPunchProfile('non-existent');
    assert.equal(fallback.id, 'off');
  });

  await t.test('calculateSubBassPunchParams calculates scaled gains and negative safety preamp', () => {
    // 1. Off profile
    const off = library.calculateSubBassPunchParams('off', 1.0);
    assert.equal(off.id, 'off');
    assert.equal(off.gain, 0);
    assert.equal(off.preampSafetyOffset, 0);

    // 2. Sub-punch profile at 1.0 intensity
    const punch1 = library.calculateSubBassPunchParams('sub-punch', 1.0);
    assert.equal(punch1.id, 'sub-punch');
    assert.equal(punch1.frequency, 45);
    assert.equal(punch1.gain, 3.5);
    assert.equal(punch1.harmonicFrequency, 90);
    assert.ok(punch1.preampSafetyOffset <= 0, 'Safety preamp offset must be <= 0 dB to guarantee no clipping');

    // 3. Scaled intensity (e.g. 1.5x)
    const punch15 = library.calculateSubBassPunchParams('sub-punch', 1.5);
    assert.equal(punch15.gain, 5.25);
    assert.ok(punch15.preampSafetyOffset <= -3.0, 'Higher gain requires deeper negative preamp headroom');

    // 4. Clamping intensity safely
    const punchClamped = library.calculateSubBassPunchParams('sub-punch', 10.0);
    assert.equal(punchClamped.intensity, 2.0, 'Intensity must be clamped to max 2.0');
  });

  await t.test('formatSubBassPunchSummary provides human-readable badge text', () => {
    const summaryOff = library.formatSubBassPunchSummary('off');
    assert.ok(summaryOff.includes('Bypass'));

    const summaryPunch = library.formatSubBassPunchSummary('sub-punch', 1.0);
    assert.ok(summaryPunch.includes('45 Hz'));
    assert.ok(summaryPunch.includes('+3.5 dB'));
  });

  await t.test('calculateLowFrequencyTransientDecay computes damping factor and half-life', () => {
    const decay = library.calculateLowFrequencyTransientDecay(45, 1.4);
    assert.ok(decay.dampingFactor > 0);
    assert.ok(decay.halfLifeMs > 0);
    assert.ok(decay.periodMs > 0);
  });
});

test('Pha A — Dynamic Crossfade Sub-Bass Energy Preservation', async t => {
  await t.test('CROSSFADE_CURVE_PROFILES contains sub-bass-blend curve', () => {
    assert.ok(library.CROSSFADE_CURVE_PROFILES['sub-bass-blend'], 'sub-bass-blend curve must exist');
    const curve = library.CROSSFADE_CURVE_PROFILES['sub-bass-blend'];
    assert.ok(curve.name.includes('Sub-Bass'));
  });

  await t.test('calculateCrossfadeGains handles sub-bass-blend smoothly', () => {
    // Start of crossfade
    const gStart = library.calculateCrossfadeGains(0, 'sub-bass-blend');
    assert.equal(gStart.out, 1);
    assert.equal(gStart.in, 0);

    // Midpoint of crossfade: energy is preserved without dip
    const gMid = library.calculateCrossfadeGains(0.5, 'sub-bass-blend');
    assert.ok(gMid.out >= 0.7, 'Out gain at midpoint must maintain sufficient low-end');
    assert.ok(gMid.in >= 0.7, 'In gain at midpoint must maintain sufficient low-end');

    // End of crossfade
    const gEnd = library.calculateCrossfadeGains(1, 'sub-bass-blend');
    assert.equal(gEnd.out, 0);
    assert.equal(gEnd.in, 1);
  });
});

test('Pha A — UI Integration & Web Audio Graph Invariants', async t => {
  await t.test('index.html contains Sub-Bass Punch controls in EQ panel', () => {
    assert.ok(indexHtml.includes('id="sub-bass-select"'), '#sub-bass-select must exist');
    assert.ok(indexHtml.includes('id="sub-bass-intensity-slider"'), '#sub-bass-intensity-slider must exist');
    assert.ok(indexHtml.includes('id="sub-bass-punch-badge"'), '#sub-bass-punch-badge must exist');
    assert.ok(indexHtml.includes('id="sub-bass-punch-desc"'), '#sub-bass-punch-desc must exist');
  });

  await t.test('index.html state initializes subBassPunchProfile and persists in localStorage', () => {
    assert.ok(indexHtml.includes('subBassPunchProfile'), 'state must have subBassPunchProfile');
    assert.ok(indexHtml.includes('nocturne-sub-bass-punch'), 'localStorage key nocturne-sub-bass-punch must be referenced');
  });

  await t.test('CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be intact'
    );
  });
});
