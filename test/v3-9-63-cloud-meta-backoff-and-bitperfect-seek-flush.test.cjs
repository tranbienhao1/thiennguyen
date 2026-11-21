'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. runCloudMetadataQueue pauses offline without draining & backs off + requeues on HTTP 429/503 rate limits', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const qStart = html.indexOf('let cloudMetadataBackoffMs = 0;');
  const qEnd = html.indexOf('function isCloudAuthHttpError(', qStart);
  const eStart = html.indexOf('function allSettledCompat(promises) {');
  const eEnd = html.indexOf("const dsdWorkerBaseUrl = new URL('.',", eStart);
  assert.ok(qStart > 0 && qEnd > qStart);
  assert.ok(eStart > 0 && eEnd > eStart);

  const track1 = { id: 'gd_1', source: 'google', remoteId: 'r1', title: 'T1', artist: 'A1', album: 'Alb1', metadataLoaded: false, cover: null };
  const track2 = { id: 'gd_2', source: 'google', remoteId: 'r2', title: 'T2', artist: 'A2', album: 'Alb1', metadataLoaded: false, cover: null };
  const pauseCalls = [];
  let tagCalls = 0;

  const sandbox = {
    navigator: { onLine: false },
    IS_LEGACY_ANDROID: false,
    CLOUD_METADATA_CONCURRENCY: 2,
    state: { isPlaybackLoading: false, fiioDapMode: false, albumCovers: new Map(), tracks: [track1, track2] },
    cloudMetadataPausedUntil: 0,
    cloudMetadataActive: 0,
    cloudMetadataQueue: [track1, track2],
    cloudMetadataQueued: new Set([track1, track2]),
    pendingCloudCatalogPersistMap: new Map(),
    trackMetadataRevision: 0,
    filterOptionsSignature: '',
    pauseCloudMetadataQueue: (ms) => {
      pauseCalls.push(ms);
      sandbox.cloudMetadataPausedUntil = Date.now() + ms;
    },
    cloudTagRequest: async () => {
      tagCalls++;
      const err = new Error('Google Drive rate limit HTTP 429');
      err.status = 429;
      err.retryAfterMs = 6000;
      throw err;
    },
    googleThumbnail: async () => null,
    microsoftThumbnail: async () => null,
    library: { resolveTrackMetadata: (tags, fb) => fb },
    updateMetadataFilters: () => {},
    scheduleTrackRender: () => {},
    flushQueuedCloudCatalogPersist: async () => {},
    Map, Set, Array, Number, String, Boolean, Object, Date, Math, Promise, Error, console
  };

  vm.runInNewContext(
    html.slice(qStart, qEnd) + '\n' + html.slice(eStart, eEnd) +
    '\nthis.runCloudMetadataQueue = runCloudMetadataQueue;' +
    '\nthis.isCloudMetadataRateLimitError = isCloudMetadataRateLimitError;',
    sandbox
  );

  // Offline: must NOT drain queue or set 1-hour metadataRetryAt
  sandbox.runCloudMetadataQueue();
  assert.equal(tagCalls, 0, 'Offline queue must not dispatch cloud metadata fetches');
  assert.equal(sandbox.cloudMetadataQueue.length, 2, 'Offline queue must keep all pending tracks intact');
  assert.equal(track1.metadataRetryAt, undefined);

  // Back online -> hits 429 -> pauses with retryAfterMs=6000, clears metadataRetryAt, re-queues track1 at front!
  sandbox.navigator.onLine = true;
  sandbox.runCloudMetadataQueue();
  await new Promise(r => setTimeout(r, 30));
  assert.ok(pauseCalls.length >= 1, 'HTTP 429 must trigger pauseCloudMetadataQueue');
  assert.equal(pauseCalls[0], 6000, 'Must honor Retry-After 6000ms on HTTP 429');
  assert.equal(track1.metadataRetryAt, undefined, 'Rate-limited track must NOT be penalized for 1 hour');
  assert.equal(track1._metaRateLimitRetries, 1);
  assert.ok(sandbox.cloudMetadataQueue.includes(track1), 'Rate-limited track must be re-queued');
  assert.equal(sandbox.cloudMetadataQueue.length, 2, 'Both rate-limited tracks must be preserved in queue');

  assert.equal(sandbox.isCloudMetadataRateLimitError({ status: 429 }), true);
  assert.equal(sandbox.isCloudMetadataRateLimitError({ status: 503 }), true);
  assert.equal(sandbox.isCloudMetadataRateLimitError({ status: 404 }), false);
});

test('2. BitPerfectAudioPlayer pauses AudioTrack before flush on seek, advances past corrupt packets & v3.9.63+ alignment', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

  // Verify pause-before-flush inside BitPerfect seek handler
  const seekStart = java.indexOf('long seekUs = mSeekTargetUs.getAndSet(-1);');
  const seekEnd = java.indexOf('// Feed input buffer', seekStart);
  assert.ok(seekStart > 0 && seekEnd > seekStart);
  const seekSlice = java.slice(seekStart, seekEnd);
  assert.ok(seekSlice.includes('track.pause();') && seekSlice.includes('track.flush();') && seekSlice.includes('track.play();'));
  assert.ok(seekSlice.indexOf('track.pause();') < seekSlice.indexOf('track.flush();'), 'AudioTrack.pause() must precede AudioTrack.flush() so flush is not a no-op');
  assert.ok(seekSlice.indexOf('track.flush();') < seekSlice.indexOf('track.play();'), 'AudioTrack.play() must follow AudioTrack.flush()');

  // Verify corrupt packet advance inside input catch
  const inputStart = java.indexOf('// Feed input buffer');
  const inputEnd = java.indexOf('// Dequeue output buffer', inputStart);
  assert.ok(inputStart > 0 && inputEnd > inputStart);
  const inputSlice = java.slice(inputStart, inputEnd);
  assert.ok(inputSlice.includes('advancedPastCorrupt = extractor.advance();'), 'Corrupt input error must advance MediaExtractor past bad frame');

  // Verify online listener resumes metadata queue & thumbnails use fetchWithTimeout
  assert.ok(html.includes("if (typeof runCloudMetadataQueue === 'function') runCloudMetadataQueue();"));
  assert.ok(html.includes("typeof fetchWithTimeout === 'function' ? fetchWithTimeout(url, opts, 15000) : fetch(url, opts)"));

  assert.match(html, /FiiO M11S · v3\.9\.(6[3-9]|[7-9]\d|\d{3,})/);
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(6[3-9]|[7-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(6[3-9]|[7-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 117, `Expected versionCode >= 117, got ${vcMatch && vcMatch[1]}`);
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(6[3-9]|[7-9]\d|\d{3,})"/);
});
