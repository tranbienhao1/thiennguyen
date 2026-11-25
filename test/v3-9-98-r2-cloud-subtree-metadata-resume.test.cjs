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

function makeStorage(seed = {}) {
  const store = Object.assign({}, seed);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _dump: store
  };
}

describe('v3.9.98 R2: Cloud Multi-Level Subtree Pruning, Metadata/RG/LRC Queue & Resume Reconciliation', () => {
  it('1. tryLoadGoogleChangesDelta recursively prunes 3-level nested folder subtrees when top ancestor folder is trashed/removed', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    const ls = makeStorage({
      'nocturne-google-delta-token': 'tok-1',
      'nocturne-google-folder-tree': JSON.stringify({
        folderA: ['root'],
        folderB: ['folderA'],
        folderC: ['folderB'],
        folderKeep: ['root']
      })
    });
    const removedRemoteSets = [];
    const track1 = { id: 'google:t1', remoteId: 't1', source: 'google', parents: ['folderC'], name: 'deep.flac' };
    const track2 = { id: 'google:t2', remoteId: 't2', source: 'google', parents: ['folderB'], name: 'mid.flac' };
    const trackKeep = { id: 'google:tKeep', remoteId: 'tKeep', source: 'google', parents: ['folderKeep'], name: 'keep.flac' };

    const existingByRemoteId = new Map([['t1', track1], ['t2', track2], ['tKeep', trackKeep]]);
    const knownIds = new Set(['t1', 't2', 'tKeep']);

    const sandbox = {
      localStorage: ls,
      library,
      state: { tracks: [track1, track2, trackKeep] },
      checkedGoogleArtParents: new Set(),
      URLSearchParams,
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON,
      fetchGoogleDrivePageWithRetry: async () => ({
        status: 200,
        ok: true,
        async json() {
          return {
            newStartPageToken: 'tok-2',
            changes: [
              { fileId: 'folderA', removed: false, file: { id: 'folderA', mimeType: 'application/vnd.google-apps.folder', trashed: true } }
            ]
          };
        }
      }),
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (src, remoteIds) => {
        removedRemoteSets.push({ src, ids: Array.from(remoteIds) });
        const idsSet = new Set(remoteIds);
        let c = 0;
        for (let i = sandbox.state.tracks.length - 1; i >= 0; i--) {
          if (idsSet.has(sandbox.state.tracks[i].remoteId)) {
            sandbox.state.tracks.splice(i, 1);
            c++;
          }
        }
        return c;
      },
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {}
    };

    vm.runInNewContext(gTreeSlice + '\n' + gDeltaSlice + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', sandbox);
    const res = await sandbox.tryLoadGoogleChangesDelta('g-token', existingByRemoteId, knownIds);
    assert.equal(res.handled, true);
    assert.equal(res.removed, 2);
    assert.deepEqual(sandbox.state.tracks.map(t => t.remoteId), ['tKeep']);
    const treeAfter = JSON.parse(ls.getItem('nocturne-google-folder-tree'));
    assert.equal(treeAfter.folderA, undefined);
    assert.equal(treeAfter.folderB, undefined);
    assert.equal(treeAfter.folderC, undefined);
    assert.ok(Array.isArray(treeAfter.folderKeep));
  });

  it('2. tryLoadMicrosoftDeltaSync recursively prunes nested folders, falls back to remotePath prefix, propagates renames, and loadMicrosoftFiles selects parentReference', async () => {
    const msSelectMatch = html.match(/MS_ROOT_CHILDREN_URL\s*=\s*'([^']+)'/);
    assert.ok(msSelectMatch && msSelectMatch[1].includes('$select=id,name,file,folder,cTag,size,audio&$top=500'), 'loadMicrosoftFiles must preserve $select string');
    assert.ok(html.includes('folderId:String(item.id)') && html.includes('msFullFolderTree[String(item.id)]'), 'loadMicrosoftFiles must build OneDrive folder parent tree via folderNode.folderId');

    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const msDeltaSlice = extractBetween(html, 'async function tryLoadMicrosoftDeltaSync(', 'async function verifyMicrosoftAccountSwitch(');

    const ls = makeStorage({
      'nocturne-microsoft-delta-link': 'https://graph.microsoft.com/v1.0/delta?t=1',
      'nocturne-onedrive-folder-tree': JSON.stringify({
        msA: { parentId: 'root', path: 'Music/Archive', driveId: '' },
        msB: { parentId: 'msA', path: 'Music/Archive/Classical', driveId: '' },
        msC: { parentId: 'msB', path: 'Music/Archive/Classical/Bach', driveId: '' },
        msRenameParent: { parentId: 'root', path: 'Music/OldName', driveId: '' },
        msRenameChild: { parentId: 'msRenameParent', path: 'Music/OldName/Disc 1', driveId: '' }
      })
    });

    const trNested = { id: 'onedrive:t1', remoteId: 't1', source: 'onedrive', remoteParentId: 'msC', remotePath: 'Music/Archive/Classical/Bach/01.flac', name: '01.flac' };
    const trPrefixOnly = { id: 'onedrive:t2', remoteId: 't2', source: 'onedrive', remoteParentId: '', remotePath: 'Music/Archive/Classical/Bach/02.flac', name: '02.flac' };
    const trRenamedChild = { id: 'onedrive:t3', remoteId: 't3', source: 'onedrive', remoteParentId: 'msRenameChild', remotePath: 'Music/OldName/Disc 1/03.flac', name: '03.flac' };
    const existingByRemoteId = new Map([['t1', trNested], ['t2', trPrefixOnly], ['t3', trRenamedChild]]);
    const knownIds = new Set(['t1', 't2', 't3']);

    const sandbox = {
      localStorage: ls,
      library,
      state: { tracks: [trNested, trPrefixOnly, trRenamedChild], microsoftAccessToken: 'ms-tok' },
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON,
      graphGet: async () => ({
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?t=2',
        value: [
          { id: 'msA', deleted: { state: 'deleted' } },
          {
            id: 'msRenameParent',
            name: 'NewName',
            folder: { childCount: 1 },
            parentReference: { id: 'root', path: '/drive/root:/Music' }
          }
        ]
      }),
      isCloudAudio: () => false,
      persistCloudCatalog: async () => {},
      pruneCloudCatalog: async () => {},
      removeCloudTracksByRemoteIds: async (src, remoteIds) => {
        const set = new Set(remoteIds);
        let c = 0;
        for (let i = sandbox.state.tracks.length - 1; i >= 0; i--) {
          if (set.has(sandbox.state.tracks[i].remoteId)) {
            sandbox.state.tracks.splice(i, 1);
            c++;
          }
        }
        return c;
      },
      renderTracks: () => {},
      cloudStatus: () => {},
      toast: () => {}
    };

    vm.runInNewContext(gTreeSlice + '\n' + msDeltaSlice + '\nthis.tryLoadMicrosoftDeltaSync = tryLoadMicrosoftDeltaSync;', sandbox);
    const res = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', existingByRemoteId, knownIds, new Map());
    assert.equal(res.handled, true);
    assert.equal(res.removed, 2, 'Deleting msA must recursively prune msC track and remotePath prefix track');
    assert.equal(sandbox.state.tracks.length, 1);
    assert.equal(sandbox.state.tracks[0].remotePath, 'Music/NewName/Disc 1/03.flac', 'Renaming msRenameParent must recursively propagate to nested msRenameChild track path');
  });

  it('3. serializableCloudTrack, needsCloudMetadataEnrichment, repopulateCloudMetadataQueue & enrichCloudTrack handle ReplayGain, LRC & checkpointing', async () => {
    const serSlice = extractBetween(html, 'const MAX_CATALOG_COVER_CHARS', 'const googleTrack =');
    const qSlice = extractBetween(html, 'function needsCloudMetadataEnrichment(', 'function isCloudAuthHttpError(');
    const enrSlice = extractBetween(html, 'async function enrichCloudTrack(', 'const dsdWorkerBaseUrl =');

    const persistedBatches = [];
    const lrcFetches = [];
    const docHandlers = {};
    const winHandlers = {};

    const trackMissingRgLrc = {
      id: 'google:g1',
      remoteId: 'g1',
      source: 'google',
      name: 'Aria.flac',
      title: 'Aria',
      artist: 'Bach',
      album: 'Goldberg',
      cover: 'data:image/jpeg;base64,AAA',
      metadataLoaded: true,
      parents: ['p1']
    };
    const trackComplete = {
      id: 'onedrive:m1',
      remoteId: 'm1',
      source: 'onedrive',
      name: 'Done.flac',
      cover: 'data:image/jpeg;base64,BBB',
      metadataLoaded: true,
      replayGainTrackGain: -6.5,
      _replayGainChecked: true,
      lyricsText: '[00:01.00] Hello',
      _cloudLrcChecked: true
    };

    const sandbox = {
      library,
      IS_LEGACY_ANDROID: false,
      CLOUD_METADATA_CONCURRENCY: 2,
      cloudMetadataQueued: new Set(),
      cloudMetadataQueue: [],
      cloudMetadataActive: 0,
      cloudMetadataPausedUntil: 0,
      trackMetadataRevision: 0,
      filterOptionsSignature: '',
      navigator: { onLine: true },
      document: {
        hidden: false,
        addEventListener(ev, fn) { docHandlers[ev] = fn; }
      },
      window: {
        addEventListener(ev, fn) { winHandlers[ev] = fn; }
      },
      state: {
        isPlaybackLoading: false,
        googleToken: 'tok-g',
        googleExpiresAt: Date.now() + 3600 * 1000,
        microsoftAccessToken: 'tok-ms',
        albumCovers: new Map(),
        tracks: [trackMissingRgLrc, trackComplete]
      },
      allSettledCompat: ps => Promise.all(ps.map(p => Promise.resolve(p).then(
        value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason })
      ))),
      cloudTagRequest: async () => ({
        title: 'Aria',
        artist: 'Bach',
        album: 'Goldberg',
        replayGainTrackGain: -5.2,
        replayGainAlbumGain: -6.1,
        iTunNORM: '00001234'
      }),
      googleThumbnail: async () => null,
      microsoftThumbnail: async () => null,
      fetchCloudSidecarLrc: async (tr) => {
        lrcFetches.push(tr.id);
        tr._checkedDriveLrc = true;
        return { text: '[00:02.00] Aria line', name: 'Aria.lrc', source: 'cloud-sidecar' };
      },
      normalizeCoverImage: async c => c,
      persistCloudCatalog: async (batch) => { persistedBatches.push(batch.map(x => sandbox.serializableCloudTrack(x))); },
      pruneCloudCatalog: async () => {},
      updateMetadataFilters: () => {},
      scheduleTrackRender: () => {},
      pauseCloudMetadataQueue: () => {},
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, Promise, console
    };

    vm.runInNewContext(serSlice + '\n' + qSlice + '\n' + enrSlice + '\nthis.serializableCloudTrack = serializableCloudTrack;', sandbox);

    assert.equal(sandbox.needsCloudMetadataEnrichment(trackMissingRgLrc), true, 'Track missing RG and LRC must need enrichment');
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackComplete), false, 'Fully enriched track must not need enrichment');

    const queuedCount = sandbox.repopulateCloudMetadataQueue();
    assert.equal(queuedCount, 1);

    // Wait for async queue drain
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 15));
      if (sandbox.cloudMetadataActive === 0 && sandbox.cloudMetadataQueue.length === 0) break;
    }

    assert.equal(lrcFetches.length, 1);
    assert.equal(trackMissingRgLrc.replayGainTrackGain, -5.2);
    assert.equal(trackMissingRgLrc._replayGainChecked, true);
    assert.equal(trackMissingRgLrc._checkedDriveLrc, true);
    assert.equal(trackMissingRgLrc.lyricsText, '[00:02.00] Aria line');
    assert.equal(sandbox.needsCloudMetadataEnrichment(trackMissingRgLrc), false);

    assert.ok(persistedBatches.length >= 1, 'Queue drain must checkpoint via persistCloudCatalog');
    const serialized = persistedBatches[0][0];
    assert.equal(serialized.replayGainTrackGain, -5.2);
    assert.equal(serialized.iTunNORM, '00001234');
    assert.equal(serialized._replayGainChecked, true);
    assert.equal(serialized._checkedDriveLrc, true);
    assert.equal(serialized.lyricsText, '[00:02.00] Aria line');
    assert.equal(typeof docHandlers.visibilitychange, 'function');
    assert.equal(typeof winHandlers.pagehide, 'function');
  });

  it('4. buildStableTrackRef/matchTrackByStableRef cross-match aliases & CUE refs, and checkAndPromptResumeSession honors BP/dismiss guards & delayed reconciliation', () => {
    const gTrackSaved = {
      id: 'google:sc1',
      source: 'google',
      remoteId: 'sc1',
      targetRemoteId: 'target123',
      title: 'Symphony No. 9',
      artist: 'Beethoven'
    };
    const gRef = library.buildStableTrackRef(gTrackSaved);
    const gTrackRemapped = {
      id: 'google:target123',
      source: 'google',
      remoteId: 'target123',
      remoteShortcutId: 'sc1',
      title: 'Symphony No. 9',
      artist: 'Beethoven'
    };
    const matchedCloud = library.matchTrackByStableRef(gRef, [gTrackRemapped]);
    assert.equal(matchedCloud, gTrackRemapped, 'matchTrackByStableRef must cross-match remoteId/targetRemoteId/remoteShortcutId');

    const cueSaved = {
      id: 'local_old_cue_1',
      source: 'local',
      isCue: true,
      cueStart: 240,
      cueFile: 'Album.cue',
      parentFile: 'Album.flac',
      title: 'Movement II'
    };
    const cueRef = library.buildStableTrackRef(cueSaved);
    assert.equal(cueRef.cueFile, 'Album.cue');
    assert.equal(cueRef.parentFile, 'Album.flac');
    const cueRestored = {
      id: 'local_new_cue_1',
      source: 'local',
      isCue: true,
      cueStart: 240.1,
      cueFile: 'Album.cue',
      parentFile: 'Album.flac',
      title: 'Movement II'
    };
    assert.equal(library.matchTrackByStableRef(cueRef, [cueRestored]), cueRestored);

    const resumeSlice = extractBetween(html, 'function checkAndPromptResumeSession()', 'const isAppPlaying =');
    const dismissSlice = extractBetween(html, "/* $('resume-session-dismiss')", "audio.addEventListener('play'");
    const bannerEl = {
      classList: {
        _set: new Set(['hidden']),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      }
    };
    const textEl = { textContent: '' };
    const dismissBtn = { _handlers: {}, addEventListener(ev, fn) { this._handlers[ev] = fn; } };
    const rawSession = library.savePlaybackSession('cue_future_1', 250, [], {
      updatedAt: 1700000000000,
      track: cueSaved
    });
    const ls = makeStorage({ 'nocturne-playback-session': rawSession });

    const sandbox = {
      localStorage: ls,
      library,
      window: {},
      $: id => (id === 'resume-session-banner' ? bannerEl : (id === 'resume-session-text' ? textEl : (id === 'resume-session-dismiss' ? dismissBtn : null))),
      safeOn: (el, ev, fn) => { if (el) el.addEventListener(ev, fn); },
      state: {
        currentId: null,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        _bpAwaitingStart: false,
        tracks: [{ id: 'unrelated', source: 'local', title: 'Other' }]
      },
      Math, Number, String, Boolean, JSON
    };
    vm.runInNewContext(resumeSlice + '\n' + dismissSlice, sandbox);

    // Initially CUE track hasn't resolved yet -> prompt stays hidden
    assert.equal(sandbox.checkAndPromptResumeSession(), false);
    assert.equal(bannerEl.classList.contains('hidden'), true);

    // Native Bit-Perfect active -> prompt stays suppressed even if track is present
    sandbox.state.tracks.push(cueRestored);
    sandbox.state.isNativeBitPerfectPlaying = true;
    assert.equal(sandbox.checkAndPromptResumeSession(), false);
    assert.equal(bannerEl.classList.contains('hidden'), true);

    // When Native Bit-Perfect is inactive and CUE track has resolved -> reconcile opens prompt
    sandbox.state.isNativeBitPerfectPlaying = false;
    assert.equal(sandbox.checkAndPromptResumeSession(), true);
    assert.equal(bannerEl.classList.contains('hidden'), false);
    assert.equal(sandbox.state._activeResumePromptTrackId, 'local_new_cue_1');

    // Dismissing hides banner and prevents re-opening on subsequent renderTracks()
    dismissBtn._handlers.click();
    assert.equal(bannerEl.classList.contains('hidden'), true);
    assert.equal(sandbox.checkAndPromptResumeSession(), false);
    assert.equal(bannerEl.classList.contains('hidden'), true);
  });
});
