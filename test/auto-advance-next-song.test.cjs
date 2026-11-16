const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const library = require('../library-utils.js');

test('Auto-Advance & Next Song Progression Test Suite', async (t) => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  await t.test('1. Invariant: Web Audio graph output connection preserved', () => {
    assert.match(
      html,
      /state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/,
      'Audio invariant must be present in index.html'
    );
  });

  await t.test('2. Bit-Perfect callback alignment in index.html & MainActivity.java', () => {
    // Both window.onBitPerfectPlaybackComplete and window.onNativeBitPerfectPlaybackEnded must be defined
    assert.match(
      html,
      /window\.onBitPerfectPlaybackComplete\s*=/,
      'window.onBitPerfectPlaybackComplete must be defined'
    );
    assert.match(
      html,
      /window\.onNativeBitPerfectPlaybackEnded\s*=/,
      'window.onNativeBitPerfectPlaybackEnded must be defined'
    );
  });

  await t.test('3. queueTracks filters out currently playing song regardless of string/number ID type', () => {
    const pNextStart = html.indexOf('function trackById(');
    const pNextEnd = html.indexOf('function formatDecodeAudit(', pNextStart);
    assert.ok(pNextStart > 0 && pNextEnd > pNextStart);

    const helperCode = html.slice(pNextStart, pNextEnd);
    const state = {
      tracks: [
        { id: '1', title: 'Song 1' },
        { id: 2, title: 'Song 2' },
        { id: '3', title: 'Song 3' }
      ],
      currentId: 1, // numeric 1 vs string '1'
      queueTrackIds: ['1', 2, '3']
    };

    const fn = new Function('state', helperCode + '\nreturn { trackById, queueTracks };');
    const { trackById, queueTracks } = fn(state);

    // trackById should resolve both numeric 1 and string '1'
    assert.equal(trackById(1)?.id, '1');
    assert.equal(trackById('1')?.id, '1');
    assert.equal(trackById(2)?.id, 2);
    assert.equal(trackById('2')?.id, 2);

    // queueTracks must filter out currently playing song (1)
    const q = queueTracks();
    assert.equal(q.length, 2, 'Queue must not contain currently playing track');
    assert.equal(q[0].id, 2);
    assert.equal(q[1].id, '3');
  });

  await t.test('4. playNext advances sequentially and handles boundaries correctly', () => {
    const pNextStart = html.indexOf('function playNext(');
    const pNextEnd = html.indexOf('async function pickLocalFiles()', pNextStart);
    assert.ok(pNextStart > 0 && pNextEnd > pNextStart);

    const playNextCode = html.slice(pNextStart, pNextEnd);

    const tracks = [
      { id: '1', title: 'Song 1' },
      { id: '2', title: 'Song 2' },
      { id: '3', title: 'Song 3' }
    ];

    let playedTrackId = null;
    let audioCurrentTime = 0;
    const audio = {
      get currentTime() { return audioCurrentTime; },
      set currentTime(val) { audioCurrentTime = val; },
      play: () => { playedTrackId = 'audio.play_called'; return Promise.resolve(); },
      pause: () => {}
    };

    const state = {
      tracks,
      currentId: '1',
      repeat: 0,
      autoplay: true,
      shuffle: false,
      queueTrackIds: [],
      playbackContext: null,
      recentHistory: [],
      favorites: new Set(),
      activeFocus: 'all',
      sleepAtTrackEnd: false,
      preloadTrackId: null,
      roonRadio: false
    };

    function trackById(id) {
      if (id == null) return null;
      return state.tracks.find(t => t && String(t.id) === String(id));
    }
    function queueTracks() {
      const curIdStr = state.currentId != null ? String(state.currentId) : null;
      return (state.queueTrackIds || [])
        .map(trackById)
        .filter(Boolean)
        .filter(track => curIdStr == null || String(track.id) !== curIdStr);
    }
    function playTrack(id) {
      playedTrackId = id;
      state.currentId = id;
    }

    const fn = new Function(
      'state', 'audio', 'trackById', 'queueTracks', 'playTrack', 'NocturneLibrary', 'library', 'toast', 'renderQueue',
      playNextCode + '\nreturn playNext;'
    );
    const playNext = fn(state, audio, trackById, queueTracks, playTrack, library, library, () => {}, () => {});

    // (A) Normal advance from Song 1 to Song 2
    state.currentId = '1';
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '2', 'Track 1 should advance to Track 2');

    // (B) Advance from Song 2 to Song 3
    state.currentId = '2';
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '3', 'Track 2 should advance to Track 3');

    // (C) Song 3 (end of library) wraps around to Song 1 when repeat == 0 and auto == true
    state.currentId = '3';
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '1', 'End of library should wrap to Track 1');

    // (D) Repeat mode 2 repeats current song
    state.currentId = '2';
    state.repeat = 2;
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, 'audio.play_called', 'Repeat 2 should replay current song');
    assert.equal(audioCurrentTime, 0, 'Audio currentTime should reset to 0');

    // (E) Numeric currentId with string track.id does not trigger loop
    state.currentId = 2; // number
    state.repeat = 0;
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '3', 'Numeric currentId should advance to track 3');
  });

  await t.test('5. Album sequential playback transitions to next library track when album ends (repeat 0)', () => {
    const pNextStart = html.indexOf('function playNext(');
    const pNextEnd = html.indexOf('async function pickLocalFiles()', pNextStart);

    const playNextCode = html.slice(pNextStart, pNextEnd);

    const tracks = [
      { id: '1', title: 'Album 1 Track 1', album: 'Album 1' },
      { id: '2', title: 'Album 1 Track 2', album: 'Album 1' },
      { id: '3', title: 'Album 2 Track 1', album: 'Album 2' }
    ];

    let playedTrackId = null;
    const audio = { currentTime: 0, play: () => Promise.resolve(), pause: () => {} };

    const state = {
      tracks,
      currentId: '1',
      repeat: 0,
      autoplay: true,
      shuffle: false,
      queueTrackIds: ['2'],
      playbackContext: { type: 'album', key: 'Album 1', name: 'Album 1', trackIds: ['1', '2'] },
      recentHistory: [],
      favorites: new Set(),
      activeFocus: 'all',
      sleepAtTrackEnd: false,
      preloadTrackId: null,
      roonRadio: false
    };

    function trackById(id) {
      if (id == null) return null;
      return state.tracks.find(t => t && String(t.id) === String(id));
    }
    function queueTracks() {
      const curIdStr = state.currentId != null ? String(state.currentId) : null;
      return (state.queueTrackIds || [])
        .map(trackById)
        .filter(Boolean)
        .filter(track => curIdStr == null || String(track.id) !== curIdStr);
    }
    function playTrack(id) {
      playedTrackId = id;
      state.currentId = id;
    }

    const fn = new Function(
      'state', 'audio', 'trackById', 'queueTracks', 'playTrack', 'NocturneLibrary', 'library', 'toast', 'renderQueue',
      playNextCode + '\nreturn playNext;'
    );
    const playNext = fn(state, audio, trackById, queueTracks, playTrack, library, library, () => {}, () => {});

    // Track 1 ends -> plays Track 2 from queue
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '2');

    // Track 2 ends -> album finishes, should advance to Track 3 in library (not replay Track 1!)
    state.currentId = '2';
    state.queueTrackIds = [];
    playedTrackId = null;
    playNext(1, true);
    assert.equal(playedTrackId, '3', 'When album ends, playback should advance to next track in library');
  });
});
