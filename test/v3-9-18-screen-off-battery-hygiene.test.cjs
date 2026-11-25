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

test('1. MainActivity.java smart WifiLock (local vs remote), idle onPause release, screen-off 2000ms throttle & MediaSession duration', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(java.includes('private volatile boolean mIsInBackground = false;'), 'MainActivity must track background state');
  assert.ok(java.includes('private volatile boolean mIsMediaPlaying = false;'), 'MainActivity must track media playing state');
  assert.ok(java.includes('public void acquireWakeLock(boolean needWifiLock)'), 'acquireWakeLock must support needWifiLock flag');
  assert.ok(java.includes('Released WifiLock for offline local playback'), 'Local playback must release WifiLock to save FiiO M11S battery');
  assert.match(
    java,
    /protected void onPause\(\)\s*\{[\s\S]{0,500}if \([\s\S]{0,200}!mIsMediaPlaying[\s\S]{0,200}\(mBitPerfectPlayer == null \|\| !mBitPerfectPlayer\.isPlaying\(\)\)\)\s*\{\s*releaseWakeLock\(\);\s*\}/,
    'onPause must guarantee WakeLock/WifiLock release when idle'
  );
  assert.ok(java.includes('final long uiUpdateIntervalMs = mIsInBackground ? 2000L : 250L;'), 'BitPerfect position IPC must throttle 8x (2000ms) while screen is off');
  assert.ok(java.includes('MediaMetadata.METADATA_KEY_DURATION'), 'MediaSession metadata must publish duration when BitPerfect duration is known');
  assert.ok(java.includes('onNativeBitPerfectPosition(")\n                      .append(bpPosMs)'), 'onResume must snap BitPerfect seek position immediately on screen wake');
  assert.ok(java.includes('mIsRemoteStream = !(trimmedUrl.startsWith("/")'), 'BitPerfect must distinguish local vs remote stream sources');
});

test('2. index.html onAndroidAppLifecycle suspends idle AudioContext in background and resumes when playing in foreground', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('window.onAndroidAppLifecycle = (phase) => {');
  const end = html.indexOf('(function initScrollToTopPill()', start);
  assert.ok(start !== -1 && end > start, 'onAndroidAppLifecycle must exist');
  const src = html.slice(start, end);

  let visCalls = [];
  let suspendCalls = 0;
  let resumeCalls = 0;
  const mockWindow = {};
  const mockAudio = { paused: true };
  const state = {
    activeDeck: { element: mockAudio },
    isNativeBitPerfectPlaying: false,
    context: {
      state: 'running',
      suspend() { suspendCalls++; this.state = 'suspended'; return Promise.resolve(); },
      resume() { resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    }
  };

  new Function('window', 'state', 'audio', 'setVisualizerRunning', src)(
    mockWindow,
    state,
    mockAudio,
    (v) => visCalls.push(v)
  );

  // Background while paused -> stops visualizer AND suspends idle AudioContext
  mockWindow.onAndroidAppLifecycle('background');
  assert.deepEqual(visCalls, [false]);
  assert.equal(suspendCalls, 1, 'Idle paused AudioContext must suspend in background');

  // Background while playing -> stops visualizer, does NOT suspend active AudioContext!
  state.context.state = 'running';
  mockAudio.paused = false;
  mockWindow.onAndroidAppLifecycle('background');
  assert.equal(suspendCalls, 1, 'Active playing AudioContext must NOT be suspended in background');

  // Foreground while playing with suspended context -> resumes AudioContext & restarts visualizer
  state.context.state = 'suspended';
  mockWindow.onAndroidAppLifecycle('foreground');
  assert.equal(resumeCalls, 1, 'Suspended AudioContext must resume on foreground playback');
  assert.equal(visCalls[visCalls.length - 1], true);
});

test('3. index.html skips screen-off DOM thrashing on CUE timeupdate & progress events', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('if (typeof document !== \'undefined\' && document.hidden) return;'), 'updateBufferPipelineTelemetry must skip DOM work when screen is off');
  assert.ok(html.includes('const isCueScreenHidden = typeof document !== \'undefined\' && Boolean(document.hidden);\n          if (!isCueScreenHidden) {'), 'CUE timeupdate branch must skip DOM/canvas redraws when screen is off');
  assert.ok(html.includes("element.addEventListener('progress', () => { if (!(typeof document !== 'undefined' && document.hidden)) updateBufferPipelineTelemetry(element); });"), 'progress listener must skip telemetry DOM updates when screen is off');
});

test('4. Version sync v3.9.18 (versionCode 72), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const assetSw = fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.18';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.18';"));
  assert.ok(gradle.includes('versionCode = 72'));
  assert.ok(gradle.includes('versionName = "3.9.18"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.equal(html, assetHtml);
  assert.equal(sw, assetSw);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
