'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. buildFiioCoverUrl includes both uri and path when available so MediaStore tracks can fall back to folder.jpg / DSF APIC on MicroSD', () => {
  const track = library.createFiioTrack({
    uri: 'content://media/external/audio/media/901',
    path: '/storage/1234-5678/Music/Eagles/Hotel California/01 - Hotel California.flac',
    name: '01 - Hotel California.flac',
    artist: 'Eagles',
    album: 'Hotel California'
  });
  assert.ok(track.cover.indexOf('https://appassets.androidplatform.net/local-cover?uri=') === 0);
  assert.ok(track.cover.includes('&path=' + encodeURIComponent('/storage/1234-5678/Music/Eagles/Hotel California/01 - Hotel California.flac')));
  assert.ok(track.cover.includes('&key=' + encodeURIComponent('hotel california|eagles')));
});

test('2. MainActivity.extractCoverJpeg resolves both contentUri and file (including resolveFileFromContentUri) and invalidates v1 negative cache via v2k/v2s', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('private File resolveFileFromContentUri(Uri contentUri)'));
  assert.ok(java.includes('if ((file == null || !file.exists()) && contentUri != null) {\n            file = resolveFileFromContentUri(contentUri);\n        }'));
  assert.ok(java.includes('String identity = (keyParam != null && !keyParam.isEmpty()) ? "v2k:" + keyParam : "v2s:" + source;'));
  assert.ok(java.includes('String hash = coverSha1Hex("v2k:" + key + "|320");'));
});

test('3. ingestFiioScannedFilesChunk upgrades existing tracks in-place with MediaStore tags & folder metadata on rescan', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('function ingestFiioScannedFilesChunk(');
  assert.ok(start > 0);
  const body = html.slice(start, start + 2200);
  assert.ok(body.includes('const prevTrack = (normPath && existingByPath.get(normPath)) || (normUri && existingByUri.get(normUri)) || null;'));
  assert.ok(body.includes('library.enrichFiioTrackMetadata(prevTrack);'));
});

test('4. Version sync v3.9.30 (versionCode 84), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'library-utils.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8'));
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.30';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.30';"));
  assert.ok(gradle.includes('versionCode = 84'));
  assert.ok(gradle.includes('versionName = "3.9.30"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S \u00b7 v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
