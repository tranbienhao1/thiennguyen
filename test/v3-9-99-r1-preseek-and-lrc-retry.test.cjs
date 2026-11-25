'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Start marker not found: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `End marker not found: ${endMarker}`);
  return src.slice(s, e);
}

function makeMockDeck(name, events, opts = {}) {
  const listeners = new Map();
  const seekDelayMs = Number.isFinite(opts.seekDelayMs) ? opts.seekDelayMs : 12;
  const deck = {
    _name: name,
    src: opts.src || '',
    readyState: opts.readyState ?? 0,
    networkState: opts.networkState ?? 0,
    duration: opts.duration ?? 0,
    _currentTime: opts.currentTime ?? 0,
    seeking: Boolean(opts.seeking),
    paused: opts.paused ?? true,
    volume: 1,
    defaultMuted: false,
    muted: false,
    playbackRate: 1,
    dataset: {},
    error: null,
    seekAssignments: [],
    get currentTime() { return this._currentTime; },
    set currentTime(val) {
      const num = Number(val);
      this._currentTime = num;
      this.seekAssignments.push(num);
      this.seeking = true;
      events.push(`${name}:setCurrentTime(${num})`);
      if (typeof opts.onSeekAssign === 'function') {
        opts.onSeekAssign(deck, num);
      }
      setTimeout(() => {
        this.seeking = false;
        events.push(`${name}:seeked(${this._currentTime})`);
        deck._emit('seeked');
      }, seekDelayMs);
    },
    addEventListener(type, fn, lOpts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, once: Boolean(lOpts && lOpts.once) });
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      listeners.set(type, arr.filter(x => x.fn !== fn));
    },
    _emit(type, evt) {
      const arr = (listeners.get(type) || []).slice();
      for (const item of arr) {
        if (item.once) deck.removeEventListener(type, item.fn);
        item.fn(evt || { type });
      }
    },
    load() {
      events.push(`${name}:load`);
      if (typeof opts.onLoad === 'function') {
        opts.onLoad(deck);
        return;
      }
      setTimeout(() => {
        this.readyState = 1;
        this.duration = 600;
        events.push(`${name}:loadedmetadata`);
        this._emit('loadedmetadata');
      }, 6);
    },
    pause() {
      this.paused = true;
      events.push(`${name}:pause`);
    },
    removeAttribute() {},
    async play() {
      events.push(`${name}:play@t=${this._currentTime},seeking=${this.seeking}`);
      assert.equal(this.seeking, false, `${name}.play() must NOT run while seeking === true`);
      this.paused = false;
    }
  };
  return deck;
}

function makeMockResp({ ok = true, status = 200, body = '', jsonObj = null, headers = {} } = {}) {
  const hdrMap = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  return {
    ok,
    status,
    headers: {
      get(k) { return hdrMap.get(String(k).toLowerCase()) || null; }
    },
    async text() { return jsonObj !== null ? JSON.stringify(jsonObj) : String(body); },
    async json() {
      if (jsonObj !== null) return jsonObj;
      return JSON.parse(String(body));
    }
  };
}

describe('v3.9.99 R1: Standby Pre-Seek Consolidation, Async Guards & Cloud Sidecar .LRC Retry Hygiene', () => {
  it('1. consolidated standbyAudio pre-seek performs single seek on loadedmetadata + seeked without post-play() double-seek', async () => {
    const ensureSeekSlice = extractBetween(
      html,
      'function ensureInitialSeekAfterPlay(',
      'async function playTrack('
    );
    const playSlice = extractBetween(
      html,
      'const allowSameParentCueCrossfade =',
      '} catch (error) {'
    );

    const events = [];
    const deckA = makeMockDeck('deckA', events, {
      src: 'http://localhost/album.flac',
      readyState: 4,
      duration: 600,
      paused: false
    });
    const deckB = makeMockDeck('deckB', events, {
      src: '',
      readyState: 0,
      duration: 0,
      paused: true
    });

    const sandbox = {
      audio: deckA,
      standbyAudio: deckB,
      target: deckB,
      track: { id: 'cue-2', isCue: true, cueStart: 120, cueEnd: 300, duration: 180, source: 'local' },
      previousTrack: { id: 'cue-1', isCue: true, cueStart: 0, cueEnd: 120, duration: 120, source: 'local' },
      playUrl: 'http://localhost/album.flac',
      initialTargetSeekSec: 120,
      generation: 1,
      bpGuardToken: 1,
      wasPreloaded: false,
      playRequestedAt: 0,
      state: {
        playGeneration: 1,
        _bpPositionGuardToken: 1,
        crossfadeSeconds: 2,
        bitPerfectEnabled: false,
        activeDeck: { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } },
        deckA: null,
        deckB: null,
        context: { currentTime: 10 },
        crossfadeUntil: 0,
        isPlaybackLoading: true
      },
      isSilentUnlockSrc: () => false,
      isExternalNonAppAssetsHttpUrl: () => false,
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      resumeCloudMetadataQueue: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      cleanupAborted: () => { throw new Error('unexpected cleanupAborted'); },
      retryPlayOnAbort: async () => false,
      finishPlaybackStart: () => { events.push('finishPlaybackStart'); },
      $: () => null,
      performance: { now: () => 1 },
      setTimeout, clearTimeout, Math, Number, String, Boolean, Promise
    };
    sandbox.state.deckA = sandbox.state.activeDeck;
    sandbox.state.deckB = { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 0 } } };

    vm.createContext(sandbox);
    vm.runInContext(ensureSeekSlice, sandbox);
    assert.equal(vm.runInContext('typeof ensureInitialSeekAfterPlay', sandbox), 'function',
      'ensureInitialSeekAfterPlay must be bound in Test 1 VM context');
    const wrapped = `(async function runSlice() {\n${playSlice}\n} catch (err) { throw err; }\n})()`;
    await vm.runInContext(wrapped, sandbox);

    assert.deepEqual(deckB.seekAssignments, [120], 'standbyAudio.currentTime must be set exactly once (no post-play double-seek)');
    const metaIdx = events.indexOf('deckB:loadedmetadata');
    const setIdx = events.indexOf('deckB:setCurrentTime(120)');
    const seekedIdx = events.indexOf('deckB:seeked(120)');
    const playIdx = events.indexOf('deckB:play@t=120,seeking=false');
    const finishIdx = events.indexOf('finishPlaybackStart');
    assert.ok(metaIdx >= 0 && setIdx > metaIdx && seekedIdx > setIdx && playIdx > seekedIdx && finishIdx > playIdx,
      `Expected loadedmetadata -> setCurrentTime(120) -> seeked -> play -> finish; got ${JSON.stringify(events)}`);
  });

  it('2. inherited target.seeking === true converges cleanly both for stale timestamps (corrective seek) and near-target timestamps (no redundant seek)', async () => {
    const ensureSeekSlice = extractBetween(
      html,
      'function ensureInitialSeekAfterPlay(',
      'async function playTrack('
    );
    const playSlice = extractBetween(
      html,
      'const allowSameParentCueCrossfade =',
      '} catch (error) {'
    );

    // Subcase A: inherited seek lands at stale higher timestamp 300 -> must issue corrective seek to 120 after inherited seeked resolves
    const eventsA = [];
    const deckA1 = makeMockDeck('deckA', eventsA, { src: 'http://localhost/other.flac', readyState: 4, duration: 600, paused: false });
    const deckB1 = makeMockDeck('deckB', eventsA, {
      src: 'http://localhost/album.flac',
      readyState: 4,
      duration: 600,
      currentTime: 300,
      seeking: true,
      paused: true
    });
    setTimeout(() => {
      deckB1.seeking = false;
      eventsA.push('deckB:inheritedSeeked(300)');
      deckB1._emit('seeked');
    }, 18);

    const sandboxA = {
      audio: deckA1,
      standbyAudio: deckB1,
      target: deckB1,
      track: { id: 'cue-2', isCue: true, cueStart: 120, cueEnd: 300, duration: 180, source: 'local' },
      previousTrack: { id: 'other-1', isCue: false, duration: 200, source: 'local' },
      playUrl: 'http://localhost/album.flac',
      initialTargetSeekSec: 120,
      generation: 1,
      bpGuardToken: 1,
      wasPreloaded: false,
      playRequestedAt: 0,
      state: {
        playGeneration: 1,
        _bpPositionGuardToken: 1,
        crossfadeSeconds: 0,
        bitPerfectEnabled: false,
        activeDeck: { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } },
        deckA: null,
        deckB: null,
        context: { currentTime: 5 },
        crossfadeUntil: 0,
        isPlaybackLoading: true
      },
      isSilentUnlockSrc: () => false,
      isExternalNonAppAssetsHttpUrl: () => false,
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      resumeCloudMetadataQueue: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      cleanupAborted: () => { throw new Error('unexpected cleanupAborted'); },
      retryPlayOnAbort: async () => false,
      finishPlaybackStart: () => { eventsA.push('finishPlaybackStart'); },
      $: () => null,
      performance: { now: () => 1 },
      setTimeout, clearTimeout, Math, Number, String, Boolean, Promise
    };
    sandboxA.state.deckA = sandboxA.state.activeDeck;
    sandboxA.state.deckB = { router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 0 } } };

    vm.createContext(sandboxA);
    vm.runInContext(ensureSeekSlice, sandboxA);
    assert.equal(vm.runInContext('typeof ensureInitialSeekAfterPlay', sandboxA), 'function',
      'ensureInitialSeekAfterPlay must be bound in Test 2A VM context');
    await vm.runInContext(`(async function () {\n${playSlice}\n} catch (err) { throw err; }\n})()`, sandboxA);
    assert.deepEqual(deckB1.seekAssignments, [120], 'Must await inherited seeked(300) then seek to 120');
    const inhIdx = eventsA.indexOf('deckB:inheritedSeeked(300)');
    const corrSetIdx = eventsA.indexOf('deckB:setCurrentTime(120)');
    const corrSeekedIdx = eventsA.indexOf('deckB:seeked(120)');
    const playIdxA = eventsA.indexOf('deckB:play@t=120,seeking=false');
    assert.ok(inhIdx >= 0 && corrSetIdx > inhIdx && corrSeekedIdx > corrSetIdx && playIdxA > corrSeekedIdx,
      `Expected inheritedSeeked -> corrective setCurrentTime(120) -> seeked -> play; got ${JSON.stringify(eventsA)}`);

    // Subcase B: inherited seek lands at 120.1 (< 0.25s from target 120) -> awaits inherited seeked and plays WITHOUT issuing redundant second seek
    const eventsB = [];
    const deckA2 = makeMockDeck('deckA', eventsB, { src: 'http://localhost/other.flac', readyState: 4, duration: 600, paused: false });
    const deckB2 = makeMockDeck('deckB', eventsB, {
      src: 'http://localhost/album.flac',
      readyState: 4,
      duration: 600,
      currentTime: 120.1,
      seeking: true,
      paused: true
    });
    setTimeout(() => {
      deckB2.seeking = false;
      eventsB.push('deckB:inheritedSeeked(120.1)');
      deckB2._emit('seeked');
    }, 15);

    const sandboxB = Object.assign({}, sandboxA, {
      audio: deckA2,
      standbyAudio: deckB2,
      target: deckB2,
      finishPlaybackStart: () => { eventsB.push('finishPlaybackStart'); }
    });
    vm.createContext(sandboxB);
    vm.runInContext(ensureSeekSlice, sandboxB);
    assert.equal(vm.runInContext('typeof ensureInitialSeekAfterPlay', sandboxB), 'function',
      'ensureInitialSeekAfterPlay must be bound in Test 2B VM context');
    await vm.runInContext(`(async function () {\n${playSlice}\n} catch (err) { throw err; }\n})()`, sandboxB);
    assert.deepEqual(deckB2.seekAssignments, [], 'Inherited seek within <0.25s must NOT trigger redundant second seek');
    assert.ok(eventsB.indexOf('deckB:play@t=120.1,seeking=false') > eventsB.indexOf('deckB:inheritedSeeked(120.1)'));
  });

  it('3. playTrack() cancels cleanly on playGeneration/_bpPositionGuardToken changes, preserves newer _bpAwaitingStart, and guards isSameCueHtmlParent seeking', async () => {
    const isSilentSrc = extractBetween(html, 'const SILENT_UNLOCK_WAV =', 'function unlockAudioDecksOnGesture(');
    const abortCleanupSrc = extractBetween(html, 'function abortPlayCleanup(track)', 'function promoteMoovFullUrl(');
    const playTrackSlice = extractBetween(html, 'function resolvePlayTrackEntry(trackId)', 'function stopDsdWorker(');

    // Subcase A: Token preemption during standbyAudio loadedmetadata prevents play/finish and does NOT clear newer token's _bpAwaitingStart
    const eventsA = [];
    const deckA1 = makeMockDeck('deckA', eventsA, { src: 'http://localhost/prev.flac', readyState: 4, duration: 200, paused: false });
    let preempted = false;
    const deckB1 = makeMockDeck('deckB', eventsA, {
      onLoad(deck) {
        eventsA.push('deckB:load_async');
        setTimeout(() => {
          // Simulate a newer playTrack invocation starting while deckB was loading metadata
          if (!preempted) {
            preempted = true;
            sandboxA.state._bpPositionGuardToken += 1;
            sandboxA.state._bpAwaitingStart = true;
            sandboxA.state.playGeneration += 1;
            sandboxA.state.currentId = 'other-track';
          }
          deck.readyState = 1;
          deck.duration = 600;
          deck._emit('loadedmetadata');
        }, 12);
      }
    });

    const releasedUrls = [];
    let finishCallsA = 0;
    const sandboxA = {
      library,
      window: {},
      audio: deckA1,
      standbyAudio: deckB1,
      lastDisplayedPlaybackSecond: 0,
      lastPositionStateSecond: 0,
      location: { href: 'http://localhost/' },
      URL,
      navigator: { onLine: true },
      $: () => null,
      performance: { now: () => 1 },
      Date, Math, Number, String, Boolean, Promise, Set,
      setTimeout, clearTimeout,
      state: {
        tracks: [
          { id: 'cue-2', source: 'cloud', url: 'http://localhost/album.flac', isCue: true, cueStart: 120, duration: 180 },
          { id: 'other-track', source: 'local', url: 'http://localhost/other.flac', duration: 200 }
        ],
        currentId: 'prev-1',
        playGeneration: 1,
        _bpPositionGuardToken: 0,
        _bpAwaitingStart: false,
        crossfadeSeconds: 0,
        bitPerfectEnabled: false,
        activeDeck: { element: deckA1, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } },
        deckA: null,
        deckB: null,
        context: { state: 'running', currentTime: 10 },
        objectUrls: new Set(),
        queueTrackIds: [],
        preloadTrackId: null,
        preloadGeneration: 0,
        isPlaybackLoading: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        usingCorsBypassAudio: false
      },
      setupAudio: () => {},
      displayTrack: () => {},
      applyOptimisticPlaybackUi: () => {},
      setPlaybackLoading: () => {},
      clearOptimisticLoadingUi: () => {},
      unlockAudioDecksOnGesture: () => {},
      abortStaleFullAudioUpgrades: () => {},
      stopPrefetchDsdSlice: () => {},
      stopDsdWorker: () => {},
      clearStalePreload: () => {},
      renderQueue: () => {},
      finishPlaybackStart: () => { finishCallsA++; },
      recordHistory: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      retryPlayOnAbort: async () => false,
      safeResumeAudioContext: async () => {},
      isExternalNonAppAssetsHttpUrl: () => false,
      isTrackRoutedToNativeBitPerfect: () => false,
      suspendWebAudioForBitPerfect: () => {},
      skipFailedTrack: () => {},
      toast: () => {},
      mediaErrorMessage: e => String(e),
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      resumeCloudMetadataQueue: () => {},
      ensureLocalTrackPlayableUrl: async () => {},
      invalidateStaleStandbyPreload: () => false,
      releaseUnusedCloudUrl: tr => { releasedUrls.push(`cloud:${tr.id}`); },
      releaseUnusedLocalUrl: tr => { releasedUrls.push(`local:${tr.id}`); },
      pruneExcessObjectUrls: () => {}
    };
    sandboxA.state.deckA = sandboxA.state.activeDeck;
    sandboxA.state.deckB = { element: deckB1, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 0 } } };

    vm.runInNewContext(
      `${isSilentSrc}\n${abortCleanupSrc}\n${playTrackSlice}\nthis.playTrack = playTrack;`,
      sandboxA
    );

    await sandboxA.playTrack('cue-2');
    assert.equal(finishCallsA, 0, 'Preempted playTrack must NOT call finishPlaybackStart');
    assert.equal(deckB1.paused, true, 'Preempted playTrack must NOT call target.play()');
    assert.equal(sandboxA.state._bpAwaitingStart, true, 'finally block must NOT clobber newer token _bpAwaitingStart');
    assert.ok(releasedUrls.includes('cloud:cue-2'), 'abortPlayCleanup must release unused URLs when currentId moved on');

    // Subcase B: isSameCueHtmlParent awaits audio.seeking before audio.play() and respects token cancellation during audio.seeking
    const eventsB = [];
    const sameParentUrl = 'http://localhost/suite.flac';
    const deckASame = makeMockDeck('deckA', eventsB, {
      src: sameParentUrl,
      readyState: 4,
      duration: 600,
      currentTime: 100,
      paused: true,
      seekDelayMs: 20
    });
    const deckBSame = makeMockDeck('deckB', eventsB, { src: '', readyState: 0, paused: true });

    const uiPlayBtn = { textContent: '' };
    const sandboxB = Object.assign({}, sandboxA, {
      $: id => (id === 'play-button' ? uiPlayBtn : null),
      audio: deckASame,
      standbyAudio: deckBSame,
      state: {
        tracks: [
          { id: 'cue-1', source: 'local', url: sameParentUrl, isCue: true, cueStart: 0, duration: 120 },
          { id: 'cue-2', source: 'local', url: sameParentUrl, isCue: true, cueStart: 240, duration: 120 }
        ],
        currentId: 'cue-1',
        playGeneration: 1,
        _bpPositionGuardToken: 0,
        _bpAwaitingStart: false,
        crossfadeSeconds: 0,
        bitPerfectEnabled: false,
        activeDeck: { element: deckASame, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } },
        deckA: null,
        deckB: null,
        context: { state: 'running', currentTime: 10 },
        objectUrls: new Set(),
        queueTrackIds: [],
        preloadTrackId: null,
        preloadGeneration: 0,
        isPlaybackLoading: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        usingCorsBypassAudio: false
      },
      releaseUnusedCloudUrl: () => {},
      releaseUnusedLocalUrl: () => {}
    });
    sandboxB.state.deckA = sandboxB.state.activeDeck;
    sandboxB.state.deckB = { element: deckBSame, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 0 } } };

    vm.runInNewContext(
      `${isSilentSrc}\n${abortCleanupSrc}\n${playTrackSlice}\nthis.playTrack = playTrack;`,
      sandboxB
    );
    await sandboxB.playTrack('cue-2');
    const setSameIdx = eventsB.indexOf('deckA:setCurrentTime(240)');
    const seekedSameIdx = eventsB.indexOf('deckA:seeked(240)');
    const playSameIdx = eventsB.indexOf('deckA:play@t=240,seeking=false');
    assert.ok(setSameIdx >= 0 && seekedSameIdx > setSameIdx && playSameIdx > seekedSameIdx,
      `isSameCueHtmlParent must await audio.seeking -> seeked before audio.play(); got ${JSON.stringify(eventsB)}`);

    // Now preempt during audio.seeking inside isSameCueHtmlParent
    const eventsB2 = [];
    const deckASameAbort = makeMockDeck('deckA', eventsB2, {
      src: sameParentUrl,
      readyState: 4,
      duration: 600,
      currentTime: 0,
      paused: true,
      seekDelayMs: 20,
      onSeekAssign() {
        setTimeout(() => {
          sandboxB2.state._bpPositionGuardToken += 1;
          sandboxB2.state._bpAwaitingStart = true;
        }, 5);
      }
    });
    const sandboxB2 = Object.assign({}, sandboxB, {
      audio: deckASameAbort,
      state: Object.assign({}, sandboxB.state, {
        currentId: 'cue-1',
        playGeneration: 10,
        _bpPositionGuardToken: 10,
        _bpAwaitingStart: false,
        activeDeck: { element: deckASameAbort, router: { gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, value: 1 } } }
      })
    });
    sandboxB2.state.deckA = sandboxB2.state.activeDeck;
    vm.runInNewContext(
      `${isSilentSrc}\n${abortCleanupSrc}\n${playTrackSlice}\nthis.playTrack = playTrack;`,
      sandboxB2
    );
    await sandboxB2.playTrack('cue-2');
    assert.equal(deckASameAbort.paused, true, 'isSameCueHtmlParent must abort before audio.play() if token changes during seeking');
    assert.equal(sandboxB2.state._bpAwaitingStart, true, 'Newer token _bpAwaitingStart must stay intact');
  });

  it('4. fetchCloudSidecarLrc & fetchCloudSidecarLyrics classify transient vs definitive statuses without stamping transient errors', async () => {
    const lrcSlice = extractBetween(html, 'async function fetchCloudSidecarLyrics(track)', 'async function triggerLyricsFetch(');

    let fetchImpl = async () => makeMockResp({ ok: false, status: 404 });
    let googleTokenValue = 'g-tok';
    let msTokenValue = 'ms-tok';
    const sandbox = {
      navigator: { onLine: true },
      state: { googleToken: 'g-tok', microsoftAccessToken: 'ms-tok' },
      URLSearchParams,
      ensureGoogleToken: async () => googleTokenValue,
      getMicrosoftToken: async () => msTokenValue,
      fetch: (...args) => fetchImpl(...args),
      Object, String, Number, Boolean, Array, Promise, Math, Date
    };
    vm.runInNewContext(lrcSlice + '\nthis.fetchCloudSidecarLyrics = fetchCloudSidecarLyrics;\nthis.fetchCloudSidecarLrc = fetchCloudSidecarLrc;', sandbox);

    // Offline -> transient_error without stamping
    sandbox.navigator.onLine = false;
    const gOffline = { id: 'g1', source: 'google', name: 'Song.flac', parents: ['p1'] };
    const offRes = await sandbox.fetchCloudSidecarLrc(gOffline);
    assert.equal(offRes.status, 'transient_error');
    assert.equal(offRes.reason, 'offline');
    assert.equal(Boolean(gOffline._checkedDriveLrc), false);
    sandbox.navigator.onLine = true;

    // Missing tokens -> transient_error
    googleTokenValue = '';
    sandbox.state.googleToken = '';
    const gNoTok = { id: 'g2', source: 'google', name: 'Song.flac', parents: ['p1'] };
    const gNoTokRes = await sandbox.fetchCloudSidecarLrc(gNoTok);
    assert.equal(gNoTokRes.status, 'transient_error');
    assert.equal(gNoTokRes.reason, 'missing_token');
    assert.equal(Boolean(gNoTok._checkedDriveLrc), false);
    googleTokenValue = 'g-tok';
    sandbox.state.googleToken = 'g-tok';

    msTokenValue = '';
    sandbox.state.microsoftAccessToken = '';
    const mNoTok = { id: 'm1', source: 'onedrive', name: 'Ms.flac', remoteLrc: { id: 'ms-lrc-1', name: 'Ms.lrc' } };
    const mNoTokRes = await sandbox.fetchCloudSidecarLrc(mNoTok);
    assert.equal(mNoTokRes.status, 'transient_error');
    assert.equal(mNoTokRes.reason, 'missing_token');
    assert.equal(Boolean(mNoTok._cloudLrcChecked), false);
    msTokenValue = 'ms-tok';
    sandbox.state.microsoftAccessToken = 'ms-tok';

    // Google 401 -> refresh -> 503 on list -> transient_error, _checkedDriveLrc remains falsy
    let gCalls = 0;
    fetchImpl = async () => {
      gCalls++;
      if (gCalls === 1) return makeMockResp({ ok: false, status: 401 });
      return makeMockResp({ ok: false, status: 503, headers: { 'Retry-After': '3' } });
    };
    const g503 = { id: 'g3', source: 'google', name: 'Song.flac', parents: ['p1'] };
    const g503Res = await sandbox.fetchCloudSidecarLrc(g503);
    assert.equal(g503Res.status, 'transient_error');
    assert.equal(g503Res.httpStatus, 503);
    assert.equal(g503Res.retryAfterMs, 3000);
    assert.equal(Boolean(g503._checkedDriveLrc), false);

    // Google network rejection -> transient_error
    fetchImpl = async () => { throw new Error('ECONNRESET'); };
    const gNet = { id: 'g4', source: 'google', name: 'Song.flac', parents: ['p1'] };
    const gNetRes = await sandbox.fetchCloudSidecarLrc(gNet);
    assert.equal(gNetRes.status, 'transient_error');
    assert.equal(gNetRes.reason, 'network_error');
    assert.equal(Boolean(gNet._checkedDriveLrc), false);

    // OneDrive 429 (Retry-After: 2), 500, and network rejection -> transient_error
    fetchImpl = async () => makeMockResp({ ok: false, status: 429, headers: { 'Retry-After': '2' } });
    const m429 = { id: 'm2', source: 'onedrive', name: 'Ms.flac', remoteLrc: { id: 'lrc-2', name: 'Ms.lrc' } };
    const m429Res = await sandbox.fetchCloudSidecarLrc(m429);
    assert.equal(m429Res.status, 'transient_error');
    assert.equal(m429Res.httpStatus, 429);
    assert.equal(m429Res.retryAfterMs, 2000);
    assert.equal(Boolean(m429._cloudLrcChecked), false);

    fetchImpl = async () => makeMockResp({ ok: false, status: 500 });
    const m500Res = await sandbox.fetchCloudSidecarLrc(m429);
    assert.equal(m500Res.status, 'transient_error');
    assert.equal(m500Res.httpStatus, 500);

    fetchImpl = async () => { throw new Error('offline'); };
    const mNetRes = await sandbox.fetchCloudSidecarLrc(m429);
    assert.equal(mNetRes.status, 'transient_error');
    assert.equal(mNetRes.reason, 'network_error');

    // Definitive Google empty files: [] & 404/410 on media -> not_found + _checkedDriveLrc = true
    fetchImpl = async () => makeMockResp({ ok: true, status: 200, jsonObj: { files: [] } });
    const gEmpty = { id: 'g5', source: 'google', name: 'Missing.flac', parents: ['p1'] };
    const gEmptyRes = await sandbox.fetchCloudSidecarLrc(gEmpty);
    assert.equal(gEmptyRes.status, 'not_found');
    assert.equal(gEmptyRes.reason, 'no_sidecar_found');
    assert.equal(gEmpty._checkedDriveLrc, true);

    fetchImpl = async (url) => {
      if (url.includes('alt=media')) return makeMockResp({ ok: false, status: 410 });
      return makeMockResp({ ok: true, status: 200, jsonObj: { files: [{ id: 'lrc410', name: 'Gone.lrc', size: 32 }] } });
    };
    const g410 = { id: 'g6', source: 'google', name: 'Gone.flac', parents: ['p1'] };
    const g410Res = await sandbox.fetchCloudSidecarLrc(g410);
    assert.equal(g410Res.status, 'not_found');
    assert.equal(g410Res.httpStatus, 410);
    assert.equal(g410._checkedDriveLrc, true);

    // OneDrive 404 & empty BOM-only .lrc -> not_found
    fetchImpl = async () => makeMockResp({ ok: false, status: 404 });
    const m404Res = await sandbox.fetchCloudSidecarLrc(m429);
    assert.equal(m404Res.status, 'not_found');
    assert.equal(m404Res.httpStatus, 404);

    fetchImpl = async () => makeMockResp({ ok: true, status: 200, body: '  \uFEFF   \n ' });
    const mEmptyBodyRes = await sandbox.fetchCloudSidecarLrc(m429);
    assert.equal(mEmptyBodyRes.status, 'not_found');
    assert.equal(mEmptyBodyRes.reason, 'empty_lrc');

    // Legacy non-detailed fetchCloudSidecarLyrics(track): 200 -> { text, name, source: 'cloud-sidecar' }, 404/error -> null
    fetchImpl = async () => makeMockResp({ ok: true, status: 200, body: '[00:05.00] Legacy line' });
    const legacyOk = await sandbox.fetchCloudSidecarLyrics(m429);
    assert.deepEqual(
      { text: legacyOk && legacyOk.text, name: legacyOk && legacyOk.name, source: legacyOk && legacyOk.source },
      { text: '[00:05.00] Legacy line', name: 'Ms.lrc', source: 'cloud-sidecar' }
    );

    fetchImpl = async () => makeMockResp({ ok: false, status: 404 });
    const legacy404 = await sandbox.fetchCloudSidecarLyrics(m429);
    assert.equal(legacy404, null);
  });

  it('5. enrichCloudTrack() + repopulateCloudMetadataQueue() preserves transient tracks, applies backoff/401 cooldown, and recovers on 200 while skipping 404', async () => {
    const qSlice = extractBetween(html, 'let cloudMetadataPausedUntil = 0;', 'function isCloudAuthHttpError(');
    const enrSlice = extractBetween(html, 'function allSettledCompat(', 'const dsdWorkerBaseUrl =');
    const lrcSlice = extractBetween(html, 'async function fetchCloudSidecarLyrics(track)', 'async function triggerLyricsFetch(');

    const trackG503 = {
      id: 'google:g_503', remoteId: 'g_503', source: 'google', parents: ['p1'],
      name: 'RetryG.flac', title: 'Retry G', cover: 'data:image/png;base64,AA==',
      metadataLoaded: true, _replayGainChecked: true
    };
    const trackM429 = {
      id: 'onedrive:m_429', remoteId: 'm_429', source: 'onedrive',
      remoteLrc: { id: 'lrc_m_429', name: 'RetryM.lrc', driveId: '' },
      name: 'RetryM.flac', title: 'Retry M', cover: 'data:image/png;base64,AA==',
      metadataLoaded: true, _replayGainChecked: true
    };
    const trackG404 = {
      id: 'google:g_404', remoteId: 'g_404', source: 'google', parents: ['p404'],
      name: 'Missing.flac', title: 'Missing', cover: 'data:image/png;base64,AA==',
      metadataLoaded: true, _replayGainChecked: true
    };

    let mode = 'transient';
    let missingProbes = 0;
    const persistedIds = [];
    const sandbox = {
      library,
      IS_LEGACY_ANDROID: false,
      CLOUD_METADATA_CONCURRENCY: 3,
      cloudMetadataQueued: new Set(),
      cloudMetadataQueue: [],
      cloudMetadataActive: 0,
      trackMetadataRevision: 0,
      filterOptionsSignature: '',
      navigator: { onLine: true },
      document: { hidden: false, addEventListener() {} },
      window: { addEventListener() {} },
      URLSearchParams,
      state: {
        isPlaybackLoading: false,
        fiioDapMode: false,
        googleToken: 'tok-g',
        googleExpiresAt: Date.now() + 3600000,
        microsoftAccessToken: 'tok-m',
        albumCovers: new Map(),
        tracks: [trackG404, trackG503, trackM429]
      },
      ensureGoogleToken: async () => 'tok-g',
      getMicrosoftToken: async () => 'tok-m',
      cloudTagRequest: async () => null,
      googleThumbnail: async () => null,
      microsoftThumbnail: async () => null,
      normalizeCoverImage: async c => c,
      persistCloudCatalog: async (batch) => {
        for (const t of batch) persistedIds.push(t.id);
      },
      pruneCloudCatalog: async () => {},
      updateMetadataFilters: () => {},
      scheduleTrackRender: () => {},
      fetch: async (url) => {
        if (url.includes('Missing.lrc')) {
          missingProbes++;
          return makeMockResp({ ok: true, status: 200, jsonObj: { files: [] } });
        }
        if (url.includes('RetryG.lrc')) {
          if (mode === 'transient') return makeMockResp({ ok: false, status: 503, headers: { 'Retry-After': '0.01' } });
          return makeMockResp({ ok: true, status: 200, jsonObj: { files: [{ id: 'gLrcOk', name: 'RetryG.lrc', size: 64 }] } });
        }
        if (url.includes('/gLrcOk')) {
          return makeMockResp({ ok: true, status: 200, body: '[00:01.00] Google Recovered' });
        }
        if (url.includes('/lrc_m_429/content')) {
          if (mode === 'transient') return makeMockResp({ ok: false, status: 429, headers: { 'Retry-After': '0.01' } });
          return makeMockResp({ ok: true, status: 200, body: '[00:02.00] OneDrive Recovered' });
        }
        return makeMockResp({ ok: false, status: 404 });
      },
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, Promise, Error, console
    };

    vm.runInNewContext(qSlice + '\n' + enrSlice + '\n' + lrcSlice + '\nthis.getBackoff = () => cloudMetadataBackoffMs;', sandbox);

    // Override pauseCloudMetadataQueue AFTER binding so we set cloudMetadataPausedUntil cleanly without leaving a long real timer open
    const pauseCalls = [];
    sandbox.sandboxPause = (waitMs) => {
      pauseCalls.push(waitMs);
    };
    vm.runInNewContext(
      'pauseCloudMetadataQueue = function(waitMs) { sandboxPause(waitMs); cloudMetadataPausedUntil = Date.now() + 60000; };',
      sandbox
    );

    // Pass 1: transient failures on G503 & M429, definitive not_found on G404
    const initialQueued = sandbox.repopulateCloudMetadataQueue();
    assert.equal(initialQueued, 3);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 10));
      if (sandbox.cloudMetadataActive === 0) break;
    }
    await new Promise(r => setTimeout(r, 20));

    assert.equal(Boolean(trackG503._checkedDriveLrc), false, 'Google 503 must NOT stamp _checkedDriveLrc');
    assert.equal(Boolean(trackM429._cloudLrcChecked), false, 'OneDrive 429 must NOT stamp _cloudLrcChecked');
    assert.equal(trackG404._checkedDriveLrc, true, 'Definitive empty files:[] MUST stamp _checkedDriveLrc');
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackG503), true);
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackM429), true);
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackG404), false);
    assert.ok(pauseCalls.length >= 1 && sandbox.getBackoff() >= 4000, 'Rate limit must increase cloudMetadataBackoffMs and pause queue');
    assert.equal(trackG503._metaRateLimitRetries, 1);
    assert.equal(trackM429._metaRateLimitRetries, 1);
    // Both transient tracks must have been requeued onto cloudMetadataQueue via _requeueMetaOnBackoff
    assert.equal(sandbox.cloudMetadataQueue.length, 2, 'Transient rate-limited tracks must be requeued for backoff retry');

    // Pass 2: verify repopulateCloudMetadataQueue() skips G404 when queue is cleared, then resume & recover on 200
    mode = 'recover';
    sandbox.cloudMetadataQueue.length = 0;
    sandbox.cloudMetadataQueued.clear();
    const probesBeforeRecover = missingProbes;
    const requeued = sandbox.repopulateCloudMetadataQueue();
    assert.equal(requeued, 2, 'repopulateCloudMetadataQueue must requeue only G503 and M429 (skip G404)');
    sandbox.resumeCloudMetadataQueue();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 15));
      if (sandbox.cloudMetadataActive === 0 && sandbox.cloudMetadataQueue.length === 0) break;
    }
    // Flush queued persist batch
    await sandbox.flushQueuedCloudCatalogPersist(false);

    assert.equal(trackG503.lyricsText, '[00:01.00] Google Recovered');
    assert.equal(trackG503._checkedDriveLrc, true);
    assert.equal(trackM429.lyricsText, '[00:02.00] OneDrive Recovered');
    assert.equal(trackM429._cloudLrcChecked, true);
    assert.equal(missingProbes, probesBeforeRecover, 'G404 must NOT be re-probed after definitive stamp');
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackG503), false);
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackM429), false);
    assert.ok(persistedIds.includes('google:g_503') && persistedIds.includes('onedrive:m_429'));

    // Pass 3: 401 auth transient sets 60-min metadataRetryAt without stamping checked flag, cleared on reconnect
    const trackG401 = {
      id: 'google:g_401', remoteId: 'g_401', source: 'google', parents: ['p401'],
      name: 'Auth401.flac', title: 'Auth 401', cover: 'data:image/png;base64,AA==',
      metadataLoaded: true, _replayGainChecked: true
    };
    sandbox.fetch = async () => makeMockResp({ ok: false, status: 401 });
    await sandbox.enrichCloudTrack(trackG401);
    assert.equal(Boolean(trackG401._checkedDriveLrc), false, '401 auth transient must NOT stamp _checkedDriveLrc');
    assert.ok(trackG401.metadataRetryAt > Date.now(), '401 auth transient must set metadataRetryAt cooldown');
    sandbox.state.tracks.push(trackG401);
    const resetCount = sandbox.resetCloudMetadataRetryForSource('google');
    assert.equal(resetCount, 1);
    assert.equal(trackG401.metadataRetryAt, 0);
  });

  it('6. ensureInitialSeekAfterPlay() defers seek on readyState === 0 until loadedmetadata and aborts cleanly on token or generation change', () => {
    const ensureSeekSlice = extractBetween(
      html,
      'function ensureInitialSeekAfterPlay(',
      'async function playTrack('
    );

    const runEnsure = (target, initialTargetSeekSec, clampedInitPos, generation, bpGuardToken, stateObj) => {
      const ctx = {
        state: stateObj,
        Math, Number
      };
      vm.createContext(ctx);
      vm.runInContext(`${ensureSeekSlice}\nthis.ensureInitialSeekAfterPlay = ensureInitialSeekAfterPlay;`, ctx);
      assert.equal(typeof ctx.ensureInitialSeekAfterPlay, 'function');
      ctx.ensureInitialSeekAfterPlay(target, initialTargetSeekSec, clampedInitPos, generation, bpGuardToken);
      return ctx;
    };

    // Subcase A: readyState === 0 defers seek until loadedmetadata fires once
    const eventsA = [];
    const deckMeta = makeMockDeck('deckMeta', eventsA, { readyState: 0, duration: 0, currentTime: 0, seeking: false });
    const stateA = { playGeneration: 5, _bpPositionGuardToken: 9 };
    runEnsure(deckMeta, 120, 120, 5, 9, stateA);
    assert.deepEqual(deckMeta.seekAssignments, [], 'readyState === 0 must defer seek until loadedmetadata');
    deckMeta.readyState = 1;
    deckMeta.duration = 600;
    deckMeta._emit('loadedmetadata');
    assert.deepEqual(deckMeta.seekAssignments, [120], 'loadedmetadata must trigger exactly 1 seek');
    deckMeta.seeking = false;
    deckMeta._emit('loadedmetadata');
    assert.deepEqual(deckMeta.seekAssignments, [120], 'once:true loadedmetadata listener must not double-seek');

    // Subcase A2: readyState === 0 clamps seek to duration - 0.25 if metadata duration is shorter
    const eventsClamp = [];
    const deckClamp = makeMockDeck('deckClamp', eventsClamp, { readyState: 0, duration: 0, currentTime: 0, seeking: false });
    runEnsure(deckClamp, 120, 120, 5, 9, { playGeneration: 5, _bpPositionGuardToken: 9 });
    deckClamp.readyState = 1;
    deckClamp.duration = 90;
    deckClamp._emit('loadedmetadata');
    assert.deepEqual(deckClamp.seekAssignments, [89.75], 'Deferred seek must clamp to target.duration - 0.25');

    // Subcase B: clean abort when state._bpPositionGuardToken changes before loadedmetadata fires
    const eventsB = [];
    const deckAbortTok = makeMockDeck('deckAbortTok', eventsB, { readyState: 0, duration: 0, currentTime: 0, seeking: false });
    const stateB = { playGeneration: 5, _bpPositionGuardToken: 9 };
    runEnsure(deckAbortTok, 120, 120, 5, 9, stateB);
    stateB._bpPositionGuardToken = 10;
    deckAbortTok.readyState = 1;
    deckAbortTok.duration = 600;
    deckAbortTok._emit('loadedmetadata');
    assert.deepEqual(deckAbortTok.seekAssignments, [], 'Changed _bpPositionGuardToken must abort deferred loadedmetadata seek');

    // Subcase C: clean abort when state.playGeneration changes before loadedmetadata fires
    const eventsC = [];
    const deckAbortGen = makeMockDeck('deckAbortGen', eventsC, { readyState: 0, duration: 0, currentTime: 0, seeking: false });
    const stateC = { playGeneration: 5, _bpPositionGuardToken: 9 };
    runEnsure(deckAbortGen, 120, 120, 5, 9, stateC);
    stateC.playGeneration = 6;
    deckAbortGen.readyState = 1;
    deckAbortGen.duration = 600;
    deckAbortGen._emit('loadedmetadata');
    assert.deepEqual(deckAbortGen.seekAssignments, [], 'Changed playGeneration must abort deferred loadedmetadata seek');

    // Subcase D: readyState >= 1 seeks when drift >= 0.5s, skips when drift < 0.5s or seeking === true
    const deckDrift = makeMockDeck('deckDrift', [], { readyState: 4, duration: 600, currentTime: 10, seeking: false });
    runEnsure(deckDrift, 120, 120, 5, 9, { playGeneration: 5, _bpPositionGuardToken: 9 });
    assert.deepEqual(deckDrift.seekAssignments, [120], 'readyState >= 1 with >= 0.5s drift must seek immediately');

    const deckNear = makeMockDeck('deckNear', [], { readyState: 4, duration: 600, currentTime: 119.7, seeking: false });
    runEnsure(deckNear, 120, 120, 5, 9, { playGeneration: 5, _bpPositionGuardToken: 9 });
    assert.deepEqual(deckNear.seekAssignments, [], 'readyState >= 1 within < 0.5s must not issue redundant seek');

    const deckSeeking = makeMockDeck('deckSeeking', [], { readyState: 4, duration: 600, currentTime: 10, seeking: true });
    runEnsure(deckSeeking, 120, 120, 5, 9, { playGeneration: 5, _bpPositionGuardToken: 9 });
    assert.deepEqual(deckSeeking.seekAssignments, [], 'target.seeking === true must skip ensureInitialSeekAfterPlay');
  });
});
