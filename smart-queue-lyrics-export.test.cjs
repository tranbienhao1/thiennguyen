const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const library = require(libraryPath);

test('Pha C: calculateQueueMetrics computes accurate queue analytics', () => {
  // Empty queue
  const empty = library.calculateQueueMetrics([]);
  assert.equal(empty.totalTracks, 0);
  assert.equal(empty.totalDurationSec, 0);
  assert.equal(empty.formattedDuration, '0:00');
  assert.equal(empty.highResPercentage, 0);

  // Mixed tracks queue
  const mockTracks = [
    { id: '1', title: 'Track 1', format: 'FLAC', bitDepth: 24, sampleRate: 96000, duration: 245 },
    { id: '2', title: 'Track 2', format: 'DSD', isDsd: true, duration: 310 },
    { id: '3', title: 'Track 3', format: 'MP3', bitDepth: 16, sampleRate: 44100, duration: 185 }
  ];

  const metrics = library.calculateQueueMetrics(mockTracks);
  assert.equal(metrics.totalTracks, 3);
  assert.equal(metrics.totalDurationSec, 740); // 245 + 310 + 185
  assert.equal(metrics.formattedDuration, '12m 20s');
  assert.equal(metrics.highResCount, 2); // FLAC 24-bit & DSD
  assert.equal(metrics.highResPercentage, 67);
  assert.equal(metrics.formatBreakdown.FLAC, 1);
  assert.equal(metrics.formatBreakdown.DSD, 1);
  assert.equal(metrics.formatBreakdown.MP3, 1);
  assert.ok(metrics.estimatedSizeMb > 0);
});

test('Pha C: formatQueueSummaryBadge formats audiophile status string', () => {
  assert.equal(library.formatQueueSummaryBadge(null), 'Hàng đợi trống');
  assert.equal(library.formatQueueSummaryBadge({ totalTracks: 0 }), 'Hàng đợi trống');

  const formatted = library.formatQueueSummaryBadge({
    totalTracks: 5,
    formattedDuration: '24m 10s',
    highResPercentage: 80,
    estimatedSizeMb: 320
  });
  assert.equal(formatted, '5 bài · 24m 10s · Hi-Res 80% · ~320 MB');
});

test('Pha C: calculateLyricWordProgress computes precise karaoke word progress', () => {
  // Before word start
  assert.equal(library.calculateLyricWordProgress(9.5, 10.0, 11.0), 0);

  // Exactly halfway through a 1.0s word
  assert.equal(library.calculateLyricWordProgress(10.5, 10.0, 11.0), 0.5);

  // Past word completion
  assert.equal(library.calculateLyricWordProgress(12.0, 10.0, 11.0), 1.0);

  // Fallback nextWordTime (default 600ms)
  assert.equal(library.calculateLyricWordProgress(10.3, 10.0, null), 0.5);
});

test('Pha C: generateLrcExportContent produces compliant standard LRC text', () => {
  const mockTrack = {
    title: 'Một Đời',
    artist: '14 Casper',
    album: 'Trên Một Đời',
    duration: 328
  };
  const mockLyrics = [
    { time: 14.5, text: 'Đôi khi ta thấy lòng nhẹ tênh' },
    { time: 21.25, text: 'Giữa phố đông người qua' }
  ];

  const lrc = library.generateLrcExportContent(mockTrack, mockLyrics, { offsetMs: 250 });
  assert.ok(lrc.includes('[ti:Một Đời]'));
  assert.ok(lrc.includes('[ar:14 Casper]'));
  assert.ok(lrc.includes('[al:Trên Một Đời]'));
  assert.ok(lrc.includes('[by:Nocturne Audiophile Music Player]'));
  assert.ok(lrc.includes('[offset:250]'));
  assert.ok(lrc.includes('[length:05:28]'));
  assert.ok(lrc.includes('[00:14.50]Đôi khi ta thấy lòng nhẹ tênh'));
  assert.ok(lrc.includes('[00:21.25]Giữa phố đông người qua'));
});

test('Pha C & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: AudioContext Graph invariant must remain intact!'
  );
  assert.ok(
    indexHtml.includes('queue-metrics-bar'),
    'Queue metrics bar must be present in index.html'
  );
  assert.ok(
    indexHtml.includes('room-lyrics-export-btn') && indexHtml.includes('room-lyrics-paste-btn'),
    'Lyrics export and paste buttons must be wired in index.html'
  );
});
