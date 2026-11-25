'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'),
  'utf8'
);
const releaseScript = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, 'Missing start marker: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, 'Missing end marker: ' + endMarker);
  return src.slice(start, end);
}

describe('v3.9.95: Mixed Cloud/Local preload expiry guard, USB DAC reconnect & Cloud folder cover propagation', () => {
  it('1. isPreloadedStandbyStaleOrErrored & preloadNext/playTrack invalidate expired OneDrive/Google HTTPS preloads and errored standby buffers while preserving healthy blob slices; n/p shortcuts call preventDefault()', async () => {
    const prepSrc = sliceBetween(
      html,
      'async function prepareCloudTrackForPreload(track) {',
      'async function prepareLocalDsdNext('
    );
    const preloadBlockSrc = sliceBetween(
      html,
      'function isSameCueParentTrack(curTrack, nextTrack) {',
      'function skipFailedTrack('
    );

    const playTrackHead = sliceBetween(
      html,
      'const trackUrl = track.url ? new URL(track.url, location.href).href : \'\';',
      'state.queueTrackIds = (state.queueTrackIds || []).filter('
    );
    assert.ok(
      playTrackHead.includes('invalidateStaleStandbyPreload(track, trackUrl)'),
      'playTrack must check invalidateStaleStandbyPreload before trusting standby preload'
    );
    assert.ok(
      playTrackHead.includes('const wasPreloaded = !preloadExpiredOnPlay && state.preloadTrackId === track.id'),
      'playTrack must reject wasPreloaded when preloadExpiredOnPlay is true'
    );

    assert.ok(
      html.includes("else if (event.key.toLowerCase() === 'n') { event.preventDefault(); playNext(1); }"),
      'Keyboard "n" shortcut must call event.preventDefault()'
    );
    assert.ok(
      html.includes("else if (event.key.toLowerCase() === 'p') { event.preventDefault(); playNext(-1); }"),
      'Keyboard "p" shortcut must call event.preventDefault()'
    );

    let msLoadCalls = 0;
    let standbyLoads = 0;
    const expiredMsUrl = 'https://onedrive.example/download/expired-signed-url.flac';
    const freshMsUrl = 'https://onedrive.example/download/fresh-signed-url.flac';

    const standbyAudio = {
      src: expiredMsUrl,
      volume: 1,
      muted: true,
      error: null,
      readyState: 4,
      duration: 240,
      currentTime: 0,
      pause() {},
      removeAttribute(a) { if (a === 'src') this.src = ''; },
      load() { standbyLoads++; },
      addEventListener() {}
    };

    const curLocal = { id: 'local:1', source: 'local', url: 'blob:https://app.example/local-1' };
    const nextOneDrive = {
      id: 'onedrive:item-1',
      remoteId: 'item-1',
      source: 'onedrive',
      url: expiredMsUrl,
      downloadUrl: expiredMsUrl,
      downloadUrlAt: Date.now() - (29 * 60 * 1000),
      load: async () => {
        msLoadCalls++;
        nextOneDrive.downloadUrl = freshMsUrl;
        nextOneDrive.downloadUrlAt = Date.now();
        nextOneDrive.url = freshMsUrl;
      }
    };
    const nextGoogleDirect = {
      id: 'google:g-1',
      remoteId: 'g-1',
      source: 'google',
      url: 'https://www.googleapis.com/drive/v3/files/g-1?alt=media'
    };
    const nextGoogleBlobSlice = {
      id: 'google:g-slice',
      remoteId: 'g-slice',
      source: 'google',
      url: 'blob:https://app.example/slice-ok',
      firstSlicePlayback: true
    };

    const sandbox = {
      MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
      URL,
      Date,
      Set,
      navigator: { onLine: true },
      library: {},
      location: { href: 'https://app.example/' },
      audio: { volume: 1 },
      standbyAudio,
      state: {
        context: { currentTime: 10 },
        deckA: { router: { gain: { setTargetAtTime() {} } } },
        deckB: { router: { gain: { setTargetAtTime() {} } } },
        activeDeck: null,
        crossfadeUntil: 0,
        currentId: 'local:1',
        tracks: [curLocal, nextOneDrive, nextGoogleDirect, nextGoogleBlobSlice],
        preloadTrackId: 'onedrive:item-1',
        preloadBusyId: null,
        preloadReadyUrl: expiredMsUrl,
        preloadGeneration: 1,
        objectUrls: new Set(['blob:https://app.example/slice-ok']),
        googleToken: 'tok-g',
        googleExpiresAt: Date.now() + (2 * 60 * 1000)
      },
      queueIndex: () => 1,
      clearStalePreload() {},
      releaseUnusedCloudUrl() {},
      ensureLocalTrackPlayableUrl: async () => {},
      ensureMicrosoftToken: async () => 'tok-ms',
      resolveMicrosoftDownloadUrl: async () => freshMsUrl,
      console
    };
    sandbox.state.activeDeck = sandbox.state.deckA;

    vm.createContext(sandbox);
    vm.runInContext(
      prepSrc + '\n' + preloadBlockSrc +
      '\nthis.isPreloadedStandbyStaleOrErrored = isPreloadedStandbyStaleOrErrored;' +
      '\nthis.preloadNext = preloadNext;',
      sandbox
    );

    // Expired OneDrive HTTPS URL -> stale
    assert.equal(sandbox.isPreloadedStandbyStaleOrErrored(nextOneDrive, expiredMsUrl), true);
    // Near-expiry Google Drive direct HTTPS URL -> stale
    assert.equal(sandbox.isPreloadedStandbyStaleOrErrored(nextGoogleDirect, nextGoogleDirect.url), true);
    // Healthy Google Drive local blob slice -> NOT stale (even when token expires soon)
    assert.equal(sandbox.isPreloadedStandbyStaleOrErrored(nextGoogleBlobSlice, nextGoogleBlobSlice.url), false);
    // Errored standbyAudio -> stale even for blob URL
    standbyAudio.error = { code: 2 };
    assert.equal(sandbox.isPreloadedStandbyStaleOrErrored(nextGoogleBlobSlice, nextGoogleBlobSlice.url), true);
    standbyAudio.error = null;

    // Non-forced preloadNext(false) MUST invalidate the expired OneDrive URL and reload fresh signed URL
    await sandbox.preloadNext(false);
    assert.equal(msLoadCalls, 1, 'preloadNext(false) must re-fetch expired OneDrive pre-signed URL');
    assert.equal(standbyAudio.src, freshMsUrl, 'standbyAudio must be updated with fresh OneDrive URL');
    assert.ok(standbyLoads >= 2, 'standbyAudio must be cleared and reloaded with the fresh URL');
  });

  it('2. BitPerfectAudioPlayer rebuilds AudioTrack on USB DAC mid-playback connect (AtomicInteger mRouteRefreshFlags) and playTrack resets state.bitPerfectLockedFormat on transitions', () => {
    assert.ok(
      mainJava.includes('private final AtomicInteger mRouteRefreshFlags = new AtomicInteger(0);'),
      'BitPerfectAudioPlayer must track mRouteRefreshFlags atomically'
    );
    assert.ok(
      mainJava.includes('mRouteRefreshFlags.set(0);'),
      'BitPerfectAudioPlayer.start() must reset mRouteRefreshFlags'
    );
    const onRouteSrc = sliceBetween(
      mainJava,
      'public void onAudioOutputRouteChanged(boolean connected)',
      'public synchronized void stop()'
    );
    assert.ok(
      onRouteSrc.includes('mRouteRefreshFlags.compareAndSet(prev, prev | flagBit)'),
      'onAudioOutputRouteChanged must set FLAG_ROUTE_CONNECT atomically via CAS'
    );

    const usbRebuildChecks = mainJava.match(/if \(wasDisconnect \|\| oldDevId != newDevId \|\| \(wasConnect && isUsbTarget\)\)/g) || [];
    assert.equal(
      usbRebuildChecks.length,
      2,
      'Both outer pause loop and inner PCM write loop must rebuild AudioTrack on USB DAC connect'
    );

    const ptSrc = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
    const lockResets = ptSrc.match(/state\.bitPerfectLockedFormat = null;/g) || [];
    assert.ok(
      lockResets.length >= 4,
      `Expected >= 4 state.bitPerfectLockedFormat = null resets inside playTrack (DSD, Cloud load, fresh Native BP start, Web fallback), found ${lockResets.length}`
    );
  });

  it('3. library.extractTrackDirectory supports Google Drive parents & OneDrive remotePath/remoteParentId (excluding blob:/data:) and pruneRemovedLocalFolderTracks cleans blob covers & orphaned albumCovers', () => {
    // Google Drive tracks restored from IndexedDB (url: '', parents: ['g_folder_42'])
    const g1 = { id: 'google:1', source: 'google', url: '', title: 'Track 1', album: 'Unknown Album', parents: ['g_folder_42'], cover: 'data:image/jpeg;base64,AAA' };
    const g2 = { id: 'google:2', source: 'google', url: '', title: 'Track 2', album: 'Unknown Album', parents: ['g_folder_42'], cover: null };
    const gOther = { id: 'google:3', source: 'google', url: '', title: 'Other', album: 'Unknown Album', parents: ['g_folder_99'], cover: null };

    // OneDrive tracks restored from IndexedDB (remotePath or remoteParentId)
    const ms1 = { id: 'onedrive:1', source: 'onedrive', url: '', title: 'OD 1', album: 'Unknown Album', remotePath: 'Music/Jazz/01.flac', cover: 'data:image/jpeg;base64,BBB' };
    const ms2 = { id: 'onedrive:2', source: 'onedrive', url: '', title: 'OD 2', album: 'Unknown Album', remotePath: 'Music/Jazz/02.flac', cover: null };
    const msParent1 = { id: 'onedrive:3', source: 'onedrive', url: '', title: 'OD P1', album: 'Unknown Album', remoteParentId: 'od_dir_7', cover: 'data:image/jpeg;base64,CCC' };
    const msParent2 = { id: 'onedrive:4', source: 'onedrive', url: '', title: 'OD P2', album: 'Unknown Album', remoteParentId: 'od_dir_7', cover: null };

    // Explicit parentPath / folderPath & blob:/data: exclusion
    assert.equal(library.extractTrackDirectory({ parentPath: 'Cloud/Acoustic/' }), 'Cloud/Acoustic');
    assert.equal(library.extractTrackDirectory({ folderPath: 'Shared\\LP1\\' }), 'Shared\\LP1');
    assert.equal(library.extractTrackDirectory({ source: 'local', url: 'blob:https://app.example/uuid-1' }), '');
    assert.equal(library.extractTrackDirectory({ source: 'local', url: 'data:audio/wav;base64,AAAA' }), '');
    assert.equal(library.extractTrackDirectory(g1), 'google::parent::g_folder_42');
    assert.equal(library.extractTrackDirectory(ms1), 'Music/Jazz');
    assert.equal(library.extractTrackDirectory(msParent1), 'onedrive::parent::od_dir_7');

    // Unrelated local blob tracks without paths must NOT inherit each other's covers via blob: URL prefix
    const locA = { id: 'local:a', source: 'local', url: 'blob:https://app.example/a', title: 'Single A', album: 'Unknown Album', cover: 'data:image/jpeg;base64,DDD' };
    const locB = { id: 'local:b', source: 'local', url: 'blob:https://app.example/b', title: 'Single B', album: 'Unknown Album', cover: null };

    const coverMap = new Map();
    library.instantPropagateCovers([g1, g2, gOther, ms1, ms2, msParent1, msParent2, locA, locB], coverMap);
    assert.equal(g2.cover, 'data:image/jpeg;base64,AAA', 'Google Drive sibling in same parents[0] folder must inherit cover');
    assert.equal(gOther.cover, null, 'Google Drive track in different folder must NOT inherit cover');
    assert.equal(ms2.cover, 'data:image/jpeg;base64,BBB', 'OneDrive sibling sharing remotePath directory must inherit cover');
    assert.equal(msParent2.cover, 'data:image/jpeg;base64,CCC', 'OneDrive sibling sharing remoteParentId must inherit cover');
    assert.equal(locB.cover, null, 'Unrelated local blob track without path must NOT inherit cover from another local blob track');

    // pruneRemovedLocalFolderTracks cover blob revocation + pruneOrphanedAlbumCovers/pruneExcessObjectUrls calls
    const pruneSrc = sliceBetween(
      html,
      'function pruneRemovedLocalFolderTracks(folderRootKey, seenFolderTrackKeys) {',
      'async function refreshModifiedLocalTrack('
    );
    const revoked = [];
    let orphanedCalls = 0;
    let excessCalls = 0;
    const pSandbox = {
      state: {
        currentId: 'keep-1',
        objectUrls: new Set(['blob:audio-del', 'blob:cover-del', 'blob:cover-shared']),
        tracks: [
          { id: 'keep-1', source: 'local', localFolderKey: 'dir:a', relativePath: 'A/1.flac', size: 10, url: 'blob:keep', cover: 'blob:cover-shared' },
          { id: 'del-shared-cov', source: 'local', localFolderKey: 'dir:a', relativePath: 'A/2.flac', size: 20, url: 'blob:audio-del', cover: 'blob:cover-shared' },
          { id: 'del-unique-cov', source: 'local', localFolderKey: 'dir:a', relativePath: 'A/3.flac', size: 30, url: '', cover: 'blob:cover-del' }
        ]
      },
      URL: { revokeObjectURL: u => revoked.push(u) },
      pruneOrphanedAlbumCovers: () => { orphanedCalls++; },
      pruneExcessObjectUrls: () => { excessCalls++; }
    };
    vm.createContext(pSandbox);
    vm.runInContext(pruneSrc + '\nthis.pruneRemovedLocalFolderTracks = pruneRemovedLocalFolderTracks;', pSandbox);

    const removed = pSandbox.pruneRemovedLocalFolderTracks('dir:a', new Set(['A/1.flac-10']));
    assert.equal(removed, 2);
    assert.ok(revoked.includes('blob:audio-del'), 'Removed track audio blob must be revoked');
    assert.ok(revoked.includes('blob:cover-del'), 'Unreferenced removed track cover blob must be revoked');
    assert.ok(!revoked.includes('blob:cover-shared'), 'Cover blob still referenced by kept track must NOT be revoked');
    assert.equal(pSandbox.state.objectUrls.has('blob:cover-del'), false);
    assert.equal(pSandbox.state.objectUrls.has('blob:cover-shared'), true);
    assert.equal(orphanedCalls, 1, 'pruneOrphanedAlbumCovers must be called after removing local folder tracks');
    assert.equal(excessCalls, 1, 'pruneExcessObjectUrls must be called after removing local folder tracks');
  });

  it('4. Version markers across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at v3.9.95+ (versionCode >= 149)', () => {
    const semverTuple = s => String(s || '').split('.').map(n => parseInt(n, 10) || 0);
    const geq = (a, b) => {
      const va = semverTuple(a);
      const vb = semverTuple(b);
      for (let i = 0; i < 3; i++) {
        if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) > (vb[i] || 0);
      }
      return true;
    };
    const mHtml = html.match(/FiiO M11S · v(\d+\.\d+\.\d+)/);
    const mSwVer = sw.match(/const CACHE_VERSION = 'v(\d+\.\d+\.\d+)'/);
    const mSwName = sw.match(/const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)'/);
    const mGCode = gradle.match(/versionCode = (\d+)\b/);
    const mGName = gradle.match(/versionName = "(\d+\.\d+\.\d+)"/);
    const mRel = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRel, 'All version markers must exist');
    const ver = mHtml[1];
    assert.equal(mSwVer[1], ver);
    assert.equal(mSwName[1], ver);
    assert.equal(mGName[1], ver);
    assert.equal(mRel[1], ver);
    assert.equal(geq(ver, '3.9.95'), true, `Expected version ${ver} >= 3.9.95`);
    assert.ok(parseInt(mGCode[1], 10) >= 149, `Expected versionCode ${mGCode[1]} >= 149`);
    assert.doesNotThrow(() => new vm.Script(releaseScript));
  });
});
