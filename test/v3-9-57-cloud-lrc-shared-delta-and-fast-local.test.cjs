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
const library = require(path.join(ROOT, 'library-utils.js'));

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

test('v3.9.57: applyMicrosoftSiblingLrcLinks matches OneDrive tracks and serializableCloudTrack persists remoteLrc', async () => {
  const serStart = html.indexOf('const serializableCloudTrack = track =>');
  const serEnd = html.indexOf(';', serStart) + 1;
  const serSrc = html.slice(serStart, serEnd);
  const applySrc = extractFn(html, 'async function applyMicrosoftSiblingLrcLinks(siblingLrcByBase)');

  const persisted = [];
  const state = {
    tracks: [
      { id: 'onedrive:1', remoteId: '1', source: 'onedrive', name: '01 - Time.flac', remotePath: 'Music/DSOTM/01 - Time.flac', title: 'Time', artist: 'Pink Floyd', album: 'DSOTM', format: 'FLAC', size: 100 },
      { id: 'onedrive:2', remoteId: '2', source: 'onedrive', name: '02 - Money.flac', remotePath: 'Shared/PinkFloyd/02 - Money.flac', remoteDriveId: 'drv-shared', title: 'Money', artist: 'Pink Floyd', album: 'DSOTM', format: 'FLAC', size: 100 }
    ]
  };
  const sandbox = {
    state,
    coverForCatalog: c => c || null,
    persistCloudCatalog: async tracks => { persisted.push(...tracks); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${serSrc}\n${applySrc}\nthis.serializableCloudTrack = serializableCloudTrack;`, sandbox);

  const lrcMap = new Map([
    ['music/dsotm/01 - time', { id: 'lrc-1', driveId: '', downloadUrl: 'https://cdn.example/time.lrc', name: '01 - Time.lrc' }],
    ['shared/pinkfloyd/02 - money', { id: 'lrc-2', driveId: 'drv-shared', downloadUrl: '', name: '02 - Money.lrc' }]
  ]);

  const linked = await sandbox.applyMicrosoftSiblingLrcLinks(lrcMap);
  assert.equal(linked, 2);
  assert.equal(persisted.length, 2);
  assert.equal(state.tracks[0].remoteLrc.id, 'lrc-1');
  assert.equal(state.tracks[1].remoteLrc.driveId, 'drv-shared');

  const serialized = sandbox.serializableCloudTrack(state.tracks[1]);
  assert.deepEqual(Object.assign({}, serialized.remoteLrc), { id: 'lrc-2', driveId: 'drv-shared', name: '02 - Money.lrc' });
});

test('v3.9.57: fetchCloudSidecarLyrics downloads OneDrive and Google Drive sibling .lrc with 401 fallback and single-query guard', async () => {
  const fnStart = html.indexOf('async function fetchCloudSidecarLyrics(track)');
  const fnEnd = html.indexOf('async function triggerLyricsFetch(track)', fnStart);
  assert.ok(fnStart !== -1 && fnEnd > fnStart);
  const fnSrc = html.slice(fnStart, fnEnd);
  const fetchedUrls = [];
  let msContentCalls = 0;

  const sandbox = {
    state: { microsoftAccessToken: 'old-ms', googleToken: 'g-tok' },
    navigator: { onLine: true },
    URLSearchParams,
    ensureGoogleToken: async () => 'g-tok-fresh',
    getMicrosoftToken: async () => 'fresh-ms',
    fetch: async (url, opts) => {
      fetchedUrls.push({ url, auth: opts && opts.headers ? opts.headers.Authorization : '' });
      if (url.includes('expired-dl')) return { ok: false, status: 403, text: async () => '' };
      if (url.includes('graph.microsoft.com')) {
        msContentCalls++;
        if (msContentCalls === 1) return { ok: false, status: 401, text: async () => '' };
        return { ok: true, status: 200, text: async () => '\uFEFF[00:10.00]Hello OneDrive' };
      }
      if (url.includes('googleapis.com/drive/v3/files?')) {
        return { ok: true, status: 200, json: async () => ({ files: [{ id: 'g-lrc-9', name: '01 - Song.lrc', size: '40' }] }) };
      }
      if (url.includes('g-lrc-9?alt=media')) {
        return { ok: true, status: 200, text: async () => '[00:05.00]Hello Google Drive' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);

  const msTrack = {
    id: 'onedrive:1',
    source: 'onedrive',
    remoteLrc: { id: 'lrc-1', driveId: 'drv-9', downloadUrl: 'https://expired-dl.example/a.lrc', name: 'a.lrc' }
  };
  const msRes = await sandbox.fetchCloudSidecarLyrics(msTrack);
  assert.ok(msRes);
  assert.equal(msRes.text, '[00:10.00]Hello OneDrive');
  assert.equal(msRes.source, 'cloud-sidecar');

  const gTrack = {
    id: 'google:1',
    source: 'google',
    name: '01 - Song.flac',
    parents: ['folder-abc']
  };
  const gRes = await sandbox.fetchCloudSidecarLyrics(gTrack);
  assert.ok(gRes);
  assert.equal(gRes.text, '[00:05.00]Hello Google Drive');
  assert.equal(gTrack._checkedDriveLrc, true);

  // Second call on same Google Drive track must short-circuit without extra API call
  const beforeCount = fetchedUrls.length;
  const gRes2 = await sandbox.fetchCloudSidecarLyrics(gTrack);
  assert.equal(gRes2, null);
  assert.equal(fetchedUrls.length, beforeCount);
});

test('v3.9.57: makeLocalTrack uses lastModified+size metadata cache to skip disk reads on unchanged files', async () => {
  const cacheStart = html.indexOf("const LOCAL_META_CACHE_KEY = 'nocturne-local-meta-cache-v1';");
  const makeEndStart = html.indexOf('const localFileKey = file =>', cacheStart);
  const blockSrc = html.slice(cacheStart, makeEndStart);

  let getTagsCalls = 0;
  let readMetaCalls = 0;
  let idSeq = 0;
  const lsStore = new Map();
  const state = { objectUrls: new Set(), albumCovers: new Map(), tracks: [] };

  const sandbox = {
    library,
    state,
    id: () => `loc-${++idSeq}`,
    localStorage: {
      getItem: k => lsStore.has(k) ? lsStore.get(k) : null,
      setItem: (k, v) => lsStore.set(k, String(v))
    },
    setTimeout: fn => { fn(); return 1; },
    URL: { createObjectURL: () => `blob:loc-${idSeq}` },
    getTags: async () => {
      getTagsCalls++;
      return { title: 'Time', artist: 'Pink Floyd', album: 'DSOTM', track: '4' };
    },
    readAudioMetadata: async () => {
      readMetaCalls++;
      return { sampleRate: 96000, bitDepth: 24, channels: 2, duration: 413 };
    },
    filenameMetadata: () => ({ title: 'Fallback', artist: 'Unknown Artist', album: 'Unknown Album' }),
    normalizeCoverImage: async c => c || null,
    getTrackRating: () => 0,
    syncAlbumCoversImmediate: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(blockSrc, sandbox);

  const fileV1 = { name: '04 - Time.flac', relativePath: 'DSOTM/04 - Time.flac', size: 55000000, lastModified: 1700000000000 };
  const t1 = await sandbox.makeLocalTrack(fileV1, { hasFolderCover: true });
  assert.equal(getTagsCalls, 1);
  assert.equal(readMetaCalls, 1);
  assert.equal(t1.title, 'Time');
  assert.equal(t1.sampleRate, 96000);
  assert.equal(t1.lastModified, 1700000000000);

  // Second call on identical unchanged file must hit metadata cache with 0 disk reads
  const t2 = await sandbox.makeLocalTrack(fileV1, { hasFolderCover: true });
  assert.equal(getTagsCalls, 1, 'unchanged file must skip getTags on rescan');
  assert.equal(readMetaCalls, 1, 'unchanged file must skip readAudioMetadata on rescan');
  assert.equal(t2.title, 'Time');
  assert.equal(t2.sampleRate, 96000);

  // Modified lastModified must bypass stale cache and re-read tags
  const fileV2 = { name: '04 - Time.flac', relativePath: 'DSOTM/04 - Time.flac', size: 55000000, lastModified: 1700000999999 };
  await sandbox.makeLocalTrack(fileV2, { hasFolderCover: true });
  assert.equal(getTagsCalls, 2, 'edited file with new lastModified must re-read tags');
});

test('v3.9.57: loadMicrosoftFiles syncs Shared Folders after Delta Sync and MainActivity readLocalLyrics uses NFC/resolveReadableLocalFile', () => {
  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  assert.ok(msStart !== -1 && msEnd > msStart);
  const msSlice = html.slice(msStart, msEnd);
  assert.ok(msSlice.includes('if (msDelta && msDelta.handled)'), 'loadMicrosoftFiles must handle delta sync');
  assert.ok(msSlice.includes('const sharedDeltaAdded = await enqueueMicrosoftSharedItems('), 'OneDrive Delta Sync must still refresh sharedWithMe folders');
  assert.ok(msSlice.includes('applyMicrosoftSiblingLrcLinks(siblingLrcByBase)'), 'loadMicrosoftFiles must link sibling .lrc files');

  const lrcStart = mainActivity.indexOf('public String readLocalLyrics(');
  const lrcSlice = mainActivity.slice(lrcStart, lrcStart + 2200);
  assert.ok(lrcSlice.includes('resolveReadableLocalFile(filePath.trim())'), 'readLocalLyrics must resolve NFC/NFD/+ paths via resolveReadableLocalFile');
  assert.ok(lrcSlice.includes('java.text.Normalizer.normalize('), 'readLocalLyrics must normalize NFC/NFD basenames when matching sibling .lrc files');
});

test('v3.9.57+: monotonic version alignment across web, service worker, and Android Gradle', () => {
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(5[7-9]|[6-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(5[7-9]|[6-9]\d|\d{3,})';/);
  assert.match(html, /FiiO M11S · v3\.9\.(5[7-9]|[6-9]\d|\d{3,})/);
  const codeMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(codeMatch && Number(codeMatch[1]) >= 111, 'versionCode must be >= 111');
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(5[7-9]|[6-9]\d|\d{3,})"/);
});
