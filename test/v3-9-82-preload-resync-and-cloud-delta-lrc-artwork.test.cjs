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

test('v3.9.82: resyncNextPreload clears stale standby/Bit-Perfect preload and re-triggers both Web Audio & Native Bit-Perfect preload', () => {
  const fnSrc = extractFn(html, 'function resyncNextPreload(forceClear = false)');
  let cleared = 0, bpPreloaded = 0, webPreloaded = 0;
  const sandbox = {
    bpCloudPreloadTrackId: 'old-bp-track',
    state: {
      currentId: 't1',
      repeat: 1,
      autoplay: true,
      isNativeBitPerfectPlaying: true,
      preloadTrackId: 'old-track',
      preloadReadyUrl: 'blob:old'
    },
    clearStalePreload() { cleared++; },
    preloadCloudNextDuringBitPerfect() { bpPreloaded++; },
    preloadNext(force) { if (force) webPreloaded++; }
  };
  vm.runInNewContext(fnSrc, sandbox);
  sandbox.resyncNextPreload(true);
  assert.equal(cleared, 1);
  assert.equal(sandbox.bpCloudPreloadTrackId, null);
  assert.equal(sandbox.state.preloadTrackId, null);
  assert.equal(sandbox.state.preloadReadyUrl, null);
  assert.equal(bpPreloaded, 1);
  assert.equal(webPreloaded, 1);

  // Wired into repeat, shuffle, autoplay, contextual-queue, album-hero-queue
  assert.ok(html.includes("$('repeat-button').addEventListener('click'") && html.includes('resyncNextPreload(true)'));
  assert.ok(html.includes('routeToNativeBp = Boolean(typeof isTrackRoutedToNativeBitPerfect'));
});

test('v3.9.82: tryLoadGoogleChangesDelta clears _checkedDriveLrc when sibling .lrc or folder shortcut changes', async () => {
  const fnSrc = extractFn(html, 'async function tryLoadGoogleChangesDelta(token, existingByRemoteId, knownIds)');
  const tracks = [
    { id: 'g1', source: 'google', remoteId: 'r1', parents: ['dir-A'], _checkedDriveLrc: true },
    { id: 'g2', source: 'google', remoteId: 'r2', parents: ['dir-B'], _checkedDriveLrc: true },
    { id: 'g3', source: 'google', remoteId: 'r3', parents: ['dir-C'], targetRemoteId: 'target-x', _checkedDriveLrc: true }
  ];
  const checkedGoogleArtParents = new Set(['dir-A', 'shared-folder-1']);
  const sandbox = {
    GOOGLE_DELTA_TOKEN_KEY: 'g-delta',
    URLSearchParams,
    state: { tracks },
    checkedGoogleArtParents,
    readCloudDeltaCursor: () => 'tok-1',
    writeCloudDeltaCursor: () => {},
    isCloudAudio: () => false,
    persistCloudCatalog: async () => {},
    removeCloudTracksByRemoteIds: async () => 0,
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    fetchGoogleDrivePageWithRetry: async () => ({
      status: 200,
      ok: true,
      async json() {
        return {
          newStartPageToken: 'tok-2',
          changes: [
            { fileId: 'lrc-1', file: { id: 'lrc-1', name: 'Song 1.lrc', parents: ['dir-A'] } },
            { fileId: 'sc-dir', file: { id: 'sc-dir', name: 'Shared Album', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'shared-folder-1', targetMimeType: 'application/vnd.google-apps.folder' } } }
          ]
        };
      }
    })
  };
  vm.runInNewContext(fnSrc, sandbox);
  const existing = new Map(tracks.map(t => [t.remoteId, t]));
  const knownIds = new Set(tracks.map(t => t.remoteId));
  const res = await sandbox.tryLoadGoogleChangesDelta('tok', existing, knownIds);
  assert.equal(res.handled, true);
  assert.ok(res.changedLrcParents.includes('dir-A'));
  assert.ok(res.changedLrcParents.includes('shared-folder-1'));
  assert.ok(res.changedArtParents.includes('shared-folder-1'));
  assert.equal(tracks[0]._checkedDriveLrc, false, 'Track in changed .lrc parent must re-check Drive LRC');
  assert.equal(tracks[1]._checkedDriveLrc, true, 'Unrelated track keeps _checkedDriveLrc = true');
  assert.equal(tracks[2]._checkedDriveLrc, false, 'Shortcut track clears _checkedDriveLrc');
  assert.equal(checkedGoogleArtParents.has('shared-folder-1'), false, 'Shared folder art cache invalidated');
});

test('v3.9.82: applyMicrosoftSiblingLrcLinks normalizes NFC, tracks cTag/driveId, and OneDrive delta clears deleted remoteLrc', async () => {
  const applySrc = extractFn(html, 'async function applyMicrosoftSiblingLrcLinks(siblingLrcByBase)');
  const deltaSrc = extractFn(html, 'async function tryLoadMicrosoftDeltaSync(token, existingByRemoteId, knownIds, siblingCoversByDir)');

  // 1. NFC normalization + cTag + driveId update
  const nfdName = 'Nhạc/Bài Hát.flac'.normalize('NFD');
  const nfcKey = 'Nhạc/Bài Hát'.normalize('NFC').toLowerCase();
  const tr = {
    id: 'ms1',
    source: 'onedrive',
    remoteId: 'r-ms1',
    remoteDriveId: 'drv-shared',
    remotePath: nfdName,
    remoteLrc: { id: 'lrc-old', driveId: '', downloadUrl: 'https://old', name: 'Bài Hát.lrc', cTag: 'v1' },
    _cloudLrcChecked: true
  };
  let persisted = 0;
  const sandbox = {
    MICROSOFT_DELTA_LINK_KEY: 'ms-delta',
    state: { tracks: [tr] },
    persistCloudCatalog: async () => { persisted++; },
    readCloudDeltaCursor: () => 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=abc',
    writeCloudDeltaCursor: () => {},
    isCloudAudio: () => false,
    removeCloudTracksByRemoteIds: async () => 0,
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    graphGet: async () => ({
      value: [
        { id: 'lrc-old', deleted: { state: 'deleted' } }
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/root/delta?token=def'
    })
  };
  vm.runInNewContext(`${applySrc}\n${deltaSrc}`, sandbox);

  const lrcMap = new Map([[nfcKey, { id: 'lrc-old', name: 'Bài Hát.lrc', downloadUrl: '', driveId: '', cTag: 'v2' }]]);
  const updatedCount = await sandbox.applyMicrosoftSiblingLrcLinks(lrcMap);
  assert.equal(updatedCount, 1);
  assert.equal(tr.remoteLrc.driveId, 'drv-shared');
  assert.equal(tr.remoteLrc.cTag, 'v2');
  assert.equal(tr._cloudLrcChecked, false);
  assert.equal(persisted, 1);

  // 2. Deleted .lrc in OneDrive Delta clears dangling tr.remoteLrc
  const existing = new Map([[tr.remoteId, tr]]);
  const knownIds = new Set([tr.remoteId]);
  const deltaRes = await sandbox.tryLoadMicrosoftDeltaSync('tok', existing, knownIds, new Map(), new Map());
  assert.equal(deltaRes.handled, true);
  assert.equal(tr.remoteLrc, null, 'Deleted .lrc must clear stale remoteLrc link on OneDrive track');
});

test('v3.9.82: Version bump parity across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.82';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.82';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30982);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 136);
  assert.ok(gradle.includes('versionName = "3.9.82"'));
});
