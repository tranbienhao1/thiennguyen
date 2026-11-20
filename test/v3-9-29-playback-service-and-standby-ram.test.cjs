'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const PLAYBACK_SERVICE = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. NocturnePlaybackService attaches cached album art large icon and self-stops after 20m unattended pause', () => {
  const svc = fs.readFileSync(PLAYBACK_SERVICE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(svc.includes('public static volatile android.graphics.Bitmap sCurrentAlbumArt = null;'));
  assert.ok(svc.includes('public static final long PAUSE_IDLE_TIMEOUT_MS = 20L * 60L * 1000L;'));
  assert.ok(svc.includes('mIdleHandler.removeCallbacks(mIdleStopRunnable);'));
  assert.ok(svc.includes('mIdleHandler.postDelayed(mIdleStopRunnable, PAUSE_IDLE_TIMEOUT_MS);'));
  assert.ok(svc.includes('if (art != null && !art.isRecycled()) {\n            builder.setLargeIcon(art);\n        }'));
  assert.ok(java.includes('NocturnePlaybackService.sCurrentAlbumArt = loadCachedCoverBitmap(album, artist);'));
});

test('2. window.onAndroidLowMemory releases standby deck preload when not crossfading and clears revoked track.url references', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('window.onAndroidLowMemory = function(level)');
  assert.ok(start > 0);
  const body = html.slice(start, start + 2600);
  assert.ok(body.includes('const activeEl = (state.activeDeck && state.activeDeck.element) ? state.activeDeck.element'));
  assert.ok(body.includes('if (Number(level) >= 15 && !inCrossfade && typeof clearStalePreload === \'function\')'));
  assert.ok(body.includes("if (tr.url === url) tr.url = '';"));
  assert.ok(body.includes('if (tr.fullAudioUrl === url) tr.fullAudioUrl = null;'));
});

test('3. Version sync v3.9.29 (versionCode 83), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.29';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.29';"));
  assert.ok(gradle.includes('versionCode = 83'));
  assert.ok(gradle.includes('versionName = "3.9.29"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S \u00b7 v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
