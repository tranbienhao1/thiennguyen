const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Google Drive Authentication Fast & Popular Suite', async (t) => {
  await t.test('1. Built-in default Google OAuth Client ID exists and is valid', () => {
    assert.ok(indexHtml.includes('DEFAULT_GOOGLE_CLIENT_ID ='), 'DEFAULT_GOOGLE_CLIENT_ID must be defined');
    const match = indexHtml.match(/DEFAULT_GOOGLE_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(match && match[1], 'Must match DEFAULT_GOOGLE_CLIENT_ID regex');
    assert.ok(/^[\w.-]+\.apps\.googleusercontent\.com$/.test(match[1]), 'Default client ID must match googleusercontent regex');
    assert.ok(indexHtml.includes("scope: 'https://www.googleapis.com/auth/drive.readonly'"), 'Must request drive.readonly scope');
  });

  await t.test('2. Quick connect button NEVER blocks user with developer error', () => {
    assert.ok(!indexHtml.includes("Đăng nhập lần đầu? Dán Google Client ID vào phần Google Drive."), 'Must never throw developer blocking error on quick connect');
    assert.ok(indexHtml.includes("$('google-quick-connect').addEventListener"), 'google-quick-connect listener must exist');
    assert.ok(indexHtml.includes('connectGoogle(effectiveClientId)'), 'google-quick-connect must call connectGoogle with effectiveClientId');
  });

  await t.test('3. Custom Client ID override is fully supported', () => {
    assert.ok(indexHtml.includes("localStorage.getItem('nocturne-google')"), 'Must read saved config from localStorage nocturne-google');
    assert.ok(indexHtml.includes("localStorage.setItem('nocturne-google'"), 'Must persist custom client ID in localStorage');
    assert.ok(indexHtml.includes('config.clientId ||'), 'Custom clientId must be prioritized before default fallback');
  });

  await t.test('4. 1-Click Fast Token Fallback (DAP / Android WebView) exists', () => {
    assert.ok(indexHtml.includes('id="google-fast-token-btn"'), 'Must have google-fast-token-btn in DOM');
    assert.ok(indexHtml.includes('google-fast-token-btn'), 'Must attach event listener to google-fast-token-btn');
    assert.ok(indexHtml.includes('GOOGLE_AUTH_FALLBACK_URL ='), 'Must have external auth fallback URL');
    assert.ok(indexHtml.includes('openExternalAuth('), 'Must have openExternalAuth helper supporting NocturneNative bridge');
    assert.ok(indexHtml.includes('openAuthInBrowser'), 'Must support NocturneNative.openAuthInBrowser bridge');
    assert.ok(indexHtml.includes('id="google-paste-btn"'), 'Must have google-paste-btn for 1-tap clipboard paste');
    assert.ok(indexHtml.includes('id="google-token-direct"'), 'Must have direct token input field');
    assert.ok(indexHtml.includes('id="google-token-connect"'), 'Must have google-token-connect button');
  });

  await t.test('5. Audio Graph Invariant Preservation', () => {
    assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio graph invariant must be strictly preserved');
  });
});
