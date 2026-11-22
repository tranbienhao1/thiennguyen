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
const libraryUtils = require(path.join(ROOT, 'library-utils.js'));

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

test('v3.9.90: clearCloudSourceCatalog removes only the target Cloud source tracks, slices & covers while preserving other sources', async () => {
  const pruneFn = extractFn(html, 'function pruneOrphanedAlbumCovers(excludeSources)');
  const clearSourceFn = extractFn(html, 'async function clearCloudSourceCatalog(source)');

  const deletedCatalogIds = [];
  const sliceMap = new Map([
    ['google:g-1', { data: 1 }],
    ['onedrive:od-1', { data: 2 }],
    ['local:l-1', { data: 3 }]
  ]);
  const invalidated = [];
  const clearedCursors = [];
  let staleCleared = 0;

  const sandbox = {
    window: {},
    library: libraryUtils,
    URL: { revokeObjectURL() {} },
    audio: { pause() {} },
    checkedGoogleArtParents: new Set(['p1']),
    clearCloudSyncCheckpoint: () => {},
    writeCloudDeltaCursor: (k, v) => clearedCursors.push([k, v]),
    invalidateCloudTrackContent: (t) => invalidated.push(t.id),
    clearStalePreload: () => { staleCleared++; },
    saveAlbumCoversCache: () => {},
    renderTracks() {},
    renderQueue() {},
    catalogTransaction: () => {
      const tx = { oncomplete: null, onerror: null };
      const store = {
        transaction: tx,
        delete: (id) => deletedCatalogIds.push(id)
      };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
      return store;
    },
    sliceCacheTransaction: () => {
      const tx = { oncomplete: null, onerror: null };
      return {
        transaction: tx,
        getAllKeys: () => {
          const req = { result: Array.from(sliceMap.keys()), onsuccess: null, onerror: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess();
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return req;
        },
        delete: (k) => sliceMap.delete(k)
      };
    },
    state: {
      currentId: 'g-1',
      preloadTrackId: 'g-2',
      queueTrackIds: ['g-2', 'od-1'],
      tracks: [
        { id: 'g-1', source: 'google', artist: 'G Artist', album: 'G Album' },
        { id: 'g-2', source: 'google', artist: 'G Artist', album: 'G Album' },
        { id: 'od-1', source: 'onedrive', artist: 'OD Artist', album: 'OD Album' },
        { id: 'l-1', source: 'local', artist: 'Local Artist', album: 'Local Album' }
      ],
      albumCovers: new Map([
        [libraryUtils.buildAlbumKey({ artist: 'G Artist', album: 'G Album' }), 'data:image/jpeg;base64,g'],
        [libraryUtils.buildAlbumKey({ artist: 'OD Artist', album: 'OD Album' }), 'data:image/jpeg;base64,od'],
        [libraryUtils.buildAlbumKey({ artist: 'Local Artist', album: 'Local Album' }), 'data:image/jpeg;base64,loc']
      ]),
      lyricsPreloadLifecycle: { cancelAll() {} }
    }
  };

  vm.runInNewContext(`${pruneFn}\n${clearSourceFn}`, sandbox);
  const removed = await sandbox.clearCloudSourceCatalog('google');

  assert.equal(removed, 2);
  assert.deepEqual(Array.from(sandbox.state.tracks.map(t => t.id)), ['od-1', 'l-1']);
  assert.deepEqual(Array.from(sandbox.state.queueTrackIds), ['od-1']);
  assert.equal(sandbox.state.currentId, null);
  assert.equal(staleCleared, 1);
  assert.equal(sandbox.checkedGoogleArtParents.size, 0);
  assert.equal(deletedCatalogIds.length, 2);
  assert.equal(sliceMap.has('google:g-1'), false);
  assert.equal(sliceMap.has('onedrive:od-1'), true);
  assert.equal(sliceMap.has('local:l-1'), true);
  assert.equal(sandbox.state.albumCovers.size, 2);
});

test('v3.9.90: onBitPerfectFormatLocked updates player quality HUD badges, backfills missing specs, and refreshes Mini HUD', () => {
  const start = html.indexOf('window.onBitPerfectFormatLocked = function');
  const end = html.indexOf('window.getBitPerfectTelemetry = function', start);
  assert.ok(start > 0 && end > start);
  const snippet = html.slice(start, end);

  const els = {
    'bitperfect-mode-badge': { textContent: '' },
    'quality-badge': { textContent: '' },
    'mobile-quality': { textContent: '' },
    'room-quality': { textContent: '' },
    'fs-room-quality-badge': { textContent: '' }
  };
  let renderedRoom = 0;
  let updatedMini = 0;
  const track = { id: 'bp-hr-1', title: 'HiRes 192k', sampleRate: 0, bitDepth: 0 };

  const sandbox = {
    window: {},
    $: (id) => els[id] || null,
    renderRoomSignal: () => { renderedRoom++; },
    updateMiniPlayerHud: () => { updatedMini++; },
    state: {
      bitPerfectEnabled: true,
      isNativeBitPerfectPlaying: true,
      currentId: 'bp-hr-1',
      tracks: [track]
    }
  };
  vm.runInNewContext(snippet, sandbox);
  sandbox.window.onBitPerfectFormatLocked(192000, 24, true, 'FiiO KA17');

  assert.ok(els['bitperfect-mode-badge'].textContent.includes('BIT-PERFECT LOCKED'));
  assert.ok(els['quality-badge'].textContent.includes('192 kHz / 24-bit'));
  assert.ok(els['room-quality'].textContent.includes('BIT-PERFECT LOCKED · 192 kHz / 24-bit'));
  assert.equal(track.sampleRate, 192000);
  assert.equal(track.bitDepth, 24);
  assert.equal(renderedRoom, 1);
  assert.equal(updatedMini, 1);
});

test('v3.9.90: Web multi-folder drag-and-drop skips __MACOSX/dot-dirs and ._ AppleDouble ghost files while preserving paths', async () => {
  const dropStart = html.indexOf("document.addEventListener('drop', async event => {");
  const dropEnd = html.indexOf('try {\n      const googleConfig =', dropStart);
  assert.ok(dropStart > 0 && dropEnd > dropStart);
  const dropSrc = html.slice(dropStart, dropEnd);

  const listeners = {};
  const added = [];
  const sandbox = {
    library: libraryUtils,
    isExternalFileDrag: () => true,
    document: { addEventListener: (e, fn) => { listeners[e] = fn; } },
    $: () => ({ classList: { add() {}, remove() {} } }),
    addLocalFiles: async (files) => added.push(files),
    Object,
    Array,
    Promise,
    console
  };
  vm.runInNewContext(`let dragDepth = 1;\n${dropSrc}`, sandbox);

  const makeEntry = (name, isDir, fullPath, children = []) => ({
    name,
    isDirectory: isDir,
    isFile: !isDir,
    fullPath,
    file: (ok) => ok({ name, size: 100 }),
    createReader: () => {
      let sent = false;
      return {
        readEntries: (cb) => {
          if (sent) return cb([]);
          sent = true;
          cb(children);
        }
      };
    }
  });

  const macJunkDir = makeEntry('__MACOSX', true, '/__MACOSX', [
    makeEntry('._01.flac', false, '/__MACOSX/._01.flac')
  ]);
  const hiddenGitDir = makeEntry('.git', true, '/.git', [
    makeEntry('config', false, '/.git/config')
  ]);
  const musicDir = makeEntry('Album A', true, '/Album A', [
    makeEntry('._01 - Ghost.flac', false, '/Album A/._01 - Ghost.flac'),
    makeEntry('.DS_Store', false, '/Album A/.DS_Store'),
    makeEntry('01 - Real.flac', false, '/Album A/01 - Real.flac'),
    makeEntry('Album A.cue', false, '/Album A/Album A.cue')
  ]);

  await listeners.drop({
    preventDefault() {},
    dataTransfer: {
      items: [macJunkDir, hiddenGitDir, musicDir].map(en => ({ webkitGetAsEntry: () => en })),
      files: []
    }
  });

  assert.equal(added.length, 1);
  assert.deepEqual(Array.from(added[0].map(f => f.relativePath || f.name)), [
    'Album A/01 - Real.flac',
    'Album A/Album A.cue'
  ]);
});

test('v3.9.90: Monotonic version alignment across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.90';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.90';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30990);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 144);
  assert.ok(gradle.includes('versionName = "3.9.90"'));
});
