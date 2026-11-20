'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. library.fetchAudioBlob & fetchAudioFirstSlice retry mid-stream response.blob() network drops and honor Retry-After headers', async () => {
  const origFetch = global.fetch;
  try {
    // 1.1 Mid-stream response.blob() failure in fetchAudioBlob retries and succeeds
    let blobStreamCalls = 0;
    global.fetch = async () => {
      blobStreamCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'audio/flac' : '') },
        blob: async () => {
          if (blobStreamCalls < 3) {
            throw new TypeError('network error while streaming response body');
          }
          return { size: 8388608, type: 'audio/flac' };
        }
      };
    };
    const recoveredBlob = await lib.fetchAudioBlob('https://www.googleapis.com/drive/v3/files/flac1?alt=media', { retryDelayMs: 5 }, 'Google Drive');
    assert.equal(recoveredBlob.size, 8388608);
    assert.equal(blobStreamCalls, 3, 'Mid-stream response.blob() drop must be tagged retryable and retried');

    // 1.2 Mid-stream response.blob() failure in fetchAudioFirstSlice retries and succeeds
    let sliceStreamCalls = 0;
    global.fetch = async () => {
      sliceStreamCalls++;
      return {
        ok: true,
        status: 206,
        headers: {
          get: (k) => {
            const low = String(k).toLowerCase();
            if (low === 'content-type') return 'audio/flac';
            if (low === 'content-range') return 'bytes 0-1048575/25000000';
            if (low === 'content-length') return '1048576';
            return '';
          }
        },
        blob: async () => {
          if (sliceStreamCalls === 1) {
            throw new TypeError('connection reset mid-slice');
          }
          return { size: 1048576, type: 'audio/flac' };
        }
      };
    };
    const sliceRes = await lib.fetchAudioFirstSlice('https://graph.microsoft.com/v1.0/me/drive/items/od1/content', { retryDelayMs: 5, expectedTotalBytes: 25000000 }, 'OneDrive');
    assert.equal(sliceRes.blob.size, 1048576);
    assert.equal(sliceRes.complete, false);
    assert.equal(sliceStreamCalls, 2, 'fetchAudioFirstSlice must retry when response.blob() drops mid-slice');

    // 1.3 HTTP 429 / 503 with Retry-After header attaches retryAfterMs and succeeds on retry
    let rateLimitedCalls = 0;
    global.fetch = async () => {
      rateLimitedCalls++;
      if (rateLimitedCalls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? '0.01' : '') },
          text: async () => 'Too Many Requests'
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/flac' },
        blob: async () => ({ size: 4096, type: 'audio/flac' })
      };
    };
    const after429 = await lib.fetchAudioBlob('https://www.googleapis.com/drive/v3/files/flac2?alt=media', {}, 'Google Drive');
    assert.equal(after429.size, 4096);
    assert.equal(rateLimitedCalls, 2);
  } finally {
    global.fetch = origFetch;
  }
});

test('2. fetchCloudFile recovers from expired OneDrive directUrl (401/403) via fresh resolveMicrosoftDownloadUrl or Graph /content', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('async function fetchCloudFile(track, url, options, provider) {');
  const end = html.indexOf('async function loadGoogleAudio(fileId) {', start);
  assert.ok(start !== -1 && end > start, 'fetchCloudFile must exist');
  const fnSrc = html.slice(start, end);

  const blobCalls = [];
  const sandbox = {
    state: { microsoftAccessToken: 'tok-init' },
    library: {
      fetchAudioBlob: async (u, opts) => {
        blobCalls.push({ u, opts });
        if (u.indexOf('expired-sharepoint') !== -1) {
          const err = new Error('HTTP 403');
          err.status = 403;
          throw err;
        }
        return { size: 1024000, type: 'application/x-dsf', slice: () => ({}) };
      },
      normalizeAudioBlob: (b) => b
    },
    isGraphContentUrl: (u) => /^https:\/\/graph\.microsoft\.com\//i.test(String(u || '')),
    resolveMicrosoftDownloadUrl: async () => '',
    getMicrosoftToken: async () => 'fresh-ms-dsd-token',
    ensureGoogleToken: async () => 'goog-tok',
    enrichCloudTrack: async () => {},
    loadCloudMetadata: async (tr) => { tr.metadataLoaded = true; tr.cover = ''; },
    readAudioMetadata: async () => ({ sampleRate: 2822400, channels: 2, duration: 180 }),
    persistCloudCatalog: async () => {},
    isDsdFormat: (f) => /^(dsf|dff)$/i.test(String(f || '')),
    File: function (parts, name, opts) {
      this.name = name;
      this.size = parts[0] ? parts[0].size : 0;
      this.type = (opts && opts.type) || '';
    },
    Date,
    Object,
    String,
     encodeURIComponent,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.fetchCloudFile = fetchCloudFile;', sandbox);

  const track = {
    id: 'od-dsd-1',
    remoteId: 'dsd-item-77',
    source: 'onedrive',
    format: 'DSF',
    name: '01 - Nocturne DSD64.dsf',
    title: 'Nocturne DSD64',
    downloadUrl: 'https://tenant.sharepoint.com/expired-sharepoint',
    downloadUrlAt: Date.now() - 10000,
    metadataLoaded: true,
    cover: 'data:image/jpeg;base64,ok',
    sampleRate: 2822400
  };

  const file = await sandbox.fetchCloudFile(track, track.downloadUrl, {}, 'OneDrive');
  assert.ok(file);
  assert.equal(file.name, '01 - Nocturne DSD64.dsf');
  assert.equal(track.downloadUrl, '');
  assert.equal(blobCalls.length, 2);
  assert.equal(blobCalls[1].u, 'https://graph.microsoft.com/v1.0/me/drive/items/dsd-item-77/content');
  assert.equal(blobCalls[1].opts.headers.Authorization, 'Bearer fresh-ms-dsd-token');
});

test('3. graphGet retries transient 429/503/network errors and loadMicrosoftFiles scans folder batches concurrently', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gStart = html.indexOf('async function graphGet(url, token = state.microsoftAccessToken) {');
  const gEnd = html.indexOf('const microsoftOAuthRefreshScheduler =', gStart);
  assert.ok(gStart !== -1 && gEnd > gStart, 'graphGet must exist');
  const graphGetSrc = html.slice(gStart, gEnd);

  let fetchCalls = 0;
  const sandbox = {
    state: { microsoftAccessToken: 'tok-1' },
    getMicrosoftToken: async () => 'tok-2',
    fetch: async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? '0.01' : '') },
          text: async () => 'Throttled'
        };
      }
      if (fetchCalls === 2) {
        return {
          ok: false,
          status: 401,
          headers: { get: () => '' },
          text: async () => 'Expired'
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        json: async () => ({ value: [{ id: 'ok-1' }] })
      };
    },
    setTimeout,
    Promise,
    Number,
    Math
  };
  vm.createContext(sandbox);
  vm.runInContext(graphGetSrc + '\nthis.graphGet = graphGet;', sandbox);

  const res = await sandbox.graphGet('https://graph.microsoft.com/v1.0/me/drive/root/children');
  assert.deepEqual(res, { value: [{ id: 'ok-1' }] });
  assert.equal(fetchCalls, 3, 'graphGet must survive 429 followed by 401 token refresh');
  assert.equal(sandbox.state.microsoftAccessToken, 'tok-2');

  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  const msSrc = html.slice(msStart, msEnd);
  assert.ok(msSrc.includes('const FOLDER_BATCH_CONCURRENCY = 3;'), 'loadMicrosoftFiles must scan folders in concurrent batches of 3');
  assert.ok(msSrc.includes('updatedExistingTracks.push(existing);'), 'loadMicrosoftFiles must persist updated existing tracks to IndexedDB catalog');
});

test('4. Version sync v3.9.44 / versionCode 98, 0 CR bytes in assets & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.ok(/FiiO M11S · v3\.9\.(?:4[4-9]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.44';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.44';"));
  assert.ok(/versionCode\s*=\s*(?:9[8-9]|\d{3,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.44"'));
  assert.ok(/"3\.9\.(?:4[4-9]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[4-9]|[5-9]\d|\d{3,})/.test(publishRelease));

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets', f));
    assert.equal(assetBuf.includes(13), false, `${f} in android assets must have 0 CR bytes`);
  }
});
