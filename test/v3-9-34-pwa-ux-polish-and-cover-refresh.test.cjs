'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. manifest.json deduplicates icon entries while keeping SVG, 192x192, and 512x512', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.icons));
  assert.equal(manifest.icons.length, 3, 'manifest.icons should contain exactly 3 unique entries');

  const seen = new Set();
  for (const icon of manifest.icons) {
    const key = `${icon.src}|${icon.sizes}`;
    assert.ok(!seen.has(key), `Duplicate manifest icon declaration: ${key}`);
    seen.add(key);
    assert.ok(String(icon.purpose || '').split(' ').includes('any'));
  }

  assert.ok(manifest.icons.some(i => i.src === 'icons/icon.svg' && i.sizes === 'any'));
  assert.ok(manifest.icons.some(i => i.src === 'icons/icon-192.png' && i.sizes === '192x192' && i.purpose.includes('maskable')));
  assert.ok(manifest.icons.some(i => i.src === 'icons/icon-512.png' && i.sizes === '512x512' && i.purpose.includes('maskable')));
});

test('2. broadcastCoverUpdate refreshes MediaSession metadata when current track receives async art & updateMediaSession syncs position state', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const bcStart = html.indexOf('function broadcastCoverUpdate(albumKey, coverUrl, trackIds)');
  const bcEnd = html.indexOf('\n    if (typeof window !==', bcStart);
  assert.ok(bcStart !== -1 && bcEnd > bcStart, 'broadcastCoverUpdate block must exist');
  const bcSrc = html.slice(bcStart, bcEnd);

  assert.ok(bcSrc.includes("if (!curTrack.cover || curTrack.cover === '♫') curTrack.cover = coverUrl;"), 'Must update curTrack.cover on async match');
  assert.ok(bcSrc.includes("if (typeof updateMediaSession === 'function') updateMediaSession(curTrack);"), 'Must refresh MediaSession when current track cover arrives');

  const msStart = html.indexOf('function updateMediaSession(track)');
  const msEnd = html.indexOf('let isUserScrolling = false;', msStart);
  assert.ok(msStart !== -1 && msEnd > msStart, 'updateMediaSession and updatePositionState must exist');
  const msSrc = html.slice(msStart, msEnd);

  let updatedMeta = null;
  let updatedPos = null;
  const fakeTrack = { id: 'tr-1', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', cover: 'https://cdn.example.com/art.jpg' };
  const fakeAudio = { duration: 245, currentTime: 42.7, playbackRate: 1, paused: false };

  const sandbox = {
    window: { location: { href: 'https://nocturne.example/' } },
    navigator: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setPositionState(pos) { updatedPos = pos; }
      }
    },
    MediaMetadata: function MediaMetadata(obj) { updatedMeta = obj; return obj; },
    state: { activeDeck: { element: fakeAudio }, currentId: '99', tracks: [fakeTrack] },
    audio: fakeAudio,
    trackById: (id) => (String(id) === '99' ? fakeTrack : null),
    library: { UNKNOWN_ARTIST: 'Unknown Artist', UNKNOWN_ALBUM: 'Unknown Album' },
    URL,
    console
  };

  vm.runInNewContext(msSrc + '\nwindow.__test = { updateMediaSession, updatePositionState };', sandbox);
  sandbox.window.__test.updateMediaSession(fakeTrack);

  assert.ok(updatedMeta && updatedMeta.title === 'Track 1');
  assert.equal(updatedMeta.artwork[5].src, 'https://cdn.example.com/art.jpg');
  assert.equal(sandbox.navigator.mediaSession.playbackState, 'playing');
  assert.ok(updatedPos && updatedPos.duration === 245 && updatedPos.position <= 42.7, 'updateMediaSession must immediately sync position state');
});

test('3. Drag-and-drop ignores internal queue drags & preserves nested directory relativePath on dropped folders', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dragStart = html.indexOf('let dragDepth = 0;');
  const dragEnd = html.indexOf('    try {\n      const googleConfig = library.parseCloudConfig', dragStart);
  assert.ok(dragStart !== -1 && dragEnd > dragStart, 'Drag-and-drop section must exist');
  const dragSrc = html.slice(dragStart, dragEnd);

  const listeners = {};
  const dropOverlayClasses = new Set(['hidden']);
  const dropTargetEl = {
    classList: {
      add(c) { dropOverlayClasses.add(c); },
      remove(c) { dropOverlayClasses.delete(c); },
      contains(c) { return dropOverlayClasses.has(c); }
    }
  };
  const addedBatches = [];

  const sandbox = {
    document: { addEventListener(evt, fn) { listeners[evt] = fn; } },
    $: (id) => (id === 'drop-target' ? dropTargetEl : null),
    addLocalFiles: async (files) => { addedBatches.push(files); },
    Object,
    Array,
    Promise,
    console
  };
  vm.runInNewContext(dragSrc + '\nwindow = {}; window.isExternalFileDrag = isExternalFileDrag;', sandbox);

  // Internal queue drag must NOT trigger drop overlay
  let preventDefaultCalled = false;
  listeners.dragenter({
    dataTransfer: { types: ['text/plain'] },
    preventDefault() { preventDefaultCalled = true; }
  });
  assert.equal(preventDefaultCalled, false, 'Internal text/plain drag must not hijack dragenter');
  assert.equal(dropTargetEl.classList.contains('hidden'), true, 'Drop overlay must remain hidden during queue reorder drags');

  // External file/folder drop must open overlay on dragenter and preserve nested relativePath on drop
  listeners.dragenter({
    dataTransfer: { types: ['Files'] },
    preventDefault() { preventDefaultCalled = true; }
  });
  assert.equal(preventDefaultCalled, true);
  assert.equal(dropTargetEl.classList.contains('hidden'), false);

  const fakeDirEntry = {
    isFile: false,
    isDirectory: true,
    name: 'Miles Davis - Kind of Blue',
    createReader() {
      let done = false;
      return {
        readEntries(cb) {
          if (done) return cb([]);
          done = true;
          cb([
            {
              isFile: true,
              isDirectory: false,
              name: '01 So What.flac',
              fullPath: '/Miles Davis - Kind of Blue/01 So What.flac',
              file(ok) { ok({ name: '01 So What.flac', size: 1234 }); }
            },
            {
              isFile: true,
              isDirectory: false,
              name: 'cover.jpg',
              fullPath: '/Miles Davis - Kind of Blue/cover.jpg',
              file(ok) { ok({ name: 'cover.jpg', size: 456 }); }
            }
          ]);
        }
      };
    }
  };

  await listeners.drop({
    dataTransfer: {
      types: ['Files'],
      items: [{ webkitGetAsEntry: () => fakeDirEntry }],
      files: []
    },
    preventDefault() {}
  });

  assert.equal(dropTargetEl.classList.contains('hidden'), true, 'Drop overlay must hide after drop');
  assert.equal(addedBatches.length, 1);
  assert.equal(addedBatches[0].length, 2);
  assert.equal(addedBatches[0][0].relativePath, 'Miles Davis - Kind of Blue/01 So What.flac');
  assert.equal(addedBatches[0][1].relativePath, 'Miles Davis - Kind of Blue/cover.jpg');
});

test('4. Service Worker registration wires non-intrusive PWA update prompt & respects dismissal', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const swRegStart = html.indexOf('(function registerServiceWorker()');
  const swRegEnd = html.indexOf('</script>', swRegStart);
  assert.ok(swRegStart !== -1 && swRegEnd > swRegStart, 'registerServiceWorker must exist');
  const swRegSrc = html.slice(swRegStart, swRegEnd);

  assert.ok(swRegSrc.includes('if (reg.waiting) promptIfWaiting(reg.waiting);'));
  assert.ok(swRegSrc.includes("reg.addEventListener('updatefound'"));
  assert.ok(swRegSrc.includes('window.notifyPwaServiceWorkerUpdate('));

  // Execute notifyPwaServiceWorkerUpdate + Service Worker registration flow in VM
  const updateBannerClasses = new Set(['hidden']);
  const els = {
    'update-banner-text': { textContent: '' },
    'update-banner': {
      classList: {
        add(c) { updateBannerClasses.add(c); },
        remove(c) { updateBannerClasses.delete(c); },
        contains(c) { return updateBannerClasses.has(c); }
      }
    }
  };
  let regListeners = {};
  let newWorkerListeners = {};
  let loadHandler = null;
  const fakeInstalling = {
    state: 'installing',
    scriptURL: 'https://nocturne.example/sw.js?v=3.9.34',
    addEventListener(ev, fn) { newWorkerListeners[ev] = fn; }
  };

  const sandbox = {
    window: {
      location: { protocol: 'https:', hostname: 'nocturne.example' },
      addEventListener(ev, fn) { if (ev === 'load') loadHandler = fn; }
    },
    location: { protocol: 'https:', hostname: 'nocturne.example' },
    navigator: {
      serviceWorker: {
        controller: { scriptURL: 'https://nocturne.example/sw.js?v=3.9.33' },
        async register() {
          return {
            waiting: null,
            installing: fakeInstalling,
            addEventListener(ev, fn) { regListeners[ev] = fn; }
          };
        }
      }
    },
    $: (id) => els[id] || null,
    updatePending: false,
    pendingUpdateFingerprint: '',
    dismissedUpdateFingerprint: 'sw:already-dismissed',
    setUpdateBanner(msg) {
      els['update-banner-text'].textContent = msg;
      els['update-banner'].classList.remove('hidden');
    },
    console
  };
  sandbox.window.notifyPwaServiceWorkerUpdate = undefined;

  const fnMatch = html.slice(html.indexOf('window.notifyPwaServiceWorkerUpdate = function'), html.indexOf('function updateNetworkStatus'));
  vm.runInNewContext(fnMatch + '\n' + swRegSrc, sandbox);

  assert.equal(sandbox.window.notifyPwaServiceWorkerUpdate('sw:already-dismissed'), false, 'Dismissed update must stay hidden');
  assert.equal(els['update-banner'].classList.contains('hidden'), true);

  assert.ok(typeof loadHandler === 'function');
  loadHandler();
  await new Promise(r => setImmediate(r));

  regListeners.updatefound();
  fakeInstalling.state = 'installed';
  newWorkerListeners.statechange();

  assert.equal(els['update-banner'].classList.contains('hidden'), false, 'New installed SW must surface non-intrusive update banner');
  assert.ok(els['update-banner-text'].textContent.includes('Web PWA'));
});

test('5. Settings "Làm mới ảnh bìa" clears stale web & native caches and busts /local-cover + https artwork', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(html.includes('id="refresh-cover-art-btn"'), 'Settings must include Làm mới ảnh bìa button');
  assert.ok(java.includes('public int clearLocalCoverCache()'), 'MainActivity.java WebAppInterface must expose clearLocalCoverCache()');

  const fnStart = html.indexOf('async function refreshAllArtworkCaches()');
  const fnEnd = html.indexOf('function getM3uExportTracks()', fnStart);
  assert.ok(fnStart !== -1 && fnEnd > fnStart, 'refreshAllArtworkCaches must exist');

  const removedLsKeys = [];
  let nativeClears = 0;
  let propagated = 0;
  let renderedTracks = 0;
  let renderedArtists = 0;
  let heroShown = 0;
  let driveRefetched = 0;
  let mediaSessionRefreshed = 0;
  const toasts = [];

  const tracks = [
    { id: '1', cover: 'https://appassets.androidplatform.net/local-cover?key=abc&r=111' },
    { id: '2', cover: 'https://is1-ssl.mzstatic.com/image/thumb/cover.jpg', thumbnailRetryAt: 999 },
    { id: '3', cover: 'data:image/jpeg;base64,EMBEDDED' },
    { id: '4', cover: 'blob:https://nocturne.example/local-123' }
  ];

  const sandbox = {
    window: { NocturneNative: { clearLocalCoverCache() { nativeClears++; return 14; } } },
    state: {
      albumCovers: new Map([['a:::b', 'url']]),
      artistPortraits: new Map([['a', 'url']]),
      tracks,
      currentCollectionEntry: { key: 'a:::b' },
      googleToken: 'tok-1',
      currentId: '3'
    },
    failedNativeCovers: new Set(['x']),
    onlineArtAttempted: new Set(['y']),
    checkedGoogleArtParents: new Set(['folder1']),
    localStorage: { removeItem(k) { removedLsKeys.push(k); } },
    propagateAndBroadcastCovers: () => { propagated++; },
    renderTracks: () => { renderedTracks++; },
    renderRecentArtists: () => { renderedArtists++; },
    showAlbumHero: () => { heroShown++; },
    discoverGoogleDriveFolderArtwork: async () => { driveRefetched++; },
    trackById: (id) => tracks.find(t => t.id === id) || null,
    updateMediaSession: () => { mediaSessionRefreshed++; },
    toast: (m) => { toasts.push(m); },
    $: () => null,
    safeOn: () => {},
    Date,
    Promise
  };

  vm.runInNewContext(html.slice(fnStart, fnEnd), sandbox);
  const res = await sandbox.window.refreshAllArtworkCaches();

  assert.equal(res.clearedNativeFiles, 14);
  assert.equal(res.refreshedCount, 2);
  assert.equal(nativeClears, 1);
  assert.equal(sandbox.state.albumCovers.size, 0);
  assert.equal(sandbox.state.artistPortraits.size, 0);
  assert.equal(sandbox.failedNativeCovers.size, 0);
  assert.equal(sandbox.onlineArtAttempted.size, 0);
  assert.equal(sandbox.checkedGoogleArtParents.size, 0);
  assert.deepEqual(removedLsKeys, ['nocturne-album-covers', 'nocturne-artist-portraits']);
  assert.ok(/local-cover\?key=abc&r=\d+$/.test(tracks[0].cover) && !tracks[0].cover.includes('&r=111'));
  assert.equal(tracks[1].cover, '', 'Online HTTP cover must be cleared for fresh re-fetch');
  assert.equal(tracks[1].thumbnailRetryAt, undefined);
  assert.equal(tracks[2].cover, 'data:image/jpeg;base64,EMBEDDED', 'Embedded data:image cover must stay intact');
  assert.equal(tracks[3].cover, 'blob:https://nocturne.example/local-123', 'Local blob cover must stay intact');
  assert.equal(propagated, 1);
  assert.equal(renderedTracks, 1);
  assert.equal(renderedArtists, 1);
  assert.equal(heroShown, 1);
  assert.equal(driveRefetched, 1);
  assert.equal(mediaSessionRefreshed, 1);
  assert.ok(toasts[0].includes('14') && toasts[0].includes('2'));
});

test('6. Version sync v3.9.34 / versionCode 88 & zero Chromium 74 ES2020+ syntax violations', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.34'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.34';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.34';"));
  assert.ok(/versionCode\s*=\s*88\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.34"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.34"'));

  const filesToScan = [
    'index.html',
    'library-utils.js',
    'metadata-utils.js',
    'cloud-metadata.js',
    'sw.js',
    'autoeq-cue.js',
    'dsd-worker.js',
    'library-tools.js',
    'lrclib-client.js',
    'lyrics-editor-ui.js',
    'lyrics-utils.js',
    'metadata-ui.js',
    'ui-overlay.js',
    'virtual-scroll.js'
  ];

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
