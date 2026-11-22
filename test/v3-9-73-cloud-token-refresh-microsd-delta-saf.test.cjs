'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const MAIN_JAVA = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const PUBLISH_JS = path.join(ROOT, '.agent', 'publish-release.cjs');
const lib = require(path.join(ROOT, 'library-utils.js'));

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, 'Missing start marker: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, 'Missing end marker: ' + endMarker);
  return src.slice(start, end);
}

test('1. library.fetchAudioFirstSlice supports 3-attempt backoff retry, stops immediately on 401 and honors pre-aborted AbortSignal', async () => {
  const origFetch = global.fetch;
  try {
    // 1.1 Fails twice (503, then network TypeError) -> succeeds on 3rd attempt
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => '' },
          text: async () => 'Service Unavailable'
        };
      }
      if (calls === 2) {
        const netErr = new TypeError('Failed to fetch');
        throw netErr;
      }
      return {
        ok: true,
        status: 206,
        headers: { get: (k) => ({ 'content-type': 'audio/flac', 'content-range': 'bytes 0-1048575/12000000' }[String(k).toLowerCase()] || '') },
        blob: async () => ({ size: 1048576, type: 'audio/flac' })
      };
    };
    const res = await lib.fetchAudioFirstSlice('https://cloud.example/multi-retry.flac', { retryDelayMs: 0, expectedTotalBytes: 12000000 }, 'OneDrive');
    assert.equal(calls, 3, 'fetchAudioFirstSlice must survive 2 transient failures and succeed on attempt 3');
    assert.equal(res.blob.size, 1048576);

    // 1.2 HTTP 401 is non-retryable inside fetchAudioFirstSlice (aborts after 1 attempt so upper auth layer refreshes)
    let authCalls = 0;
    global.fetch = async () => {
      authCalls++;
      return {
        ok: false,
        status: 401,
        headers: { get: () => '' },
        text: async () => 'Unauthorized'
      };
    };
    await assert.rejects(
      () => lib.fetchAudioFirstSlice('https://cloud.example/auth-fail.flac', { retryDelayMs: 0 }, 'OneDrive'),
      (err) => err && err.status === 401
    );
    assert.equal(authCalls, 1, 'HTTP 401 must not be retried blindly by fetchAudioFirstSlice');

    // 1.3 Pre-aborted AbortSignal fails immediately with AbortError without invoking fetch
    let abortedCalls = 0;
    global.fetch = async () => {
      abortedCalls++;
      throw new Error('Should not execute fetch when signal is already aborted');
    };
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => lib.fetchAudioFirstSlice('https://cloud.example/pre-aborted.flac', { signal: ac.signal, retryDelayMs: 0 }, 'Google Drive'),
      (err) => err && err.name === 'AbortError' && err.aborted === true
    );
    assert.equal(abortedCalls, 0);
  } finally {
    global.fetch = origFetch;
  }
});

test('2. getMicrosoftToken(false, true) bypasses stale silent cache with forceRefresh and OneDrive recovers expired 404/410 directUrls cleanly', async () => {
  const html = readFile(INDEX_HTML);

  // 2.1 VM runtime test of getMicrosoftToken(false, true)
  const tokenSrc = sliceBetween(
    html,
    'let microsoftMsalInitPromise = null;',
    'async function applyMicrosoftSiblingFolderCovers('
  );
  const acquireCalls = [];
  const state = {
    msal: {
      acquireTokenSilent: async (req) => {
        acquireCalls.push(req);
        if (req.forceRefresh) {
          return { accessToken: 'fresh-ms-token-99', expiresOn: new Date(Date.now() + 3600000) };
        }
        return { accessToken: 'cached-ms-token-01', expiresOn: new Date(Date.now() + 3600000) };
      }
    },
    msAccount: { homeAccountId: 'acct-1' },
    microsoftAccessToken: '',
    microsoftLastRefreshAt: 0,
    microsoftExpiresAt: 0
  };
  const ctx = {
    state,
    microsoftOAuthRefreshScheduler: { scheduleRefresh: () => {} },
    library: { parseCloudConfig: () => ({}) },
    localStorage: { getItem: () => null },
    safeVal: () => '',
    $: () => null,
    DEFAULT_MICROSOFT_CLIENT_ID: 'default-id',
    location: { origin: 'https://example.test', pathname: '/' },
    msal: { InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {} }
  };
  vm.runInNewContext(tokenSrc, ctx);

  const cachedTok = await ctx.getMicrosoftToken(false);
  assert.equal(cachedTok, 'cached-ms-token-01');
  const refreshedTok = await ctx.getMicrosoftToken(false, true);
  assert.equal(refreshedTok, 'fresh-ms-token-99');
  assert.equal(acquireCalls.length, 2);
  assert.equal(Boolean(acquireCalls[0].forceRefresh), false);
  assert.equal(acquireCalls[1].forceRefresh, true);

  // 2.2 Verify 401/403 recovery callers forceRefresh = true across critical playback & sync paths
  const forceRefreshRegex = /getMicrosoftToken\(false,\s*true\)/g;
  const forceRefreshMatches = html.match(forceRefreshRegex) || [];
  assert.ok(forceRefreshMatches.length >= 10, 'Expected at least 10 getMicrosoftToken(false, true) force-refresh sites across OneDrive playback/sync/metadata/lyrics');

  // 2.3 VM runtime test of fetchCloudTrack rethrowing 404/410 on SharePoint directUrl & falling back on moovAtTail 410
  const fetchCloudTrackSrc = sliceBetween(html, 'async function fetchCloudTrack(track, url, options, provider) {', 'const mediaErrorMessage = error => {');
  const directUrl = 'https://contoso.sharepoint.com/download.aspx?tempauth=expired410';
  {
    let sliceCalls = 0;
    let blobCalls = 0;
    const fLib = {
      fetchAudioFirstSlice: async () => {
        sliceCalls++;
        const err = new Error('Gone');
        err.status = 410;
        throw err;
      },
      fetchAudioBlob: async () => {
        blobCalls++;
        return { size: 100, type: 'audio/flac' };
      },
      normalizeAudioBlob: (b) => b
    };
    const fState = { objectUrls: new Set(), currentId: 'od-410' };
    const fetchCloudTrack = new Function(
      'library', 'queueCloudMetadata', 'state', 'URL',
      'finishCloudMetadataInBackground', 'upgradeSliceToFullAudio',
      'getMicrosoftToken', 'getCachedFirstSlice', 'cacheFirstSlice',
      'isGraphContentUrl', 'ensureGoogleToken',
      fetchCloudTrackSrc + '\nreturn fetchCloudTrack;'
    )(
      fLib, () => {}, fState, { createObjectURL: () => 'blob:x' },
      () => {}, async () => null, async () => 'forced-tok', async () => null, () => {},
      (u) => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
      async () => 'gtok'
    );
    const tr = { id: 'od-410', remoteId: 'od-item-410', source: 'onedrive', format: 'FLAC', size: 15000000, metadataLoaded: true, cover: 'x' };
    await assert.rejects(() => fetchCloudTrack(tr, directUrl, {}, 'OneDrive'), (e) => e && e.status === 410);
    assert.equal(sliceCalls, 1);
    assert.equal(blobCalls, 0, 'Must rethrow expired SharePoint 410 immediately rather than retrying same dead URL with fetchAudioBlob');
  }

  // 2.4 VM runtime test of loadMicrosoftAudio: cached directUrl failure refreshes directUrl once, and Graph fallback passes forceRefresh = true
  const loadMsSrc = sliceBetween(html, 'async function loadMicrosoftAudio(itemId) {', 'function settingsError(error) {');
  const fetchedUrls = [];
  const msTokenFlags = [];
  const odTrack = {
    id: 'ms-t1',
    remoteId: 'ms-item-1',
    remoteDriveId: 'drv-shared-7',
    source: 'onedrive',
    format: 'FLAC',
    downloadUrl: 'https://contoso.sharepoint.com/stale-cached',
    downloadUrlAt: Date.now() - 1000
  };
  let resolveCount = 0;
  const loadMsCtx = {
    state: { tracks: [odTrack] },
    resolveMicrosoftDownloadUrl: async (tr) => {
      resolveCount++;
      if (resolveCount === 1) return tr.downloadUrl;
      return 'https://contoso.sharepoint.com/fresh-refreshed';
    },
    isDsdFormat: () => false,
    fetchCloudFile: async () => {},
    fetchCloudTrack: async (tr, u) => {
      fetchedUrls.push(u);
      if (u.includes('stale-cached') || u.includes('fresh-refreshed')) {
        const err = new Error('SharePoint expired');
        err.status = 404;
        throw err;
      }
      return 'blob:graph-fallback-ok';
    },
    getMicrosoftToken: async (interactive, forceRefresh) => {
      msTokenFlags.push({ interactive, forceRefresh });
      return 'fresh-graph-token';
    }
  };
  vm.runInNewContext(loadMsSrc, loadMsCtx);
  await loadMsCtx.loadMicrosoftAudio('ms-item-1');
  assert.deepEqual(fetchedUrls, [
    'https://contoso.sharepoint.com/stale-cached',
    'https://contoso.sharepoint.com/fresh-refreshed',
    'https://graph.microsoft.com/v1.0/drives/drv-shared-7/items/ms-item-1/content'
  ]);
  assert.deepEqual(msTokenFlags, [{ interactive: false, forceRefresh: true }]);
});

test('3. MicroSD rescan fast-skip skips completely unchanged files while still refreshing modified, renamed or incomplete tracks', () => {
  const html = readFile(INDEX_HTML);
  const scanHelpersSrc = sliceBetween(
    html,
    'function isFiioTrackRescanUnchanged(prevTrack, file, normPath, normUri) {',
    'function deduplicateStorageRoots(rawPaths) {'
  );

  let upgraded = 0;
  let enriched = 0;
  let applied = 0;
  const existingTrack = {
    id: 'fiio_1',
    title: 'Kind of Blue',
    name: '01 So What',
    path: '/storage/SD/Music/01 So What.flac',
    uri: 'content://media/external/audio/media/42',
    url: 'https://appassets.androidplatform.net/local-media?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F42',
    size: 45123456,
    lastModified: 1730000000000,
    duration: 562,
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    cover: 'https://appassets.androidplatform.net/local-cover?id=42'
  };
  const scanCtx = {
    window: {},
    library: {
      createFiioTrack: (f) => ({ id: 'new_' + f.name, path: f.path, uri: f.uri, name: f.name }),
      enrichFiioTrackMetadata: () => { enriched++; }
    },
    state: { tracks: [existingTrack] },
    fiioScanSkippedUnchangedCount: 0,
    fiioScanUpgradedCount: 0,
    buildExistingFiioTrackMaps: () => ({
      existingByPath: new Map([[existingTrack.path, existingTrack]]),
      existingByUri: new Map([[existingTrack.uri, existingTrack]])
    }),
    applyFiioRescanFields: (prev, f) => {
      applied++;
      prev.size = Number(f.size) || prev.size;
      if (f.lastModified) prev.lastModified = f.lastModified;
    },
    createFiioFallbackTrack: (f) => ({ id: 'fb_' + f.name })
  };
  vm.runInNewContext(scanHelpersSrc, scanCtx);

  const unchangedFile = {
    name: '01 So What.flac',
    path: '/storage/SD/Music/01 So What.flac',
    uri: 'content://media/external/audio/media/42',
    size: 45123456,
    lastModified: 1730000000000,
    duration: 562,
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    title: 'Kind of Blue'
  };
  assert.equal(scanCtx.isFiioTrackRescanUnchanged(existingTrack, unchangedFile, unchangedFile.path, unchangedFile.uri), true);
  assert.equal(scanCtx.isFiioTrackRescanUnchanged(existingTrack, { ...unchangedFile, size: 45123999 }, unchangedFile.path, unchangedFile.uri), false, 'Changed file size must trigger rescan update');
  assert.equal(scanCtx.isFiioTrackRescanUnchanged(existingTrack, { ...unchangedFile, lastModified: 1730000005000 }, unchangedFile.path, unchangedFile.uri), false, 'Newer lastModified must trigger rescan update');
  assert.equal(scanCtx.isFiioTrackRescanUnchanged(existingTrack, { ...unchangedFile, name: '01 So What (Remaster).flac' }, unchangedFile.path, unchangedFile.uri), false, 'Renamed filename must trigger rescan update');
  assert.equal(scanCtx.isFiioTrackRescanUnchanged({ ...existingTrack, cover: '' }, unchangedFile, unchangedFile.path, unchangedFile.uri), false, 'Missing cover must allow re-enrichment');
  assert.equal(scanCtx.isFiioTrackRescanUnchanged({ ...existingTrack, artist: 'Unknown Artist' }, unchangedFile, unchangedFile.path, unchangedFile.uri), false, 'Placeholder artist must allow re-enrichment');
  assert.equal(scanCtx.isFiioTrackRescanUnchanged({ ...existingTrack, url: '' }, unchangedFile, unchangedFile.path, unchangedFile.uri), false, 'Missing local playback URL must allow restoration');

  const existingPaths = new Set([existingTrack.path]);
  const existingUris = new Set([existingTrack.uri]);
  const addedUnchanged = scanCtx.ingestFiioScannedFilesChunk([unchangedFile], existingPaths, existingUris, []);
  assert.equal(addedUnchanged, 0);
  assert.equal(scanCtx.fiioScanSkippedUnchangedCount, 1);
  assert.equal(applied, 0, 'Unchanged MicroSD track must skip applyFiioRescanFields');
  assert.equal(enriched, 0, 'Unchanged MicroSD track must skip enrichFiioTrackMetadata');

  // Now feed a modified file with newer size -> must NOT skip
  scanCtx.ingestFiioScannedFilesChunk([{ ...unchangedFile, size: 45200000 }], existingPaths, existingUris, []);
  assert.equal(applied, 1, 'Modified MicroSD track must run applyFiioRescanFields');
  assert.equal(enriched, 1, 'Modified MicroSD track must run enrichFiioTrackMetadata');
});

test('4. Android MainActivity handles SAF SecurityException/FileNotFoundException fallback & persisted URI inspection', () => {
  const java = readFile(MAIN_JAVA);

  assert.ok(java.includes('import android.content.UriPermission;'), 'MainActivity must import UriPermission');
  assert.ok(java.includes('import java.io.FileNotFoundException;'), 'MainActivity must import FileNotFoundException');
  assert.ok(java.includes('catch (SecurityException secErr)'), 'handleLocalMediaRequest must catch SecurityException on content:// URIs');
  assert.ok(java.includes('catch (FileNotFoundException fnfErr)'), 'handleLocalMediaRequest must catch FileNotFoundException on content:// URIs');
  assert.ok(java.includes('errHeaders.put("X-Nocturne-Storage-Error", "SAF_PERMISSION_REVOKED")'), 'Revoked SAF/MediaStore URI must return explicit 403 storage error header');
  assert.ok(java.includes('new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", errHeaders'), 'Revoked SAF/MediaStore URI without path fallback must return HTTP 403');
  assert.ok(java.includes('public String getPersistedSafUrisJson()'), 'NocturneJsBridge must expose getPersistedSafUrisJson');
  assert.ok(java.includes('public boolean hasValidPersistedUriPermission(String uriStr)'), 'NocturneJsBridge must expose hasValidPersistedUriPermission');
  assert.ok(java.includes('uriStr.startsWith(permUri + "/")'), 'SAF tree URI prefix check must require slash boundary');

  // Preserve Run #59 and legacy Android invariants
  assert.ok(java.includes('notifyBitPerfectErrorToWeb(pendingErrorReason);'), 'Legacy Bit-Perfect error call must remain intact');
  assert.ok(java.includes('inSampleSize = computeCoverSampleSize'), 'Cover sample size assignment must remain intact');
});

test('5. Version v3.9.73 / versionCode 127 sync, publish notes syntax, Web Audio invariants, 0 ES2020+ syntax, and 0 CR bytes', () => {
  const html = readFile(INDEX_HTML);
  const sw = readFile(SW_JS);
  const gradle = readFile(BUILD_GRADLE);
  const java = readFile(MAIN_JAVA);
  const pub = readFile(PUBLISH_JS);

  assert.ok(html.includes('FiiO M11S · v3.9.73'), 'index.html FiiO badge must be v3.9.73');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.73';"), 'sw.js CACHE_VERSION must be v3.9.73');
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.73';"), 'sw.js CACHE_NAME must be nocturne-v3.9.73');
  assert.ok(gradle.includes('versionCode = 127'), 'build.gradle.kts versionCode must be 127');
  assert.ok(gradle.includes('versionName = "3.9.73"'), 'build.gradle.kts versionName must be 3.9.73');
  assert.ok(java.includes('"3.9.73"'), 'MainActivity.java fallback versionName must be 3.9.73');
  assert.ok(pub.includes("'v3.9.73'") && pub.includes('versionCode 127'), 'publish-release.cjs must target v3.9.73 / versionCode 127');

  // Web Audio invariants
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Crossfeed destination invariant');
  assert.ok(html.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'), 'EQ setTargetAtTime invariant');
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'), 'playTrack volume/mute invariant');

  // 404.html & synced Android assets have 0 CR bytes
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'));
  assert.equal(html404.toString('utf8'), html, '404.html must match index.html');
  assert.equal(html404.includes(0x0d), false, '404.html must contain 0 CR bytes');

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ASSETS_DIR, f));
    assert.equal(assetBuf.includes(0x0d), false, `${f} in android assets must have 0 CR bytes (Unix LF)`);
  }

  // Zero ES2020+ syntax across index.html inline <script> + synced *.js (Chromium 74 / FiiO M11S)
  const scriptStart = html.lastIndexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  const codeFiles = [['index.html <script>', html.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter((name) => name.endsWith('.js'))) {
    codeFiles.push([f, readFile(path.join(ROOT, f))]);
  }
  for (const [label, src] of codeFiles) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const stripped = lines[i]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain bare catch {}`);
    }
  }
});
