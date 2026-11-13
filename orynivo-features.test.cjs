'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const library = require('./library-utils.js');

// Read and inspect index.html for DOM & script integration tests
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');

// ── 1. parseCueSheet Test Suite ──

describe('parseCueSheet — Orynivo CUE Sheet Parser', () => {
  it('parses single-track CUE sheet with title, performer, and file', () => {
    const singleCue = `
PERFORMER "Norah Jones"
TITLE "Come Away with Me"
FILE "01 - Don't Know Why.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Don't Know Why"
    INDEX 01 00:00:00
`;
    const tracks = library.parseCueSheet(singleCue);
    assert.ok(Array.isArray(tracks), 'Should return an array');
    assert.equal(tracks.length, 1);
    assert.equal(tracks.artist, 'Norah Jones');
    assert.equal(tracks.album, 'Come Away with Me');
    assert.equal(tracks.file, "01 - Don't Know Why.flac");

    const track1 = tracks[0];
    assert.equal(track1.number, 1);
    assert.equal(track1.title, "Don't Know Why");
    assert.equal(track1.artist, 'Norah Jones', 'Should inherit global performer');
    assert.equal(track1.album, 'Come Away with Me', 'Should inherit global album');
    assert.equal(track1.offset, 0);
  });

  it('parses multi-track CUE sheets with exact MM:SS:FF frame conversion at 75fps', () => {
    const multiCue = `
REM GENRE "Jazz"
REM DATE 1959
PERFORMER "Miles Davis"
TITLE "Kind of Blue"
FILE "Miles Davis - Kind of Blue.wav" WAVE
  TRACK 01 AUDIO
    TITLE "So What"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Freddie Freeloader"
    INDEX 00 09:22:00
    INDEX 01 09:22:50
  TRACK 03 AUDIO
    TITLE "Blue in Green"
    INDEX 01 19:09:25
`;
    const tracks = library.parseCueSheet(multiCue);
    assert.equal(tracks.length, 3);
    assert.equal(tracks.genre, 'Jazz');
    assert.equal(tracks.date, '1959');

    // Track 1: 00:00:00 -> 0.0s
    assert.equal(tracks[0].offset, 0);
    assert.equal(tracks[0].number, 1);
    assert.equal(tracks[0].title, 'So What');

    // Track 2: INDEX 01 09:22:50 -> 9 * 60 + 22 + 50 / 75 = 562 + 2/3 = 562.6666666666666
    const expectedOffset2 = 9 * 60 + 22 + 50 / 75;
    assert.equal(tracks[1].offset, expectedOffset2);
    assert.equal(tracks[1].number, 2);
    assert.equal(tracks[1].title, 'Freddie Freeloader');

    // Consecutive duration for Track 1 = offset2 - offset1
    assert.equal(tracks[0].duration, expectedOffset2);

    // Track 3: INDEX 01 19:09:25 -> 19 * 60 + 9 + 25 / 75 = 1149 + 1/3 = 1149.3333333333333
    const expectedOffset3 = 19 * 60 + 9 + 25 / 75;
    assert.equal(tracks[2].offset, expectedOffset3);
    assert.equal(tracks[2].number, 3);
    assert.equal(tracks[2].title, 'Blue in Green');

    // Consecutive duration for Track 2 = offset3 - offset2
    assert.equal(tracks[1].duration, expectedOffset3 - expectedOffset2);
  });

  it('calculates last track duration when totalDuration is provided', () => {
    const cue = `
PERFORMER "Artist"
TITLE "Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Track 1"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Track 2"
    INDEX 01 03:30:00
`;
    const totalDuration = 300; // 5 minutes
    const tracks = library.parseCueSheet(cue, totalDuration);
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].duration, 210); // 3m30s
    assert.equal(tracks[1].duration, 90); // 300 - 210 = 90s
  });

  it('correctly handles performer and title inheritance for compilation/various artists albums', () => {
    const compilationCue = `
TITLE "Audiophile Reference Sampler"
PERFORMER "Various Artists"
FILE "sampler.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Autumn Leaves"
    PERFORMER "Cannonball Adderley"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Desafinado"
    PERFORMER "Stan Getz"
    INDEX 01 04:15:30
  TRACK 03 AUDIO
    TITLE "Interlude"
    INDEX 01 08:30:00
`;
    const tracks = library.parseCueSheet(compilationCue);
    assert.equal(tracks[0].artist, 'Cannonball Adderley', 'Specific performer should override album performer');
    assert.equal(tracks[0].album, 'Audiophile Reference Sampler');

    assert.equal(tracks[1].artist, 'Stan Getz', 'Specific performer should override album performer');
    assert.equal(tracks[1].album, 'Audiophile Reference Sampler');

    assert.equal(tracks[2].artist, 'Various Artists', 'Track without performer should inherit album performer');
    assert.equal(tracks[2].title, 'Interlude');
  });

  it('safely handles empty, null, and malformed CUE sheet input', () => {
    const emptyResult = library.parseCueSheet('');
    assert.ok(Array.isArray(emptyResult));
    assert.equal(emptyResult.length, 0);

    const nullResult = library.parseCueSheet(null);
    assert.ok(Array.isArray(nullResult));
    assert.equal(nullResult.length, 0);

    const undefinedResult = library.parseCueSheet(undefined);
    assert.ok(Array.isArray(undefinedResult));
    assert.equal(undefinedResult.length, 0);

    const malformedResult = library.parseCueSheet('RANDOM JUNK NOT A CUE SHEET\nANOTHER BAD LINE');
    assert.ok(Array.isArray(malformedResult));
    assert.equal(malformedResult.length, 0);
  });
});

// ── 2. evaluateSmartPlaylist Test Suite ──

describe('evaluateSmartPlaylist — Dynamic Audiophile Playlist Filtering', () => {
  const dsdTrack = {
    title: 'Hotel California',
    artist: 'Eagles',
    genre: 'Classic Rock',
    format: 'DSF',
    isDsd: true,
    duration: 390,
    isFavorite: true,
    rating: 5
  };

  const hiResTrack = {
    title: 'Time',
    artist: 'Pink Floyd',
    genre: 'Progressive Rock',
    format: 'FLAC',
    sampleRate: 96000,
    bitDepth: 24,
    duration: 425,
    isFavorite: true,
    rating: 4
  };

  const cdTrack = {
    title: 'Billie Jean',
    artist: 'Michael Jackson',
    genre: 'Pop',
    format: 'FLAC',
    sampleRate: 44100,
    bitDepth: 16,
    duration: 294,
    isFavorite: false,
    rating: 3
  };

  const mp3Track = {
    title: 'Short Intro',
    artist: 'Unknown',
    genre: 'Acoustic',
    format: 'MP3',
    duration: 90,
    isFavorite: false,
    rating: 1
  };

  it('filters by format presets: DSD, Hi-Res, Lossless', () => {
    // DSD preset
    assert.equal(library.evaluateSmartPlaylist({ format: 'dsd' }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ format: 'dsd' }, hiResTrack), false);
    assert.equal(library.evaluateSmartPlaylist({ format: 'dsd' }, cdTrack), false);

    // Hi-Res preset
    assert.equal(library.evaluateSmartPlaylist({ format: 'hires' }, hiResTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ format: 'hires' }, cdTrack), false);
    assert.equal(library.evaluateSmartPlaylist({ format: 'hires' }, mp3Track), false);

    // Lossless preset
    assert.equal(library.evaluateSmartPlaylist({ format: 'lossless' }, cdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ format: 'lossless' }, hiResTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ format: 'lossless' }, mp3Track), false);

    // Specific format
    assert.equal(library.evaluateSmartPlaylist({ format: 'mp3' }, mp3Track), true);
    assert.equal(library.evaluateSmartPlaylist({ format: 'mp3' }, cdTrack), false);
  });

  it('filters by favorite status', () => {
    assert.equal(library.evaluateSmartPlaylist({ favorite: true }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ favorite: true }, cdTrack), false);
    assert.equal(library.evaluateSmartPlaylist({ favorite: false }, cdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ favorite: false }, dsdTrack), false);
  });

  it('filters by duration thresholds (minDuration & maxDuration)', () => {
    // Min duration: 240 seconds (4 minutes)
    assert.equal(library.evaluateSmartPlaylist({ minDuration: 240 }, dsdTrack), true); // 390s
    assert.equal(library.evaluateSmartPlaylist({ minDuration: 240 }, hiResTrack), true); // 425s
    assert.equal(library.evaluateSmartPlaylist({ minDuration: 240 }, mp3Track), false); // 90s

    // Max duration: 300 seconds (5 minutes)
    assert.equal(library.evaluateSmartPlaylist({ maxDuration: 300 }, mp3Track), true); // 90s
    assert.equal(library.evaluateSmartPlaylist({ maxDuration: 300 }, cdTrack), true); // 294s
    assert.equal(library.evaluateSmartPlaylist({ maxDuration: 300 }, dsdTrack), false); // 390s

    // Bounded range: 250s to 400s
    assert.equal(library.evaluateSmartPlaylist({ minDuration: 250, maxDuration: 400 }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ minDuration: 250, maxDuration: 400 }, hiResTrack), false);
  });

  it('filters by artist and genre (case-insensitive substring)', () => {
    assert.equal(library.evaluateSmartPlaylist({ artist: 'eagles' }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ artist: 'FLOYD' }, hiResTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ artist: 'Beatles' }, dsdTrack), false);

    assert.equal(library.evaluateSmartPlaylist({ genre: 'rock' }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ genre: 'progressive' }, hiResTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ genre: 'Classical' }, hiResTrack), false);
  });

  it('filters by rating (minRating, maxRating, and exact rating)', () => {
    assert.equal(library.evaluateSmartPlaylist({ minRating: 4 }, dsdTrack), true); // 5 >= 4
    assert.equal(library.evaluateSmartPlaylist({ minRating: 4 }, hiResTrack), true); // 4 >= 4
    assert.equal(library.evaluateSmartPlaylist({ minRating: 4 }, cdTrack), false); // 3 < 4

    assert.equal(library.evaluateSmartPlaylist({ maxRating: 3 }, cdTrack), true); // 3 <= 3
    assert.equal(library.evaluateSmartPlaylist({ maxRating: 3 }, dsdTrack), false); // 5 > 3

    assert.equal(library.evaluateSmartPlaylist({ rating: 5 }, dsdTrack), true);
    assert.equal(library.evaluateSmartPlaylist({ rating: 5 }, hiResTrack), false);
  });

  it('evaluates combined smart preset: Top Yêu Thích > 4m', () => {
    const topLongPreset = { favorite: true, minDuration: 240 };
    assert.equal(library.evaluateSmartPlaylist(topLongPreset, dsdTrack), true); // Fav=true, 390s
    assert.equal(library.evaluateSmartPlaylist(topLongPreset, hiResTrack), true); // Fav=true, 425s
    assert.equal(library.evaluateSmartPlaylist(topLongPreset, cdTrack), false); // Fav=false
    assert.equal(library.evaluateSmartPlaylist(topLongPreset, mp3Track), false); // Fav=false, 90s
  });
});

// ── 3. clampRating and formatRating Test Suite ──

describe('clampRating & formatRating — 5-Star Audiophile Rating', () => {
  it('clampRating clamps within [0, 5] as integers', () => {
    assert.equal(library.clampRating(0), 0);
    assert.equal(library.clampRating(1), 1);
    assert.equal(library.clampRating(3), 3);
    assert.equal(library.clampRating(5), 5);

    // Upper and lower bounds
    assert.equal(library.clampRating(6), 5);
    assert.equal(library.clampRating(100), 5);
    assert.equal(library.clampRating(-1), 0);
    assert.equal(library.clampRating(-99), 0);

    // Floating point rounding
    assert.equal(library.clampRating(3.2), 3);
    assert.equal(library.clampRating(3.7), 4);
    assert.equal(library.clampRating(4.5), 5);

    // String coercion
    assert.equal(library.clampRating('4'), 4);
    assert.equal(library.clampRating('0'), 0);

    // Invalid / Falsy values
    assert.equal(library.clampRating(null), 0);
    assert.equal(library.clampRating(undefined), 0);
    assert.equal(library.clampRating(NaN), 0);
    assert.equal(library.clampRating('invalid'), 0);
  });

  it('formatRating returns correct Unicode star strings', () => {
    assert.equal(library.formatRating(0), '☆☆☆☆☆');
    assert.equal(library.formatRating(1), '★☆☆☆☆');
    assert.equal(library.formatRating(2), '★★☆☆☆');
    assert.equal(library.formatRating(3), '★★★☆☆');
    assert.equal(library.formatRating(4), '★★★★☆');
    assert.equal(library.formatRating(5), '★★★★★');

    // Clamping on formatted output
    assert.equal(library.formatRating(-3), '☆☆☆☆☆');
    assert.equal(library.formatRating(10), '★★★★★');
    assert.equal(library.formatRating(null), '☆☆☆☆☆');
    assert.equal(library.formatRating(undefined), '☆☆☆☆☆');
  });
});

// ── 4. index.html DOM Elements & Integration Test Suite ──

describe('index.html DOM & Script Integration — Orynivo Features', () => {
  it('contains #room-rating element in Listening Room with 5 rating stars', () => {
    assert.match(html, /id="room-rating"/, '#room-rating element must exist in DOM');

    // Verify 5 interactive stars with data-rating 1 through 5
    for (let r = 1; r <= 5; r++) {
      assert.match(
        html,
        new RegExp(`data-rating="${r}"`),
        `Star element with data-rating="${r}" must exist in #room-rating`
      );
    }
  });

  it('contains Smart Playlists navigation and presets in sidebar and focus bar', () => {
    // Smart Playlists container in sidebar
    assert.match(html, /id="smart-playlists-section"/, '#smart-playlists-section must exist in sidebar');

    // Preset buttons with data-smart-playlist
    assert.match(html, /data-smart-playlist="dsd"/, 'DSD Collection smart playlist item must exist');
    assert.match(html, /data-smart-playlist="hires"/, 'Hi-Res Audiophile smart playlist item must exist');
    assert.match(html, /data-smart-playlist="fav-long"/, 'Top Yêu Thích > 4m smart playlist item must exist');
  });

  it('file input elements accept .cue extension', () => {
    // #file-input and #folder-input accept attribute must include .cue
    assert.match(html, /id="file-input"[^>]*accept="[^"]*\.cue[^"]*"/, '#file-input must accept .cue files');
    assert.match(html, /id="folder-input"[^>]*accept="[^"]*\.cue[^"]*"/, '#folder-input must accept .cue files');
  });

  it('script handles .cue file parsing via FileReader and library.parseCueSheet', () => {
    const parsesCue =
      /parseCueSheet/.test(appCode) &&
      /FileReader/.test(appCode);
    assert.ok(parsesCue, 'Script must integrate FileReader and parseCueSheet for .cue processing');
  });

  it('script supports cueStart and cueEnd playback offsets for virtual CUE tracks', () => {
    const handlesOffsets =
      /cueStart/.test(appCode) &&
      /cueEnd/.test(appCode);
    assert.ok(handlesOffsets, 'Script must manage cueStart and cueEnd offsets for playback tracking');
  });

  it('script persists ratings in localStorage under nocturne-rating- prefix', () => {
    const persistsRating =
      /nocturne-rating-/.test(appCode);
    assert.ok(persistsRating, 'Script must persist track ratings in localStorage using nocturne-rating- prefix');
  });

  it('script evaluates smart playlist criteria in track filtering', () => {
    const evaluatesSmart =
      /evaluateSmartPlaylist/.test(appCode);
    assert.ok(evaluatesSmart, 'Script must invoke evaluateSmartPlaylist to filter active smart playlist');
  });
});

// ── 5. Audio Routing Invariant Test Suite ──

describe('Audio Graph Invariant — Strict Output Preservation', () => {
  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
    const invariantMatches = appCode.includes('state.crossfeedNodes.output.connect(state.context.destination)');
    assert.ok(
      invariantMatches,
      'Invariant VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be strictly present in script'
    );
  });
});
