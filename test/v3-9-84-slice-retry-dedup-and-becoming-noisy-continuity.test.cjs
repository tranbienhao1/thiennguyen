'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const javaSrc = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

function extractFn(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find ${signature}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0, inSingle = false, inDouble = false, inTpl = false, escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (!inDouble && !inTpl && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTpl && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTpl = !inTpl; continue; }
    if (inSingle || inDouble || inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated function ${signature}`);
}

test('v3.9.84: retryPendingCurrentSliceUpgrade deduplicates concurrent calls and aborts launch if track switched mid-refresh', async () => {
  const retrySrc = extractFn(html, 'async function retryPendingCurrentSliceUpgrade()');
  let resolveTok;
  let upgradeCalls = 0;
  const track = {
    id: 'g1',
    source: 'google',
    firstSlicePlayback: true,
    fullAudioUrl: null,
    fullAudioPromise: null,
    _pendingSliceUpgrade: { sliceUrl: 'blob:slice-1', url: 'https://www.googleapis.com/drive/v3/files/1?alt=media', options: {}, provider: 'Google Drive' }
  };
  const sandbox = {
    navigator: { onLine: true },
    location: { href: 'https://example.com/' },
    URL,
    audio: { src: 'blob:slice-1' },
    state: { currentId: 'g1', tracks: [track] },
    ensureGoogleToken: () => new Promise(r => { resolveTok = r; }),
    upgradeSliceToFullAudio: async () => { upgradeCalls++; }
  };
  vm.runInNewContext(retrySrc, sandbox);

  const p1 = sandbox.retryPendingCurrentSliceUpgrade();
  const p2 = sandbox.retryPendingCurrentSliceUpgrade();
  assert.equal(await p2, false, 'Concurrent retry must be skipped while _retryingSliceUpgrade is active');

  // Switch track before token resolves
  sandbox.state.currentId = 'g2';
  resolveTok('new-tok');
  assert.equal(await p1, false, 'Must NOT launch full upgrade after user switched tracks');
  assert.equal(upgradeCalls, 0);
  assert.equal(track._retryingSliceUpgrade, false);
});

test('v3.9.84: onAndroidAudioBecomingNoisy guards First-Slice upgrade, preserves playing DSD worker, and syncs native MediaSession', () => {
  const noisySrc = extractFn(html, 'window.onAndroidAudioBecomingNoisy = () =>');
  let dsdStopped = 0;
  let uiPaused = 0;
  let posSynced = 0;
  const audio = { paused: true, src: 'blob:dsd-slice', _upgradingFullAudio: true, _userPausedDuringUpgrade: false, pause() {} };
  const standbyAudio = { paused: true, _upgradingFullAudio: false, _userPausedDuringUpgrade: false, pause() {} };
  const sandbox = {
    window: { __androidNoisyNativeWasPlaying: false },
    navigator: { mediaSession: { playbackState: 'playing' } },
    audio,
    standbyAudio,
    state: {
      currentId: 'd1',
      playGeneration: 5,
      isPlaybackLoading: false,
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      dsdWorker: { id: 'w1' },
      dsdUrl: 'blob:dsd-slice',
      tracks: [{ id: 'd1', title: 'DSD Track' }]
    },
    stopDsdWorker() { dsdStopped++; },
    syncPlaybackButtonsUi(v) { if (v === false) uiPaused++; },
    updatePositionState() { posSynced++; },
    toast() {}
  };
  vm.runInNewContext(noisySrc, sandbox);
  sandbox.window.onAndroidAudioBecomingNoisy();

  assert.equal(audio._userPausedDuringUpgrade, true, 'Must stamp _userPausedDuringUpgrade so loadedmetadata does not blast speakers');
  assert.equal(audio._upgradingFullAudio, false);
  assert.equal(dsdStopped, 0, 'Must NOT destroy active DSD worker when DSD slice is already loaded');
  assert.equal(uiPaused, 1);
  assert.equal(posSynced, 1);

  // MainActivity.triggerAudioBecomingNoisy syncs MediaSession natively when pausing Bit-Perfect
  const triggerIdx = javaSrc.indexOf('private void triggerAudioBecomingNoisy(String reason)');
  assert.notEqual(triggerIdx, -1);
  const triggerBlock = javaSrc.slice(triggerIdx, triggerIdx + 1200);
  assert.ok(triggerBlock.includes('syncAudioFocusNativeUiAndMediaSession(false);'), 'triggerAudioBecomingNoisy must sync native MediaSession immediately');
});

test('v3.9.84: Version bump parity across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.84';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.84';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30984);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 138);
  assert.ok(gradle.includes('versionName = "3.9.84"'));
});
