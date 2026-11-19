'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const html404 = fs.readFileSync(path.join(rootDir, '404.html'), 'utf8');
const androidIndexHtml = fs.readFileSync(path.join(rootDir, 'android/app/src/main/assets/index.html'), 'utf8');
const libraryUtils = fs.readFileSync(path.join(rootDir, 'library-utils.js'), 'utf8');
const swJs = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
const manifestXml = fs.readFileSync(path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const mainActivity = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
const playbackServicePath = path.join(rootDir, 'android/app/src/main/java/com/nocturne/audiophile/NocturnePlaybackService.java');
const gradleKts = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle.kts'), 'utf8');

test('Big Update v2.2.0 (Web + Android APK) Verification Suite', async (t) => {
  await t.test('1. All inline scripts in index.html have valid JavaScript syntax', () => {
    const scriptMatches = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scriptMatches.length > 0, 'index.html must contain script tags');
    for (let i = 0; i < scriptMatches.length; i++) {
      const code = scriptMatches[i][1];
      if (!code.trim()) continue;
      assert.doesNotThrow(() => new vm.Script(code, { filename: `index-inline-${i}.js` }), `Script #${i} must parse cleanly`);
    }
  });

  await t.test('2. fetchAudioResponse accepts M4A/MP4/FLAC/DSF/WebM cloud MIME types', () => {
    for (const mime of ['video/mp4', 'video/webm', 'application/x-flac', 'application/x-dsf', 'application/dsd']) {
      assert.ok(libraryUtils.includes(`'${mime}'`), `library-utils.js fetchAudioResponse must allow ${mime}`);
    }
  });

  await t.test('3. Cloud playback supportsAllDrives=true & 401 auto-refresh + bandwidth priority', () => {
    assert.ok(indexHtml.includes('?alt=media&supportsAllDrives=true'), 'loadGoogleAudio & cloudTagRequest must pass supportsAllDrives=true');
    assert.ok(indexHtml.includes('function pauseCloudMetadataQueue'), 'pauseCloudMetadataQueue must exist');
    assert.ok(indexHtml.includes('function resumeCloudMetadataQueue'), 'resumeCloudMetadataQueue must exist');
    assert.ok(indexHtml.includes('if (cloudMetadataPausedUntil && Date.now() < cloudMetadataPausedUntil) return;'), 'runCloudMetadataQueue must honor pause window');
    const refreshHits = (indexHtml.match(/ensureGoogleToken\(true\)/g) || []).length;
    assert.ok(refreshHits >= 2, 'fetchCloudTrack and fetchCloudFile must auto-refresh Google token on 401');
  });

  await t.test('4. IndexedDB serializableCloudTrack persists trackNumber & discNumber + CSS #room-lyrics.hidden guard', () => {
    assert.ok(indexHtml.includes('trackNumber:track.trackNumber != null ? track.trackNumber : null'), 'serializableCloudTrack must persist trackNumber');
    assert.ok(indexHtml.includes('discNumber:track.discNumber != null ? track.discNumber : null'), 'serializableCloudTrack must persist discNumber');
    assert.ok(indexHtml.includes('#room-lyrics.hidden, #room-lyrics[hidden]'), '#room-lyrics.hidden must be guarded');
  });

  await t.test('5. Play button resume ensures unmute and non-zero active deck gain', () => {
    assert.ok(indexHtml.includes("if (state.context && state.context.state === 'suspended') await state.context.resume();"), 'play-button resume must resume suspended AudioContext');
    assert.ok(indexHtml.includes('curAudio.muted = false;'), 'MediaSession / playback resume must unmute audio');
  });

  await t.test('6. Service Worker v2.2.0 caches complete APP_SHELL assets', () => {
    assert.ok(/nocturne-v2\.[2-9]\.\d+/.test(swJs), 'sw.js must be bumped to >= v2.2.0');
    for (const asset of ['tailwind.min.css', 'virtual-scroll.js', 'ui-overlay.js', 'library-tools.js', 'autoeq-cue.js', 'lrclib-client.js', 'lyrics-utils.js', 'lyrics-editor-ui.js']) {
      assert.ok(swJs.includes(`'${asset}'`), `sw.js APP_SHELL must include ${asset}`);
    }
  });

  await t.test('7. Android APK Foreground Playback Service & version 2.2.0', () => {
    assert.ok(fs.existsSync(playbackServicePath), 'NocturnePlaybackService.java must exist');
    const svc = fs.readFileSync(playbackServicePath, 'utf8');
    assert.ok(svc.includes('FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK'), 'NocturnePlaybackService must use mediaPlayback foreground type');
    assert.ok(manifestXml.includes('android:name=".NocturnePlaybackService"'), 'AndroidManifest.xml must declare NocturnePlaybackService');
    assert.ok(manifestXml.includes('android:foregroundServiceType="mediaPlayback"'), 'AndroidManifest.xml service must set foregroundServiceType=mediaPlayback');
    assert.ok(mainActivity.includes('NocturnePlaybackService.class'), 'MainActivity.java must wire NocturnePlaybackService');
    assert.ok(gradleKts.includes('versionCode = 31'), 'build.gradle.kts versionCode must be 24');
    assert.ok(gradleKts.includes('versionName = "2.6.3"'), 'build.gradle.kts versionName must be 2.3.0');
    assert.ok(manifestXml.includes('android:largeHeap="true"'), 'AndroidManifest.xml must enable largeHeap');
    assert.ok(indexHtml.includes('id="album-hero-shuffle"'), 'Album hero must include Shuffle button');
    assert.ok(indexHtml.includes('id="jump-to-playing-btn"'), 'Toolbar must include Jump to Now Playing button');
    assert.ok(indexHtml.includes('id="shortcuts-modal"'), 'Shortcuts modal must exist');
    assert.ok(indexHtml.includes('function jumpToNowPlaying()'), 'jumpToNowPlaying must exist');
    assert.ok(indexHtml.includes('label: `Disc ${discNo}`'), 'Multi-disc albums must group with Disc headers');
    assert.ok(indexHtml.includes('id="ab-loop-btn"'), 'Footer must include A-B Loop button');
    assert.ok(indexHtml.includes('function cycleAbLoop()'), 'A-B Loop controller must exist');
    assert.ok(indexHtml.includes('id="speed-btn"'), 'Footer must include Playback Speed button');
    assert.ok(indexHtml.includes('id="album-hero-fav-all"'), 'Album hero must include Favorite All button');
    assert.ok(indexHtml.includes('id="album-hero-m3u8"'), 'Album hero must include M3U8 Export button');
    assert.ok(indexHtml.includes('id="stats-modal"'), 'Audiophile Library Stats modal must exist');
    assert.ok(indexHtml.includes('window.getBitPerfectTelemetry = function()'), 'Web Bit-Perfect telemetry must exist');
    assert.ok(indexHtml.includes('window.onBitPerfectFormatLocked = function'), 'Native Bit-Perfect format lock callback must exist');
    assert.ok(mainActivity.includes('Pre-build setPreferredMixerBitPerfect'), 'MainActivity must apply Android 14+ Bit-Perfect mixer BEFORE AudioTrack.build()');
    assert.ok(mainActivity.includes('track.setVolume(AudioTrack.getMaxVolume())'), 'MainActivity must lock AudioTrack gain to unity 1.0');
    assert.ok(mainActivity.includes('notifyBitPerfectFormatToWeb('), 'MainActivity must report locked Bit-Perfect format to Web');
    assert.ok(indexHtml.includes('detectLegacyAndroidEnvironment()'), 'Legacy Android detection must exist');
    assert.ok(indexHtml.includes('body.legacy-android'), 'Legacy Android low-GPU CSS rules must exist');
    assert.ok(indexHtml.includes('window.onAndroidLowMemory = function'), 'Low-memory trim handler must exist in Web');
    assert.ok(mainActivity.includes('RENDERER_PRIORITY_IMPORTANT'), 'MainActivity must protect WebView renderer priority on Android 8+');
    assert.ok(mainActivity.includes('public void onTrimMemory(int level)'), 'MainActivity must handle onTrimMemory for older low-RAM Android devices');
    assert.ok(indexHtml.includes('qp.hidden = false; qp.removeAttribute(\'hidden\');'), 'openQueue must clear native hidden attribute');
    assert.ok(indexHtml.includes('view.hidden = !shouldOpen;'), 'toggleRoonFullscreen must clear native hidden attribute');
    assert.ok(indexHtml.includes('setupHiddenAttributeSync'), 'All modals/panels must auto-sync native hidden attribute');
  });

  await t.test('8. Asset parity (0 CR bytes) & Web Audio invariant preserved', () => {
    assert.equal(indexHtml, html404, 'index.html and 404.html must be byte-identical');
    assert.equal(indexHtml, androidIndexHtml, 'index.html and android assets index.html must be byte-identical');
    assert.ok(!indexHtml.includes('\r'), 'index.html must contain 0 CR bytes');
    assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio invariant must remain intact');
  });
});
