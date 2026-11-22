'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
const releaseScript = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, 'Missing start marker: ' + startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, 'Missing end marker: ' + endMarker);
  return src.slice(s, e);
}

describe('v3.9.91 — Cloud Disconnect UI, FiiO DAC Reconnect Telemetry & Web Multi-Folder LRC/Cover Parity', () => {
  it('1. disconnectCloudSource clears tokens, scheduler, IndexedDB and UI state for ONLY the targeted Cloud source', async () => {
    assert.match(html, /id="google-disconnect"/, 'Settings modal should expose #google-disconnect button');
    assert.match(html, /id="microsoft-disconnect"/, 'Settings modal should expose #microsoft-disconnect button');
    assert.match(html, /safeOn\(\$\('google-disconnect'\),\s*'click'/, 'Google disconnect click handler should be wired');
    assert.match(html, /safeOn\(\$\('microsoft-disconnect'\),\s*'click'/, 'Microsoft disconnect click handler should be wired');

    const fnSlice = extractSlice(
      html,
      'async function clearCloudSourceCatalog(source)',
      "const RECENT_TRACKS_KEY = 'nocturne-recent-tracks';"
    );

    const lsMap = new Map([
      ['nocturne-google-token', 'g-tok-123'],
      ['nocturne-google-token-expires', '9999999999'],
      ['nocturne-google-sync-checkpoint', '{"page":2}'],
      ['nocturne-google-delta-token', 'delta-g-1'],
      ['nocturne-microsoft-token', 'ms-tok-456'],
      ['nocturne-microsoft-token-expires', '8888888888'],
      ['nocturne-microsoft-sync-checkpoint', '{"page":1}'],
      ['nocturne-microsoft-delta-link', 'delta-ms-2']
    ]);
    const domMap = {
      'google-token-direct': { value: 'g-tok-123' },
      'google-state': { textContent: 'Đã kết nối' },
      'microsoft-token-direct': { value: 'ms-tok-456' },
      'microsoft-state': { textContent: 'Đã kết nối' },
      'cloud-status': { textContent: 'Google Drive / OneDrive · sẵn sàng' }
    };
    const deletedCatalogIds = [];
    const deletedSliceKeys = [];
    let schedulerCanceled = false;
    let syncUiCalls = 0;

    const sandbox = {
      window: {},
      Set,
      Map,
      String,
      Array,
      Boolean,
      checkedGoogleArtParents: new Set(['p1']),
      localStorage: {
        getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
        setItem: (k, v) => lsMap.set(k, String(v)),
        removeItem: k => lsMap.delete(k)
      },
      googleOAuthRefreshScheduler: {
        cancel: () => { schedulerCanceled = true; }
      },
      $: id => domMap[id] || null,
      state: {
        tracks: [
          { id: 'g1', source: 'google', remoteId: 'gr1', cover: 'cov-g' },
          { id: 'ms1', source: 'onedrive', remoteId: 'mr1', cover: 'cov-ms' },
          { id: 'loc1', source: 'local', title: 'Local Song', cover: 'cov-loc' }
        ],
        queueTrackIds: ['g1', 'ms1', 'loc1'],
        currentId: 'g1',
        preloadTrackId: 'g1',
        googleToken: 'g-tok-123',
        googleExpiresAt: 9999999999,
        microsoftAccessToken: 'ms-tok-456',
        microsoftExpiresAt: 8888888888,
        msAccount: { username: 'user@example.com' }
      },
      audio: { paused: false, pause: () => { sandbox.audio.paused = true; } },
      clearCloudSyncCheckpoint: k => lsMap.delete(k),
      writeCloudDeltaCursor: (k, v) => lsMap.set(k, v),
      clearStalePreload: () => { sandbox.state.preloadTrackId = null; },
      invalidateCloudTrackContent: () => {},
      pruneOrphanedAlbumCovers: () => {},
      renderTracks: () => {},
      renderQueue: () => {},
      syncPlaybackButtonsUi: () => { syncUiCalls++; },
      catalogTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        return {
          transaction: tx,
          delete: id => {
            deletedCatalogIds.push(id);
            queueMicrotask(() => tx.oncomplete && tx.oncomplete());
          }
        };
      },
      sliceCacheTransaction: () => {
        const tx = { oncomplete: null, onerror: null };
        return {
          transaction: tx,
          getAllKeys: () => {
            const req = { result: ['google:gr1:0', 'onedrive:mr1:0'], onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess && req.onsuccess());
            return req;
          },
          delete: k => {
            deletedSliceKeys.push(k);
            queueMicrotask(() => tx.oncomplete && tx.oncomplete());
          }
        };
      }
    };
    vm.runInNewContext(fnSlice, sandbox);

    const gRes = await sandbox.window.disconnectCloudSource('google');
    assert.equal(gRes.source, 'google');
    assert.equal(gRes.removedCount, 1);
    assert.equal(schedulerCanceled, true);
    assert.equal(sandbox.state.googleToken, null);
    assert.equal(sandbox.state.currentId, null);
    assert.equal(syncUiCalls, 1);
    assert.equal(lsMap.has('nocturne-google-token'), false);
    assert.equal(lsMap.has('nocturne-google-token-expires'), false);
    assert.equal(domMap['google-token-direct'].value, '');
    assert.equal(domMap['google-state'].textContent, 'Chưa kết nối');
    assert.equal(domMap['cloud-status'].textContent, 'OneDrive · sẵn sàng');
    assert.deepEqual(sandbox.state.tracks.map(t => t.id), ['ms1', 'loc1']);
    assert.deepEqual(sandbox.state.queueTrackIds, ['ms1', 'loc1']);
    assert.deepEqual(deletedCatalogIds, ['g1']);
    assert.deepEqual(deletedSliceKeys, ['google:gr1:0']);
    assert.equal(sandbox.state.microsoftAccessToken, 'ms-tok-456', 'OneDrive token must stay intact when disconnecting Google');

    const msRes = await sandbox.window.disconnectCloudSource('microsoft');
    assert.equal(msRes.source, 'onedrive');
    assert.equal(msRes.removedCount, 1);
    assert.equal(sandbox.state.microsoftAccessToken, null);
    assert.equal(sandbox.state.msAccount, null);
    assert.equal(domMap['microsoft-state'].textContent, 'Chưa kết nối');
    assert.equal(domMap['cloud-status'].textContent, 'Chưa kết nối');
    assert.deepEqual(sandbox.state.tracks.map(t => t.id), ['loc1']);
  });

  it('2. DAC reconnect telemetry updates HUD even while paused, clears bitPerfectLockedFormat on disable, and uses getRoutedDevice in Java', () => {
    assert.match(
      mainJava,
      /reportedDevice\s*=\s*built\.getRoutedDevice\(\);[\s\S]*notifyBitPerfectFormatToWeb\(sampleRate,\s*pcmEncoding,\s*mPreferredMixerAttributesSet,\s*reportedDevice\)/,
      'MainActivity.java should resolve built.getRoutedDevice() when targetDevice is null'
    );

    const bpStopSlice = extractSlice(
      html,
      'if (state.isNativeBitPerfectPlaying) {',
      'if (typeof syncPlaybackButtonsUi'
    );
    assert.ok(bpStopSlice.includes('state.bitPerfectLockedFormat = null;'), 'applyBitPerfectMode(false) should reset state.bitPerfectLockedFormat');

    const fnSlice = extractSlice(
      html,
      '// v2.5.0 Bit-Perfect Telemetry & Native Format Lock Bridge',
      "const speedBtnEl = $('speed-btn');"
    );
    const els = {
      'bitperfect-mode-badge': { textContent: '', title: '' },
      'quality-badge': { textContent: '' },
      'mobile-quality': { textContent: '' },
      'room-quality': { textContent: '' },
      'fs-room-quality-badge': { textContent: '' }
    };
    const sandbox = {
      window: {},
      $: id => els[id] || null,
      state: {
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: true,
        currentId: 't-dac',
        tracks: [{ id: 't-dac', sampleRate: 0, bitDepth: 0 }]
      },
      renderRoomSignal: () => {},
      updateMiniPlayerHud: () => {}
    };
    vm.runInNewContext(fnSlice, sandbox);

    sandbox.window.onBitPerfectFormatLocked(192000, 24, true, 'FiiO KA17');
    assert.match(els['bitperfect-mode-badge'].textContent, /192kHz/);
    assert.equal(els['bitperfect-mode-badge'].title, 'Output: FiiO KA17');
    assert.equal(els['quality-badge'].textContent, '⚡ BIT-PERFECT LOCKED · 192 kHz / 24-bit');
    assert.equal(els['fs-room-quality-badge'].textContent, '⚡ BIT-PERFECT LOCKED · 192 kHz / 24-bit');
    assert.equal(sandbox.state.tracks[0].sampleRate, 192000);
    assert.equal(sandbox.state.tracks[0].bitDepth, 24);
  });

  it('3. Multi-folder lookupLocalFolderCover handles Unicode NFC/NFD & case mismatch, and addLocalFiles falls back to findLocalCueLrcFile', () => {
    const addLocalSlice = extractSlice(
      html,
      'async function addLocalFiles(files)',
      'function pruneRemovedLocalFolderTracks('
    );
    assert.ok(addLocalSlice.includes('findLocalCueLrcFile(lrcByBase, normDir,'), 'addLocalFiles worker loop should fall back to findLocalCueLrcFile');

    const fnSlice = extractSlice(
      html,
      'function lookupLocalFolderCover(folderCoverByDir, dir) {',
      'function pruneRemovedLocalFolderTracks('
    );
    const sandbox = {
      library: {},
      normalizeCueNfc: s => String(s || '').normalize('NFC')
    };
    vm.runInNewContext(fnSlice, sandbox);

    const nfdKey = 'Album/Đoàn Chuẩn - Tình Nghệ Sĩ'.normalize('NFD');
    const nfcLookup = 'album/đoàn chuẩn - tình nghệ sĩ'.normalize('NFC');
    const multiMap = new Map([
      [nfdKey, 'blob:cover-vn'],
      ['Album/Disc 2', 'blob:cover-2']
    ]);
    assert.equal(sandbox.lookupLocalFolderCover(multiMap, nfcLookup), 'blob:cover-vn');
  });

  it('4. Version alignment and publish-release.cjs syntax are valid for v3.9.91 (versionCode 145)', () => {
    assert.match(html, /FiiO M11S · v3\.9\.91/);
    assert.match(sw, /const CACHE_VERSION = 'v3\.9\.91'/);
    assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.91'/);
    assert.match(gradle, /versionCode = 145\b/);
    assert.match(gradle, /versionName = "3\.9\.91"/);
    assert.match(releaseScript, /process\.argv\[2\] \|\| 'v3\.9\.91'/);
    assert.doesNotThrow(() => new vm.Script(releaseScript));
  });
});
