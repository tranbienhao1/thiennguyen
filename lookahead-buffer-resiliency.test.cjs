const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const library = require('./library-utils.js');

const indexHtmlPath = path.join(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Pha D — Lookahead Audio Buffer Pipeline & Network Throttling Resiliency', async t => {
  await t.test('calculateNetworkThroughputAdaptiveProfile handles all network tiers and saveData mode', () => {
    // 1. Offline mode
    const offlineProfile = library.calculateNetworkThroughputAdaptiveProfile([], { isOnline: false });
    assert.equal(offlineProfile.tier, 'offline');
    assert.equal(offlineProfile.recommendedPrefetchTracks, 0);
    assert.equal(offlineProfile.recommendedSliceBytes, 0);
    assert.equal(offlineProfile.isThrottled, true);
    assert.equal(offlineProfile.allowMetadataEnrichment, false);

    // 2. High-speed network (e.g., 8 Mbps)
    const highSpeedSamples = [
      { bytes: 500000, durationMs: 500 }, // 8 Mbps
      { bytes: 1000000, durationMs: 1000 } // 8 Mbps
    ];
    const highSpeedProfile = library.calculateNetworkThroughputAdaptiveProfile(highSpeedSamples, { isOnline: true });
    assert.equal(highSpeedProfile.tier, 'high-speed');
    assert.equal(highSpeedProfile.recommendedPrefetchTracks, 3);
    assert.equal(highSpeedProfile.recommendedSliceBytes, 1048576); // 1MB
    assert.equal(highSpeedProfile.lookaheadTargetSeconds, 45);
    assert.equal(highSpeedProfile.allowMetadataEnrichment, true);
    assert.equal(highSpeedProfile.isThrottled, false);

    // 3. Stable network (e.g., 2.5 Mbps via downlink)
    const stableProfile = library.calculateNetworkThroughputAdaptiveProfile([], { isOnline: true, downlink: 2.5 });
    assert.equal(stableProfile.tier, 'stable');
    assert.equal(stableProfile.recommendedPrefetchTracks, 2);
    assert.equal(stableProfile.recommendedSliceBytes, 524288); // 512KB
    assert.equal(stableProfile.lookaheadTargetSeconds, 30);
    assert.equal(stableProfile.isThrottled, false);

    // 4. Constrained network (e.g., 800 kbps)
    const constrainedSamples = [{ bytes: 100000, durationMs: 1000 }]; // 800 kbps
    const constrainedProfile = library.calculateNetworkThroughputAdaptiveProfile(constrainedSamples, { isOnline: true });
    assert.equal(constrainedProfile.tier, 'constrained');
    assert.equal(constrainedProfile.recommendedPrefetchTracks, 1);
    assert.equal(constrainedProfile.recommendedSliceBytes, 262144); // 256KB
    assert.equal(constrainedProfile.allowMetadataEnrichment, false);

    // 5. Throttled / Slow 2G (e.g., 150 kbps)
    const throttledProfile = library.calculateNetworkThroughputAdaptiveProfile([], { isOnline: true, effectiveType: '2g' });
    assert.equal(throttledProfile.tier, 'throttled');
    assert.equal(throttledProfile.recommendedPrefetchTracks, 0);
    assert.equal(throttledProfile.recommendedSliceBytes, 131072); // 128KB
    assert.equal(throttledProfile.lookaheadTargetSeconds, 8);
    assert.equal(throttledProfile.isThrottled, true);

    // 6. SaveData mode clamps high-speed to constrained
    const saveDataProfile = library.calculateNetworkThroughputAdaptiveProfile([], { isOnline: true, downlink: 10, saveData: true });
    assert.equal(saveDataProfile.tier, 'constrained');
    assert.equal(saveDataProfile.saveDataActive, true);
    assert.equal(saveDataProfile.recommendedPrefetchTracks, 1);
    assert.equal(saveDataProfile.allowMetadataEnrichment, false);
  });

  await t.test('calculateThrottlingBackoff computes progressive delay and backoff levels', () => {
    // Attempt 1: immediate / short delay (~800ms)
    const backoff1 = library.calculateThrottlingBackoff(1, 800, 15000, { jitter: 0 });
    assert.equal(backoff1.delayMs, 800);
    assert.equal(backoff1.retryAllowed, true);
    assert.equal(backoff1.backoffLevel, 'immediate');

    // Attempt 3: moderate delay (~3200ms)
    const backoff3 = library.calculateThrottlingBackoff(3, 800, 15000, { jitter: 0 });
    assert.equal(backoff3.delayMs, 3200);
    assert.equal(backoff3.backoffLevel, 'quick');

    // Attempt 5: extended delay clamped to max (12800ms)
    const backoff5 = library.calculateThrottlingBackoff(5, 800, 15000, { jitter: 0 });
    assert.equal(backoff5.delayMs, 12800);
    assert.equal(backoff5.backoffLevel, 'extended');

    // Retries exhausted
    const backoff6 = library.calculateThrottlingBackoff(6, 800, 15000, { maxRetries: 5 });
    assert.equal(backoff6.retryAllowed, false);

    // Jitter stays within 15% range
    for (let i = 0; i < 20; i++) {
      const jBackoff = library.calculateThrottlingBackoff(2, 1000, 10000, { jitter: 0.15 });
      assert.ok(jBackoff.delayMs >= 1600 && jBackoff.delayMs <= 2400, 'Jittered delay must stay within [1700, 2300]');
    }
  });

  await t.test('evaluateLookaheadBufferPipeline diagnoses buffer health and actions', () => {
    // 1. Optimal pipeline: 20s active headroom and 100% next track readiness
    const optimal = library.evaluateLookaheadBufferPipeline(
      { currentTime: 30, duration: 200, bufferedEnd: 50, isPlaying: true },
      { isReady: true },
      3,
      { tier: 'high-speed', isThrottled: false }
    );
    assert.equal(optimal.activeHeadroomSec, 20);
    assert.equal(optimal.isUnderflowRisk, false);
    assert.equal(optimal.pipelineHealth, 'optimal');
    assert.equal(optimal.recommendedAction, 'normal');

    // 2. Vulnerable pipeline: only 3s headroom while playing
    const vulnerable = library.evaluateLookaheadBufferPipeline(
      { currentTime: 30, duration: 200, bufferedEnd: 33, isPlaying: true },
      { ratio: 0.2 },
      3,
      { tier: 'stable', isThrottled: false }
    );
    assert.equal(vulnerable.activeHeadroomSec, 3);
    assert.equal(vulnerable.isUnderflowRisk, true);
    assert.equal(vulnerable.pipelineHealth, 'vulnerable');
    assert.equal(vulnerable.recommendedAction, 'boost_active_buffer');

    // 3. Starving pipeline: 1.2s headroom (near stop)
    const starving = library.evaluateLookaheadBufferPipeline(
      { currentTime: 50, duration: 200, bufferedEnd: 51.2, isPlaying: true },
      { ratio: 0.0 },
      1,
      { tier: 'throttled', isThrottled: true }
    );
    assert.equal(starving.activeHeadroomSec, 1.2);
    assert.equal(starving.pipelineHealth, 'starving');
    assert.equal(starving.recommendedAction, 'emergency_fallback');

    // 4. Throttled network action
    const throttledState = library.evaluateLookaheadBufferPipeline(
      { currentTime: 10, duration: 180, bufferedEnd: 22, isPlaying: true },
      { ratio: 0.5 },
      2,
      { tier: 'throttled', isThrottled: true }
    );
    assert.equal(throttledState.recommendedAction, 'throttle_lookahead');
  });

  await t.test('formatLookaheadPipelineTelemetry outputs accurate localized badges', () => {
    const starvingText = library.formatLookaheadPipelineTelemetry({ pipelineHealth: 'starving', activeHeadroomSec: 1.5, nextTrackReadiness: 0 });
    assert.ok(starvingText.includes('🚨'));
    assert.ok(starvingText.includes('1.5s'));

    const vulnerableText = library.formatLookaheadPipelineTelemetry({ pipelineHealth: 'vulnerable', activeHeadroomSec: 3.2, nextTrackReadiness: 0.4 });
    assert.ok(vulnerableText.includes('⚠️'));
    assert.ok(vulnerableText.includes('3.2s'));

    const optimalText = library.formatLookaheadPipelineTelemetry({ pipelineHealth: 'optimal', activeHeadroomSec: 25.0, nextTrackReadiness: 1.0 });
    assert.ok(optimalText.includes('⚡'));
    assert.ok(optimalText.includes('25s'));
    assert.ok(optimalText.includes('100%'));

    assert.ok(library.formatLookaheadPipelineTelemetry(null).includes('Đệm'));
  });

  await t.test('DOM Integration & Invariants: Footer Telemetry & Audio Graph intact', () => {
    assert.ok(indexHtml.includes('id="footer-buffer-pipeline-badge"'), 'footer-buffer-pipeline-badge must exist in index.html');
    assert.ok(indexHtml.includes('calculateNetworkThroughputAdaptiveProfile'), 'index.html must reference adaptive network profile');
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio crossfeed to destination connection must never be broken'
    );
  });
});
