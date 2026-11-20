'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. MainActivity.getOtaStatusJson exposes activeVersion, bundledVersion, pendingVersion, isOtaActive & apkVersionCode', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('String bundled = mActivity.readBundledCacheName().replace("\\"", "");'), 'Must expose bundledVersion');
  assert.ok(java.includes('boolean isOtaActive = new File(mActivity.getOtaActiveDir(), ".ota_ready").exists()'), 'Must compute isOtaActive accurately');
  assert.ok(java.includes('\\"bundledVersion\\":\\"'), 'JSON payload must include bundledVersion');
  assert.ok(java.includes('\\"isOtaActive\\":'), 'JSON payload must include isOtaActive boolean');
});

test('2. Settings OTA status badge & 1-tap safe rollback button runtime behavior', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('id="ota-rollback-btn"'), 'Settings must include #ota-rollback-btn');
  assert.ok(html.includes("typeof window.refreshOtaStatusBadge === 'function'"), 'showSettings must refresh OTA badge');

  const start = html.indexOf('function setupFiioIntegration() {');
  const end = html.indexOf('window.setupFiioIntegration = setupFiioIntegration;', start);
  assert.ok(start !== -1 && end > start, 'setupFiioIntegration must exist');
  const src = html.slice(start, end + 'window.setupFiioIntegration = setupFiioIntegration;'.length);

  const makeEl = () => {
    const classes = new Set(['hidden']);
    const listeners = {};
    return {
      textContent: '',
      checked: false,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c)
      },
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
      click: () => { if (listeners.click) listeners.click(); }
    };
  };

  const els = {
    'ota-check-btn': makeEl(),
    'ota-reload-btn': makeEl(),
    'ota-rollback-btn': makeEl(),
    'ota-status-text': makeEl()
  };

  let currentStatusJson = JSON.stringify({
    activeVersion: 'nocturne-v3.9.21',
    bundledVersion: 'nocturne-v3.9.13',
    pendingVersion: '',
    isOtaActive: true,
    apkVersionCode: 75
  });
  let resetCalls = 0;
  let reloadCalls = 0;
  const toasts = [];

  const mockWindow = {
    isNativeAndroid: true,
    NocturneNative: {
      getOtaStatusJson: () => currentStatusJson,
      checkOtaUpdateNow: () => {},
      resetOtaCache: () => { resetCalls++; return true; },
      applyOtaReload: () => { reloadCalls++; }
    }
  };

  new Function('window', '$', 'state', 'scanFiioStorage', 'applyFiioDapMode', 'toast', 'location', src)(
    mockWindow,
    (id) => els[id] || null,
    { fiioDapMode: true },
    () => {},
    () => {},
    (m) => toasts.push(m),
    { reload: () => { reloadCalls++; } }
  );
  mockWindow.setupFiioIntegration();

  assert.equal(els['ota-rollback-btn'].classList.contains('hidden'), false, 'Rollback button must appear when running OTA web assets');
  assert.ok(els['ota-status-text'].textContent.includes('Web OTA v3.9.21') && els['ota-status-text'].textContent.includes('APK gốc v3.9.13'), 'Status text must show active OTA vs bundled APK version');

  // 1-tap rollback triggers resetOtaCache + applyOtaReload
  els['ota-rollback-btn'].click();
  assert.equal(resetCalls, 1, 'Rollback button must call native.resetOtaCache()');
  assert.equal(reloadCalls, 1, 'Rollback button must reload WebView into bundled APK');
  assert.equal(els['ota-rollback-btn'].classList.contains('hidden'), true, 'Rollback button hides after resetting OTA');

  // Bundled APK state hides rollback button and shows bundled version + versionCode
  currentStatusJson = JSON.stringify({
    activeVersion: 'nocturne-v3.9.21',
    bundledVersion: 'nocturne-v3.9.21',
    pendingVersion: '',
    isOtaActive: false,
    apkVersionCode: 75
  });
  mockWindow.refreshOtaStatusBadge();
  assert.equal(els['ota-rollback-btn'].classList.contains('hidden'), true, 'Rollback button stays hidden when already on bundled APK');
  assert.ok(els['ota-status-text'].textContent.includes('Bản gốc APK v3.9.21') && els['ota-status-text'].textContent.includes('code 75'));
});

test('3. Full 13-JS APP_SHELL <-> Android Assets parity, v3.9.21 (versionCode 75), and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  const rootJs = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).sort();
  const assetJs = fs.readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(assetJs, rootJs, 'All root *.js files must be mirrored 1:1 into Android assets');
  for (const f of rootJs) {
    const a = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const b = fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8');
    assert.equal(b, a, `Asset parity mismatch for ${f}`);
    assert.ok(!b.includes('\r'), `Android asset ${f} must be Unix LF (0 CR bytes)`);
  }

  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.21';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.21';"));
  assert.ok(gradle.includes('versionCode = 75'));
  assert.ok(gradle.includes('versionName = "3.9.21"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
