const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const libraryUtilsPath = path.join(__dirname, '..', 'library-utils.js');
const libraryUtilsCode = fs.readFileSync(libraryUtilsPath, 'utf8');

const sandbox = {
  window: {},
  document: {},
  navigator: { userAgent: 'NodeTest' },
  performance: { now: () => Date.now() },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Uint8Array,
  DataView,
  ArrayBuffer,
  Math,
  Number,
  String,
  Set,
  Map,
  Promise,
  TextEncoder,
  TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(libraryUtilsCode, sandbox);
const lib = sandbox.library || sandbox.NocturneLibrary;

function createMockAudioTrack(id, title) {
  const dummyAudio = new Uint8Array(65536);
  for (let i = 0; i < dummyAudio.length; i++) {
    dummyAudio[i] = ((i * 37) ^ (id * 17)) & 0xff;
  }
  return {
    id: id,
    title: title,
    size: 1000000,
    buffer: dummyAudio
  };
}

describe('OPT-12 — Prioritized Background Fingerprint & ReplayGain Queue for FiiO DAP', () => {
  it('exposes FINGERPRINT_PRIORITY_TIERS, calculateFingerprintPriorityScore, createPrioritizedFingerprintQueue, formatFingerprintQueueTelemetry', () => {
    assert.equal(typeof lib.FINGERPRINT_PRIORITY_TIERS, 'object');
    assert.equal(typeof lib.calculateFingerprintPriorityScore, 'function');
    assert.equal(typeof lib.createPrioritizedFingerprintQueue, 'function');
    assert.equal(typeof lib.formatFingerprintQueueTelemetry, 'function');
  });

  it('accurately calculates priority score for CURRENT (300), NEXT (200), QUEUE (100..15), and LIBRARY (10)', () => {
    const trackCurrent = { id: 'track_1' };
    const trackNext = { id: 'track_2' };
    const trackQueue = { id: 'track_5' };
    const trackLib = { id: 'track_99' };

    const ctx = {
      currentId: 'track_1',
      queue: [{ id: 'track_1' }, { id: 'track_2' }, { id: 'track_3' }, { id: 'track_4' }, { id: 'track_5' }],
      isAudioPlaying: true
    };

    assert.equal(lib.calculateFingerprintPriorityScore(trackCurrent, ctx), 300, 'Current track must score 300');
    assert.equal(lib.calculateFingerprintPriorityScore(trackNext, ctx), 200, 'Up-next track must score 200');
    assert.ok(lib.calculateFingerprintPriorityScore(trackQueue, ctx) >= 15, 'In-queue track must score >= 15');
    assert.equal(lib.calculateFingerprintPriorityScore(trackLib, ctx), 10, 'Library track must score 10');
  });

  it('drains CURRENT playing track ahead of previously queued background library tracks', async () => {
    const processedIds = [];
    const queueController = lib.createPrioritizedFingerprintQueue({
      maxConcurrent: 1,
      playingThrottleMs: 15,
      idleThrottleMs: 0,
      currentId: 'track_now_playing',
      onProcessed: (track) => {
        processedIds.push(track.id);
      }
    });

    // Enqueue 2 library tracks first
    const libTrackA = createMockAudioTrack('lib_track_a', 'Library Song A');
    const libTrackB = createMockAudioTrack('lib_track_b', 'Library Song B');
    queueController.enqueue(libTrackA);
    queueController.enqueue(libTrackB);

    // Enqueue the currently playing track last
    const currentTrack = createMockAudioTrack('track_now_playing', 'Now Playing Song');
    const currentPromise = queueController.enqueue(currentTrack);

    await currentPromise;

    // The current playing track must have been prioritized and processed first!
    assert.equal(processedIds[0], 'track_now_playing',
      'Currently playing track must jump to the front of queue and process before library tracks');

    queueController.clear();
  });

  it('re-prioritizes pending queue on updateContext when user skips track', async () => {
    const processedIds = [];
    const queueController = lib.createPrioritizedFingerprintQueue({
      maxConcurrent: 1,
      playingThrottleMs: 20,
      idleThrottleMs: 0,
      currentId: 'song_1',
      paused: true, // hold initially to observe priority sorting
      onProcessed: (track) => {
        processedIds.push(track.id);
      }
    });

    const song1 = createMockAudioTrack('song_1', 'Song 1');
    const song2 = createMockAudioTrack('song_2', 'Song 2');
    const song3 = createMockAudioTrack('song_3', 'Song 3');

    queueController.enqueue(song1);
    queueController.enqueue(song2);
    queueController.enqueue(song3);

    // User suddenly skips to song 3
    queueController.updateContext({
      currentId: 'song_3',
      queue: [song3, song2],
      isAudioPlaying: true
    });

    const stats = queueController.getStats();
    assert.equal(stats.topPriority, 300, 'Top priority must become 300 for song_3');

    // Resume queue
    queueController.resume();
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(processedIds[0], 'song_3', 'song_3 must process first after context update');
    queueController.clear();
  });

  it('formats telemetry string correctly during throttling and idle states', () => {
    const statsThrottled = {
      pendingCount: 4,
      completedCount: 12,
      skippedCount: 2,
      isThrottled: true,
      paused: false
    };
    const textThrottled = lib.formatFingerprintQueueTelemetry(statsThrottled);
    assert.ok(textThrottled.includes('Tiết lưu thẻ nhớ DAP'), 'Must mention DAP storage throttling');
    assert.ok(textThrottled.includes('12'), 'Must include completed count');

    const statsIdle = {
      pendingCount: 0,
      completedCount: 20,
      skippedCount: 5,
      isThrottled: false,
      paused: false
    };
    const textIdle = lib.formatFingerprintQueueTelemetry(statsIdle);
    assert.ok(textIdle.includes('Nhàn rỗi'), 'Must mention idle state');
  });

  it('Web Audio graph crossfeed invariant remains intact', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio crossfeed invariant must be 100% intact'
    );
  });
});
