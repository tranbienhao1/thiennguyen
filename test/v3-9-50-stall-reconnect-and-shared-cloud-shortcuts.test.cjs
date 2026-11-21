'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. runPlaybackStallWatchdogTick + recoverStalledAudioStream reconnects stalled Cloud & offline Local streams cleanly', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf("let watchdogLastSrc = '';");
  const end = html.indexOf('function runProactiveGaplessPreloadTick()', start);
  assert.ok(start !== -1 && end > start, 'Stall watchdog & recoverStalledAudioStream block must exist');

  const wdStart = html.indexOf('function runPlaybackStallWatchdogTick()', start);
  const wdSlice = html.slice(wdStart, wdStart + 2200);
  assert.ok(wdSlice.includes('(audio.duration - curT) > 0.25'), 'stall watchdog EOF guard must be within 2200-char legacy audit slice');
  assert.ok(wdSlice.includes('Math.max(curT, Math.min(curT + 0.05, audio.duration - 0.15))'), 'stall watchdog targetPos must be within 2200-char legacy audit slice');

  let fakeNow = 1700000000000;
  let playCalls = 0;
  let loadDeckCalls = 0;
  let trackLoadCalls = 0;
  let ensureLocalCalls = 0;
  const releasedUrls = [];
  const toastMessages = [];
  const listeners = new Map();

  const audio = {
    src: 'blob:stalled-cloud-1',
    currentTime: 84.5,
    duration: 240,
    readyState: 2,
    paused: false,
    ended: false,
    error: null,
    addEventListener: (evt, cb, opts) => {
      listeners.set(evt, { cb, once: Boolean(opts && opts.once) });
    },
    load: () => { loadDeckCalls++; },
    play: () => {
      playCalls++;
      return Promise.resolve();
    }
  };
  const standbyAudio = { src: '' };
  const fireEvent = evt => {
    const entry = listeners.get(evt);
    if (!entry) return;
    if (entry.once) listeners.delete(evt);
    entry.cb();
  };

  const odTrack = {
    id: 'onedrive:st-1',
    remoteId: 'st-1',
    source: 'onedrive',
    url: 'blob:stalled-cloud-1',
    downloadUrl: 'https://old-expired-direct/url',
    downloadUrlAt: fakeNow - 10000,
    firstSlicePlayback: true,
    sliceEndedEarly: false,
    fullAudioError: new Error('stale'),
    isDsd: false,
    load: async () => {
      trackLoadCalls++;
      odTrack.url = 'blob:reconnected-cloud-2';
    }
  };
  const localTrack = {
    id: 'local:sd-1',
    source: 'local',
    url: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2Fsd%2Fa.flac',
    isDsd: false
  };

  const sandbox = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Map,
    Promise,
    URL,
    location: { href: 'https://appassets.androidplatform.net/index.html' },
    Date: { now: () => fakeNow },
    navigator: { onLine: true },
    audio,
    standbyAudio,
    state: {
      currentId: 'onedrive:st-1',
      tracks: [odTrack, localTrack],
      isNativeBitPerfectPlaying: false,
      isPlaybackLoading: false,
      context: { state: 'running', resume: async () => {} }
    },
    releaseTrackUrl: u => releasedUrls.push(u),
    ensureLocalTrackPlayableUrl: async tr => {
      ensureLocalCalls++;
      return tr.url;
    },
    toast: msg => toastMessages.push(msg),
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(start, end) +
      '\nthis.runPlaybackStallWatchdogTick = runPlaybackStallWatchdogTick;' +
      '\nthis.recoverStalledAudioStream = recoverStalledAudioStream;',
    sandbox
  );

  // 1. Initialize baseline + 2 stalled ticks -> 1st nudge (+0.05s)
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick();
  assert.equal(audio.currentTime, 84.55, 'First stalled threshold must perform small forward nudge');
  assert.equal(trackLoadCalls, 0, 'First nudge must not immediately reconnect stream');

  // 1b. Normal playback progress resets nudge attempts counter so it does not falsely reconnect
  audio.currentTime = 85.5;
  sandbox.runPlaybackStallWatchdogTick(); // curT advanced -> resets watchdogNudgeAttempts = 0
  fakeNow += 20005;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick(); // nudge #1 at new pos -> 85.55
  assert.ok(Math.abs(audio.currentTime - 85.55) < 0.001, 'After progress reset, first stall must nudge instead of reconnecting');
  assert.equal(trackLoadCalls, 0);

  // 2. Playback stays stuck at 85.55 across next 20s window -> 2nd stall triggers stream reconnect
  fakeNow += 20005;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick();
  await new Promise(r => setImmediate(r));

  assert.equal(trackLoadCalls, 1, 'Repeated stall on same track must invoke recoverStalledAudioStream -> track.load()');
  assert.equal(odTrack.downloadUrl, '', 'OneDrive reconnect must clear stale direct downloadUrl before reloading');
  assert.equal(odTrack.downloadUrlAt, 0);
  assert.equal(audio.src, 'blob:reconnected-cloud-2');
  assert.ok(loadDeckCalls >= 1);
  assert.deepEqual(releasedUrls, ['blob:stalled-cloud-1']);
  fireEvent('loadedmetadata');
  assert.ok(Math.abs(audio.currentTime - 85.55) < 0.001, 'loadedmetadata after reconnect must restore stalled playback position');
  assert.ok(playCalls >= 2);
  assert.ok(toastMessages.length >= 1);

  // 3. Per-track 120s cooldown prevents reconnect loop on immediate subsequent stalls
  fakeNow += 25000;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick();
  fakeNow += 25000;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick();
  await new Promise(r => setImmediate(r));
  assert.equal(trackLoadCalls, 1, '120s per-track cooldown must block immediate second reconnect');

  // 4. Offline local /local-media stream still reconnects cleanly with _sr cache-buster
  sandbox.navigator.onLine = false;
  sandbox.state.currentId = 'local:sd-1';
  audio.src = localTrack.url;
  audio.currentTime = 41.2;
  sandbox.runPlaybackStallWatchdogTick(); // resets src tracking
  fakeNow += 20005;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick(); // nudge #1 -> 41.25
  fakeNow += 20005;
  sandbox.runPlaybackStallWatchdogTick();
  sandbox.runPlaybackStallWatchdogTick(); // nudge #2 -> recoverStalledAudioStream
  await new Promise(r => setImmediate(r));

  assert.equal(ensureLocalCalls, 1, 'Local /local-media reconnect must work even when navigator.onLine === false');
  assert.ok(audio.src.includes('/local-media?path=%2Fstorage%2Fsd%2Fa.flac&_sr='), 'Local /local-media stream URL must append _sr timestamp');
  fireEvent('loadedmetadata');
  assert.equal(audio.currentTime, 41.25, 'Local reconnect must preserve playback position on loadedmetadata');
});

test('2. Google Drive shortcuts (shortcutDetails.targetId) filter, dedup, persist, and stream from targetRemoteId', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const serStart = html.indexOf('const AUDIO_TYPES =');
  const serEnd = html.indexOf('let cloudMetadataQueue = [], cloudMetadataActive = 0;', serStart);
  const tagStart = html.indexOf('function isCloudAuthHttpError(err)');
  const tagEnd = html.indexOf('function allSettledCompat(', tagStart);
  const scStart = html.indexOf('const GOOGLE_DRIVE_SHORTCUT_QUERY =');
  const scEnd = html.indexOf("const GOOGLE_DELTA_TOKEN_KEY = 'nocturne-google-delta-token';", scStart);
  const loadGStart = html.indexOf('async function loadGoogleAudio(fileId) {');
  const loadGEnd = html.indexOf('const DEFAULT_MICROSOFT_CLIENT_ID =', loadGStart);

  assert.ok(serStart !== -1 && serEnd > serStart);
  assert.ok(tagStart !== -1 && tagEnd > tagStart);
  assert.ok(scStart !== -1 && scEnd > scStart);
  assert.ok(loadGStart !== -1 && loadGEnd > loadGStart);

  const library = require(path.join(ROOT, 'library-utils.js'));
  const fetchedUrls = [];
  const readTagUrls = [];
  const fetchCloudTrackUrls = [];
  const invalidatedIds = [];

  const sandbox = {
    library,
    URLSearchParams,
    Date,
    Array,
    Number,
    String,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    window: { jsmediatags: {} },
    state: {
      tracks: [
        { id: 'google:already-1', remoteId: 'already-1', source: 'google', name: 'Existing.flac' },
        { id: 'google:sc-existing', remoteId: 'sc-existing', targetRemoteId: 'old-target', source: 'google', name: 'UpdatedSC.flac' }
      ],
      objectUrls: new Set()
    },
    $: () => ({ textContent: '', className: '' }),
    filenameMetadata: name => ({ title: name, artist: 'Artist', album: 'Album' }),
    ensureGoogleToken: async () => 'g-tok-test',
    invalidateCloudTrackContent: tr => invalidatedIds.push(tr.id),
    cloudMetadata: {
      readRemoteTags: async (_jm, meta) => {
        readTagUrls.push(meta.url);
        return { title: 'Tag Title' };
      }
    },
    fetch: async url => {
      fetchedUrls.push(url);
      if (url.includes('fields=thumbnailLink')) {
        return { ok: true, status: 200, json: async () => ({ thumbnailLink: 'https://thumb.example/cover=s220' }) };
      }
      return { ok: true, status: 200, blob: async () => ({ size: 128, type: 'image/jpeg' }) };
    },
    FileReader: class {
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,AA==';
        if (this.onload) this.onload();
      }
    },
    fetchCloudTrack: async (_tr, url) => { fetchCloudTrackUrls.push(url); },
    fetchCloudFile: async (_tr, url) => { fetchCloudTrackUrls.push(url); },
    fetchGoogleDrivePageWithRetry: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        files: [
          { id: 'sc-dup', name: 'Duplicate.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'already-1', targetMimeType: 'audio/flac' } },
          { id: 'sc-folder', name: 'Trick.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'dir-99', targetMimeType: 'application/vnd.google-apps.folder' } },
          { id: 'sc-existing', name: 'UpdatedSC.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'new-target', targetMimeType: 'audio/flac' } },
          { id: 'sc-1', name: 'Shared Song', mimeType: 'application/vnd.google-apps.shortcut', size: '12345', shortcutDetails: { targetId: 'real-audio-1', targetMimeType: 'audio/flac' } }
        ]
      })
    }),
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(serStart, serEnd) + '\n' +
      html.slice(tagStart, tagEnd) + '\n' +
      html.slice(scStart, scEnd) + '\n' +
      html.slice(loadGStart, loadGEnd) +
      '\nthis.isCloudAudio = isCloudAudio;' +
      '\nthis.audioFormat = audioFormat;' +
      '\nthis.googleTrack = googleTrack;' +
      '\nthis.serializableCloudTrack = serializableCloudTrack;' +
      '\nthis.cloudTagRequest = cloudTagRequest;' +
      '\nthis.googleThumbnail = googleThumbnail;' +
      '\nthis.scanGoogleDriveAudioShortcuts = scanGoogleDriveAudioShortcuts;' +
      '\nthis.loadGoogleAudio = loadGoogleAudio;',
    sandbox
  );

  // isCloudAudio & audioFormat checks on shortcuts
  assert.equal(sandbox.isCloudAudio({ id: 'sc-a', name: 'Live Master', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't1', targetMimeType: 'audio/flac' } }), true);
  assert.equal(sandbox.isCloudAudio({ id: 'sc-b', name: 'Song.dsf', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't2', targetMimeType: 'application/octet-stream' } }), true);
  assert.equal(sandbox.isCloudAudio({ id: 'sc-dir', name: 'FakeAudio.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't3', targetMimeType: 'application/vnd.google-apps.folder' } }), false);
  assert.equal(sandbox.isCloudAudio({ id: 'sc-doc', name: 'Notes.flac', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't4', targetMimeType: 'application/vnd.google-apps.document' } }), false);
  assert.equal(sandbox.isCloudAudio({ id: 'sc-empty', name: 'NoTarget.flac', mimeType: 'application/vnd.google-apps.shortcut' }), false);
  assert.equal(sandbox.audioFormat({ name: 'Live Master', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 't1', targetMimeType: 'audio/flac' } }), 'FLAC');

  // Scan shortcuts: skip already-1 target duplicate, reject folder, update existing shortcut target, add sc-1
  const existingMap = new Map(sandbox.state.tracks.map(t => [t.remoteId, t]));
  const knownIds = new Set(existingMap.keys());
  const seenRemoteIds = new Set();
  const updatedExisting = [];
  const newlyAdded = [];
  const scRes = await sandbox.scanGoogleDriveAudioShortcuts(
    () => 'g-tok-test',
    async () => 'g-tok-test',
    existingMap,
    knownIds,
    seenRemoteIds,
    updatedExisting,
    newlyAdded
  );

  assert.equal(scRes.added, 1);
  assert.ok(!existingMap.has('sc-dup'), 'Shortcut pointing to an already-known Drive targetId must not create duplicate');
  assert.ok(!existingMap.has('sc-folder'), 'Folder shortcut must never be ingested as audio');
  assert.deepEqual(invalidatedIds, ['google:sc-existing'], 'Retargeted shortcut must invalidate cached slice/metadata');
  assert.equal(existingMap.get('sc-existing').targetRemoteId, 'new-target');

  const scTrack = sandbox.state.tracks.find(t => t.remoteId === 'sc-1');
  assert.ok(scTrack && scTrack.targetRemoteId === 'real-audio-1', 'googleTrack must keep remoteId=shortcutId and set targetRemoteId');
  assert.equal(sandbox.serializableCloudTrack(scTrack).targetRemoteId, 'real-audio-1', 'serializableCloudTrack must persist targetRemoteId');

  // Verify loadGoogleAudio, cloudTagRequest & googleThumbnail resolve targetRemoteId
  await sandbox.loadGoogleAudio('sc-1');
  await sandbox.cloudTagRequest(scTrack);
  await sandbox.googleThumbnail(scTrack);

  assert.ok(fetchCloudTrackUrls[0].includes('/files/real-audio-1?alt=media&supportsAllDrives=true'));
  assert.ok(readTagUrls[0].includes('/files/real-audio-1?alt=media&supportsAllDrives=true'));
  assert.ok(fetchedUrls.some(u => u.includes('/files/real-audio-1?fields=thumbnailLink&supportsAllDrives=true')));
});

test('3. OneDrive shared folders/items (remoteItem / remoteDriveId) scan, serialize, and stream via /drives/{driveId}/items/{id}', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const serStart = html.indexOf('const MAX_CATALOG_COVER_CHARS =');
  const serEnd = html.indexOf('let cloudMetadataQueue = [], cloudMetadataActive = 0;', serStart);
  const tagStart = html.indexOf('function isCloudAuthHttpError(err)');
  const tagEnd = html.indexOf('function allSettledCompat(', tagStart);
  const shStart = html.indexOf('async function enqueueMicrosoftSharedItems(');
  const shEnd = html.indexOf('async function saveMicrosoftLatestDeltaLink(token)', shStart);
  const msFnStart = html.indexOf('async function loadMicrosoftFiles(token) {');
  const resStart = html.indexOf('async function resolveMicrosoftDownloadUrl(track) {', msFnStart);
  const resEnd = html.indexOf('function settingsError(error)', resStart);

  assert.ok(serStart !== -1 && serEnd > serStart);
  assert.ok(tagStart !== -1 && tagEnd > tagStart);
  assert.ok(shStart !== -1 && shEnd > shStart);
  assert.ok(resStart !== -1 && resEnd > resStart);

  // Preserve exact 2 matches of $select=id,name,file,folder,cTag,size,audio&$top=500 in loadMicrosoftFiles (test/v3-9-46 invariant)
  const msSrc = html.slice(msFnStart, resStart);
  const stdSelectMatches = msSrc.match(/\$select=id,name,file,folder,cTag,size,audio&\$top=500/g) || [];
  assert.equal(stdSelectMatches.length, 2, 'loadMicrosoftFiles must keep exact 2 standard $select root/subfolder strings');

  const library = require(path.join(ROOT, 'library-utils.js'));
  const graphUrls = [];
  const tagUrls = [];
  const streamUrls = [];

  const sandbox = {
    library,
    Date,
    Array,
    Number,
    String,
    Object,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    window: { jsmediatags: {} },
    state: {
      tracks: [],
      objectUrls: new Set(),
      microsoftAccessToken: 'ms-tok'
    },
    AUDIO_TYPES: /\.(flac)$/i,
    CLOUD_AUDIO_TYPES: /\.(flac)$/i,
    MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
    audioFormat: () => 'FLAC',
    filenameMetadata: name => ({ title: name, artist: 'Artist', album: 'Album' }),
    isDsdFormat: () => false,
    isCloudAudio: item => Boolean(item && item.name && item.name.endsWith('.flac')),
    getMicrosoftToken: async () => 'ms-tok',
    invalidateCloudTrackContent: () => {},
    cloudMetadata: {
      readRemoteTags: async (_jm, meta) => {
        tagUrls.push(meta.url);
        return { title: 'Shared OD Track' };
      }
    },
    graphGet: async url => {
      graphUrls.push(url);
      if (url.includes('/sharedWithMe')) {
        return {
          value: [
            {
              id: 'sc-folder-wrap',
              name: 'Shared FLAC Folder',
              remoteItem: {
                id: 'sh-dir-1',
                name: 'Shared FLAC Folder',
                folder: { childCount: 5 },
                parentReference: { driveId: 'drv-shared-1' }
              }
            },
            {
              id: 'sc-file-wrap',
              name: 'Direct Shared.flac',
              remoteItem: {
                id: 'sh-file-1',
                name: 'Direct Shared.flac',
                size: 24000000,
                cTag: 'c-sh-1',
                audio: { title: 'Direct Shared Title', artist: 'Guest' },
                parentReference: { driveId: 'drv-shared-2' }
              }
            }
          ]
        };
      }
      if (url.includes('/drives/drv-shared-2/items/sh-file-1')) {
        return { '@microsoft.graph.downloadUrl': 'https://sharepoint.example/shared-dl-1' };
      }
      return {};
    },
    fetchCloudTrack: async (_tr, url) => { streamUrls.push(url); },
    fetchCloudFile: async (_tr, url) => { streamUrls.push(url); },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    html.slice(serStart, serEnd) + '\n' +
      html.slice(tagStart, tagEnd) + '\n' +
      html.slice(shStart, shEnd) + '\n' +
      html.slice(resStart, resEnd) +
      '\nthis.normalizeMicrosoftDriveItem = normalizeMicrosoftDriveItem;' +
      '\nthis.microsoftTrack = microsoftTrack;' +
      '\nthis.mergeMicrosoftTrack = mergeMicrosoftTrack;' +
      '\nthis.serializableCloudTrack = serializableCloudTrack;' +
      '\nthis.enqueueMicrosoftSharedItems = enqueueMicrosoftSharedItems;' +
      '\nthis.resolveMicrosoftDownloadUrl = resolveMicrosoftDownloadUrl;' +
      '\nthis.loadMicrosoftAudio = loadMicrosoftAudio;' +
      '\nthis.cloudTagRequest = cloudTagRequest;',
    sandbox
  );

  const queue = [];
  const visitedFolders = new Set();
  const existingMap = new Map();
  const knownIds = new Set();
  const seenIds = new Set();
  const updated = [];

  const sharedAdded = await sandbox.enqueueMicrosoftSharedItems('ms-tok', queue, visitedFolders, existingMap, knownIds, seenIds, updated);
  assert.equal(sharedAdded.length, 1);
  assert.equal(queue.length, 1, 'Shared folder from sharedWithMe must be queued with its remote driveId');
  assert.equal(queue[0].driveId, 'drv-shared-1');
  assert.ok(queue[0].url.includes('/drives/drv-shared-1/items/sh-dir-1/children?$select=id,name,file,folder,cTag,size,audio,remoteItem&$top=500'));

  // Calling again does not re-queue already visited shared folder
  await sandbox.enqueueMicrosoftSharedItems('ms-tok', queue, visitedFolders, existingMap, knownIds, seenIds, updated);
  assert.equal(queue.length, 1, 'visitedFolders must prevent duplicate shared folder scans');

  const shTrack = sandbox.state.tracks.find(t => t.remoteId === 'sh-file-1');
  assert.ok(shTrack && shTrack.remoteDriveId === 'drv-shared-2');
  assert.equal(sandbox.serializableCloudTrack(shTrack).remoteDriveId, 'drv-shared-2');

  // mergeMicrosoftTrack preserves remoteDriveId
  sandbox.mergeMicrosoftTrack(shTrack, { id: 'sh-file-1', name: 'Direct Shared.flac', audio: { title: 'Updated' } });
  assert.equal(shTrack.remoteDriveId, 'drv-shared-2');

  // resolveMicrosoftDownloadUrl & cloudTagRequest use /drives/{driveId}/items/{id}
  const dlUrl = await sandbox.resolveMicrosoftDownloadUrl(shTrack);
  assert.equal(dlUrl, 'https://sharepoint.example/shared-dl-1');
  assert.ok(graphUrls.some(u => u.endsWith('/drives/drv-shared-2/items/sh-file-1')));

  await sandbox.cloudTagRequest(shTrack);
  assert.deepEqual(tagUrls, ['https://sharepoint.example/shared-dl-1']);

  // Fallback to Graph /content uses /drives/{driveId}/items/{id}/content when directUrl fails
  shTrack.downloadUrl = '';
  shTrack.downloadUrlAt = 0;
  sandbox.graphGet = async () => ({});
  await sandbox.loadMicrosoftAudio('sh-file-1');
  assert.ok(streamUrls.some(u => u.endsWith('/drives/drv-shared-2/items/sh-file-1/content')));
});

test('4. Version sync v3.9.50 / versionCode 104, 404.html parity, 0 CR bytes, Web Audio invariants & 0 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  const publishRelease = fs.readFileSync(path.join(ROOT, '.agent/publish-release.cjs'), 'utf8');

  assert.equal(html404, indexHtml, '404.html must match index.html');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html')).includes(13), false, '404.html must have 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:5\d|[6-9]\d|\d{3,})/.test(indexHtml));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.50';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.50';"));
  assert.ok(/versionCode\s*=\s*(?:10[4-9]|1[1-9]\d|[2-9]\d{2,})\b/.test(gradle));
  assert.ok(gradle.includes('versionName = "3.9.50"'));
  assert.ok(/"3\.9\.(?:5\d|[6-9]\d|\d{3,})"/.test(mainActivity));
  assert.ok(/v3\.9\.(?:5\d|[6-9]\d|\d{3,})/.test(publishRelease));

  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(indexHtml.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(indexHtml.includes('target.volume = audio.volume; target.muted = false;'));
  assert.equal(/\bmodal\.showModal\s*\(/.test(indexHtml), false);

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

  const scriptStart = indexHtml.lastIndexOf('<script>');
  const scriptEnd = indexHtml.lastIndexOf('</script>');
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
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain bare catch {}`);
    }
  }
});
