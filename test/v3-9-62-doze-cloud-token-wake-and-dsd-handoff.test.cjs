'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('1. runCloudWakeTokenRefresh & runGoogleTokenKeepAliveTick recover expired Google Drive + OneDrive tokens after Android Doze and clear stale downloadUrls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('let lastTokenKeepAliveAt = 0;');
  const end = html.indexOf("const LONG_TRACK_POS_KEY = 'nocturne-long-track-positions';", start);
  assert.ok(start > 0 && end > start);

  const googleCalls = [];
  const msCalls = [];
  const now = Date.now();
  const sandbox = {
    MICROSOFT_DOWNLOAD_URL_MAX_AGE_MS: 30 * 60 * 1000,
    navigator: { onLine: true },
    state: {
      googleToken: 'expired_g_tok',
      googleExpiresAt: now - 60000, // Expired 1 minute ago during Android Doze!
      msAccount: { username: 'user@outlook.com' },
      microsoftAccessToken: 'expired_ms_tok',
      microsoftExpiresAt: now - 120000, // Expired 2 minutes ago during Android Doze!
      tracks: [
        { id: 'od_1', source: 'onedrive', downloadUrl: 'https://sharepoint.stale/1', downloadUrlAt: now - 40 * 60 * 1000 },
        { id: 'od_2', source: 'onedrive', downloadUrl: 'https://sharepoint.fresh/2', downloadUrlAt: now - 5 * 60 * 1000 }
      ]
    },
    ensureGoogleToken: async (force) => { googleCalls.push(force); return 'fresh_g'; },
    getMicrosoftToken: async (interactive) => { msCalls.push(interactive); return 'fresh_ms'; },
    Date, Array, Object, Number, Boolean
  };
  vm.runInNewContext(
    html.slice(start, end) +
    '\nthis.runCloudWakeTokenRefresh = runCloudWakeTokenRefresh;' +
    '\nthis.runGoogleTokenKeepAliveTick = runGoogleTokenKeepAliveTick;' +
    '\nthis.clearStaleMicrosoftDownloadUrls = clearStaleMicrosoftDownloadUrls;',
    sandbox
  );

  sandbox.runCloudWakeTokenRefresh();
  assert.deepEqual(googleCalls, [true], 'Expired Google token after Doze must trigger silent force refresh');
  assert.deepEqual(msCalls, [false], 'Expired OneDrive token after Doze must trigger non-interactive silent refresh');
  assert.equal(sandbox.state.tracks[0].downloadUrl, '', 'Stale OneDrive downloadUrl must be cleared on wake');
  assert.equal(sandbox.state.tracks[1].downloadUrl, 'https://sharepoint.fresh/2', 'Fresh OneDrive downloadUrl must be kept');

  // Calling again immediately within 60s cooldown must be throttled
  sandbox.runCloudWakeTokenRefresh();
  assert.equal(googleCalls.length, 1, 'Wake refresh must respect 60s cooldown');
  assert.equal(msCalls.length, 1, 'OneDrive wake refresh must respect 60s cooldown');
});

test('2. DSD first-slice -> full-PCM upgrade honors pending seek, sets flicker-free _upgradingFullAudio & cleans up on worker error', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dsdStart = html.indexOf("const worker = new Worker(new URL('dsd-worker.js', dsdWorkerBaseUrl));");
  const dsdEnd = html.indexOf('function playNext(direction = 1, auto = false) {', dsdStart);
  assert.ok(dsdStart > 0 && dsdEnd > dsdStart);
  const dsdSlice = html.slice(dsdStart, dsdEnd);

  assert.ok(dsdSlice.includes('track._pendingSeekAfterFullUpgrade'), 'DSD full upgrade must honor pending seek');
  assert.ok(dsdSlice.includes('deck._upgradingFullAudio = true;'), 'DSD full upgrade must set flicker-free flag');
  assert.ok(dsdSlice.includes('const dsdUpgradeClearTimer ='), 'DSD upgrade flag must have 4s safety timer');
  assert.ok(dsdSlice.includes('if (dsdFullResolve) dsdFullResolve();'), 'DSD error paths must resolve fullAudioPromise');
  const resolveMatches = dsdSlice.match(/if \(dsdFullResolve\) dsdFullResolve\(\);/g) || [];
  assert.ok(resolveMatches.length >= 4, `Expected >= 4 dsdFullResolve calls (done + msg error + onerror + catch), got ${resolveMatches.length}`);
});

test('3. M3U/M3U8 unified parser, playlistDir forwarding, FiiO scan exclusion, Bit-Perfect visibilitychange guard & v3.9.62+ alignment', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');

  assert.ok(html.includes("lowerCheckName.endsWith('.m3u') || lowerCheckName.endsWith('.m3u8')"), 'FiiO scan must skip raw .m3u/.m3u8 files');
  assert.ok(html.includes('lib.matchPlaylistWithLibrary(parsed.tracks, state.tracks, { playlistDir })'));
  assert.ok(html.includes('lib.matchPlaylistWithLibrary(importedTracks, state.tracks, { playlistDir: importPlaylistDir })'));
  assert.ok(html.includes("if (!state.isNativeBitPerfectPlaying && audio && audio.src && !audio.paused && !audio.ended)"));
  assert.ok(html.includes("if (typeof runCloudWakeTokenRefresh === 'function') runCloudWakeTokenRefresh();"));

  assert.match(html, /FiiO M11S · v3\.9\.(6[2-9]|[7-9]\d|\d{3,})/);
  assert.match(sw, /const CACHE_VERSION = 'v3\.9\.(6[2-9]|[7-9]\d|\d{3,})';/);
  assert.match(sw, /const CACHE_NAME = 'nocturne-v3\.9\.(6[2-9]|[7-9]\d|\d{3,})';/);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 116, `Expected versionCode >= 116, got ${vcMatch && vcMatch[1]}`);
  assert.match(gradle, /versionName\s*=\s*"3\.9\.(6[2-9]|[7-9]\d|\d{3,})"/);
});
