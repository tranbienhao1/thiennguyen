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

test('1. createFiioTrack gives MicroSD tracks a native /local-cover URL; real albums share one cache key', () => {
  const a = library.createFiioTrack({ name: '01 A.flac', path: '/storage/0000-0000/Music/Eagles/01 A.flac', album: 'Hotel California', artist: 'Eagles' });
  const b = library.createFiioTrack({ name: '02 B.flac', path: '/storage/0000-0000/Music/Eagles/02 B.flac', album: 'Hotel California', artist: 'Eagles' });
  assert.ok(a.cover.indexOf('https://appassets.androidplatform.net/local-cover?path=') === 0);
  assert.ok(a.cover.includes('&size=320'));
  const keyOf = url => (url.match(/[&?]key=([^&]+)/) || [])[1];
  assert.ok(keyOf(a.cover), 'tagged album must carry a key');
  assert.equal(keyOf(a.cover), keyOf(b.cover), 'same album => same key => one extraction');
  assert.notEqual(a.cover, b.cover, 'different source files keep distinct URLs');
});

test('2. Untagged / unknown-artist tracks never share a cover key (no wrong art)', () => {
  const untagged = library.createFiioTrack({ name: 'x.flac', path: '/storage/0000-0000/Music/x.flac' });
  const unknownArtist = library.createFiioTrack({ name: 'y.flac', path: '/storage/0000-0000/Music/y.flac', album: 'Greatest Hits' });
  assert.ok(untagged.cover && !/[&?]key=/.test(untagged.cover));
  assert.ok(unknownArtist.cover && !/[&?]key=/.test(unknownArtist.cover));
});

test('3. content:// MediaStore tracks use the uri parameter; size is clamped', () => {
  const t = library.createFiioTrack({ name: 'z.flac', uri: 'content://media/external/audio/media/42', album: 'A', artist: 'B' });
  assert.ok(t.cover.indexOf('local-cover?uri=' + encodeURIComponent('content://media/external/audio/media/42')) > 0);
  assert.ok(library.buildFiioCoverUrl({ path: '/p.flac' }, 9999).endsWith('&size=512'));
  assert.ok(library.buildFiioCoverUrl({ path: '/p.flac' }, 10).endsWith('&size=96'));
  assert.equal(library.buildFiioCoverUrl({}), '');
});

test('4. index.html rebuilds covers for restored FiiO catalog and swaps dead art for a placeholder', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('hydrated.cover = library.buildFiioCoverUrl(hydrated);'));
  const i = html.indexOf('const failedNativeCovers = new Set();');
  assert.ok(i > 0);
  const body = html.slice(i, i + 1200);
  assert.ok(body.includes("window.addEventListener('error'"));
  assert.ok(body.includes("indexOf('/local-cover?') < 0"));
  assert.ok(body.includes('}, true);'), 'must use capture phase (img error does not bubble)');
  assert.ok(body.includes("t.cover = ''"));
});

test('5. MainActivity serves /local-cover: cache, embedded picture, MediaStore thumbnail, folder art, bounded concurrency', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('"/local-cover".equalsIgnoreCase(path)'));
  assert.ok(java.includes('return handleLocalCoverArt(request);'));
  assert.ok(java.includes('getEmbeddedPicture()'));
  assert.ok(java.includes('loadThumbnail(thumbUri'));
  assert.ok(java.includes('"albumart"'));
  assert.ok(java.includes('new java.util.concurrent.Semaphore(2)'));
  assert.ok(java.includes('Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)'));
  assert.ok(java.includes('inSampleSize = computeCoverSampleSize'));
  assert.ok(java.includes('"Cache-Control", "public, max-age=31536000"'));
  assert.ok(java.includes('none.createNewFile()'), 'negative cache marker');
  assert.ok(java.includes('pruneCoverCache(dir)'));
});

test('6. Version sync v3.9.27 (versionCode 81), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'library-utils.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8'));
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'library-utils.js'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.27';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.27';"));
  assert.ok(gradle.includes('versionCode = 81'));
  assert.ok(gradle.includes('versionName = "3.9.27"'));
  assert.ok(/:\s*"3\.9\.27";/.test(java));
  assert.ok(html.includes('FiiO M11S \u00b7 v3.9.27'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});