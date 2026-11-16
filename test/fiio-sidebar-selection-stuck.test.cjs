const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const MAIN_ACTIVITY_PATH = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const VIRTUAL_SCROLL_PATH = path.join(ROOT_DIR, 'virtual-scroll.js');
const BUILD_GRADLE_PATH = path.join(ROOT_DIR, 'android', 'app', 'build.gradle.kts');

test('1. FiiO M11S WebView Configuration in MainActivity.java', () => {
  const code = fs.readFileSync(MAIN_ACTIVITY_PATH, 'utf8');
  assert.ok(code.includes('settings.setUseWideViewPort(false);'), 'MainActivity must disable setUseWideViewPort so FiiO M11S uses native 360dp bounds');
  assert.ok(code.includes('settings.setLoadWithOverviewMode(false);'), 'MainActivity must disable setLoadWithOverviewMode to prevent desktop overview zoom scaling');
});

test('2. isMobileViewport Helper in index.html', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('const isMobileViewport = () =>'), 'index.html must define isMobileViewport helper');
  assert.ok(html.includes('max-width: 1023.98px'), 'isMobileViewport must check max-width: 1023.98px');
  assert.ok(html.includes('window.innerWidth < 1024'), 'isMobileViewport must check window.innerWidth < 1024');
  assert.ok(html.includes('window.isNativeAndroid') || html.includes('window.NocturneNative'), 'isMobileViewport must check native Android / DAP environment');
});

test('3. Immediate Navigation Dismissal on Mobile & FiiO M11S', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  
  // setSidebarOpen initializes collapsed on mobile
  assert.ok(html.includes('setSidebarOpen(!isMobileViewport());'), 'Sidebar must be initialized with setSidebarOpen(!isMobileViewport())');

  // Delegated listener on #sidebar
  assert.ok(html.includes("$('sidebar')?.addEventListener('click'"), 'Sidebar must have a delegated click listener for auto-dismissal');
  assert.ok(html.includes('data-smart-playlist') && html.includes('nav-link'), 'Delegated listener must handle nav-link and smart playlists');

  // setLibraryView auto-dismissal
  assert.ok(html.includes('function setLibraryView(view)'), 'setLibraryView must be defined');
  const viewDismissMatch = html.match(/function setLibraryView[\s\S]*?if\s*\(isMobileViewport\(\)\)\s*setSidebarOpen\(false\);/);
  assert.ok(viewDismissMatch, 'setLibraryView must call setSidebarOpen(false) when isMobileViewport() is true');

  // selectSmartPlaylist auto-dismissal
  const smartDismissMatch = html.match(/function selectSmartPlaylist[\s\S]*?if\s*\(typeof isMobileViewport === 'function' && isMobileViewport\(\) && typeof setSidebarOpen === 'function'\)\s*\{\s*setSidebarOpen\(false\);/);
  assert.ok(smartDismissMatch, 'selectSmartPlaylist must dismiss sidebar on mobile/DAP');

  // favorites-filter auto-dismissal
  assert.ok(html.includes("$('favorites-filter').addEventListener('click'") && html.includes('if (isMobileViewport()) setSidebarOpen(false);'), 'favorites-filter must dismiss sidebar on mobile/DAP');
});

test('4. Hardware Back Navigation Integration for Sidebar', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('window.onAndroidBackPressed'), 'window.onAndroidBackPressed must exist');
  assert.ok(html.includes('if (typeof sidebarIsOpen === \'function\' && sidebarIsOpen() && isMobileViewport())'), 'onAndroidBackPressed must detect open sidebar on mobile/DAP');
  assert.ok(html.includes('setSidebarOpen(false);') && html.includes('return true;'), 'onAndroidBackPressed must close sidebar and return true');
});

test('5. CSS Visibility and Pointer-Events Guarantee', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('body.sidebar-collapsed #sidebar'), 'CSS must define body.sidebar-collapsed #sidebar');
  assert.ok(html.includes('visibility: hidden !important'), 'Collapsed sidebar must have visibility: hidden !important');
  assert.ok(html.includes('pointer-events: none !important'), 'Collapsed sidebar must have pointer-events: none !important');
  assert.ok(html.includes('#sidebar-backdrop.hidden, #sidebar-backdrop[hidden]'), 'CSS must define hidden sidebar-backdrop');
});

test('6. virtual-scroll.js Mobile & DAP Window Scroll Binding', () => {
  const code = fs.readFileSync(VIRTUAL_SCROLL_PATH, 'utf8');
  assert.ok(code.includes('isMobileOrDap = window.innerWidth <= 768 || Boolean(window.isNativeAndroid || window.NocturneNative)'), 'virtual-scroll must detect mobile/DAP layout');
  assert.ok(code.includes('this._scrollTarget = window;'), 'virtual-scroll must bind scrollTarget to window on mobile/DAP');
});

test('7. App Version Bump for Release v2.0.3', () => {
  const gradle = fs.readFileSync(BUILD_GRADLE_PATH, 'utf8');
  assert.ok(gradle.includes('versionCode = 13'), 'versionCode must be bumped to 13');
  assert.ok(gradle.includes('versionName = "2.0.3"'), 'versionName must be bumped to 2.0.3');
});

test('8. CRITICAL AUDIO GRAPH INVARIANT PRESERVATION', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio graph must strictly preserve state.crossfeedNodes.output.connect(state.context.destination)');
});

test('9. Fast-Tap Direct Activation & Focus Outline Elimination for FiiO Touchscreen', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('user-scalable=no'), 'Viewport meta must specify user-scalable=no to disable double-tap gesture lag');
  assert.ok(html.includes('outline: none !important'), 'CSS must enforce outline: none !important globally on buttons and links');
  assert.ok(html.includes('-webkit-tap-highlight-color: transparent !important'), 'CSS must disable webkit tap highlight color');
  assert.ok(html.includes('touchStartPos'), 'index.html must implement Fast-Tap touchStartPos tracking');
  assert.ok(html.includes('interactiveEl.click()'), 'Fast-Tap touchend listener must trigger interactiveEl.click() directly on tap');
});

test('10. Cache Busting & Service Worker Bypass for Native Android & FiiO M11S', () => {
  const mainAct = fs.readFileSync(MAIN_ACTIVITY_PATH, 'utf8');
  assert.ok(mainAct.includes('settings.setCacheMode(WebSettings.LOAD_NO_CACHE);'), 'MainActivity must disable disk HTTP caching');
  assert.ok(mainAct.includes('mWebView.clearCache(true);'), 'MainActivity must clear WebView cache on startup');
  assert.ok(mainAct.includes('caches.delete(k)'), 'Bridge must delete lingering CacheStorage');
  assert.ok(mainAct.includes('r.unregister()'), 'Bridge must unregister lingering ServiceWorkers');

  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(html.includes('const isNative = typeof window !== \'undefined\' && (window.isNativeAndroid || window.NocturneNative || location.hostname === \'appassets.androidplatform.net\');'), 'index.html must detect native Android in registerServiceWorker');
  assert.ok(html.includes('#autoeq-modal.hidden, #autoeq-modal[hidden]'), 'CSS must prevent autoeq-modal overlay trapping touches');
});
