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

describe('v3.9.93 — Bit-Perfect AVRCP Fallback Sync, Multi-Track Slice Pinning & BOM-less UTF-16 CUE Decoding', () => {
  it('1. MainActivity.java syncs MediaSession position before error fallback and web onNativeBitPerfectError clears locked telemetry', () => {
    assert.match(
      mainJava,
      /runOnUiThread\(\(\) -> updateMediaSessionPosition\(errPosMs,\s*errDurMs,\s*false\)\);\s*notifyBitPerfectErrorToWeb\(pendingErrorReason\);/,
      'MainActivity.java should sync paused AVRCP position before notifying web error fallback'
    );

    const errSlice = extractSlice(
      html,
      'window.onNativeBitPerfectError = (reason, nativePosMs) => {',
      'window.onBitPerfectPlaybackComplete ='
    );
    let posUpdated = false;
    const sandbox = {
      window: {},
      console,
      Date,
      Number,
      Boolean,
      Math,
      String,
      state: {
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: true,
        lastBitPerfectPositionSec: 42.5,
        bitPerfectLockedFormat: { sampleRate: 192000, bitDepth: 24 },
        currentId: 't-hi',
        tracks: [{ id: 't-hi', title: 'Hi-Res Track' }]
      },
      audio: { paused: true },
      syncPlaybackButtonsUi: () => {},
      updatePositionState: () => { posUpdated = true; },
      toast: () => {}
    };
    vm.runInNewContext(errSlice, sandbox);
    sandbox.window.onNativeBitPerfectError('DAC removed', 42500);
    assert.equal(sandbox.state.bitPerfectLockedFormat, null);
    assert.equal(posUpdated, true);
    assert.equal(sandbox.state.tracks[0]._resumeAfterBpFallbackSec, 42.5);
  });

  it('2. pruneSliceCache pins current, preload, bpCloudPreload, and queue head tracks against LRU eviction', () => {
    const pruneSlice = extractSlice(
      html,
      'function pruneSliceCache() {',
      '// Pha C — cache lát đầu DSD:'
    );
    let capturedPinned = null;
    const deletedKeys = [];
    const sandbox = {
      Set,
      Array,
      Math,
      Number,
      Boolean,
      String,
      IS_LEGACY_ANDROID: false,
      bpCloudPreloadTrackId: 'bp-next',
      state: {
        currentId: 'cur-1',
        preloadTrackId: 'pre-2',
        queueTrackIds: ['q-head', 'q-2'],
        fiioDapMode: false,
        tracks: [
          { id: 'cur-1', source: 'google', remoteId: 'r-cur' },
          { id: 'pre-2', source: 'onedrive', remoteId: 'r-pre' },
          { id: 'bp-next', source: 'google', remoteId: 'r-bp' },
          { id: 'q-head', source: 'onedrive', remoteId: 'r-q' }
        ]
      },
      library: {
        FIRST_SLICE_CACHE_MAX_ENTRIES: 20,
        FIRST_SLICE_CACHE_MAX_BYTES: 20 * 1024 * 1024,
        historyTrackKey: t => (t ? `${t.source}:${t.remoteId}` : ''),
        calculateAdaptiveCacheLimits: () => ({ maxEntries: 4, maxBytes: 10 * 1024 * 1024 }),
        computeLruCacheEviction: (_entries, _maxE, _maxB, opts) => {
          capturedPinned = opts && opts.pinnedKeys ? opts.pinnedKeys.slice() : [];
          return { keysToEvict: ['google:r-old'] };
        }
      },
      sliceCacheTransaction: () => ({
        getAll: () => {
          const req = { result: [{ key: 'google:r-cur' }, { key: 'google:r-old' }], onsuccess: null, onerror: null };
          setImmediate(() => req.onsuccess && req.onsuccess());
          return req;
        },
        delete: k => deletedKeys.push(k)
      }),
      syncEvictedSliceFlags: () => {}
    };
    vm.runInNewContext(pruneSlice, sandbox);
    sandbox.pruneSliceCache();
    return new Promise(resolve => setImmediate(() => {
      assert.deepEqual(capturedPinned.sort(), ['google:r-bp', 'google:r-cur', 'onedrive:r-pre', 'onedrive:r-q']);
      assert.deepEqual(deletedKeys, ['google:r-old']);
      resolve();
    }));
  });

  it('3. decodeTextBytesAuto accurately decodes UTF-8 BOM, BOM-less UTF-16LE, BOM-less UTF-16BE, and standard UTF-8 CUE/LRC text', () => {
    const fnSlice = extractSlice(
      html,
      'function decodeTextBytesAuto(rawBuf) {',
      'function readLocalTextFileAuto('
    );
    const sandbox = {
      Uint8Array,
      TextDecoder,
      String,
      Math
    };
    vm.runInNewContext(fnSlice, sandbox);

    const sampleCue = 'TITLE "Hi-Res Album"\nTRACK 01 AUDIO\nINDEX 01 00:00:00';
    // BOM-less UTF-16LE
    const leBytes = new Uint8Array(sampleCue.length * 2);
    const beBytes = new Uint8Array(sampleCue.length * 2);
    for (let i = 0; i < sampleCue.length; i++) {
      const code = sampleCue.charCodeAt(i);
      leBytes[i * 2] = code & 0xFF;
      leBytes[i * 2 + 1] = (code >> 8) & 0xFF;
      beBytes[i * 2] = (code >> 8) & 0xFF;
      beBytes[i * 2 + 1] = code & 0xFF;
    }
    assert.equal(sandbox.decodeTextBytesAuto(leBytes), sampleCue);
    assert.equal(sandbox.decodeTextBytesAuto(beBytes), sampleCue);

    // UTF-8 BOM
    const utf8Text = 'TITLE "Tình Khúc"\nTRACK 01 AUDIO';
    const utf8Bytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(utf8Text, 'utf8')]);
    assert.equal(sandbox.decodeTextBytesAuto(new Uint8Array(utf8Bytes)), utf8Text);
    assert.equal(sandbox.decodeTextBytesAuto(new Uint8Array(Buffer.from(utf8Text, 'utf8'))), utf8Text);

    const miniSlice = extractSlice(html, 'function toggleMiniPlayerHud(show) {', 'function updateMiniPlayerHud(');
    assert.ok(miniSlice.includes('hud.hidden = isHidden;') && miniSlice.includes("hud.removeAttribute('hidden')"), 'toggleMiniPlayerHud should synchronously clear/set native [hidden]');
  });

  it('4. Version alignment and publish-release.cjs syntax are valid for v3.9.93+ (versionCode >= 147)', () => {
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
    assert.equal(geq(ver, '3.9.93'), true, `Expected version ${ver} >= 3.9.93`);
    assert.ok(parseInt(mGCode[1], 10) >= 147, `Expected versionCode ${mGCode[1]} >= 147`);
    assert.doesNotThrow(() => new vm.Script(releaseScript));
  });
});
