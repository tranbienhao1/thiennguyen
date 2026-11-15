const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('Pha D — calculateAudioChunkRanges divides stream bytes into byte ranges', () => {
  // 1MB with 512KB chunks -> 2 chunks
  const total = 1024 * 1024;
  const chunk = 512 * 1024;
  const ranges = library.calculateAudioChunkRanges(total, chunk);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].index, 0);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 524287);
  assert.equal(ranges[0].rangeHeader, 'bytes=0-524287');
  assert.equal(ranges[0].size, 524288);

  assert.equal(ranges[1].index, 1);
  assert.equal(ranges[1].start, 524288);
  assert.equal(ranges[1].end, 1048575);
  assert.equal(ranges[1].rangeHeader, 'bytes=524288-1048575');
  assert.equal(ranges[1].size, 524288);

  // Remainder handling
  const oddTotal = 1000;
  const oddRanges = library.calculateAudioChunkRanges(oddTotal, 300);
  assert.equal(oddRanges.length, 4); // 300, 300, 300, 100
  assert.equal(oddRanges[3].start, 900);
  assert.equal(oddRanges[3].end, 999);
  assert.equal(oddRanges[3].size, 100);

  // Edge cases
  assert.deepEqual(library.calculateAudioChunkRanges(0), []);
  assert.deepEqual(library.calculateAudioChunkRanges(-100), []);
  assert.deepEqual(library.calculateAudioChunkRanges(null), []);
});

test('Pha D — shouldCacheAudioStream determines caching strategy', () => {
  // Invalid URL
  assert.equal(library.shouldCacheAudioStream('').shouldCache, false);
  assert.equal(library.shouldCacheAudioStream(null).shouldCache, false);

  // Live HLS stream bypass
  const hls = library.shouldCacheAudioStream('https://stream.example.com/live.m3u8', 'application/x-mpegurl');
  assert.equal(hls.shouldCache, false);
  assert.equal(hls.strategy, 'bypass');

  // Small file <= 5MB -> full-cache
  const small = library.shouldCacheAudioStream('https://cdn.example.com/song.mp3', 'audio/mpeg', 3 * 1024 * 1024);
  assert.equal(small.shouldCache, true);
  assert.equal(small.strategy, 'full-cache');

  // Large audio > 5MB -> range-chunk
  const large = library.shouldCacheAudioStream('https://cdn.example.com/master.flac', 'audio/flac', 45 * 1024 * 1024);
  assert.equal(large.shouldCache, true);
  assert.equal(large.strategy, 'range-chunk');

  // Huge file > 150MB -> bypass
  const huge = library.shouldCacheAudioStream('https://cdn.example.com/huge.iso', 'application/octet-stream', 200 * 1024 * 1024);
  assert.equal(huge.shouldCache, false);
  assert.equal(huge.strategy, 'bypass');
});

test('Pha D — formatStreamChunkStatus formats human-readable buffer telemetry', () => {
  const status1 = library.formatStreamChunkStatus(4, 10, 2 * 1024 * 1024, 5 * 1024 * 1024);
  assert.ok(status1.includes('4/10'));
  assert.ok(status1.includes('2.0'));
  assert.ok(status1.includes('5.0 MB'));
  assert.ok(status1.includes('40%'));

  const status2 = library.formatStreamChunkStatus(0, 0, 1.5 * 1024 * 1024);
  assert.ok(status2.includes('1.5 MB'));
});

test('Pha D — buildServiceWorkerCacheManifest builds normalized manifest', () => {
  const manifest = library.buildServiceWorkerCacheManifest(['./', 'index.html', 'library-utils.js', '  index.html  '], 'nocturne-v2');
  assert.equal(manifest.version, 'nocturne-v2');
  assert.equal(manifest.routes.length, 3);
  assert.ok(manifest.routes.includes('index.html'));
  assert.ok(manifest.routes.includes('library-utils.js'));
});

test('UI & Architecture: Player Footer & Mini HUD Decoupling & Collision Prevention', () => {
  // 1. #footer-telemetry-strip has dedicated styling and does not inherit 100% height
  assert.ok(indexHtml.includes('#footer-telemetry-strip{z-index:15;position:relative'), '#footer-telemetry-strip must have scoped CSS');

  // 2. Center controls contain only controls, no visualizer or telemetry text
  const centerMatch = indexHtml.match(/<div class="footer-center-controls[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(centerMatch, 'Center controls block must exist');
  assert.ok(!centerMatch[0].includes('id="visualizer"'), 'Visualizer must NOT be inside center controls');
  assert.ok(!centerMatch[0].includes('id="level-readout"'), 'Level readout must NOT be inside center controls');
  assert.ok(!centerMatch[0].includes('id="footer-dr-badge"'), 'DR badge must NOT be inside center controls');

  // 3. Mini Player HUD has rigid dimensions and bounded drag clearance
  assert.ok(indexHtml.includes('#mini-player-hud canvas'), 'Mini player HUD must have scoped canvas sizing');
  assert.ok(indexHtml.includes('maxBottomClearance'), 'Mini player HUD drag handler must enforce clearance above player footer');

  // 4. Update action gracefully pauses and reloads with cache-busting
  assert.ok(indexHtml.includes('applyAppUpdate'), 'applyAppUpdate must exist');
  assert.ok(indexHtml.includes('_nocturne_update'), 'Update must use cache-busting parameter');
  assert.ok(indexHtml.includes('nocturne-auto-resume-on-update'), 'Update must auto-resume on reload');

  // 5. sw.js handles SKIP_WAITING message
  assert.ok(swJs.includes('SKIP_WAITING'), 'sw.js must handle SKIP_WAITING event');

  // 6. CRITICAL AUDIO GRAPH INVARIANT
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be intact'
  );
});
