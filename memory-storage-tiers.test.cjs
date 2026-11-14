const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Pha D: auditMemoryLeaks identifies unreferenced zombie Object URLs', () => {
  const trackedUrls = new Set([
    'blob:http://localhost/track-playing-1',
    'blob:http://localhost/track-standby-2',
    'blob:http://localhost/track-queued-3',
    'blob:http://localhost/track-zombie-4',
    'blob:http://localhost/track-zombie-5',
    'https://api.example.com/stream.mp3' // Non-blob should not be classified as leaked blob
  ]);

  const activeRefs = {
    currentTrackUrl: 'blob:http://localhost/track-playing-1',
    standbyTrackUrl: 'blob:http://localhost/track-standby-2',
    queueUrls: ['blob:http://localhost/track-queued-3'],
    activeDeckUrls: []
  };

  const audit = library.auditMemoryLeaks(trackedUrls, activeRefs);

  assert.equal(audit.totalTracked, 6);
  assert.equal(audit.activeCount, 4); // 3 active blobs + 1 non-blob ignored
  assert.equal(audit.leakedCount, 2);
  assert.equal(audit.hasLeaks, true);
  assert.deepEqual(audit.leakedUrls.sort(), [
    'blob:http://localhost/track-zombie-4',
    'blob:http://localhost/track-zombie-5'
  ].sort());
});

test('Pha D: pruneUnreferencedObjectUrls revokes unreferenced URLs and purges them from Set', () => {
  const trackedUrls = new Set([
    'blob:http://localhost/active-deck',
    'blob:http://localhost/zombie-1',
    'blob:http://localhost/zombie-2'
  ]);

  const revokedList = [];
  const mockRevoke = url => revokedList.push(url);

  const activeRefs = {
    currentTrackUrl: 'blob:http://localhost/active-deck',
    standbyTrackUrl: null,
    queueUrls: []
  };

  const result = library.pruneUnreferencedObjectUrls(trackedUrls, activeRefs, mockRevoke);

  assert.equal(result.revokedCount, 2);
  assert.equal(result.remainingCount, 1);
  assert.equal(trackedUrls.size, 1);
  assert.ok(trackedUrls.has('blob:http://localhost/active-deck'));
  assert.deepEqual(revokedList.sort(), [
    'blob:http://localhost/zombie-1',
    'blob:http://localhost/zombie-2'
  ].sort());

  // Test formatMemoryAuditSummary
  const summary = library.formatMemoryAuditSummary(result);
  assert.ok(summary.includes('Đã giải phóng 2 Blob URL rác'));
});

test('Pha D: STORAGE_TIERS and categorizeStorageItem properly classify app data', () => {
  assert.ok(library.STORAGE_TIERS);
  assert.ok(library.STORAGE_TIERS.TIER_1_CRITICAL);
  assert.ok(library.STORAGE_TIERS.TIER_2_MEDIA_CACHE);
  assert.ok(library.STORAGE_TIERS.TIER_3_ENRICHMENT);

  // Critical items
  assert.equal(library.categorizeStorageItem('session:current_playback'), 'tier1_critical');
  assert.equal(library.categorizeStorageItem('user_history_entry', { store: 'history' }), 'tier1_critical');
  assert.equal(library.categorizeStorageItem('eq_preset_settings'), 'tier1_critical');

  // Media cache items
  assert.equal(library.categorizeStorageItem('slice:track_12345'), 'tier2_media');
  assert.equal(library.categorizeStorageItem('dsd_slice_track_88'), 'tier2_media');
  assert.equal(library.categorizeStorageItem('flac_chunk', { isSlice: true }), 'tier2_media');

  // Enrichment items
  assert.equal(library.categorizeStorageItem('cover:album_999'), 'tier3_enrichment');
  assert.equal(library.categorizeStorageItem('lyrics:lrc_track_12'), 'tier3_enrichment');
});

test('Pha D: calculateStorageTierMetrics computes tiered breakdown and health score', () => {
  const items = [
    { key: 'session:playback', size: 1024, tier: 'tier1_critical' },
    { key: 'history:played', size: 2048, tier: 'tier1_critical' },
    { key: 'slice:flac_1', size: 1048576, tier: 'tier2_media' },     // 1 MB
    { key: 'slice:flac_2', size: 1048576, tier: 'tier2_media' },     // 1 MB
    { key: 'cover:album_1', size: 51200, tier: 'tier3_enrichment' },  // 50 KB
    { key: 'lyrics:lrc_1', size: 4096, tier: 'tier3_enrichment' }     // 4 KB
  ];

  const metrics = library.calculateStorageTierMetrics(items);

  assert.equal(metrics.totalCount, 6);
  assert.equal(metrics.tiers.tier1_critical.count, 2);
  assert.equal(metrics.tiers.tier2_media.count, 2);
  assert.equal(metrics.tiers.tier3_enrichment.count, 2);

  assert.equal(metrics.tiers.tier2_media.bytes, 2097152); // 2 MB
  assert.equal(metrics.tiers.tier2_media.formattedBytes, '2.0 MB');
  assert.ok(metrics.healthScore >= 95);
});

test('Pha D & Audio Engine Invariant: Storage UI & Memory Cleanup Integration', () => {
  // SUPREME INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination);'),
    'AUDIO ENGINE INVARIANT: crossfeed output MUST connect to context destination'
  );

  // Storage section & Tier badges
  assert.ok(indexHtml.includes('id="storage-quota-section"'), 'Storage quota section must exist');
  assert.ok(indexHtml.includes('Tier 1: Trạng thái'), 'Storage Tier 1 badge must exist');
  assert.ok(indexHtml.includes('Tier 2: Đệm FLAC/DSD'), 'Storage Tier 2 badge must exist');
  assert.ok(indexHtml.includes('Tier 3: Bìa &amp; LRC'), 'Storage Tier 3 badge must exist');

  // Prune object URLs button
  assert.ok(indexHtml.includes('id="prune-object-urls-btn"'), 'Prune Object URLs button must exist in markup');
  assert.ok(indexHtml.includes("library.pruneUnreferencedObjectUrls"), 'prune-object-urls-btn must call library helper');
  assert.ok(indexHtml.includes("library.formatMemoryAuditSummary"), 'prune-object-urls-btn must call formatMemoryAuditSummary');
});
