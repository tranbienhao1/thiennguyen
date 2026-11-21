'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. applySmartSeekTime uses full track duration on truncated first slices and auto-retries failed Cloud upgrades on far seek', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fnStart = html.indexOf('function applySmartSeekTime(curAudio, curTrack, targetSec)');
  const fnEnd = html.indexOf("$('room-seek').addEventListener('change'", fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart);

  const toasts = [];
  let retryCalls = 0;

  const sandbox = {
    Number,
    Math,
    toast: (m) => toasts.push(m),
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
    retryPendingCurrentSliceUpgrade: async () => { retryCalls++; return true; }
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(fnStart, fnEnd) + '\nthis.applySmartSeekTime = applySmartSeekTime;', sandbox);

  // 1.1 Truncated slice audio.duration (15.2s) vs real track.duration (420s): seeking to 240s must NOT clamp to 15.2s
  const truncatedAudio = { currentTime: 4, duration: 15.2, buffered: { length: 1, end: () => 15.2 } };
  const activeUpgradeTrack = { firstSlicePlayback: true, duration: 420, fullAudioPromise: Promise.resolve('blob:full') };
  const ok1 = sandbox.applySmartSeekTime(truncatedAudio, activeUpgradeTrack, 240);
  assert.equal(ok1, false);
  assert.equal(truncatedAudio.currentTime, 4);
  assert.equal(activeUpgradeTrack._pendingSeekAfterFullUpgrade, 240, 'Far seek on truncated slice must preserve full targetSec (240s), not clamp to 15.2s');

  // 1.2 Failed background upgrade (_pendingSliceUpgrade set, fullAudioPromise=null): far seek auto-retries full download
  const failedUpgradeTrack = {
    firstSlicePlayback: true,
    duration: 360,
    fullAudioPromise: null,
    _pendingSliceUpgrade: { sliceUrl: 'blob:slice', url: 'https://cloud/full' }
  };
  const ok2 = sandbox.applySmartSeekTime(truncatedAudio, failedUpgradeTrack, 180);
  assert.equal(ok2, false);
  assert.equal(failedUpgradeTrack._pendingSeekAfterFullUpgrade, 180);
  assert.equal(retryCalls, 1, 'Seeking past first slice after failed upgrade must trigger retryPendingCurrentSliceUpgrade()');

  // 1.3 room-seek & resumeFullAudioFromSlice wiring
  const roomSeekSrc = html.slice(fnEnd, fnEnd + 1600);
  assert.ok(roomSeekSrc.includes('ratio * (dur > 0 ? dur : audio.duration)'), 'room-seek must use real track dur instead of truncated slice audio.duration');
  const resumeStart = html.indexOf('function resumeFullAudioFromSlice(track, position) {');
  const resumeSrc = html.slice(resumeStart, resumeStart + 2600);
  assert.ok(resumeSrc.includes('updatePositionState(true)'), 'resumeFullAudioFromSlice must sync MediaSession position state after full upgrade');
});

test('2. readAudioMetadata parses WAV duration + LIST/INFO tags and AIFF 80-bit COMM metadata, and MainActivity supports 12MB FLAC covers & SYNCEDLYRICS', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const metaStart = html.indexOf('function readAudioMetadata(file) {');
  const metaEnd = html.indexOf('function getTags(file) {', metaStart);
  assert.ok(metaStart > 0 && metaEnd > metaStart);

  class MockFileReader {
    readAsArrayBuffer(blob) {
      this.result = blob._buf;
      if (typeof this.onload === 'function') this.onload();
    }
  }

  const sandbox = {
    Promise, DataView, Uint8Array, TextDecoder, String, Number, BigInt, Math,
    FileReader: MockFileReader,
    setTimeout, clearTimeout, console,
    library: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(metaStart, metaEnd) + '\nthis.readAudioMetadata = readAudioMetadata;', sandbox);

  // 2.1 Build valid WAV (96kHz, 24-bit, 2ch, 10s data = 5,760,000 bytes, plus LIST/INFO tags)
  const writeStr = (arr, off, s) => { for (let i = 0; i < s.length; i++) arr[off + i] = s.charCodeAt(i); };
  const wavBuf = new ArrayBuffer(256);
  const wavBytes = new Uint8Array(wavBuf);
  const wavView = new DataView(wavBuf);
  writeStr(wavBytes, 0, 'RIFF');
  wavView.setUint32(4, 248, true);
  writeStr(wavBytes, 8, 'WAVE');
  // fmt chunk at 12 (size 16)
  writeStr(wavBytes, 12, 'fmt ');
  wavView.setUint32(16, 16, true);
  wavView.setUint16(20, 1, true); // PCM
  wavView.setUint16(22, 2, true); // channels
  wavView.setUint32(24, 96000, true); // sampleRate
  wavView.setUint32(28, 96000 * 6, true); // byteRate = 576000 B/s
  wavView.setUint16(32, 6, true); // blockAlign
  wavView.setUint16(34, 24, true); // bitDepth
  // LIST/INFO chunk at 36
  // INAM "Autumn" (6+1=7 -> pad to 8) + IART "Evans" (5+1=6) + IPRD "Waltz" (5+1=6) + ITRK "03" (2+1=3 -> pad to 4)
  writeStr(wavBytes, 36, 'LIST');
  const listSize = 4 + (8 + 8) + (8 + 6) + (8 + 6) + (8 + 4);
  wavView.setUint32(40, listSize, true);
  writeStr(wavBytes, 44, 'INFO');
  let p = 48;
  writeStr(wavBytes, p, 'INAM'); wavView.setUint32(p + 4, 7, true); writeStr(wavBytes, p + 8, 'Autumn\0'); p += 16;
  writeStr(wavBytes, p, 'IART'); wavView.setUint32(p + 4, 6, true); writeStr(wavBytes, p + 8, 'Evans\0'); p += 14;
  writeStr(wavBytes, p, 'IPRD'); wavView.setUint32(p + 4, 6, true); writeStr(wavBytes, p + 8, 'Waltz\0'); p += 14;
  writeStr(wavBytes, p, 'ITRK'); wavView.setUint32(p + 4, 3, true); writeStr(wavBytes, p + 8, '03\0'); p += 12;
  // data chunk right after LIST
  writeStr(wavBytes, p, 'data');
  wavView.setUint32(p + 4, 5760000, true); // 10 seconds

  const wavMeta = await sandbox.readAudioMetadata({ name: 'test.wav', size: 5760200, slice: () => ({ _buf: wavBuf }) });
  assert.equal(wavMeta.sampleRate, 96000);
  assert.equal(wavMeta.bitDepth, 24);
  assert.equal(wavMeta.channels, 2);
  assert.equal(wavMeta.duration, 10);
  assert.equal(wavMeta.title, 'Autumn');
  assert.equal(wavMeta.artist, 'Evans');
  assert.equal(wavMeta.album, 'Waltz');
  assert.equal(wavMeta.track, '03');

  // 2.2 Build valid AIFF (44100 Hz = 80-bit extended 0x400E 0xAC440000 0x00000000, 16-bit, 2ch, 441000 frames = 10s)
  const aiffBuf = new ArrayBuffer(64);
  const aiffBytes = new Uint8Array(aiffBuf);
  const aiffView = new DataView(aiffBuf);
  writeStr(aiffBytes, 0, 'FORM');
  aiffView.setUint32(4, 56, false);
  writeStr(aiffBytes, 8, 'AIFF');
  writeStr(aiffBytes, 12, 'COMM');
  aiffView.setUint32(16, 18, false);
  aiffView.setUint16(20, 2, false); // channels
  aiffView.setUint32(22, 441000, false); // numSampleFrames = 10s at 44.1kHz
  aiffView.setUint16(26, 16, false); // bitDepth
  aiffView.setUint16(28, 0x400e, false); // exponent for 44100
  aiffView.setUint32(30, 0xac440000, false); // mantissa hi
  aiffView.setUint32(34, 0, false); // mantissa lo

  const aiffMeta = await sandbox.readAudioMetadata({ name: 'test.aiff', size: 1764064, slice: () => ({ _buf: aiffBuf }) });
  assert.equal(aiffMeta.sampleRate, 44100);
  assert.equal(aiffMeta.bitDepth, 16);
  assert.equal(aiffMeta.channels, 2);
  assert.equal(aiffMeta.duration, 10);

  // 2.3 MainActivity.java FLAC 12MB picture cap + SYNCEDLYRICS + BOM strip
  const javaSrc = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');
  assert.ok(javaSrc.includes('blockLen <= 12 * 1024 * 1024'), 'extractFlacPictureFromStream must support up to 12MB Hi-Res FLAC pictures');
  assert.ok(javaSrc.includes('"SYNCEDLYRICS".equals(key)'), 'extractFlacVorbisLyricsFromFile must recognize SYNCEDLYRICS');
  assert.ok(javaSrc.includes('.replace("\\uFEFF", "")'), 'extractFlacVorbisLyricsFromFile must strip UTF-8 BOM');
});

test('3. clearCloudCatalog purges Cloud firstSliceCache entries, checkedGoogleArtParents & orphaned Cloud albumCovers + v3.9.70 alignment', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function purgeCloudSliceCacheAndOrphanedCovers() {');
  const end = html.indexOf('function restoreCloudCatalog()', start);
  assert.ok(start > 0 && end > start);

  const deletedSlices = [];
  let catalogCleared = false;
  let coversSaved = 0;
  const clearedCheckpoints = [];
  const clearedDeltas = [];

  const sandbox = {
    Array, Set, Map, String, Promise, Error,
    checkedGoogleArtParents: new Set(['parent-1', 'parent-2']),
    library: {
      buildAlbumKey: (t) => (t && t.album ? t.album.toLowerCase() : '')
    },
    state: {
      tracks: [
        { id: 'local_1', source: 'local', album: 'Local Album' },
        { id: 'google_1', source: 'google', album: 'Cloud Album' }
      ],
      albumCovers: new Map([
        ['local album', 'blob:local-art'],
        ['cloud album', 'data:image/jpeg;base64,CLOUD_ART']
      ]),
      lyricsPreloadLifecycle: { cancelAll() {} }
    },
    saveAlbumCoversCache: () => { coversSaved++; },
    clearCloudSyncCheckpoint: (k) => clearedCheckpoints.push(k),
    writeCloudDeltaCursor: (k, v) => clearedDeltas.push([k, v]),
    sliceCacheTransaction: () => {
      const tx = { oncomplete: null, onerror: null };
      return {
        transaction: tx,
        getAllKeys: () => {
          const req = { result: ['google:1', 'onedrive:2', 'local:3'], onsuccess: null, onerror: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess();
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return req;
        },
        delete: (k) => deletedSlices.push(k)
      };
    },
    catalogTransaction: () => {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      return {
        transaction: tx,
        clear: () => {
          catalogCleared = true;
          setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        }
      };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(start, end) + '\nthis.purgeCloudSliceCacheAndOrphanedCovers = purgeCloudSliceCacheAndOrphanedCovers; this.clearCloudCatalog = clearCloudCatalog;',
    sandbox
  );

  await sandbox.clearCloudCatalog();
  assert.equal(catalogCleared, true, 'Cloud catalog store must be cleared');
  assert.deepEqual(deletedSlices, ['google:1', 'onedrive:2'], 'Only google:* and onedrive:* slice cache entries must be purged (preserving local:*)');
  assert.equal(sandbox.checkedGoogleArtParents.size, 0, 'checkedGoogleArtParents must be cleared on Cloud reset');
  assert.equal(sandbox.state.albumCovers.has('local album'), true, 'Local album cover must be preserved');
  assert.equal(sandbox.state.albumCovers.has('cloud album'), false, 'Orphaned Cloud album cover must be pruned');
  assert.equal(coversSaved, 1, 'saveAlbumCoversCache must persist pruned albumCovers');
  assert.equal(clearedCheckpoints.length, 2);
  assert.equal(clearedDeltas.length, 2);

  // Version alignment v3.9.70+ / versionCode >= 124
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.70';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.70';"));
  assert.ok(gradle.includes('versionCode = 124'));
  assert.ok(gradle.includes('versionName = "3.9.70"'));
  assert.ok(/FiiO M11S · v3\.9\.(?:7\d|[89]\d|\d{3,})/.test(html));
});
