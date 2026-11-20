'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. fetchCloudTrack refreshes expired OneDrive token on fetchAudioFirstSlice (401) for Graph /content URLs only', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('async function fetchCloudTrack(track, url, options, provider) {');
  const end = html.indexOf('const mediaErrorMessage = error => {', start);
  assert.ok(start !== -1 && end > start, 'fetchCloudTrack must exist');
  const src = html.slice(start, end);

  let sliceAttempts = 0;
  let blobAttempts = 0;
  let msRefreshCalls = 0;
  let lastAuthHeader = '';

  const library = {
    fetchAudioFirstSlice: async (url, opts) => {
      sliceAttempts++;
      lastAuthHeader = (opts && opts.headers && opts.headers.Authorization) || '';
      if (sliceAttempts === 1) {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      return { blob: { size: 4194304, type: 'audio/flac' }, complete: false, totalBytes: 42000000 };
    },
    fetchAudioBlob: async () => {
      blobAttempts++;
      throw new Error('Should not fall back to full blob when 401 refresh succeeds on first slice');
    },
    normalizeAudioBlob: (b) => b
  };

  const state = { objectUrls: new Set(), currentId: 'od-1' };
  const fetchCloudTrack = new Function(
    'library', 'queueCloudMetadata', 'state', 'URL',
    'finishCloudMetadataInBackground', 'upgradeSliceToFullAudio',
    'getMicrosoftToken', 'getCachedFirstSlice', 'cacheFirstSlice',
    'isGraphContentUrl', 'ensureGoogleToken',
    src + '\nreturn fetchCloudTrack;'
  )(
    library,
    () => {},
    state,
    { createObjectURL: () => 'blob:od-slice-ok' },
    () => {},
    async () => null,
    async () => { msRefreshCalls++; return 'fresh-ms-token'; },
    async () => null,
    () => {},
    (u) => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
    async () => 'unused-google'
  );

  const track = { id: 'od-1', source: 'onedrive', format: 'FLAC', size: 42000000, title: 'Song', metadataLoaded: true, cover: 'x' };
  const url = await fetchCloudTrack(
    track,
    'https://graph.microsoft.com/v1.0/me/drive/items/abc/content',
    { headers: { Authorization: 'Bearer expired-ms' } },
    'OneDrive'
  );

  assert.equal(url, 'blob:od-slice-ok');
  assert.equal(msRefreshCalls, 1, 'Must refresh Microsoft token once on 401');
  assert.equal(sliceAttempts, 2, 'Must retry fetchAudioFirstSlice immediately after refresh');
  assert.equal(blobAttempts, 0, 'Must NOT fall back to full-file fetchAudioBlob when slice retry succeeds');
  assert.equal(lastAuthHeader, 'Bearer fresh-ms-token', 'Retried slice must carry fresh Bearer token');
});

test('2. loadMicrosoftFiles renders progressively per page and defers queueCloudMetadata until finally', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('async function loadMicrosoftFiles(token) {');
  const end = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', start);
  assert.ok(start !== -1 && end > start, 'loadMicrosoftFiles must exist');
  const src = html.slice(start, end);

  assert.ok(src.includes("if (typeof scheduleTrackRender === 'function') scheduleTrackRender();"), 'OneDrive sync must progressively render discovered pages');
  assert.ok(src.includes('} finally {') && src.includes('queueCloudMetadata(pendingMsMeta)'), 'OneDrive sync must defer background metadata fetches to finally block');
  assert.ok(!src.includes('queueCloudMetadata(pageTracks)'), 'OneDrive sync must not contend for Graph API bandwidth during folder listing');
});

test('3. FiiO catalog compaction shrinks payload, hydrates local-media URLs, and recovers from QuotaExceededError', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function compactFiioTrackForStorage(t, ultraLean) {');
  const end = html.indexOf('window.restoreFiioCatalog = restoreFiioCatalog;', start);
  assert.ok(start !== -1 && end > start, 'FiiO catalog functions must exist');
  const src = html.slice(start, end + 'window.restoreFiioCatalog = restoreFiioCatalog;'.length);

  // Build 1000 realistic FiiO tracks with long local-media URLs
  const sampleTracks = [];
  for (let i = 0; i < 1000; i++) {
    const p = '/storage/ABCD-1234/Music/Audiophile Artist ' + (i % 40) + '/Hi-Res Album ' + (i % 100) + '/01 - Track ' + i + '.flac';
    sampleTracks.push({
      id: 'fiio_' + i,
      title: 'Track ' + i,
      name: 'Track ' + i,
      path: p,
      source: 'local',
      url: 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(p),
      size: 48000000,
      isDsd: i % 10 === 0,
      format: i % 10 === 0 ? 'DSF' : 'FLAC',
      artist: 'Audiophile Artist ' + (i % 40),
      album: 'Hi-Res Album ' + (i % 100),
      duration: 245.678,
      trackNumber: 0,
      discNumber: 0,
      year: '',
      genre: ''
    });
  }

  const rawUncompactedLen = JSON.stringify(sampleTracks).length;
  const store = {};
  let maxQuotaBytes = 10 * 1024 * 1024;
  let setItemCalls = 0;

  const mockStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      setItemCalls++;
      if (v.length > maxQuotaBytes) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store[k] = v;
    }
  };

  const state = { tracks: sampleTracks.slice() };
  const ctx = {
    window: {},
    state,
    localStorage: mockStorage,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    encodeURIComponent,
    console,
    propagateAndBroadcastCovers: () => {},
    renderTracks: () => {},
    renderCollectionCards: () => {}
  };
  vm.runInNewContext(src, ctx);

  // Normal save: verify >= 35% size reduction and lossless URL reconstruction on restore
  ctx.window.saveFiioCatalog();
  const compactedLen = store['nocturne-fiio-catalog'].length;
  assert.ok(compactedLen < rawUncompactedLen * 0.65, `Expected >35% catalog compaction (${compactedLen} vs ${rawUncompactedLen})`);

  state.tracks = [];
  ctx.window.restoreFiioCatalog();
  assert.equal(state.tracks.length, 1000, 'Must restore all 1000 tracks');
  assert.equal(state.tracks[0].url, sampleTracks[0].url, 'Must deterministically reconstruct /local-media?path= URL');
  assert.equal(state.tracks[0].isDsd, true, 'Must preserve DSD flag');
  assert.equal(state.tracks[1].isDsd, false);

  // Tight quota simulation: triggers ultra-lean + trimming recovery without crashing
  maxQuotaBytes = Math.floor(compactedLen * 0.5);
  setItemCalls = 0;
  ctx.window.saveFiioCatalog(sampleTracks);
  assert.ok(setItemCalls >= 3, 'Must fall back to ultra-lean and quota-capped persistence on QuotaExceededError');
  const trimmed = JSON.parse(store['nocturne-fiio-catalog']);
  assert.ok(trimmed.length >= 250 && trimmed.length < 1000, 'Quota recovery must persist maximum fitting prefix');
});

test('4. Version sync v3.9.19 (versionCode 73), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const assetSw = fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.19';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.19';"));
  assert.ok(gradle.includes('versionCode = 73'));
  assert.ok(gradle.includes('versionName = "3.9.19"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.equal(html, assetHtml);
  assert.equal(sw, assetSw);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
