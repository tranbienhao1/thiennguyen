'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const library = require(path.join(ROOT, 'library-utils.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);

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

function makeDummyEl(extra = {}) {
  return Object.assign({
    textContent: '',
    innerHTML: '',
    value: '0',
    checked: false,
    hidden: false,
    src: '',
    className: '',
    dataset: {},
    style: { setProperty() {} },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c);
          else this._set.add(c);
        } else if (force) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    matches: () => false,
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {}
  }, extra);
}

describe('v3.9.99 R2: Google/OneDrive/Local/FiiO Sync Pruning & Native Bit-Perfect / MediaSession / Rehydration', () => {
  it('1. syncGoogleFolderTree retains and merges prior tree on partial HTTP 500 or truncation, and replaces cleanly on complete fetch', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const ls = makeStorage({
      'nocturne-google-folder-tree': JSON.stringify({
        keepFolder: ['root'],
        oldChild: ['keepFolder']
      })
    });

    let pageMode = 'partial_500';
    let callIdx = 0;
    const sandbox = {
      localStorage: ls,
      URLSearchParams,
      Object, Array, String, Number, Boolean, Date, Math, JSON, Map, Set,
      ensureGoogleToken: async () => 'g-tok',
      fetchGoogleDrivePageWithRetry: async () => {
        callIdx++;
        if (pageMode === 'partial_500') {
          if (callIdx === 1) {
            return {
              ok: true,
              status: 200,
              async json() {
                return {
                  nextPageToken: 'p2',
                  files: [{ id: 'newFolder', parents: ['root'] }]
                };
              }
            };
          }
          return { ok: false, status: 500 };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              files: [{ id: 'freshOnly', parents: ['root'] }]
            };
          }
        };
      }
    };
    vm.runInNewContext(gTreeSlice + '\nthis.syncGoogleFolderTree = syncGoogleFolderTree;', sandbox);

    await sandbox.syncGoogleFolderTree('g-tok');
    const merged = JSON.parse(ls.getItem('nocturne-google-folder-tree'));
    assert.deepEqual(merged.keepFolder, ['root'], 'Partial error must preserve prior folder edge keepFolder');
    assert.deepEqual(merged.oldChild, ['keepFolder'], 'Partial error must preserve prior nested folder edge oldChild');
    assert.deepEqual(merged.newFolder, ['root'], 'Partial error must merge newly fetched page 1 folders');

    pageMode = 'complete';
    callIdx = 0;
    await sandbox.syncGoogleFolderTree('g-tok');
    const replaced = JSON.parse(ls.getItem('nocturne-google-folder-tree'));
    assert.deepEqual(replaced, { freshOnly: ['root'] }, 'Complete fetch must replace folder tree cleanly');
  });

  it('2. tryLoadGoogleChangesDelta commits cursor strictly after removal, calls markUpdatedTrack on .lrc reset, and indexes newly added delta tracks', async () => {
    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const gDeltaSlice = extractBetween(html, 'async function tryLoadGoogleChangesDelta(', 'function removeDeletedCloudTracks(');

    // Case A: .lrc reset marks updated track before flush; cursor commits strictly after removeCloudTracksByRemoteIds & pruneCloudCatalog
    const callOrder = [];
    let persistedBatches = [];
    let shouldFailRemoval = true;

    const lsA = makeStorage({
      'nocturne-google-delta-token': 'tok-1',
      'nocturne-google-folder-tree': JSON.stringify({ p1: ['root'] })
    });
    const trLrcReset = {
      id: 'google:t1', remoteId: 't1', source: 'google', parents: ['p1'],
      name: 'Aria.flac', _checkedDriveLrc: true
    };
    const trDeleted = {
      id: 'google:t2', remoteId: 't2', source: 'google', parents: ['p1'],
      name: 'Gone.flac', _checkedDriveLrc: true
    };

    const makeSandbox = (ls, tracks, fetchFn, removeFn) => {
      const sb = {
        localStorage: ls,
        library,
        state: { tracks },
        checkedGoogleArtParents: new Set(),
        URLSearchParams,
        Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON,
        fetchGoogleDrivePageWithRetry: fetchFn,
        ensureGoogleToken: async () => 'g-tok',
        googleConfigurationHint: () => '',
        isCloudAudio: f => Boolean(f && /\.flac$/i.test(f.name || '')),
        googleTrack: f => ({
          id: `google:${f.id}`,
          remoteId: f.id,
          source: 'google',
          name: f.name,
          parents: f.parents || []
        }),
        invalidateCloudTrackContent: () => {},
        persistCloudCatalog: async (batch) => {
          callOrder.push('persistCloudCatalog');
          persistedBatches.push(batch.map(x => ({ id: x.id, _checkedDriveLrc: x._checkedDriveLrc })));
        },
        pruneCloudCatalog: async () => { callOrder.push('pruneCloudCatalog'); },
        removeCloudTracksByRemoteIds: removeFn,
        renderTracks: () => {},
        cloudStatus: () => {},
        toast: () => {}
      };
      vm.runInNewContext(gTreeSlice + '\n' + gDeltaSlice + '\nthis.tryLoadGoogleChangesDelta = tryLoadGoogleChangesDelta;', sb);
      return sb;
    };

    const sbFail = makeSandbox(
      lsA,
      [trLrcReset, trDeleted],
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            newStartPageToken: 'tok-2',
            changes: [
              { fileId: 'lrc1', removed: false, file: { id: 'lrc1', name: 'Aria.lrc', parents: ['p1'], mimeType: 'text/plain' } },
              { fileId: 't2', removed: true }
            ]
          };
        }
      }),
      async () => {
        callOrder.push('removeCloudTracksByRemoteIds');
        if (shouldFailRemoval) throw new Error('IDB delete error');
        return 1;
      }
    );

    const existingA = new Map([['t1', trLrcReset], ['t2', trDeleted]]);
    const knownA = new Set(['t1', 't2']);
    await assert.rejects(() => sbFail.tryLoadGoogleChangesDelta('g-tok', existingA, knownA), /IDB delete error/);
    assert.equal(lsA.getItem('nocturne-google-delta-token'), 'tok-1', 'Cursor must NOT commit if removeCloudTracksByRemoteIds throws');

    // Retry with succeeding removal
    callOrder.length = 0;
    persistedBatches = [];
    shouldFailRemoval = false;
    trLrcReset._checkedDriveLrc = true;
    const resA = await sbFail.tryLoadGoogleChangesDelta('g-tok', existingA, knownA);
    assert.equal(resA.handled, true);
    assert.equal(trLrcReset._checkedDriveLrc, false, 'Changed .lrc must reset _checkedDriveLrc');
    assert.ok(persistedBatches.some(b => b.some(x => x.id === 'google:t1' && x._checkedDriveLrc === false)),
      'markUpdatedTrack must persist _checkedDriveLrc: false via flushDeltaPersistence');
    assert.equal(lsA.getItem('nocturne-google-delta-token'), 'tok-2');
    assert.deepEqual(callOrder, ['persistCloudCatalog', 'removeCloudTracksByRemoteIds', 'pruneCloudCatalog']);

    // Case B: Newly added track in page 1 is indexed in existingByParentId so page 2 folder trash prunes it
    const lsB = makeStorage({
      'nocturne-google-delta-token': 'tok-10',
      'nocturne-google-folder-tree': JSON.stringify({ folderNew: ['root'] })
    });
    const trBase = { id: 'google:keep', remoteId: 'keep', source: 'google', parents: ['rootKeep'], name: 'Keep.flac' };
    let deltaPage = 0;
    const sbB = makeSandbox(
      lsB,
      [trBase],
      async () => {
        deltaPage++;
        if (deltaPage === 1) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                nextPageToken: 'tok-p2',
                changes: [
                  { fileId: 'tNew', removed: false, file: { id: 'tNew', name: 'NewInFolder.flac', parents: ['folderNew'] } }
                ]
              };
            }
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              newStartPageToken: 'tok-11',
              changes: [
                { fileId: 'folderNew', removed: false, file: { id: 'folderNew', mimeType: 'application/vnd.google-apps.folder', trashed: true } }
              ]
            };
          }
        };
      },
      async (_src, remoteIds) => {
        const delSet = new Set(remoteIds);
        let removed = 0;
        for (let i = sbB.state.tracks.length - 1; i >= 0; i--) {
          if (delSet.has(sbB.state.tracks[i].remoteId)) {
            sbB.state.tracks.splice(i, 1);
            removed++;
          }
        }
        return removed;
      }
    );
    const resB = await sbB.tryLoadGoogleChangesDelta('g-tok', new Map([['keep', trBase]]), new Set(['keep']));
    assert.equal(resB.handled, true);
    assert.equal(resB.removed, 1, 'Newly added track in folderNew must be pruned when folderNew is trashed in same delta batch');
    assert.deepEqual(sbB.state.tracks.map(t => t.remoteId), ['keep']);
  });

  it('3. tryLoadMicrosoftDeltaSync handles case-insensitive delete/rename prefixes (tail casing preserved), nested shared paths, cursor commit order & loadMicrosoftFiles retry folderId', async () => {
    const retrySection = extractBetween(html, 'if (msResumedFromCheckpoint && !restartedFromExpiredMsCp', 'const remainingForCp =');
    assert.ok(
      retrySection.includes("queue.push({ url: MS_ROOT_CHILDREN_URL, path: '', driveId: '', folderId: '' })"),
      "loadMicrosoftFiles expired-checkpoint retry must push { url: MS_ROOT_CHILDREN_URL, path: '', driveId: '', folderId: '' }"
    );

    const gTreeSlice = extractBetween(html, 'const GOOGLE_DELTA_TOKEN_KEY =', 'function removeCloudTracksByRemoteIds(');
    const msDeltaSlice = extractBetween(html, 'async function tryLoadMicrosoftDeltaSync(', 'async function verifyMicrosoftAccountSwitch(');

    const ls = makeStorage({
      'nocturne-microsoft-delta-link': 'https://graph.microsoft.com/v1.0/delta?t=1',
      'nocturne-onedrive-folder-tree': JSON.stringify({
        msSharedRoot: { parentId: 'shared', path: 'Shared/Jazz', driveId: 'drv-shared' },
        msDel: { parentId: 'root', path: 'Music/Archive', driveId: '' },
        msRename: { parentId: 'root', path: 'Music/OldName', driveId: '' }
      })
    });

    const trMixedDel = {
      id: 'onedrive:tDel', remoteId: 'tDel', source: 'onedrive',
      remoteParentId: '', remotePath: 'music/archive/01.flac', name: '01.flac'
    };
    const trMixedRename = {
      id: 'onedrive:tRen', remoteId: 'tRen', source: 'onedrive',
      remoteParentId: '', remotePath: 'music/oldname/SubMix/02.flac', name: '02.flac'
    };
    const events = [];
    const sandbox = {
      localStorage: ls,
      library,
      state: { tracks: [trMixedDel, trMixedRename], microsoftAccessToken: 'ms-tok' },
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON,
      graphGet: async () => ({
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?t=2',
        value: [
          { id: 'msDel', deleted: { state: 'deleted' } },
          { id: 'msRename', name: 'NewName', folder: { childCount: 1 }, parentReference: { id: 'root', path: '/drive/root:/Music' } },
          {
            id: 'sharedNested',
            name: 'BlueTrain.flac',
            file: { mimeType: 'audio/flac' },
            parentReference: { id: 'msSharedRoot', path: '' },
            remoteItem: {
              id: 'sharedNested',
              name: 'BlueTrain.flac',
              file: { mimeType: 'audio/flac' },
              parentReference: { id: 'msSharedRoot', driveId: 'drv-shared', path: '' }
            }
          }
        ]
      }),
      isCloudAudio: it => Boolean(it && it.file && /\.flac$/i.test(it.name || '')),
      microsoftTrack: (it, itemPath) => ({ id: `onedrive:${it.id}`, remoteId: it.id, source: 'onedrive', name: it.name, remotePath: itemPath }),
      mergeMicrosoftTrack: () => {},
      invalidateCloudTrackContent: () => {},
      persistCloudCatalog: async () => { events.push('persistCloudCatalog'); },
      pruneCloudCatalog: async () => { events.push('pruneCloudCatalog'); },
      removeCloudTracksByRemoteIds: async (_src, ids) => {
        events.push('removeCloudTracksByRemoteIds');
        const set = new Set(ids);
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

    const existing = new Map([['tDel', trMixedDel], ['tRen', trMixedRename]]);
    const known = new Set(['tDel', 'tRen']);
    const res = await sandbox.tryLoadMicrosoftDeltaSync('ms-tok', existing, known, new Map());

    assert.equal(res.handled, true);
    assert.equal(res.removed, 1, 'Case-insensitive deletedFolderPathPrefixes must prune music/archive/01.flac');
    assert.equal(trMixedRename.remotePath, 'Music/NewName/SubMix/02.flac',
      'Case-insensitive renamedFolderPrefixes must preserve tail SubMix/02.flac casing');
    const sharedAdded = sandbox.state.tracks.find(t => t.remoteId === 'sharedNested');
    assert.ok(sharedAdded, 'Shared nested audio track must be added');
    assert.equal(sharedAdded.remotePath, 'Shared/Jazz/BlueTrain.flac',
      'Nested shared item with empty parentReference.path must resolve via msFolderTree instead of flattening to Shared/');
    assert.equal(ls.getItem('nocturne-microsoft-delta-link'), 'https://graph.microsoft.com/v1.0/delta?t=2');
    assert.deepEqual(events, ['persistCloudCatalog', 'removeCloudTracksByRemoteIds', 'pruneCloudCatalog']);
  });

  it('4. Local directory handle walk sets _hadReadError on error to disable pruning, while clean empty folder prunes preserving state.currentId', async () => {
    const localPruneSlice = extractBetween(html, 'function pruneRemovedLocalFolderTracks(', 'async function refreshModifiedLocalTrack(');
    const collectSlice = extractBetween(html, 'async function collectAudioAndCoverFilesFromDirectoryHandle(', 'async function pickFolder(');
    const reopenSlice = extractBetween(html, 'async function reopenSavedFolderRecord(', 'async function reopenSavedFolder(');

    const addLocalCalls = [];
    const sandbox = {
      AUDIO_TYPES: /\.(mp3|flac|wav|m4a|ogg|opus|aac|aiff|aif|alac|ape|wv|mka|wma)$/i,
      STREAM_AUDIO_TYPES: /\.(dsf|dff)$/i,
      library,
      state: {
        currentId: 'loc-keep-playing',
        objectUrls: new Set(),
        tracks: [
          { id: 'loc-keep-playing', source: 'local', localFolderKey: 'dir:music', name: 'playing.flac', size: 10 },
          { id: 'loc-stale', source: 'local', localFolderKey: 'dir:music', name: 'deleted.flac', size: 20 }
        ]
      },
      addLocalFiles: async (files, opts) => {
        addLocalCalls.push({ count: files.length, opts });
        return { added: files.length, removed: 0 };
      },
      setReopenFolderWarning: () => {},
      clearRecentLocalFolderHandle: async () => {},
      renderTracks: () => {},
      pruneOrphanedAlbumCovers: () => {},
      pruneExcessObjectUrls: () => {},
      toast: () => {},
      URL: { revokeObjectURL: () => {} },
      console, Object, Set, Map, Array, String, Number, Boolean, Promise
    };
    vm.runInNewContext(
      `${localPruneSlice}\n${collectSlice}\n${reopenSlice}\nthis.collectAudioAndCoverFilesFromDirectoryHandle = collectAudioAndCoverFilesFromDirectoryHandle;\nthis.reopenSavedFolderRecord = reopenSavedFolderRecord;`,
      sandbox
    );

    // Subcase A: non-root subdir throwing error + empty result -> _hadReadError=true and NO pruning
    const dirWithBadSubdir = {
      name: 'Music',
      async queryPermission() { return 'granted'; },
      async *values() {
        yield {
          kind: 'directory',
          name: 'BrokenSub',
          values() { throw new Error('Permission denied in subdir'); }
        };
      }
    };
    const errFiles = await sandbox.collectAudioAndCoverFilesFromDirectoryHandle(dirWithBadSubdir);
    assert.equal(errFiles._hadReadError, true);
    await sandbox.reopenSavedFolderRecord({ handle: dirWithBadSubdir, folderKey: 'dir:music', name: 'Music' }, { silentIfGranted: true });
    assert.equal(sandbox.state.tracks.length, 2, 'Empty folder with _hadReadError=true MUST NOT prune existing tracks');

    // Subcase B: non-empty folder with unreadable file -> addLocalFiles receives pruneMissing: false, allowEmptyFolderPrune: false
    const dirWithPartialFileErr = {
      name: 'Music',
      async queryPermission() { return 'granted'; },
      async *values() {
        yield { kind: 'file', name: 'ok.flac', async getFile() { return { name: 'ok.flac' }; } };
        yield { kind: 'file', name: 'bad.flac', async getFile() { throw new Error('I/O error'); } };
      }
    };
    addLocalCalls.length = 0;
    await sandbox.reopenSavedFolderRecord({ handle: dirWithPartialFileErr, folderKey: 'dir:music', name: 'Music' }, { silentIfGranted: true });
    assert.equal(addLocalCalls.length, 1);
    assert.equal(addLocalCalls[0].opts.pruneMissing, false);
    assert.equal(addLocalCalls[0].opts.allowEmptyFolderPrune, false);

    // Subcase C: clean empty folder (_hadReadError=false) -> prunes loc-stale while keeping state.currentId (loc-keep-playing)
    const cleanEmptyDir = {
      name: 'Music',
      async queryPermission() { return 'granted'; },
      async *values() {}
    };
    const cleanRes = await sandbox.reopenSavedFolderRecord({ handle: cleanEmptyDir, folderKey: 'dir:music', name: 'Music' }, { silentIfGranted: true });
    assert.equal(cleanRes.removed, 1);
    assert.deepEqual(sandbox.state.tracks.map(t => t.id), ['loc-keep-playing'], 'Clean empty prune must keep state.currentId');

    // Subcase D: real addLocalFiles + handleEmptyLocalFilesBatch + pruneRemovedLocalFolderTracks from index.html
    const folderCoverSlice = extractBetween(html, 'function buildFolderCoverMap(', 'function cueAudioAliasKey(');
    const folderArtSlice = extractBetween(html, 'function applyFolderArtOnly(', 'function matchCueCandidateSubpath(');
    const addLocalAndEmptySlice = extractBetween(html, 'const normalizeCueNfc =', 'async function refreshModifiedLocalTrack(');

    let urlSeq = 0;
    const revokedUrls = [];
    let renderCalls = 0;
    const emptyBatchSandbox = {
      AUDIO_TYPES: /\.(mp3|flac|wav|m4a|ogg|opus|aac|aiff|aif|alac|ape|wv|mka|wma)$/i,
      STREAM_AUDIO_TYPES: /\.(dsf|dff)$/i,
      library,
      state: {
        currentId: 'keep-playing',
        objectUrls: new Set(),
        albumCovers: new Map(),
        tracks: [
          { id: 'keep-playing', source: 'local', localFolderKey: 'dir:a', album: 'AlbA', artist: 'ArtA', name: 'playing.flac', relativePath: 'a/playing.flac', size: 10 },
          { id: 'del-a', source: 'local', localFolderKey: 'dir:a', album: 'AlbA', artist: 'ArtA', name: 'deleted.flac', relativePath: 'a/deleted.flac', size: 20 },
          { id: 'keep-b', source: 'local', localFolderKey: 'dir:b', album: 'AlbB', artist: 'ArtB', name: 'other.flac', relativePath: 'b/other.flac', size: 30 }
        ]
      },
      URL: {
        createObjectURL: () => `blob:cover-${++urlSeq}`,
        revokeObjectURL: u => { revokedUrls.push(u); }
      },
      toast: () => {},
      renderTracks: () => { renderCalls++; },
      pruneOrphanedAlbumCovers: () => {},
      pruneExcessObjectUrls: () => {},
      syncAlbumCoversImmediate: () => {},
      console, Object, Set, Map, Array, String, Number, Boolean, Promise
    };
    vm.createContext(emptyBatchSandbox);
    vm.runInContext(
      `${folderCoverSlice}\n${folderArtSlice}\n${addLocalAndEmptySlice}\nthis.addLocalFiles = addLocalFiles;\nthis.handleEmptyLocalFilesBatch = handleEmptyLocalFilesBatch;`,
      emptyBatchSandbox
    );
    assert.equal(typeof emptyBatchSandbox.addLocalFiles, 'function');
    assert.equal(typeof emptyBatchSandbox.handleEmptyLocalFilesBatch, 'function');

    // D1: allowEmptyFolderPrune: false leaves existing tracks untouched
    const resNoPrune = await emptyBatchSandbox.addLocalFiles([], {
      folderRootKeys: ['dir:a', 'dir:b'],
      pruneFolderRootKeys: ['dir:a'],
      pruneMissing: true,
      allowEmptyFolderPrune: false,
      silent: true
    });
    assert.deepEqual({ added: resNoPrune.added, removed: resNoPrune.removed }, { added: 0, removed: 0 },
      'handleEmptyLocalFilesBatch with allowEmptyFolderPrune=false must leave tracks untouched');
    assert.deepEqual(Array.from(emptyBatchSandbox.state.tracks, t => t.id), ['keep-playing', 'del-a', 'keep-b']);

    // D2: allowEmptyFolderPrune: true with pruneFolderKeys=Set(['dir:a']) and folderArtCandidates prunes only del-a, preserves state.currentId and dir:b
    const artFile = { name: 'cover.jpg', relativePath: 'a/cover.jpg', _localFolderKey: 'dir:a', size: 123 };
    const resWithArtAndPrune = await emptyBatchSandbox.addLocalFiles([artFile], {
      folderRootKeys: ['dir:a', 'dir:b'],
      pruneFolderRootKeys: ['dir:a'],
      pruneMissing: true,
      allowEmptyFolderPrune: true,
      silent: true
    });
    assert.deepEqual({ added: resWithArtAndPrune.added, removed: resWithArtAndPrune.removed }, { added: 0, removed: 1 },
      'handleEmptyLocalFilesBatch with allowEmptyFolderPrune=true and folderArtCandidates must prune deleted track in dir:a');
    assert.deepEqual(Array.from(emptyBatchSandbox.state.tracks, t => t.id), ['keep-playing', 'keep-b'],
      'Must preserve state.currentId (keep-playing) and unrelated folder dir:b (keep-b)');
    assert.equal(emptyBatchSandbox.state.tracks[0].cover, 'blob:cover-1', 'Folder art candidate must apply to remaining dir:a track');
    assert.equal(emptyBatchSandbox.state.tracks[1].cover, undefined, 'Folder art from dir:a must NOT leak onto dir:b');
    assert.ok(renderCalls >= 1);

    // D3: allowEmptyFolderPrune: true without folderArtCandidates (pure empty batch non-art branch)
    emptyBatchSandbox.state.tracks.push({ id: 'del-a2', source: 'local', localFolderKey: 'dir:a', album: 'AlbA', artist: 'ArtA', name: 'deleted2.flac', relativePath: 'a/deleted2.flac', size: 25 });
    const resEmptyNoArt = await emptyBatchSandbox.addLocalFiles([], {
      folderRootKeys: ['dir:a', 'dir:b'],
      pruneFolderRootKeys: ['dir:a'],
      pruneMissing: true,
      allowEmptyFolderPrune: true,
      silent: true
    });
    assert.deepEqual({ added: resEmptyNoArt.added, removed: resEmptyNoArt.removed }, { added: 0, removed: 1 },
      'Pure empty batch with allowEmptyFolderPrune=true must prune deleted track in dir:a while keeping keep-playing and dir:b');
    assert.deepEqual(Array.from(emptyBatchSandbox.state.tracks, t => t.id), ['keep-playing', 'keep-b']);
  });

  it('5. scanFiioStorage ignores post-watchdog callbacks, skips pruning on truncated/mediaStoreFailed/unreadableRoots, protects SAF URIs, skips .m3u/.m3u8, and has zero .push(...', async () => {
    const fiioChunkSlice = extractBetween(html, 'function ingestFiioScannedFilesChunk(', 'function deduplicateStorageRoots(');
    const fiioPruneSlice = extractBetween(html, 'function extractStorageRootPrefix(', 'function finalizeFiioScanUi(');
    const fiioScanSlice = extractBetween(html, 'async function scanFiioStorage(', 'const FIIO_STORAGE_LINKED_KEY =');

    assert.equal(fiioScanSlice.includes('.push(...'), false, 'scanFiioStorage must never use .push(... spread');

    // Test A: ingestFiioScannedFilesChunk skips .m3u/.m3u8 and SAF protection in pruneMissingFiioTracks
    let safPermMap = { 'content://com.android.externalstorage.documents/tree/primary/keep': true, 'content://com.android.externalstorage.documents/tree/primary/revoked': false };
    const chunkSandbox = {
      library,
      window: {
        NocturneNative: {
          hasValidPersistedUriPermission: uri => Boolean(safPermMap[uri])
        }
      },
      state: {
        currentId: null,
        queueTrackIds: [],
        recentHistory: [],
        favorites: new Set(),
        tracks: [
          { id: 'fiio_saf_keep', uri: 'content://com.android.externalstorage.documents/tree/primary/keep', path: '/storage/emulated/0/Music/saf.flac', isCue: true, cueFilePath: '/storage/emulated/0/Music/saf.cue', size: 100 },
          { id: 'fiio_saf_revoked', uri: 'content://com.android.externalstorage.documents/tree/primary/revoked', path: '/storage/emulated/0/Music/rev.flac', size: 100 },
          { id: 'fiio_missing', path: '/storage/emulated/0/Music/gone.flac', size: 100 }
        ]
      },
      fiioScanUpgradedCount: 0,
      fiioScanSkippedUnchangedCount: 0,
      buildExistingFiioTrackMaps: () => ({ existingByPath: new Map(), existingByUri: new Map() }),
      normalizeFiioPathKey: p => String(p || '').trim().toLowerCase(),
      createFiioFallbackTrack: f => ({ id: `fiio_${f.name}`, path: f.path, uri: f.uri, name: f.name, size: f.size || 10 }),
      pruneOrphanedAlbumCovers: () => {},
      Map, Set, Array, Object, String, Number, Boolean, Date, Math, JSON
    };
    vm.runInNewContext(`${fiioChunkSlice}\n${fiioPruneSlice}`, chunkSandbox);

    const added = chunkSandbox.ingestFiioScannedFilesChunk(
      [
        { name: 'list.m3u', path: '/storage/emulated/0/Music/list.m3u' },
        { name: 'list2.m3u8', path: '/storage/emulated/0/Music/list2.m3u8' },
        { name: 'valid.flac', path: '/storage/emulated/0/Music/valid.flac', size: 500 }
      ],
      new Set(),
      new Set(),
      []
    );
    assert.equal(added, 1, 'ingestFiioScannedFilesChunk must skip .m3u and .m3u8 and ingest valid audio');

    const pruned = chunkSandbox.pruneMissingFiioTracks(
      new Set(['/storage/emulated/0/Music/valid.flac']),
      new Set(),
      {}
    );
    assert.equal(pruned, 2, 'Must prune revoked SAF track and missing non-SAF track while preserving valid SAF track (even CUE)');
    assert.equal(chunkSandbox.state.tracks.length, 2);
    assert.equal(chunkSandbox.state.tracks[0].id, 'fiio_saf_keep');
    assert.equal(chunkSandbox.state.tracks[1].path, '/storage/emulated/0/Music/valid.flac');

    // Test B: scanFiioStorage post-watchdog ignore & getLastStorageScanStatsJson() non-prune guards vs clean prune
    let scheduledWatchdog = null;
    let currentStatsJson = '{}';
    const scanSandbox = {
      library,
      window: {
        isNativeAndroid: true,
        NocturneNative: {
          hasStoragePermission: () => true,
          startAsyncStorageScan: () => true,
          getLastStorageScanStatsJson: () => currentStatsJson
        }
      },
      state: {
        currentId: null,
        queueTrackIds: [],
        recentHistory: [],
        favorites: new Set(),
        tracks: [{ id: 'fiio_old', path: '/storage/emulated/0/Music/old.flac', size: 123 }]
      },
      fiioScanInProgress: false,
      fiioScanUpgradedCount: 0,
      fiioScanSkippedUnchangedCount: 0,
      activeFiioScanMaps: null,
      pendingAndroidStorageScan: false,
      fiioScanWatchdogTimer: null,
      buildExistingFiioTrackMaps: () => ({ existingByPath: new Map(), existingByUri: new Map() }),
      buildExistingFiioTrackSets: () => ({ existingPaths: new Set(), existingUris: new Set() }),
      normalizeFiioPathKey: p => String(p || '').trim().toLowerCase(),
      createFiioFallbackTrack: f => ({ id: `fiio_${f.name}`, path: f.path, uri: f.uri, name: f.name, size: f.size || 10 }),
      expandFiioScannedCueSheets: () => 0,
      finalizeFiioScanUi: () => {},
      deduplicateStorageRoots: arr => arr,
      scheduleTrackRender: () => {},
      saveFiioCatalog: () => {},
      flushPendingFiioHotplugRescan: () => {},
      pruneOrphanedAlbumCovers: () => {},
      toast: () => {},
      setTimeout: (fn, ms) => {
        if (ms >= 60000) {
          scheduledWatchdog = fn;
          return 999;
        }
        return setTimeout(fn, ms);
      },
      clearTimeout: (id) => {
        if (id === 999) scheduledWatchdog = null;
        else clearTimeout(id);
      },
      Date, Math, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, console
    };
    vm.runInNewContext(`${fiioChunkSlice}\n${fiioPruneSlice}\n${fiioScanSlice}`, scanSandbox);

    // Watchdog fires -> late chunk and done must be completely ignored without adding or pruning
    const pWatchdog = scanSandbox.window.scanFiioStorage({ silent: true });
    assert.equal(typeof scheduledWatchdog, 'function');
    scheduledWatchdog();
    await pWatchdog;
    scanSandbox.window.onAndroidStorageScanChunk([{ name: 'late.flac', path: '/storage/emulated/0/Music/late.flac', size: 100 }], 1, 'Storage');
    scanSandbox.window.onAndroidStorageScanDone(1, null);
    assert.deepEqual(scanSandbox.state.tracks.map(t => t.id), ['fiio_old'], 'Post-watchdog late callbacks must be ignored');

    // Non-prune guards for truncated, mediaStoreFailed, unreadableRoots
    for (const badStats of [
      { truncated: true, mediaStoreFailed: false, unreadableRoots: [] },
      { truncated: false, mediaStoreFailed: true, unreadableRoots: [] },
      { truncated: false, mediaStoreFailed: false, unreadableRoots: ['/storage/SD1'] }
    ]) {
      currentStatsJson = JSON.stringify(badStats);
      const pScan = scanSandbox.window.scanFiioStorage({ silent: true });
      scanSandbox.window.onAndroidStorageScanChunk([{ name: 'new.flac', path: '/storage/emulated/0/Music/new.flac', size: 200 }], 1, 'Storage');
      scanSandbox.window.onAndroidStorageScanDone(1, null);
      await pScan;
      assert.ok(scanSandbox.state.tracks.some(t => t.id === 'fiio_old'),
        `fiio_old must NOT be pruned when scanStats=${currentStatsJson}`);
    }

    // Clean scan -> missing fiio_old IS pruned
    currentStatsJson = JSON.stringify({ truncated: false, mediaStoreFailed: false, unreadableRoots: [] });
    const pClean = scanSandbox.window.scanFiioStorage({ silent: true });
    scanSandbox.window.onAndroidStorageScanChunk([{ name: 'new.flac', path: '/storage/emulated/0/Music/new.flac', size: 200 }], 1, 'Storage');
    scanSandbox.window.onAndroidStorageScanDone(1, null);
    await pClean;
    assert.equal(scanSandbox.state.tracks.some(t => t.id === 'fiio_old'), false, 'Clean scan must prune missing fiio_old');
    assert.ok(scanSandbox.state.tracks.some(t => t.path === '/storage/emulated/0/Music/new.flac'));
  });

  it('6. displayTrack invokes NocturneNative.updateMediaNotification strictly before updateMediaSession/updatePositionState, and Native BP start invokes preloadNext(true)', () => {
    const dispSlice = extractBetween(html, 'function displayTrack(track)', 'function syncCanvasDimensions(');
    const msSlice = extractBetween(html, 'function updateMediaSession(track)', 'let isUserScrolling = false;');
    const bpStartSlice = extractBetween(html, 'if (isSameCueNativeParent) {', 'if (wasNativeBpActive) {');

    const callSeq = [];
    const elCache = new Map();
    const getEl = (id) => {
      if (!elCache.has(id)) elCache.set(id, makeDummyEl());
      return elCache.get(id);
    };

    const sandbox = {
      library,
      $: getEl,
      MediaMetadata: function (obj) { Object.assign(this, obj); },
      URL,
      localStorage: makeStorage(),
      navigator: {
        mediaSession: {
          _meta: null,
          playbackState: 'none',
          set metadata(v) {
            this._meta = v;
            callSeq.push('mediaSession.metadata');
          },
          get metadata() { return this._meta; },
          setPositionState() { callSeq.push('mediaSession.setPositionState'); }
        }
      },
      window: {
        location: { href: 'https://nocturne.local/' },
        NocturneNative: {
          updateMediaNotification(title, artist, album, playing) {
            callSeq.push(`updateMediaNotification:${title}|${album}|${playing}`);
          },
          updateMediaSessionPosition(pos, dur, playing) {
            callSeq.push(`updateMediaSessionPosition:${pos}/${dur}/${playing}`);
          }
        }
      },
      location: { href: 'https://nocturne.local/' },
      audio: { paused: false, currentTime: 10, duration: 180, playbackRate: 1 },
      state: {
        currentId: null,
        tracks: [{ id: 't1', source: 'local', title: 'Track One', artist: 'Artist One', album: 'Album One', duration: 180, sampleRate: 96000, bitDepth: 24 }],
        albumCovers: new Map(),
        zones: [],
        roonZones: [],
        activeZoneId: 'z1',
        bitPerfectEnabled: true,
        isNativeBitPerfectPlaying: true,
        isNativeBitPerfectPaused: false,
        bitPerfectLockedFormat: null,
        isPlaybackLoading: false,
        lyricsOffset: 0,
        isFullscreen: false
      },
      failedNativeCovers: new Set(),
      dsdSourceInfo: () => null,
      sourceLabel: s => s,
      escapeHtml: s => String(s || ''),
      signalDescription: t => ({ title: t.title, artist: t.artist, album: t.album, sourceName: 'Local' }),
      quality: () => ({ label: 'Hi-Res', tone: '' }),
      renderRoomSignal: () => {},
      isFavorite: () => false,
      updateRoomRating: () => {},
      paintSeek: () => {},
      formatTime: s => String(Math.floor(s || 0)),
      formatRemainingTime: (c, d) => String(Math.floor((d || 0) - (c || 0))),
      renderQueueCurrent: () => {},
      syncAutoplayButton: () => {},
      updateSleepStatus: () => {},
      renderLyrics: () => {},
      scheduleTrackRender: () => {},
      renderRecentTracks: () => {},
      updateCurrentTrackIndicator: () => {},
      getCurrentPlaybackPositionSeconds: () => 5,
      getCurrentPlaybackDurationSeconds: () => 180,
      Date, Math, Number, String, Boolean, JSON, console
    };
    vm.runInNewContext(`${msSlice}\n${dispSlice}`, sandbox);
    sandbox.displayTrack(sandbox.state.tracks[0]);

    const notifIdx = callSeq.findIndex(x => x.startsWith('updateMediaNotification:'));
    const metaIdx = callSeq.indexOf('mediaSession.metadata');
    const posIdx = callSeq.indexOf('mediaSession.setPositionState');
    const nativePosIdx = callSeq.findIndex(x => x.startsWith('updateMediaSessionPosition:'));
    assert.ok(notifIdx >= 0 && metaIdx > notifIdx && posIdx > metaIdx && nativePosIdx > posIdx,
      `updateMediaNotification must precede updateMediaSession/updatePositionState; seq=${JSON.stringify(callSeq)}`);

    // Verify both Native BP start branches invoke preloadNext(true)
    const fastSwitchBranch = bpStartSlice.slice(0, bpStartSlice.indexOf('if (typeof window.NocturneNative.setBitPerfectStreamAuth'));
    const freshStartBranch = bpStartSlice.slice(bpStartSlice.indexOf('const bpStarted = window.NocturneNative.startBitPerfectPlayback('));
    assert.ok(fastSwitchBranch.includes('preloadNext(true)'), 'Same-parent CUE Native BP fast-switch must call preloadNext(true)');
    assert.ok(freshStartBranch.includes('preloadNext(true)'), 'Standard Native BP start must call preloadNext(true)');
  });

  it('7. Phase 1 unmatched CUE rehydrateNativeBitPerfectPlayback + tail-CUE durSec - rwCueStart fallback + updatePositionState parity', () => {
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');
    const posDurSlice = extractBetween(html, 'function getCurrentPlaybackPositionSeconds()', 'function seekCurrentPlaybackToSeconds(');
    const msSlice = extractBetween(html, 'function updateMediaSession(track)', 'let isUserScrolling = false;');

    const snapshot = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: 'cue-tail',
      sourceKey: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2FSD%2Ftail.flac',
      cueStartMs: 480000,
      cueDurationMs: 0,
      positionMs: 510000,
      durationMs: 600000,
      title: 'Tail CUE Track',
      artist: 'Composer',
      album: 'Suite'
    };

    const nativePosCalls = [];
    const ackCalls = [];
    const uiEls = {
      'resume-session-banner': makeDummyEl(),
      'bitperfect-mode-toggle': makeDummyEl(),
      'play-button': makeDummyEl(),
      'current-time': makeDummyEl(),
      'duration': makeDummyEl(),
      'room-current-time': makeDummyEl(),
      'room-duration': makeDummyEl(),
      'now-title': makeDummyEl()
    };

    const sandbox = {
      library,
      $: id => uiEls[id] || null,
      MediaMetadata: function (o) { Object.assign(this, o); },
      URL,
      navigator: { mediaSession: { playbackState: 'none', setPositionState() {} } },
      window: {
        location: { href: 'https://nocturne.local/' },
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snapshot),
          getBitPerfectPosition: () => snapshot.positionMs,
          getBitPerfectDuration: () => snapshot.durationMs,
          ackBitPerfectRehydration: () => { ackCalls.push(1); },
          updateMediaSessionPosition: (pos, dur, playing) => { nativePosCalls.push({ pos, dur, playing }); }
        }
      },
      document: { hidden: false },
      audio: { paused: true, src: '' },
      state: {
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        currentId: null,
        isSeeking: false,
        lyrics: [],
        tracks: []
      },
      syncSeek: () => {},
      paintSeek: () => {},
      updateLyricsHighlight: () => {},
      renderWaveformSeekbar: () => {},
      savePlaybackSession: () => {},
      formatTime: s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      formatRemainingTime: (c, d) => `-${Math.floor(d - c)}`,
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean, JSON, console
    };

    vm.runInNewContext(`${posDurSlice}\n${msSlice}\n${bpSlice}\nsetupBitPerfectIntegration();`, sandbox);
    const ok = sandbox.window.rehydrateNativeBitPerfectPlayback();
    assert.equal(ok, true);
    assert.equal(ackCalls.length, 0, 'Unmatched Phase 1 must NOT call ackBitPerfectRehydration');
    assert.equal(sandbox.state._bpRehydratedCueWindow.cueStartSec, 480);
    assert.equal(sandbox.state._bpRehydratedCueWindow.durationSec, 0);
    assert.equal(uiEls['current-time'].textContent, '0:30');
    assert.equal(uiEls['duration'].textContent, '2:00', 'Tail CUE with cueDurationMs=0 must fall back to durSec - rwCueStart (600 - 480 = 120s)');

    assert.ok(nativePosCalls.length >= 1);
    const lastPos = nativePosCalls[nativePosCalls.length - 1];
    assert.deepEqual(lastPos, { pos: 30000, dur: 120000, playing: true });
  });

  it('8. Phase 2 /local-media?... snapSourceKey decoding, queueTrackIds restore, one-shot ackBitPerfectRehydration() & finalizeBitPerfectEndOfQueue()', () => {
    const bpSlice = extractBetween(html, 'function setupBitPerfectIntegration()', 'window.setupBitPerfectIntegration = setupBitPerfectIntegration;');

    const snapshot = {
      active: true,
      isNativeBitPerfectPlaying: true,
      isPlaying: true,
      isPaused: false,
      currentId: '',
      sourceKey: 'https://appassets.androidplatform.net/local-media?path=%2Fstorage%2FSD%2FAlbum%2F01.flac&name=01.flac',
      cueStartMs: 60000,
      cueDurationMs: 120000,
      positionMs: 75000,
      durationMs: 360000,
      title: 'Snap Title',
      artist: 'Artist',
      album: 'Album'
    };

    const ls = makeStorage({
      'nocturne-playback-session': JSON.stringify({
        trackId: 't-match',
        currentTime: 15,
        queueTrackIds: ['t-match', 't-next-1', 't-next-2'],
        updatedAt: Date.now()
      })
    });
    const ackCalls = [];
    const notifCalls = [];
    let queueRendered = 0;
    let playButtonsSync = [];

    const sandbox = {
      library,
      localStorage: ls,
      $: () => makeDummyEl(),
      navigator: { mediaSession: { playbackState: 'playing' } },
      window: {
        NocturneNative: {
          getBitPerfectPlaybackSnapshot: () => JSON.stringify(snapshot),
          getBitPerfectPosition: () => snapshot.positionMs,
          getBitPerfectDuration: () => snapshot.durationMs,
          ackBitPerfectRehydration: () => { ackCalls.push(1); },
          updateMediaNotification: (t, a, al, p) => { notifCalls.push({ t, a, al, p }); }
        }
      },
      document: { hidden: false },
      audio: { paused: true, src: '' },
      state: {
        bitPerfectEnabled: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false,
        isPlaybackLoading: false,
        currentId: null,
        queueTrackIds: [],
        isSeeking: false,
        lyrics: [],
        tracks: [
          { id: 't-match', source: 'local', isCue: true, cueStart: 60, duration: 120, path: '/storage/SD/Album/01.flac', title: 'Matched CUE' },
          { id: 't-next-1', source: 'local', path: '/storage/SD/Album/02.flac', title: 'Next 1' },
          { id: 't-next-2', source: 'local', path: '/storage/SD/Album/03.flac', title: 'Next 2' }
        ]
      },
      displayTrack: () => {},
      playNext: () => {},
      resetBitPerfectModeBadge: () => {},
      syncPlaybackButtonsUi: p => { playButtonsSync.push(p); },
      deferRenderQueue: () => { queueRendered++; },
      updatePositionState: () => {},
      savePlaybackSession: () => {},
      syncSeek: () => {},
      paintSeek: () => {},
      updateLyricsHighlight: () => {},
      renderWaveformSeekbar: () => {},
      formatTime: s => String(Math.floor(s || 0)),
      formatRemainingTime: (c, d) => String(Math.floor((d || 0) - (c || 0))),
      setInterval: () => 1,
      clearInterval: () => {},
      Date, Math, Number, String, Boolean, JSON, console
    };
    vm.runInNewContext(`${bpSlice}\nsetupBitPerfectIntegration();`, sandbox);

    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(sandbox.state.currentId, 't-match', 'Empty currentId must resolve via decoded /local-media?path=... + cueWindow');
    assert.deepEqual(Array.from(sandbox.state.queueTrackIds), ['t-next-1', 't-next-2']);
    assert.equal(queueRendered, 1);
    assert.equal(ackCalls.length, 1);

    // Redundant Phase 3 call must NOT duplicate ackBitPerfectRehydration()
    assert.equal(sandbox.window.rehydrateNativeBitPerfectPlayback(), true);
    assert.equal(ackCalls.length, 1, 'ackBitPerfectRehydration must be one-shot per matched track');

    // End-of-queue EOS cleanup
    sandbox.window.onBitPerfectPlaybackComplete();
    assert.equal(sandbox.state.isNativeBitPerfectPlaying, false);
    assert.equal(sandbox.navigator.mediaSession.playbackState, 'paused');
    assert.ok(playButtonsSync.includes(false));
    assert.ok(notifCalls.some(n => n.p === false), 'finalizeBitPerfectEndOfQueue must update notification with isPlaying=false');
  });

  it('9. MainActivity.java updateMediaSessionMetadata, BitPerfectAudioPlayer.start(), getDisplayDurationMs & TrackWindowSnapshot contracts hold', () => {
    // updateMediaSessionMetadata checks album & preservePrepopulated
    const msMetaSlice = extractBetween(
      mainJava,
      'private void updateMediaSessionMetadata(String title, String artist, String album, boolean isPlaying, boolean preservePrepopulated)',
      'private void showMediaNotification('
    );
    assert.ok(msMetaSlice.includes('!displayAlbum.equals(mLastMediaAlbum)'), 'trackChanged must compare album');
    assert.ok(msMetaSlice.includes('if (trackChanged && !preservePrepopulated)'), 'preservePrepopulated must gate position/duration reset');

    // BitPerfectAudioPlayer volatile fields & start() epoch + UI thread dispatch + tail CUE subtraction
    const bpFieldsSlice = extractBetween(mainJava, 'private volatile int mLockedSampleRate = 0;', 'private static final class TrackWindowSnapshot');
    assert.ok(bpFieldsSlice.includes('private volatile String mCurrentTrackTitle'));
    assert.ok(bpFieldsSlice.includes('private volatile String mCurrentTrackArtist'));
    assert.ok(bpFieldsSlice.includes('private volatile String mCurrentTrackAlbum'));

    const startSlice = extractBetween(mainJava, 'public synchronized boolean start(String urlOrPath, int sampleRate, int bitDepth)', 'public void pause()');
    assert.ok(startSlice.includes('final int playbackEpoch = mPlaybackEpoch.incrementAndGet();'));
    assert.ok(startSlice.includes('winCueStartMs > 0L ? (knownBaseDurMs > winCueStartMs ? knownBaseDurMs - winCueStartMs : 0L) : knownBaseDurMs'));
    assert.ok(
      startSlice.includes('runOnUiThread(() -> {') &&
      startSlice.includes('mPlaybackEpoch.get() == playbackEpoch && !mIsStopped') &&
      startSlice.includes('updateMediaNotificationInternal(initNotifTitle, initNotifArtist, initNotifAlbum, true, true);')
    );

    // getDisplayDurationMs tail-CUE subtraction
    const dispDurSlice = extractBetween(mainJava, 'private long getDisplayDurationMs(long rawDurMs, TrackWindowSnapshot win)', 'private static int pcmBytesPerFrame(');
    assert.ok(dispDurSlice.includes('if (winDur > 0L) return winDur;'));
    assert.ok(dispDurSlice.includes('if (winStart > 0L)') && dispDurSlice.includes('rawDurMs > winStart ? (rawDurMs - winStart) : 0L'));

    // TrackWindowSnapshot + setTrackWindowMeta lock, dispPos clamp, dispDur <= 0L clear, seq UI guard
    const winMetaSlice = extractBetween(mainJava, 'public void setTrackWindowMeta(', 'public void updateActiveStreamAuth(');
    assert.ok(winMetaSlice.includes('synchronized (mTrackWindowLock)'));
    assert.ok(winMetaSlice.includes('new TrackWindowSnapshot('));
    assert.ok(winMetaSlice.includes('(safeDurMs > 0L && rawPos >= safeStartMs + safeDurMs)') && winMetaSlice.includes('? 0L'));
    assert.ok(winMetaSlice.includes('if (dispDur <= 0L)') && winMetaSlice.includes('mLastMediaDurationMs = 0L;'));
    assert.ok(winMetaSlice.includes('mTrackWindow.seq == snapSeq'));
  });

  it('10. MainActivity.java scheduleNaturalEosUiSync, sticky mPendingRenderProcessRehydration, ackBitPerfectRehydration & storage scan telemetry contracts hold', () => {
    // scheduleNaturalEosUiSync + preEosNotifSeq + onDestroy cleanup
    assert.ok(mainJava.includes('preEosNotifSeq = mMediaNotificationSeq.get();'));
    const eosSyncSlice = extractBetween(mainJava, 'private void scheduleNaturalEosUiSync(', 'public void updateBitPerfectStreamAuth(');
    assert.ok(eosSyncSlice.includes('mMainHandler.postDelayed(() -> {'));
    assert.ok(eosSyncSlice.includes('!mPendingRenderProcessRehydration'));
    assert.ok(eosSyncSlice.includes('mMediaNotificationSeq.get() == preEosNotifSeq'));
    assert.ok(eosSyncSlice.includes('}, 250L);'));
    const destroySlice = extractBetween(mainJava, 'protected void onDestroy()', 'protected void onNewIntent(');
    assert.ok(destroySlice.includes('mMainHandler.removeCallbacksAndMessages(null);'));

    // Sticky mPendingRenderProcessRehydration + ackBitPerfectRehydration + handleBitPerfectSawOutputEos
    const getSnapSlice = extractBetween(mainJava, 'public String getBitPerfectPlaybackSnapshot()', 'public void ackBitPerfectRehydration()');
    assert.equal(getSnapSlice.includes('mPendingRenderProcessRehydration = false'), false,
      'getBitPerfectPlaybackSnapshot() must NOT clear mPendingRenderProcessRehydration');
    const ackSlice = extractBetween(mainJava, 'public void ackBitPerfectRehydration()', 'private void handleBitPerfectSawOutputEos(');
    assert.ok(ackSlice.includes('mPendingRenderProcessRehydration = false;'));
    assert.ok(ackSlice.includes('dispatchPendingBitPerfectEosIfReady();'));
    const eosHandleSlice = extractBetween(mainJava, 'private void handleBitPerfectSawOutputEos(', 'private void postBitPerfectPlaybackCompleteToWeb(');
    assert.ok(eosHandleSlice.includes('mPendingRenderProcessRehydration || !mRenderCrashPageFinished'));
    assert.ok(eosHandleSlice.includes('mPendingBitPerfectEosEpoch = epoch;'));

    // Storage scan telemetry, /storage/emulated fix, and .m3u/.m3u8 in scanDirInternal
    assert.ok(mainJava.includes('@JavascriptInterface\n        public String getLastStorageScanStatsJson()'));
    assert.ok(mainJava.includes('@JavascriptInterface\n        public boolean isAsyncStorageScanRunning()'));
    const storagePathsSlice = extractBetween(mainJava, 'public String getStoragePaths()', 'public String getPersistedSafUrisJson()');
    assert.ok(storagePathsSlice.includes('"emulated".equals(s.getName())') && storagePathsSlice.includes('new File(s, "0")') && storagePathsSlice.includes('u0.canRead()'));
    const asyncScanSlice = extractBetween(mainJava, 'public boolean startAsyncStorageScan(final int maxFiles)', 'private void emitStorageScanChunk(');
    assert.ok(asyncScanSlice.includes('rawRoots.remove("/storage/emulated");'));
    assert.ok(asyncScanSlice.includes('parentFile.exists() && parentFile.canRead()'));
    assert.ok(asyncScanSlice.includes('mediaStoreFailed') && asyncScanSlice.includes('hitLimit') && asyncScanSlice.includes('unreadableRoots'));
    assert.ok(asyncScanSlice.indexOf('mLastStorageScanStatsJson = buildStorageScanStatsJson(') < asyncScanSlice.indexOf('emitStorageScanDone(scanId, totalEmitted, errorMsg);'));
    const scanDirSlice = extractBetween(mainJava, 'private void scanDirInternal(\n                File current,', 'public String httpFetch(');
    assert.ok(scanDirSlice.includes('".m3u"') && scanDirSlice.includes('".m3u8"'));
  });
});
