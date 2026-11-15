const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');

test('Pha C — Dynamic Sonic Flow & Audiophile Smart Queue Matching Test Suite', async (t) => {
  const seedTrack = {
    id: 'track_seed',
    title: 'Midnight Reverie',
    artist: 'Luna Eclipse',
    album: 'Nocturnal Visions',
    genre: 'Ambient Electronic',
    bpm: 120,
    format: 'FLAC',
    duration: 240,
    sampleRate: 96000
  };

  const candidateA = {
    id: 'track_a',
    title: 'Solar Flare Ambient',
    artist: 'Starlight Dream',
    album: 'Cosmic Journey',
    genre: 'Ambient Electronic',
    bpm: 122, // very close BPM (+2)
    format: 'FLAC',
    duration: 250,
    sampleRate: 96000
  };

  const candidateB = {
    id: 'track_b',
    title: 'Acoustic Morning Dawn',
    artist: 'Folk Trio',
    album: 'Unplugged Sessions',
    genre: 'Acoustic Guitar Folk',
    bpm: 78, // distant BPM
    format: 'MP3',
    duration: 180,
    sampleRate: 44100
  };

  const candidateC = {
    id: 'track_c',
    title: 'Deep Synth Wave',
    artist: 'Cyber Pulse',
    album: 'Neon City',
    genre: 'Electronic Synth',
    bpm: 125, // moderately close BPM (+5)
    format: 'FLAC',
    duration: 230,
    sampleRate: 48000
  };

  await t.test('1. calculateSonicSimilarityScore computes multidimensional audio similarity accurately', () => {
    // Identical track must have 100% score
    assert.strictEqual(library.calculateSonicSimilarityScore(seedTrack, seedTrack), 100);
    assert.strictEqual(library.calculateSonicSimilarityScore(seedTrack, { id: 'track_seed' }), 100);

    // Highly compatible track (similar BPM + matching genre + lossless)
    const scoreA = library.calculateSonicSimilarityScore(seedTrack, candidateA);
    assert.ok(scoreA >= 80, `Expected scoreA >= 80, got ${scoreA}`);

    // Less compatible track (distant BPM + different genre + MP3)
    const scoreB = library.calculateSonicSimilarityScore(seedTrack, candidateB);
    assert.ok(scoreB < scoreA, `Expected scoreB (${scoreB}) < scoreA (${scoreA})`);

    // Moderately compatible track
    const scoreC = library.calculateSonicSimilarityScore(seedTrack, candidateC);
    assert.ok(scoreC > scoreB, `Expected scoreC (${scoreC}) > scoreB (${scoreB})`);

    // Edge cases
    assert.strictEqual(library.calculateSonicSimilarityScore(null, candidateA), 0);
    assert.strictEqual(library.calculateSonicSimilarityScore(seedTrack, null), 0);
  });

  await t.test('2. generateSonicFlowQueue sequences candidate tracks in optimal sonic flow order', () => {
    const candidates = [candidateB, candidateA, candidateC];
    const flow = library.generateSonicFlowQueue(seedTrack, candidates);

    assert.strictEqual(flow.orderedTracks.length, 3);
    assert.strictEqual(flow.orderedTracks[0].id, 'track_a', 'Most similar track (candidateA) should be first');
    assert.ok(flow.avgSimilarityScore > 0);
    assert.strictEqual(flow.transitions.length, 3);

    // Empty list handling
    const emptyFlow = library.generateSonicFlowQueue(seedTrack, []);
    assert.strictEqual(emptyFlow.orderedTracks.length, 0);
    assert.strictEqual(emptyFlow.avgSimilarityScore, 0);

    // Seed track inside candidates should not be duplicated
    const poolWithSeed = [candidateA, seedTrack, candidateB];
    const flowDedup = library.generateSonicFlowQueue(seedTrack, poolWithSeed);
    assert.strictEqual(flowDedup.orderedTracks.length, 2);
    assert.ok(!flowDedup.orderedTracks.some(t => t.id === seedTrack.id));
  });

  await t.test('3. formatSonicFlowBadge formats localized telemetry text', () => {
    const badgeHigh = library.formatSonicFlowBadge(92);
    assert.ok(badgeHigh.includes('92%'));
    assert.ok(badgeHigh.includes('Hòa quyện'));

    const badgeMid = library.formatSonicFlowBadge(72);
    assert.ok(badgeMid.includes('72%'));
    assert.ok(badgeMid.includes('Tương thích tốt'));

    const badgeLow = library.formatSonicFlowBadge(45);
    assert.ok(badgeLow.includes('45%'));
    assert.ok(badgeLow.includes('Đa dạng'));
  });

  await t.test('4. filterTracksBySonicRange filters and sorts candidate tracks by threshold', () => {
    const candidates = [candidateB, candidateA, candidateC];
    const filtered = library.filterTracksBySonicRange(seedTrack, candidates, 70);

    assert.ok(filtered.length >= 1);
    assert.strictEqual(filtered[0].id, 'track_a');
    assert.ok(!filtered.some(t => t.id === 'track_b'), 'candidateB should be filtered out by threshold 70');

    // Safe fallbacks
    assert.deepStrictEqual(library.filterTracksBySonicRange(null, candidates), []);
    assert.deepStrictEqual(library.filterTracksBySonicRange(seedTrack, null), []);
  });

  await t.test('5. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    assert.ok(indexHtml.includes('id="sonic-flow-btn"'), 'index.html must contain #sonic-flow-btn in Queue panel');
    assert.ok(indexHtml.includes('library.generateSonicFlowQueue'), 'index.html must invoke generateSonicFlowQueue on #sonic-flow-btn click');

    // CRITICAL AUDIO INVARIANT
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio routing invariant state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved'
    );
  });
});
