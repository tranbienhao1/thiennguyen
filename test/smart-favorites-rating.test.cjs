const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('../library-utils.js');

test('Pha C: Multi-Tier Favorites Collections & Smart Track Rating Analytics Test Suite', async (t) => {
  await t.test('1. calculateTrackEngagementRating computes accurate scores & tiers', () => {
    // Test 1a: Track with 5-star user rating, FLAC format, high play count
    const t1 = { id: 1, title: 'Hotel California', format: 'FLAC', duration: 390 };
    const res1 = library.calculateTrackEngagementRating(t1, 5, {
      playCount: 10,
      skipCount: 0,
      completionRate: 1.0,
      isFavorite: true
    });

    assert.equal(res1.validUserRating, 5);
    assert.equal(res1.audiophileBonus, 5);
    assert.equal(res1.tier, 'masterpiece');
    assert.equal(res1.tierLabel, 'Tuyệt tác Masterpiece');
    assert.ok(res1.engagementScore >= 90, `Score should be >= 90, got ${res1.engagementScore}`);
    assert.ok(res1.compositeStars >= 4.8, `Composite stars should be >= 4.8, got ${res1.compositeStars}`);

    // Test 1b: Track without user rating but frequently played
    const t2 = { id: 2, title: 'Random Hit', format: 'MP3', duration: 200 };
    const res2 = library.calculateTrackEngagementRating(t2, 0, {
      playCount: 4,
      skipCount: 0,
      completionRate: 0.9,
      isFavorite: true
    });

    assert.equal(res2.validUserRating, 0);
    assert.equal(res2.audiophileBonus, 2);
    assert.ok(res2.engagementScore > 0);
    assert.ok(['engaged', 'loved_gem'].includes(res2.tier));

    // Test 1c: Empty/unplayed track
    const t3 = { id: 3, title: 'New Track', format: 'AAC' };
    const res3 = library.calculateTrackEngagementRating(t3, 0, {
      playCount: 0,
      skipCount: 0,
      completionRate: 0,
      isFavorite: false
    });
    assert.equal(res3.engagementScore, 0);
    assert.equal(res3.compositeStars, 0);
    assert.equal(res3.tier, 'unranked');

    // Test 1d: Heavy skip penalty
    const t4 = { id: 4, title: 'Skipped Song', format: 'FLAC' };
    const res4 = library.calculateTrackEngagementRating(t4, 3, {
      playCount: 2,
      skipCount: 5,
      completionRate: 0.2,
      isFavorite: false
    });
    assert.ok(res4.engagementScore < 50);
  });

  await t.test('2. categorizeFavoritesByMoodQuality correctly stratifies favorite tracks', () => {
    const tracks = [
      { id: 't1', title: 'Audiophile Masterpiece', format: 'DSD', playCount: 8, skipCount: 0 },
      { id: 't2', title: 'Acoustic FLAC Gem', format: 'FLAC', playCount: 5, skipCount: 0 },
      { id: 't3', title: 'Forgotten Favorite', format: 'MP3', playCount: 1, skipCount: 0 },
      { id: 't4', title: 'Casual Track', format: 'MP3', playCount: 1, skipCount: 2 },
      { id: 't5', title: 'Five Star Unfavorited', format: 'FLAC', playCount: 0, skipCount: 0 }
    ];

    const favSet = new Set(['t1', 't2', 't3']);
    const ratingsMap = {
      t1: 5,
      t2: 4,
      t5: 5
    };
    const playStatsMap = {
      t1: { playCount: 8, skipCount: 0 },
      t2: { playCount: 5, skipCount: 0 },
      t3: { playCount: 1, skipCount: 0 },
      t4: { playCount: 1, skipCount: 2 }
    };

    const categorized = library.categorizeFavoritesByMoodQuality(tracks, favSet, ratingsMap, playStatsMap);

    // t1, t2, t3 are in favSet, t5 has rating 5 -> all 4 should be in .all
    assert.equal(categorized.all.length, 4);
    assert.ok(categorized.all.some(t => t.id === 't1'));
    assert.ok(categorized.all.some(t => t.id === 't5'));

    // Masterpieces: t1 (rating 5), t5 (rating 5)
    assert.ok(categorized.masterpieces.some(t => t.id === 't1'));
    assert.ok(categorized.masterpieces.some(t => t.id === 't5'));

    // Audiophile Lossless: t1 (DSD), t2 (FLAC), t5 (FLAC)
    assert.ok(categorized.audiophileLossless.some(t => t.id === 't1'));
    assert.ok(categorized.audiophileLossless.some(t => t.id === 't2'));

    // Frequent Gems: t1 (playCount 8), t2 (playCount 5)
    assert.ok(categorized.frequentGems.some(t => t.id === 't1'));
    assert.ok(categorized.frequentGems.some(t => t.id === 't2'));

    // Rediscover: t3 (fav with playCount 1)
    assert.ok(categorized.rediscover.some(t => t.id === 't3'));

    // Counts object
    assert.equal(categorized.counts.all, 4);
    assert.ok(categorized.counts.masterpieces >= 2);
    assert.ok(categorized.counts.frequentGems >= 2);
  });

  await t.test('3. formatTrackEngagementTelemetry returns localized string', () => {
    const report = {
      compositeStars: 4.8,
      engagementScore: 92,
      tierLabel: 'Tuyệt tác Masterpiece',
      validUserRating: 5,
      playCount: 18
    };

    const telemetry = library.formatTrackEngagementTelemetry(report);
    assert.ok(telemetry.includes('4.8★'));
    assert.ok(telemetry.includes('92%'));
    assert.ok(telemetry.includes('Tuyệt tác Masterpiece'));
    assert.ok(telemetry.includes('5★ Thủ công'));
    assert.ok(telemetry.includes('18 lượt'));

    // Null safety
    assert.equal(library.formatTrackEngagementTelemetry(null), '⭐ Đánh giá: --★ (Chưa xếp hạng)');
  });

  await t.test('4. filterTracksByFocus handles smart favorites criteria', () => {
    const tracks = [
      { id: '1', title: 'Song 1', format: 'FLAC', rating: 5, isFavorite: true, playCount: 10 },
      { id: '2', title: 'Song 2', format: 'MP3', rating: 3, isFavorite: true, playCount: 4 },
      { id: '3', title: 'Song 3', format: 'DSD', rating: 4, isFavorite: true, playCount: 1 }
    ];

    const favSet = new Set(['1', '2', '3']);
    const ratings = { '1': 5, '2': 3, '3': 4 };
    const playStats = {
      '1': { playCount: 10, skipCount: 0 },
      '2': { playCount: 4, skipCount: 0 },
      '3': { playCount: 1, skipCount: 0 }
    };

    const masterpieces = library.filterTracksByFocus(tracks, 'fav-masterpiece', { favorites: favSet, ratings });
    assert.equal(masterpieces.length, 2); // '1' has 5, '3' is fav with rating 4

    const hiresFav = library.filterTracksByFocus(tracks, 'fav-hires', { favorites: favSet, ratings });
    assert.equal(hiresFav.length, 2); // '1' (FLAC) and '3' (DSD)

    const gems = library.filterTracksByFocus(tracks, 'fav-gems', { favorites: favSet, ratings, playStats });
    assert.equal(gems.length, 2); // '1' and '2' have playCount >= 3

    const rediscover = library.filterTracksByFocus(tracks, 'fav-rediscover', { favorites: favSet, ratings, playStats });
    assert.equal(rediscover.length, 1);
    assert.equal(rediscover[0].id, '3');
  });

  await t.test('5. exportAppConfiguration & mergeRestoredConfiguration preserves trackRatings', () => {
    const state = {
      favorites: new Set(['a', 'b']),
      trackRatings: { 'a': 5, 'b': 4 },
      crossfadeSeconds: 4
    };

    const exported = library.exportAppConfiguration(state);
    assert.deepEqual(exported.trackRatings, { 'a': 5, 'b': 4 });

    const targetState = {
      favorites: new Set(),
      trackRatings: {}
    };

    const mergeResult = library.mergeRestoredConfiguration(targetState, exported);
    assert.equal(mergeResult.restoredRatingsCount, 2);
    assert.equal(targetState.trackRatings['a'], 5);
    assert.equal(targetState.trackRatings['b'], 4);
  });

  await t.test('6. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const htmlPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // 1. Audio Graph Invariant check
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph Invariant state.crossfeedNodes.output.connect(state.context.destination) must be intact'
    );

    // 2. DOM elements check
    assert.ok(html.includes('id="room-rating"'), 'Must have room-rating element');
    assert.ok(html.includes('id="room-engagement-badge"'), 'Must have room-engagement-badge element');
    assert.ok(html.includes('data-focus="fav-masterpiece"'), 'Must have fav-masterpiece focus pill');
    assert.ok(html.includes('data-focus="fav-hires"'), 'Must have fav-hires focus pill');
    assert.ok(html.includes('data-focus="fav-gems"'), 'Must have fav-gems focus pill');
  });
});
