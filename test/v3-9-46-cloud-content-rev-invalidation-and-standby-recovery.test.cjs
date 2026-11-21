'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. Cloud contentRev persistence and invalidateCloudTrackContent evicts stale slice cache & unused URLs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const serStart = html.indexOf('const MAX_CATALOG_COVER_CHARS =');
  const serEnd = html.indexOf('let cloudMetadataQueue = [], cloudMetadataActive = 0;', serStart);
  assert.ok(serStart !== -1 && serEnd > serStart, 'Cloud track serializer block must exist');

  const invStart = html.indexOf('function invalidateCloudTrackContent(track) {');
  const invEnd = html.indexOf('function releaseUnusedCloudUrl(track) {', invStart);
  assert.ok(invStart !== -1 && invEnd > invStart, 'invalidateCloudTrackContent must exist');

  const library = require(path.join(ROOT, 'library-utils.js'));
  const deletedKeys = [];
  const releasedIds = [];
  const sandbox = {
    library,
    Date,
    Array,
    Number,
    String,
    Object,
    state: { currentId: 'google:playing', preloadTrackId: 'onedrive:preloading' },
    audioFormat: () => 'flac',
    filenameMetadata: name => ({ title: name, artist: 'Unknown Artist', album: 'Unknown Album' }),
    isDsdFormat: () => false,
    loadGoogleAudio: () => async () => {},
    loadMicrosoftAudio: () => async () => {},
    sliceCacheTransaction: mode => ({
      delete: key => deletedKeys.push({ mode, key })
    }),
    releaseUnusedCloudUrl: track => {
      releasedIds.push(track.id);
      track.url = '';
      track.fullAudioUrl = null;
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(serStart, serEnd) +
      '\n' +
      html.slice(invStart, invEnd) +
      '\nthis.serializableCloudTrack = serializableCloudTrack;' +
      '\nthis.googleTrack = googleTrack;' +
      '\nthis.microsoftTrack = microsoftTrack;' +
      '\nthis.mergeMicrosoftTrack = mergeMicrosoftTrack;' +
      '\nthis.invalidateCloudTrackContent = invalidateCloudTrackContent;',
    sandbox
  );

  // 1.1 Google Drive md5Checksum / modifiedTime -> contentRev + serialization
  const gTrack = sandbox.googleTrack({
    id: 'g-101',
    name: 'Track.flac',
    size: 42000000,
    md5Checksum: 'abc123md5',
    modifiedTime: '2026-11-21T01:00:00Z'
  });
  assert.equal(gTrack.contentRev, 'abc123md5');
  assert.equal(sandbox.serializableCloudTrack(gTrack).contentRev, 'abc123md5');

  const gTrackModOnly = sandbox.googleTrack({
    id: 'g-102',
    name: 'Track2.flac',
    modifiedTime: '2026-11-21T02:00:00Z'
  });
  assert.equal(gTrackModOnly.contentRev, '2026-11-21T02:00:00Z');

  // 1.2 OneDrive cTag / eTag -> contentRev + mergeMicrosoftTrack preservation
  const msTrack = sandbox.microsoftTrack({
    id: 'od-201',
    name: 'Remaster.flac',
    size: 38000000,
    cTag: 'c:rev-1'
  }, 'Music/Remaster.flac');
  assert.equal(msTrack.contentRev, 'c:rev-1');
  sandbox.mergeMicrosoftTrack(msTrack, { id: 'od-201', name: 'Remaster.flac', audio: { title: 'Remaster' } }, 'Music/Remaster.flac');
  assert.equal(msTrack.contentRev, 'c:rev-1', 'mergeMicrosoftTrack must preserve existing contentRev when item lacks cTag/eTag');

  // 1.3 invalidateCloudTrackContent evicts firstSliceCache, aborts background upgrade & frees unused URLs
  let idleAborted = false;
  const idleTrack = {
    id: 'google:idle',
    remoteId: 'idle',
    source: 'google',
    name: 'Idle.flac',
    size: 1234,
    firstSliceCached: true,
    metadataLoaded: true,
    moovAtTail: true,
    fullAudioError: new Error('old err'),
    url: 'blob:old-idle',
    file: { byteLength: 100 },
    _fullUpgradeAbort: { abort: () => { idleAborted = true; } }
  };
  assert.equal(sandbox.invalidateCloudTrackContent(idleTrack), true);
  assert.equal(deletedKeys.length, 1);
  assert.equal(deletedKeys[0].mode, 'readwrite');
  assert.equal(deletedKeys[0].key, library.historyTrackKey(idleTrack));
  assert.equal(idleTrack.firstSliceCached, false);
  assert.equal(idleTrack.metadataLoaded, false);
  assert.equal(idleTrack.moovAtTail, false);
  assert.equal(idleTrack.fullAudioError, null);
  assert.equal(idleAborted, true);
  assert.equal(idleTrack._fullUpgradeAbort, null);
  assert.deepEqual(releasedIds, ['google:idle']);
  assert.equal(idleTrack.file, null);

  // 1.4 Currently playing track must NOT abort active playback or revoke active URL
  let playingAborted = false;
  const playingTrack = {
    id: 'google:playing',
    remoteId: 'playing',
    source: 'google',
    name: 'Playing.flac',
    firstSliceCached: true,
    metadataLoaded: true,
    url: 'blob:active',
    file: { byteLength: 100 },
    _fullUpgradeAbort: { abort: () => { playingAborted = true; } }
  };
  assert.equal(sandbox.invalidateCloudTrackContent(playingTrack), true);
  assert.equal(deletedKeys.length, 2, 'Should still purge stale firstSliceCache entry for playing track');
  assert.equal(playingAborted, false, 'Must not abort active playing track full upgrade');
  assert.equal(playingTrack.url, 'blob:active', 'Must not revoke active playing track URL');

  // 1.5 Local track returns false
  assert.equal(sandbox.invalidateCloudTrackContent({ id: 'local:1', source: 'local' }), false);
});

test('2. loadGoogleFiles and loadMicrosoftFiles detect size/contentRev edits and request cTag without breaking top-500 query', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const gStart = html.indexOf('async function loadGoogleFiles() {');
  const gEnd = html.indexOf('async function loadMicrosoftFiles(', gStart);
  assert.ok(gStart !== -1 && gEnd > gStart, 'loadGoogleFiles must exist');
  const gSrc = html.slice(gStart, gEnd);

  assert.ok(gSrc.includes('modifiedTime,md5Checksum'), 'Google Drive query must request modifiedTime and md5Checksum');
  assert.ok(gSrc.includes('if (existing.size > 0) contentChanged = true;'));
  assert.ok(gSrc.includes('const incomingRev = String(file.md5Checksum || file.modifiedTime || \'\');'));
  assert.ok(gSrc.includes('if (existing.contentRev) contentChanged = true;'));
  assert.ok(gSrc.includes('if (contentChanged && typeof invalidateCloudTrackContent === \'function\') invalidateCloudTrackContent(existing);'));

  const msStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const msEnd = html.indexOf('const MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', msStart);
  assert.ok(msStart !== -1 && msEnd > msStart, 'loadMicrosoftFiles must exist');
  const msSrc = html.slice(msStart, msEnd);

  assert.ok(msSrc.includes('$select=id,name,file,folder,cTag,size,audio&$top=500'), 'OneDrive Graph queries must request cTag while preserving size,audio&$top=500');
  const selectMatches = msSrc.match(/\$select=id,name,file,folder,cTag,size,audio&\$top=500/g) || [];
  assert.equal(selectMatches.length, 2, 'Both root and subfolder OneDrive Graph queries must include cTag');
  assert.ok(msSrc.includes('if (existing.size > 0) msContentChanged = true;'));
  assert.ok(msSrc.includes('const msIncomingRev = String(item.cTag || item.eTag || \'\');'));
  assert.ok(msSrc.includes('if (existing.contentRev) msContentChanged = true;'));
  assert.ok(msSrc.includes('if (msContentChanged && typeof invalidateCloudTrackContent === \'function\') invalidateCloudTrackContent(existing);'));
});

test('3. recoverFailedStandbyPreload cleans failed standbyAudio, purges broken slice/URLs, and bounds retries to 1 per 60s', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const recStart = html.indexOf('function recoverFailedStandbyPreload(failedTrackId, failedElement) {');
  const recEnd = html.indexOf('function attachDeckEvents(element) {', recStart);
  assert.ok(recStart !== -1 && recEnd > recStart, 'recoverFailedStandbyPreload must exist right before attachDeckEvents');
  const recSrc = html.slice(recStart, recEnd);

  const deckStart = html.indexOf('function attachDeckEvents(element) {');
  const deckEnd = html.indexOf('attachDeckEvents(audio); attachDeckEvents(standbyAudio);', deckStart);
  const deckSrc = html.slice(deckStart, deckEnd);
  assert.ok(
    deckSrc.includes('const failedId = state.preloadTrackId;') &&
      deckSrc.includes('state.preloadTrackId = null;') &&
      deckSrc.includes('state.preloadReadyUrl = null;') &&
      deckSrc.includes("if (typeof recoverFailedStandbyPreload === 'function') recoverFailedStandbyPreload(failedId, element);"),
    'attachDeckEvents error handler must clear state fields synchronously and call guarded recoverFailedStandbyPreload'
  );

  let fakeNow = 1_700_000_000_000;
  const timers = [];
  const releasedLocal = [];
  const invalidatedCloud = [];
  const releasedCloud = [];
  const preloadCalls = [];

  function makeDeckEl() {
    return {
      src: 'blob:broken',
      pausedCount: 0,
      removedAttrs: [],
      loadedCount: 0,
      pause() { this.pausedCount++; },
      removeAttribute(attr) { this.removedAttrs.push(attr); if (attr === 'src') this.src = ''; },
      load() { this.loadedCount++; }
    };
  }

  const standbyAudio = makeDeckEl();
  const tracks = [
    { id: 'cur', source: 'local', url: 'blob:current' },
    { id: 'loc-next', source: 'local', url: 'blob:local-bad' },
    {
      id: 'od-next',
      source: 'onedrive',
      firstSlicePlayback: true,
      firstSliceCached: true,
      fullAudioUrl: 'blob:od-full',
      downloadUrl: 'https://sharepoint.example/expired',
      downloadUrlAt: fakeNow - 10000
    },
    { id: 'g-next', source: 'google', firstSlicePlayback: false, firstSliceCached: false, fullAudioUrl: 'blob:g-full', url: 'blob:g' }
  ];

  const sandbox = {
    standbyAudio,
    Array,
    Number,
    Date: { now: () => fakeNow },
    state: {
      currentId: 'cur',
      preloadBusyId: 'od-next',
      preloadReadyUrl: null,
      playGeneration: 7,
      tracks
    },
    releaseUnusedLocalUrl: tr => { releasedLocal.push(tr.id); tr.url = ''; },
    invalidateCloudTrackContent: tr => { invalidatedCloud.push(tr.id); tr.firstSliceCached = false; },
    releaseUnusedCloudUrl: tr => { releasedCloud.push(tr.id); tr.url = ''; tr.fullAudioUrl = null; },
    preloadNext: force => { preloadCalls.push(force); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }
  };

  vm.createContext(sandbox);
  vm.runInContext(recSrc + '\nthis.recoverFailedStandbyPreload = recoverFailedStandbyPreload;', sandbox);

  // 3.1 OneDrive first-slice preload failure clears slice cache, downloadUrl, deck state & schedules 1 retry
  const ok1 = sandbox.recoverFailedStandbyPreload('od-next', standbyAudio);
  assert.equal(ok1, true);
  assert.equal(standbyAudio.pausedCount, 1);
  assert.deepEqual(standbyAudio.removedAttrs, ['src']);
  assert.equal(standbyAudio.loadedCount, 1);
  assert.equal(sandbox.state.preloadBusyId, null);
  assert.deepEqual(invalidatedCloud, ['od-next']);
  assert.equal(tracks[2].firstSlicePlayback, false);
  assert.equal(tracks[2].fullAudioUrl, null);
  assert.equal(tracks[2].downloadUrl, '');
  assert.equal(tracks[2].downloadUrlAt, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1200);

  // Running scheduled timer with stale playGeneration is ignored
  sandbox.state.playGeneration = 8;
  timers[0].fn();
  assert.deepEqual(preloadCalls, [], 'Stale generation timer must not trigger preloadNext');

  // Restoring matching playGeneration executes preloadNext(true)
  sandbox.state.playGeneration = 7;
  timers[0].fn();
  assert.deepEqual(preloadCalls, [true]);

  // 3.2 Second failure within 60s must NOT loop retries
  const ok2 = sandbox.recoverFailedStandbyPreload('od-next', standbyAudio);
  assert.equal(ok2, false, 'Repeated standby failure within 60s must not trigger infinite retries');
  assert.equal(sandbox.state._preloadFailedTrackId, 'od-next');
  assert.equal(sandbox.state._preloadFailedAt, fakeNow);
  assert.equal(timers.length, 1);

  // 3.3 After >60s window expires, track is eligible again
  fakeNow += 61000;
  const ok3 = sandbox.recoverFailedStandbyPreload('od-next', standbyAudio);
  assert.equal(ok3, true);
  assert.equal(timers.length, 2);

  // 3.4 Local and non-slice Google tracks release their URLs via corresponding helpers
  assert.equal(sandbox.recoverFailedStandbyPreload('loc-next', makeDeckEl()), true);
  assert.deepEqual(releasedLocal, ['loc-next']);

  assert.equal(sandbox.recoverFailedStandbyPreload('g-next', makeDeckEl()), true);
  assert.deepEqual(releasedCloud, ['od-next', 'od-next', 'g-next']);
  assert.equal(tracks[3].fullAudioUrl, null);

  // 3.5 Guard: active current track is ignored
  assert.equal(sandbox.recoverFailedStandbyPreload('cur', makeDeckEl()), false);
});

test('4. Version sync v3.9.46 / versionCode 100, asset parity, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must remain byte-identical to index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:4[6-9]|[5-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.46';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.46';"));
  assert.ok(/versionCode\s*=\s*(?:10\d|[1-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.46"'));
  assert.ok(/"3\.9\.(?:4[6-9]|[5-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:4[6-9]|[5-9]\d|\d{3,})/.test(publishRelease));

  // Web Audio & UI invariants
  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(indexHtml.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(indexHtml.includes('target.volume = audio.volume; target.muted = false;'));
  assert.equal(/\bmodal\.showModal\s*\(/.test(indexHtml), false, 'Must never call modal.showModal()');

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets', f));
    assert.equal(assetBuf.includes(13), false, `${f} in android assets must have 0 CR bytes`);
  }

  // Chromium 74 / FiiO M11S 0 ES2020+ syntax check on root JS and index.html main script
  const scriptStart = indexHtml.lastIndexOf('<script>');
  const scriptEnd = indexHtml.lastIndexOf('</script>');
  assert.ok(scriptStart !== -1 && scriptEnd > scriptStart, 'Inline main script in index.html must be locatable');
  const codeFiles = [['index.html <script>', indexHtml.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter(name => name.endsWith('.js'))) {
    codeFiles.push([f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  }
  for (const [label, src] of codeFiles) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const stripped = lines[i]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain ES2020 optional chaining (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain ES2020 nullish coalescing (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain ES2021 .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain ES2022 .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain ES2019 optional catch binding (catch {})`);
    }
  }
});
