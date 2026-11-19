'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../library-utils.js');

test('Album Track Order Deep Verification Suite', async (t) => {
  await t.test('1. parseOrderNumber handles all numeric, string, array, and object representations', () => {
    assert.strictEqual(lib.parseOrderNumber(1), 1);
    assert.strictEqual(lib.parseOrderNumber(10), 10);
    assert.strictEqual(lib.parseOrderNumber('02/12'), 2);
    assert.strictEqual(lib.parseOrderNumber('3/12'), 3);
    assert.strictEqual(lib.parseOrderNumber('05'), 5);
    assert.strictEqual(lib.parseOrderNumber('track 08'), 8);
    assert.strictEqual(lib.parseOrderNumber('CD 2'), 2);
    assert.strictEqual(lib.parseOrderNumber('disc 01'), 1);
    assert.strictEqual(lib.parseOrderNumber({ no: 4, of: 12 }), 4);
    assert.strictEqual(lib.parseOrderNumber({ number: 6 }), 6);
    assert.strictEqual(lib.parseOrderNumber({ value: '7/10' }), 7);
    assert.strictEqual(lib.parseOrderNumber({ text: '9' }), 9);
    assert.strictEqual(lib.parseOrderNumber({ track: 11 }), 11);
    assert.strictEqual(lib.parseOrderNumber({ disc: 2 }), 2);
    assert.strictEqual(lib.parseOrderNumber([5, 12]), 5);
    assert.strictEqual(lib.parseOrderNumber(['06/10']), 6);
    assert.strictEqual(lib.parseOrderNumber(null), null);
    assert.strictEqual(lib.parseOrderNumber(''), null);
    assert.strictEqual(lib.parseOrderNumber('invalid'), null);
    assert.strictEqual(lib.parseOrderNumber(-5), null);
    assert.strictEqual(lib.parseOrderNumber(0), null);
  });

  await t.test('2. extractDiscAndTrackFromPath correctly parses disc and track from paths and filenames', () => {
    // Standard filename
    const f1 = lib.extractDiscAndTrackFromPath({ fileName: '01 - Intro.flac' });
    assert.strictEqual(f1.trackNumber, 1);
    assert.strictEqual(f1.discNumber, null);

    // Single digit lead track
    const f2 = lib.extractDiscAndTrackFromPath({ path: '/Music/Album/2 - Next.flac' });
    assert.strictEqual(f2.trackNumber, 2);

    // Two-digit lead track
    const f3 = lib.extractDiscAndTrackFromPath({ filePath: '10 - End.flac' });
    assert.strictEqual(f3.trackNumber, 10);

    // Combined disc-track format: 1-03 Song.dsf
    const f4 = lib.extractDiscAndTrackFromPath({ fileName: '1-03 Song.dsf' });
    assert.strictEqual(f4.discNumber, 1);
    assert.strictEqual(f4.trackNumber, 3);

    // Disc folder format: Album/CD2/05 - Solo.flac
    const f5 = lib.extractDiscAndTrackFromPath({ path: 'Artist/Album/CD2/05 - Solo.flac' });
    assert.strictEqual(f5.discNumber, 2);
    assert.strictEqual(f5.trackNumber, 5);

    // Disc folder format: Album/Disc 01/Track 07.wav
    const f6 = lib.extractDiscAndTrackFromPath({ webkitRelativePath: 'Album/Disc 01/Track 07.wav' });
    assert.strictEqual(f6.discNumber, 1);
    assert.strictEqual(f6.trackNumber, 7);

    // Year in filename should NOT be parsed as track number
    const f7 = lib.extractDiscAndTrackFromPath({ fileName: '1998 - Title.flac' });
    assert.strictEqual(f7.trackNumber, null);

    // No track number at all
    const f8 = lib.extractDiscAndTrackFromPath({ fileName: 'Bonus Track Acoustic.flac' });
    assert.strictEqual(f8.trackNumber, null);
    assert.strictEqual(f8.discNumber, null);
  });

  await t.test('3. Multi-disc albums sort Disc 1 before Disc 2, and in-disc tracks 1 to N', () => {
    const tracks = [
      { id: 'd2_t2', title: 'Disc 2 Track 2', discNumber: 2, trackNumber: 2 },
      { id: 'd1_t2', title: 'Disc 1 Track 2', discNumber: 1, trackNumber: 2 },
      { id: 'd2_t1', title: 'Disc 2 Track 1', tags: { TPOS: '2/2', TRCK: '1/10' } },
      { id: 'd1_t1', title: 'Disc 1 Track 1', metadata: { disc: '1', track: '1' } },
      { id: 'd1_t3', title: 'Disc 1 Track 3', filePath: 'CD1/03 - Track.flac' }
    ];

    const sorted = lib.sortAlbumTracks(tracks);
    const order = sorted.map(t => t.id);
    assert.deepStrictEqual(order, ['d1_t1', 'd1_t2', 'd1_t3', 'd2_t1', 'd2_t2']);
  });

  await t.test('4. Tracks without track numbers sort to the end of the album/disc', () => {
    const tracks = [
      { id: 't_unnum_b', title: 'Z Unnumbered Track B', fileName: 'Z_unnum.flac' },
      { id: 't_2', title: 'Track Two', trackNumber: 2 },
      { id: 't_1', title: 'Track One', trackNumber: 1 },
      { id: 't_unnum_a', title: 'A Unnumbered Track A', fileName: 'A_unnum.flac' }
    ];

    const sorted = lib.sortAlbumTracks(tracks);
    const order = sorted.map(t => t.id);
    // Track 1, then Track 2, then unnumbered sorted naturally by fileName/title (A before Z)
    assert.deepStrictEqual(order, ['t_1', 't_2', 't_unnum_a', 't_unnum_b']);
  });

  await t.test('5. Artist multi-album scope keeps albums grouped without interleaving track #1', () => {
    const tracks = [
      { id: 'b_t2', album: 'Album B', trackNumber: 2, title: 'B Song 2' },
      { id: 'a_t1', album: 'Album A', trackNumber: 1, title: 'A Song 1' },
      { id: 'b_t1', album: 'Album B', trackNumber: 1, title: 'B Song 1' },
      { id: 'a_t2', album: 'Album A', trackNumber: 2, title: 'A Song 2' }
    ];

    const sorted = lib.sortAlbumTracks(tracks, { groupByAlbum: true });
    const order = sorted.map(t => t.id);
    // Album A tracks 1 & 2 together, then Album B tracks 1 & 2 together
    assert.deepStrictEqual(order, ['a_t1', 'a_t2', 'b_t1', 'b_t2']);
  });

  await t.test('6. resolveTrackMetadata returns clean trackNumber and discNumber', () => {
    const meta = lib.resolveTrackMetadata(
      { track: '03/14', disc: '2/2', title: '03 My Song', artist: 'Artist' },
      { trackNumber: 3, discNumber: 2 }
    );
    assert.strictEqual(meta.trackNumber, 3);
    assert.strictEqual(meta.discNumber, 2);
    assert.strictEqual(meta.title, 'My Song');
  });

  await t.test('7. index.html DOM, showAlbumHero, renderCollectionCards & renderTrackRows integration', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // 1. renderCollectionCards sorts album tracks
    assert.ok(
      html.includes("if ((action === 'album' || action === 'artist') && typeof library.sortAlbumTracks === 'function')"),
      'renderCollectionCards must sort entry.tracks using sortAlbumTracks'
    );

    // 2. showAlbumHero sorts entry.tracks for buttons
    assert.ok(
      html.includes("const orderedTracks = typeof library.sortAlbumTracks === 'function'"),
      'showAlbumHero must sort entry.tracks using sortAlbumTracks'
    );

    // 3. renderTrackRows uses sortAlbumTracks for album scope
    assert.ok(
      html.includes("isAlbumScope && typeof library.sortAlbumTracks === 'function'"),
      'renderTrackRows must use sortAlbumTracks when isAlbumScope is active'
    );

    // 4. Audio graph invariant
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL Web Audio invariant must remain strictly intact'
    );
  });
});
