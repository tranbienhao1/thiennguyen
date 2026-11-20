'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const GITIGNORE = path.join(ROOT, '.gitignore');
const SYNC_SCRIPT = path.join(ROOT, 'sync-assets.cjs');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. OTA SemVer Guard prevents silent downgrade and fixes Java \\s regex in MainActivity.java', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.ok(
    java.includes('.compile("const\\\\s+CACHE_NAME\\\\s*=\\\\s*[\'\\"]([^\'\\"]+)[\'\\"]")'),
    'extractCacheNameFromSw must use properly escaped Java regex \\\\s'
  );
  assert.ok(
    java.includes('public static int compareSemverVersions(String a, String b)'),
    'MainActivity must define numeric compareSemverVersions helper'
  );
  assert.ok(
    java.includes('compareSemverVersions(remoteVer, currentVer) <= 0'),
    'checkAndDownloadOtaUpdateAsync must only apply strictly newer SemVer releases'
  );
  assert.ok(
    java.includes('compareSemverVersions(activeOtaVer, bundledVer) <= 0'),
    'ensureOtaMatchesCurrentApk must discard cached OTA when bundled APK version is >= OTA'
  );
  assert.ok(
    java.includes('if ("library-utils.js".equals(relFile))') && java.includes('data.length < 50000 || head.startsWith("<")'),
    'OTA staging must reject truncated or HTML-error library-utils.js payloads'
  );

  // Behavioral simulation of compareSemverVersions logic
  const parseTuple = (raw) => {
    const m = String(raw || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const cmp = (a, b) => {
    const pa = parseTuple(a), pb = parseTuple(b);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  };
  assert.ok(cmp('nocturne-v3.9.14', 'nocturne-v3.9.13') > 0, '3.9.14 > 3.9.13');
  assert.ok(cmp('nocturne-v3.9.14', 'nocturne-v3.9.9') > 0, '3.9.14 > 3.9.9 (numeric patch compare)');
  assert.ok(cmp('nocturne-v3.9.13', 'nocturne-v3.9.14') < 0, 'stale CDN 3.9.13 must NOT downgrade 3.9.14');
  assert.equal(cmp('nocturne-v3.9.14', 'nocturne-v3.9.14'), 0, 'equal versions return 0');
});

test('2. Settings Dialog uses pure Overlay (zero <dialog>.showModal() Top-Layer scroll traps)', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(!/\bmodal\.showModal\s*\(/.test(html), 'index.html must not invoke modal.showModal() Top-Layer');
  assert.ok(html.includes("modal.setAttribute('open', '');"), 'showSettings must open via overlay attribute');
  assert.ok(html.includes('#settings-modal[open] { display:block!important; }'), 'Settings modal open CSS preserved');
});

test('3. Version Sync v3.9.14 (versionCode 68), Lock Hygiene & Technical Invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const gitignore = fs.readFileSync(GITIGNORE, 'utf8');
  const syncCode = fs.readFileSync(SYNC_SCRIPT, 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.14';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.14';"));
  assert.ok(gradle.includes('versionCode = 68'));
  assert.ok(gradle.includes('versionName = "3.9.14"'));
  assert.ok(java.includes('"3.9.14"'));
  assert.ok(html.includes('FiiO M11S · v3.9.14'));

  assert.ok(gitignore.includes('.agent/RUN.LOCK'), '.agent/RUN.LOCK must be gitignored');
  assert.ok(!syncCode.includes('.agent'), 'sync-assets.cjs must never copy .agent into Android assets');
  assert.ok(!fs.existsSync(path.join(ASSETS_DIR, '.agent')), 'android assets must not contain .agent');

  assert.equal(html, assetHtml, 'index.html and android assets/index.html must match');
  assert.ok(!assetHtml.includes('\r'), 'android assets/index.html must be Unix LF (0 CR bytes)');

  // Core Web Audio invariants
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'));
  const rebuildMatch = html.match(/function rebuildAudioRoutes\s*\([\s\S]*?\n    \}/);
  if (rebuildMatch) {
    assert.ok(!rebuildMatch[0].includes('deck.preamp.gain.value ='), 'rebuildAudioRoutes must not hard-assign deck.preamp.gain.value');
  }
});
