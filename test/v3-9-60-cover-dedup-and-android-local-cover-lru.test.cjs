'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. library.deduplicateCatalogCovers & capCatalogCovers collapse duplicate album base64 covers while preserving distinct compilation art', () => {
  const albumCoverA = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  const albumCoverB = 'data:image/jpeg;base64,' + 'B'.repeat(2000);
  const distinctArt = 'data:image/jpeg;base64,' + 'C'.repeat(2000);

  const entries = [
    // Album 1: 4 tracks sharing identical base64 cover (newest = g4)
    { id: 'g1', source: 'google', album: 'Kind of Blue', artist: 'Miles Davis', savedAt: 10, cover: albumCoverA },
    { id: 'g2', source: 'google', album: 'Kind of Blue', artist: 'Miles Davis', savedAt: 20, cover: albumCoverA },
    { id: 'g3', source: 'google', album: 'Kind of Blue', artist: 'Miles Davis', savedAt: 30, cover: albumCoverA },
    { id: 'g4', source: 'google', album: 'Kind of Blue', artist: 'Miles Davis', savedAt: 40, cover: albumCoverA },
    // Album 2: 2 tracks on OneDrive sharing identical base64 cover (newest = o2) + 1 compilation track with distinct art
    { id: 'o1', source: 'onedrive', album: 'Compilation', artist: 'Artist 1', remoteFolderId: 'F2', savedAt: 15, cover: albumCoverB },
    { id: 'o2', source: 'onedrive', album: 'Compilation', artist: 'Artist 1', remoteFolderId: 'F2', savedAt: 25, cover: albumCoverB },
    { id: 'o3', source: 'onedrive', album: 'Compilation', artist: 'Artist 1', remoteFolderId: 'F2', savedAt: 35, cover: distinctArt },
    // HTTPS URL must never be stripped
    { id: 'g5', source: 'google', album: 'Kind of Blue', artist: 'Miles Davis', savedAt: 5, cover: 'https://example.com/cover.jpg' }
  ];

  const deduped = lib.deduplicateCatalogCovers(entries);
  assert.equal(deduped.find(e => e.id === 'g4').cover, albumCoverA, 'Newest representative track must keep album cover');
  assert.equal(deduped.find(e => e.id === 'g1').cover, null, 'Duplicate album cover on older sibling must be cleared');
  assert.equal(deduped.find(e => e.id === 'g2').cover, null);
  assert.equal(deduped.find(e => e.id === 'g3').cover, null);
  assert.equal(deduped.find(e => e.id === 'o2').cover, albumCoverB);
  assert.equal(deduped.find(e => e.id === 'o1').cover, null);
  assert.equal(deduped.find(e => e.id === 'o3').cover, distinctArt, 'Distinct cover in same album/folder must be preserved');
  assert.equal(deduped.find(e => e.id === 'g5').cover, 'https://example.com/cover.jpg', 'HTTPS cover URLs must stay intact');

  // With a tight 6500-char budget, dedup lets ALL 3 unique covers survive (instead of dropping Album 1!)
  const capped = lib.capCatalogCovers(entries, 6500);
  assert.equal(capped.find(e => e.id === 'g4').cover, albumCoverA);
  assert.equal(capped.find(e => e.id === 'o2').cover, albumCoverB);
  assert.equal(capped.find(e => e.id === 'o3').cover, distinctArt);
});

test('2. compactFiioTrackForStorage omits default strings, preserves lastModified & applyFiioRescanFields refreshes re-tagged files', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const compStart = html.indexOf('function compactFiioTrackForStorage(t, ultraLean) {');
  const compEnd = html.indexOf('function saveFiioCatalog(', compStart);
  const rescanStart = html.indexOf('function applyFiioRescanFields(');
  const rescanEnd = html.indexOf('function fiioCueHash(', rescanStart);
  assert.ok(compStart > 0 && compEnd > compStart);
  assert.ok(rescanStart > 0 && rescanEnd > rescanStart);

  const sandbox = {
    library: lib,
    fiioScanUpgradedCount: 0,
    restoreLocalTrackUrlSync: () => {},
    Number, Math, String, Boolean, Object, Set, Map, encodeURIComponent
  };
  vm.runInNewContext(
    html.slice(compStart, compEnd) + '\n' + html.slice(rescanStart, rescanEnd) +
    '\nthis.compactFiioTrackForStorage = compactFiioTrackForStorage;' +
    '\nthis.hydrateFiioStoredTrack = hydrateFiioStoredTrack;' +
    '\nthis.applyFiioRescanFields = applyFiioRescanFields;',
    sandbox
  );

  // 2.1 createFiioTrack preserves lastModified from MediaStore/scanDirectory
  const created = lib.createFiioTrack({
    uri: 'content://media/external/audio/media/42',
    path: '/storage/sd/Music/01.flac',
    name: '01.flac',
    size: 25000000,
    lastModified: 1700000000000
  });
  assert.equal(created.lastModified, 1700000000000);

  // 2.2 compactFiioTrackForStorage omits default placeholders & hydrate restores them
  const defaultPlaceholderTrack = Object.assign({}, created, { artist: 'Unknown Artist', album: 'FiiO Internal & SD Card', path: '01.flac' });
  const compact = sandbox.compactFiioTrackForStorage(defaultPlaceholderTrack, false);
  assert.equal(compact.artist, undefined, 'Default Unknown Artist must be omitted in compact storage');
  assert.equal(compact.album, undefined, 'Default FiiO Internal & SD Card must be omitted in compact storage');
  assert.equal(compact.lastModified, 1700000000000);
  const hydrated = sandbox.hydrateFiioStoredTrack(compact);
  assert.equal(hydrated.artist, 'Unknown Artist');
  assert.equal(hydrated.album, 'FiiO Internal & SD Card');
  assert.equal(hydrated.lastModified, 1700000000000);

  // 2.3 applyFiioRescanFields refreshes metadata when file.lastModified increases (in-place tag edit)
  const prevTrack = {
    id: 'fiio_42',
    uri: 'content://media/external/audio/media/42',
    path: '/storage/sd/Music/01.flac',
    name: '01',
    title: 'Old Title',
    artist: 'Old Artist',
    album: 'Old Album',
    duration: 180,
    size: 25000000,
    lastModified: 1700000000000,
    trackNumber: 1,
    discNumber: 1,
    year: 2020
  };
  sandbox.applyFiioRescanFields(
    prevTrack,
    {
      name: '01.flac',
      title: 'Updated Remaster Title',
      artist: 'Updated Artist',
      album: 'Updated Album',
      albumArtist: 'Updated Album Artist',
      duration: 182.5,
      size: 25000000,
      lastModified: 1700000500000,
      trackNumber: 2,
      discNumber: 2,
      year: 2024
    },
    prevTrack.path,
    prevTrack.uri,
    new Set(), new Set(), new Map(), new Map()
  );
  assert.equal(prevTrack.title, 'Updated Remaster Title');
  assert.equal(prevTrack.artist, 'Updated Artist');
  assert.equal(prevTrack.album, 'Updated Album');
  assert.equal(prevTrack.albumArtist, 'Updated Album Artist');
  assert.equal(prevTrack.trackNumber, 2);
  assert.equal(prevTrack.discNumber, 2);
  assert.equal(prevTrack.year, 2024);
  assert.equal(prevTrack.lastModified, 1700000500000);
  assert.equal(sandbox.fiioScanUpgradedCount, 1);
});

test('3. MainActivity.java wires LruCache cover memory cache, safe +/% query decoding, Vol/Part parent art, DATE_MODIFIED & v3.9.60+ alignment', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

  assert.ok(java.includes('private volatile android.util.LruCache<String, byte[]> mCoverMemCache;'));
  assert.ok(java.includes('android.util.LruCache<String, byte[]> memCache = getCoverMemCache();'));
  assert.ok(java.includes('if (memCache != null) memCache.evictAll();'));
  assert.ok(java.includes('String pathParam = extractLocalMediaQueryParam(uri, "path");'));
  assert.ok(java.includes('vol(?:ume)?|part'));
  assert.ok(java.includes('MediaStore.Audio.Media.DATE_MODIFIED'));
  assert.ok(java.includes('obj.put("lastModified", dateModifiedSec * 1000L);'));
  assert.ok(html.includes('library.deduplicateCatalogCovers(rawEntries)'));

  assert.match(html, /FiiO M11S · v3\.9\.(6[0-9]|[7-9]\d|\d{3,})/);
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(6[0-9]|[7-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(6[0-9]|[7-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 114, `Expected versionCode >= 114, got ${vcMatch && vcMatch[1]}`);
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(6[0-9]|[7-9]\d|\d{3,})"/);
});
