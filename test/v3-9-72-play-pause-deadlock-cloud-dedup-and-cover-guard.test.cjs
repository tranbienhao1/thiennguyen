'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Play/Pause deadlock immunity: bounded AudioContext.resume, rapid 2nd touch tap, Bit-Perfect pause guard, footer z-index & native UI-thread sync', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  // 1a. #play-button must not permanently deadlock when state.context.resume() hangs
  const bpHandlerStart = html.indexOf('function handleNativeBitPerfectPlayPauseClick()');
  const playBtnEnd = html.indexOf("$('previous-button').addEventListener('click'", bpHandlerStart);
  assert.ok(bpHandlerStart > 0 && playBtnEnd > bpHandlerStart);

  let clickFn = null;
  let playCalls = 0;
  let pauseCalls = 0;
  let audioPaused = true;
  const playBtn = {
    textContent: '▶',
    classList: { remove() {}, add() {} },
    addEventListener(ev, fn) { if (ev === 'click') clickFn = fn; },
    setAttribute() {}
  };
  const sandbox = {
    $: id => (id === 'play-button' ? playBtn : null),
    audio: {
      src: 'https://example.com/test.flac',
      get paused() { return audioPaused; },
      ended: false,
      error: null,
      dataset: { trackId: 't-1' },
      removeAttribute() {},
      play() {
        playCalls++;
        audioPaused = false;
        return Promise.resolve();
      },
      pause() {
        pauseCalls++;
        audioPaused = true;
      }
    },
    standbyAudio: { paused: true, src: '' },
    state: {
      currentId: 't-1',
      isNativeBitPerfectPlaying: false,
      isNativeBitPerfectPaused: false,
      context: {
        state: 'suspended',
        resume() { return new Promise(() => {}); } // Deliberately hangs forever!
      },
      tracks: [{ id: 't-1', source: 'local', url: 'https://example.com/test.flac' }]
    },
    window: { NocturneNative: { isBitPerfectActive: () => false } },
    setTimeout,
    clearTimeout,
    Date,
    Boolean,
    String,
    Number,
    Promise,
    console,
    syncPlaybackButtonsUi: p => { playBtn.textContent = p ? 'Ⅱ' : '▶'; }
  };
  vm.runInNewContext(html.slice(bpHandlerStart, playBtnEnd), sandbox);

  await clickFn();
  assert.equal(playCalls, 1, 'Hung AudioContext.resume() must not block audio.play()');
  assert.equal(sandbox.state._playBtnBusy, false, '_playBtnBusy must clear cleanly');

  await clickFn();
  assert.equal(pauseCalls, 1, '2nd Play/Pause tap must pause immediately without permanent _playBtnBusy lock');

  // 1b. attachReliableTransportTap uses one-shot _touchTapGhostPending so rapid 2nd finger tap never gets swallowed
  const tapStart = html.indexOf('function attachReliableTransportTap(el) {');
  const tapEnd = html.indexOf("['play-button', 'room-play'", tapStart);
  assert.ok(tapStart > 0 && tapEnd > tapStart);
  const btnListeners = {};
  let clicks = 0;
  let nowTs = 1700000000000;
  const tapSandbox = { Date: { now: () => nowTs }, Math };
  vm.runInNewContext(html.slice(tapStart, tapEnd), tapSandbox);
  tapSandbox.attachReliableTransportTap({
    disabled: false,
    addEventListener(ev, fn) { btnListeners[ev] = fn; },
    click() { clicks++; }
  });

  btnListeners.touchstart({ touches: [{ clientX: 100, clientY: 500 }] });
  btnListeners.touchend({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 105, clientY: 503 }] });
  assert.equal(clicks, 1);
  // Ghost click comes 20ms later and is swallowed once
  let blockedGhost = false;
  nowTs += 20;
  btnListeners.click({ isTrusted: true, preventDefault() { blockedGhost = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(blockedGhost, true);
  // User taps 2nd time 180ms later -> works AND synthetic ghost won't block subsequent click if browser skipped ghost
  nowTs += 180;
  btnListeners.touchstart({ touches: [{ clientX: 100, clientY: 500 }] });
  btnListeners.touchend({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 102, clientY: 501 }] });
  assert.equal(clicks, 2, 'Rapid 2nd finger tap within 200ms must fire reliably');

  // 1c. attachDeckEvents play & pause handlers ignore HTML5 deck events while Bit-Perfect is active
  const playEvtIdx = html.indexOf("element.addEventListener('play', () => {");
  const pauseEvtIdx = html.indexOf("element.addEventListener('pause', () => {", playEvtIdx);
  assert.ok(playEvtIdx > 0 && pauseEvtIdx > playEvtIdx);
  assert.ok(html.slice(playEvtIdx, playEvtIdx + 220).includes('if (state.isNativeBitPerfectPlaying) return;'));
  assert.ok(html.slice(pauseEvtIdx, pauseEvtIdx + 220).includes('if (state.isNativeBitPerfectPlaying) return;'));

  // 1d. Desktop/Tablet footer center controls & #play-button z-index hierarchy
  assert.ok(html.includes('.footer-center-controls{flex:1!important;max-width:640px!important;min-width:300px!important;margin:0 auto!important;position:relative!important;z-index:25!important;pointer-events:none!important}'));
  assert.ok(html.includes('#play-button{width:40px;height:40px;border-radius:50%;background:var(--roon-accent);color:white;position:relative;z-index:30;pointer-events:auto}'));

  // 1e. Native BitPerfectAudioPlayer pause/resume preserves mLastMediaTitle & runs UI/MediaSession updates on UI thread
  const bpPauseStart = java.indexOf('public void pause() {', java.indexOf('public class BitPerfectAudioPlayer'));
  const bpSeekStart = java.indexOf('public void seek(long positionMs)', bpPauseStart);
  assert.ok(bpPauseStart > 0 && bpSeekStart > bpPauseStart);
  const bpPauseResumeSrc = java.slice(bpPauseStart, bpSeekStart);
  assert.ok(bpPauseResumeSrc.includes('final String nTitle = (mLastMediaTitle != null && !mLastMediaTitle.isEmpty()) ? mLastMediaTitle : mCurrentTrackTitle;'));
  assert.ok(bpPauseResumeSrc.includes('updateMediaSessionPosition(posMs, durMs, false);'));
  assert.ok(bpPauseResumeSrc.includes('updateMediaSessionPosition(posMs, durMs, true);'));
  assert.ok(bpPauseResumeSrc.includes('updateMediaNotification(nTitle, nArtist, nAlbum, false);'));
  assert.ok(bpPauseResumeSrc.includes('updateMediaNotification(nTitle, nArtist, nAlbum, true);'));
});

test('2. Google Drive & OneDrive shared/shortcut bidirectional dedup, shortcut deletion & restoreCloudCatalog dedup', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 2a. scanGoogleDriveAudioShortcuts deduplicates two shortcuts pointing to the same targetId
  const scStart = html.indexOf("const GOOGLE_DRIVE_SHORTCUT_QUERY =");
  const scEnd = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY =", scStart);
  assert.ok(scStart > 0 && scEnd > scStart);

  const scState = { tracks: [] };
  const scSandbox = {
    URLSearchParams,
    Map,
    String,
    Boolean,
    Array,
    Number,
    Set,
    console,
    state: scState,
    isCloudAudio: () => true,
    invalidateCloudTrackContent: () => {},
    googleTrack: f => ({
      id: `google:${f.id}`,
      remoteId: f.id,
      targetRemoteId: f.shortcutDetails && f.shortcutDetails.targetId,
      source: 'google',
      name: f.name
    }),
    fetchGoogleDrivePageWithRetry: async () => ({
      ok: true,
      json: async () => ({
        files: [
          { id: 'sc-1', name: 'Track A.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'tgt-A' } },
          { id: 'sc-2', name: 'Track A Copy.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'tgt-A' } }
        ]
      })
    })
  };
  vm.createContext(scSandbox);
  vm.runInContext(html.slice(scStart, scEnd) + '\nthis.scanGoogleDriveAudioShortcuts = scanGoogleDriveAudioShortcuts;', scSandbox);

  const existingByRemoteId = new Map();
  const knownIds = new Set();
  const seenRemoteIds = new Set();
  const scRes = await scSandbox.scanGoogleDriveAudioShortcuts(() => 'tok', async () => 'tok', existingByRemoteId, knownIds, seenRemoteIds, [], []);
  assert.equal(scRes.added, 1, 'Two shortcuts to the same targetId must only add 1 track');
  assert.equal(scState.tracks.length, 1);

  // 2b. tryLoadGoogleChangesDelta deduplicates real target arriving when shortcut exists, and removes shortcut when target trashed
  const gdStart = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';");
  const gdEnd = html.indexOf('function removeDeletedCloudTracks(', gdStart);
  const existingSc = { id: 'google:sc-1', remoteId: 'sc-1', targetRemoteId: 'tgt-A', source: 'google', name: 'Old.flac', size: 100, contentRev: 'r1' };
  const existingSc2 = { id: 'google:sc-del', remoteId: 'sc-del', targetRemoteId: 'tgt-Del', source: 'google', name: 'TrashTarget.flac', size: 100 };
  const gDeltaState = { currentId: null, tracks: [existingSc, existingSc2] };
  const gDeltaMap = new Map([['sc-1', existingSc], ['sc-del', existingSc2]]);
  const gDeltaKnown = new Set(['sc-1', 'sc-del']);
  const invalidated = [];
  const deletedStoreIds = [];
  const gDeltaSandbox = {
    URLSearchParams, Date, Array, Number, String, Set, Map, console,
    localStorage: { getItem: () => 'c1', setItem: () => {}, removeItem: () => {} },
    state: gDeltaState,
    catalogTransaction: () => {
      const store = { delete: id => deletedStoreIds.push(id), transaction: {} };
      queueMicrotask(() => { if (store.transaction.oncomplete) store.transaction.oncomplete(); });
      return store;
    },
    invalidateCloudTrackContent: tr => invalidated.push(tr.id),
    ensureGoogleToken: async () => 'tok',
    googleConfigurationHint: () => '',
    isCloudAudio: () => true,
    googleTrack: f => ({ id: `google:${f.id}`, remoteId: f.id, source: 'google', name: f.name }),
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    fetchGoogleDrivePageWithRetry: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        newStartPageToken: 'c2',
        changes: [
          { fileId: 'tgt-A', file: { id: 'tgt-A', name: 'Remastered.flac', size: '2500', md5Checksum: 'r2' } },
          { fileId: 'tgt-Del', file: { id: 'tgt-Del', name: 'TrashTarget.flac', trashed: true } }
        ]
      })
    })
  };
  vm.createContext(gDeltaSandbox);
  vm.runInContext(html.slice(gdStart, gdEnd) + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', gDeltaSandbox);
  const gdRes = await gDeltaSandbox.tryLoadGoogleChangesDelta('tok', gDeltaMap, gDeltaKnown);
  assert.equal(gdRes.added, 0, 'Real target arriving for known shortcut must update in-place rather than duplicate');
  assert.equal(gdRes.updated, 1);
  assert.equal(gdRes.removed, 1, 'Trashed target must also remove its pointing shortcut');
  assert.equal(existingSc.size, 2500);
  assert.deepEqual(deletedStoreIds, ['google:sc-del']);
  assert.deepEqual(invalidated, ['google:sc-1', 'google:sc-del']);

  // 2c. OneDrive normalizeMicrosoftDriveItem preserves remoteShortcutId & tryLoadMicrosoftDeltaSync deduplicates/deletes wrapper ID
  const msTrackStart = html.indexOf('const serializableCloudTrack = track =>');
  const msTrackEnd = html.indexOf('let cloudMetadataQueue =', msTrackStart);
  const msDeltaStart = html.indexOf('async function tryLoadMicrosoftDeltaSync(');
  const msDeltaEnd = html.indexOf('async function loadMicrosoftFiles(', msDeltaStart);
  assert.ok(msTrackStart > 0 && msTrackEnd > msTrackStart && msDeltaStart > 0 && msDeltaEnd > msDeltaStart);

  const library = require(path.join(ROOT, 'library-utils.js'));
  const existingShared = { id: 'onedrive:sh-1', remoteId: 'sh-1', remoteDriveId: 'drv-9', remoteShortcutId: 'wrap-1', source: 'onedrive', name: 'Shared.flac', size: 1000 };
  const existingSharedToDel = { id: 'onedrive:sh-del', remoteId: 'sh-del', remoteShortcutId: 'wrap-del', source: 'onedrive', name: 'Del.flac', size: 500 };
  const msMap = new Map([['sh-1', existingShared], ['sh-del', existingSharedToDel]]);
  const msKnown = new Set(['sh-1', 'sh-del']);
  const msDeleted = [];

  const msSandbox = {
    library, Date, Array, Number, String, Object, Set, Map, Promise, console,
    URLSearchParams,
    MICROSOFT_DELTA_LINK_KEY: 'nocturne-microsoft-delta-link',
    state: { tracks: [existingShared, existingSharedToDel] },
    filenameMetadata: n => ({ title: n, artist: 'A', album: 'Al' }),
    audioFormat: () => 'FLAC',
    isDsdFormat: () => false,
    isCloudAudio: () => true,
    loadMicrosoftAudio: async () => {},
    loadGoogleAudio: async () => {},
    coverForCatalog: c => c || '',
    readCloudDeltaCursor: () => 'https://graph.microsoft.com/delta1',
    writeCloudDeltaCursor: () => {},
    invalidateCloudTrackContent: () => {},
    persistCloudCatalog: async () => {},
    pruneCloudCatalog: async () => {},
    renderTracks: () => {},
    cloudStatus: () => {},
    toast: () => {},
    removeCloudTracksByRemoteIds: async (_src, ids) => {
      ids.forEach(id => msDeleted.push(id));
      return ids.size;
    },
    graphGet: async () => ({
      value: [
        {
          id: 'wrap-1',
          name: 'Shared.flac',
          remoteItem: {
            id: 'sh-1',
            name: 'Shared.flac',
            size: 2048,
            cTag: 'c-new',
            parentReference: { driveId: 'drv-9', path: '/drives/drv-9/root:/Music' }
          }
        },
        { id: 'wrap-del', deleted: { state: 'deleted' } }
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/delta2'
    })
  };
  vm.createContext(msSandbox);
  vm.runInContext(
    html.slice(msTrackStart, msTrackEnd) + '\n' + html.slice(msDeltaStart, msDeltaEnd) +
    '\nthis.normalizeMicrosoftDriveItem = normalizeMicrosoftDriveItem;' +
    '\nthis.serializableCloudTrack = serializableCloudTrack;' +
    '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;',
    msSandbox
  );
  const normRes = msSandbox.normalizeMicrosoftDriveItem({ id: 'wrap-1', remoteItem: { id: 'sh-1', parentReference: { driveId: 'drv-9' } } }, '');
  assert.equal(normRes.item.remoteShortcutId, 'wrap-1');
  assert.equal(msSandbox.serializableCloudTrack({ id: 'onedrive:sh-1', remoteId: 'sh-1', remoteShortcutId: 'wrap-1', name: 'x', title: 'x', artist: 'a', album: 'b', format: 'FLAC', source: 'onedrive' }).remoteShortcutId, 'wrap-1');

  const msDeltaRes = await msSandbox.tryLoadMicrosoftDeltaSync('ms-tok', msMap, msKnown);
  assert.equal(msDeltaRes.added, 0, 'Duplicate personal shortcut wrapper to existing shared track must update instead of duplicate');
  assert.equal(msDeltaRes.removed, 1, 'Delta deletion referencing shortcut wrapper ID must remove canonical track');
  assert.deepEqual(msDeleted, ['sh-del']);
  assert.equal(existingShared.size, 2048);

  // 2d. restoreCloudCatalog deduplicates legacy duplicate Google/OneDrive catalog pairs
  const restStart = html.indexOf('function restoreCloudCatalog() {');
  const restEnd = html.indexOf('const RECENT_TRACKS_KEY =', restStart);
  assert.ok(restStart > 0 && restEnd > restStart);
  const restState = { tracks: [] };
  const restSandbox = {
    Promise, Set, Map, Array, String, console,
    state: restState,
    cloudRestorePromise: null,
    openDatabase: async () => {},
    catalogTransaction: () => ({
      getAll() {
        const req = {};
        queueMicrotask(() => {
          req.result = [
            { id: 'google:sc-1', remoteId: 'sc-1', targetRemoteId: 'tgt-1', source: 'google', format: 'FLAC', name: 'A.flac' },
            { id: 'google:tgt-1', remoteId: 'tgt-1', source: 'google', format: 'FLAC', name: 'A.flac' },
            { id: 'onedrive:sh-1', remoteId: 'sh-1', remoteShortcutId: 'wrap-1', source: 'onedrive', format: 'FLAC', name: 'B.flac' },
            { id: 'onedrive:wrap-1', remoteId: 'wrap-1', source: 'onedrive', format: 'FLAC', name: 'B.flac' }
          ];
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      }
    }),
    library: { prepareRestoredCatalog: entries => ({ entries, changed: false }) },
    isDsdFormat: () => false,
    renderTracks: () => {},
    queueCloudMetadata: () => {},
    pruneCloudCatalog: () => {},
    restoreRecentTracks: () => {},
    loadGoogleAudio: async () => {},
    loadMicrosoftAudio: async () => {}
  };
  vm.createContext(restSandbox);
  vm.runInContext(html.slice(restStart, restEnd) + '\nthis.restoreCloudCatalog = restoreCloudCatalog;', restSandbox);
  const restoredCount = await restSandbox.restoreCloudCatalog();
  assert.equal(restoredCount, 2, 'restoreCloudCatalog must deduplicate shortcut/target & shortcut/canonical catalog pairs');
});

test('3. Native Bit-Perfect error passes positionMs + AudioTrack STATE_INITIALIZED guards, rapid-seek close safety & cover large-image guard', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  // 3a. MainActivity.java passes safePosMs to window.onNativeBitPerfectError & checks STATE_INITIALIZED
  assert.ok(java.includes('final long safePosMs = Math.max(0L, mCurrentPositionMs.get());'));
  assert.ok(java.includes("window.onNativeBitPerfectError('\" + safeMsg + \"', \" + safePosMs + \");"));
  assert.ok(java.includes('notifyBitPerfectErrorToWeb(pendingErrorReason);'), 'Keep exact call string for v3.9.47 test parity');
  assert.ok(java.includes('track.getState() != AudioTrack.STATE_INITIALIZED'));

  // 3b. Web window.onNativeBitPerfectError prefers accurate nativePosMs & clamps CUE cueStart
  const bpErrStart = html.indexOf('window.onNativeBitPerfectError =');
  const bpErrEnd = html.indexOf('window.onBitPerfectPlaybackComplete =', bpErrStart);
  const cueTrack = { id: 'cue-1', isCue: true, cueStart: 120, source: 'local' };
  const errSandbox = {
    window: {}, console, Number, Boolean, String, Date: { now: () => 1700000000000 },
    audio: { paused: true },
    state: {
      currentId: 'cue-1',
      isNativeBitPerfectPlaying: true,
      isNativeBitPerfectPaused: false,
      lastBitPerfectPositionSec: 0, // backgrounded WebView had 0!
      _bpCueAdvancingId: 'cue-1',
      tracks: [cueTrack],
      context: { state: 'running' }
    },
    playTrack: () => {},
    playNext: () => {},
    toast: () => {}
  };
  vm.createContext(errSandbox);
  vm.runInContext(html.slice(bpErrStart, bpErrEnd), errSandbox);
  errSandbox.window.onNativeBitPerfectError('AudioTrack write error', 145600);
  assert.equal(cueTrack._resumeAfterBpFallbackSec, 145.6);
  assert.equal(errSandbox.state._bpCueAdvancingId, null);

  // 3c. BoundedFileInputStream & BoundedContentUriInputStream close-race + coverFileToJpeg guards
  assert.ok(java.includes('public static class BoundedFileInputStream'));
  assert.ok(java.includes('if (off < 0 || len < 0 || off + len > b.length) throw new IndexOutOfBoundsException();'));
  assert.ok(java.includes('catch (IOException ioErr) {\n                if (mClosed) return -1;'));
  assert.ok(java.includes('private static final int COVER_MAX_DIMENSION = 16384;'));
  assert.ok(java.includes('private static final long COVER_MAX_PIXELS = 100_000_000L;'));
  assert.ok(java.includes('private byte[] coverFileToJpeg(File file, int size, long maxFileBytes)'));
  assert.ok(java.includes('coverFileToJpeg(kid, size, 24L * 1024L * 1024L)'));
});

test('4. Version sync v3.9.72 / versionCode 126, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:7[2-9]|[89]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.72';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.72';"));
  assert.ok(/versionCode\s*=\s*(?:12[6-9]|1[3-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.72"'));
  assert.ok(/"3\.9\.(?:7[2-9]|[89]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:7[2-9]|[89]\d|\d{3,})/.test(publishRelease));

  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(indexHtml.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(indexHtml.includes('target.volume = audio.volume; target.muted = false;'));
  assert.equal(/\bmodal\.showModal\s*\(/.test(indexHtml), false);

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

  const scriptStart = indexHtml.lastIndexOf('<script>');
  const scriptEnd = indexHtml.lastIndexOf('</script>');
  const codeFiles = [['index.html <script>', indexHtml.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter(name => name.endsWith('.js'))) {
    codeFiles.push([f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
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
