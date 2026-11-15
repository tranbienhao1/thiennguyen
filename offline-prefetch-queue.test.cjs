const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library-utils.js');

test('Pha D: Priority-Weighted Offline Queue Prefetch Scheduler & Adaptive Concurrency Test Suite', async (t) => {
  await t.test('1. calculatePrefetchPriorityScore models queue decay & audiophile weighting', () => {
    const nextTrack = { id: 'track-1', title: 'Song 1', format: 'FLAC', rating: 5, isFavorite: true };
    const resNext = library.calculatePrefetchPriorityScore(nextTrack, 1, {
      networkTier: 'high-speed',
      isAudioPlaying: true
    });

    // Next track (index 1) with 5 stars, favorite and FLAC on high-speed network should be critical priority (>= 75)
    assert.ok(resNext.priorityScore >= 75, `Expected score >= 75, got ${resNext.priorityScore}`);
    assert.equal(resNext.priorityTier, 'critical');
    assert.equal(resNext.distanceScore, 50);
    assert.equal(resNext.favoriteScore, 12);
    assert.ok(resNext.audiophileScore >= 6);

    // Later track (index 4) should have significantly decayed distance score
    const laterTrack = { id: 'track-4', title: 'Song 4', format: 'MP3' };
    const resLater = library.calculatePrefetchPriorityScore(laterTrack, 4, {
      networkTier: 'high-speed'
    });
    assert.ok(resLater.priorityScore < resNext.priorityScore);
    assert.ok(resLater.distanceScore <= 20);

    // Constrained network should defer index > 1
    const resConstrained = library.calculatePrefetchPriorityScore(laterTrack, 2, {
      networkTier: 'constrained'
    });
    assert.equal(resConstrained.priorityScore, 0);
    assert.equal(resConstrained.priorityTier, 'low');

    // Offline network should give 0
    const resOffline = library.calculatePrefetchPriorityScore(nextTrack, 1, {
      networkTier: 'offline'
    });
    assert.equal(resOffline.priorityScore, 0);

    // Edge cases: null track or invalid index
    assert.equal(library.calculatePrefetchPriorityScore(null, 1).priorityScore, 0);
    assert.equal(library.calculatePrefetchPriorityScore(nextTrack, 0).priorityScore, 0);
  });

  await t.test('2. evaluateCachePipelineConcurrency enforces safe thread bounds for Web Audio', () => {
    // When audio is actively playing, must throttle to exactly 1 concurrent thread to prevent glitching
    const playingConc = library.evaluateCachePipelineConcurrency(true, 'high-speed');
    assert.equal(playingConc.maxConcurrent, 1);
    assert.ok(playingConc.safeDelayMs >= 200);
    assert.equal(playingConc.isAudioPlaying, true);

    // When paused, can expand to 3 threads on high-speed network
    const idleHighConc = library.evaluateCachePipelineConcurrency(false, 'high-speed');
    assert.equal(idleHighConc.maxConcurrent, 3);
    assert.equal(idleHighConc.isAudioPlaying, false);

    // On standard network while paused, allows 2 threads
    const idleStandardConc = library.evaluateCachePipelineConcurrency(false, 'standard');
    assert.equal(idleStandardConc.maxConcurrent, 2);

    // Offline returns 0 concurrency
    const offlineConc = library.evaluateCachePipelineConcurrency(true, 'offline');
    assert.equal(offlineConc.maxConcurrent, 0);
  });

  await t.test('3. scheduleOfflineQueuePrefetch schedules tasks, skips cached & calculates volume', () => {
    const queue = [
      { id: 't0', title: 'Current Song', format: 'FLAC' },
      { id: 't1', title: 'Next Song (Cached)', format: 'FLAC' },
      { id: 't2', title: 'Upcoming Hi-Res', format: 'DSD', rating: 5, isFavorite: true },
      { id: 't3', title: 'Third Song', format: 'MP3' }
    ];

    const cached = new Set(['t1']);
    const favSet = new Set(['t2']);
    const ratings = { t2: 5 };

    const report = library.scheduleOfflineQueuePrefetch(queue, 't0', cached, {
      isAudioPlaying: true,
      networkTier: 'high-speed',
      favorites: favSet,
      ratings,
      maxLookahead: 5
    });

    assert.equal(report.cachedCount, 1); // t1 is cached
    assert.equal(report.pendingCount, 2); // t2 and t3 need prefetch
    assert.equal(report.tasks.length, 2);

    // t2 (high priority DSD 5-star) should be sorted first
    assert.equal(report.tasks[0].trackId, 't2');
    assert.ok(report.tasks[0].priorityScore > report.tasks[1].priorityScore);
    assert.ok(report.totalEstimatedBytes > 0);
    assert.equal(report.concurrency.maxConcurrent, 1); // since isAudioPlaying = true
  });

  await t.test('4. formatPrefetchQueueTelemetry formats localized summary', () => {
    const report = {
      pendingCount: 3,
      cachedCount: 2,
      totalEstimatedBytes: 36 * 1024 * 1024,
      concurrency: {
        maxConcurrent: 1,
        isAudioPlaying: true
      }
    };

    const telemetry = library.formatPrefetchQueueTelemetry(report);
    assert.ok(telemetry.includes('3 bài chờ'));
    assert.ok(telemetry.includes('1 luồng'));
    assert.ok(telemetry.includes('Đang phát'));
    assert.ok(telemetry.includes('2 bài sẵn'));
    assert.ok(telemetry.includes('~36.0 MB'));

    // Null safety
    assert.equal(library.formatPrefetchQueueTelemetry(null), '⚡ Lập lịch nạp: Không có bài chờ');
  });

  await t.test('5. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const htmlPath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // 1. Audio Graph Invariant check
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph Invariant state.crossfeedNodes.output.connect(state.context.destination) must be intact'
    );

    // 2. DOM elements check
    assert.ok(html.includes('id="schedule-prefetch-queue-btn"'), 'Must have schedule-prefetch-queue-btn');
    assert.ok(html.includes('id="prefetch-queue-status"'), 'Must have prefetch-queue-status element');
  });
});
