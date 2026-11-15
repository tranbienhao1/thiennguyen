const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtmlPath = path.resolve(__dirname, '../index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Album Art Instant Sync - Pure Helpers in library-utils.js', async (t) => {
  await t.test('buildAlbumKey standardizes album key correctly', () => {
    assert.strictEqual(
      library.buildAlbumKey({ artist: ' Pink Floyd ', album: ' The Dark Side of the Moon ' }),
      'pink floyd:::the dark side of the moon'
    );
    assert.strictEqual(
      library.buildAlbumKey({ artist: 'Queen', album: 'A Night At The Opera' }),
      'queen:::a night at the opera'
    );
    assert.strictEqual(
      library.buildAlbumKey({ albumArtist: 'Daft Punk', album: 'Discovery' }),
      'daft punk:::discovery'
    );
    assert.strictEqual(
      library.buildAlbumKey({ album: 'Greatest Hits' }),
      ':::greatest hits'
    );
    assert.strictEqual(
      library.buildAlbumKey({ artist: 'Adele' }),
      'adele:::'
    );
    assert.strictEqual(library.buildAlbumKey(null), ':::');
    assert.strictEqual(library.buildAlbumKey(undefined), ':::');
    assert.strictEqual(library.buildAlbumKey('not an object'), ':::');
  });

  await t.test('extractFolderArtCandidates identifies and scores cover images', () => {
    const files = [
      { name: '01 - Track 1.flac', webkitRelativePath: 'Album/01 - Track 1.flac' },
      { name: '02 - Track 2.mp3', webkitRelativePath: 'Album/02 - Track 2.mp3' },
      { name: 'tracklist.cue', webkitRelativePath: 'Album/tracklist.cue' },
      { name: 'lyrics.lrc', webkitRelativePath: 'Album/lyrics.lrc' },
      { name: 'notes.txt', webkitRelativePath: 'Album/notes.txt' },
      { name: 'back.jpg', webkitRelativePath: 'Album/back.jpg' },
      { name: 'front.png', webkitRelativePath: 'Album/front.png' },
      { name: 'folder.jpg', webkitRelativePath: 'Album/folder.jpg' },
      { name: 'cover.jpg', webkitRelativePath: 'Album/cover.jpg' }
    ];

    const candidates = library.extractFolderArtCandidates(files);
    assert.strictEqual(candidates.length, 4);
    // Highest score should be cover.jpg, then folder.jpg, then front.png, then back.jpg
    assert.strictEqual(candidates[0].name, 'cover.jpg');
    assert.strictEqual(candidates[1].name, 'folder.jpg');
    assert.strictEqual(candidates[2].name, 'front.png');
    assert.strictEqual(candidates[3].name, 'back.jpg');

    assert.strictEqual(candidates[0].directory, 'Album');
    assert.ok(candidates[0].score >= 100);
    assert.ok(candidates[1].score >= 95);
    assert.ok(candidates[2].score >= 90);

    // Empty or non-array inputs
    assert.deepStrictEqual(library.extractFolderArtCandidates([]), []);
    assert.deepStrictEqual(library.extractFolderArtCandidates(null), []);
  });

  await t.test('propagateAlbumCovers propagates covers bidirectionally', () => {
    const coverMap = new Map();
    const tracks = [
      { id: '1', artist: 'Pink Floyd', album: 'The Wall', cover: 'data:image/jpeg;base64,HIGHRESCOVER12345' },
      { id: '2', artist: 'Pink Floyd', album: 'The Wall', cover: null },
      { id: '3', artist: 'Pink Floyd', album: 'The Wall', cover: '' },
      { id: '4', artist: 'Led Zeppelin', album: 'IV', cover: null }
    ];

    const result = library.propagateAlbumCovers(tracks, coverMap);
    assert.strictEqual(result.updatedCount, 2);
    assert.strictEqual(tracks[1].cover, 'data:image/jpeg;base64,HIGHRESCOVER12345');
    assert.strictEqual(tracks[2].cover, 'data:image/jpeg;base64,HIGHRESCOVER12345');
    assert.strictEqual(tracks[3].cover, null);
    assert.strictEqual(coverMap.get('pink floyd:::the wall'), 'data:image/jpeg;base64,HIGHRESCOVER12345');

    // Second propagation with coverMap populating a newly added track
    const newTrack = { id: '5', artist: 'Pink Floyd', album: 'The Wall', cover: null };
    const result2 = library.propagateAlbumCovers([newTrack], coverMap);
    assert.strictEqual(result2.updatedCount, 1);
    assert.strictEqual(newTrack.cover, 'data:image/jpeg;base64,HIGHRESCOVER12345');
  });

  await t.test('propagateAlbumCovers favors higher quality covers', () => {
    const coverMap = new Map();
    const tracks = [
      { id: '1', artist: 'Radiohead', album: 'OK Computer', cover: 'small.jpg' },
      { id: '2', artist: 'Radiohead', album: 'OK Computer', cover: 'data:image/png;base64,VERYLONGSTRINGHIGHQUALITYBASE64COVER' }
    ];

    const result = library.propagateAlbumCovers(tracks, coverMap);
    assert.strictEqual(result.updatedCount, 1);
    assert.strictEqual(tracks[0].cover, 'data:image/png;base64,VERYLONGSTRINGHIGHQUALITYBASE64COVER');
    assert.strictEqual(coverMap.get('radiohead:::ok computer'), 'data:image/png;base64,VERYLONGSTRINGHIGHQUALITYBASE64COVER');
  });

  await t.test('resolveTrackCover resolves cover instantly with fallbacks', () => {
    const coverMap = new Map([
      ['queen:::a night at the opera', 'https://example.com/queen.jpg']
    ]);
    const allTracks = [
      { id: '10', artist: 'Beatles', album: 'Abbey Road', cover: 'https://example.com/abbey.jpg' },
      { id: '11', artist: 'Beatles', album: 'Abbey Road', cover: null }
    ];

    // Case 1: Track already has cover
    const t1 = { id: '1', artist: 'Artist', album: 'Album', cover: 'own-cover.png' };
    assert.strictEqual(library.resolveTrackCover(t1, coverMap, allTracks), 'own-cover.png');

    // Case 2: Track has no cover, resolves from coverMap
    const t2 = { id: '2', artist: 'Queen', album: 'A Night at the Opera', cover: null };
    const r2 = library.resolveTrackCover(t2, coverMap, allTracks);
    assert.strictEqual(r2, 'https://example.com/queen.jpg');
    assert.strictEqual(t2.cover, 'https://example.com/queen.jpg');

    // Case 3: Track has no cover, resolves from sibling track
    const t3 = { id: '12', artist: 'Beatles', album: 'Abbey Road', cover: null };
    const r3 = library.resolveTrackCover(t3, coverMap, allTracks);
    assert.strictEqual(r3, 'https://example.com/abbey.jpg');
    assert.strictEqual(t3.cover, 'https://example.com/abbey.jpg');
    assert.strictEqual(coverMap.get('beatles:::abbey road'), 'https://example.com/abbey.jpg');

    // Case 4: No cover available anywhere
    const t4 = { id: '99', artist: 'Unknown', album: 'Unknown', cover: null };
    assert.strictEqual(library.resolveTrackCover(t4, coverMap, allTracks), null);
  });
});

test('Album Art Instant Sync - index.html Integration & Audio Invariant', async (t) => {
  await t.test('state.albumCovers initialized from localStorage cache', () => {
    assert.ok(indexHtml.includes('albumCovers: (() => {'));
    assert.ok(indexHtml.includes('localStorage.getItem(\'nocturne-album-covers\')'));
  });

  await t.test('syncAlbumCoversImmediate and saveAlbumCoversCache defined', () => {
    assert.ok(indexHtml.includes('function syncAlbumCoversImmediate('));
    assert.ok(indexHtml.includes('function saveAlbumCoversCache('));
    assert.ok(indexHtml.includes('window.syncAlbumCoversImmediate = syncAlbumCoversImmediate'));
  });

  await t.test('addLocalFiles extracts folder art candidates and applies covers', () => {
    assert.ok(indexHtml.includes('library.extractFolderArtCandidates(files)'));
    assert.ok(indexHtml.includes('folderCoverByDir'));
  });

  await t.test('displayTrack immediately resolves cover via resolveTrackCover', () => {
    const displayTrackMatch = indexHtml.match(/function displayTrack\(track\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(displayTrackMatch, 'displayTrack should be declared');
    const body = displayTrackMatch[1];
    assert.ok(body.includes('resolveTrackCover(track, state.albumCovers, state.tracks)'));
    assert.ok(body.includes('syncAlbumCoversImmediate'));
  });

  await t.test('renderRecentActivity and renderRecentTracks use resolveTrackCover', () => {
    assert.ok(indexHtml.includes('function renderRecentActivity('));
    assert.ok(indexHtml.includes('window.renderRecentActivity = renderRecentActivity'));
    assert.ok(indexHtml.includes('resolveTrackCover(track, state.albumCovers, state.tracks)'));
  });

  await t.test('renderTracks and renderCollectionCards synchronize album covers', () => {
    assert.ok(indexHtml.includes('library.propagateAlbumCovers(state.tracks, state.albumCovers)'));
  });

  await t.test('Audio Invariant strictly preserved', () => {
    assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  });
});
