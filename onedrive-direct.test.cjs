'use strict';

// Pha C — OneDrive dùng thẳng downloadUrl thay vì tải qua Graph /content:
// link tải tạm thời đã xác thực sẵn nên tải nhạc thẳng từ SharePoint,
// không gửi Authorization header (tránh preflight CORS, khỏi đưa token
// sang host lưu trữ); link hết hạn thì rớt về đường /content + Bearer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const DIRECT_URL = 'https://tenant.sharepoint.com/personal/user/_layouts/15/download.aspx?e=abc123';
const GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/drive/items/item-1/content';
const GRAPH_ITEM_URL = 'https://graph.microsoft.com/v1.0/me/drive/items/item-1';

function extractFunction(startMarker, endMarker, returnName) {
  const start = appCode.indexOf(startMarker);
  assert.ok(start >= 0, `${returnName} should exist for regression checks`);
  const end = appCode.indexOf(endMarker, start);
  assert.ok(end > start, `${returnName} should be extractable for regression checks`);
  return appCode.slice(start, end);
}

const resolveSource = extractFunction(
  'async function resolveMicrosoftDownloadUrl(track) {',
  'async function loadMicrosoftAudio(itemId) {',
  'resolveMicrosoftDownloadUrl');
const resolveFactory = new Function('state', 'MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS', 'getMicrosoftToken', 'graphGet',
  `${resolveSource}\nreturn resolveMicrosoftDownloadUrl;`);
const RESOLVE_MAX_AGE_MS = 30 * 60 * 1000;

const loadSource = extractFunction(
  'async function loadMicrosoftAudio(itemId) {',
  'function settingsError(error) {',
  'loadMicrosoftAudio');
const loadFactory = new Function('state', 'resolveMicrosoftDownloadUrl', 'getMicrosoftToken',
  'fetchCloudTrack', 'fetchCloudFile', 'isDsdFormat',
  `${loadSource}\nreturn loadMicrosoftAudio;`);

function expiredError() {
  return Object.assign(new Error('OneDrive tải âm thanh thất bại (HTTP 403)'), {status: 403});
}

(async () => {
  // Link còn mới trong phiên: dùng lại, không gọi Graph thêm lần nữa.
  {
    let graphCalls = 0;
    const state = {microsoftAccessToken: 'tok-ms'};
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => { throw new Error('token must not be fetched'); },
      async () => { graphCalls++; return {}; });
    const track = {remoteId: 'item-1', downloadUrl: DIRECT_URL, downloadUrlAt: Date.now()};
    assert.equal(await resolve(track), DIRECT_URL, 'Fresh stored download URL should be reused');
    assert.equal(graphCalls, 0, 'Fresh stored download URL should not trigger a Graph lookup');
  }

  // Link đã lưu quá 30 phút: lấy mới qua Graph, ghi lại kèm thời điểm.
  {
    const graphCalls = [];
    const state = {microsoftAccessToken: 'tok-ms'};
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh',
      async url => { graphCalls.push(url); return {'@microsoft.graph.downloadUrl': DIRECT_URL}; });
    const track = {remoteId: 'item-1', downloadUrl: 'https://old.example/dl', downloadUrlAt: Date.now() - 31 * 60 * 1000};
    assert.equal(await resolve(track), DIRECT_URL, 'Stale stored download URL should be refreshed');
    assert.deepEqual(graphCalls, [GRAPH_ITEM_URL], 'Refresh should query the Graph item for a new download URL');
    assert.equal(track.downloadUrl, DIRECT_URL, 'Refresh should store the new download URL on the track');
    assert.ok(Date.now() - track.downloadUrlAt < 5000, 'Refresh should record when the download URL was issued');
  }

  // Chưa có link: lấy qua Graph bằng token sẵn có, không cần token mới.
  {
    let tokenCalls = 0;
    const state = {microsoftAccessToken: 'tok-ms'};
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => { tokenCalls++; return 'tok-fresh'; },
      async (url, token) => {
        assert.equal(url, GRAPH_ITEM_URL, 'Download URL lookup should query the Graph item');
        assert.equal(token, 'tok-ms', 'Download URL lookup should use the cached Microsoft token');
        return {'@microsoft.graph.downloadUrl': DIRECT_URL};
      });
    const track = {remoteId: 'item-1', downloadUrl: ''};
    assert.equal(await resolve(track), DIRECT_URL, 'Missing download URL should be resolved through Graph');
    assert.equal(tokenCalls, 0, 'Cached token should be enough for the download URL lookup');
    assert.equal(track.downloadUrl, DIRECT_URL, 'Resolved download URL should be stored on the track');
  }

  // Graph không trả link: trả rỗng để đường gọi rớt về /content.
  {
    const state = {microsoftAccessToken: 'tok-ms'};
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh',
      async () => ({id: 'item-1', name: 'song.flac'}));
    const track = {remoteId: 'item-1', downloadUrl: ''};
    assert.equal(await resolve(track), '', 'Missing download URL in the Graph item should resolve to empty');
    assert.equal(track.downloadUrl, '', 'Empty resolution should not store a download URL');
  }

  // Bấm phát FLAC: tải thẳng từ downloadUrl, không gửi Authorization.
  {
    let tokenCalls = 0;
    const state = {microsoftAccessToken: 'tok-ms', tracks: [{remoteId: 'item-1', source: 'onedrive', format: 'flac', downloadUrl: ''}]};
    const track = state.tracks[0];
    const calls = [];
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => { tokenCalls++; return 'tok-fresh'; },
      async () => ({'@microsoft.graph.downloadUrl': DIRECT_URL}));
    const load = loadFactory(state, resolve, async () => { tokenCalls++; return 'tok-fresh'; },
      async (t, url, options) => { calls.push({kind: 'track', url, options}); return 'blob:slice'; },
      async () => { throw new Error('DSD path must not run for FLAC'); },
      format => ['DSF', 'DFF'].includes(String(format || '').toUpperCase()));
    await load('item-1');
    assert.equal(calls.length, 1, 'Direct OneDrive playback should fetch the track once');
    assert.equal(calls[0].url, DIRECT_URL, 'Direct OneDrive playback should use the download URL');
    assert.deepEqual(calls[0].options, {}, 'Direct OneDrive playback must not send an Authorization header');
    assert.equal(tokenCalls, 0, 'Direct OneDrive playback should not fetch a fresh token when one is cached');
    assert.equal(track.downloadUrl, DIRECT_URL, 'Direct playback should keep the fresh download URL on the track');
  }

  // Link hết hạn giữa chừng (403): xóa link cũ, rớt về /content + Bearer.
  {
    const state = {microsoftAccessToken: 'tok-ms', tracks: [{remoteId: 'item-1', source: 'onedrive', format: 'flac', downloadUrl: DIRECT_URL, downloadUrlAt: Date.now()}]};
    const track = state.tracks[0];
    const calls = [];
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh',
      async () => ({'@microsoft.graph.downloadUrl': DIRECT_URL}));
    const load = loadFactory(state, resolve, async () => 'tok-fresh',
      async (t, url, options) => {
        calls.push({kind: 'track', url, options});
        if (url === DIRECT_URL) throw expiredError();
        return 'blob:full';
      },
      async () => { throw new Error('DSD path must not run for FLAC'); },
      format => ['DSF', 'DFF'].includes(String(format || '').toUpperCase()));
    await load('item-1');
    assert.equal(calls.length, 2, 'Expired direct URL should retry once through Graph');
    assert.equal(calls[0].url, DIRECT_URL, 'First attempt should use the direct download URL');
    assert.deepEqual(calls[0].options, {}, 'First attempt must not send an Authorization header');
    assert.equal(calls[1].url, GRAPH_URL, 'Fallback should use the Graph /content URL');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer tok-fresh', 'Fallback should send a fresh Bearer token');
    assert.equal(track.downloadUrl, '', 'Expired download URL should be cleared so the next tap resolves fresh');
  }

  // Graph không trả link: đi thẳng đường /content, chỉ gọi một lần.
  {
    const state = {microsoftAccessToken: 'tok-ms', tracks: [{remoteId: 'item-1', source: 'onedrive', format: 'flac', downloadUrl: ''}]};
    const calls = [];
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh', async () => ({}));
    const load = loadFactory(state, resolve, async () => 'tok-fresh',
      async (t, url, options) => { calls.push({url, options}); return 'blob:full'; },
      async () => { throw new Error('DSD path must not run for FLAC'); },
      format => ['DSF', 'DFF'].includes(String(format || '').toUpperCase()));
    await load('item-1');
    assert.equal(calls.length, 1, 'Missing download URL should fetch the track once through Graph');
    assert.equal(calls[0].url, GRAPH_URL, 'Missing download URL should fall back to Graph /content');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tok-fresh', 'Graph fallback should send a Bearer token');
  }

  // Bài DSD: cũng tải thẳng từ downloadUrl, không gửi Authorization.
  {
    const state = {microsoftAccessToken: 'tok-ms', tracks: [{remoteId: 'item-1', source: 'onedrive', format: 'dsf', downloadUrl: '', file: null}]};
    const track = state.tracks[0];
    const calls = [];
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh',
      async () => ({'@microsoft.graph.downloadUrl': DIRECT_URL}));
    const load = loadFactory(state, resolve, async () => 'tok-fresh',
      async () => { throw new Error('Non-DSD path must not run for DSF'); },
      async (t, url, options) => { calls.push({url, options}); t.file = {name: 'song.dsf'}; },
      format => ['DSF', 'DFF'].includes(String(format || '').toUpperCase()));
    assert.deepEqual(await load('item-1'), {name: 'song.dsf'}, 'Direct DSD playback should return the decoded file');
    assert.equal(calls.length, 1, 'Direct DSD playback should fetch the file once');
    assert.equal(calls[0].url, DIRECT_URL, 'Direct DSD playback should use the download URL');
    assert.deepEqual(calls[0].options, {}, 'Direct DSD playback must not send an Authorization header');
  }

  // Bài không có trong thư viện: báo lỗi, không gọi Graph hay tải nhạc.
  {
    const state = {microsoftAccessToken: 'tok-ms', tracks: []};
    let graphCalls = 0;
    const resolve = resolveFactory(state, RESOLVE_MAX_AGE_MS, async () => 'tok-fresh',
      async () => { graphCalls++; return {}; });
    const load = loadFactory(state, resolve, async () => 'tok-fresh',
      async () => { throw new Error('fetch must not run without a track'); },
      async () => { throw new Error('fetch must not run without a track'); },
      () => false);
    await assert.rejects(load('item-1'), /Không tìm thấy bài hát trong thư viện/, 'Unknown track should fail before any download');
    assert.equal(graphCalls, 0, 'Unknown track should not trigger a download URL lookup');
  }

  // Chặn thử lại bằng token khi URL là downloadUrl: 401/403 ở link tạm
  // nghĩa là link hết hạn, gửi Bearer sang host lưu trữ không có tác
  // dụng — phải để đường gọi trên rớt về /content thay vì thử lại.
  for (const [startMarker, endMarker, label] of [
    ['async function upgradeSliceToFullAudio(track, sliceUrl, url, options, provider) {', 'async function fetchCloudTrack(track, url, options, provider) {', 'upgradeSliceToFullAudio'],
    ['async function fetchCloudTrack(track, url, options, provider) {', 'const mediaErrorMessage = error => {', 'fetchCloudTrack'],
    ['async function fetchCloudFile(track, url, options, provider) {', 'async function loadGoogleAudio(fileId) {', 'fetchCloudFile'],
  ]) {
    const source = extractFunction(startMarker, endMarker, label);
    assert.ok(source.includes('isGraphContentUrl(url)'), `${label} should only retry with a Bearer token for Graph /content URLs`);
  }
  assert.ok(appCode.includes('const isGraphContentUrl = url =>'), 'Graph URL check helper should exist');
  assert.ok(loadSource.includes("await fetchCloudTrack(track, directUrl, {}, 'OneDrive')"), 'Non-DSD OneDrive playback should try the direct download URL first');
  assert.ok(loadSource.includes("await fetchCloudFile(track, directUrl, {}, 'OneDrive')"), 'DSD OneDrive playback should try the direct download URL first');
  assert.ok(loadSource.includes("track.downloadUrl = '';"), 'Expired direct URL should be cleared before the Graph fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
