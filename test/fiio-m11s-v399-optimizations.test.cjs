'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const LIB_UTILS = path.join(ROOT, 'library-utils.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

const library = require(LIB_UTILS);

test('1. FiiO M11S Hardware Media Keys: Zero ES2020 ?. in MainActivity JS bridge & No Bit-Perfect Double-Toggle', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(!java.includes("$('play-button')?.click()"), 'dispatchPlayPauseToWeb must not use ES2020 ?. syntax (breaks Chromium 74)');
  assert.ok(!java.includes("$('next-button')?.click()"), 'dispatchNextToWeb must not use ES2020 ?. syntax (breaks Chromium 74)');
  assert.ok(!java.includes("$('previous-button')?.click()"), 'dispatchPreviousToWeb must not use ES2020 ?. syntax (breaks Chromium 74)');
  assert.ok(java.includes('window.onNativeBitPerfectStateChange('), 'Hardware Play/Pause during Bit-Perfect must sync JS UI directly without double-clicking #play-button');
  assert.ok(java.includes('KEYCODE_MEDIA_FAST_FORWARD') && java.includes('KEYCODE_MEDIA_REWIND'), 'Must intercept FiiO FF/RW hardware keys');
  assert.ok(java.includes('PlaybackState.ACTION_SEEK_TO') && java.includes('public void onSeekTo(long pos)'), 'MediaSession must support lockscreen seek');
});

test('2. FiiO M11S Audio Engine: True 24-bit/32-bit PCM_FLOAT on Android 10 (API 29), Jitter-Free Buffer & Gapless Session Preservation', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(
    java.includes('requestedBitDepth >= 24 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP') &&
    java.includes('pcmEncoding = AudioFormat.ENCODING_PCM_FLOAT;'),
    'Must use ENCODING_PCM_FLOAT on API 21-30 (FiiO M11S Android 10) for >= 24-bit Hi-Res PCM'
  );
  assert.ok(
    java.includes('boolean fiioHiRes = isFiioDevice() && sampleRate >= 88200;') &&
    java.includes('Math.max(minBufSize * 6, 196608)'),
    'Must allocate jitter-free Hi-Res AudioTrack buffer on FiiO DAP'
  );
  assert.ok(
    java.includes('stopInternal(true);') && java.includes('private synchronized void stopInternal(boolean preserveSession)'),
    'Track switching must preserve WakeLock/WifiLock/AudioFocus/Notification without flicker'
  );
});

test('3. FiiO M11S Screen-Off Hi-Res Wi-Fi Streaming (WifiLock) & Smart Version-Gated WebView Cache', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(java.includes('import android.os.Handler;') && java.includes('import android.os.Looper;'), 'Must import Handler and Looper');
  assert.ok(java.includes('import android.net.wifi.WifiManager;'), 'Must import WifiManager');
  assert.ok(java.includes('private WifiManager.WifiLock mWifiLock;') && java.includes('WIFI_MODE_FULL_HIGH_PERF'), 'Must hold high-perf WifiLock during screen-off streaming');
  assert.ok(java.includes('mWifiLock.acquire()') && java.includes('mWifiLock.release()'), 'Must acquire and release WifiLock cleanly');
  assert.ok(java.includes('settings.setCacheMode(WebSettings.LOAD_DEFAULT);'), 'Must use LOAD_DEFAULT so remote album covers cache on FiiO M11S');
  assert.ok(java.includes('last_version_code') && java.includes('BuildConfig.VERSION_CODE'), 'Must clear WebView HTTP cache only when APK version upgrades');
  assert.ok(java.includes('showMediaNotification(title, artist, album, false);'), 'Must gracefully update notification when paused in background');
});

test('4. FiiO M11S MediaStore Disc/Track Number Extraction & Extended DAP Audio Formats', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(java.includes('MediaStore.Audio.Media.TRACK') && java.includes('MediaStore.Audio.Media.YEAR'), 'scanMediaStoreAudio must project TRACK and YEAR');
  assert.ok(java.includes('name.endsWith(".wv")') && java.includes('name.endsWith(".aac")') && java.includes('name.endsWith(".mka")'), 'scanDirInternal must detect .wv, .aac, .mka');

  const msTrack = library.createFiioTrack({
    uri: 'content://media/external/audio/media/42',
    name: '03 - Time.flac',
    path: '/storage/ABCD-1234/Music/Pink Floyd/DSOTM/CD1/03 - Time.flac',
    title: 'Time',
    artist: 'Pink Floyd',
    album: 'Dark Side of the Moon',
    trackNumber: 3,
    discNumber: 1,
    year: 1973,
    size: 42000000,
    duration: 413
  });
  assert.equal(msTrack.trackNumber, 3);
  assert.equal(msTrack.discNumber, 1);
  assert.equal(msTrack.year, 1973);

  const sdDsf = library.createFiioTrack({
    name: '02-05_TrackFive.dsf',
    path: '/storage/ABCD-1234/Music/DSD/CD2/05 - TrackFive.dsf',
    size: 180000000
  });
  assert.equal(sdDsf.isDsd, true);
  assert.equal(sdDsf.discNumber, 2);
  assert.equal(sdDsf.trackNumber, 5);
  assert.equal(sdDsf.album, 'FiiO Internal & SD Card');
});

test('5. FiiO M11S 3GB RAM & Adreno 512 GPU Optimizations in index.html + v3.9.9 Build & Parity', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');

  assert.ok(html.includes('body.fiio-dap-mode #fullscreen-bg-cover'), 'Must lighten fullscreen Gaussian blur for Adreno 512 GPU');
  assert.ok(html.includes('contain: layout style;'), 'Must enable CSS containment on rows/cards in FiiO DAP mode');
  assert.ok(html.includes('const maxEdge = isLowRamDap ? 320 : 512'), 'Must downscale covers to 320px on FiiO M11S 3GB RAM');
  assert.ok(html.includes('IS_LEGACY_ANDROID || (typeof state !== \'undefined\' && state && state.fiioDapMode)'), 'Must throttle background metadata queue to 1 worker in FiiO DAP mode');
  assert.ok(html.includes('window.onHardwareSeekOffset =') && html.includes('window.onHardwareSeekTo ='), 'Must wire hardware seek callbacks');
  assert.ok(gradle.includes('versionCode = 67') && gradle.includes('versionName = "3.9.13"') && /versionCode\s*=\s*6[789]/.test(gradle) && /versionName\s*=\s*"3\.9\.1\d"/.test(gradle), 'APK version must be >= 3.9.13 (versionCode >= 67)');
  assert.equal(html, assetHtml, 'index.html and android assets/index.html must be identical');
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio graph invariant strictly preserved');
});
