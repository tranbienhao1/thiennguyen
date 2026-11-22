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

test('v3.9.89: migrateTrackUserStatKeys migrates favorites, ratings & playCount across Cloud alias and local ID changes', () => {
  const keyFn = extractFn(html, 'function getTrackUserStatKeys(track)');
  const loadPcFn = extractFn(html, 'function loadPlayCountsMap()');
  const migFn = extractFn(html, 'function migrateTrackUserStatKeys(oldTrackOrKeys, newTrack)');

  const ls = {};
  const sandbox = {
    library: libraryUtils,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); }
    },
    getFavoriteKey: (t) => libraryUtils.stableFavoriteKey(t),
    saveFavorites() { ls['nocturne-favorites'] = JSON.stringify(Array.from(sandbox.state.favorites)); },
    state: {
      favorites: new Set(['google:old-target-id', 'local_old_1']),
      trackRatings: { 'google:old-target-id': 4, 'local_old_1': 5 },
      playCounts: { 'google:old-target-id': 7, 'local_old_1': 12 }
    }
  };
  vm.runInNewContext(`const PLAY_COUNTS_KEY = 'nocturne-play-counts';\n${keyFn}\n${loadPcFn}\n${migFn}`, sandbox);

  // Google shortcut updated its targetRemoteId while wrapper remoteId changed
  const gMigrated = sandbox.migrateTrackUserStatKeys(
    ['google:old-target-id'],
    { id: 'g-new', source: 'google', remoteId: 'wrapper-new', targetRemoteId: 'new-target-id' }
  );
  assert.equal(gMigrated, true);
  assert.equal(sandbox.state.favorites.has('google:wrapper-new'), true);
  assert.equal(sandbox.state.trackRatings['google:wrapper-new'], 4);
  assert.equal(sandbox.state.playCounts['google:wrapper-new'], 7);

  // Local FiiO track moved to new id -> rating & playCount follow
  const lMigrated = sandbox.migrateTrackUserStatKeys(
    { id: 'local_old_1', source: 'fiio', path: '/old/01.flac', name: '01.flac' },
    { id: 'local_new_2', source: 'fiio', path: '/new/01.flac', name: '01.flac', title: 'Song' }
  );
  assert.equal(lMigrated, true);
  assert.equal(sandbox.state.trackRatings['local_new_2'], 5);
});

test('v3.9.89: matchPlaylistWithLibrary disambiguates duplicate filenames using album, playlistName & folderHint', () => {
  const m3u = [
    '#EXTM3U',
    '#PLAYLIST:Dark Side',
    '#EXTINF:120,Artist X - 01 - Intro',
    './01 - Intro.flac'
  ].join('\n');
  const parsed = libraryUtils.parseM3u8Playlist(m3u);
  assert.equal(parsed.isValid, true);

  const libTracks = [
    { id: 'a1', source: 'local', path: 'Music/Dark Side/01 - Intro.flac', name: '01 - Intro.flac', album: 'Dark Side', title: 'Track A' },
    { id: 'b1', source: 'local', path: 'Music/Other Album/01 - Intro.flac', name: '01 - Intro.flac', album: 'Other Album', title: 'Track B' }
  ];

  // Without hints -> ambiguous, doesn't blindly pick wrong album
  const noHint = libraryUtils.matchPlaylistWithLibrary(parsed.tracks, libTracks, {});
  assert.equal(noHint.matchedCount, 0);

  // With playlistName hint -> resolves Dark Side cleanly
  const byPlaylist = libraryUtils.matchPlaylistWithLibrary(parsed.tracks, libTracks, { playlistName: parsed.name });
  assert.equal(byPlaylist.matchedCount, 1);
  assert.equal(byPlaylist.matchedTracks[0].local.id, 'a1');

  // With folderHint -> resolves Other Album cleanly when playlistName differs
  const byFolder = libraryUtils.matchPlaylistWithLibrary(parsed.tracks, libTracks, { playlistName: 'Generic Mix', folderHint: 'Other Album' });
  assert.equal(byFolder.matchedCount, 1);
  assert.equal(byFolder.matchedTracks[0].local.id, 'b1');
});

test('v3.9.89: pruneOrphanedAlbumCovers removes orphan album artwork and revokes blob URLs cleanly', () => {
  const pruneFn = extractFn(html, 'function pruneOrphanedAlbumCovers(excludeSources)');
  const revoked = [];
  let savedCount = 0;
  const albumKeyLive = libraryUtils.buildAlbumKey({ artist: 'Live Artist', album: 'Live Album' });
  const albumKeyDead = libraryUtils.buildAlbumKey({ artist: 'Deleted Artist', album: 'Deleted Album' });
  const sandbox = {
    library: libraryUtils,
    URL: { revokeObjectURL: (u) => revoked.push(u) },
    saveAlbumCoversCache: () => { savedCount++; },
    state: {
      tracks: [{ id: 't-live', source: 'google', artist: 'Live Artist', album: 'Live Album' }],
      albumCovers: new Map([
        [albumKeyLive, 'data:image/jpeg;base64,live'],
        [albumKeyDead, 'blob:https://app/dead-cover']
      ])
    }
  };
  vm.runInNewContext(pruneFn, sandbox);
  const removed = sandbox.pruneOrphanedAlbumCovers();
  assert.equal(removed, 1);
  assert.equal(sandbox.state.albumCovers.has(albumKeyLive), true);
  assert.equal(sandbox.state.albumCovers.has(albumKeyDead), false);
  assert.deepEqual(revoked, ['blob:https://app/dead-cover']);
  assert.equal(savedCount, 1);
});

test('v3.9.89: displayTrack uses pcmRate/pcmBitDepth for Web DSD Bit-Perfect HUD and updateMiniPlayerHud shows ⚡ BP', () => {
  const dtSrc = html.slice(html.indexOf('function displayTrack(track) {'), html.indexOf('function displayTrack(track) {') + 6500);
  assert.ok(dtSrc.includes('track.isDsd && !state.isNativeBitPerfectPlaying'));
  assert.ok(dtSrc.includes('track.pcmRate || state.dsdOutputRate || 176400'));

  const miniFn = extractFn(html, 'function updateMiniPlayerHud(track)');
  const artistEl = { textContent: '' };
  const titleEl = { textContent: '' };
  const els = { 'mini-player-hud': {}, 'mini-title': titleEl, 'mini-artist': artistEl, 'mini-play': { textContent: '', setAttribute() {} } };
  const sandbox = {
    $: (id) => els[id] || null,
    audio: { src: '', paused: true },
    escapeHtml: (s) => String(s || ''),
    library: libraryUtils,
    state: {
      currentId: 'dsd-1',
      bitPerfectEnabled: true,
      isNativeBitPerfectPlaying: false,
      tracks: [{ id: 'dsd-1', title: 'DSD Waltz', artist: 'Chopin', format: 'DSF' }]
    }
  };
  vm.runInNewContext(miniFn, sandbox);
  sandbox.updateMiniPlayerHud(sandbox.state.tracks[0]);
  assert.ok(artistEl.textContent.includes('⚡ BP'), `Expected ⚡ BP badge in mini-artist, got: ${artistEl.textContent}`);
});

test('v3.9.89: Monotonic version alignment across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.89';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.89';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30989);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 143);
  assert.ok(gradle.includes('versionName = "3.9.89"'));
});
