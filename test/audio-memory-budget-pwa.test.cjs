'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Pha D — Audio Memory Budget Guard & Compact Chunk Metadata (Pure Utilities)', () => {
  test('evaluateAudioMemoryBudget calculates correct metrics for empty and safe chunk cache', () => {
    const reportEmpty = library.evaluateAudioMemoryBudget([], null);
    assert.equal(reportEmpty.totalAllocatedBytes, 0);
    assert.equal(reportEmpty.pressureLevel, 'safe');
    assert.equal(reportEmpty.utilizationPercent, 0);
    assert.equal(reportEmpty.chunkCount, 0);
    assert.deepEqual(reportEmpty.evictionKeys, []);
    assert.equal(reportEmpty.bytesToReclaim, 0);

    const safeChunks = [
      { key: 'c1', trackId: 't1', sizeBytes: 10 * 1024 * 1024, lastAccessTime: 1000 },
      { key: 'c2', trackId: 't2', sizeBytes: 20 * 1024 * 1024, lastAccessTime: 2000 }
    ];
    const reportSafe = library.evaluateAudioMemoryBudget(safeChunks, 't1', { maxBudgetBytes: 100 * 1024 * 1024 });
    assert.equal(reportSafe.totalAllocatedBytes, 30 * 1024 * 1024);
    assert.equal(reportSafe.utilizationPercent, 30);
    assert.equal(reportSafe.pressureLevel, 'safe');
    assert.equal(reportSafe.chunkCount, 2);
    assert.deepEqual(reportSafe.evictionKeys, []);
  });

  test('evaluateAudioMemoryBudget flags moderate and critical pressure levels', () => {
    const moderateChunks = [
      { key: 'c1', trackId: 't1', sizeBytes: 70 * 1024 * 1024, lastAccessTime: 1000 }
    ];
    const reportMod = library.evaluateAudioMemoryBudget(moderateChunks, null, { maxBudgetBytes: 100 * 1024 * 1024 });
    assert.equal(reportMod.pressureLevel, 'moderate');
    assert.equal(reportMod.utilizationPercent, 70);
    assert.deepEqual(reportMod.evictionKeys, []);

    const criticalChunks = [
      { key: 'c1', trackId: 't1', sizeBytes: 30 * 1024 * 1024, lastAccessTime: 1000 },
      { key: 'c2', trackId: 't2', sizeBytes: 30 * 1024 * 1024, lastAccessTime: 2000 },
      { key: 'c3', trackId: 't3', sizeBytes: 30 * 1024 * 1024, lastAccessTime: 3000 }
    ];
    const reportCrit = library.evaluateAudioMemoryBudget(criticalChunks, 't3', { maxBudgetBytes: 100 * 1024 * 1024 });
    assert.equal(reportCrit.pressureLevel, 'critical');
    assert.equal(reportCrit.utilizationPercent, 90);
    assert.ok(reportCrit.evictionKeys.length > 0);
    assert.ok(!reportCrit.evictionKeys.includes('c3'), 'Active playing track chunks must never be evicted');
    assert.equal(reportCrit.evictionKeys[0], 'c1', 'Least recently used chunk must be evicted first');
  });

  test('evaluateAudioMemoryBudget respects forceEviction option', () => {
    const chunks = [
      { key: 'c1', trackId: 't1', sizeBytes: 5 * 1024 * 1024, lastAccessTime: 500 },
      { key: 'c2', trackId: 't2', sizeBytes: 5 * 1024 * 1024, lastAccessTime: 800 },
      { key: 'c3', trackId: 't3', sizeBytes: 5 * 1024 * 1024, lastAccessTime: 900 }
    ];
    const forced = library.evaluateAudioMemoryBudget(chunks, 't3', { forceEviction: true, maxEvictCount: 1 });
    assert.equal(forced.evictionKeys.length, 1);
    assert.equal(forced.evictionKeys[0], 'c1');
    assert.equal(forced.bytesToReclaim, 5 * 1024 * 1024);
  });

  test('compressChunkMetadataMap and decompressChunkMetadataMap achieve compression and round-trip preservation', () => {
    const input = [
      { trackId: 'track_alpha_44100', chunkIndex: 0, sizeBytes: 524288, formatCode: 'flac', lastAccessTime: 1731640000000 },
      { trackId: 'track_beta_96000', chunkIndex: 1, sizeBytes: 1048576, formatCode: 'dsd', lastAccessTime: 1731640050000 }
    ];

    const compressed = library.compressChunkMetadataMap(input);
    assert.equal(compressed.count, 2);
    assert.ok(compressed.savingsRatio > 0, 'Must produce measurable metadata byte savings');
    assert.ok(Array.isArray(compressed.packed));

    const decompressed = library.decompressChunkMetadataMap(compressed.packed);
    assert.equal(decompressed.length, 2);
    assert.equal(decompressed[0].trackId, 'track_alpha_44100');
    assert.equal(decompressed[0].chunkIndex, 0);
    assert.equal(decompressed[0].sizeBytes, 524288);
    assert.equal(decompressed[0].formatCode, 'flac');
    assert.equal(decompressed[0].lastAccessTime, Math.floor(1731640000000 / 1000) * 1000);
    assert.equal(decompressed[1].trackId, 'track_beta_96000');
  });

  test('formatAudioMemoryBudgetTelemetry produces informative telemetry readout', () => {
    assert.equal(library.formatAudioMemoryBudgetTelemetry(null), '💾 Bộ đệm RAM: Chưa có dữ liệu');

    const telemetry = library.formatAudioMemoryBudgetTelemetry({
      totalAllocatedBytes: 128 * 1024 * 1024,
      maxBudgetBytes: 256 * 1024 * 1024,
      pressureLevel: 'safe',
      utilizationPercent: 50,
      evictionKeys: []
    });
    assert.match(telemetry, /128\.0\/256 MB/);
    assert.match(telemetry, /An toàn 50%/);
    assert.match(telemetry, /0 lát cần thu hồi/);
  });
});

describe('Pha D — DOM & Audio Invariants Integration', () => {
  test('index.html provides memory budget purge button and status indicator', () => {
    assert.ok(indexHtml.includes('id="purge-memory-budget-btn"'), 'Must have #purge-memory-budget-btn element');
    assert.ok(indexHtml.includes('id="audio-memory-budget-indicator"'), 'Must have #audio-memory-budget-indicator element');
  });

  test('index.html binds purge-memory-budget-btn and invokes evaluateAudioMemoryBudget', () => {
    assert.ok(indexHtml.includes("$('purge-memory-budget-btn')"), 'Must attach event listener to #purge-memory-budget-btn');
    assert.ok(indexHtml.includes('evaluateAudioMemoryBudget'), 'Must call evaluateAudioMemoryBudget in event listener');
    assert.ok(indexHtml.includes('formatAudioMemoryBudgetTelemetry'), 'Must call formatAudioMemoryBudgetTelemetry');
  });

  test('CRITICAL AUDIO INVARIANT: Web Audio Graph destination connection preserved intact', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: crossfeedNodes.output must connect directly to context.destination'
    );
  });
});
