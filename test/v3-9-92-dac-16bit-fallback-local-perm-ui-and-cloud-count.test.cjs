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

describe('v3.9.92 — DAC 16-bit Speaker Fallback, Local Permission Recovery UI & Cloud Count Telemetry', () => {
  it('1. MainActivity.java provides 16-bit PCM downmix fallback and retries fallbackAttrs on STATE_UNINITIALIZED', () => {
    const helperSlice = extractSlice(
      mainJava,
      'private static int convertPcmChunkTo16Bit(',
      'private void notifyBitPerfectFormatToWeb('
    );
    assert.ok(helperSlice.includes('if (built == null || built.getState() != AudioTrack.STATE_INITIALIZED)'), 'Should retry fallbackAttrs on STATE_UNINITIALIZED');
    assert.ok(helperSlice.includes('rebuildAudioTrackWith16BitFallback('), 'Should define rebuildAudioTrackWith16BitFallback');
    assert.ok(helperSlice.includes('Float.intBitsToFloat(bits)'), 'convertPcmChunkTo16Bit should handle ENCODING_PCM_FLOAT');
    assert.ok(helperSlice.includes('srcEncoding == 21'), 'convertPcmChunkTo16Bit should handle ENCODING_PCM_24BIT_PACKED');
    assert.ok(helperSlice.includes('srcEncoding == 22'), 'convertPcmChunkTo16Bit should handle ENCODING_PCM_32BIT');

    const matches = mainJava.match(/rebuildAudioTrackWith16BitFallback\(/g) || [];
    assert.ok(matches.length >= 4, 'All 3 route/dead-object rebuild paths should call rebuildAudioTrackWith16BitFallback');
  });

  it('2. setReopenFolderWarning highlights/clears reopen buttons and is wired into permission_denied & grant paths', () => {
    assert.ok(html.includes("track._localAccessError === 'permission_denied'") && html.includes('setReopenFolderWarning(true)'), 'playTrack should highlight reopen-folder on permission_denied');
    assert.ok(html.includes('if (reacquiredFile) {') && html.includes('setReopenFolderWarning(false)'), 'ensureLocalTrackPlayableUrl should clear warning on recovery');
    assert.ok(html.includes('if (typeof setReopenFolderWarning === \'function\') setReopenFolderWarning(false);\n        const folderKey ='), 'reopenSavedFolderRecord should clear warning on grant');

    const fnSlice = extractSlice(
      html,
      'function setReopenFolderWarning(active) {',
      'async function loadSavedLocalFolderHandles()'
    );
    const makeEl = () => {
      const classes = new Set();
      const attrs = new Map();
      return {
        classList: {
          toggle: (cls, force) => {
            if (force) classes.add(cls);
            else classes.delete(cls);
          },
          has: cls => classes.has(cls)
        },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: k => attrs.delete(k),
        getAttribute: k => (attrs.has(k) ? attrs.get(k) : null)
      };
    };
    const side = makeEl();
    const empty = makeEl();
    const sandbox = {
      document: {},
      window: { showDirectoryPicker: () => {} },
      savedLocalFolderRecord: { name: 'Music', handle: {} },
      $: id => (id === 'reopen-folder' ? side : id === 'empty-reopen-folder' ? empty : null)
    };
    vm.runInNewContext(fnSlice, sandbox);

    sandbox.setReopenFolderWarning(true);
    assert.equal(side.classList.has('border-amber-400/60'), true);
    assert.equal(side.getAttribute('data-perm-warning'), 'true');
    assert.equal(empty.classList.has('bg-amber-500/15'), true);

    sandbox.setReopenFolderWarning(false);
    assert.equal(side.classList.has('border-amber-400/60'), false);
    assert.equal(side.getAttribute('data-perm-warning'), null);
    assert.equal(empty.classList.has('bg-amber-500/15'), false);
  });

  it('3. countSourceTracks accurately counts per-source Cloud tracks and is wired into delta/shared cloudStatus', () => {
    const fnSlice = extractSlice(
      html,
      'function countSourceTracks(source) {',
      'const MAX_CATALOG_COVER_CHARS'
    );
    const sandbox = {
      state: {
        tracks: [
          { id: 'g1', source: 'google' },
          { id: 'g2', source: 'google' },
          { id: 'ms1', source: 'onedrive' },
          { id: 'loc1', source: 'local' }
        ]
      }
    };
    vm.runInNewContext(fnSlice, sandbox);
    assert.equal(sandbox.countSourceTracks('google'), 2);
    assert.equal(sandbox.countSourceTracks('onedrive'), 1);
    assert.equal(sandbox.countSourceTracks('local'), 1);

    assert.ok(html.includes("countSourceTracks('google')"), 'Google delta sync should use countSourceTracks');
    assert.ok(html.includes("countSourceTracks('onedrive')"), 'OneDrive delta/shared sync should use countSourceTracks');
  });

  it('4. Version alignment and publish-release.cjs syntax are valid for v3.9.92+ (versionCode >= 146)', () => {
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
    assert.equal(geq(ver, '3.9.92'), true, `Expected version ${ver} >= 3.9.92`);
    assert.ok(parseInt(mGCode[1], 10) >= 146, `Expected versionCode ${mGCode[1]} >= 146`);
    assert.doesNotThrow(() => new vm.Script(releaseScript));
  });
});
