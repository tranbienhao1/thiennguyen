'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));

test('1. parseCueSheet handles UTF-8 BOM, multi-file CUE duration boundaries, and EAC noncompliant pre-gap layout', () => {
  const multiCue = '\uFEFFREM GENRE "Rock"\n' +
    'REM DATE 1973\n' +
    'PERFORMER "Pink Floyd"\n' +
    'TITLE "Dark Side Multi"\n' +
    'FILE "01 - Speak to Me.flac" WAVE\n' +
    '  TRACK 01 AUDIO\n' +
    '    TITLE "Speak to Me"\n' +
    '    INDEX 01 00:00:00\n' +
    '  TRACK 02 AUDIO\n' +
    '    TITLE "Breathe"\n' +
    '    INDEX 00 01:08:00\n' +
    'FILE "02 - Breathe & On the Run.flac" WAVE\n' +
    '    INDEX 01 00:00:00\n' +
    '  TRACK 03 AUDIO\n' +
    '    TITLE "On the Run"\n' +
    '    INDEX 01 02:43:00\n';

  const parsed = library.parseCueSheet(multiCue, 999);
  assert.equal(parsed.length, 3);
  assert.equal(parsed.genre, 'Rock', 'UTF-8 BOM on line 1 must not break REM GENRE parsing');
  assert.equal(parsed.date, '1973');
  assert.equal(parsed.album, 'Dark Side Multi');
  assert.equal(parsed.isMultiFile, true);
  assert.deepEqual(parsed.files, ['01 - Speak to Me.flac', '02 - Breathe & On the Run.flac']);

  // Track 1 is last track in 01.flac -> must NOT subtract Track 2's offset or apply totalDuration
  assert.equal(parsed[0].file, '01 - Speak to Me.flac');
  assert.equal(parsed[0].offset, 0);
  assert.equal(parsed[0].hasNextInFile, false);
  assert.equal(parsed[0].duration, 0);

  // Track 2 had INDEX 00 in 01.flac, then FILE 02 + INDEX 01 00:00:00 -> must bind to 02.flac!
  assert.equal(parsed[1].file, '02 - Breathe & On the Run.flac');
  assert.equal(parsed[1].offset, 0);
  assert.equal(parsed[1].hasNextInFile, true);
  assert.equal(parsed[1].duration, 163);

  // Track 3 is last track in 02.flac -> duration 0 (resolved from 02.flac sibling duration)
  assert.equal(parsed[2].file, '02 - Breathe & On the Run.flac');
  assert.equal(parsed[2].offset, 163);
  assert.equal(parsed[2].hasNextInFile, false);
  assert.equal(parsed[2].duration, 0);
});

test('2. Android/FiiO expandFiioScannedCueSheets resolves multi-file CUE per-FILE, sets cueEnd, and persists cueEnd', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const compactStart = html.indexOf('function compactFiioTrackForStorage(t, ultraLean) {');
  const compactEnd = html.indexOf('function saveFiioCatalog(tracks) {', compactStart);
  const cueStart = html.indexOf('function fiioCueHash(str) {');
  const cueEnd = html.indexOf('function ingestFiioScannedFilesChunk(', cueStart);
  assert.ok(compactStart > 0 && compactEnd > compactStart && cueStart > 0 && cueEnd > cueStart);

  const dir = '/storage/1234-5678/Music/Pink Floyd/Disc 1';
  const cuePath = dir + '/Album.cue';
  const f1Path = dir + '/01 - Speak to Me.flac';
  const f2Path = dir + '/02 - Suite.flac';
  const multiCueText =
    'PERFORMER "Pink Floyd"\n' +
    'TITLE "Dark Side Multi"\n' +
    'FILE "01 - Speak to Me.wav" WAVE\n' +
    '  TRACK 01 AUDIO\n' +
    '    TITLE "Speak to Me"\n' +
    '    INDEX 01 00:00:00\n' +
    'FILE "02 - Suite.wav" WAVE\n' +
    '  TRACK 02 AUDIO\n' +
    '    TITLE "Breathe"\n' +
    '    INDEX 01 00:00:00\n' +
    '  TRACK 03 AUDIO\n' +
    '    TITLE "On the Run"\n' +
    '    INDEX 01 02:43:00\n';

  const state = {
    currentId: null,
    tracks: [
      { id: 'fiio_f1', source: 'local', name: '01 - Speak to Me', title: '01 - Speak to Me', path: f1Path, url: 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(f1Path), duration: 180, format: 'FLAC' },
      { id: 'fiio_f2', source: 'local', name: '02 - Suite', title: '02 - Suite', path: f2Path, url: 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(f2Path), duration: 300, format: 'FLAC' }
    ]
  };

  const sandbox = {
    state,
    library,
    window: {
      NocturneNative: {
        readLocalTextFile: p => (p === cuePath ? multiCueText : '')
      }
    },
    restoreLocalTrackUrlSync: tr => {
      if (!tr.url && tr.path) tr.url = 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(tr.path);
    },
    encodeURIComponent,
    Map, Set, Array, Object, String, Number, Boolean, Math, RegExp, console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(compactStart, compactEnd) + '\n' +
    html.slice(cueStart, cueEnd) +
    '\nthis.__exports = { compactFiioTrackForStorage, hydrateFiioStoredTrack, expandFiioScannedCueSheets };',
    sandbox
  );

  const added = sandbox.__exports.expandFiioScannedCueSheets([{ path: cuePath, name: 'Album.cue' }]);
  assert.equal(added, 3, 'Should expand all 3 sub-tracks across both FLAC files');
  assert.equal(state.tracks.length, 3, 'Both unsplit parent FLAC files must be replaced by CUE sub-tracks');

  assert.equal(state.tracks[0].title, 'Speak to Me');
  assert.equal(state.tracks[0].path, f1Path);
  assert.equal(state.tracks[0].cueStart, 0);
  assert.equal(state.tracks[0].cueEnd, 0, 'Last/only track of 01.flac should let file end naturally');
  assert.equal(state.tracks[0].duration, 180);

  assert.equal(state.tracks[1].title, 'Breathe');
  assert.equal(state.tracks[1].path, f2Path);
  assert.equal(state.tracks[1].cueStart, 0);
  assert.equal(state.tracks[1].cueEnd, 163, 'Non-last track of 02.flac must carry exact cueEnd');
  assert.equal(state.tracks[1].duration, 163);

  assert.equal(state.tracks[2].title, 'On the Run');
  assert.equal(state.tracks[2].path, f2Path);
  assert.equal(state.tracks[2].cueStart, 163);
  assert.equal(state.tracks[2].cueEnd, 0);
  assert.equal(state.tracks[2].duration, 137);

  // Verify cueEnd survives compact/hydrate roundtrip
  const compacted = sandbox.__exports.compactFiioTrackForStorage(state.tracks[1], true);
  assert.equal(compacted.cueEnd, 163);
  const hydrated = sandbox.__exports.hydrateFiioStoredTrack(compacted);
  assert.equal(hydrated.cueEnd, 163);
});

test('3. attachDeckEvents retries mid-track MEDIA_ERR_NETWORK/DECODE via recoverStalledAudioStream & preserves CUE duration on loadedmetadata', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const deckStart = html.indexOf('function attachDeckEvents(element) {');
  const deckEnd = html.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckStart);
  const wdStart = html.indexOf("let watchdogLastSrc = '';");
  const wdEnd = html.indexOf('function runProactiveGaplessPreloadTick()', wdStart);
  assert.ok(deckStart > 0 && deckEnd > deckStart && wdStart > 0 && wdEnd > wdStart);

  let fakeNow = 1700000000000;
  let tokenRefreshCalls = 0;
  let loadCalls = 0;
  let playCalls = 0;
  let playNextCalls = [];
  let toasts = [];
  let pauseFlippedToPlayIcon = false;

  function makeDeck() {
    const handlers = {};
    return {
      src: '',
      currentTime: 0,
      duration: 300,
      paused: false,
      ended: false,
      readyState: 4,
      error: null,
      buffered: { length: 0 },
      dataset: {},
      addEventListener(type, fn, opts) {
        (handlers[type] = handlers[type] || []).push({ fn, once: Boolean(opts && opts.once) });
      },
      fire(type) {
        const list = (handlers[type] || []).slice();
        for (const entry of list) {
          if (entry.once) {
            const idx = handlers[type].indexOf(entry);
            if (idx !== -1) handlers[type].splice(idx, 1);
          }
          entry.fn();
        }
      },
      load() {
        // Simulate browser firing transient pause when replacing src
        this.fire('pause');
      },
      play() {
        playCalls++;
        this.paused = false;
        return Promise.resolve();
      }
    };
  }

  const audio = makeDeck();
  const standbyAudio = makeDeck();
  const googleTrack = {
    id: 'google:g1',
    source: 'google',
    title: 'Drive Lossless',
    url: 'blob:drive-initial',
    isDsd: false,
    load: async () => {
      loadCalls++;
      googleTrack.url = 'blob:drive-refreshed-' + loadCalls;
    }
  };
  const cueTrack = {
    id: 'local:cue-2',
    source: 'local',
    isCue: true,
    cueStart: 300,
    cueEnd: 540,
    duration: 240,
    title: 'CUE Track 2',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fsd%2Falbum.flac',
    isDsd: false
  };
  const state = {
    tracks: [googleTrack, cueTrack],
    currentId: 'google:g1',
    playGeneration: 7,
    errorSkipCount: 0,
    isPlaybackLoading: false,
    isNativeBitPerfectPlaying: false,
    isSeeking: false,
    crossfadeSeconds: 0,
    repeat: 0,
    context: { state: 'running', resume: async () => {} }
  };

  const domCache = {};
  const $ = id => {
    if (!domCache[id]) {
      domCache[id] = {
        _text: '',
        get textContent() { return this._text; },
        set textContent(v) {
          this._text = String(v);
          if (id === 'play-button' && v === '▶') pauseFlippedToPlayIcon = true;
        },
        value: '0',
        className: '',
        classList: { add() {}, remove() {} },
        matches: () => false
      };
    }
    return domCache[id];
  };

  const sandbox = {
    state,
    audio,
    standbyAudio,
    library: {
      shouldPreloadNext: () => false
    },
    navigator: { onLine: true },
    location: { href: 'https://appassets.androidplatform.net/index.html' },
    document: { hidden: false },
    Date: { now: () => fakeNow },
    Math, Number, String, Boolean, Array, Map, Set, Promise, URL, console,
    setTimeout, clearTimeout,
    $,
    toast: msg => toasts.push(msg),
    playNext: (dir, auto) => playNextCalls.push([dir, auto]),
    setVisualizerRunning: () => {},
    updatePositionState: () => {},
    updateMetadataFilters: () => {},
    scheduleTrackRender: () => {},
    updateLyricsHighlight: () => {},
    syncSeek: () => {},
    paintSeek: () => {},
    formatTime: s => String(Math.round(Number(s) || 0)),
    formatRemainingTime: () => '',
    queueIndex: () => -1,
    ensureGoogleToken: async force => {
      if (force) tokenRefreshCalls++;
      return 'fresh-token';
    },
    ensureLocalTrackPlayableUrl: async tr => tr.url,
    releaseTrackUrl: () => {},
    lastDisplayedPlaybackSecond: -1,
    lastPositionStateSecond: -1
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(wdStart, wdEnd) + '\n' +
    html.slice(deckStart, deckEnd) +
    '\nattachDeckEvents(audio); attachDeckEvents(standbyAudio);',
    sandbox
  );

  // 3a. Simulate normal playback to 92.4s so _lastKnownPlayPosition is recorded
  audio.src = googleTrack.url;
  audio.currentTime = 92.4;
  audio.fire('timeupdate');
  assert.equal(googleTrack._lastKnownPlayPosition, 92.4);

  // 3b. Simulate Chromium resetting currentTime to 0 and firing MEDIA_ERR_NETWORK (code 2)
  audio.currentTime = 0;
  audio.error = { code: 2 };
  audio.fire('error');
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(playNextCalls.length, 0, 'First mid-track MEDIA_ERR_NETWORK must auto-reconnect instead of skipping');
  assert.equal(tokenRefreshCalls, 1, 'Google Drive media_error reconnect must force-refresh OAuth token');
  assert.equal(loadCalls, 1, 'Reconnect must invoke track.load()');
  assert.equal(audio.src, 'blob:drive-refreshed-1');
  assert.equal(pauseFlippedToPlayIcon, false, 'Transient pause during reconnect must not flip Play/Pause icon to ▶');

  // loadedmetadata after reconnect restores 92.4s and calls play()
  audio.duration = 300;
  audio.fire('loadedmetadata');
  await new Promise(r => setImmediate(r));
  assert.ok(Math.abs(audio.currentTime - 92.4) < 0.01, 'Reconnect must restore _lastKnownPlayPosition when browser zeroed currentTime');
  assert.equal(playCalls, 1);

  // 3c. Second error in the same playGeneration must NOT loop — must skip cleanly
  fakeNow += 20000;
  audio.error = { code: 2 };
  audio.fire('error');
  assert.equal(playNextCalls.length, 1, 'Second error in same playGeneration must skip to next track');
  assert.deepEqual(playNextCalls[0], [1, false]);

  // 3d. Offline Local /local-media stream with MEDIA_ERR_DECODE still reconnects with _sr cache-buster
  sandbox.navigator.onLine = false;
  state.currentId = 'local:cue-2';
  state.playGeneration = 8;
  audio.src = cueTrack.url;
  audio.currentTime = 345;
  audio.duration = 3600;
  audio.fire('timeupdate');
  audio.error = { code: 3 };
  audio.fire('error');
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(playNextCalls.length, 1, 'Offline local MEDIA_ERR_DECODE must auto-reconnect instead of skipping');
  assert.ok(audio.src.includes('/local-media?path=%2Fsd%2Falbum.flac&_sr='), 'Local reconnect must append _sr cache-buster');

  // 3e. loadedmetadata on CUE sub-track must NOT overwrite track.duration (240s) with parent file's 3600s!
  audio.duration = 3600;
  audio.fire('loadedmetadata');
  await new Promise(r => setImmediate(r));
  assert.equal(cueTrack.duration, 240, 'loadedmetadata must preserve CUE sub-track duration instead of overwriting with parent album duration');
  assert.equal(domCache['duration'].textContent, '240', 'Duration UI must show CUE sub-track duration, not full album image duration');
  assert.ok(Math.abs(audio.currentTime - 345) < 0.01, 'CUE reconnect must resume at exact absolute position');
});
