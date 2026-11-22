'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const HTML_404 = path.join(ROOT, '404.html');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const MAIN_JAVA = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const PUBLISH_JS = path.join(ROOT, '.agent', 'publish-release.cjs');

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

test('1. tryLoadGoogleChangesDelta prunes orphaned folder children, permanently removed shortcuts, honors same-batch restores & caps runaway pages', async () => {
  const html = readFile(INDEX_HTML);
  const fnSrc = sliceBetween(
    html,
    'async function tryLoadGoogleChangesDelta(token, existingByRemoteId, knownIds) {',
    'function removeDeletedCloudTracks('
  );

  // 1a. Folder deletion prunes unmoved children while keeping child moved to live folder, removed target deletes shortcut, restored stays alive
  {
    const removedIds = [];
    const childStay = { id: 'g-stay', source: 'google', remoteId: 'file-stay', parents: ['dir-del'] };
    const childMoved = { id: 'g-moved', source: 'google', remoteId: 'file-moved', parents: ['dir-del'] };
    const shortcutTrack = { id: 'g-sc', source: 'google', remoteId: 'sc-wrap', targetRemoteId: 'target-gone', parents: ['dir-live'] };
    const revivedTrack = { id: 'g-revived', source: 'google', remoteId: 'file-revived', parents: ['dir-live'] };
    const existingByRemoteId = new Map([
      ['file-stay', childStay],
      ['file-moved', childMoved],
      ['sc-wrap', shortcutTrack],
      ['file-revived', revivedTrack]
    ]);
    const knownIds = new Set(['file-stay', 'file-moved', 'sc-wrap', 'file-revived']);

    let cursorWritten = '';
    const sandbox = {
      GOOGLE_DELTA_TOKEN_KEY: 'g-delta',
      state: { tracks: [childStay, childMoved, shortcutTrack, revivedTrack] },
      library: {},
      checkedGoogleArtParents: new Set(),
      readCloudDeltaCursor: () => 'tok-page-1',
      writeCloudDeltaCursor: (k, v) => { cursorWritten = v; },
      ensureGoogleToken: async () => 'tok-fresh',
      fetchGoogleDrivePageWithRetry: async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          newStartPageToken: 'tok-page-2',
          changes: [
            // Shortcut target permanently removed (no file object)
            { fileId: 'target-gone', removed: true },
            // Parent folder deleted
            { fileId: 'dir-del', removed: true },
            // Child moved out of dir-del to dir-live in same batch
            { fileId: 'file-moved', file: { id: 'file-moved', name: '02 Moved.flac', parents: ['dir-live'], mimeType: 'audio/flac' } },
            // File flagged trashed earlier then restored later in batch
            { fileId: 'file-revived', file: { id: 'file-revived', trashed: true } },
            { fileId: 'file-revived', file: { id: 'file-revived', name: '03 Revived.flac', parents: ['dir-live'], mimeType: 'audio/flac', trashed: false } }
          ]
        })
      }),
      googleConfigurationHint: () => '',
      isCloudAudio: () => true,
      googleTrack: (f) => ({ id: 'new_' + f.id, remoteId: f.id, source: 'google' }),
      invalidateCloudTrackContent: () => {},
      persistCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (src, ids) => {
        ids.forEach((id) => removedIds.push(id));
        return removedIds.length;
      },
      pruneCloudCatalog: async () => {},
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {},
      URLSearchParams
    };
    vm.runInNewContext(fnSrc + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', sandbox);
    const res = await sandbox.tryLoadGoogleChangesDelta('g-tok', existingByRemoteId, knownIds);
    assert.equal(res.handled, true);
    assert.equal(cursorWritten, 'tok-page-2');
    assert.ok(removedIds.includes('target-gone') === false);
    assert.ok(removedIds.includes('sc-wrap'), 'Permanently removed shortcut target must remove shortcut wrapper track');
    assert.ok(removedIds.includes('file-stay'), 'Orphaned child inside removed folder must be pruned');
    assert.ok(!removedIds.includes('file-moved'), 'Child moved to a live folder in same delta batch must NOT be pruned');
    assert.ok(!removedIds.includes('file-revived'), 'Track restored later in same delta batch must NOT be pruned');
  }

  // 1b. Runaway pagination (>40 pages) resets delta cursor cleanly
  {
    let resetVal = 'unset';
    let pages = 0;
    const tr = { id: 'g-1', source: 'google', remoteId: 'r-1' };
    const sandbox = {
      GOOGLE_DELTA_TOKEN_KEY: 'g-delta',
      state: { tracks: [tr] },
      library: {},
      checkedGoogleArtParents: new Set(),
      readCloudDeltaCursor: () => 'loop-cursor',
      writeCloudDeltaCursor: (k, v) => { resetVal = v; },
      ensureGoogleToken: async () => 'tok',
      fetchGoogleDrivePageWithRetry: async () => {
        pages++;
        return { status: 200, ok: true, json: async () => ({ nextPageToken: 'next-' + pages, changes: [] }) };
      },
      googleConfigurationHint: () => '',
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0,
      URLSearchParams
    };
    vm.runInNewContext(fnSrc + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', sandbox);
    const res = await sandbox.tryLoadGoogleChangesDelta('g-tok', new Map([['r-1', tr]]), new Set(['r-1']));
    assert.equal(res.handled, false);
    assert.equal(res.resetCursor, true);
    assert.equal(resetVal, '');
    assert.equal(pages, 40, 'Must abort after GOOGLE_DELTA_MAX_PAGES (40) fetches');
  }
});

test('2. tryLoadMicrosoftDeltaSync prunes deleted folder children, clears stale remoteDriveId on shared->personal move & caps runaway pages', async () => {
  const html = readFile(INDEX_HTML);
  const fnSrc = sliceBetween(
    html,
    'async function tryLoadMicrosoftDeltaSync(token, existingByRemoteId, knownIds, siblingCoversByDir) {',
    'async function loadMicrosoftFiles(token) {'
  );

  // 2a. Deleted folder prunes remaining children while moved child stays, shared->personal clears remoteDriveId
  {
    const removedIds = [];
    const childStay = { id: 'ms-stay', source: 'onedrive', remoteId: 'ms-f1', remoteParentId: 'ms-dir-del', name: '01 Stay.flac', remotePath: 'Dead/01 Stay.flac' };
    const childMoved = { id: 'ms-moved', source: 'onedrive', remoteId: 'ms-f2', remoteParentId: 'ms-dir-del', remoteDriveId: 'shared-drv-9', name: '02 Moved.flac', remotePath: 'Dead/02 Moved.flac', metadataLoaded: true };
    const existingByRemoteId = new Map([
      ['ms-f1', childStay],
      ['ms-f2', childMoved]
    ]);
    const knownIds = new Set(['ms-f1', 'ms-f2']);

    let savedDeltaLink = '';
    const sandbox = {
      MICROSOFT_DELTA_LINK_KEY: 'ms-delta',
      state: { tracks: [childStay, childMoved] },
      library: {},
      readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=1',
      writeCloudDeltaCursor: (k, v) => { savedDeltaLink = v; },
      graphGet: async () => ({
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=2',
        value: [
          { id: 'ms-dir-del', deleted: { state: 'deleted' } },
          // childMoved relocated to personal drive (no remoteItem / empty driveId)
          { id: 'ms-f2', name: '02 Moved.flac', parentReference: { id: 'ms-dir-live', path: '/drive/root:/PersonalMusic' } }
        ]
      }),
      normalizeMicrosoftDriveItem: (raw) => ({ item: raw, driveId: '', isRemote: false }),
      isCloudAudio: () => true,
      microsoftTrack: (it) => ({ id: 'new_' + it.id, remoteId: it.id, source: 'onedrive' }),
      mergeMicrosoftTrack: () => {},
      invalidateCloudTrackContent: () => {},
      persistCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (src, ids) => {
        ids.forEach((id) => removedIds.push(id));
        return removedIds.length;
      },
      pruneCloudCatalog: async () => {},
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {}
    };
    vm.runInNewContext(fnSrc + '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;', sandbox);
    const res = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', existingByRemoteId, knownIds, new Map());
    assert.equal(res.handled, true);
    assert.equal(savedDeltaLink, 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=2');
    assert.ok(removedIds.includes('ms-f1'), 'Orphaned child inside deleted OneDrive folder must be pruned');
    assert.ok(!removedIds.includes('ms-f2'), 'Child moved to live personal folder in same batch must NOT be pruned');
    assert.equal(childMoved.remoteParentId, 'ms-dir-live');
    assert.equal(childMoved.remoteDriveId, '', 'Cross-drive move back to personal drive must clear stale remoteDriveId');
  }

  // 2b. Runaway pagination (>40 pages) clears delta cursor and signals resetCursor
  {
    let resetVal = 'unset';
    let pages = 0;
    const tr = { id: 'ms-1', source: 'onedrive', remoteId: 'ms-r1' };
    const sandbox = {
      MICROSOFT_DELTA_LINK_KEY: 'ms-delta',
      state: { tracks: [tr] },
      library: {},
      readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/delta-loop',
      writeCloudDeltaCursor: (k, v) => { resetVal = v; },
      graphGet: async () => {
        pages++;
        return { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/delta-page-' + pages, value: [] };
      },
      normalizeMicrosoftDriveItem: (raw) => ({ item: raw, driveId: '', isRemote: false }),
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async () => 0
    };
    vm.runInNewContext(fnSrc + '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;', sandbox);
    const res = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', new Map([['ms-r1', tr]]), new Set(['ms-r1']), new Map());
    assert.equal(res.handled, false);
    assert.equal(res.resetCursor, true);
    assert.equal(resetVal, '');
    assert.equal(pages, 40, 'Must abort after MICROSOFT_DELTA_MAX_PAGES (40) fetches');
  }
});

test('3. Stale content:// SAF track heals automatically to readable /local-media?path= URL in ensureLocalTrackPlayableUrl and playTrack', async () => {
  const html = readFile(INDEX_HTML);
  const localHelpersSrc = sliceBetween(
    html,
    'async function probeLocalMediaAccessError(mediaUrl) {',
    '// Pha C — hủy bản preload cũ'
  );

  // 3a. SAF grant revoked (403 on ?uri=), but physical path readable (200 on ?path=) -> auto-heals track.url
  {
    const safUri = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Fhealed.flac';
    const filePath = '/storage/emulated/0/Music/healed.flac';
    const track = {
      id: 'saf-heal-1',
      source: 'local',
      uri: safUri,
      path: filePath,
      url: 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(safUri),
      _localAccessError: ''
    };
    const sandbox = {
      fetch: async (url) => {
        if (String(url).includes('/local-media?uri=')) {
          return { status: 403, headers: { get: (k) => (k === 'X-Nocturne-Storage-Error' ? 'SAF_PERMISSION_REVOKED' : null) } };
        }
        if (String(url).includes('/local-media?path=' + encodeURIComponent(filePath))) {
          return { status: 200, headers: { get: () => null } };
        }
        return { status: 404, headers: { get: () => null } };
      },
      AbortController,
      window: { NocturneNative: { hasValidPersistedUriPermission: () => false } },
      restoreLocalTrackUrlSync: () => {},
      state: { tracks: [track], objectUrls: new Set() },
      setTimeout,
      clearTimeout,
      URL
    };
    vm.runInNewContext(localHelpersSrc, sandbox);
    const outUrl = await sandbox.ensureLocalTrackPlayableUrl(track, { requestPermission: true });
    assert.equal(outUrl, 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(filePath));
    assert.equal(track.url, outUrl);
    assert.equal(track._localAccessError, '');
  }

  // 3b. Both ?uri= and ?path= fail with 403 -> preserves permission_denied and returns ''
  {
    const safUri = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Fblocked.flac';
    const track = {
      id: 'saf-block-2',
      source: 'local',
      uri: safUri,
      path: '/storage/emulated/0/Music/blocked.flac',
      url: 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(safUri),
      _localAccessError: ''
    };
    const sandbox = {
      fetch: async () => ({ status: 403, headers: { get: (k) => (k === 'X-Nocturne-Storage-Error' ? 'SAF_PERMISSION_REVOKED' : null) } }),
      AbortController,
      window: { NocturneNative: { hasValidPersistedUriPermission: () => false } },
      restoreLocalTrackUrlSync: () => {},
      state: { tracks: [track], objectUrls: new Set() },
      setTimeout,
      clearTimeout,
      URL
    };
    vm.runInNewContext(localHelpersSrc, sandbox);
    const outUrl = await sandbox.ensureLocalTrackPlayableUrl(track, { requestPermission: true });
    assert.equal(outUrl, '');
    assert.equal(track._localAccessError, 'permission_denied');
  }

  // 3c. playTrack catch implements one-shot _pathFallbackRetriedGen retry
  const playTrackSrc = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
  assert.ok(playTrackSrc.includes('track._pathFallbackRetriedGen !== generation'));
  assert.ok(playTrackSrc.includes("const pathFallbackUrl = 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(track.path);"));
});

test('4. Android scanMediaStoreAudio reads API 30+ disc_number with 3-tier fallback preserving album_artist & filtering <unknown>', () => {
  const java = readFile(MAIN_JAVA);

  assert.ok(java.includes('private static int parseMediaStoreLeadingInt(@Nullable String raw)'), 'Must provide parseMediaStoreLeadingInt helper');
  assert.ok(java.includes('"disc_number"'), 'API 30+ projection must request disc_number column');
  assert.ok(java.includes('if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)'), 'Must gate disc_number projection to Android 11+ (API 30+)');
  assert.ok(java.includes('int discCol = cursor.getColumnIndex("disc_number");'), 'Must look up disc_number column safely');
  assert.ok(java.includes('!"<unknown>".equalsIgnoreCase(albumArtist.trim())'), 'Must strip <unknown> placeholder from MediaStore albumArtist');
  assert.ok(java.includes('discNo = parseMediaStoreLeadingInt(cursor.getString(discCol));'), 'Must parse disc_number fallback cleanly');
});

test('5. Version v3.9.75+ / versionCode 129+, 404.html parity, Web Audio invariants, 0 ES2020+ syntax & 0 CR bytes', () => {
  const html = readFile(INDEX_HTML);
  const html404 = fs.readFileSync(HTML_404);
  const sw = readFile(SW_JS);
  const gradle = readFile(BUILD_GRADLE);
  const java = readFile(MAIN_JAVA);
  const pub = readFile(PUBLISH_JS);

  assert.equal(html404.toString('utf8'), html, '404.html must match index.html');
  assert.equal(html404.includes(0x0d), false, '404.html must contain 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:7[5-9]|[89]\d|\d{3,})/.test(html), 'index.html FiiO badge must be >= v3.9.75');
  assert.ok(/const CACHE_VERSION = 'v3\.9\.(?:7[5-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_VERSION must be >= v3.9.75');
  assert.ok(/const CACHE_NAME = 'nocturne-v3\.9\.(?:7[5-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_NAME must be >= nocturne-v3.9.75');
  assert.ok(/versionCode\s*=\s*(?:129|1[3-9]\d|[2-9]\d{2,})\b/.test(gradle), 'build.gradle.kts versionCode must be >= 129');
  assert.ok(/versionName = "3\.9\.(?:7[5-9]|[89]\d|\d{3,})"/.test(gradle), 'build.gradle.kts versionName must be >= 3.9.75');
  assert.ok(/"3\.9\.(?:7[5-9]|[89]\d|\d{3,})"/.test(java), 'MainActivity.java fallback versionName must be >= 3.9.75');
  assert.ok(/v3\.9\.(?:7[5-9]|[89]\d|\d{3,})/.test(pub) && /versionCode\s+(?:129|1[3-9]\d|[2-9]\d{2,})/.test(pub), 'publish-release.cjs must target >= v3.9.75 / versionCode >= 129');

  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(html.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'));

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
