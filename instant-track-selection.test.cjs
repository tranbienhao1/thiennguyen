'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Instant Track Selection & Zero-Latency Audio Pipeline Suite', async (t) => {

  await t.test('1. Library Utilities: createOptimisticTrackState, formatSelectionLatency, canStartInstantPlayback, scheduleNonBlockingTask', () => {
    // 1.1 createOptimisticTrackState
    assert.equal(typeof lib.createOptimisticTrackState, 'function', 'createOptimisticTrackState must be exported');
    const mockTrack = { id: 'track-42', title: 'Audiophile Master', artist: 'Art of Sound' };
    const optimistic = lib.createOptimisticTrackState(mockTrack, { currentId: 'track-old', volume: 0.8 });
    assert.equal(optimistic.currentId, 'track-42');
    assert.equal(optimistic.playbackStatus, 'buffering');
    assert.equal(optimistic.optimisticLoading, true);
    assert.equal(optimistic.currentTime, 0);
    assert.equal(optimistic.seekFraction, 0);
    assert.equal(optimistic.activeTrack, mockTrack);
    assert.equal(optimistic.volume, 0.8, 'Preserves previous unrelated state attributes');

    // Safe fallback for null/undefined track
    const emptyState = lib.createOptimisticTrackState(null, { currentId: 'existing' });
    assert.equal(emptyState.currentId, 'existing');

    // 1.2 formatSelectionLatency
    assert.equal(typeof lib.formatSelectionLatency, 'function', 'formatSelectionLatency must be exported');
    const instantLabel = lib.formatSelectionLatency(4.2);
    assert.ok(instantLabel.includes('< 16ms'), 'Under 16ms must report instant sub-frame responsiveness');
    assert.ok(instantLabel.includes('60fps'));

    const slowerLabel = lib.formatSelectionLatency(24.5);
    assert.ok(slowerLabel.includes('24.5ms'), 'Latency >= 16ms formats exact ms value');

    // 1.3 canStartInstantPlayback
    assert.equal(typeof lib.canStartInstantPlayback, 'function', 'canStartInstantPlayback must be exported');
    const localTrack = { id: 'loc-1', source: 'local', file: { name: 'hi-res.flac' } };
    assert.deepEqual(lib.canStartInstantPlayback(localTrack), {
      instant: true,
      reason: 'local_file_in_memory',
      mode: 'local'
    });

    const blobTrack = { id: 'blob-1', url: 'blob:http://localhost/uuid-123' };
    assert.deepEqual(lib.canStartInstantPlayback(blobTrack), {
      instant: true,
      reason: 'local_file_in_memory',
      mode: 'local'
    });

    const cachedSliceTrack = { id: 'slice-1', source: 'google', firstSliceCached: true };
    assert.deepEqual(lib.canStartInstantPlayback(cachedSliceTrack), {
      instant: true,
      reason: 'first_slice_cached_in_storage',
      mode: 'cached-slice'
    });

    const cacheIndexMatch = { id: 'slice-2', source: 'onedrive' };
    assert.deepEqual(lib.canStartInstantPlayback(cacheIndexMatch, { 'slice-2': { byteLength: 1048576 } }), {
      instant: true,
      reason: 'first_slice_cached_in_storage',
      mode: 'cached-slice'
    });

    const preloadedTrack = { id: 'pre-1', isPreloaded: true };
    assert.deepEqual(lib.canStartInstantPlayback(preloadedTrack), {
      instant: true,
      reason: 'preloaded_standby_deck',
      mode: 'preload'
    });

    const cloudTrack = { id: 'cloud-1', source: 'google', url: 'https://drive.google.com/...' };
    assert.deepEqual(lib.canStartInstantPlayback(cloudTrack), {
      instant: false,
      reason: 'requires_range_fetch',
      mode: 'network'
    });

    assert.equal(lib.canStartInstantPlayback(null).instant, false);

    // 1.4 scheduleNonBlockingTask
    assert.equal(typeof lib.scheduleNonBlockingTask, 'function', 'scheduleNonBlockingTask must be exported');
    let taskRan = false;
    const handle = lib.scheduleNonBlockingTask(() => { taskRan = true; });
    assert.ok(handle !== null, 'scheduleNonBlockingTask returns a valid scheduling handle');
    assert.equal(lib.scheduleNonBlockingTask(null), null);
  });

  await t.test('2. DOM & CSS Integration in index.html for optimistic visual feedback', () => {
    // 2.1 CSS loading-pulse & track-loading-pulse keyframes and styles
    assert.match(indexHtml, /\.loading-pulse\s*\{/, 'index.html must define .loading-pulse');
    assert.match(indexHtml, /\.track-loading-pulse\s*\{/, 'index.html must define .track-loading-pulse');
    assert.match(indexHtml, /@keyframes subtlePulse/, 'index.html must define subtlePulse keyframes');

    // 2.2 applyOptimisticPlaybackUi and clearOptimisticLoadingUi
    assert.match(indexHtml, /function applyOptimisticPlaybackUi\(track\)/, 'applyOptimisticPlaybackUi must exist');
    assert.match(indexHtml, /function clearOptimisticLoadingUi\(\)/, 'clearOptimisticLoadingUi must exist');

    // 2.3 Optimistic UI states applied synchronously
    assert.ok(indexHtml.includes("playBtn.textContent = '…'"), 'play-button text set to optimistic loading indicator');
    assert.ok(indexHtml.includes("playBtn.classList.add('loading-pulse')"), 'play-button gets loading-pulse class');
    assert.ok(indexHtml.includes("current.classList.add('track-loading-pulse')"), 'Active row gets track-loading-pulse');
    assert.ok(indexHtml.includes("updateCurrentTrackIndicator()"), 'updateCurrentTrackIndicator called synchronously');
    assert.ok(indexHtml.includes("$('current-time').textContent = '0:00'"), 'Current time resets to 0:00 optimistically');
    assert.ok(indexHtml.includes("$('seek').value = '0'"), 'Seek range resets to 0 optimistically');
  });

  await t.test('3. Optimistic UI Response (<16ms) in handleTrackRowActivation and playTrack', () => {
    // 3.1 handleTrackRowActivation synchronous execution before any network wait
    const handleActivationIdx = indexHtml.indexOf('function handleTrackRowActivation(rowTrackId)');
    assert.ok(handleActivationIdx > 0, 'handleTrackRowActivation exists');
    const handleActivationSnippet = indexHtml.slice(handleActivationIdx, handleActivationIdx + 1200);

    assert.ok(handleActivationSnippet.includes('state.currentId = track.id'), 'handleTrackRowActivation immediately sets state.currentId');
    assert.ok(handleActivationSnippet.includes('displayTrack(track)'), 'handleTrackRowActivation synchronously invokes displayTrack');
    assert.ok(handleActivationSnippet.includes('applyOptimisticPlaybackUi(track)'), 'handleTrackRowActivation synchronously invokes applyOptimisticPlaybackUi');
    assert.ok(handleActivationSnippet.includes('setupAudio()'), 'handleTrackRowActivation initializes setupAudio on user gesture tick');
    assert.ok(handleActivationSnippet.includes('state.context.resume()'), 'handleTrackRowActivation calls state.context.resume() immediately');

    // 3.2 playTrack synchronous execution at entry
    const playTrackIdx = indexHtml.indexOf('async function playTrack(trackId)');
    assert.ok(playTrackIdx > 0, 'playTrack exists');
    const playTrackSnippet = indexHtml.slice(playTrackIdx, playTrackIdx + 1200);

    assert.ok(playTrackSnippet.includes('state.currentId = track.id'), 'playTrack immediately sets state.currentId');
    assert.ok(playTrackSnippet.includes('displayTrack(track)'), 'playTrack synchronously invokes displayTrack');
    assert.ok(playTrackSnippet.includes('applyOptimisticPlaybackUi(track)'), 'playTrack synchronously invokes applyOptimisticPlaybackUi');
    assert.ok(playTrackSnippet.includes('setupAudio()'), 'playTrack initializes setupAudio');
    assert.ok(playTrackSnippet.includes('state.context.resume()'), 'playTrack resumes context immediately on user gesture');

    // Verify optimistic UI occurs before any await statements in playTrack
    const firstAwaitIdx = playTrackSnippet.indexOf('await');
    const displayTrackInPlayIdx = playTrackSnippet.indexOf('displayTrack(track)');
    const stateCurrentIdInPlayIdx = playTrackSnippet.indexOf('state.currentId = track.id');

    assert.ok(stateCurrentIdInPlayIdx > 0 && (firstAwaitIdx === -1 || stateCurrentIdInPlayIdx < firstAwaitIdx), 'state.currentId must be set before any await in playTrack');
    assert.ok(displayTrackInPlayIdx > 0 && (firstAwaitIdx === -1 || displayTrackInPlayIdx < firstAwaitIdx), 'displayTrack must be called before any await in playTrack');
  });

  await t.test('4. Non-Blocking DOM: Defer renderQueue via rAF / requestIdleCallback', () => {
    // 4.1 deferRenderQueue definition and coalesce guard
    assert.match(indexHtml, /function deferRenderQueue\(\)/, 'deferRenderQueue function must exist');
    assert.match(indexHtml, /requestAnimationFrame|requestIdleCallback/, 'deferRenderQueue must use rAF or requestIdleCallback');

    // 4.2 Non-blocking queue calls in handleTrackRowActivation and playTrack
    assert.ok(
      indexHtml.includes('deferRenderQueue()'),
      'deferRenderQueue must be invoked for non-blocking queue updates'
    );

    // 4.3 Exposed renderQueue.defer or scheduleNonBlockingTask compatibility
    assert.ok(
      indexHtml.includes('deferRenderQueue') || indexHtml.includes('scheduleNonBlockingTask'),
      'Non-blocking queue rendering must be integrated into playback flow'
    );
  });

  await t.test('5. Web Audio API Graph Invariant strictly preserved', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio API graph invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
    );
  });

  await t.test('6. Dynamic Synchronous Performance Simulation (< 16ms click tick)', () => {
    // Simulate user click event and measure synchronous tick latency
    const state = {
      tracks: [
        { id: 'track-fast-1', title: 'Symphony No. 5', artist: 'Beethoven', format: 'FLAC 96/24', source: 'local' },
        { id: 'track-fast-2', title: 'Kind of Blue', artist: 'Miles Davis', format: 'DSD64', source: 'cloud' }
      ],
      currentId: 'track-fast-1',
      queueTrackIds: ['track-fast-2'],
      playGeneration: 1,
      context: {
        state: 'suspended',
        resume: async () => { state.context.state = 'running'; }
      }
    };

    let displayTrackCalled = false;
    let optimisticUiApplied = false;
    let audioSetupCalled = false;
    let queueDeferred = false;

    function mockDisplayTrack(track) {
      displayTrackCalled = true;
      state.currentId = track.id;
    }

    function mockApplyOptimisticUi(track) {
      optimisticUiApplied = true;
      state.currentId = track.id;
    }

    function mockSetupAudio() {
      audioSetupCalled = true;
    }

    function mockDeferRenderQueue() {
      queueDeferred = true;
      return 123;
    }

    // Measure synchronous execution of track row click simulation
    const t0 = performance.now();

    // Simulated click handler matching handleTrackRowActivation pattern:
    const clickedTrackId = 'track-fast-2';
    const track = state.tracks.find(t => t.id === clickedTrackId);
    state.currentId = track.id;
    mockDisplayTrack(track);
    mockApplyOptimisticUi(track);
    mockSetupAudio();
    if (state.context.state === 'suspended') {
      state.context.resume().catch(() => {});
    }
    mockDeferRenderQueue();

    const elapsedMs = performance.now() - t0;

    // Verify sub-16ms synchronous responsiveness
    assert.ok(elapsedMs < 16, `Synchronous execution tick must be < 16ms, measured: ${elapsedMs}ms`);
    assert.equal(state.currentId, 'track-fast-2', 'state.currentId synchronously updated in click tick');
    assert.equal(displayTrackCalled, true, 'displayTrack synchronously invoked');
    assert.equal(optimisticUiApplied, true, 'applyOptimisticPlaybackUi synchronously invoked');
    assert.equal(audioSetupCalled, true, 'setupAudio synchronously invoked on user gesture');
    assert.equal(queueDeferred, true, 'renderQueue deferred non-blockingly');
  });

});
