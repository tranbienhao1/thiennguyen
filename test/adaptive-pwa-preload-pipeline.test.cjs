const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha D: scheduleMultiTrackPreload allocates prioritized pipeline adapting to network & format', () => {
  const queue = [
    { id: 'track-0', title: 'Bài đang phát', artist: 'Ca sĩ A', file: { size: 28000000 } },
    { id: 'track-1', title: 'Bài kế tiếp', artist: 'Ca sĩ B', file: { size: 32000000 } },
    { id: 'track-2', title: 'Bản DSD Hi-Res', artist: 'DSD Master', isDsd: true },
    { id: 'track-3', title: 'Bài thứ tư', artist: 'Ca sĩ D' },
    { id: 'track-4', title: 'Bài thứ năm', artist: 'Ca sĩ E' }
  ];

  // 1. Boundary condition: empty or invalid index
  const emptyRes = library.scheduleMultiTrackPreload([], 0);
  assert.equal(emptyRes.pipeline.length, 0);
  assert.equal(emptyRes.totalEstimatedBytes, 0);

  const invalidRes = library.scheduleMultiTrackPreload(queue, -1);
  assert.equal(invalidRes.pipeline.length, 0);

  // 2. High-bandwidth (4G/Wi-Fi)
  const highRes = library.scheduleMultiTrackPreload(queue, 0, { networkType: '4g' });
  assert.equal(highRes.networkTier, 'high-bandwidth');
  assert.equal(highRes.allowedConcurrency, 2);
  assert.equal(highRes.pipeline.length, 3); // Lookahead 3 tracks: track 1, 2, 3

  // Track +1: immediate full
  assert.equal(highRes.pipeline[0].trackId, 'track-1');
  assert.equal(highRes.pipeline[0].priority, 'immediate');
  assert.equal(highRes.pipeline[0].preloadType, 'full');
  assert.equal(highRes.pipeline[0].estimatedBytes, 32000000);

  // Track +2: DSD first-slice (3MB)
  assert.equal(highRes.pipeline[1].trackId, 'track-2');
  assert.equal(highRes.pipeline[1].priority, 'high');
  assert.equal(highRes.pipeline[1].preloadType, 'first-slice');
  assert.equal(highRes.pipeline[1].estimatedBytes, 3 * 1024 * 1024);

  // Track +3: metadata
  assert.equal(highRes.pipeline[2].trackId, 'track-3');
  assert.equal(highRes.pipeline[2].priority, 'medium');
  assert.equal(highRes.pipeline[2].preloadType, 'metadata');

  // 3. SaveData mode
  const saveRes = library.scheduleMultiTrackPreload(queue, 0, { saveData: true });
  assert.equal(saveRes.networkTier, 'constrained');
  assert.equal(saveRes.allowedConcurrency, 1);
  assert.equal(saveRes.pipeline[0].preloadType, 'metadata');
  assert.equal(saveRes.pipeline[1].preloadType, 'skip');
  assert.ok(saveRes.totalEstimatedBytes < 50000);

  // 4. Low-bandwidth (2G)
  const lowRes = library.scheduleMultiTrackPreload(queue, 0, { networkType: '2g' });
  assert.equal(lowRes.networkTier, 'low-bandwidth');
  assert.equal(lowRes.allowedConcurrency, 1);
  assert.equal(lowRes.pipeline[0].preloadType, 'first-slice');
  assert.equal(lowRes.pipeline[1].preloadType, 'metadata');
  assert.equal(lowRes.pipeline[2].preloadType, 'skip');
});

test('Pha D: defragmentCacheDatabase detects orphaned slices, reclaims bytes & computes integrity score', () => {
  const activeTracks = [
    { id: 't1', url: 'https://example.com/1.flac', title: 'Ánh Sao Đêm' },
    { id: 't2', url: 'https://example.com/2.flac', title: 'Vết Mưa' }
  ];

  const now = Date.now();
  const entries = [
    { key: 't1', size: 1048576, timestamp: now - 1000 }, // Valid trackId
    { key: 'custom-key', url: 'https://example.com/2.flac', size: 1048576, timestamp: now - 5000 }, // Valid url
    { key: 'orphan-1', size: 2097152, timestamp: now - 10000 }, // Orphaned
    { key: 't1-expired', trackId: 't1', size: 1048576, timestamp: now - (10 * 24 * 60 * 60 * 1000) } // Stale > 7 days
  ];

  const result = library.defragmentCacheDatabase(entries, activeTracks, { now });

  assert.equal(result.totalEntries, 4);
  assert.equal(result.validCount, 2);
  assert.equal(result.reclaimableCount, 2);
  assert.deepEqual(result.orphanedKeys, ['orphan-1', 't1-expired']);
  assert.equal(result.reclaimableBytes, 2097152 + 1048576);
  assert.equal(result.integrityScore, 50); // 2/4 = 50%
  assert.equal(result.fragmentationRatio, 0.5);
  assert.match(result.summary, /Phát hiện 2 lát rác/);
});

test('Pha D: calculatePreloadReadiness & formatPreloadReadinessBadge assess gapless playback health', () => {
  // 1. No next track
  const idle = library.calculatePreloadReadiness(null, null);
  assert.equal(idle.readinessScore, 0);
  assert.equal(idle.status, 'unbuffered');
  assert.equal(idle.gaplessFeasible, false);

  const idleBadge = library.formatPreloadReadinessBadge(idle);
  assert.equal(idleBadge.isReady, false);
  assert.match(idleBadge.colorClass, /text-zinc-400/);

  // 2. High readiness (cached blob + readyState 4 + 16s buffer lookahead)
  const readyTrack = { id: 'next', firstSliceCached: true };
  const mockStandbyAudio = {
    readyState: 4,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 16.5
    }
  };

  const high = library.calculatePreloadReadiness(readyTrack, mockStandbyAudio);
  assert.equal(high.readinessScore, 100); // 40 + 40 + 20 = 100
  assert.equal(high.status, 'instant');
  assert.equal(high.gaplessFeasible, true);

  const highBadge = library.formatPreloadReadinessBadge(high);
  assert.equal(highBadge.isReady, true);
  assert.match(highBadge.text, /Gapless:/);
  assert.match(highBadge.colorClass, /text-emerald-300/);

  // 3. Streaming/partial buffer (no cached blob, readyState 2, lookahead 4s)
  const partialTrack = { id: 'stream-next' };
  const partialAudio = {
    readyState: 2,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 4.0
    }
  };

  const partial = library.calculatePreloadReadiness(partialTrack, partialAudio);
  assert.equal(partial.readinessScore, 20); // 15 + 5 = 20
  assert.equal(partial.status, 'streaming');
  assert.equal(partial.gaplessFeasible, false);

  const partialBadge = library.formatPreloadReadinessBadge(partial);
  assert.equal(partialBadge.isReady, false);
  assert.match(partialBadge.text, /Đang nạp:/);
  assert.match(partialBadge.colorClass, /text-amber-300/);
});

test('Pha D & Audio Engine Invariant: PWA Preload & Defragmentation DOM & Script Integration', () => {
  // 1. UI Elements in index.html
  assert.ok(indexHtml.includes('id="defrag-cache-btn"'), '#defrag-cache-btn must exist');
  assert.ok(indexHtml.includes('id="storage-defrag-summary"'), '#storage-defrag-summary must exist');
  assert.ok(indexHtml.includes('id="cache-integrity-badge"'), '#cache-integrity-badge must exist');
  assert.ok(indexHtml.includes('id="cache-defrag-desc"'), '#cache-defrag-desc must exist');
  assert.ok(indexHtml.includes('id="room-preload-readiness"'), '#room-preload-readiness badge must exist');

  // 2. Script wiring
  assert.ok(indexHtml.includes("library.defragmentCacheDatabase"), 'Script must invoke defragmentCacheDatabase on defrag-cache-btn click');
  assert.ok(indexHtml.includes("library.scheduleMultiTrackPreload"), 'Script must invoke scheduleMultiTrackPreload during preload phase');
  assert.ok(indexHtml.includes("library.calculatePreloadReadiness"), 'Script must invoke calculatePreloadReadiness in timeupdate');
  assert.ok(indexHtml.includes("library.formatPreloadReadinessBadge"), 'Script must invoke formatPreloadReadinessBadge');

  // 3. CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});
