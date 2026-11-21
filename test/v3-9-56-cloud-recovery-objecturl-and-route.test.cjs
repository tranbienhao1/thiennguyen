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

function extractFn(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Could not find marker: ${startMarker}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && (inSingle || inDouble || inBacktick)) { escaped = true; continue; }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '`') { inBacktick = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          let end = i + 1;
          if (source[end] === ';') end++;
          return source.slice(start, end);
        }
      }
    } else if (inSingle && ch === "'") inSingle = false;
    else if (inDouble && ch === '"') inDouble = false;
    else if (inBacktick && ch === '`') inBacktick = false;
  }
  throw new Error(`Unbalanced braces for marker: ${startMarker}`);
}

test('v3.9.56: pruneExcessObjectUrls revokes idle audio blob URLs while protecting active, preloaded, DSD, and cover URLs', () => {
  const fnSrc = extractFn(html, 'function pruneExcessObjectUrls(maxBudget)');
  const revoked = [];
  const state = {
    fiioDapMode: false,
    currentId: 't-cur',
    preloadTrackId: 't-next',
    dsdUrl: 'blob:dsd-active',
    preloadReadyUrl: 'blob:preload-ready',
    objectUrls: new Set([
      'blob:idle-1',
      'blob:idle-2',
      'blob:idle-3',
      'blob:cover-1',
      'blob:cur-audio',
      'blob:next-audio',
      'blob:dsd-active',
      'blob:preload-ready'
    ]),
    tracks: [
      { id: 't-idle-1', url: 'blob:idle-1', fullAudioUrl: null, cover: 'blob:cover-1' },
      { id: 't-idle-2', url: 'blob:idle-2', fullAudioUrl: 'blob:idle-3', cover: '' },
      { id: 't-cur', url: 'blob:cur-audio', fullAudioUrl: null, cover: '' },
      { id: 't-next', url: 'blob:next-audio', fullAudioUrl: null, cover: '' }
    ]
  };
  const sandbox = {
    state,
    IS_LEGACY_ANDROID: false,
    audio: { src: 'blob:cur-audio' },
    standbyAudio: { src: 'blob:next-audio' },
    location: { href: 'https://nocturne.local/' },
    URL: class FakeURL {
      constructor(u) { this.href = u; }
      static revokeObjectURL(u) { revoked.push(u); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);

  const count = sandbox.pruneExcessObjectUrls(5);
  assert.equal(count, 3);
  assert.deepEqual(revoked, ['blob:idle-1', 'blob:idle-2', 'blob:idle-3']);
  assert.equal(state.tracks[0].url, '');
  assert.equal(state.tracks[1].url, '');
  assert.equal(state.tracks[1].fullAudioUrl, null);
  assert.equal(state.objectUrls.has('blob:cover-1'), true, 'visible album cover blob URL must be protected');
  assert.equal(state.objectUrls.has('blob:cur-audio'), true, 'active audio URL must be protected');
  assert.equal(state.objectUrls.has('blob:next-audio'), true, 'preloaded track URL must be protected');
  assert.equal(state.objectUrls.has('blob:dsd-active'), true, 'active DSD URL must be protected');
});

test('v3.9.56: retryPendingCurrentSliceUpgrade recovers failed Google Drive & OneDrive full-audio upgrades on reconnect', async () => {
  const fnSrc = extractFn(html, 'async function retryPendingCurrentSliceUpgrade()');
  const upgradeCalls = [];

  // Case 1: Google Drive track stranded on first slice after Wi-Fi drop
  const gTrack = {
    id: 'google:g1',
    source: 'google',
    remoteId: 'g1',
    firstSlicePlayback: true,
    fullAudioUrl: null,
    fullAudioPromise: null,
    _pendingSliceUpgrade: {
      sliceUrl: 'blob:slice-g1',
      url: 'https://www.googleapis.com/drive/v3/files/g1?alt=media',
      options: { headers: { Authorization: 'Bearer old-g' } },
      provider: 'Google Drive'
    }
  };
  // Case 2: OneDrive track stranded on expired directUrl after 4G switch
  const msTrack = {
    id: 'onedrive:m1',
    source: 'onedrive',
    remoteId: 'm1',
    downloadUrl: 'https://old-direct.example/m1',
    downloadUrlAt: 1,
    firstSlicePlayback: true,
    fullAudioUrl: null,
    fullAudioPromise: null,
    _pendingSliceUpgrade: {
      sliceUrl: 'blob:slice-m1',
      url: 'https://old-direct.example/m1',
      options: {},
      provider: 'OneDrive'
    }
  };

  const state = { currentId: 'google:g1', tracks: [gTrack, msTrack] };
  const audio = { src: 'blob:slice-g1' };
  const sandbox = {
    state,
    audio,
    navigator: { onLine: true },
    location: { href: 'https://nocturne.local/' },
    URL: class FakeURL { constructor(u) { this.href = u; } },
    isGraphContentUrl: u => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
    ensureGoogleToken: async () => 'fresh-g-tok',
    resolveMicrosoftDownloadUrl: async () => 'https://fresh-direct.example/m1',
    getMicrosoftToken: async () => 'fresh-ms-tok',
    upgradeSliceToFullAudio: async (tr, sliceUrl, url, opts, provider) => {
      upgradeCalls.push({ id: tr.id, sliceUrl, url, opts, provider });
      return 'blob:full';
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);

  const okGoogle = await sandbox.retryPendingCurrentSliceUpgrade();
  assert.equal(okGoogle, true);
  assert.equal(upgradeCalls.length, 1);
  assert.equal(upgradeCalls[0].opts.headers.Authorization, 'Bearer fresh-g-tok');
  assert.equal(gTrack._pendingSliceUpgrade, null);

  state.currentId = 'onedrive:m1';
  audio.src = 'blob:slice-m1';
  const okMs = await sandbox.retryPendingCurrentSliceUpgrade();
  assert.equal(okMs, true);
  assert.equal(upgradeCalls.length, 2);
  assert.equal(upgradeCalls[1].url, 'https://fresh-direct.example/m1');
  assert.equal(msTrack._pendingSliceUpgrade, null);
});

test('v3.9.56: same-file CUE sub-tracks hand off gaplessly on Native Bit-Perfect and Web HTML5 Audio', () => {
  assert.ok(html.includes('const isSameCueNativeParent = Boolean('), 'Native Bit-Perfect branch must detect same-file CUE sub-track transitions');
  assert.ok(html.includes('const isSameCueHtmlParent = Boolean('), 'HTML5 Audio branch must detect same-file CUE sub-track transitions');
  assert.ok(html.includes('if (typeof retryPendingCurrentSliceUpgrade === \'function\') retryPendingCurrentSliceUpgrade()'), 'online event must trigger retryPendingCurrentSliceUpgrade');
});

test('v3.9.56: MainActivity recovers AudioTrack ERROR_DEAD_OBJECT on route switch and detects Line-Out & LE Audio DAC types', () => {
  assert.match(mainActivity, /AudioTrack\.ERROR_DEAD_OBJECT/);
  assert.match(mainActivity, /deadObjectRecoveries\s*<\s*2/);
  assert.match(mainActivity, /registerReceiver\(mBecomingNoisyReceiver,\s*noisyFilter,\s*Context\.RECEIVER_NOT_EXPORTED\)/);
  assert.match(mainActivity, /AudioDeviceInfo\.TYPE_LINE_ANALOG/);
  assert.match(mainActivity, /AudioDeviceInfo\.TYPE_LINE_DIGITAL/);
  assert.match(mainActivity, /AudioDeviceInfo\.TYPE_BLE_HEADSET/);
});

test('v3.9.56+: monotonic version alignment across web, service worker, and Android Gradle', () => {
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[6-9]|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[6-9]|[6-9]\d|\d{3,})';/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[6-9]|[6-9]\d|\d{3,})/);
  const codeMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 110, 'versionCode must be >= 110');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[6-9]|[6-9]\d|\d{3,})"/);
});
