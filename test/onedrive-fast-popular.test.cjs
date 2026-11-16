'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('OneDrive / MSAL Fast & Popular Authentication Suite', async (t) => {
  await t.test('1. Default multi-tenant Microsoft Client ID is defined and valid GUID', () => {
    assert.match(html, /const DEFAULT_MICROSOFT_CLIENT_ID = '([0-9a-f-]{36})';/i, 'Must define DEFAULT_MICROSOFT_CLIENT_ID');
    const match = html.match(/const DEFAULT_MICROSOFT_CLIENT_ID = '([0-9a-f-]{36})';/i);
    assert.ok(match, 'Must match GUID');
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(guidRegex.test(match[1]), `Default Microsoft Client ID ${match[1]} must be a valid GUID`);
  });

  await t.test('2. Client ID resolution prioritizes custom override with default fallback', () => {
    assert.ok(html.includes('function getMicrosoftClientId()'), 'Must define getMicrosoftClientId helper');
    assert.ok(html.includes("library.parseCloudConfig(localStorage.getItem('nocturne-microsoft'))"), 'Must safely parse nocturne-microsoft config');
    assert.ok(html.includes('return DEFAULT_MICROSOFT_CLIENT_ID'), 'Must fallback to DEFAULT_MICROSOFT_CLIENT_ID');
  });

  await t.test('3. Quick connect button immediately triggers login without developer config blockers', () => {
    assert.ok(!html.includes("throw new Error('Đăng nhập lần đầu? Dán Microsoft Client ID vào phần OneDrive.')"),
      'Must NOT block users clicking quick-connect with developer error popup');
    assert.ok(html.includes("$('microsoft-quick-connect').addEventListener('click'"),
      'Must wire microsoft-quick-connect listener');
  });

  await t.test('4. Direct token connect strips Bearer prefix and sets expiresAt telemetry', () => {
    assert.ok(html.includes("$('microsoft-token-connect')?.addEventListener('click'"),
      'Must wire microsoft-token-connect listener');
    assert.ok(html.includes("token.replace(/^Bearer\\s+/i, '')"),
      'Must sanitize token by stripping Bearer prefix');
    assert.ok(html.includes('state.microsoftExpiresAt = Date.now() + 3600 * 1000;'),
      'Must record 1-hour expiration timestamp on token');
    assert.ok(html.includes("localStorage.setItem('nocturne-microsoft-token', token)"),
      'Must persist token to localStorage');
  });

  await t.test('5. Fast token helper button and paste button are integrated', () => {
    assert.ok(html.includes('id="microsoft-fast-token-btn"'), 'Must have fast token helper button in UI');
    assert.ok(html.includes("$('microsoft-fast-token-btn')?.addEventListener('click'"),
      'Must wire fast token helper to open Graph Explorer');
    assert.ok(html.includes('https://developer.microsoft.com/en-us/graph/graph-explorer'),
      'Must link directly to Microsoft Graph Explorer');
    assert.ok(html.includes("$('microsoft-paste-btn')?.addEventListener('click'"),
      'Must wire clipboard paste button');
  });

  await t.test('6. Strictly preserve Audio Graph invariant', () => {
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio crossfeed invariant must be 100% intact');
  });
});
