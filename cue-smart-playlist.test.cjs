'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library-utils.js');

test('parseCueSheet parses standard CUE sheet into structured tracks', () => {
  const cueContent = `
REM GENRE "Progressive Rock"
REM DATE 1973
PERFORMER "Pink Floyd"
TITLE "The Dark Side of the Moon"
SONGWRITER "Pink Floyd"
FILE "Pink Floyd - The Dark Side of the Moon.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Speak to Me"
    PERFORMER "Pink Floyd"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Breathe (In the Air)"
    PERFORMER "Pink Floyd"
    INDEX 00 01:08:00
    INDEX 01 01:08:73
  TRACK 03 AUDIO
    TITLE "On the Run"
    INDEX 01 03:57:25
`;

  const tracks = library.parseCueSheet(cueContent);

  assert.ok(Array.isArray(tracks), 'Should return an array');
  assert.equal(tracks.length, 3, 'Should have 3 tracks');
  assert.equal(tracks.album, 'The Dark Side of the Moon');
  assert.equal(tracks.artist, 'Pink Floyd');
  assert.equal(tracks.file, 'Pink Floyd - The Dark Side of the Moon.flac');

  // Track 1
  assert.equal(tracks[0].number, 1);
  assert.equal(tracks[0].title, 'Speak to Me');
  assert.equal(tracks[0].artist, 'Pink Floyd');
  assert.equal(tracks[0].album, 'The Dark Side of the Moon');
  assert.equal(tracks[0].file, 'Pink Floyd - The Dark Side of the Moon.flac');
  assert.equal(tracks[0].offset, 0);

  // Track 2: INDEX 01 01:08:73 -> 1*60 + 8 + 73/75 = 68.97333333333333
  const expectedTrack2Offset = 1 * 60 + 8 + 73 / 75;
  assert.equal(tracks[1].number, 2);
  assert.equal(tracks[1].title, 'Breathe (In the Air)');
  assert.equal(tracks[1].offset, expectedTrack2Offset);

  // Consecutive duration difference
  assert.equal(tracks[0].duration, expectedTrack2Offset - 0);

  // Track 3: INDEX 01 03:57:25 -> 3*60 + 57 + 25/75 = 237.33333333333334
  const expectedTrack3Offset = 3 * 60 + 57 + 25 / 75;
  assert.equal(tracks[2].number, 3);
  assert.equal(tracks[2].title, 'On the Run');
  assert.equal(tracks[2].offset, expectedTrack3Offset);
  assert.equal(tracks[1].duration, expectedTrack3Offset - expectedTrack2Offset);

  // Total duration calculation for last track if passed
  const tracksWithTotal = library.parseCueSheet(cueContent, 400);
  assert.equal(tracksWithTotal[2].duration, 400 - expectedTrack3Offset);
});

test('parseCueSheet handles empty or malformed input safely', () => {
  const empty = library.parseCueSheet('');
  assert.ok(Array.isArray(empty));
  assert.equal(empty.length, 0);

  const nonString = library.parseCueSheet(null);
  assert.ok(Array.isArray(nonString));
  assert.equal(nonString.length, 0);
});

test('evaluateSmartPlaylist filters tracks correctly by format', () => {
  const dsdTrack = { title: 'Track 1', format: 'DSF', isDsd: true, duration: 300 };
  const hiResTrack = { title: 'Track 2', format: 'FLAC', sampleRate: 96000, bitDepth: 24, duration: 250 };
  const cdTrack = { title: 'Track 3', format: 'FLAC', sampleRate: 44100, bitDepth: 16, duration: 180 };

  assert.equal(library.evaluateSmartPlaylist({ format: 'dsd' }, dsdTrack), true);
  assert.equal(library.evaluateSmartPlaylist({ format: 'dsd' }, hiResTrack), false);
  assert.equal(library.evaluateSmartPlaylist({ format: 'hires' }, hiResTrack), true);
  assert.equal(library.evaluateSmartPlaylist({ format: 'hires' }, cdTrack), false);
  assert.equal(library.evaluateSmartPlaylist({ format: 'lossless' }, cdTrack), true);
});

test('evaluateSmartPlaylist filters by favorite, duration, artist, genre and rating', () => {
  const track = {
    title: 'Comfortably Numb',
    artist: 'Pink Floyd',
    genre: 'Progressive Rock',
    duration: 382,
    isFavorite: true,
    rating: 5
  };

  // Matching rules
  assert.equal(library.evaluateSmartPlaylist({ favorite: true, minDuration: 240 }, track), true);
  assert.equal(library.evaluateSmartPlaylist({ artist: 'pink', minRating: 4 }, track), true);
  assert.equal(library.evaluateSmartPlaylist({ genre: 'rock', maxDuration: 400 }, track), true);

  // Non-matching rules
  assert.equal(library.evaluateSmartPlaylist({ favorite: false }, track), false);
  assert.equal(library.evaluateSmartPlaylist({ minDuration: 400 }, track), false);
  assert.equal(library.evaluateSmartPlaylist({ maxDuration: 300 }, track), false);
  assert.equal(library.evaluateSmartPlaylist({ artist: 'Led Zeppelin' }, track), false);
  assert.equal(library.evaluateSmartPlaylist({ genre: 'Jazz' }, track), false);
  assert.equal(library.evaluateSmartPlaylist({ minRating: 6 }, track), false);
});

test('clampRating clamps ratings between 0 and 5 stars (integer)', () => {
  assert.equal(library.clampRating(0), 0);
  assert.equal(library.clampRating(3), 3);
  assert.equal(library.clampRating(5), 5);
  assert.equal(library.clampRating(6), 5);
  assert.equal(library.clampRating(99), 5);
  assert.equal(library.clampRating(-1), 0);
  assert.equal(library.clampRating(-50), 0);
  assert.equal(library.clampRating(3.2), 3);
  assert.equal(library.clampRating(3.7), 4);
  assert.equal(library.clampRating('4'), 4);
  assert.equal(library.clampRating(null), 0);
  assert.equal(library.clampRating(undefined), 0);
  assert.equal(library.clampRating(NaN), 0);
});

test('formatRating returns correct star symbols', () => {
  assert.equal(library.formatRating(0), '☆☆☆☆☆');
  assert.equal(library.formatRating(1), '★☆☆☆☆');
  assert.equal(library.formatRating(2), '★★☆☆☆');
  assert.equal(library.formatRating(3), '★★★☆☆');
  assert.equal(library.formatRating(4), '★★★★☆');
  assert.equal(library.formatRating(5), '★★★★★');
  assert.equal(library.formatRating(-2), '☆☆☆☆☆');
  assert.equal(library.formatRating(10), '★★★★★');
  assert.equal(library.formatRating(null), '☆☆☆☆☆');
});
