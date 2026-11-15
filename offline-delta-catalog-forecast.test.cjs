const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

test('Pha D: Offline Library Delta Sync & Storage Capacity Forecast Test Suite', async (t) => {
  await t.test('1. computeLibraryDifferentialDelta detects added, modified, removed and bandwidth savings', () => {
    assert.equal(typeof library.computeLibraryDifferentialDelta, 'function');

    const cached = [
      { id: '1', title: 'Track 1', quality: 'FLAC 16/44.1', mtime: 100 },
      { id: '2', title: 'Track 2', quality: 'MP3 320k', mtime: 200 },
      { id: '3', title: 'Track 3', quality: 'FLAC 24/96', mtime: 300 }
    ];

    // incoming: Track 1 unchanged, Track 2 modified, Track 3 removed, Track 4 added
    const incoming = [
      { id: '1', title: 'Track 1', quality: 'FLAC 16/44.1', mtime: 100 },
      { id: '2', title: 'Track 2', quality: 'FLAC 24/192', mtime: 250 }, // upgraded quality
      { id: '4', title: 'Track 4', quality: 'WAV', mtime: 400 } // new
    ];

    const delta = library.computeLibraryDifferentialDelta(cached, incoming);
    assert.equal(delta.hasChanges, true);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.added[0].id, '4');
    assert.equal(delta.modified.length, 1);
    assert.equal(delta.modified[0].id, '2');
    assert.equal(delta.removed.length, 1);
    assert.equal(delta.removed[0].id, '3');
    assert.equal(delta.unchangedCount, 1);
    // total incoming = 3, unchanged = 1 -> savings = 33%
    assert.equal(delta.bandwidthSavingsPercent, 33);

    // Identical case
    const identicalDelta = library.computeLibraryDifferentialDelta(cached, cached);
    assert.equal(identicalDelta.hasChanges, false);
    assert.equal(identicalDelta.added.length, 0);
    assert.equal(identicalDelta.modified.length, 0);
    assert.equal(identicalDelta.removed.length, 0);
    assert.equal(identicalDelta.bandwidthSavingsPercent, 100);
  });

  await t.test('2. mergeDifferentialCatalog applies delta updates cleanly', () => {
    assert.equal(typeof library.mergeDifferentialCatalog, 'function');

    const initial = [
      { id: '1', title: 'Track 1' },
      { id: '2', title: 'Track 2' },
      { id: '3', title: 'Track 3' }
    ];

    const delta = {
      added: [{ id: '4', title: 'Track 4' }],
      modified: [{ id: '2', title: 'Track 2 (Remastered)' }],
      removed: [{ id: '1', title: 'Track 1' }]
    };

    const merged = library.mergeDifferentialCatalog(initial, delta);
    assert.equal(merged.length, 3);
    assert.equal(merged.find(t => t.id === '1'), undefined);
    assert.equal(merged.find(t => t.id === '2').title, 'Track 2 (Remastered)');
    assert.equal(merged.find(t => t.id === '3').title, 'Track 3');
    assert.equal(merged.find(t => t.id === '4').title, 'Track 4');
  });

  await t.test('3. formatDifferentialSyncTelemetry formats localized status', () => {
    assert.equal(typeof library.formatDifferentialSyncTelemetry, 'function');

    const cleanReport = library.formatDifferentialSyncTelemetry({ hasChanges: false });
    assert.ok(cleanReport.includes('hoàn hảo'));
    assert.ok(cleanReport.includes('100% băng thông'));

    const activeReport = library.formatDifferentialSyncTelemetry({
      hasChanges: true,
      added: [1, 2],
      modified: [3],
      removed: [4],
      bandwidthSavingsPercent: 88
    });
    assert.ok(activeReport.includes('+2 mới'));
    assert.ok(activeReport.includes('1 cập nhật'));
    assert.ok(activeReport.includes('1 đã xóa'));
    assert.ok(activeReport.includes('88% băng thông'));
  });

  await t.test('4. estimateOfflineStorageAvailability calculates usable space and track forecasts', () => {
    assert.equal(typeof library.estimateOfflineStorageAvailability, 'function');

    // 10GB quota, 2GB used -> 8GB free - 200MB safety margin = 7.8GB usable
    const quota = 10 * 1024 * 1024 * 1024;
    const usage = 2 * 1024 * 1024 * 1024;

    const est = library.estimateOfflineStorageAvailability({ quota, usage });
    assert.ok(est.usableBytes > 7.5 * 1024 * 1024 * 1024);
    assert.equal(est.isStorageConstrained, false);
    assert.ok(est.estimatedFlacCount > 200);
    assert.ok(est.estimatedMp3Count > 900);

    // Low space condition: 210MB remaining - 200MB margin = 10MB usable (< 50MB)
    const constrained = library.estimateOfflineStorageAvailability({
      quota: 1000 * 1024 * 1024,
      usage: 790 * 1024 * 1024
    });
    assert.equal(constrained.isStorageConstrained, true);
  });

  await t.test('5. formatStorageCapacityForecast provides human-readable capacity summary', () => {
    assert.equal(typeof library.formatStorageCapacityForecast, 'function');

    const normal = library.formatStorageCapacityForecast({
      usableBytes: 2 * 1024 * 1024 * 1024,
      estimatedFlacCount: 58,
      estimatedMp3Count: 256,
      isStorageConstrained: false
    });
    assert.ok(normal.includes('Khả dụng'));
    assert.ok(normal.includes('58 bài FLAC'));
    assert.ok(normal.includes('256 bài MP3'));

    const constrained = library.formatStorageCapacityForecast({
      usableBytes: 20 * 1024 * 1024,
      isStorageConstrained: true
    });
    assert.ok(constrained.includes('Bộ nhớ hạn hẹp'));
  });

  await t.test('6. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    // UI elements
    assert.ok(indexHtml.includes('id="sync-delta-library-btn"'), 'index.html must contain #sync-delta-library-btn');
    assert.ok(indexHtml.includes('id="storage-capacity-forecast"'), 'index.html must contain #storage-capacity-forecast');
    assert.ok(indexHtml.includes('id="sync-delta-status"'), 'index.html must contain #sync-delta-status');

    // Integration of functions
    assert.ok(indexHtml.includes('computeLibraryDifferentialDelta'), 'index.html must invoke computeLibraryDifferentialDelta');
    assert.ok(indexHtml.includes('estimateOfflineStorageAvailability'), 'index.html must invoke estimateOfflineStorageAvailability');

    // CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});
