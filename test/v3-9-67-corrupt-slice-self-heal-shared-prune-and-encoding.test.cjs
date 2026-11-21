'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));

test('1. fetchCloudTrack purges <64B corrupt cached slices, honors _bypassSliceCacheOnce, and deleteCachedFirstSlice cleans IndexedDB', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cacheStart = html.indexOf('function sliceCacheTransaction(mode) {');
  const cacheEnd = html.indexOf('function persistCloudCatalog(tracks) {', cacheStart);
  const fetchStart = html.indexOf('async function fetchCloudTrack(track, url, options, provider) {');
  const fetchEnd = html.indexOf('function openDatabase() {', fetchStart);
  assert.ok(cacheStart > 0 && cacheEnd > cacheStart && fetchStart > 0 && fetchEnd > fetchStart);

  function fakeReq(result) {
    const req = {};
    queueMicrotask(() => {
      req.result = result;
      if (typeof req.onsuccess === 'function') req.onsuccess();
    });
    return req;
  }

  const rows = new Map();
  const store = {
    get: k => fakeReq(rows.get(k)),
    put: e => { rows.set(e.key, e); return fakeReq(e.key); },
    delete: k => { rows.delete(k); return fakeReq(undefined); },
    getAll: () => fakeReq(Array.from(rows.values()))
  };
  const state = {
    objectUrls: new Set(),
    db: { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }) }
  };

  let netSliceCalls = 0;
  let upgradeCalls = 0;
  const track = {
    id: 'google:corrupt-1',
    remoteId: 'corrupt-1',
    source: 'google',
    name: '01.flac',
    title: '01',
    format: 'FLAC',
    size: 5000000,
    firstSliceCached: true
  };
  const sliceKey = library.historyTrackKey(track);
  // Seed a 12-byte corrupt/truncated cached blob
  rows.set(sliceKey, { key: sliceKey, blob: new Blob([new Uint8Array(12)]), size: 12, totalBytes: 5000000, meta: null, savedAt: 1000 });

  const sandbox = {
    state,
    library: Object.assign({}, library, {
      fetchAudioFirstSlice: async () => {
        netSliceCalls++;
        return { blob: new Blob([new Uint8Array(2048)], { type: 'audio/flac' }), totalBytes: 5000000, complete: false };
      },
      normalizeAudioBlob: b => b
    }),
    FIRST_SLICE_CACHE_STORE: 'firstSliceCache',
    URL: { createObjectURL: () => 'blob:mock-' + (++upgradeCalls) },
    Blob, Uint8Array, Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, Promise, Date, console,
    pauseCloudMetadataQueue: () => {},
    queueCloudMetadata: () => {},
    upgradeSliceToFullAudio: async () => {},
    finishCloudMetadataInBackground: () => {},
    isGraphContentUrl: () => false,
    fetchCloudFile: async () => 'blob:full'
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(cacheStart, cacheEnd) + '\n' +
    html.slice(fetchStart, fetchEnd) +
    '\nthis.__exports = { deleteCachedFirstSlice, fetchCloudTrack };',
    sandbox
  );

  // 1a. Corrupt 12-byte slice must be deleted and bypassed to network fetchAudioFirstSlice
  const url1 = await sandbox.__exports.fetchCloudTrack(track, 'https://drive.test/1', {}, 'google');
  assert.ok(url1.startsWith('blob:mock-'));
  assert.equal(netSliceCalls, 1, 'Corrupt <64B cached slice must trigger fresh network fetch');
  assert.equal(track._loadedFromSliceCache, false);

  // 1b. Now seed a valid 256KB cached slice, verify _loadedFromSliceCache = true, then verify _bypassSliceCacheOnce skips it
  track.url = '';
  track.loadPromise = null;
  rows.set(sliceKey, { key: sliceKey, blob: new Blob([new Uint8Array(262144)]), size: 262144, totalBytes: 5000000, meta: null, savedAt: 2000 });
  track.size = 2000000; // under 4MB lossless threshold so 256KB slice is accepted
  rows.get(sliceKey).totalBytes = 2000000;
  await sandbox.__exports.fetchCloudTrack(track, 'https://drive.test/1', {}, 'google');
  assert.equal(track._loadedFromSliceCache, true);
  assert.equal(netSliceCalls, 1);

  track.url = '';
  track.loadPromise = null;
  track._bypassSliceCacheOnce = true;
  await sandbox.__exports.fetchCloudTrack(track, 'https://drive.test/1', {}, 'google');
  assert.equal(track._bypassSliceCacheOnce, false, '_bypassSliceCacheOnce must reset after single use');
  assert.equal(track._loadedFromSliceCache, false);
  assert.equal(netSliceCalls, 2, '_bypassSliceCacheOnce must skip cached slice and fetch from Cloud');

  // 1c. Verify deleteCachedFirstSlice deletes entry and clears flag
  track.firstSliceCached = true;
  await sandbox.__exports.deleteCachedFirstSlice(track);
  assert.equal(track.firstSliceCached, false);
  assert.equal(rows.has(sliceKey), false);

  // 1d. Verify playTrack & playDsdTrack wire deleteCachedFirstSlice on decode failure
  assert.ok(html.includes('const isCorruptCachedSliceErr = Boolean('));
  assert.ok(html.includes('if (loadedCachedDsdSlice && error && error.name !== \'AbortError\' && error.name !== \'NotAllowedError\' && typeof deleteCachedFirstSlice === \'function\')'));
});

test('2. OneDrive Delta Sync prunes deleted/unshared remoteDriveId tracks when shared scan completes cleanly while keeping personal tracks', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sharedStart = html.indexOf('async function enqueueMicrosoftSharedItems(');
  const sharedEnd = html.indexOf('async function saveMicrosoftLatestDeltaLink(', sharedStart);
  const loadStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const loadEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS =', loadStart);
  assert.ok(sharedStart > 0 && sharedEnd > sharedStart && loadStart > 0 && loadEnd > loadStart);

  const personalTrack = { id: 'onedrive:p1', remoteId: 'p1', source: 'onedrive', name: 'personal.flac', remotePath: 'Music/personal.flac' };
  const activeShared = { id: 'onedrive:s1', remoteId: 's1', remoteDriveId: 'drv-friend', source: 'onedrive', name: 'kept.flac', remotePath: 'Shared/Album/kept.flac' };
  const removedShared = { id: 'onedrive:s-gone', remoteId: 's-gone', remoteDriveId: 'drv-friend', source: 'onedrive', name: 'revoked.flac', remotePath: 'Shared/Album/revoked.flac' };
  const state = { currentId: null, tracks: [personalTrack, activeShared, removedShared] };
  const removedBatches = [];

  const sandbox = {
    state,
    library,
    MICROSOFT_SYNC_CHECKPOINT_KEY: 'ms-cp',
    Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, Promise, Date, encodeURIComponent, console,
    restoreCloudCatalog: async () => {},
    readCloudSyncCheckpoint: () => null,
    writeCloudSyncCheckpoint: () => {},
    clearCloudSyncCheckpoint: () => {},
    tryLoadMicrosoftDeltaSync: async () => ({ handled: true, added: 0, updated: 0, removed: 0 }),
    normalizeMicrosoftDriveItem: (raw, inherited) => {
      const rem = raw.remoteItem || raw;
      const dId = (rem.parentReference && rem.parentReference.driveId) || inherited || '';
      return { item: rem, driveId: dId, isRemote: Boolean(raw.remoteItem) };
    },
    isCloudAudio: f => /\.(flac|mp3|wav)$/i.test(String(f && f.name || '')),
    microsoftTrack: (item, rp) => ({ id: 'onedrive:' + item.id, remoteId: item.id, source: 'onedrive', name: item.name, remotePath: rp }),
    mergeMicrosoftTrack: () => {},
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    pruneOrphanedSliceCacheEntries: async () => {},
    removeCloudTracksByRemoteIds: async (src, idSet) => {
      removedBatches.push({ src, ids: Array.from(idSet) });
      state.tracks = state.tracks.filter(t => !idSet.has(t.remoteId));
      return idSet.size;
    },
    renderTracks: () => {},
    cloudStatus: () => {},
    queueCloudMetadata: () => {},
    applyMicrosoftSiblingFolderCovers: async () => {},
    applyMicrosoftSiblingLrcLinks: async () => {},
    graphGet: async url => {
      if (url.includes('/sharedWithMe')) {
        return {
          value: [
            { id: 'link-1', name: 'kept.flac', remoteItem: { id: 's1', name: 'kept.flac', size: 1000, parentReference: { driveId: 'drv-friend' } } }
          ]
        };
      }
      return { value: [] };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(sharedStart, sharedEnd) + '\n' +
    html.slice(loadStart, loadEnd) +
    '\nthis.__exports = { enqueueMicrosoftSharedItems, loadMicrosoftFiles };',
    sandbox
  );

  await sandbox.__exports.loadMicrosoftFiles('tok-ms');
  assert.equal(removedBatches.length, 1);
  assert.deepEqual(removedBatches[0], { src: 'onedrive', ids: ['s-gone'] });
  assert.equal(state.tracks.some(t => t.remoteId === 'p1'), true, 'Personal OneDrive track must never be pruned by shared cleanup');
  assert.equal(state.tracks.some(t => t.remoteId === 's1'), true, 'Active shared track must be kept');
  assert.equal(state.tracks.some(t => t.remoteId === 's-gone'), false, 'Deleted/unshared OneDrive track must be removed during Delta Sync');
});

test('3. Multi-encoding .cue/.lrc decoder handles UTF-8, UTF-16LE, Shift-JIS, and Windows-1252 cleanly on Web & Android', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const decStart = html.indexOf('function decodeTextBytesAuto(rawBuf) {');
  const decEnd = html.indexOf('function buildLocalCueSubTrack(', decStart);
  assert.ok(decStart > 0 && decEnd > decStart);

  const sandbox = { Uint8Array, TextDecoder, String, RegExp };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(decStart, decEnd) + '\nthis.decodeTextBytesAuto = decodeTextBytesAuto;', sandbox);

  // UTF-8 with BOM (Vietnamese)
  const utf8Bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('TITLE "Mùa Thu Cho Em"', 'utf8')]);
  assert.equal(sandbox.decodeTextBytesAuto(new Uint8Array(utf8Bom)), 'TITLE "Mùa Thu Cho Em"');

  // UTF-16LE with BOM
  const utf16Le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('TITLE "Hi-Res"', 'utf16le')]);
  assert.equal(sandbox.decodeTextBytesAuto(new Uint8Array(utf16Le)), 'TITLE "Hi-Res"');

  // Shift-JIS ("さくら" = 82 B3 82 AD 82 E7)
  const sjisBytes = new Uint8Array([0x54, 0x49, 0x54, 0x4C, 0x45, 0x20, 0x22, 0x82, 0xB3, 0x82, 0xAD, 0x82, 0xE7, 0x22]);
  assert.equal(sandbox.decodeTextBytesAuto(sjisBytes), 'TITLE "さくら"');

  // Windows-1252 ("Café" = 43 61 66 E9)
  const win1252Bytes = new Uint8Array([0x54, 0x49, 0x54, 0x4C, 0x45, 0x20, 0x22, 0x43, 0x61, 0x66, 0xE9, 0x22]);
  assert.equal(sandbox.decodeTextBytesAuto(win1252Bytes), 'TITLE "Café"');

  // MainActivity.java has matching strict UTF-8 -> Shift_JIS -> windows-1252 decoding
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(java.includes('private static boolean containsJapaneseKanaOrCjk(String s)'));
  assert.ok(java.includes('Charset.forName("Shift_JIS").newDecoder()'));
  assert.ok(java.includes('Charset.forName("windows-1252")'));
});
