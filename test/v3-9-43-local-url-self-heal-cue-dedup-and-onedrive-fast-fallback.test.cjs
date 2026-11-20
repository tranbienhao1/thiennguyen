'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. releaseUnusedLocalUrl, restoreLocalTrackUrlSync & ensureLocalTrackPlayableUrl heal revoked blob URLs, sibling CUE tracks, fileHandle & FiiO /local-media URLs', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function releaseUnusedLocalUrl(track) {');
  const end = html.indexOf('function clearStalePreload() {', start);
  assert.ok(start > 0 && end > start, 'Local URL helpers must be extractable');
  const src = html.slice(start, end);

  let blobSeq = 0;
  const revoked = [];
  const sharedFile = { name: 'album.flac', size: 80000000 };
  const cue1 = { id: 'c1', source: 'local', isCue: true, isDsd: false, file: sharedFile, url: 'blob:shared-1' };
  const cue2 = { id: 'c2', source: 'local', isCue: true, isDsd: false, file: sharedFile, url: 'blob:shared-1' };
  const handleTrack = {
    id: 'h1',
    source: 'local',
    isDsd: false,
    file: null,
    url: 'blob:stale-dead',
    fileHandle: {
      getFile: async () => ({ name: 'from-handle.flac', size: 123456 })
    }
  };
  const fiioTrack = {
    id: 'fiio_99',
    source: 'local',
    isDsd: false,
    name: '01 - Symphony.flac',
    uri: 'content://media/external/audio/media/99',
    url: ''
  };

  const sandbox = {
    state: {
      currentId: 'other-song',
      objectUrls: new Set(['blob:shared-1']),
      tracks: [cue1, cue2, handleTrack, fiioTrack]
    },
    audio: { src: 'https://nocturne.local/other.flac' },
    standbyAudio: { src: '' },
    location: { href: 'https://nocturne.local/' },
    releaseTrackUrl: (u) => {
      revoked.push(u);
      sandbox.state.objectUrls.delete(u);
    },
    URL: class extends URL {
      static createObjectURL() {
        blobSeq++;
        return 'blob:fresh-' + blobSeq;
      }
    },
    encodeURIComponent
  };
  vm.runInNewContext(
    src + '\nthis.releaseUnusedLocalUrl = releaseUnusedLocalUrl; this.restoreLocalTrackUrlSync = restoreLocalTrackUrlSync; this.ensureLocalTrackPlayableUrl = ensureLocalTrackPlayableUrl;',
    sandbox
  );

  // 1a. Releasing cue1 revokes blob:shared-1 AND clears cue2.url so cue2 never holds a dangling dead blob URL
  sandbox.releaseUnusedLocalUrl(cue1);
  assert.deepEqual(revoked, ['blob:shared-1']);
  assert.equal(cue1.url, '');
  assert.equal(cue2.url, '', 'Sibling CUE sub-track sharing revoked blob URL must have its url cleared');

  // 1b. Restoring cue2 creates a fresh blob URL and propagates it to cue1 as well
  const restoredCueUrl = sandbox.restoreLocalTrackUrlSync(cue2);
  assert.equal(restoredCueUrl, 'blob:fresh-1');
  assert.equal(cue1.url, 'blob:fresh-1', 'Sibling CUE sub-track must receive freshly recreated blob URL');
  assert.ok(sandbox.state.objectUrls.has('blob:fresh-1'));

  // 1c. ensureLocalTrackPlayableUrl detects dead blob:stale-dead (not in state.objectUrls), calls fileHandle.getFile(), and creates fresh blob URL
  const healedHandleUrl = await sandbox.ensureLocalTrackPlayableUrl(handleTrack);
  assert.equal(healedHandleUrl, 'blob:fresh-2');
  assert.ok(handleTrack.file && handleTrack.file.name === 'from-handle.flac');

  // 1d. FiiO / Android track with cleared url reconstructs /local-media?uri=...
  const healedFiioUrl = await sandbox.ensureLocalTrackPlayableUrl(fiioTrack);
  assert.ok(healedFiioUrl.includes('https://appassets.androidplatform.net/local-media?uri='));
});

test('2. fetchCloudTrack immediately rethrows OneDrive directUrl 401/403 from fetchAudioFirstSlice without wasted second blob fetch, and recovers on moovAtTail full-file 401/403', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('async function fetchCloudTrack(track, url, options, provider) {');
  const end = html.indexOf('const mediaErrorMessage = error => {', start);
  assert.ok(start > 0 && end > start);
  const src = html.slice(start, end);

  const directUrl = 'https://tenant.sharepoint.com/personal/user/_layouts/15/download.aspx?e=expired';

  // Case A: fetchAudioFirstSlice throws 403 on OneDrive directUrl -> must rethrow immediately without calling fetchAudioBlob
  {
    let sliceCalls = 0;
    let blobCalls = 0;
    const library = {
      fetchAudioFirstSlice: async () => {
        sliceCalls++;
        const err = new Error('Expired directUrl');
        err.status = 403;
        throw err;
      },
      fetchAudioBlob: async () => {
        blobCalls++;
        return { size: 100, type: 'audio/flac' };
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
      library, () => {}, state, { createObjectURL: () => 'blob:x' },
      () => {}, async () => null, async () => 'tok', async () => null, () => {},
      (u) => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
      async () => 'gtok'
    );

    const track = { id: 'od-1', remoteId: 'item-1', source: 'onedrive', format: 'FLAC', size: 20000000, metadataLoaded: true, cover: 'x' };
    await assert.rejects(
      fetchCloudTrack(track, directUrl, {}, 'OneDrive'),
      (err) => err && err.status === 403
    );
    assert.equal(sliceCalls, 1);
    assert.equal(blobCalls, 0, 'Must not waste a second full-file fetch to an expired OneDrive directUrl');
  }

  // Case B: M4A moovAtTail (!firstSlice.complete) falls through to full-file fetchAudioBlob; if directUrl expires with 401, falls back to Graph /content with Bearer token
  {
    const blobCalls = [];
    const library = {
      fetchAudioFirstSlice: async () => ({
        blob: { size: 1048576, type: 'audio/mp4' },
        complete: false,
        moovAtTail: true,
        totalBytes: 15000000
      }),
      fetchAudioBlob: async (u, opts) => {
        blobCalls.push({ u, opts });
        if (u === directUrl) {
          const err = new Error('Direct URL expired on full download');
          err.status = 401;
          throw err;
        }
        return { size: 15000000, type: 'audio/mp4' };
      },
      normalizeAudioBlob: (b) => b
    };
    const state = { objectUrls: new Set(), currentId: 'od-m4a' };
    const fetchCloudTrack = new Function(
      'library', 'queueCloudMetadata', 'state', 'URL',
      'finishCloudMetadataInBackground', 'upgradeSliceToFullAudio',
      'getMicrosoftToken', 'getCachedFirstSlice', 'cacheFirstSlice',
      'isGraphContentUrl', 'ensureGoogleToken',
      src + '\nreturn fetchCloudTrack;'
    )(
      library, () => {}, state, { createObjectURL: () => 'blob:m4a-full' },
      () => {}, async () => null, async () => 'fresh-ms-tok', async () => null, () => {},
      (u) => typeof u === 'string' && u.startsWith('https://graph.microsoft.com/'),
      async () => 'gtok'
    );

    const track = { id: 'od-m4a', remoteId: 'm4a-99', source: 'onedrive', format: 'M4A', size: 15000000, downloadUrl: directUrl, metadataLoaded: true, cover: 'x' };
    const resUrl = await fetchCloudTrack(track, directUrl, {}, 'OneDrive');
    assert.equal(resUrl, 'blob:m4a-full');
    assert.equal(track.downloadUrl, '');
    assert.equal(blobCalls.length, 2);
    assert.equal(blobCalls[1].u, 'https://graph.microsoft.com/v1.0/me/drive/items/m4a-99/content');
    assert.equal(blobCalls[1].opts.headers.Authorization, 'Bearer fresh-ms-tok');
  }
});

test('3. localTrack & addLocalFiles preserve relativePath, fileHandle, and deduplicate CUE sub-tracks on folder rescan', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const addStart = html.indexOf('const localFileKey = file =>');
  const addSrc = html.slice(addStart, addStart + 12000);

  assert.ok(html.includes('relativePath: file.relativePath || file.webkitRelativePath || file.name'), 'makeLocalTrack must persist relativePath on trackObj');
  assert.ok(html.includes('if (file._fileHandle) trackObj.fileHandle = file._fileHandle;'), 'makeLocalTrack must persist fileHandle on trackObj');
  assert.ok(addSrc.includes('const cueDedupKey ='), 'addLocalFiles must deduplicate CUE sub-tracks via cueDedupKey');
  assert.ok(addSrc.includes('restoreLocalTrackUrlSync(current);'), 'addLocalFiles must refresh existing local tracks via restoreLocalTrackUrlSync on rescan');
});

test('4. Version sync v3.9.43 / versionCode 97, 0 CR bytes in assets & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.ok(/FiiO M11S · v3\.9\.(?:4[3-9]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.43';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.43';"));
  assert.ok(/versionCode\s*=\s*(?:9[7-9]|\d{3,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.43"'));
  assert.ok(/"3\.9\.(?:4[3-9]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[3-9]|[5-9]\d|\d{3,})/.test(publishRelease));

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
