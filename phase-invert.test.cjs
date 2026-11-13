// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library-utils.js');

test('Reversible Phase Invert - Library pure utilities', async t => {
  await t.test('clampPhaseInvert parses boolean, string and numeric representations correctly', () => {
    assert.equal(library.clampPhaseInvert(true), true);
    assert.equal(library.clampPhaseInvert(false), false);
    assert.equal(library.clampPhaseInvert('true'), true);
    assert.equal(library.clampPhaseInvert('false'), false);
    assert.equal(library.clampPhaseInvert('1'), true);
    assert.equal(library.clampPhaseInvert('0'), false);
    assert.equal(library.clampPhaseInvert(-1), true);
    assert.equal(library.clampPhaseInvert(1), false);
    assert.equal(library.clampPhaseInvert(null), false);
    assert.equal(library.clampPhaseInvert(undefined), false);
  });

  await t.test('formatPhaseInvert provides accurate Vietnamese audiophile labels', () => {
    assert.equal(library.formatPhaseInvert(true), 'Ø 180° (Đảo pha)');
    assert.equal(library.formatPhaseInvert(false), '0° (Chuẩn)');
  });

  await t.test('computeSignalPath reports Phase Invert Ø in DSP stage when active', () => {
    const track = { title: 'Audiophile Track', format: 'FLAC', sampleRate: 192000, bitDepth: 24 };
    const pathData = library.computeSignalPath(track, {
      phaseInvert: true
    });
    assert.equal(pathData.hasDsp, true);
    const dspStep = pathData.steps.find(s => s.stage === 'dsp');
    assert.ok(dspStep);
    assert.ok(dspStep.description.includes('Đảo pha: Ø 180°'));
  });

  await t.test('computeSignalPath maintains bit-perfect status when phaseInvert is false', () => {
    const track = { title: 'Audiophile Track', format: 'FLAC', sampleRate: 44100, bitDepth: 16 };
    const pathData = library.computeSignalPath(track, {
      phaseInvert: false
    });
    assert.equal(pathData.hasDsp, false);
    const dspStep = pathData.steps.find(s => s.stage === 'dsp');
    assert.ok(dspStep);
    assert.equal(dspStep.badge, 'Bit-perfect');
  });
});

test('Reversible Phase Invert - DOM and Script Integration', async t => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  await t.test('DOM elements exist in #eq-panel', () => {
    assert.ok(html.includes('id="phase-invert-toggle"'), 'Checkbox #phase-invert-toggle must exist');
    assert.ok(html.includes('id="phase-invert-badge"'), 'Badge #phase-invert-badge must exist');
    assert.ok(html.includes('Phase Invert Ø'), 'Label Phase Invert Ø must exist');
  });

  await t.test('Script declares setPhaseInvert and updates state', () => {
    assert.ok(html.includes('function setPhaseInvert('), 'setPhaseInvert must be declared');
    assert.ok(html.includes('function updatePhaseInvertUi('), 'updatePhaseInvertUi must be declared');
    assert.ok(html.includes('phaseInvert: false'), 'state must initialize phaseInvert');
    assert.ok(html.includes('nocturne-phase-invert'), 'localStorage key nocturne-phase-invert must be handled');
  });

  await t.test('Audio Routing Invariant is strictly preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio routing invariant must be strictly preserved'
    );
  });
});
