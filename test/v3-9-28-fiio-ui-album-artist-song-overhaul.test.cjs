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

test('1. inferFiioFolderMetadata & enrichFiioTrackMetadata extract Artist, Album & clean Title from FiiO MicroSD folder structures', () => {
  // A. Standard /Music/Artist/Album/01 - Title.flac
  const metaA = library.inferFiioFolderMetadata(
    '/storage/1234-5678/Music/Eagles/Hotel California/01 - Hotel California.flac',
    '01 - Hotel California.flac'
  );
  assert.equal(metaA.artist, 'Eagles');
  assert.equal(metaA.album, 'Hotel California');
  assert.equal(metaA.title, 'Hotel California');

  // B. Multi-disc /Music/Artist/Album/CD1/03 - Time.dsf
  const metaB = library.inferFiioFolderMetadata(
    '/storage/ABCD-EF01/Music/Pink Floyd/Dark Side of the Moon/CD1/03 - Time.dsf',
    '03 - Time.dsf'
  );
  assert.equal(metaB.artist, 'Pink Floyd');
  assert.equal(metaB.album, 'Dark Side of the Moon');
  assert.equal(metaB.title, 'Time');

  // C. Combined folder /DSD/Artist - Album/01 - Artist - Title.dsf
  const metaC = library.inferFiioFolderMetadata(
    '/storage/1234-5678/DSD/Diana Krall - Love Scenes/01 - Diana Krall - All or Nothing at All.dsf',
    '01 - Diana Krall - All or Nothing at All.dsf'
  );
  assert.equal(metaC.artist, 'Diana Krall');
  assert.equal(metaC.album, 'Love Scenes');
  assert.equal(metaC.title, 'All or Nothing at All');

  // D. enrichFiioTrackMetadata upgrades untagged FiiO tracks and generates shared album cover key
  const rawTrack = library.createFiioTrack({
    name: '02 - New Kid in Town.flac',
    path: '/storage/1234-5678/Music/Eagles/Hotel California/02 - New Kid in Town.flac',
    size: 38000000
  });
  assert.equal(rawTrack.artist, 'Unknown Artist');
  assert.equal(rawTrack.album, 'FiiO Internal & SD Card');
  library.enrichFiioTrackMetadata(rawTrack);
  assert.equal(rawTrack.artist, 'Eagles');
  assert.equal(rawTrack.album, 'Hotel California');
  assert.equal(rawTrack.title, 'New Kid in Town');
  assert.ok(rawTrack.cover.includes('key=' + encodeURIComponent('hotel california|eagles')));
});

test('2. propagateAlbumCovers & instantPropagateCovers never cross-contaminate untagged FiiO Internal & SD Card fallback bucket', () => {
  const tracks = [
    { id: '1', artist: 'Unknown Artist', album: 'FiiO Internal & SD Card', cover: 'https://appassets.androidplatform.net/local-cover?path=%2Fa.flac&size=320' },
    { id: '2', artist: 'Unknown Artist', album: 'FiiO Internal & SD Card', cover: '' }
  ];
  const coverMap = new Map();
  library.propagateAlbumCovers(tracks, coverMap);
  assert.equal(tracks[1].cover, '', 'Untagged fallback album bucket must not copy another untagged track cover');
  library.instantPropagateCovers(tracks, coverMap);
  assert.equal(tracks[1].cover, '', 'instantPropagateCovers must not copy covers across FiiO Internal & SD Card bucket');
});

test('3. MainActivity.java supports DSF tail ID3v2 APIC cover extraction, multi-disc parent folder art, and lockscreen album art', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('private static byte[] extractId3v2ApicFromFile(File file)'), 'Must parse embedded ID3v2 APIC from DSF tail metadata pointer');
  assert.ok(java.includes("magic[0] == 'D' && magic[1] == 'S' && magic[2] == 'D' && magic[3] == ' '"), 'Must check DSF magic header');
  assert.ok(java.includes('private byte[] extractFolderCoverFromDir(File dir, int size)'), 'Must extract folder cover art with multi-disc parent fallback');
  assert.ok(java.includes('private android.graphics.Bitmap loadCachedCoverBitmap('), 'Must load cached cover bitmap for Android Notification & Lockscreen');
  assert.ok(java.includes('mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, coverBmp)'), 'Must attach album art to MediaSession metadata');
  assert.ok(java.includes('builder.setLargeIcon(coverBmp)'), 'Must attach album art to MediaStyle notification large icon');
});

test('4. index.html Chromium 74 (FiiO M11S) CSS & JS optimizations for Album grid, Artist circles, Song rows & Fast-Tap', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('#collection-grid .collection-art.is-artist'), 'Must define explicit circular artist dimensions for Chromium 74 without aspect-ratio');
  assert.ok(html.includes('#album-hero[data-hero-type="artist"] #album-hero-cover'), 'Artist hero cover must be circular');
  assert.ok(html.includes('#track-list .track-row button[data-queue-action="play_next"]'), 'Must hide invisible desktop hover queue buttons on narrow DAP screen');
  assert.ok(html.includes('function renderRecentArtists()'), 'Must dynamically render Home Your recent artists carousel from library');
  assert.ok(html.includes("'.artist-link, .album-link, .track-annotation-indicator, [data-recent-artist], #album-hero-artist, #fullscreen-album, #fullscreen-performer, button"), 'Fast-Tap must match .artist-link and .album-link before .track-row');
  assert.ok(html.includes('library.enrichFiioTrackMetadata(hydrated)'), 'hydrateFiioStoredTrack must enrich existing stored FiiO tracks');
  assert.ok(html.includes('library.enrichFiioTrackMetadata(track)'), 'ingestFiioScannedFilesChunk must enrich newly scanned FiiO tracks');
});

test('5. Version sync v3.9.28 (versionCode 82), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'library-utils.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8'));
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.28';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.28';"));
  assert.ok(gradle.includes('versionCode = 82'));
  assert.ok(gradle.includes('versionName = "3.9.28"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S \u00b7 v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
