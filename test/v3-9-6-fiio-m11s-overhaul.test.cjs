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

test('v3.9.7 Layer 1: WebView 74 CSS & JS Compatibility (no :where() button break, no overflow-x:clip, no Promise.allSettled)', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const tw = fs.readFileSync(TW_CSS, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');

  assert.ok(html.includes('button, input[type="button"], input[type="reset"], input[type="submit"]'));
  assert.ok(!tw.includes('input:where([type=button])'), 'tailwind.min.css must not use :where() on button preflight');
  assert.ok(!tw.includes('[hidden]:where('), 'tailwind.min.css must not use :where() on [hidden]');
  assert.ok(!/overflow-x\s*:\s*clip/i.test(html), 'index.html must not use overflow-x: clip');
  assert.ok(!/await\s+Promise\.allSettled\s*\(/.test(html), 'index.html must not call Promise.allSettled directly');
  assert.ok(!/Promise\.allSettled\s*\(/.test(sw), 'sw.js must not call Promise.allSettled directly');

  const match = html.match(/function allSettledCompat\(promises\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(match, 'allSettledCompat helper must exist in index.html');
  const ctx = { Promise };
  vm.createContext(ctx);
  vm.runInContext(match[0], ctx);
  const res = await ctx.allSettledCompat([Promise.resolve('ok-tag'), Promise.reject(new Error('net-err'))]);
  assert.equal(res.length, 2);
  assert.equal(res[0].status, 'fulfilled');
  assert.equal(res[0].value, 'ok-tag');
  assert.equal(res[1].status, 'rejected');
  assert.equal(res[1].reason.message, 'net-err');
});

test('v3.9.7 Layer 2: Web-Parity Offline Tailwind Coverage & FiiO M11S 5-inch Roon Visual Polish', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const tw = fs.readFileSync(TW_CSS, 'utf8');

  // Offline Tailwind utilities previously only available via desktop CDN JIT
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
    assert.ok(tw.includes(selector), `tailwind.min.css must include offline Web-parity utility: ${selector}`);
  }

  // Roon visual polish preserved on fiio-dap-mode (cyan active indicators, radial dark-slate bg, EQ pill, quality badge)
  assert.ok(html.includes('box-shadow: inset 3px 0 #91cde5 !important;'), 'Must preserve Roon active track cyan bar on FiiO DAP');
  assert.ok(html.includes('background: radial-gradient(ellipse at 76% -18%, #20282b 0, transparent 42%), #111315 !important;'), 'Must preserve Web radial dark-slate background');
  assert.ok(html.includes('#mobile-quality {'), 'Must expose audiophile quality badge on mobile/DAP footer');
  assert.ok(html.includes('footer.glass #ab-loop-btn,\n      footer.glass #speed-btn'), 'Must hide A-B and 1.0x buttons on narrow footer');
  assert.ok(html.includes('#header-eq-btn {'), 'Must keep 1-tap EQ pill accessible in mobile/DAP header');
});

test('v3.9.7 Layer 3: Android Native Safe-Area Insets, MediaStyle, Pause Keep-Alive & Java Escaping', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const svc = fs.readFileSync(PLAYBACK_SVC, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.7';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.7';"));
  assert.ok(gradle.includes('versionCode = 61'));
  assert.ok(gradle.includes('versionName = "3.9.7"'));

  assert.ok(java.includes('private volatile int mSafeInsetTopDp = 0;'));
  assert.ok(java.includes('applySafeAreaInsetsToWebView();'));
  assert.ok(java.includes('NocturnePlaybackService.sMediaSessionToken = mMediaSession.getSessionToken();'));
  assert.ok(svc.includes('new Notification.MediaStyle()'));
  assert.ok(svc.includes('STOP_FOREGROUND_DETACH'));
  assert.ok(java.includes('return "{\\"versionName\\":\\"" + vName'));
});

test('v3.9.7 Asset Parity (0 CR bytes) & Web Audio Invariants', () => {
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
