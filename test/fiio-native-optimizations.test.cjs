'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const mainActivityJava = path.join(
  rootDir,
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'nocturne',
  'audiophile',
  'MainActivity.java'
);
const manifestXml = path.join(
  rootDir,
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml'
);
const indexHtml = path.join(rootDir, 'index.html');

test('FiiO M11S Native Optimization & Hardware Integration Test Suite', async (t) => {
  assert.ok(fs.existsSync(mainActivityJava), 'MainActivity.java must exist');
  assert.ok(fs.existsSync(manifestXml), 'AndroidManifest.xml must exist');

  const mainSource = fs.readFileSync(mainActivityJava, 'utf8');
  const manifest = fs.readFileSync(manifestXml, 'utf8');

  await t.test('1. Local Media Streaming & HTTP 206 Partial Content Range Support', () => {
    // Intercepts /local-media endpoint
    assert.match(
      mainSource,
      /appassets\.androidplatform\.net/i,
      'Must match appassets.androidplatform.net authority'
    );
    assert.match(
      mainSource,
      /\/local-media/i,
      'Must intercept /local-media path'
    );

    // RandomAccessFile and BoundedFileInputStream
    assert.match(
      mainSource,
      /class\s+BoundedFileInputStream\s+extends\s+InputStream/i,
      'Must implement BoundedFileInputStream'
    );
    assert.match(
      mainSource,
      /new\s+RandomAccessFile\s*\(\s*file\s*,\s*["']r["']\s*\)/i,
      'Must use RandomAccessFile for zero memory buffering O(1) seek'
    );
    assert.match(
      mainSource,
      /\.seek\s*\(\s*start\s*\)/i,
      'Must seek to start byte position in file'
    );

    // HTTP 206 & Range parsing
    assert.match(mainSource, /206/i, 'Must support HTTP 206 Partial Content status');
    assert.match(mainSource, /Content-Range/i, 'Must emit Content-Range header');
    assert.match(mainSource, /Content-Length/i, 'Must emit Content-Length header');
    assert.match(mainSource, /Accept-Ranges/i, 'Must emit Accept-Ranges header');

    // Audiophile MIME types
    assert.match(mainSource, /audio\/flac/i, 'Must map FLAC MIME type to audio/flac');
    assert.match(mainSource, /audio\/x-dsd/i, 'Must map DSD (dsf/dff) MIME type to audio/x-dsd');
    assert.match(mainSource, /audio\/wav/i, 'Must map WAV MIME type to audio/wav');
    assert.match(mainSource, /audio\/mpeg/i, 'Must map MP3 MIME type to audio/mpeg');
  });

  await t.test('2. FiiO Physical Hardware Buttons Interception', () => {
    // Override dispatchKeyEvent and onKeyDown
    assert.match(
      mainSource,
      /boolean\s+dispatchKeyEvent\s*\(\s*KeyEvent\s+event\s*\)/i,
      'Must override dispatchKeyEvent(KeyEvent event)'
    );
    assert.match(
      mainSource,
      /boolean\s+onKeyDown\s*\(\s*int\s+keyCode\s*,\s*KeyEvent\s+event\s*\)/i,
      'Must override onKeyDown(int keyCode, KeyEvent event)'
    );

    // All media keycodes
    const keyCodes = [
      'KEYCODE_MEDIA_PLAY',
      'KEYCODE_MEDIA_PAUSE',
      'KEYCODE_MEDIA_PLAY_PAUSE',
      'KEYCODE_MEDIA_NEXT',
      'KEYCODE_MEDIA_PREVIOUS',
      'KEYCODE_MEDIA_STOP',
      'KEYCODE_HEADSETHOOK'
    ];
    for (const kc of keyCodes) {
      assert.ok(mainSource.includes(kc), `Must intercept ${kc}`);
    }

    // Dispatches to web view selectors (ES5-safe for Chromium 74 FiiO M11S WebView)
    assert.match(
      mainSource,
      /getElementById\('play-button'\);\s*if\s*\(b\)\s*b\.click\(\)/i,
      'Must dispatch play-button click to web view'
    );
    assert.match(
      mainSource,
      /getElementById\('next-button'\);\s*if\s*\(b\)\s*b\.click\(\)/i,
      'Must dispatch next-button click to web view'
    );
    assert.match(
      mainSource,
      /getElementById\('previous-button'\);\s*if\s*\(b\)\s*b\.click\(\)/i,
      'Must dispatch previous-button click to web view'
    );

    // Return true to prevent FiiO system music app from stealing
    assert.match(
      mainSource,
      /return\s+true;\s*\/\/\s*Return true so FiiO system music app doesn't steal/i,
      'Must return true to consume hardware keys'
    );
  });

  await t.test('3. Background Playback & Ongoing Media Notification Channel & WakeLock', () => {
    // Notification channel
    assert.match(
      mainSource,
      /nocturne_playback/i,
      'Must define NotificationChannel with id "nocturne_playback"'
    );
    assert.match(
      mainSource,
      /IMPORTANCE_LOW/i,
      'Must set notification importance to IMPORTANCE_LOW'
    );

    // Ongoing notification with actions
    assert.match(
      mainSource,
      /setOngoing\s*\(\s*true\s*\)/i,
      'Must set notification as ongoing during playback'
    );
    assert.match(
      mainSource,
      /addAction/i,
      'Must add Previous, Play/Pause, Next actions to notification'
    );

    // JavaScriptInterface updateMediaNotification
    assert.match(
      mainSource,
      /@JavascriptInterface\s+public\s+void\s+updateMediaNotification\s*\(\s*String\s+title/i,
      'WebAppInterface must expose updateMediaNotification(String, String, String, boolean)'
    );

    // WakeLock acquisition and release
    assert.match(
      mainSource,
      /acquireWakeLock\(\)/i,
      'Must acquire WakeLock when playback starts'
    );
    assert.match(
      mainSource,
      /releaseWakeLock\(\)/i,
      'Must release WakeLock when playback stops'
    );
  });

  await t.test('4. Notification Actions Handling via PendingIntents', () => {
    assert.match(
      mainSource,
      /PendingIntent\.getBroadcast/i,
      'Must create PendingIntents for notification actions'
    );
    assert.match(
      mainSource,
      /ACTION_PLAY_PAUSE/i,
      'Must define ACTION_PLAY_PAUSE'
    );
    assert.match(
      mainSource,
      /ACTION_NEXT/i,
      'Must define ACTION_NEXT'
    );
    assert.match(
      mainSource,
      /ACTION_PREV/i,
      'Must define ACTION_PREV'
    );
    assert.match(
      mainSource,
      /onNewIntent\s*\(\s*Intent\s+intent\s*\)/i,
      'Must handle onNewIntent for direct activity intents'
    );
  });

  await t.test('5. AndroidManifest.xml and Audio Invariant Check', () => {
    assert.match(
      manifest,
      /android:requestLegacyExternalStorage\s*=\s*["']true["']/i,
      'AndroidManifest.xml must set requestLegacyExternalStorage="true" for Android 10 DAPs'
    );
    assert.match(
      manifest,
      /android\.permission\.WAKE_LOCK/i,
      'Must request WAKE_LOCK permission'
    );
    assert.match(
      manifest,
      /android\.permission\.FOREGROUND_SERVICE/i,
      'Must request FOREGROUND_SERVICE permission'
    );
    assert.match(
      manifest,
      /com\.nocturne\.audiophile\.ACTION_PLAY_PAUSE/i,
      'Must register ACTION_PLAY_PAUSE intent filter'
    );

    const indexHtmlContent = fs.readFileSync(indexHtml, 'utf8');
    assert.ok(
      indexHtmlContent.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});
