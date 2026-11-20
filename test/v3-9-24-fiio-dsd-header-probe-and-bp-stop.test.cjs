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

test('1. playDsdTrack & playTrack automatically probe readAudioMetadata when FiiO MicroSD DSD track has no initial sampleRate', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('if (track.file && !dsdSourceInfo(track.sampleRate) && typeof readAudioMetadata === \'function\')'), 'playTrack must probe DSD header via readAudioMetadata when sampleRate is missing');
  assert.ok(html.includes('if (!dsdSourceInfo(track.sampleRate) && track.file && typeof readAudioMetadata === \'function\')'), 'playDsdTrack must also probe readAudioMetadata as a fallback before dsdSourceInfo');
  assert.ok(html.includes("if (previousTrack && previousTrack.id !== track.id && String(previousTrack.id || '').indexOf('fiio_') === 0 && previousTrack.file) {\n            previousTrack.file = null;\n          }"), 'playTrack must free previous FiiO MicroSD raw DSD file Blob on track switch');

  // Behavioral test on playDsdTrack probing readAudioMetadata before dsdSourceInfo rejection
  const start = html.indexOf('async function playDsdTrack(track, generation, playRequestedAt) {');
  const end = html.indexOf('function playNext(', start);
  assert.ok(start !== -1 && end > start);
  const src = html.slice(start, end);

  let workerStarted = false;
  let skippedFailure = null;
  let readMetaCalls = 0;

  function FakeWorker() {
    workerStarted = true;
    this.postMessage = () => {};
    this.terminate = () => {};
  }

  const state = {
    playGeneration: 1,
    dsdOutputRate: 88200,
    dsdOutputDepth: 24,
    context: { state: 'running', resume: async () => {} }
  };

  const playDsdTrack = new Function(
    'state', 'stopDsdWorker', 'dsdSourceInfo', 'readAudioMetadata', '$',
    'audio', 'standbyAudio', 'setupAudio', 'displayTrack', 'scheduleTrackRender',
    'toast', 'location', 'getCachedFirstSlice', 'Worker', 'URL', 'dsdWorkerBaseUrl',
    'skipFailedTrack',
    src + '\nreturn playDsdTrack;'
  )(
    state,
    () => {},
    (rate) => (Number(rate) === 2822400 ? { baseRate: 44100, multiplier: 64 } : null),
    async () => {
      readMetaCalls++;
      return { sampleRate: 2822400, bitDepth: 1, channels: 2, duration: 210 };
    },
    () => ({ value: '88200', textContent: '' }),
    { pause() {}, removeAttribute() {}, load() {} },
    { pause() {}, removeAttribute() {}, load() {} },
    () => {},
    () => {},
    () => {},
    () => {},
    { protocol: 'https:' },
    async () => null,
    FakeWorker,
    function (u) { this.href = u; },
    'https://appassets.androidplatform.net/',
    (_gen, msg) => { skippedFailure = msg; }
  );

  const fiioDsdTrack = {
    id: 'fiio_dsd_1',
    title: 'Kind of Blue DSD64',
    format: 'DSF',
    isDsd: true,
    sampleRate: undefined,
    file: { size: 120000000 }
  };

  await playDsdTrack(fiioDsdTrack, 1, 0);

  assert.equal(readMetaCalls, 1, 'Must probe readAudioMetadata when sampleRate is missing');
  assert.equal(fiioDsdTrack.sampleRate, 2822400, 'Must populate track.sampleRate from DSF header');
  assert.equal(fiioDsdTrack.channels, 2);
  assert.equal(fiioDsdTrack.duration, 210);
  assert.equal(skippedFailure, null, 'Must NOT reject FiiO DSD track as unsupported');
  assert.equal(workerStarted, true, 'Must launch DSD decoder worker after probing sampleRate');
});

test('2. Switching from Native Bit-Perfect to cloud track stops native playback before awaiting cloud load & BoundedFileInputStream guards FD leak', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const loadBlockIdx = html.indexOf('if (track.load && !cachedCloudUrl) {');
  assert.ok(loadBlockIdx !== -1);
  const loadSnippet = html.slice(loadBlockIdx, loadBlockIdx + 420);
  assert.ok(
    loadSnippet.includes('if (state.isNativeBitPerfectPlaying)') &&
    loadSnippet.indexOf('stopBitPerfectPlayback()') < loadSnippet.indexOf('await track.load()') ||
    html.slice(loadBlockIdx, loadBlockIdx + 950).indexOf('stopBitPerfectPlayback()') < html.slice(loadBlockIdx, loadBlockIdx + 950).indexOf('await track.load()'),
    'playTrack must stop active Native Bit-Perfect playback before awaiting cloud track.load()'
  );

  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(
    java.includes('} catch (IOException seekErr) {\n                try { this.mRaf.close(); } catch (IOException ignored) {}\n                throw seekErr;\n            }'),
    'BoundedFileInputStream must close RandomAccessFile if seek throws IOException'
  );
});

test('3. Version sync v3.9.24 (versionCode 78), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.24';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.24';"));
  assert.ok(gradle.includes('versionCode = 78'));
  assert.ok(gradle.includes('versionName = "3.9.24"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
