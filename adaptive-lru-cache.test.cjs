const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library-utils.js');

test('Pha D: calculateAdaptiveCacheLimits adjusts bounds based on disk quota and low space', () => {
  // Low space or critical usage (>= 90%)
  const emergency = library.calculateAdaptiveCacheLimits({ percent: 92, isLowSpace: false });
  assert.equal(emergency.maxEntries, 8);
  assert.equal(emergency.maxBytes, 8 * 1024 * 1024);
  assert.equal(emergency.mode, 'emergency_compaction');

  const lowFlag = library.calculateAdaptiveCacheLimits({ percent: 50 }, true);
  assert.equal(lowFlag.mode, 'emergency_compaction');

  // Conservative usage (75% - 89%)
  const conservative = library.calculateAdaptiveCacheLimits({ percent: 80, isLowSpace: false });
  assert.equal(conservative.maxEntries, 14);
  assert.equal(conservative.maxBytes, 14 * 1024 * 1024);
  assert.equal(conservative.mode, 'conservative');

  // Normal / Optimal (< 75%)
  const optimal = library.calculateAdaptiveCacheLimits({ percent: 35, isLowSpace: false });
  assert.equal(optimal.maxEntries, 20);
  assert.equal(optimal.maxBytes, 20 * 1024 * 1024);
  assert.equal(optimal.mode, 'optimal');
});

test('Pha D: computeLruCacheEviction purges least recently accessed entries first', () => {
  const entries = [
    { key: 'track_1', size: 1000, lastAccessedAt: 500, savedAt: 100 },
    { key: 'track_2', size: 1500, lastAccessedAt: 100, savedAt: 50 },  // oldest accessed
    { key: 'track_3', size: 2000, lastAccessedAt: 800, savedAt: 700 },  // newest accessed
    { key: 'track_4', size: 1200, lastAccessedAt: 300, savedAt: 200 }
  ];

  // Limit to 2 entries
  const res = library.computeLruCacheEviction(entries, 2, 100000);
  assert.deepEqual(res.keysToEvict, ['track_2', 'track_4']);
  assert.equal(res.freedBytes, 2700);
  assert.equal(res.remainingCount, 2);

  // Pinned entries protection (e.g. current song track_2 should be preserved if unpinned items can be evicted)
  const pinnedRes = library.computeLruCacheEviction(entries, 3, 100000, { pinnedKeys: ['track_2'] });
  assert.ok(!pinnedRes.keysToEvict.includes('track_2'), 'Pinned track_2 must not be evicted if others can be removed');
  assert.deepEqual(pinnedRes.keysToEvict, ['track_4']);
});

test('Pha D: formatCacheTelemetry provides clear latency and size diagnostics', () => {
  assert.match(library.formatCacheTelemetry(true, 0.4, 1024 * 1024), /Cache HIT · 1.0 MB · <1ms/);
  assert.match(library.formatCacheTelemetry(true, 12.8, 512 * 1024), /Cache HIT · 512.0 KB · 12.8ms/);
  assert.match(library.formatCacheTelemetry(false, 154.2), /Cache MISS · Mạng \(154.2ms\)/);
  assert.match(library.formatCacheTelemetry(false, 0), /Cache MISS · Mạng \(đang tải\)/);
});

test('Pha D: evaluateStorageHealth grades system storage state and quota', () => {
  const healthy = library.evaluateStorageHealth({ healthScore: 95 }, { percent: 25, isLowSpace: false, formattedUsage: '45 MB' });
  assert.equal(healthy.grade, 'A+');
  assert.equal(healthy.statusLabel, 'Tối ưu');

  const warning = library.evaluateStorageHealth({ healthScore: 70 }, { percent: 82, isLowSpace: false, formattedUsage: '4.1 GB' });
  assert.equal(warning.grade, 'C');
  assert.equal(warning.statusLabel, 'Cần dọn dẹp');

  const critical = library.evaluateStorageHealth({ healthScore: 30 }, { percent: 94, isLowSpace: true, formattedUsage: '9.8 GB' });
  assert.equal(critical.grade, 'D');
  assert.equal(critical.statusLabel, 'Nguy cơ đầy đĩa');
});

test('Pha D & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  // CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});
