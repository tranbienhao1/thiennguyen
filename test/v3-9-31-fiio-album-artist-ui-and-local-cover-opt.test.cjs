'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');
const SW_JS = path.join(ROOT_DIR, 'sw.js');
const LIBRARY_UTILS_JS = path.join(ROOT_DIR, 'library-utils.js');
const BUILD_GRADLE = path.join(ROOT_DIR, 'android', 'app', 'build.gradle.kts');
const MAIN_ACTIVITY = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');

const library = require('../library-utils.js');

test('1. resolveTrackCover and instantResolveTrackCover automatically resolve /local-cover for FiiO tracks', () => {
  // Test case A: FiiO MicroSD track with path
  const fiioPathTrack = {
    id: 'fiio_sd_1',
    name: 'Song 1',
    artist: 'Trần Thái Hòa',
    album: 'Cõi Vắng',
    path: '/storage/0000-0000/Music/Tran Thai Hoa/Coi Vang/01. Song 1.flac'
  };
  const coverMap = new Map();
  const resPath = library.resolveTrackCover(fiioPathTrack, coverMap, [fiioPathTrack]);
  assert.ok(resPath && resPath.includes('/local-cover?'), 'FiiO path track must resolve to local-cover URL');
  assert.ok(resPath.includes(encodeURIComponent(fiioPathTrack.path)), 'URL must encode track path');
  assert.strictEqual(fiioPathTrack.cover, resPath, 'Track cover property must be populated in-place');

  // Test case B: FiiO MediaStore track with uri
  const fiioUriTrack = {
    id: 'fiio_ms_1',
    name: 'Song 2',
    artist: 'Như Quỳnh',
    album: 'Người Tình Mùa Đông',
    uri: 'content://media/external/audio/media/12345',
    path: '/storage/emulated/0/Music/Nhu Quynh/02.flac'
  };
  const resInstant = library.instantResolveTrackCover(fiioUriTrack, coverMap, [fiioUriTrack]);
  assert.ok(resInstant && resInstant.includes('/local-cover?'), 'FiiO uri track must resolve instantly');
  assert.ok(resInstant.includes('content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F12345'), 'URL must encode content uri');

  // Test case C: Regular web track without uri/path must still return null when no cover exists
  const webTrack = {
    id: 'web_1',
    name: 'Online Stream',
    artist: 'Web Artist',
    album: 'Web Album'
  };
  const resWeb = library.resolveTrackCover(webTrack, coverMap, [webTrack]);
  assert.strictEqual(resWeb, null, 'Web track with no uri/path must not return fake cover');
});

test('2. index.html Collection Grid & Album Hero UX optimizations', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // Must NOT assign is-artist (50% border radius) to albums without covers
  assert.ok(
    html.includes("${isArtistView ? 'is-artist' : ''}"),
    'Only artists must receive is-artist circular avatar class in collection cards'
  );
  assert.ok(
    !html.includes("${isArtistView || !entry.cover ? 'is-artist' : ''}"),
    'Must not make coverless albums circular'
  );

  // Must use object-cover in song row thumbnails for edge-to-edge display
  assert.ok(
    html.includes('track-art relative grid') && html.includes('class="h-full w-full object-cover"'),
    'Track row thumbnails must use object-cover instead of object-contain'
  );

  // Recent artists carousel must resolve covers using library.resolveTrackCover
  assert.ok(
    html.includes('library.resolveTrackCover(t, state.albumCovers, tracks)'),
    'Recent artists carousel must resolve track covers via library.resolveTrackCover'
  );

  // Artist Hero must display album count and separate track count
  assert.ok(
    html.includes('buildArtistAlbums(entry).length') && html.includes('album`'),
    'Artist hero must display album count on artistEl'
  );

  // Artist Hero play button must label appropriately
  assert.ok(
    html.includes("playBtnLabel.textContent = isAlbum ? 'Phát album' : 'Phát tất cả'"),
    'Play button label must differentiate album vs artist'
  );
});

test('3. MainActivity.java supports .webp folder art & provides fallback 3.9.31', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  // Folder art extraction checks .webp
  assert.ok(
    java.includes('name.equals(base + ".webp")'),
    'extractFolderCoverFromDir must check base + .webp'
  );
  assert.ok(
    java.includes('name.endsWith(".webp")'),
    'extractFolderCoverFromDir fallback must check .webp'
  );

  // App build info fallback
  assert.ok(
    java.includes('3.9.31'),
    'MainActivity must provide 3.9.31 version fallback'
  );
});

test('4. Version sync v3.9.31 (versionCode 85), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');

  // FiiO DAP Badge
  assert.ok(html.includes('FiiO M11S · v3.9.31'), 'index.html must have FiiO M11S · v3.9.31 badge');

  // Service Worker
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.31';"), 'sw.js must have CACHE_VERSION v3.9.31');
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.31';"), 'sw.js must have CACHE_NAME nocturne-v3.9.31');
  assert.ok(sw.includes("CACHE_VERSION = 'v3.9.30';"), 'sw.js must preserve v3.9.30 history');

  // Gradle
  assert.ok(/versionCode\s*=\s*85\b/.test(gradle), 'build.gradle.kts must have versionCode = 85');
  assert.ok(/versionName\s*=\s*"3\.9\.31"/.test(gradle), 'build.gradle.kts must have versionName = "3.9.31"');
  assert.ok(/versionCode\s*=\s*84\b/.test(gradle), 'build.gradle.kts must preserve versionCode = 84 history');

  // Critical Web Audio Invariant
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved'
  );
});
