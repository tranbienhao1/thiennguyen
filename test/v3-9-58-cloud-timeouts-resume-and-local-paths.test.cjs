'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const mainActivity = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'),
  'utf8'
);

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.notEqual(s, -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

test('v3.9.58: fetchWithTimeout aborts stalled requests with TimeoutError and retries cleanly in fetchGoogleDrivePageWithRetry and graphGet', async () => {
  const timeoutAndDriveSrc = sliceBetween(
    html,
    'async function fetchWithTimeout(url, options, timeoutMs)',
    'const checkedGoogleArtParents = new Set();'
  );
  const graphGetSrc = sliceBetween(
    html,
    'async function graphGet(url, token = state.microsoftAccessToken)',
    'const microsoftOAuthRefreshScheduler ='
  );

  // 1. fetchWithTimeout aborts hanging fetch
  let abortSeen = false;
  const timeoutSandbox = {
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        abortSeen = true;
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
  };
  vm.createContext(timeoutSandbox);
  vm.runInContext(timeoutAndDriveSrc, timeoutSandbox);

  await assert.rejects(
    () => timeoutSandbox.fetchWithTimeout('https://slow.example/api', {}, 25),
    err => err && err.isTimeout === true && err.retryable === true && err.name === 'TimeoutError'
  );
  assert.equal(abortSeen, true);

  // 2. fetchGoogleDrivePageWithRetry recovers from network error + 429 Retry-After
  let driveCalls = 0;
  const driveSandbox = {
    AbortController,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    fetch: async () => {
      driveCalls++;
      if (driveCalls === 1) throw new TypeError('Failed to fetch');
      if (driveCalls === 2) {
        return { ok: false, status: 429, headers: { get: k => (k === 'retry-after' ? '1' : null) } };
      }
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    }
  };
  vm.createContext(driveSandbox);
  vm.runInContext(timeoutAndDriveSrc, driveSandbox);

  const driveResp = await driveSandbox.fetchGoogleDrivePageWithRetry('https://www.googleapis.com/drive/v3/files', () => 'tok', async () => 'tok2');
  assert.equal(driveResp.status, 200);
  assert.equal(driveCalls, 3);

  // 3. graphGet retries transient timeout error via fetchWithTimeout and succeeds
  let graphCalls = 0;
  const graphSandbox = {
    state: { microsoftAccessToken: 'ms-tok' },
    AbortController,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    getMicrosoftToken: async () => 'ms-tok-2',
    fetch: async () => {
      graphCalls++;
      if (graphCalls === 1) throw new Error('network stall');
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ value: [{ id: 'ok' }] }) };
    }
  };
  vm.createContext(graphSandbox);
  vm.runInContext(`${timeoutAndDriveSrc}\n${graphGetSrc}`, graphSandbox);

  const graphData = await graphSandbox.graphGet('https://graph.microsoft.com/v1.0/me/drive/root/children');
  assert.equal(graphData.value[0].id, 'ok');
  assert.equal(graphCalls, 2);
});

test('v3.9.58: seekCurrentPlaybackToSeconds delegates to applySmartSeekTime for Cloud first-slice playback and pre-warms cloud session resume', () => {
  const seekSrc = sliceBetween(
    html,
    'function seekCurrentPlaybackToSeconds(targetSec, expectedTrackId)',
    'window.getCurrentPlaybackPositionSeconds ='
  );

  const smartSeeks = [];
  const audioEl = { currentTime: 0, duration: 15, readyState: 2 };
  const state = {
    isNativeBitPerfectPlaying: false,
    currentId: 'google:long-track',
    activeDeck: { element: audioEl },
    tracks: [
      { id: 'google:long-track', source: 'google', firstSlicePlayback: true, duration: 400 },
      { id: 'local:full', source: 'local', firstSlicePlayback: false, duration: 300 }
    ]
  };
  const sandbox = {
    state,
    audio: audioEl,
    applySmartSeekTime: sec => smartSeeks.push(sec)
  };
  vm.createContext(sandbox);
  vm.runInContext(seekSrc, sandbox);

  // Cloud first-slice track must delegate to applySmartSeekTime instead of clamping to 14.5s
  const okSlice = sandbox.seekCurrentPlaybackToSeconds(225, 'google:long-track');
  assert.equal(okSlice, true);
  assert.deepEqual(smartSeeks, [225]);
  assert.equal(audioEl.currentTime, 0, 'must not clamp directly to truncated first-slice duration');

  // Local full track still seeks directly on audioEl
  state.currentId = 'local:full';
  audioEl.duration = 300;
  const okLocal = sandbox.seekCurrentPlaybackToSeconds(120, 'local:full');
  assert.equal(okLocal, true);
  assert.equal(audioEl.currentTime, 120);

  // Resume session handler pre-warms cloud token/downloadUrl before playTrack
  assert.ok(html.includes('prepareCloudTrackForPreload(session.track)'), 'resume-session-play must pre-warm cloud token/downloadUrl');
});

test('v3.9.58: MainActivity hardens local special chars (file://, +, stray %, #, ?) and BitPerfect Scoped Storage PFD fallback', () => {
  assert.ok(mainActivity.includes('public static String decodeQueryComponentSafe('), 'MainActivity must expose decodeQueryComponentSafe');
  assert.ok(mainActivity.includes('public static String extractLocalMediaQueryParam('), 'MainActivity must expose extractLocalMediaQueryParam');
  assert.ok(mainActivity.includes('.replace("+", "%2B").replaceAll("%(?![0-9a-fA-F]{2})", "%25")'), 'must protect literal + and stray % before URLDecoder.decode');
  assert.ok(mainActivity.includes('String pathParam = extractLocalMediaQueryParam(uri, "path");'), 'handleLocalMediaStreaming must use extractLocalMediaQueryParam');
  assert.ok(mainActivity.includes('String strippedFile = resolvedPath.substring(7);'), 'BitPerfect must safely strip file:// without truncating # or ?');
  assert.ok(mainActivity.includes('ParcelFileDescriptor fbPfd = getContentResolver().openFileDescriptor(fallbackMediaUri, "r")'), 'BitPerfect Scoped Storage fallbackMediaUri must support ParcelFileDescriptor fallback');
});

test('v3.9.58+: monotonic version alignment across web, service worker, and Android Gradle', () => {
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[89]|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[89]|[6-9]\d|\d{3,})';/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[89]|[6-9]\d|\d{3,})/);
  const codeMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 112, 'versionCode must be >= 112');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[89]|[6-9]\d|\d{3,})"/);
});
