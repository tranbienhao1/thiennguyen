'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const notFoundPath = path.join(rootDir, '404.html');
const assetIndexPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'index.html');

const html = fs.readFileSync(indexPath, 'utf8');
const notFoundHtml = fs.readFileSync(notFoundPath, 'utf8');
const assetHtml = fs.readFileSync(assetIndexPath, 'utf8');

test('Cloud Authentication Modern 2026 UI & UX Suite', async (t) => {
  await t.test('1. Sidebar Quick Connect buttons exist with modern styling and non-blocking handlers', () => {
    assert.ok(html.includes('id="google-quick-connect"'), 'Must have google-quick-connect');
    assert.ok(html.includes('id="microsoft-quick-connect"'), 'Must have microsoft-quick-connect');
    assert.ok(html.includes('id="choose-folder"'), 'Must have choose-folder');

    // Check modern badge and labeling
    assert.ok(html.includes('Đăng nhập Google'), 'Must have clear Google Drive login label');
    assert.ok(html.includes('Đăng nhập OneDrive'), 'Must have clear OneDrive login label');
    assert.ok(html.includes('1-Chạm'), 'Must indicate 1-click convenience badge');

    // Check event listener triggers 1-click login without blocking developer popup traps
    assert.ok(!html.includes("throw new Error('Đăng nhập lần đầu? Dán Google Client ID vào phần Google Drive.')"), 'No blocking error for Google');
    assert.ok(!html.includes("throw new Error('Đăng nhập lần đầu? Dán Microsoft Client ID vào phần OneDrive.')"), 'No blocking error for OneDrive');
  });

  await t.test('2. 3-Tier Modern UX hierarchy for Google Drive and OneDrive', () => {
    // Check Tier 1: 1-Click login (Khuyên dùng)
    assert.ok(html.includes('⚡ Đăng nhập 1-Chạm (Khuyên dùng)'), 'Must have Tier 1 button text');
    assert.ok(html.includes('id="google-connect"'), 'Must have google-connect button');
    assert.ok(html.includes('id="microsoft-connect"'), 'Must have microsoft-connect button');

    // Check Tier 2: Instant Token Paste for DAP FiiO / Android
    assert.ok(html.includes('🔑 Dán Token Siêu Tốc (Dành cho DAP FiiO / Android)'), 'Must have Tier 2 section text');
    assert.ok(html.includes('id="google-token-direct"'), 'Must have google-token-direct');
    assert.ok(html.includes('id="microsoft-token-direct"'), 'Must have microsoft-token-direct');
    assert.ok(html.includes('id="google-paste-btn"'), 'Must have google-paste-btn');
    assert.ok(html.includes('id="microsoft-paste-btn"'), 'Must have microsoft-paste-btn');
    assert.ok(html.includes('id="google-fast-token-btn"'), 'Must have google-fast-token-btn');
    assert.ok(html.includes('id="microsoft-fast-token-btn"'), 'Must have microsoft-fast-token-btn');
    assert.ok(html.includes('id="google-token-connect"'), 'Must have google-token-connect');
    assert.ok(html.includes('id="microsoft-token-connect"'), 'Must have microsoft-token-connect');

    // Check Tier 3: Custom Client ID Override (Advanced) collapsed in details
    assert.ok(html.includes('⚙ Cấu hình Client ID tự tạo (Nâng cao)'), 'Must have Tier 3 details summary');
    assert.ok(html.includes('<details'), 'Must be inside a details element');
    assert.ok(html.includes('id="google-client-id"'), 'Must preserve google-client-id inside details');
    assert.ok(html.includes('id="microsoft-client-id"'), 'Must preserve microsoft-client-id inside details');
  });

  await t.test('3. Dedicated card containers and modal references', () => {
    assert.ok(html.includes('id="google-drive-card"'), 'Must have google-drive-card section');
    assert.ok(html.includes('id="onedrive-card"'), 'Must have onedrive-card section');
    assert.ok(html.includes('id="cloud-auth-modal"'), 'Must have cloud-auth-modal container');
    assert.ok(html.includes('id="settings-modal"'), 'Must preserve settings-modal');
    assert.ok(html.includes('id="google-state"'), 'Must preserve google-state');
    assert.ok(html.includes('id="microsoft-state"'), 'Must preserve microsoft-state');
    assert.ok(html.includes('id="cloud-status"'), 'Must preserve cloud-status');
  });

  await t.test('4. Fallback guidance avoids red error popups', () => {
    assert.ok(html.includes("toast('Nếu DAP hoặc trình duyệt chặn popup, hãy chọn [🔑 Dán Token Siêu Tốc] bên dưới')"),
      'Must provide friendly guidance toast instead of red error popup on quick-connect fallback');
  });

  await t.test('5. Synchronized across index.html, 404.html, and android assets with Unix LF line endings', () => {
    assert.equal(html, notFoundHtml, 'index.html and 404.html must be strictly identical');
    assert.equal(html, assetHtml, 'index.html and android assets index.html must be strictly identical');

    assert.ok(!html.includes('\r\n'), 'index.html must use Unix LF line endings');
    assert.ok(!notFoundHtml.includes('\r\n'), '404.html must use Unix LF line endings');
    assert.ok(!assetHtml.includes('\r\n'), 'android assets index.html must use Unix LF line endings');
  });

  await t.test('6. Strictly preserve Audio Graph invariant', () => {
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio crossfeed invariant must be 100% intact');
  });
});
