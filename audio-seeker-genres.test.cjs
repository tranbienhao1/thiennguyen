const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Pha C: calculateTrackPlaybackPosition handles normal and CUE virtual tracks', () => {
  // Normal track
  const normalTrack = { id: 'track-1', title: 'Song 1', duration: 180 };
  const posNormal = library.calculateTrackPlaybackPosition(45, normalTrack, 180);
  assert.equal(posNormal.trackCurrentTime, 45);
  assert.equal(posNormal.trackDuration, 180);
  assert.equal(posNormal.isCue, false);
  assert.equal(posNormal.progressFraction, 0.25);

  // Normal track clamp
  const posNormalOver = library.calculateTrackPlaybackPosition(200, normalTrack, 180);
  assert.equal(posNormalOver.trackCurrentTime, 180);
  assert.equal(posNormalOver.progressFraction, 1);

  // CUE track (part of an album FLAC of 3600s, track starts at 120s, duration 200s, ends at 320s)
  const cueTrack = { id: 'track-cue-2', title: 'Movement 2', cueStart: 120, duration: 200, cueEnd: 320 };
  const posCue = library.calculateTrackPlaybackPosition(170, cueTrack, 3600);
  assert.equal(posCue.isCue, true);
  assert.equal(posCue.trackCurrentTime, 50); // 170 - 120
  assert.equal(posCue.trackDuration, 200);
  assert.equal(posCue.progressFraction, 0.25);

  // CUE track clamp before start
  const posCueUnder = library.calculateTrackPlaybackPosition(100, cueTrack, 3600);
  assert.equal(posCueUnder.trackCurrentTime, 0);

  // CUE track clamp after end
  const posCueOver = library.calculateTrackPlaybackPosition(350, cueTrack, 3600);
  assert.equal(posCueOver.trackCurrentTime, 200);
});

test('Pha C: calculateSeekTargetTime safely calculates raw target seek position', () => {
  const cueTrack = { id: 'track-cue-2', title: 'Movement 2', cueStart: 120, duration: 200, cueEnd: 320 };

  // Absolute seek within track (target 50s into track)
  const seekAbs = library.calculateSeekTargetTime(50, cueTrack, 3600);
  assert.equal(seekAbs.isCue, true);
  assert.equal(seekAbs.targetAbsoluteTime, 170); // 120 + 50
  assert.equal(seekAbs.targetTrackTime, 50);

  // Fraction seek (ratio 0.5 -> 50% into track)
  const seekFrac = library.calculateSeekTargetTime(0.5, cueTrack, 3600, { isFraction: true });
  assert.equal(seekFrac.targetAbsoluteTime, 220); // 120 + 0.5 * 200
  assert.equal(seekFrac.targetTrackTime, 100);

  // Delta seek (+15s from current raw 170s)
  const seekDeltaPos = library.calculateSeekTargetTime(0, cueTrack, 3600, { delta: 15, currentRawTime: 170 });
  assert.equal(seekDeltaPos.targetAbsoluteTime, 185);
  assert.equal(seekDeltaPos.targetTrackTime, 65);

  // Delta seek backward clamp (current raw 125s, delta -10s -> should clamp to cueStart 120s)
  const seekDeltaNeg = library.calculateSeekTargetTime(0, cueTrack, 3600, { delta: -10, currentRawTime: 125 });
  assert.equal(seekDeltaNeg.targetAbsoluteTime, 120);
  assert.equal(seekDeltaNeg.targetTrackTime, 0);

  // Delta seek forward overflow clamp (current raw 315s, delta +10s -> clamps to cueEnd - 0.15 = 319.85s)
  const seekDeltaOver = library.calculateSeekTargetTime(0, cueTrack, 3600, { delta: 10, currentRawTime: 315 });
  assert.ok(seekDeltaOver.targetAbsoluteTime <= 319.85);
  assert.ok(seekDeltaOver.targetTrackTime <= 200);

  // Normal track seek
  const normalTrack = { id: 'track-norm', duration: 240 };
  const seekNorm = library.calculateSeekTargetTime(0.75, normalTrack, 240, { isFraction: true });
  assert.equal(seekNorm.targetAbsoluteTime, 180);
  assert.equal(seekNorm.targetTrackTime, 180);
});

test('Pha C: resolveMediaSessionPositionState constructs valid payload for navigator.mediaSession', () => {
  const cueTrack = { id: 'track-cue', cueStart: 100, duration: 150, cueEnd: 250 };
  const mockAudio = { currentTime: 140, duration: 3600, playbackRate: 1 };
  const state = library.resolveMediaSessionPositionState(mockAudio, cueTrack);

  assert.equal(state.duration, 150);
  assert.equal(state.position, 40);
  assert.equal(state.playbackRate, 1);

  // Fallback on normal audio
  const mockAudioNorm = { currentTime: 60, duration: 200, playbackRate: 1 };
  const normState = library.resolveMediaSessionPositionState(mockAudioNorm, { id: 't-normal' });
  assert.equal(normState.duration, 200);
  assert.equal(normState.position, 60);
});

test('Pha C: GENRE_MOOD_DEFINITIONS and detectTrackMoodAndGenre classify tracks accurately', () => {
  assert.ok(library.GENRE_MOOD_DEFINITIONS && typeof library.GENRE_MOOD_DEFINITIONS === 'object');
  assert.ok(Object.keys(library.GENRE_MOOD_DEFINITIONS.genres).length >= 7);

  const jazzTrack = { title: 'Autumn Leaves', artist: 'Miles Davis', album: 'Kind of Blue', genre: 'Jazz' };
  const jazzDetect = library.detectTrackMoodAndGenre(jazzTrack);
  assert.ok(jazzDetect.genres.includes('Jazz & Blues'));
  assert.ok(jazzDetect.moods.includes('relax'));

  const rockTrack = { title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', genre: 'Rock' };
  const rockDetect = library.detectTrackMoodAndGenre(rockTrack);
  assert.ok(rockDetect.genres.includes('Rock & Alternative'));
  assert.ok(rockDetect.moods.includes('energy'));

  const classicalTrack = { title: 'Symphony No. 5', artist: 'Beethoven', genre: 'Classical' };
  const classDetect = library.detectTrackMoodAndGenre(classicalTrack);
  assert.ok(classDetect.genres.includes('Classical & Symphony'));
  assert.ok(classDetect.moods.includes('relax'));

  const ambientTrack = { title: 'Music for Airports', artist: 'Brian Eno', album: 'Ambient 1', genre: 'ambient' };
  const ambientDetect = library.detectTrackMoodAndGenre(ambientTrack);
  assert.ok(ambientDetect.genres.length > 0);
});

test('Pha C: groupTracksByGenreMood groups track collections into structured categories', () => {
  const tracks = [
    { id: '1', title: 'Blue in Green', artist: 'Miles Davis', genre: 'Jazz', cover: 'jazz.jpg' },
    { id: '2', title: 'So What', artist: 'Miles Davis', genre: 'Jazz', cover: 'jazz.jpg' },
    { id: '3', title: 'Clair de Lune', artist: 'Debussy', genre: 'Classical', cover: 'classic.jpg' },
    { id: '4', title: 'Stairway to Heaven', artist: 'Led Zeppelin', genre: 'Rock', cover: 'rock.jpg' },
    { id: '5', title: 'Weightless', artist: 'Marconi Union', album: 'Ambient Chill' }
  ];

  const groups = library.groupTracksByGenreMood(tracks);
  assert.ok(groups.length >= 3);

  const jazzGroup = groups.find(g => g.key === 'genre:jazz');
  assert.ok(jazzGroup);
  assert.equal(jazzGroup.tracks.length, 2);
  assert.equal(jazzGroup.cover, 'jazz.jpg');

  const classicalGroup = groups.find(g => g.key === 'genre:classical');
  assert.ok(classicalGroup);
  assert.equal(classicalGroup.tracks.length, 1);
});

test('Pha C & Engine Invariant: AudioContext Graph Destination & UI Integration', () => {
  // SUPREME INVARIANT: state.crossfeedNodes.output.connect(state.context.destination)
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination);'),
    'AUDIO ENGINE INVARIANT: crossfeed output MUST connect to context destination'
  );

  // Genre view support in setLibraryView
  assert.ok(
    indexHtml.includes("isGenreView = view === 'genres'"),
    'renderCollectionCards must recognize genres view'
  );
  assert.ok(
    indexHtml.includes("library.groupTracksByGenreMood(tracks)"),
    'renderCollectionCards must use groupTracksByGenreMood'
  );
  assert.ok(
    indexHtml.includes('data-view="genres"'),
    'Sidebar must have genres navigation button'
  );

  // MediaSession seek integration
  assert.ok(
    indexHtml.includes("library.resolveMediaSessionPositionState"),
    'MediaSession updatePositionState must resolve position state via library helper'
  );
  assert.ok(
    indexHtml.includes("action('seekto'"),
    'MediaSession must handle seekto action'
  );
  assert.ok(
    indexHtml.includes("action('seekbackward'"),
    'MediaSession must handle seekbackward action'
  );
  assert.ok(
    indexHtml.includes("action('seekforward'"),
    'MediaSession must handle seekforward action'
  );
});
