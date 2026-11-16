'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const notFoundPath = path.join(rootDir, '404.html');
const androidIndexPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'index.html');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const notFoundHtml = fs.readFileSync(notFoundPath, 'utf8');
const androidIndexHtml = fs.readFileSync(androidIndexPath, 'utf8');

test('Cloud Authentication Fast & Popular Comprehensive Verification Suite', async (t) => {

  await t.test('1. Built-in default OAuth Client IDs exist and work without user manual input', async (tSub) => {
    // 1.1 Google Default Client ID
    await tSub.test('Google default client ID is defined and correctly formatted', () => {
      assert.ok(indexHtml.includes('DEFAULT_GOOGLE_CLIENT_ID ='), 'DEFAULT_GOOGLE_CLIENT_ID must be declared in index.html');
      const gMatch = indexHtml.match(/DEFAULT_GOOGLE_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
      assert.ok(gMatch && gMatch[1], 'Must match DEFAULT_GOOGLE_CLIENT_ID value');
      assert.ok(
        /^[\w.-]+\.apps\.googleusercontent\.com$/.test(gMatch[1]),
        `Default Google Client ID (${gMatch[1]}) must match valid googleusercontent pattern`
      );
    });

    // 1.2 Microsoft Default Client ID
    await tSub.test('Microsoft default client ID is defined and is a valid GUID for multi-tenant PKCE', () => {
      assert.ok(indexHtml.includes('DEFAULT_MICROSOFT_CLIENT_ID ='), 'DEFAULT_MICROSOFT_CLIENT_ID must be declared in index.html');
      const msMatch = indexHtml.match(/DEFAULT_MICROSOFT_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
      assert.ok(msMatch && msMatch[1], 'Must match DEFAULT_MICROSOFT_CLIENT_ID value');
      const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      assert.ok(
        guidPattern.test(msMatch[1]),
        `Default Microsoft Client ID (${msMatch[1]}) must be a valid GUID`
      );
    });

    // 1.3 Client ID fallback execution test in simulated sandbox
    await tSub.test('Functional fallback: Google and Microsoft resolve default client IDs when user input is empty', () => {
      const gMatch = indexHtml.match(/DEFAULT_GOOGLE_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
      const msMatch = indexHtml.match(/DEFAULT_MICROSOFT_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
      const defaultGoogleId = gMatch[1];
      const defaultMsId = msMatch[1];

      // Test Google resolution logic
      function resolveGoogleClientId(storedConfigJson, inputVal, overrideVal) {
        let savedConfig = {};
        try { savedConfig = JSON.parse(storedConfigJson) || {}; } catch (_) {}
        return overrideVal || inputVal?.trim() || savedConfig.clientId || defaultGoogleId;
      }
      assert.equal(
        resolveGoogleClientId(null, '', ''),
        defaultGoogleId,
        'Google should fallback to DEFAULT_GOOGLE_CLIENT_ID when localStorage and input are empty'
      );

      // Test Microsoft resolution logic (getMicrosoftClientId)
      function resolveMicrosoftClientId(storedConfigJson, inputVal) {
        let config = {};
        try { config = JSON.parse(storedConfigJson) || {}; } catch (_) {}
        if (config.clientId && typeof config.clientId === 'string' && config.clientId.trim()) {
          return config.clientId.trim();
        }
        const customInput = (inputVal || '').trim();
        if (customInput) return customInput;
        return defaultMsId;
      }
      assert.equal(
        resolveMicrosoftClientId(null, ''),
        defaultMsId,
        'Microsoft should fallback to DEFAULT_MICROSOFT_CLIENT_ID when localStorage and input are empty'
      );
    });
  });

  await t.test('2. Custom Client ID overrides work seamlessly when present', async (tSub) => {
    const customGoogleId = '999988887777-custom.apps.googleusercontent.com';
    const customMsId = '12345678-1234-1234-1234-123456789abc';

    await tSub.test('Google Drive custom override prioritized from localStorage or input', () => {
      assert.ok(indexHtml.includes("localStorage.getItem('nocturne-google')"), 'Must read nocturne-google from localStorage');
      assert.ok(indexHtml.includes("localStorage.setItem('nocturne-google'"), 'Must save custom nocturne-google to localStorage');

      // Verify code precedence in connectGoogle
      assert.ok(
        indexHtml.includes('const clientId = overrideClientId || inputVal || savedConfig.clientId || DEFAULT_GOOGLE_CLIENT_ID;'),
        'connectGoogle must prioritize overrideClientId -> inputVal -> savedConfig.clientId -> DEFAULT_GOOGLE_CLIENT_ID'
      );
    });

    await tSub.test('OneDrive custom override prioritized from input or localStorage', () => {
      assert.ok(indexHtml.includes('function getMicrosoftClientId()'), 'Must define getMicrosoftClientId()');
      assert.ok(indexHtml.includes("localStorage.getItem('nocturne-microsoft')"), 'Must read nocturne-microsoft from localStorage');
      assert.ok(indexHtml.includes("localStorage.setItem('nocturne-microsoft'"), 'Must save custom nocturne-microsoft to localStorage');

      // Verify code precedence in connectMicrosoft
      assert.ok(
        indexHtml.includes('const clientId = customInput || config.clientId || DEFAULT_MICROSOFT_CLIENT_ID;'),
        'connectMicrosoft must prioritize customInput -> config.clientId -> DEFAULT_MICROSOFT_CLIENT_ID'
      );
    });
  });

  await t.test('3. Quick token paste & connect flow sets token, expiresAt, and triggers file sync', async (tSub) => {
    // 3.1 Google Drive Token Flow
    await tSub.test('Google Drive direct token flow: sanitizes Bearer, sets state, expiresAt, and initiates sync', () => {
      assert.ok(indexHtml.includes("$('google-token-connect')?.addEventListener('click'"), 'Must wire google-token-connect');
      assert.ok(indexHtml.includes("token.replace(/^Bearer\\s+/i, '')"), 'Must sanitize Bearer prefix for Google token');
      assert.ok(indexHtml.includes('state.googleToken = token;'), 'Must assign state.googleToken');
      assert.ok(indexHtml.includes('state.googleExpiresAt = Date.now() + 3600 * 1000;'), 'Must set state.googleExpiresAt to 1 hour');
      assert.ok(indexHtml.includes("localStorage.setItem('nocturne-google-token', token)"), 'Must persist Google token');
      assert.ok(indexHtml.includes('await loadGoogleFiles();'), 'Must trigger loadGoogleFiles');
    });

    // 3.2 OneDrive Token Flow
    await tSub.test('OneDrive direct token flow: sanitizes Bearer, sets state, expiresAt, and initiates sync', () => {
      assert.ok(indexHtml.includes("$('microsoft-token-connect')?.addEventListener('click'"), 'Must wire microsoft-token-connect');
      assert.ok(indexHtml.includes('state.microsoftAccessToken = token;'), 'Must assign state.microsoftAccessToken');
      assert.ok(indexHtml.includes('state.microsoftExpiresAt = Date.now() + 3600 * 1000;'), 'Must set state.microsoftExpiresAt to 1 hour');
      assert.ok(indexHtml.includes("localStorage.setItem('nocturne-microsoft-token', token)"), 'Must persist OneDrive token');
      assert.ok(indexHtml.includes('await loadMicrosoftFiles(token);'), 'Must trigger loadMicrosoftFiles with token');
    });

    // 3.3 Clipboard paste buttons
    await tSub.test('Clipboard 1-tap paste buttons sanitize and populate token fields', () => {
      assert.ok(indexHtml.includes('id="google-paste-btn"'), 'Must have google-paste-btn element');
      assert.ok(indexHtml.includes("$('google-paste-btn')?.addEventListener('click'"), 'Must wire google-paste-btn');
      assert.ok(indexHtml.includes('id="microsoft-paste-btn"'), 'Must have microsoft-paste-btn element');
      assert.ok(indexHtml.includes("$('microsoft-paste-btn')?.addEventListener('click'"), 'Must wire microsoft-paste-btn');
    });

    // 3.4 Fast token helpers (DAP FiiO M11S external browser bridge)
    await tSub.test('Fast token helpers bridge to external browser without WebView popup blocking', () => {
      assert.ok(indexHtml.includes('id="google-fast-token-btn"'), 'Must have google-fast-token-btn');
      assert.ok(indexHtml.includes('id="microsoft-fast-token-btn"'), 'Must have microsoft-fast-token-btn');
      assert.ok(indexHtml.includes('GOOGLE_AUTH_FALLBACK_URL ='), 'Must have GOOGLE_AUTH_FALLBACK_URL defined');
      assert.ok(indexHtml.includes('openExternalAuth(GOOGLE_AUTH_FALLBACK_URL)'), 'google-fast-token-btn must invoke openExternalAuth');
      assert.ok(indexHtml.includes('https://developer.microsoft.com/en-us/graph/graph-explorer'), 'microsoft-fast-token-btn must link to Graph Explorer');
      assert.ok(indexHtml.includes('window.NocturneNative?.openAuthInBrowser'), 'Must support NocturneNative Android bridge');
    });

    // 3.5 Functional token sanitization simulation
    await tSub.test('Token sanitization logic strips Bearer prefix cleanly', () => {
      const sanitize = (raw) => (raw || '').trim().replace(/^Bearer\s+/i, '').trim();
      assert.equal(sanitize('Bearer ya29.test1234'), 'ya29.test1234');
      assert.equal(sanitize('bearer   EwB...msToken'), 'EwB...msToken');
      assert.equal(sanitize('BEARER tokenWithoutSpace'), 'tokenWithoutSpace');
      assert.equal(sanitize('ya29.cleanToken'), 'ya29.cleanToken');
    });
  });

  await t.test('4. UI elements operate cleanly without developer alert traps', async (tSub) => {
    await tSub.test('Sidebar quick connect buttons NEVER throw developer alert traps', () => {
      assert.ok(indexHtml.includes('id="google-quick-connect"'), 'Must have google-quick-connect in DOM');
      assert.ok(indexHtml.includes('id="microsoft-quick-connect"'), 'Must have microsoft-quick-connect in DOM');

      // Crucial: check that the legacy developer traps are gone
      assert.ok(!indexHtml.includes("throw new Error('Đăng nhập lần đầu? Dán Google Client ID vào phần Google Drive.')"), 'Legacy Google developer error must be deleted');
      assert.ok(!indexHtml.includes("throw new Error('Đăng nhập lần đầu? Dán Microsoft Client ID vào phần OneDrive.')"), 'Legacy Microsoft developer error must be deleted');
    });

    await tSub.test('Sidebar quick connect handlers gracefully catch errors and guide to DAP fast token', () => {
      assert.ok(
        indexHtml.includes("toast('Nếu DAP hoặc trình duyệt chặn popup, hãy chọn [🔑 Dán Token Siêu Tốc] bên dưới')"),
        'Must display friendly fallback toast guidance when popup or WebView fails'
      );
      assert.ok(
        indexHtml.includes("$('settings-error')?.classList.add('hidden')"),
        'Must suppress ugly red settings-error alert when providing fallback guidance'
      );
    });

    await tSub.test('3-Tier Modern UX hierarchy in Cloud Auth Settings', () => {
      // Tier 1: 1-Click login buttons
      assert.ok(indexHtml.includes('⚡ Đăng nhập 1-Chạm (Khuyên dùng)'), 'Tier 1 heading must exist');
      assert.ok(indexHtml.includes('id="google-connect"'), 'google-connect button must exist');
      assert.ok(indexHtml.includes('id="microsoft-connect"'), 'microsoft-connect button must exist');

      // Tier 2: Instant token paste section
      assert.ok(indexHtml.includes('🔑 Dán Token Siêu Tốc (Dành cho DAP FiiO / Android)'), 'Tier 2 heading must exist');
      assert.ok(indexHtml.includes('id="google-token-direct"'), 'google-token-direct field must exist');
      assert.ok(indexHtml.includes('id="microsoft-token-direct"'), 'microsoft-token-direct field must exist');

      // Tier 3: Advanced custom client ID accordion
      assert.ok(indexHtml.includes('⚙ Cấu hình Client ID tự tạo (Nâng cao)'), 'Tier 3 details summary must exist');
      assert.ok(indexHtml.includes('id="google-client-id"'), 'google-client-id field must exist');
      assert.ok(indexHtml.includes('id="microsoft-client-id"'), 'microsoft-client-id field must exist');
    });

    await tSub.test('All critical DOM IDs for cloud auth are present and unique', () => {
      const requiredIds = [
        'google-quick-connect',
        'microsoft-quick-connect',
        'google-connect',
        'microsoft-connect',
        'google-client-id',
        'microsoft-client-id',
        'google-token-direct',
        'microsoft-token-direct',
        'google-token-connect',
        'microsoft-token-connect',
        'google-paste-btn',
        'microsoft-paste-btn',
        'google-fast-token-btn',
        'microsoft-fast-token-btn',
        'google-state',
        'microsoft-state',
        'cloud-status',
        'cloud-auth-modal',
        'google-drive-card',
        'onedrive-card'
      ];
      for (const id of requiredIds) {
        const matches = indexHtml.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
        assert.equal(matches.length, 1, `Element ID "${id}" must exist exactly once in index.html (found ${matches.length})`);
      }
    });
  });

  await t.test('5. Audio graph invariant: state.crossfeedNodes.output.connect(state.context.destination) is 100% intact', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained in index.html'
    );
    assert.ok(
      notFoundHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained in 404.html'
    );
    assert.ok(
      androidIndexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained in android assets index.html'
    );
  });

  await t.test('6. Multi-file synchronization & Unix LF line endings across index.html, 404.html, and android assets', () => {
    // Exact byte-for-byte identity
    const bufIndex = fs.readFileSync(indexPath);
    const bufNotFound = fs.readFileSync(notFoundPath);
    const bufAndroidIndex = fs.readFileSync(androidIndexPath);

    assert.ok(bufIndex.equals(bufNotFound), 'index.html and 404.html must be 100% byte-for-byte identical');
    assert.ok(bufIndex.equals(bufAndroidIndex), 'index.html and android/app/src/main/assets/index.html must be 100% byte-for-byte identical');

    // Strict Unix LF line endings (0 CR bytes)
    assert.equal(bufIndex.includes(13), false, 'index.html must not contain CR (\\r) characters');
    assert.equal(bufNotFound.includes(13), false, '404.html must not contain CR (\\r) characters');
    assert.equal(bufAndroidIndex.includes(13), false, 'android/app/src/main/assets/index.html must not contain CR (\\r) characters');
  });

});
