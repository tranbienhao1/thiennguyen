'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. preloadDsdNext skips pinning a second large raw DSD Blob for FiiO MicroSD tracks on low-RAM DAP', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('async function preloadDsdNext(next)');
  assert.ok(start > 0, 'preloadDsdNext must exist');
  const body = html.slice(start, start + 1400);
  assert.ok(body.includes("(state.fiioDapMode || (typeof IS_LEGACY_ANDROID !== 'undefined' && IS_LEGACY_ANDROID))"), 'guard must be limited to FiiO / legacy Android');
  assert.ok(body.includes("indexOf('fiio_') === 0"), 'guard must target FiiO local tracks');
  assert.ok(body.includes('48 * 1024 * 1024'), 'guard must allow small files under 48MB');
  assert.ok(body.indexOf('clearStalePreload()') < body.indexOf('await next.load()'), 'guard must run before next.load() downloads the Blob');
});

test('2. BitPerfectAudioPlayer uses an epoch guard so stale threads cannot clobber the next session', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('import java.util.concurrent.atomic.AtomicInteger;'));
  assert.ok(java.includes('private final AtomicInteger mPlaybackEpoch = new AtomicInteger(0);'));
  assert.ok(java.includes('private synchronized void stopInternal(boolean preserveSession) {\n            mPlaybackEpoch.incrementAndGet();'), 'stopInternal must invalidate the running epoch first');
  assert.ok(java.includes('final int playbackEpoch = mPlaybackEpoch.incrementAndGet();'));
  assert.ok(java.includes('runPlaybackLoop(trimmedUrl, sampleRate, bitDepth, playbackEpoch);'));
  assert.ok(java.includes('private void runPlaybackLoop(String urlOrPath, int requestedSampleRate, int requestedBitDepth, final int epoch) {'));
  assert.ok(java.includes('while (!mIsStopped && !sawOutputEOS && mPlaybackEpoch.get() == epoch) {'));
  assert.ok(java.includes('if (sawOutputEOS && !mIsStopped && mPlaybackEpoch.get() == epoch) {'), 'stale thread must not fire a completion/next-track event');
  assert.ok(java.includes('final boolean sessionCurrent = (mPlaybackEpoch.get() == epoch);'));
  assert.match(
    java,
    /if \(holdTransition\)\s*\{[\s\S]{0,400}\}\s*else if \(sessionCurrent\)\s*\{\s*mIsPlaying = false;\s*mIsPaused = false;[\s\S]{0,120}releaseWakeLock\(\);\s*abandonAudioFocus\(\);\s*(?:\}\s*)?\}/,
    'stale thread must not release the new session wake lock / audio focus'
  );
  assert.match(java, /final boolean holdTransition =[^;]*sessionCurrent[^;]*;/, 'transition hold must also require sessionCurrent');
});

test('3. Version sync v3.9.25 (versionCode 79), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.25';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.25';"));
  assert.ok(gradle.includes('versionCode = 79'));
  assert.ok(gradle.includes('versionName = "3.9.25"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S \u00b7 v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
