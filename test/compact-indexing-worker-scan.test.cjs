const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryUtilsPath = path.join(__dirname, '..', 'library-utils.js');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');

test('Pha D: IndexedDB Compact Indexing & Web Worker Asynchronous Library Scan', async (t) => {
  const lib = require(libraryUtilsPath);

  await t.test('1. compressLibraryTrackIndex & decompressLibraryTrackIndex round-trip integrity', () => {
    const rawTrack = {
      id: 'trk-test-101',
      title: 'Bài Ca Hy Vọng',
      artist: 'Ca Sĩ Mẫu',
      album: 'Tuyển Tập Mùa Xuân',
      duration: 245.8,
      format: 'FLAC',
      source: 'local',
      qualityScore: 98,
      cover: 'blob:http://localhost/cover-123'
    };

    const compact = lib.compressLibraryTrackIndex(rawTrack);
    assert.ok(compact, 'Compact object must be produced');
    assert.equal(compact.i, 'trk-test-101');
    assert.equal(compact.t, 'Bài Ca Hy Vọng');
    assert.equal(compact.a, 'Ca Sĩ Mẫu');
    assert.equal(compact.al, 'Tuyển Tập Mùa Xuân');
    assert.equal(compact.d, 246, 'Duration must be rounded to integer seconds');
    assert.equal(compact.f, 1, 'FLAC format code must be 1');
    assert.equal(compact.s, 1, 'Local source code must be 1');
    assert.equal(compact.q, 98);
    assert.equal(compact.c, 1, 'Cover flag must be 1 when cover is present');

    const decompressed = lib.decompressLibraryTrackIndex(compact);
    assert.ok(decompressed, 'Decompressed object must be produced');
    assert.equal(decompressed.id, rawTrack.id);
    assert.equal(decompressed.title, rawTrack.title);
    assert.equal(decompressed.artist, rawTrack.artist);
    assert.equal(decompressed.album, rawTrack.album);
    assert.equal(decompressed.duration, 246);
    assert.equal(decompressed.format, 'FLAC');
    assert.equal(decompressed.source, 'local');
    assert.equal(decompressed.qualityScore, 98);
    assert.equal(decompressed.hasCover, true);

    // Safe handling on bad inputs
    assert.equal(lib.compressLibraryTrackIndex(null), null);
    assert.equal(lib.compressLibraryTrackIndex({}), null);
    assert.equal(lib.decompressLibraryTrackIndex(null), null);
    assert.equal(lib.decompressLibraryTrackIndex({}), null);
  });

  await t.test('2. buildLibraryInvertedIndex & queryInvertedIndex token-based search', () => {
    const sampleTracks = [
      { id: '1', title: 'Chất Gây Hại', artist: 'Quang Hùng MasterD', album: 'Album Single' },
      { id: '2', title: 'Fashion Tán Gái', artist: 'Low G', album: 'Album Hiphop' },
      { id: '3', title: 'An Thần', artist: 'Low G ft Thắng', album: 'Album Hiphop' },
      { id: '4', title: 'Người Tình Điên Loạn', artist: 'Thắng', album: 'Tuyển Tập' }
    ];

    const inverted = lib.buildLibraryInvertedIndex(sampleTracks);
    assert.ok(inverted && inverted.index, 'Index map must exist');
    assert.ok(inverted.totalTokens > 0, 'Total tokens must be > 0');
    assert.equal(inverted.totalTracks, 4);

    // Query 1: 'Low G' should match track 2 and 3
    const qLowG = lib.queryInvertedIndex(inverted, 'Low G');
    assert.ok(qLowG.includes('2'), 'Track 2 must match Low G');
    assert.ok(qLowG.includes('3'), 'Track 3 must match Low G');
    assert.ok(!qLowG.includes('1'), 'Track 1 should not match');

    // Query 2: Multi-token intersection 'Thắng An Thần' -> should match track 3 only
    const qThangAnThan = lib.queryInvertedIndex(inverted, 'Thắng An Thần');
    assert.ok(qThangAnThan.includes('3'), 'Track 3 must match intersection');
    assert.ok(!qThangAnThan.includes('4'), 'Track 4 does not have An Thần');

    // Query 3: Non-existent token returns empty array
    const qMissing = lib.queryInvertedIndex(inverted, 'KhôngTồnTại123');
    assert.deepEqual(qMissing, []);
  });

  await t.test('3. batchProcessLibraryScan chunking and progress reporting', () => {
    const items = Array.from({ length: 125 }, (_, idx) => ({ id: `track-${idx}`, title: `Song ${idx}` }));
    const progressCalls = [];

    const result = lib.batchProcessLibraryScan(items, {
      chunkSize: 50,
      processFn: (item) => ({ ...item, processed: true }),
      onProgress: (p) => progressCalls.push({ ...p })
    });

    assert.equal(result.batches, 3, '125 items with chunk size 50 must produce 3 batches');
    assert.equal(result.processedCount, 125);
    assert.equal(result.results.length, 125);
    assert.equal(result.results[0].processed, true);
    assert.ok(progressCalls.length === 3, 'Must report progress after each batch');
    assert.equal(progressCalls[progressCalls.length - 1].percent, 100);
  });

  await t.test('4. evaluateLibraryIndexHealth & formatLibraryIndexHealthReport', () => {
    const tracks = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, title: `Track ${i}`, artist: 'Artist' }));
    const compactEntries = tracks.map(t => lib.compressLibraryTrackIndex(t));
    const inverted = lib.buildLibraryInvertedIndex(tracks);

    const health = lib.evaluateLibraryIndexHealth(tracks, compactEntries, inverted);
    assert.ok(health.score >= 80, 'Full index must score >= 80');
    assert.equal(health.status, 'OPTIMAL');
    assert.ok(health.compressionRatio >= 50, 'Compact index must achieve >= 50% theoretical reduction');
    assert.ok(health.spaceSavedBytes > 0);

    const report = lib.formatLibraryIndexHealthReport(health);
    assert.ok(report.includes('Chỉ mục OPTIMAL'), 'Report must display status');
    assert.ok(report.includes('Nén -'), 'Report must display compression percentage');
  });

  await t.test('5. index.html UI integration and Web Audio API destination invariant', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    // UI Buttons and Summaries
    assert.ok(html.includes('id="rebuild-compact-index-btn"'), 'Must have #rebuild-compact-index-btn');
    assert.ok(html.includes('id="library-index-health-summary"'), 'Must have #library-index-health-summary');
    assert.ok(html.includes('id="library-index-badge"'), 'Must have #library-index-badge');
    assert.ok(html.includes('id="library-index-desc"'), 'Must have #library-index-desc');

    // Core Invariant #1: Web Audio crossfeed destination graph
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio destination invariant must be strictly preserved'
    );
  });
});
