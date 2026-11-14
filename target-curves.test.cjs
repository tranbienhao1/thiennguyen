// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library-utils.js');

test('Acoustic Target Curves & Sound Signatures - Library pure utilities', async t => {
  const TARGET_CURVE_IDS = [
    'target-harman-2019',
    'target-diffuse-field',
    'target-warm-vocal',
    'target-basshead-club',
    'target-treble-air'
  ];

  await t.test('listAutoEqProfiles contains all acoustic target curves and sound signatures', () => {
    const list = library.listAutoEqProfiles();
    assert.ok(Array.isArray(list));
    const ids = list.map(item => item.id);

    TARGET_CURVE_IDS.forEach(id => {
      assert.ok(ids.includes(id), `Missing target curve profile: ${id}`);
    });
  });

  await t.test('every target curve has safe audiophile parameters preventing digital clipping', () => {
    TARGET_CURVE_IDS.forEach(id => {
      const p = library.getAutoEqProfile(id);
      assert.ok(p, `Profile ${id} must exist`);
      assert.equal(p.id, id);
      assert.ok(typeof p.name === 'string' && p.name.length > 0);
      assert.ok(['Target Curve', 'Sound Signature'].includes(p.category), `Category must be Target Curve or Sound Signature`);
      assert.ok(typeof p.description === 'string' && p.description.length > 0);
      assert.ok(p.preamp <= 0, `Preamp ${p.preamp} dB for ${id} must be <= 0 dB to guarantee headroom against clipping`);
      assert.ok(Array.isArray(p.bands) && p.bands.length >= 3, `Profile ${id} must contain at least 3 PEQ bands`);

      p.bands.forEach(b => {
        assert.ok(['peaking', 'lowshelf', 'highshelf'].includes(b.type), `Invalid filter type: ${b.type}`);
        assert.ok(b.frequency >= 20 && b.frequency <= 20000, `Frequency ${b.frequency} out of audible 20-20000 Hz bounds`);
        assert.ok(b.gain >= -24 && b.gain <= 24, `Gain ${b.gain} out of safe bounds`);
        assert.ok(b.q >= 0.1 && b.q <= 18, `Q ${b.q} out of safe filter bounds`);
      });
    });
  });

  await t.test('formatAutoEqProfile properly formats target curves and sound signatures', () => {
    const harman = library.getAutoEqProfile('target-harman-2019');
    const fmtHarman = library.formatAutoEqProfile(harman);
    assert.ok(fmtHarman.includes('Harman Target 2019'));
    assert.ok(fmtHarman.includes('Target Curve'));
    assert.ok(fmtHarman.includes('-4.5 dB'));

    const vocal = library.getAutoEqProfile('target-warm-vocal');
    const fmtVocal = library.formatAutoEqProfile(vocal);
    assert.ok(fmtVocal.includes('Vocal Warmth & Intimacy'));
    assert.ok(fmtVocal.includes('Sound Signature'));
  });

  await t.test('computeSignalPath cleanly identifies Target Curve and Sound Signature stages in DSP chain', () => {
    const track = { title: 'Audiophile Test', format: 'FLAC', sampleRate: 192000, bitDepth: 24 };

    const harmanPath = library.computeSignalPath(track, { autoEqProfile: 'target-harman-2019' });
    assert.equal(harmanPath.hasDsp, true);
    const harmanDsp = harmanPath.steps.find(s => s.stage === 'dsp');
    assert.ok(harmanDsp);
    assert.ok(harmanDsp.description.includes('Target Curve: Harman Target 2019'));

    const vocalPath = library.computeSignalPath(track, { autoEqProfile: 'target-warm-vocal' });
    const vocalDsp = vocalPath.steps.find(s => s.stage === 'dsp');
    assert.ok(vocalDsp);
    assert.ok(vocalDsp.description.includes('Sound Signature: Vocal Warmth & Intimacy'));
  });
});

test('Acoustic Target Curves & Fullscreen Roon View - DOM & UI Integration', async t => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  await t.test('#autoeq-select has optgroup for Target Curves and Headphone profiles', () => {
    assert.ok(html.includes('<optgroup label="── Chuẩn mực âm học (Target Curves) ──">'));
    assert.ok(html.includes('value="target-harman-2019"'));
    assert.ok(html.includes('value="target-diffuse-field"'));
    assert.ok(html.includes('value="target-warm-vocal"'));
    assert.ok(html.includes('value="target-basshead-club"'));
    assert.ok(html.includes('value="target-treble-air"'));
    assert.ok(html.includes('<optgroup label="── Cân chỉnh tai nghe (Headphone AutoEQ) ──">'));
  });

  await t.test('Fullscreen Roon Now Playing bottom dock unified into single-row layout', () => {
    assert.ok(html.includes('id="fullscreen-collapse-btn"'));
    assert.ok(html.includes('id="fullscreen-time-cur"'));
    assert.ok(html.includes('id="fullscreen-waveform"'));
    assert.ok(html.includes('id="fullscreen-time-dur"'));
    assert.ok(html.includes('id="fullscreen-zone-btn"'));
    assert.ok(html.includes('id="fullscreen-volume-btn"'));
  });

  await t.test('Floating panels and toasts have elevated z-index and collision-free clearance above player dock', () => {
    assert.ok(html.includes('id="mini-player-hud" class="fixed bottom-[140px]'));
    assert.ok(html.includes('id="eq-panel" class="fixed bottom-[140px]'));
    assert.ok(html.includes('id="sleep-panel" class="fixed bottom-[140px]'));
    assert.ok(html.includes('id="ambient-panel" class="fixed bottom-[140px]'));
    assert.ok(html.includes('id="toast" class="pointer-events-none fixed bottom-40 sm:bottom-44 left-1/2 z-[120]'));
  });

  await t.test('Audio Graph routing invariant is 100% preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph routing invariant must never be modified'
    );
  });
});
