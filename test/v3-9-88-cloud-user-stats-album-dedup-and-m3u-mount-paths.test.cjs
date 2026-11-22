'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const libraryUtils = require(path.join(ROOT, 'library-utils.js'));

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

test('v3.9.88: isTrackInFavorites matches Google targetRemoteId & OneDrive remoteShortcutId aliases while preserving stableFavoriteKey', () => {
  const favs = new Set(['google:target-g-99', 'onedrive:shared-od-77']);
  const gShortcut = { id: 'tr-g-1', source: 'google', remoteId: 'wrapper-1', targetRemoteId: 'target-g-99', title: 'Track G' };
  const odShared = { id: 'tr-od-1', source: 'onedrive', remoteId: 'real-od-1', remoteShortcutId: 'shared-od-77', title: 'Track OD' };
  const unrelated = { id: 'tr-other', source: 'google', remoteId: 'wrapper-2', targetRemoteId: 'other-id', title: 'Other' };

  assert.equal(libraryUtils.stableFavoriteKey({ id: 'x', source: 'google', remoteId: 'r-1' }), 'google:r-1');
  assert.equal(libraryUtils.isTrackInFavorites(gShortcut, favs), true);
  assert.equal(libraryUtils.isTrackInFavorites(odShared, favs), true);
  assert.equal(libraryUtils.isTrackInFavorites(unrelated, favs), false);
});

test('v3.9.88: Cloud rating, playCount & serializableCloudTrack persist and re-hydrate across Cloud alias changes', () => {
  const keyFn = extractFn(html, 'function getTrackUserStatKeys(track)');
  const loadPcFn = extractFn(html, 'function loadPlayCountsMap()');
  const recPcFn = extractFn(html, 'function recordTrackPlayCount(track)');
  const getRFn = extractFn(html, 'function getTrackRating(track)');
  const setRFn = extractFn(html, 'function setTrackRating(track, rating)');
  const hydFn = extractFn(html, 'function hydrateTrackUserStats(track)');
  const serStart = html.indexOf('const serializableCloudTrack =');
  const serEnd = html.indexOf('savedAt:Date.now()});', serStart);
  assert.notEqual(serStart, -1);
  assert.notEqual(serEnd, -1);
  const serLine = html.slice(serStart, serEnd + 'savedAt:Date.now()});'.length);

  const ls = {};
  const persistedBatches = [];
  const sandbox = {
    library: libraryUtils,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); }
    },
    getFavoriteKey: (t) => libraryUtils.stableFavoriteKey(t),
    isFavorite: (t) => libraryUtils.isTrackInFavorites(t, new Set(['google:target-1'])),
    persistCloudCatalog: async (batch) => { persistedBatches.push(batch); },
    updateRoomRating() {},
    scheduleTrackRender() {},
    coverForCatalog: (c) => c || null,
    state: { currentId: null, trackRatings: {}, favorites: new Set(['google:target-1']) }
  };

  vm.runInNewContext(`const PLAY_COUNTS_KEY = 'nocturne-play-counts';\n${keyFn}\n${loadPcFn}\n${recPcFn}\n${getRFn}\n${setRFn}\n${hydFn}\n${serLine}\nglobalThis.serializableCloudTrack = serializableCloudTrack;`, sandbox);

  const orig = { id: 'g-old', source: 'google', remoteId: 'target-1', title: 'Nights', name: 'Nights.flac' };
  sandbox.setTrackRating(orig, 5);
  assert.equal(sandbox.recordTrackPlayCount(orig), 1);
  assert.equal(sandbox.recordTrackPlayCount(orig), 2);
  const serialized = sandbox.serializableCloudTrack(orig);
  assert.equal(serialized.rating, 5);
  assert.equal(serialized.playCount, 2);
  assert.ok(persistedBatches.length >= 2);

  // Re-scanned as shortcut with new id and wrapper remoteId pointing to targetRemoteId
  const rescanned = { id: 'g-new', source: 'google', remoteId: 'shortcut-wrapper-2', targetRemoteId: 'target-1', title: 'Nights', name: 'Nights.flac' };
  sandbox.hydrateTrackUserStats(rescanned);
  assert.equal(rescanned.isFavorite, true);
  assert.equal(rescanned.rating, 5, 'Rating must survive Cloud track id & shortcut alias change');
  assert.equal(rescanned.playCount, 2, 'playCount must survive Cloud track id & shortcut alias change');
});

test('v3.9.88: renderAlbumHero deduplicates multi-source tracks & preserves setupAudio invariant', () => {
  const heroStart = html.indexOf('const dedupeHeroTracks = (list) => {');
  assert.notEqual(heroStart, -1);
  const heroEnd = html.indexOf('if (favAllBtn) {', heroStart);
  assert.notEqual(heroEnd, -1);
  const heroSlice = html.slice(heroStart, heroEnd);

  assert.ok(heroSlice.includes('if (typeof setupAudio === \'function\') setupAudio();'));
  assert.ok(heroSlice.includes("state.context.resume().catch(e => console.debug('AudioContext resume in album-hero-play:', e));"));

  const dFn = extractFn(html, 'const dedupeHeroTracks = (list) => {');
  const sandbox = { library: libraryUtils };
  vm.runInNewContext(`${dFn}\nglobalThis.__dedupe = dedupeHeroTracks;`, sandbox);
  const input = [
    { id: 'local-1', source: 'local', title: 'Track One', artist: 'Artist A', duration: 240 },
    { id: 'local-1', source: 'local', title: 'Track One', artist: 'Artist A', duration: 240 },
    { id: 'g-1', source: 'google', remoteId: 'r-same', title: 'Track Two', artist: 'Artist A', duration: 200 },
    { id: 'g-dup', source: 'google', remoteId: 'r-same', title: 'Track Two', artist: 'Artist A', duration: 200 },
    { id: 'od-1', source: 'onedrive', remoteId: 'od-99', title: 'Track Three', artist: 'Artist A', duration: 210 }
  ];
  const deduped = sandbox.__dedupe(input);
  assert.deepEqual(Array.from(deduped.map(t => t.id)), ['local-1', 'g-1', 'od-1']);
});

test('v3.9.88: matchPlaylistWithLibrary matches Android storage mounts, Windows drives, and NFD/NFC M3U8 paths', () => {
  const m3u = [
    '#EXTM3U',
    '#EXTINF:240,Artist A - Song One',
    '../Music/Nhạc Việt/01 - Bài Hát.flac',
    '#EXTINF:200,Artist B - Song Two',
    '/storage/emulated/0/Music/Jazz/02 - Midnight.flac',
    '#EXTINF:180,Artist C - Song Three',
    'D:\\Audio\\DSD\\03 - Nocturne.dsf'
  ].join('\n');
  const parsed = libraryUtils.parseM3u8Playlist(m3u);
  assert.equal(parsed.isValid, true);

  const libTracks = [
    // NFD decomposed path on /mnt/media_rw/<vol>/ matching NFC relative ../Music/...
    { id: 't1', source: 'fiio', path: '/mnt/media_rw/SD-CARD/Music/Nha\u0323c Vie\u0323\u0302t/01 - Ba\u0300i Ha\u0301t.flac', name: '01 - Bài Hát.flac' },
    // /sdcard/ alias vs /storage/emulated/0/
    { id: 't2', source: 'fiio', path: '/sdcard/Music/Jazz/02 - Midnight.flac', name: '02 - Midnight.flac' },
    // Web relativePath without drive letter vs Windows D:\Audio\DSD\...
    { id: 't3', source: 'local', relativePath: 'Audio/DSD/03 - Nocturne.dsf', name: '03 - Nocturne.dsf' }
  ];
  const res = libraryUtils.matchPlaylistWithLibrary(parsed.tracks, libTracks, { playlistDir: '/storage/emulated/0/Playlists' });
  assert.equal(res.matchedCount, 3, `Expected 3 cross-device matches, got ${res.matchedCount}`);
  assert.deepEqual(res.matchedTracks.map(m => m.local.id), ['t1', 't2', 't3']);
});

test('v3.9.88: Monotonic version alignment across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.88';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.88';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30988);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 142);
  assert.ok(gradle.includes('versionName = "3.9.88"'));
});
