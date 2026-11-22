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

test('v3.9.83: onNativeBitPerfectError respects paused state and preserves resume position without auto-playing', () => {
  const start = html.indexOf('window.onNativeBitPerfectError = (reason, nativePosMs) => {');
  assert.notEqual(start, -1);
  const body = extractFn(html, 'window.onNativeBitPerfectError = (reason, nativePosMs) =>');
  let playedCount = 0;
  let uiSyncVal = null;
  const curTrack = { id: 'tr-1', source: 'fiio', name: 'Test.flac' };
  const sandbox = {
    window: {},
    console: { warn() {} },
    Date,
    audio: { paused: true },
    state: {
      currentId: 'tr-1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: true,
      lastBitPerfectPositionSec: 42.5,
      tracks: [curTrack]
    },
    playTrack() { playedCount++; },
    syncPlaybackButtonsUi(v) { uiSyncVal = v; }
  };
  vm.runInNewContext(body, sandbox);
  sandbox.window.onNativeBitPerfectError('DAC unplugged', 43200);
  assert.equal(playedCount, 0, 'Must NOT auto-play through speaker when Bit-Perfect was paused');
  assert.equal(uiSyncVal, false, 'Must keep play button synced to paused');
  assert.equal(curTrack._skipNativeBpOnce, true);
  assert.equal(curTrack._resumeAfterBpFallbackSec, 43.2);
});

test('v3.9.83: applyFiioRescanFields & onAndroidStorageStateChanged clear stale /local-cover?uri and access errors on MicroSD remount', () => {
  const rescanSrc = extractFn(html, 'function applyFiioRescanFields(prevTrack, file, normPath, normUri, existingPaths, existingUris, existingByPath, existingByUri)');
  const sandbox = {};
  vm.runInNewContext(rescanSrc, sandbox);
  const prevTrack = {
    id: 'f1',
    source: 'fiio',
    uri: 'content://media/external/audio/media/100',
    path: '/storage/1234-5678/Music/A.flac',
    url: 'https://appassets.androidplatform.net/local-media?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F100',
    cover: 'https://appassets.androidplatform.net/local-cover?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F100',
    _localAccessError: 'not_found',
    _pathFallbackRetriedGen: 3,
    name: 'A'
  };
  const existingPaths = new Set([prevTrack.path]);
  const existingUris = new Set([prevTrack.uri]);
  const existingByPath = new Map([[prevTrack.path, prevTrack]]);
  const existingByUri = new Map([[prevTrack.uri, prevTrack]]);
  sandbox.applyFiioRescanFields(
    prevTrack,
    { name: 'A.flac', size: 12345 },
    prevTrack.path,
    'content://media/external/audio/media/999',
    existingPaths,
    existingUris,
    existingByPath,
    existingByUri
  );
  assert.equal(prevTrack.uri, 'content://media/external/audio/media/999');
  assert.equal(prevTrack.url, '', 'Stale /local-media?uri URL cleared');
  assert.equal(prevTrack.cover, '', 'Stale /local-cover?uri URL cleared');
  assert.equal(prevTrack._localAccessError, null);
  assert.equal(prevTrack._pathFallbackRetriedGen, 0);

  // Also check onAndroidStorageStateChanged clears failedNativeCovers on 'mounted'
  assert.ok(html.includes("if (reason === 'mounted') {\n          if (typeof failedNativeCovers !== 'undefined'"));
});

test('v3.9.83: runCloudWakeTokenRefresh retries pending slice upgrade & resyncs preload on wake and online/offline', () => {
  const wakeSrc = extractFn(html, 'function runCloudWakeTokenRefresh()');
  let sliceRetried = 0;
  let preloadResynced = 0;
  let msCleared = 0;
  const sandbox = {
    navigator: { onLine: true },
    Date,
    lastTokenKeepAliveAt: 0,
    lastMicrosoftWakeRefreshAt: 0,
    state: {
      currentId: 'c1',
      googleToken: '',
      googleExpiresAt: 0,
      msAccount: { username: 'u@example.com' },
      microsoftAccessToken: 'tok',
      microsoftExpiresAt: Date.now() - 1000,
      _preloadFailedTrackId: 'c2',
      _preloadFailedAt: Date.now(),
      tracks: [{ id: 'c1', source: 'onedrive', _pendingSliceUpgrade: true }]
    },
    clearStaleMicrosoftDownloadUrls() { msCleared++; return 2; },
    getMicrosoftToken: async () => 'new-tok',
    retryPendingCurrentSliceUpgrade: async () => { sliceRetried++; },
    resyncNextPreload() { preloadResynced++; }
  };
  vm.runInNewContext(wakeSrc, sandbox);
  sandbox.runCloudWakeTokenRefresh();
  assert.equal(msCleared, 1);
  assert.equal(sliceRetried, 1);
  assert.equal(preloadResynced, 1);
  assert.equal(sandbox.state._preloadFailedTrackId, null);

  assert.ok(html.includes("if (typeof runCloudWakeTokenRefresh === 'function') runCloudWakeTokenRefresh();"));
  assert.ok(html.includes('if (preloaded && !canPlayPreloadOffline) resyncNextPreload(true);'));
});

test('v3.9.83: Version bump parity across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.83';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.83';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30983);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 137);
  assert.ok(gradle.includes('versionName = "3.9.83"'));
});
