'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8');
const mainJava = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'),
  'utf8'
);
const releaseScript = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'), 'utf8');
const library = require(path.join(ROOT, 'library-utils.js'));

function extractBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

function semverGeq(a, b) {
  const ta = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const tb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const da = ta[i] || 0;
    const db = tb[i] || 0;
    if (da !== db) return da > db;
  }
  return true;
}

describe('v3.9.103 R3 — Cloud OAuth Refresh Mid-Bit-Perfect, Cross-Deck Seek Parity & Monotonic Version Hygiene', () => {
  it('1. Cloud OAuth token refresh mid-Bit-Perfect (onNativeBitPerfectAuthRefresh) rebuilds Google Drive URL, invalidates _bpPreloadedStream & handles OneDrive + failures', async () => {
    const urlBuildersSlice = extractBetween(html, 'function buildGoogleDriveMediaUrl(fileId) {', 'async function resolveCloudBitPerfectStream(');
    const authRefreshSlice = extractBetween(html, 'window.onNativeBitPerfectAuthRefresh = async (epoch, source, remoteId, failedUrl, status) => {', 'window.onNativeBitPerfectReconnectStatus =');

    const replies = [];
    const gTrack = {
      id: 'google:g_stream_1',
      remoteId: 'g_stream_1',
      source: 'google',
      url: 'https://lh3.googleusercontent.com/expired-redirect-url'
    };
    const msTrack = {
      id: 'onedrive:ms_stream_1',
      remoteId: 'ms_stream_1',
      remoteDriveId: 'drv-99',
      source: 'onedrive',
      url: 'https://my.sharepoint.com/expired-dl',
      downloadUrl: 'https://my.sharepoint.com/expired-dl',
      downloadUrlAt: Date.now()
    };

    let msFreshUrl = 'https://my.sharepoint.com/fresh-dl-url';
    let googleTokenToReturn = 'ya29.fresh-google-tok';
    const sandbox = {
      encodeURIComponent, Promise, Error, JSON, String, Number, Boolean, Array, setTimeout, clearTimeout,
      state: {
        currentId: gTrack.id,
        tracks: [gTrack, msTrack],
        googleToken: 'ya29.old',
        microsoftAccessToken: 'ms.old',
        msAccount: { homeAccountId: 'acct-1' },
        _bpPreloadedStream: { source: 'google', url: 'https://old-preload' }
      },
      window: {
        NocturneNative: {
          provideBitPerfectRefreshedAuth: (epoch, url, hdrsJson, ok) => {
            replies.push({ epoch, url, headers: JSON.parse(hdrsJson), ok });
          }
        }
      },
      ensureGoogleToken: async force => {
        assert.equal(force, true, 'Google refresh must call ensureGoogleToken(true)');
        return googleTokenToReturn;
      },
      resolveMicrosoftDownloadUrl: async () => msFreshUrl,
      getMicrosoftToken: async () => 'ms.fresh-bearer-tok'
    };
    vm.runInNewContext(`${urlBuildersSlice}\n${authRefreshSlice}`, sandbox);

    // 1. Google Drive expired redirect URL -> MUST rebuild buildGoogleDriveMediaUrl(rId) instead of reusing failedUrl, and MUST clear matching _bpPreloadedStream!
    await sandbox.window.onNativeBitPerfectAuthRefresh(7, 'google', 'g_stream_1', 'https://doc-0k-12.googleusercontent.com/expired?e=1', 401);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].epoch, 7);
    assert.equal(replies[0].ok, true);
    assert.equal(replies[0].url, 'https://www.googleapis.com/drive/v3/files/g_stream_1?alt=media&supportsAllDrives=true');
    assert.deepEqual(replies[0].headers, { Authorization: 'Bearer ya29.fresh-google-tok' });
    assert.equal(gTrack.url, replies[0].url);
    assert.equal(sandbox.state._bpPreloadedStream, null, 'Must invalidate matching _bpPreloadedStream on auth refresh');

    // 2. OneDrive direct download refresh -> invalidates downloadUrl cache & _bpPreloadedStream
    sandbox.state.currentId = msTrack.id;
    sandbox.state._bpPreloadedStream = { source: 'onedrive', url: 'https://old-ms-preload' };
    await sandbox.window.onNativeBitPerfectAuthRefresh(8, 'onedrive', 'ms_stream_1', 'https://my.sharepoint.com/expired-dl', 401);
    assert.equal(replies.length, 2);
    assert.equal(replies[1].ok, true);
    assert.equal(replies[1].url, 'https://my.sharepoint.com/fresh-dl-url');
    assert.equal(sandbox.state._bpPreloadedStream, null);

    // 3. OneDrive Graph /content fallback when failedUrl is already Graph /content
    msFreshUrl = '';
    await sandbox.window.onNativeBitPerfectAuthRefresh(9, 'onedrive', 'ms_stream_1', 'https://graph.microsoft.com/v1.0/drives/drv-99/items/ms_stream_1/content', 401);
    assert.equal(replies.length, 3);
    assert.equal(replies[2].ok, true);
    assert.equal(replies[2].url, 'https://graph.microsoft.com/v1.0/drives/drv-99/items/ms_stream_1/content');
    assert.deepEqual(replies[2].headers, { Authorization: 'Bearer ms.fresh-bearer-tok' });

    // 4. Empty token -> replies ok=false cleanly
    sandbox.state.currentId = gTrack.id;
    googleTokenToReturn = '';
    await sandbox.window.onNativeBitPerfectAuthRefresh(10, 'google', 'g_stream_1', 'https://expired', 401);
    assert.equal(replies.length, 4);
    assert.equal(replies[3].ok, false);
  });

  it('2. Cross-deck seek bar parity across #seek, #seek-mobile, #room-seek & all desktop/mobile/room/fullscreen time displays (Deck A/B + CUE)', () => {
    const seekJumpSlice = extractBetween(html, 'function syncSeekUiAfterJump(relSec, durSec) {', 'function setupBitPerfectIntegration() {');
    const getPosDurSlice = extractBetween(html, 'function getCurrentPlaybackPositionSeconds() {', 'function seekCurrentPlaybackToSeconds(');
    const seekUiSlice = extractBetween(html, 'const syncSeek = value => {', "[$('volume'), $('volume-mobile')]");
    const roomSeekSlice = extractBetween(html, "$('room-seek').addEventListener('input', event => {", "function attachWaveformTouchScrub(");

    const els = {};
    const mkEl = id => (els[id] = {
      id,
      value: '0',
      textContent: '',
      style: {},
      listeners: {},
      matches: () => false,
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    });
    ['seek', 'seek-mobile', 'room-seek',
     'current-time', 'current-time-mobile', 'room-current-time', 'fullscreen-time-cur',
     'duration', 'duration-mobile', 'room-duration', 'fullscreen-time-dur',
     'room-remaining'].forEach(mkEl);

    let waveformRenders = 0;
    let posUpdates = 0;
    const deckA = { currentTime: 0, duration: 200, readyState: 4, buffered: { length: 0 } };
    const deckB = { currentTime: 0, duration: 180, readyState: 4, buffered: { length: 0 } };
    const sandbox = {
      library,
      Date, Math, Number, String, Boolean,
      window: { addEventListener: () => {} },
      $: id => els[id] || null,
      formatTime: s => {
        const sec = Math.max(0, Math.floor(Number(s) || 0));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      },
      formatRemainingTime: (c, d) => `-${Math.floor(Math.max(0, d - c))}`,
      paintSeek: () => {},
      renderWaveformSeekbar: () => { waveformRenders++; },
      updatePositionState: () => { posUpdates++; },
      toast: () => {},
      audio: deckA,
      standbyAudio: deckB,
      state: {
        currentId: 'tA',
        tracks: [
          { id: 'tA', title: 'Deck A Song', duration: 200 },
          { id: 'tB', title: 'Deck B Song', duration: 180 },
          { id: 'tCue', title: 'Cue II', isCue: true, cueStart: 60, cueEnd: 120, duration: 60 }
        ],
        activeDeck: { element: deckA },
        isSeeking: false,
        isNativeBitPerfectPlaying: false,
        isNativeBitPerfectPaused: false
      }
    };
    vm.runInNewContext(`${seekJumpSlice}\n${getPosDurSlice}\n${roomSeekSlice}\n${seekUiSlice}\nthis.syncSeek = syncSeek;`, sandbox);

    // 1. Desktop #seek scrub on Deck A (500 -> 100s / 3:20)
    els['seek'].value = '500';
    els['seek'].listeners.input.forEach(fn => fn());
    assert.equal(els['seek-mobile'].value, '500');
    assert.equal(els['room-seek'].value, '500');
    assert.equal(els['current-time'].textContent, '1:40');
    assert.equal(els['current-time-mobile'].textContent, '1:40');
    assert.equal(els['room-current-time'].textContent, '1:40');
    assert.equal(els['fullscreen-time-cur'].textContent, '1:40');
    els['seek'].listeners.change.forEach(fn => fn());
    assert.equal(deckA.currentTime, 100);
    assert.equal(els['duration'].textContent, '3:20');
    assert.equal(els['duration-mobile'].textContent, '3:20');
    assert.equal(els['room-duration'].textContent, '3:20');
    assert.equal(els['fullscreen-time-dur'].textContent, '3:20');

    // 2. Switch activeDeck to Deck B & scrub #room-seek (250 -> 45s / 3:00)
    sandbox.state.currentId = 'tB';
    sandbox.state.activeDeck = { element: deckB };
    els['room-seek'].value = '250';
    els['room-seek'].listeners.input.forEach(fn => fn({ currentTarget: els['room-seek'] }));
    assert.equal(els['seek'].value, '250');
    assert.equal(els['seek-mobile'].value, '250');
    assert.equal(els['current-time'].textContent, '0:45');
    assert.equal(els['room-current-time'].textContent, '0:45');
    els['room-seek'].listeners.change.forEach(fn => fn({ currentTarget: els['room-seek'] }));
    assert.equal(deckB.currentTime, 45);
    assert.equal(els['duration'].textContent, '3:00');
    assert.equal(els['room-duration'].textContent, '3:00');
    assert.equal(els['fullscreen-time-dur'].textContent, '3:00');

    // 3. CUE subtrack (cueStart = 60, duration = 60) via #seek-mobile (500 -> 90s absolute, 0:30 / 1:00 relative)
    sandbox.state.currentId = 'tCue';
    els['seek-mobile'].value = '500';
    els['seek-mobile'].listeners.input.forEach(fn => fn());
    assert.equal(els['seek'].value, '500');
    assert.equal(els['room-seek'].value, '500');
    assert.equal(els['current-time'].textContent, '0:30');
    assert.equal(els['current-time-mobile'].textContent, '0:30');
    assert.equal(els['room-current-time'].textContent, '0:30');
    assert.equal(els['fullscreen-time-cur'].textContent, '0:30');
    els['seek-mobile'].listeners.change.forEach(fn => fn());
    assert.equal(deckB.currentTime, 90);
    assert.equal(els['duration'].textContent, '1:00');
    assert.equal(els['room-duration'].textContent, '1:00');
    assert.equal(els['fullscreen-time-dur'].textContent, '1:00');
    assert.ok(waveformRenders >= 3 && posUpdates >= 3);
  });

  it('3. Monotonic version & release hygiene (>= 3.9.102 / versionCode >= 156, // History: preserved, publish-release.cjs valid)', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag && mRelCode, 'All version markers must be present');
    const ver = mHtml[1];
    const code = Number(mGCode[1]);
    assert.equal(semverGeq(ver, '3.9.102'), true, `index.html version must be >= 3.9.102 (got ${ver})`);
    assert.equal(code >= 156, true, `build.gradle.kts versionCode must be >= 156 (got ${code})`);
    assert.equal(mSwVer[1], ver);
    assert.equal(mSwName[1], ver);
    assert.equal(mGName[1], ver);
    assert.ok(mainJava.includes(`"${ver}"`), `MainActivity.java fallback must include "${ver}"`);
    assert.equal(mRelTag[1], ver);
    assert.equal(Number(mRelCode[1]), code);

    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine.includes('// History:'), 'sw.js CACHE_VERSION must preserve // History: token');
    assert.ok(cacheNameLine.includes('// History:'), 'sw.js CACHE_NAME must preserve // History: token');

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine.includes('// History:'), 'build.gradle.kts versionCode must preserve // History: token');
    assert.ok(vnLine.includes('// History:'), 'build.gradle.kts versionName must preserve // History: token');

    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));
    assert.ok(releaseScript.includes('API 26–30') && releaseScript.includes('API 31–35+') && releaseScript.includes('- **Nocturne-Android.apk**'));
  });
});
