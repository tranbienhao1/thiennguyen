'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const javaSrc = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

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

test('v3.9.85: BitPerfectAudioPlayer preserves literal + and % in /local-media query params via extractLocalMediaQueryParam', () => {
  const loopIdx = javaSrc.indexOf('private void runPlaybackLoop(');
  assert.notEqual(loopIdx, -1);
  const block = javaSrc.slice(loopIdx, loopIdx + 1600);
  assert.ok(block.includes('extractLocalMediaQueryParam(parsedLocal, "uri")'), 'BitPerfectAudioPlayer must use extractLocalMediaQueryParam for uri');
  assert.ok(block.includes('extractLocalMediaQueryParam(parsedLocal, "path")'), 'BitPerfectAudioPlayer must use extractLocalMediaQueryParam for path');
});

test('v3.9.85: resetCloudMetadataRetryForSource clears 60m cooldown on re-auth without touching finished or other-provider tracks', () => {
  const fnSrc = extractFn(html, 'function resetCloudMetadataRetryForSource(source)');
  const tracks = [
    { id: 'g1', source: 'google', metadataLoaded: false, cover: '', metadataRetryAt: Date.now() + 3600000, thumbnailRetryAt: Date.now() + 3600000, _metaRateLimitRetries: 3 },
    { id: 'g2', source: 'google', metadataLoaded: true, cover: 'data:image/jpeg;base64,abc', metadataRetryAt: 12345 },
    { id: 'm1', source: 'onedrive', metadataLoaded: false, cover: '', metadataRetryAt: Date.now() + 3600000 }
  ];
  const sandbox = { cloudMetadataPausedUntil: Date.now() + 60000, state: { tracks } };
  vm.runInNewContext(fnSrc, sandbox);
  const count = sandbox.resetCloudMetadataRetryForSource('google');
  assert.equal(count, 1);
  assert.equal(sandbox.cloudMetadataPausedUntil, 0);
  assert.equal(tracks[0].metadataRetryAt, 0);
  assert.equal(tracks[0].thumbnailRetryAt, 0);
  assert.equal(tracks[0]._metaRateLimitRetries, 0);
  assert.equal(tracks[1].metadataRetryAt, 12345, 'Finished track untouched');
  assert.ok(tracks[2].metadataRetryAt > 0, 'Other provider untouched');

  assert.ok(html.includes("resetCloudMetadataRetryForSource('google')"));
  assert.ok(html.includes("resetCloudMetadataRetryForSource('onedrive')"));
});

test('v3.9.85: Web and Android CUE sheet matchers normalize NFC/NFD Unicode paths cleanly', () => {
  assert.ok(html.includes('const normalizeCueNfc = s =>'), 'Web addLocalFiles CUE matcher must normalize NFC');
  assert.ok(html.includes('const normNfc = v =>'), 'Android expandFiioScannedCueSheets must normalize NFC');
});

test('v3.9.85: Version bump parity across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.85';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.85';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30985);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 139);
  assert.ok(gradle.includes('versionName = "3.9.85"'));
});
