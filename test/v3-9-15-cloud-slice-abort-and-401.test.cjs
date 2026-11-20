'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const LIB_UTILS = path.join(ROOT, 'library-utils.js');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

const library = require(LIB_UTILS);

test('1. library.fetchAudioBlob stops immediately on AbortError without 3x retry loop', async () => {
  const origFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = (url, opts) => new Promise((resolve, reject) => {
      calls++;
      if (opts && opts.signal && opts.signal.aborted) {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        return reject(e);
      }
      const onAbort = () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (opts && opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    });

    const ac = new AbortController();
    const p = library.fetchAudioBlob('https://example.com/big.flac', { signal: ac.signal }, 'Google Drive');
    ac.abort();
    await assert.rejects(p, (err) => err && err.name === 'AbortError' && err.aborted === true);
    assert.equal(calls, 1, 'Aborted fetch must NOT retry 3 times');
  } finally {
    global.fetch = origFetch;
  }
});

test('2. upgradeSliceToFullAudio wires AbortController, drops skipped blobs, and playTrack/releaseUnusedCloudUrl cancel stale upgrades', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  assert.ok(html.includes('function abortStaleFullAudioUpgrades(keepTrackIds)'), 'Must define abortStaleFullAudioUpgrades');
  assert.ok(html.includes('abortStaleFullAudioUpgrades([track.id, state.preloadTrackId]);'), 'playTrack must abort stale full-audio downloads');
  assert.ok(html.includes('track._fullUpgradeAbort = upgradeController;'), 'upgradeSliceToFullAudio must store AbortController on track');
  assert.ok(html.includes('if (!stillNeeded || (upgradeController && upgradeController.signal.aborted))'), 'upgradeSliceToFullAudio must discard blob if track was skipped before URL.createObjectURL');
  assert.ok(html.includes('if (track._fullUpgradeAbort && track.id !== state.currentId && track.id !== state.preloadTrackId)'), 'releaseUnusedCloudUrl must abort stale upgrade');
});

test('3. fetchCloudTrack retries fetchAudioFirstSlice on Google Drive 401 with ensureGoogleToken(true)', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  assert.ok(
    html.includes('catch (sliceAuthErr)') &&
    html.includes('const refreshedToken = await ensureGoogleToken(true);') &&
    html.includes('firstSlice = await library.fetchAudioFirstSlice(url, {...options, expectedTotalBytes: Number(track.size) || 0}, provider);'),
    'fetchCloudTrack must refresh Google token on 401 and retry first-slice Range fetch'
  );
});

test('4. Version Sync v3.9.15 (versionCode 69), Asset Parity & Web Audio Invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.15';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.15';"));
  assert.ok(gradle.includes('versionCode = 69'));
  assert.ok(gradle.includes('versionName = "3.9.15"'));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.equal(html, assetHtml);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'));
});
