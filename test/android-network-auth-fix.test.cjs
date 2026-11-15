const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainActivityPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const netSecPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const assetIndexPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'index.html');

test('Android App Network, Cloud Auth & Local LAN Connection Fixes Suite', async (t) => {
  const mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const netSec = fs.readFileSync(netSecPath, 'utf8');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const assetIndex = fs.readFileSync(assetIndexPath, 'utf8');

  await t.test('1. MainActivity configures OAuth popups & clean User-Agent', () => {
    assert.ok(mainActivity.includes('settings.setSupportMultipleWindows(true)'), 'Must enable multiple windows for OAuth popups');
    assert.ok(mainActivity.includes('settings.setJavaScriptCanOpenWindowsAutomatically(true)'), 'Must allow JS to open popup windows');
    assert.ok(mainActivity.includes('mCleanUserAgent = defaultUa.replace("; wv", "")'), 'Must strip WebView tag to prevent Google 403 disallowed_useragent');
    assert.ok(mainActivity.includes('CookieManager.getInstance().setAcceptThirdPartyCookies'), 'Must enable third party cookies for OAuth');
    assert.ok(mainActivity.includes('onCreateWindow'), 'Must implement onCreateWindow for Google/Microsoft popup dialog');
    assert.ok(mainActivity.includes('onCloseWindow'), 'Must implement onCloseWindow to close popup on auth completion');
  });

  await t.test('2. MainActivity & AndroidManifest enable cleartext & local LAN streaming', () => {
    assert.ok(mainActivity.includes('MIXED_CONTENT_ALWAYS_ALLOW'), 'Must allow mixed content for local HTTP music servers');
    assert.ok(mainActivity.includes('proxyLocalHttpRequest'), 'Must proxy local HTTP requests with CORS injection');
    assert.ok(mainActivity.includes('OPTIONS'), 'Must handle OPTIONS preflight with CORS headers');
    assert.ok(manifest.includes('android:usesCleartextTraffic="true"'), 'Manifest must permit cleartext traffic');
    assert.ok(manifest.includes('android.permission.ACCESS_WIFI_STATE'), 'Manifest must have ACCESS_WIFI_STATE');
    assert.ok(manifest.includes('android.permission.CHANGE_WIFI_MULTICAST_STATE'), 'Manifest must have CHANGE_WIFI_MULTICAST_STATE');
    assert.ok(netSec.includes('cleartextTrafficPermitted="true"'), 'Network security config must permit cleartext traffic');
  });

  await t.test('3. index.html auto-normalizes local server endpoints', () => {
    assert.ok(indexHtml.includes('!/^https?:\\/\\//i.test(endpoint)'), 'Must auto-prepend http:// to bare IP endpoints');
    assert.ok(indexHtml.includes('pickFolder()'), 'pickFolder must exist');
    assert.ok(indexHtml.includes('window.isNativeAndroid'), 'pickFolder must support Android native file picker fallback');
  });

  await t.test('4. index.html provides direct Access Token cloud connection', () => {
    assert.ok(indexHtml.includes('id="google-token-direct"'), 'Must have direct Google token input');
    assert.ok(indexHtml.includes('id="google-token-connect"'), 'Must have Google token connect button');
    assert.ok(indexHtml.includes('id="microsoft-token-direct"'), 'Must have direct Microsoft token input');
    assert.ok(indexHtml.includes('id="microsoft-token-connect"'), 'Must have Microsoft token connect button');
    assert.ok(indexHtml.includes('nocturne-google-token'), 'Must persist and restore Google token in localStorage');
  });

  await t.test('5. Android assets are kept in sync with root index.html', () => {
    assert.ok(assetIndex.includes('id="google-token-direct"'), 'Asset index.html must have google-token-direct');
    assert.ok(assetIndex.includes('id="microsoft-token-direct"'), 'Asset index.html must have microsoft-token-direct');
    assert.ok(assetIndex.includes('connectSubsonicServer'), 'Asset index.html must have connectSubsonicServer');
  });

  await t.test('6. Absolute Audio Graph Invariant Preservation', () => {
    assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio graph invariant must be strictly preserved');
  });
});
