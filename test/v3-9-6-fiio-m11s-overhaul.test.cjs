'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const TW_CSS = path.join(ROOT, 'tailwind.min.css');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const PLAYBACK_SVC = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('v3.9.8 Layer 1: WebView 74 CSS & JS Compatibility (no :where() button break, no overflow-x:clip, no Promise.allSettled)', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const tw = fs.readFileSync(TW_CSS, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');

  assert.ok(html.includes('button, input[type="button"], input[type="reset"], input[type="submit"]'));
  assert.ok(!tw.includes('input:where([type=button])'));
  assert.ok(!tw.includes('[hidden]:where('));
  assert.ok(!/overflow-x\s*:\s*clip/i.test(html));
  assert.ok(!/await\s+Promise\.allSettled\s*\(/.test(html));
  assert.ok(!/Promise\.allSettled\s*\(/.test(sw));

  const match = html.match(/function allSettledCompat\(promises\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(match);
  const ctx = { Promise };
  vm.createContext(ctx);
  vm.runInContext(match[0], ctx);
  const res = await ctx.allSettledCompat([Promise.resolve('ok-tag'), Promise.reject(new Error('net-err'))]);
  assert.equal(res[0].status, 'fulfilled');
  assert.equal(res[0].value, 'ok-tag');
  assert.equal(res[1].status, 'rejected');
});

test('v3.9.8 Layer 2: Web-Parity Offline Tailwind Coverage & FiiO M11S 5-inch Roon Visual Polish', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const tw = fs.readFileSync(TW_CSS, 'utf8');

  for (const selector of [
    '.z-\\[65\\]{z-index:65}',
    '.z-\\[130\\]{z-index:130}',
    '.bg-zinc-950\\/90{',
    '.bg-black\\/80{',
    '.bg-gradient-to-r{',
    '.from-violet-600{',
    '.border-t-transparent{',
    '.w-\\[min\\(92vw\\,480px\\)\\]{',
    '.max-h-\\[min\\(88dvh\\,780px\\)\\]{',
    '.\\!hidden{display:none !important}'
  ]) {
    assert.ok(tw.includes(selector), `tailwind.min.css must include ${selector}`);
  }

  assert.ok(html.includes('box-shadow: inset 3px 0 #91cde5 !important;'));
  assert.ok(html.includes('#mobile-quality {'));
  assert.ok(html.includes('#header-eq-btn {'));
});

test('v3.9.8 Hotfix: Fast-Tap Deduplication, Settings Touch Scrolling & Safe Storage Scan', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  // 1. Fast-Tap capture click listener must actually cancel trailing trusted click (prevents Sidebar double-toggle!)
  assert.ok(
    html.includes('if (Date.now() - lastFastTapClickTs < 450 && e.isTrusted) {\n        e.preventDefault();\n        e.stopPropagation();\n        e.stopImmediatePropagation();\n      }'),
    'Fast-Tap click deduplicator must stop propagation of duplicate trusted clicks'
  );

  // 2. Settings modal must use single-container Chromium 74 scrolling (top/right/bottom/left:0, height:100vh, display:block, touch-action:pan-y)
  assert.ok(html.includes('#settings-modal[open] { display:block!important; }'));
  assert.ok(html.includes('#settings-modal button, #settings-modal input, #settings-modal select, #settings-modal section, #settings-modal label { touch-action:pan-y!important; }'));

  // 3. scanFiioStorage must NOT use spread-push (push(...)) which overflows V8 stack on large MicroSD libraries
  const scanSection = html.slice(html.indexOf('async function scanFiioStorage('), html.indexOf('window.scanFiioStorage = scanFiioStorage;'));
  assert.ok(scanSection.length > 200);
  assert.ok(!scanSection.includes('.push(...'), 'scanFiioStorage must not use spread-push (.push(...))');

  // 4. MainActivity.java scanDirInternal must guard depth, canonical symlinks, and skip Android/proc/sys
  assert.ok(java.includes('if (depth > 16 || collected.size() >= limit'));
  assert.ok(java.includes('visitedDirs.add(canonical)'));
  assert.ok(java.includes('"Android".equals(dName)'));
});

test('v3.9.8 Layer 3: Android Native Safe-Area Insets, MediaStyle, Pause Keep-Alive & Version 3.9.8', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const svc = fs.readFileSync(PLAYBACK_SVC, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.8';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.8';"));
  assert.ok(gradle.includes('versionCode = 62'));
  assert.ok(gradle.includes('versionName = "3.9.8"'));

  assert.ok(java.includes('private volatile int mSafeInsetTopDp = 0;'));
  assert.ok(java.includes('applySafeAreaInsetsToWebView();'));
  assert.ok(java.includes('NocturnePlaybackService.sMediaSessionToken = mMediaSession.getSessionToken();'));
  assert.ok(svc.includes('new Notification.MediaStyle()'));
  assert.ok(svc.includes('STOP_FOREGROUND_DETACH'));
  assert.ok(java.includes('return "{\\"versionName\\":\\"" + vName'));
});

test('v3.9.8 Asset Parity (0 CR bytes) & Web Audio Invariants', () => {
  const rootHtml = fs.readFileSync(INDEX_HTML, 'utf8');
  const assetHtml = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8');
  const rootTw = fs.readFileSync(TW_CSS, 'utf8');
  const assetTw = fs.readFileSync(path.join(ASSETS_DIR, 'tailwind.min.css'), 'utf8');

  assert.equal(rootHtml, assetHtml);
  assert.equal(rootTw, assetTw);
  assert.ok(!assetHtml.includes('\r'));
  assert.ok(!assetTw.includes('\r'));
  assert.ok(rootHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(rootHtml.includes('target.volume = audio.volume;'));
});
