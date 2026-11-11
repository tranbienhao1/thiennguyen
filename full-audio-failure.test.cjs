'use strict';

// Pha C — lỗi FLAC cloud nhảy bài: tải nền file đầy đủ thất bại TRƯỚC
// khi lát đầu hết thì fullAudioPromise đã null mà fullAudioUrl chưa từng
// được set, nên cả 2 guard 'ended'/'error' đều trượt và bài nhảy sang
// bài kế im lặng. Bản sửa ghi lại lỗi vào track.fullAudioError để guard
// toast rõ lý do rồi mới chuyển bài.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

function extractFunction(code, name) {
  let start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should be defined in the app script`);
  if (code.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const brace = code.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

// Nối dây tĩnh: lỗi tải nền phải được ghi lại và guard phải dùng nó.
assert.ok(appCode.includes('track.fullAudioError = error'), 'A failed background download should record the error on the track');
assert.ok(appCode.includes('track.fullAudioError = null'), 'The recorded background error should be cleared when a new download starts');
assert.ok(appCode.includes('function skipAfterFullAudioFailure(track)'), 'The ended/error guards should share one failure handler');
const endedStart = appCode.indexOf("element.addEventListener('ended'");
const errorStart = appCode.indexOf("element.addEventListener('error'");
assert.ok(endedStart >= 0 && errorStart > endedStart, 'Both deck guards should be present');
const endedGuard = appCode.slice(endedStart, errorStart);
const errorGuard = appCode.slice(errorStart, appCode.indexOf('attachDeckEvents(audio)', errorStart));
for (const [label, guard] of [['ended', endedGuard], ['error', errorGuard]]) {
  assert.ok(guard.includes('track.fullAudioError'), `The '${label}' guard should check the recorded background error`);
  assert.ok(guard.includes('skipAfterFullAudioFailure(track)'), `The '${label}' guard should use the shared failure handler`);
  assert.ok(guard.indexOf('track.fullAudioError') < guard.indexOf('if (track && track.firstSlicePlayback && track.fullAudioPromise) {'), `The '${label}' guard should check the recorded error before the still-running download`);
}

// Pha C — lát đầu hết trong khi tải nền còn đang chạy, tải nền sau đó
// mới thất bại: callback .catch() phải dùng chung skipAfterFullAudioFailure
// để toast đúng lý do đã ghi (vd phiên Drive hết hạn) thay vì toast
// chung chung không nêu lý do như trước; vẫn giữ guard sliceEndedEarly
// + currentId để không chuyển bài hai lần hay chuyển nhầm bài mới.
for (const [label, guard] of [['ended', endedGuard], ['error', errorGuard]]) {
  const catchStart = guard.indexOf('track.fullAudioPromise.catch(');
  assert.ok(catchStart >= 0, `The '${label}' guard should wait on the still-running background download`);
  const catchBlock = guard.slice(catchStart, guard.indexOf('});', catchStart));
  assert.ok(catchBlock.includes('skipAfterFullAudioFailure(track)'), `The '${label}' guard should route a late background failure through the shared failure handler so the toast carries the recorded reason`);
  assert.ok(catchBlock.includes("if (!track.sliceEndedEarly || track.id !== state.currentId) return;"), `The '${label}' guard should only skip for the track that is still current`);
  assert.ok(!catchBlock.includes(', chuyển sang bài tiếp theo.'), `The '${label}' guard should no longer toast a reason-less skip message for a late background failure`);
}

function makeUpgradeContext(fetchAudioBlob) {
  const state = {objectUrls: new Set(), currentId: 'other-track'};
  const audio = {src: '', currentTime: 0, paused: true, addEventListener() {}};
  const standbyAudio = {src: ''};
  let released = null, finishedMetadata = 0;
  const context = {
    console,
    setTimeout,
    URL,
    Blob,
    location: {href: 'https://example.test/thiennguyen/'},
    state,
    audio,
    standbyAudio,
    library: {
      fetchAudioBlob,
      normalizeAudioBlob: blob => blob,
    },
    getMicrosoftToken: async () => { throw new Error('No Microsoft token in test'); },
    isGraphContentUrl: url => typeof url === 'string' && url.startsWith('https://graph.microsoft.com/'),
    finishCloudMetadataInBackground: () => { finishedMetadata++; },
    releaseTrackUrl: url => { released = url; },
  };
  context.__released = () => released;
  context.__finishedMetadata = () => finishedMetadata;
  vm.createContext(context);
  vm.runInContext(extractFunction(appCode, 'upgradeSliceToFullAudio'), context, {filename: 'upgrade-slice.js'});
  return context;
}

(async () => {
  // Lỗi mạng 500 khi tải nền: promise reject, lỗi được ghi lại, cờ
  // promise về null để guard 'ended'/'error' nhận ra tải nền đã hỏng.
  {
    const networkError = new Error('Lỗi mạng khi tải âm thanh.');
    networkError.status = 500;
    const ctx = makeUpgradeContext(async () => { throw networkError; });
    const track = {id: 'track-1', source: 'google', name: 'test.flac', title: 'Test FLAC', format: 'FLAC', url: 'https://drive.example/file'};
    await assert.rejects(ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google'));
    assert.equal(track.fullAudioError, networkError, 'A failed background download should keep the exact error for the guard');
    assert.equal(track.fullAudioPromise, null, 'The background promise should clear after failing so the guard can tell it is done');
    assert.equal(track.fullAudioUrl, undefined, 'A failed download should never publish a full-audio URL');
  }

  // Google 401: lỗi ghi lại phải là thông báo phiên hết hạn để guard
  // toast đúng hướng xử lý (kết nối lại) thay vì lỗi mạng chung chung.
  {
    const authError = new Error('Unauthorized');
    authError.status = 401;
    const ctx = makeUpgradeContext(async () => { throw authError; });
    const track = {id: 'track-2', source: 'google', name: 'test.flac', title: 'Test FLAC', format: 'FLAC'};
    await assert.rejects(ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google'));
    assert.match(track.fullAudioError.message, /Phiên Google Drive đã hết hạn/, 'A Google 401 should record the session-expired message');
  }

  // Tải nền thành công: lỗi cũ của lần phát trước bị xóa, URL đầy đủ
  // được giữ lại như trước.
  {
    const ctx = makeUpgradeContext(async () => new Blob(['full-audio-bytes'], {type: 'audio/flac'}));
    const track = {id: 'track-3', source: 'google', name: 'test.flac', title: 'Test FLAC', format: 'FLAC', fullAudioError: new Error('lỗi cũ'), url: 'https://drive.example/file'};
    const fullUrl = await ctx.upgradeSliceToFullAudio(track, 'blob:slice', 'https://drive.example/file', {}, 'google');
    assert.equal(track.fullAudioError, null, 'A successful background download should clear any stale recorded error');
    assert.equal(track.fullAudioUrl, fullUrl, 'A successful download should still publish the full-audio URL');
    assert.equal(ctx.__finishedMetadata(), 1, 'A successful download should still finish the cloud metadata in the background');
  }

  // Handler dùng chung: toast rõ lý do + tên bài, chuyển bài đúng 1 lần,
  // xóa cờ để lần phát sau không dùng nhầm lỗi cũ.
  {
    const toasts = [];
    const playedNext = [];
    const state = {errorSkipCount: 0, tracks: [{id: 'a'}, {id: 'b'}, {id: 'c'}]};
    const context = {
      console,
      state,
      toast: message => { toasts.push(message); },
      playNext: (step, auto) => { playedNext.push([step, auto]); },
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(appCode, 'skipAfterFullAudioFailure'), context, {filename: 'skip-after-failure.js'});
    const track = {id: 'a', title: 'Bài FLAC lỗi', firstSlicePlayback: true, sliceEndedEarly: true, fullAudioError: new Error('Phiên Google Drive đã hết hạn hoặc bị từ chối.')};
    context.skipAfterFullAudioFailure(track);
    assert.equal(toasts.length, 1, 'A recorded background failure should toast exactly once');
    assert.match(toasts[0], /Bài FLAC lỗi/, 'The toast should name the failed track');
    assert.match(toasts[0], /Phiên Google Drive đã hết hạn/, 'The toast should carry the recorded failure reason');
    assert.deepEqual(playedNext, [[1, false]], 'The failure handler should advance to the next track');
    assert.equal(track.fullAudioError, null, 'The handler should clear the recorded error after using it');
    assert.equal(track.firstSlicePlayback, false, 'The handler should leave first-slice playback mode');
    assert.equal(state.errorSkipCount, 1, 'The failure should count toward the error-skip guard');
  }

  // Hết giới hạn lỗi: dừng phát thay vì nhảy qua toàn bộ danh sách.
  {
    const toasts = [];
    const playedNext = [];
    const state = {errorSkipCount: 3, tracks: [{id: 'a'}, {id: 'b'}, {id: 'c'}]};
    const context = {
      console,
      state,
      toast: message => { toasts.push(message); },
      playNext: (step, auto) => { playedNext.push([step, auto]); },
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(appCode, 'skipAfterFullAudioFailure'), context, {filename: 'skip-after-failure.js'});
    context.skipAfterFullAudioFailure({id: 'a', title: 'Bài lỗi', firstSlicePlayback: true, fullAudioError: new Error('lỗi mạng')});
    assert.equal(playedNext.length, 0, 'Repeated background failures should stop instead of skipping through the whole list');
    assert.match(toasts[0], /đã dừng phát/, 'Stopping after repeated failures should toast that playback stopped');
    assert.equal(state.errorSkipCount, 0, 'The error-skip counter should reset when playback stops');
  }

  // Dữ liệu biên: lỗi không có message thì toast vẫn có lý do mặc định.
  {
    const toasts = [];
    const context = {
      console,
      state: {errorSkipCount: 0, tracks: [{id: 'a'}]},
      toast: message => { toasts.push(message); },
      playNext: () => {},
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(appCode, 'skipAfterFullAudioFailure'), context, {filename: 'skip-after-failure.js'});
    context.skipAfterFullAudioFailure({id: 'a', name: 'no-message.flac', firstSlicePlayback: true, fullAudioError: {}});
    assert.match(toasts[0], /lỗi mạng/, 'An error without a message should fall back to a generic network reason');
  }
})();
