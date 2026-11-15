'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtmlPath = path.resolve(__dirname, '../index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Album Art Instant Sync - Pure Functions & Edge Cases', async (t) => {
  await t.test('buildAlbumKey handles standard metadata, trim, lowercasing, and fallbacks', () => {
    // Standard artist & album
    assert.strictEqual(
      library.buildAlbumKey({ artist: 'Pink Floyd', album: 'The Dark Side of the Moon' }),
      'pink floyd:::the dark side of the moon'
    );
    // Whitespace trimming & lowercasing
    assert.strictEqual(
      library.buildAlbumKey({ artist: '  QUEEN  ', album: '  A Night At The Opera  ' }),
      'queen:::a night at the opera'
    );
    // Fallback: albumArtist when artist is missing
    assert.strictEqual(
      library.buildAlbumKey({ albumArtist: 'Daft Punk', album: 'Discovery' }),
      'daft punk:::discovery'
    );
    // Fallback: albumName when album is missing
    assert.strictEqual(
      library.buildAlbumKey({ artist: 'Hans Zimmer', albumName: 'Interstellar' }),
      'hans zimmer:::interstellar'
    );
    // Missing artist only
    assert.strictEqual(
      library.buildAlbumKey({ album: 'Greatest Hits' }),
      ':::greatest hits'
    );
    // Missing album only
    assert.strictEqual(
      library.buildAlbumKey({ artist: 'Adele' }),
      'adele:::'
    );
    // Missing both
    assert.strictEqual(library.buildAlbumKey({}), ':::');
    // Edge cases: null, undefined, primitives
    assert.strictEqual(library.buildAlbumKey(null), ':::');
    assert.strictEqual(library.buildAlbumKey(undefined), ':::');
    assert.strictEqual(library.buildAlbumKey('some string'), ':::');
    assert.strictEqual(library.buildAlbumKey(12345), ':::');
  });

  await t.test('extractFolderArtCandidates correctly filters, scores, and handles paths', () => {
    const files = [
      { name: '01 - Time.flac', webkitRelativePath: 'Music/Pink Floyd/The Wall/01 - Time.flac' },
      { name: '02 - Money.flac', relativePath: 'Music\\Pink Floyd\\The Wall\\02 - Money.flac' },
      { name: 'cover.jpg', webkitRelativePath: 'Music/Pink Floyd/The Wall/cover.jpg' },
      { name: 'folder.png', webkitRelativePath: 'Music/Pink Floyd/The Wall/folder.png' },
      { name: 'front.jpeg', relativePath: 'Music\\Pink Floyd\\The Wall\\front.jpeg' },
      { name: 'albumart.webp', webkitRelativePath: 'Music/Pink Floyd/The Wall/albumart.webp' },
      { name: 'artwork.bmp', webkitRelativePath: 'Music/Pink Floyd/The Wall/artwork.bmp' },
      { name: 'disc_art.gif', webkitRelativePath: 'Music/Pink Floyd/The Wall/disc_art.gif' },
      { name: 'back.jpg', webkitRelativePath: 'Music/Pink Floyd/The Wall/back.jpg' },
      { name: 'lyrics.lrc', webkitRelativePath: 'Music/Pink Floyd/The Wall/lyrics.lrc' },
      { name: 'tracklist.cue', webkitRelativePath: 'Music/Pink Floyd/The Wall/tracklist.cue' }
    ];

    const candidates = library.extractFolderArtCandidates(files);
    // 7 image files should be extracted, audio/lrc/cue ignored
    assert.strictEqual(candidates.length, 7);

    // Order should reflect priority scoring:
    // cover (100) > folder (95) > front (90) > albumart (85) > artwork (80) > disc_art (50) > back (10)
    assert.strictEqual(candidates[0].name, 'cover.jpg');
    assert.strictEqual(candidates[1].name, 'folder.png');
    assert.strictEqual(candidates[2].name, 'front.jpeg');
    assert.strictEqual(candidates[3].name, 'albumart.webp');
    assert.strictEqual(candidates[4].name, 'artwork.bmp');
    assert.strictEqual(candidates[5].name, 'disc_art.gif');
    assert.strictEqual(candidates[6].name, 'back.jpg');

    // Directory parsing check (forward slash and backslash)
    assert.strictEqual(candidates[0].directory, 'Music/Pink Floyd/The Wall');
    assert.strictEqual(candidates[2].directory, 'Music\\Pink Floyd\\The Wall');

    // Graceful handling of invalid inputs
    assert.deepStrictEqual(library.extractFolderArtCandidates([]), []);
    assert.deepStrictEqual(library.extractFolderArtCandidates(null), []);
    assert.deepStrictEqual(library.extractFolderArtCandidates(undefined), []);
  });

  await t.test('propagateAlbumCovers bidirectional propagation and quality preference', () => {
    const coverMap = new Map();
    const tracks = [
      { id: '1', artist: 'Pink Floyd', album: 'The Wall', cover: 'short-preview.jpg' },
      { id: '2', artist: 'Pink Floyd', album: 'The Wall', cover: 'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER' },
      { id: '3', artist: 'Pink Floyd', album: 'The Wall', cover: null },
      { id: '4', artist: 'Pink Floyd', album: 'The Wall', cover: '♫' },
      { id: '5', artist: 'Radiohead', album: 'OK Computer', cover: null }
    ];

    const res = library.propagateAlbumCovers(tracks, coverMap);
    // Track 2 has highest quality cover. Tracks 1, 3, 4 should all receive Track 2's cover.
    assert.strictEqual(res.updatedCount, 3);
    assert.strictEqual(tracks[0].cover, 'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER');
    assert.strictEqual(tracks[2].cover, 'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER');
    assert.strictEqual(tracks[3].cover, 'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER');
    assert.strictEqual(tracks[4].cover, null, 'Radiohead track should remain null without matching cover');

    // coverMap now has the key cached
    assert.strictEqual(
      coverMap.get('pink floyd:::the wall'),
      'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER'
    );

    // Support plain object coverMap as well
    const plainMap = {};
    const singleTrack = [{ id: '6', artist: 'Pink Floyd', album: 'The Wall', cover: null }];
    coverMap.forEach((v, k) => { plainMap[k] = v; });
    const resPlain = library.propagateAlbumCovers(singleTrack, plainMap);
    assert.strictEqual(resPlain.updatedCount, 1);
    assert.strictEqual(singleTrack[0].cover, 'data:image/jpeg;base64,HIGH_RESOLUTION_DATA_URL_ALBUM_COVER');

    // Invalid / empty inputs
    assert.strictEqual(library.propagateAlbumCovers(null).updatedCount, 0);
    assert.strictEqual(library.propagateAlbumCovers([]).updatedCount, 0);
  });

  await t.test('resolveTrackCover fallback hierarchy and instant in-place assignment', () => {
    const coverMap = new Map([
      ['queen:::a night at the opera', 'https://cdn.example.com/bohemian.jpg']
    ]);

    const allTracks = [
      { id: 't1', artist: 'The Beatles', album: 'Abbey Road', cover: 'https://cdn.example.com/abbey.jpg' },
      { id: 't2', artist: 'The Beatles', album: 'Abbey Road', cover: null },
      { id: 't3', artist: 'Unknown Artist', album: 'Random Sessions', cover: 'https://cdn.example.com/sessions.jpg' }
    ];

    // Case 1: Track already has own valid cover
    const ownTrack = { id: 't0', artist: 'Led Zeppelin', album: 'IV', cover: 'https://cdn.example.com/zep.jpg' };
    assert.strictEqual(library.resolveTrackCover(ownTrack, coverMap, allTracks), 'https://cdn.example.com/zep.jpg');

    // Case 2: Track has placeholder '♫' -> resolves from coverMap
    const mapTrack = { id: 't4', artist: 'Queen', album: 'A Night At The Opera', cover: '♫' };
    const rMap = library.resolveTrackCover(mapTrack, coverMap, allTracks);
    assert.strictEqual(rMap, 'https://cdn.example.com/bohemian.jpg');
    assert.strictEqual(mapTrack.cover, 'https://cdn.example.com/bohemian.jpg');

    // Case 3: Track has no cover -> resolves from sibling track with matching albumKey
    const sibTrack = { id: 't5', artist: 'The Beatles', album: 'Abbey Road', cover: null };
    const rSib = library.resolveTrackCover(sibTrack, coverMap, allTracks);
    assert.strictEqual(rSib, 'https://cdn.example.com/abbey.jpg');
    assert.strictEqual(sibTrack.cover, 'https://cdn.example.com/abbey.jpg');
    // Also saved to coverMap for subsequent zero-latency lookups
    assert.strictEqual(coverMap.get('the beatles:::abbey road'), 'https://cdn.example.com/abbey.jpg');

    // Case 4: Track has matching album name fallback
    const albumFallbackTrack = { id: 't6', artist: 'Another Artist', album: 'Random Sessions', cover: null };
    const rAlb = library.resolveTrackCover(albumFallbackTrack, coverMap, allTracks);
    assert.strictEqual(rAlb, 'https://cdn.example.com/sessions.jpg');
    assert.strictEqual(albumFallbackTrack.cover, 'https://cdn.example.com/sessions.jpg');

    // Case 5: No matching cover anywhere
    const noneTrack = { id: 't7', artist: 'Anonymous', album: 'Solo Piano', cover: null };
    assert.strictEqual(library.resolveTrackCover(noneTrack, coverMap, allTracks), null);

    // Edge cases
    assert.strictEqual(library.resolveTrackCover(null), null);
    assert.strictEqual(library.resolveTrackCover(undefined), null);
    assert.strictEqual(library.resolveTrackCover('invalid'), null);
  });
});

test('Album Art Instant Sync - Sibling Propagation & Folder Image Auto-Detection', async (t) => {
  await t.test('Multi-album sibling propagation isolates albums cleanly', () => {
    const tracks = [
      // Album A
      { id: 'a1', artist: 'Miles Davis', album: 'Kind of Blue', cover: 'coverA.jpg' },
      { id: 'a2', artist: 'Miles Davis', album: 'Kind of Blue', cover: null },
      { id: 'a3', artist: 'Miles Davis', album: 'Kind of Blue', cover: '' },
      // Album B
      { id: 'b1', artist: 'John Coltrane', album: 'Blue Train', cover: null },
      { id: 'b2', artist: 'John Coltrane', album: 'Blue Train', cover: 'coverB.jpg' },
      // Album C without any cover
      { id: 'c1', artist: 'Bill Evans', album: 'Waltz for Debby', cover: null }
    ];

    const coverMap = new Map();
    const result = library.propagateAlbumCovers(tracks, coverMap);

    assert.strictEqual(result.updatedCount, 3);
    assert.strictEqual(tracks[1].cover, 'coverA.jpg');
    assert.strictEqual(tracks[2].cover, 'coverA.jpg');
    assert.strictEqual(tracks[3].cover, 'coverB.jpg');
    assert.strictEqual(tracks[5].cover, null);

    assert.strictEqual(coverMap.get('miles davis:::kind of blue'), 'coverA.jpg');
    assert.strictEqual(coverMap.get('john coltrane:::blue train'), 'coverB.jpg');
  });

  await t.test('Folder image candidates priority resolution and directory mapping in addLocalFiles', () => {
    // Check that addLocalFiles handles folderCoverByDir and extractFolderArtCandidates
    assert.ok(indexHtml.includes('library.extractFolderArtCandidates(files)'));
    assert.ok(indexHtml.includes('folderCoverByDir = new Map()'));
    assert.ok(indexHtml.includes('URL.createObjectURL(cand.file || cand)'));
    assert.ok(indexHtml.includes('state.objectUrls.add(url)'));
    assert.ok(indexHtml.includes('folderCoverByDir.set(dir, url)'));
  });
});

test('Album Art Instant Sync - Fallback Resolution in displayTrack & Recent Cards', async (t) => {
  await t.test('displayTrack resolves missing cover instantly with 0ms delay', () => {
    const match = indexHtml.match(/function displayTrack\(track\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(match, 'displayTrack function found in index.html');
    const body = match[1];

    assert.ok(
      body.includes('resolveTrackCover(track, state.albumCovers, state.tracks)'),
      'displayTrack calls resolveTrackCover'
    );
    assert.ok(
      body.includes('syncAlbumCoversImmediate(resolvedCover, track)'),
      'displayTrack invokes syncAlbumCoversImmediate when cover resolved'
    );
    assert.ok(
      body.includes("const cover = $('player-cover'); cover.innerHTML = track.cover ?"),
      'player-cover renders track.cover immediately'
    );
  });

  await t.test('renderRecentTracks & renderRecentActivity eliminate placeholder ♫ using resolveTrackCover', () => {
    assert.ok(indexHtml.includes('function renderRecentActivity('));
    assert.ok(indexHtml.includes('function renderRecentTracks('));

    const match = indexHtml.match(/function renderRecentTracks\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(match, 'renderRecentTracks found');
    const body = match[1];

    assert.ok(
      body.includes('library.resolveTrackCover(track, state.albumCovers, state.tracks)'),
      'renderRecentTracks resolves cover for track'
    );
    assert.ok(
      body.includes('library.resolveTrackCover(entry, state.albumCovers, state.tracks)'),
      'renderRecentTracks resolves cover for history entry fallback'
    );
    assert.ok(
      body.includes('const cover = trackCover ? `<img src="${escapeHtml(trackCover)}"'),
      'Renders resolved image tag instead of placeholder'
    );
  });

  await t.test('renderTracks and renderCollectionCards synchronize album covers', () => {
    const renderTracksMatch = indexHtml.match(/function renderTracks\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(renderTracksMatch, 'renderTracks found');
    assert.ok(
      renderTracksMatch[1].includes('library.propagateAlbumCovers(state.tracks, state.albumCovers)'),
      'renderTracks invokes propagateAlbumCovers'
    );

    const renderCardsMatch = indexHtml.match(/function renderCollectionCards\(tracks\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(renderCardsMatch, 'renderCollectionCards found');
    assert.ok(
      renderCardsMatch[1].includes('library.resolveTrackCover(track, state.albumCovers, state.tracks)'),
      'renderCollectionCards resolves track cover'
    );
  });
});

test('Album Art Instant Sync - State Initialization & Cache Persistence', async (t) => {
  await t.test('state.albumCovers initialized from localStorage nocturne-album-covers', () => {
    assert.ok(indexHtml.includes("localStorage.getItem('nocturne-album-covers')"));
    assert.ok(indexHtml.includes('albumCovers: (() => {'));
  });

  await t.test('syncAlbumCoversImmediate and saveAlbumCoversCache exist and filter blob URLs', () => {
    const saveMatch = indexHtml.match(/function saveAlbumCoversCache\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(saveMatch, 'saveAlbumCoversCache found');
    const saveBody = saveMatch[1];
    assert.ok(saveBody.includes("!cover.startsWith('blob:')"), 'Excludes blob: URLs from persistence');
    assert.ok(saveBody.includes("localStorage.setItem('nocturne-album-covers'"), 'Persists to localStorage');

    const syncMatch = indexHtml.match(/function syncAlbumCoversImmediate\(cover, track\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(syncMatch, 'syncAlbumCoversImmediate found');
    const syncBody = syncMatch[1];
    assert.ok(syncBody.includes('buildAlbumKey(track)'), 'Uses buildAlbumKey');
    assert.ok(syncBody.includes('saveAlbumCoversCache()'), 'Calls saveAlbumCoversCache');
    assert.ok(syncBody.includes('sibling.cover = targetCover'), 'Propagates to siblings in state.tracks');
  });

  await t.test('File input accept filters updated with image formats for folder art imports', () => {
    assert.ok(indexHtml.includes('accept="audio/*,.flac,.wav,.alac,.m4a,.mp3,.ogg,.opus,.aac,.aiff,.wma,.aif,.dsf,.dff,.cue,image/*,.jpg,.jpeg,.png,.webp,.bmp"'));
  });
});

test('Audio Graph Invariant Preservation', () => {
  // Web Audio Graph invariant: state.crossfeedNodes.output.connect(state.context.destination) strictly preserved
  const invariant = 'state.crossfeedNodes.output.connect(state.context.destination)';
  assert.ok(indexHtml.includes(invariant), `Must contain audio graph invariant: ${invariant}`);
  
  // Count occurrences to ensure it was not accidentally commented out or removed
  const occurrences = (indexHtml.match(new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.ok(occurrences >= 2, `Invariant must appear in audio setup and reconnection paths (found ${occurrences})`);
});
