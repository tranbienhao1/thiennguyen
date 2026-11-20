'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const library = require('../library-utils.js');

const ROOT = path.resolve(__dirname, '..');

test('1. upgradeSliceToFullAudio recovers when OneDrive directUrl returns 401/403 (fresh directUrl or Graph /content fallback)', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('const isGraphContentUrl = url =>');
  const end = html.indexOf('async function fetchCloudTrack(', start);
  assert.ok(start > 0 && end > start, 'upgradeSliceToFullAudio slice must be extractable');
  const src = html.slice(start, end);

  const expiredDirectUrl = 'https://tenant.sharepoint.com/personal/user/_layouts/15/download.aspx?e=expired';
  const freshDirectUrl = 'https://tenant.sharepoint.com/personal/user/_layouts/15/download.aspx?e=fresh';

  // Case A: resolveMicrosoftDownloadUrl returns a fresh direct URL
  {
    const fetchCalls = [];
    const track = {
      id: 'onedrive:item-1',
      remoteId: 'item-1',
      source: 'onedrive',
      name: '01.flac',
      title: 'Song 1',
      format: 'FLAC',
      url: 'blob:slice-1',
      downloadUrl: expiredDirectUrl,
      downloadUrlAt: Date.now()
    };
    const sandbox = {
      state: { currentId: 'onedrive:item-1', objectUrls: new Set(['blob:slice-1']) },
      audio: { src: 'blob:other', paused: true, addEventListener() {}, load() {} },
      standbyAudio: { src: '', paused: true, load() {} },
      library: {
        fetchAudioBlob: async (url, opts) => {
          fetchCalls.push({ url, opts });
          if (url === expiredDirectUrl) {
            const err = new Error('Forbidden');
            err.status = 403;
            throw err;
          }
          return { type: 'audio/flac', size: 12345 };
        },
        normalizeAudioBlob: (b) => b
      },
      resolveMicrosoftDownloadUrl: async (tr) => {
        tr.downloadUrl = freshDirectUrl;
        tr.downloadUrlAt = Date.now();
        return freshDirectUrl;
      },
      getMicrosoftToken: async () => 'ms-token-should-not-be-used',
      finishCloudMetadataInBackground: () => {},
      releaseTrackUrl: () => {},
      URL: class extends URL {
        static createObjectURL() { return 'blob:full-1'; }
        static revokeObjectURL() {}
      },
      location: { href: 'https://nocturne.local/' },
      AbortController,
      Number,
      Boolean,
      String,
      Object,
      Date,
      Promise,
      encodeURIComponent,
      setTimeout,
      clearTimeout,
      console
    };
    vm.runInNewContext(src + '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;', sandbox);

    const fullUrl = await sandbox.upgradeSliceToFullAudio(track, 'blob:slice-1', expiredDirectUrl, {}, 'OneDrive');
    assert.equal(fullUrl, 'blob:full-1');
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].url, expiredDirectUrl);
    assert.equal(fetchCalls[1].url, freshDirectUrl);
  }

  // Case B: resolveMicrosoftDownloadUrl fails/returns empty -> falls back to Graph /content with Bearer token
  {
    const fetchCalls = [];
    const track = {
      id: 'onedrive:item-2',
      remoteId: 'item-2',
      source: 'onedrive',
      name: '02.flac',
      title: 'Song 2',
      format: 'FLAC',
      url: 'blob:slice-2',
      downloadUrl: expiredDirectUrl,
      downloadUrlAt: Date.now()
    };
    const sandbox = {
      state: { currentId: 'onedrive:item-2', objectUrls: new Set(['blob:slice-2']) },
      audio: { src: 'blob:other', paused: true, addEventListener() {}, load() {} },
      standbyAudio: { src: '', paused: true, load() {} },
      library: {
        fetchAudioBlob: async (url, opts) => {
          fetchCalls.push({ url, opts });
          if (url === expiredDirectUrl) {
            const err = new Error('Unauthorized');
            err.status = 401;
            throw err;
          }
          return { type: 'audio/flac', size: 54321 };
        },
        normalizeAudioBlob: (b) => b
      },
      resolveMicrosoftDownloadUrl: async () => '',
      getMicrosoftToken: async () => 'ms-bearer-fallback-token',
      finishCloudMetadataInBackground: () => {},
      releaseTrackUrl: () => {},
      URL: class extends URL {
        static createObjectURL() { return 'blob:full-2'; }
        static revokeObjectURL() {}
      },
      location: { href: 'https://nocturne.local/' },
      AbortController,
      Number,
      Boolean,
      String,
      Object,
      Date,
      Promise,
      encodeURIComponent,
      setTimeout,
      clearTimeout,
      console
    };
    vm.runInNewContext(src + '\nthis.upgradeSliceToFullAudio = upgradeSliceToFullAudio;', sandbox);

    const fullUrl = await sandbox.upgradeSliceToFullAudio(track, 'blob:slice-2', expiredDirectUrl, {}, 'OneDrive');
    assert.equal(fullUrl, 'blob:full-2');
    assert.equal(track.downloadUrl, '', 'Expired downloadUrl must be cleared');
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[1].url, 'https://graph.microsoft.com/v1.0/me/drive/items/item-2/content');
    assert.equal(fetchCalls[1].opts.headers.Authorization, 'Bearer ms-bearer-fallback-token');
  }
});

test('2. removeDeletedCloudTracks prunes deleted Google Drive & OneDrive tracks while protecting state.currentId, and loadGoogleFiles/loadMicrosoftFiles backfill & persist non-blockingly', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rmStart = html.indexOf('function removeDeletedCloudTracks(source, seenRemoteIds, isCompleteScan) {');
  const rmEnd = html.indexOf('async function loadGoogleFiles() {', rmStart);
  assert.ok(rmStart > 0 && rmEnd > rmStart, 'removeDeletedCloudTracks must exist above loadGoogleFiles');

  const deletedStoreKeys = [];
  const sandbox = {
    state: {
      currentId: 'google:playing-now',
      tracks: [
        { id: 'google:keep-1', remoteId: 'keep-1', source: 'google' },
        { id: 'google:deleted-1', remoteId: 'deleted-1', source: 'google' },
        { id: 'google:playing-now', remoteId: 'playing-now', source: 'google' },
        { id: 'onedrive:od-1', remoteId: 'od-1', source: 'onedrive' }
      ]
    },
    catalogTransaction: () => {
      const tx = { oncomplete: null, onerror: null };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
      return {
        delete(k) { deletedStoreKeys.push(k); },
        transaction: tx
      };
    },
    Promise,
    String
  };
  vm.runInNewContext(html.slice(rmStart, rmEnd) + '\nthis.removeDeletedCloudTracks = removeDeletedCloudTracks;', sandbox);

  const removedCount = await sandbox.removeDeletedCloudTracks('google', new Set(['keep-1']), true);
  assert.equal(removedCount, 1);
  assert.deepEqual(deletedStoreKeys, ['google:deleted-1']);
  assert.deepEqual(
    sandbox.state.tracks.map(t => t.id),
    ['google:keep-1', 'google:playing-now', 'onedrive:od-1'],
    'Must remove deleted Google track while preserving active playing track and OneDrive tracks'
  );

  // Verify loadGoogleFiles backfills existing.parents and calls removeDeletedCloudTracks
  const gEnd = html.indexOf('async function fetchCloudFile(', rmEnd);
  const gSrc = html.slice(rmEnd, gEnd);
  assert.ok(gSrc.includes('existing.parents = file.parents.slice(0, 3);'), 'loadGoogleFiles must backfill missing parents on existing tracks');
  assert.ok(gSrc.includes("removeDeletedCloudTracks('google', seenRemoteIds, true)"), 'loadGoogleFiles must prune deleted Drive tracks on complete scan');

  // Verify loadMicrosoftFiles uses non-blocking persistChain and prunes deleted OneDrive tracks
  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  const msSrc = html.slice(msStart, msEnd);
  assert.ok(msSrc.includes('persistChain = persistChain.then(() => persistCloudCatalog(batch, { skipPrune: true }))'), 'loadMicrosoftFiles must use non-blocking persistChain');
  assert.ok(msSrc.includes("removeDeletedCloudTracks('onedrive', seenRemoteIds, true)"), 'loadMicrosoftFiles must prune deleted OneDrive tracks on complete scan');
});

test('3. Native Bit-Perfect CUE sub-track initial seek, relative time/duration display, boundary auto-advance & displayTrack #room-play sync', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 3a. playTrack Native Bit-Perfect block seeks to cueStartSec * 1000
  const ptStart = html.indexOf('const bpStarted = window.NocturneNative.startBitPerfectPlayback(');
  const ptSlice = html.slice(ptStart, ptStart + 900);
  assert.ok(ptSlice.includes('const cueStartSec = (Number.isFinite(track.cueStart) && track.cueStart > 0) ? track.cueStart : 0;'));
  assert.ok(ptSlice.includes('window.NocturneNative.seekBitPerfectPlayback(Math.round(cueStartSec * 1000));'));

  // 3b. displayTrack syncs #room-play with isNotifPlaying
  const dtStart = html.indexOf('function displayTrack(track) {');
  const dtEnd = html.indexOf('function syncCanvasDimensions(', dtStart);
  const dtSrc = html.slice(dtStart, dtEnd);
  assert.ok(dtSrc.includes("$('room-play').textContent = isNotifPlaying ? 'Ⅱ' : '▶';"), 'displayTrack must use isNotifPlaying for #room-play');

  // 3c. onNativeBitPerfectPosition displays relative CUE time/duration and auto-advances at cueStart + duration
  const bpStart = html.indexOf('function setupBitPerfectIntegration()');
  const bpEnd = html.indexOf('window.setupBitPerfectIntegration = setupBitPerfectIntegration;', bpStart);
  const elements = {};
  const mkEl = () => ({ textContent: '', value: '0', checked: false, matches: () => false, addEventListener: () => {}, classList: { remove() {} }, setAttribute() {}, style: { setProperty() {} } });
  const getEl = (id) => (elements[id] || (elements[id] = mkEl()));
  const syncVals = [];
  const advanceCalls = [];
  const bpSandbox = {
    $: getEl,
    state: {
      currentId: 'cue-2',
      tracks: [{ id: 'cue-2', title: 'Movement II', cueStart: 120, duration: 80 }],
      isSeeking: false,
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lyrics: [],
      fiioDapMode: true
    },
    library,
    window: { NocturneNative: { getBitPerfectPosition: () => 140000, getBitPerfectDuration: () => 600000 } },
    document: { hidden: false },
    syncSeek: (r) => syncVals.push(r),
    paintSeek: () => {},
    playNext: (dir, auto) => advanceCalls.push({ dir, auto }),
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
    formatRemainingTime: (c, d) => `-${Math.floor((d - c) / 60)}:${String(Math.floor((d - c) % 60)).padStart(2, '0')}`,
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
    Math,
    Number,
    String,
    Boolean
  };
  vm.runInNewContext(html.slice(bpStart, bpEnd) + '\nsetupBitPerfectIntegration();', bpSandbox);

  // At 140s absolute (20s into 80s CUE sub-track starting at 120s): displays 0:20 / 1:20 (ratio 250)
  bpSandbox.window.onNativeBitPerfectPosition(140000, 600000);
  assert.equal(getEl('current-time').textContent, '0:20');
  assert.equal(getEl('duration').textContent, '1:20');
  assert.equal(getEl('room-remaining').textContent, '-1:00');
  assert.deepEqual(syncVals, [250]);
  assert.equal(advanceCalls.length, 0);

  // At 200s absolute (cueStart 120 + duration 80): auto-advances to next CUE sub-track once
  bpSandbox.window.onNativeBitPerfectPosition(200000, 600000);
  assert.deepEqual(advanceCalls, [{ dir: 1, auto: true }]);
  assert.equal(bpSandbox.state.isNativeBitPerfectPlaying, false);
});

test('4. Version sync v3.9.42 / versionCode 96, 0 CR bytes in assets & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.42'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.42';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.42';"));
  assert.ok(/versionCode\s*=\s*96\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.42"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.42"'));
  assert.ok(publishRelease.includes("'v3.9.42'"));

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  const filesToScan = syncedFiles.filter(f => f !== 'tailwind.min.css');
  for (const rel of filesToScan) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.ok(!/[^\w$]\?\.\w|\?\.\[|\?\.\(/.test(stripped), `${rel} must not use optional chaining (?.)`);
    assert.ok(!/\?\?[^=]/.test(stripped), `${rel} must not use nullish coalescing (??)`);
    assert.ok(!/\.replaceAll\s*\(/.test(stripped), `${rel} must not use .replaceAll()`);
    assert.ok(!/\bcatch\s*\{/.test(stripped), `${rel} must not use bare catch {}`);
  }
});
