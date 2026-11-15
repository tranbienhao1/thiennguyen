const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

test('Pha C: BPM Detection, Tempo Tiers & Harmonic Queue Sequencing Test Suite', async (t) => {
  await t.test('1. BPM_TEMPO_TIERS registry and getTempoTier categorization', () => {
    assert.ok(library.BPM_TEMPO_TIERS, 'BPM_TEMPO_TIERS registry must exist');
    assert.ok(library.BPM_TEMPO_TIERS.ambient_slow);
    assert.ok(library.BPM_TEMPO_TIERS.groove_mid);
    assert.ok(library.BPM_TEMPO_TIERS.upbeat_dance);
    assert.ok(library.BPM_TEMPO_TIERS.hyper_fast);

    assert.equal(library.getTempoTier(60).id, 'ambient_slow');
    assert.equal(library.getTempoTier(95).id, 'groove_mid');
    assert.equal(library.getTempoTier(128).id, 'upbeat_dance');
    assert.equal(library.getTempoTier(165).id, 'hyper_fast');
  });

  await t.test('2. estimateTrackBpmFromEnergyHistory calculates periodicity and confidence', () => {
    assert.equal(typeof library.estimateTrackBpmFromEnergyHistory, 'function');

    // Edge case: empty history
    const empty = library.estimateTrackBpmFromEnergyHistory([]);
    assert.equal(empty.bpm, 0);
    assert.equal(empty.confidence, 0);

    // Create periodic signal: at 30 fps, a beat every 15 frames = 120 BPM
    const fps = 30;
    const history = [];
    for (let i = 0; i < 90; i++) {
      history.push(i % 15 === 0 ? 1.0 : 0.05);
    }

    const res = library.estimateTrackBpmFromEnergyHistory(history, { fps });
    assert.equal(res.bpm, 120, `Expected 120 BPM, got ${res.bpm}`);
    assert.ok(res.confidence > 0.5, `Confidence should be high, got ${res.confidence}`);
    assert.equal(res.tempoTier.id, 'upbeat_dance');
  });

  await t.test('3. formatTempoEnergyBadge formats localized badge text', () => {
    assert.equal(typeof library.formatTempoEnergyBadge, 'function');

    const fallback = library.formatTempoEnergyBadge(null);
    assert.ok(fallback.includes('Chưa xác định'));

    const badge = library.formatTempoEnergyBadge({
      bpm: 124,
      confidence: 0.92,
      tempoTier: library.BPM_TEMPO_TIERS.upbeat_dance
    });
    assert.ok(badge.includes('124 BPM'));
    assert.ok(badge.includes('Sôi động / Nhảy'));
    assert.ok(badge.includes('92% tin cậy'));
  });

  await t.test('4. sequenceHarmonicBpmQueue sequences tracks for smooth transition', () => {
    assert.equal(typeof library.sequenceHarmonicBpmQueue, 'function');

    const tracks = [
      { id: 't1', title: 'Song 1', bpm: 130 },
      { id: 't2', title: 'Song 2', bpm: 85 },
      { id: 't3', title: 'Song 3', bpm: 110 },
      { id: 't4', title: 'Song 4', bpm: 140 }
    ];

    // smooth_asc
    const asc = library.sequenceHarmonicBpmQueue(tracks, null, 'smooth_asc');
    assert.deepEqual(asc.map(t => t.bpm), [85, 110, 130, 140]);

    // smooth_desc
    const desc = library.sequenceHarmonicBpmQueue(tracks, null, 'smooth_desc');
    assert.deepEqual(desc.map(t => t.bpm), [140, 130, 110, 85]);

    // nearest_neighbor with current track t3 (BPM 110)
    const current = tracks[2]; // t3
    const nearest = library.sequenceHarmonicBpmQueue(tracks, current, 'nearest_neighbor');
    assert.equal(nearest[0].id, 't3');
    // from 110, closest is 130 (diff 20) vs 85 (diff 25)
    assert.equal(nearest[1].bpm, 130);
  });

  await t.test('5. filterTracksByBpmTier filters by tempo range', () => {
    const tracks = [
      { id: 't1', bpm: 70 },
      { id: 't2', bpm: 95 },
      { id: 't3', bpm: 125 },
      { id: 't4', bpm: 155 }
    ];

    const dance = library.filterTracksByBpmTier(tracks, 'upbeat_dance');
    assert.equal(dance.length, 1);
    assert.equal(dance[0].id, 't3');

    const slow = library.filterTracksByBpmTier(tracks, 'ambient_slow');
    assert.equal(slow.length, 1);
    assert.equal(slow[0].id, 't1');
  });

  await t.test('6. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    // UI elements
    assert.ok(indexHtml.includes('id="room-bpm-badge"'), 'index.html must contain #room-bpm-badge');
    assert.ok(indexHtml.includes('id="queue-bpm-sort-btn"'), 'index.html must contain #queue-bpm-sort-btn');

    // Integration of estimateTrackBpmFromEnergyHistory and sequenceHarmonicBpmQueue
    assert.ok(indexHtml.includes('estimateTrackBpmFromEnergyHistory'), 'index.html must invoke estimateTrackBpmFromEnergyHistory');
    assert.ok(indexHtml.includes('sequenceHarmonicBpmQueue'), 'index.html must invoke sequenceHarmonicBpmQueue');

    // INVARIANT #1: state.crossfeedNodes.output.connect(state.context.destination)
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});
