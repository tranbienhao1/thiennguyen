'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const library = require('../library-utils.js');
const swCode = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
const libraryCode = fs.readFileSync(path.join(rootDir, 'library-utils.js'), 'utf8');

test('Code Audit & Cloud Auth Upgrades Verification Suite (v2.6.9)', async (t) => {

  await t.test('1. sw.js cache version bumped to v2.6.9 and invalidates stale caches on activate', async () => {
    assert.ok(/v2\.[1-9]\.\d+/.test(swCode), 'sw.js must include version string v2.6.9');
    assert.ok(swCode.includes("CACHE_NAME = 'nocturne-v2.6.9'"), 'sw.js must set CACHE_NAME to nocturne-v2.6.9');

    const listeners = {};
    const cacheStore = new Map([
      ['nocturne-v0', new Map()],
      ['nocturne-v2', new Map()],
      ['nocturne-v3', new Map()],
      ['nocturne-v2.0.7', new Map()],
      ['nocturne-v2.0.9', new Map()],
      ['nocturne-v2.1.0', new Map()],
      ['nocturne-v2.1.1', new Map()],
      ['nocturne-v2.1.2', new Map()],
    ]);
    const cachesStub = {
      open: async (name) => {
        if (!cacheStore.has(name)) {
          cacheStore.set(name, {
            keys: async () => [],
            delete: async () => true,
            add: async () => {},
            put: async () => {},
          });
        }
        return cacheStore.get(name);
      },
      keys: async () => [...cacheStore.keys()],
      delete: async (name) => cacheStore.delete(name),
    };
    const sandbox = {
      self: {
        location: new URL('https://tranbienhao1.github.io/thiennguyen/sw.js'),
        addEventListener: (type, handler) => { listeners[type] = handler; },
        skipWaiting: () => {},
        clients: { claim: () => { sandbox.self.claimed = true; } },
      },
      caches: cachesStub,
      fetch: async () => ({ ok: true, clone() { return this; } }),
      URL,
    };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox, { filename: 'sw.js' });

    assert.equal(sandbox.self.CACHE_NAME, 'nocturne-v2.6.9', 'self.CACHE_NAME must be nocturne-v2.6.9');
    assert.equal(sandbox.self.CACHE_VERSION, 'v2.6.9', 'self.CACHE_VERSION must be v2.6.9');

    let settledPromise;
    listeners.activate({ waitUntil(p) { settledPromise = p; } });
    await settledPromise;

    assert.equal(cacheStore.has('nocturne-v2.1.2'), false, 'Stale nocturne-v2.1.2 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2.1.1'), false, 'Stale nocturne-v2.1.1 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2.1.0'), false, 'Stale nocturne-v2.1.0 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2.0.9'), false, 'Stale nocturne-v2.0.9 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2.0.7'), false, 'Stale nocturne-v2.0.7 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v3'), false, 'Stale nocturne-v3 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2'), false, 'Stale nocturne-v2 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v0'), false, 'Stale nocturne-v0 cache must be purged on activate');
    assert.equal(cacheStore.has('nocturne-v2.6.9'), true, 'Active nocturne-v2.6.9 cache must be opened');
    assert.equal(sandbox.self.claimed, true, 'Service worker must claim clients on activate');
  });

  await t.test('2. parseCloudAuthTokenInput extracts tokens from raw, Bearer, URL/hash, and JSON formats', () => {
    assert.equal(typeof library.parseCloudAuthTokenInput, 'function', 'parseCloudAuthTokenInput must be exported');

    // 2.1 Empty / invalid inputs
    const empty1 = library.parseCloudAuthTokenInput('');
    assert.deepEqual(empty1, {
      token: '',
      expiresInSeconds: 3600,
      sourceFormat: 'empty',
      isValidFormat: false
    });
    assert.equal(library.parseCloudAuthTokenInput(null).sourceFormat, 'empty');
    assert.equal(library.parseCloudAuthTokenInput('   ""   ').sourceFormat, 'empty');

    // 2.2 Raw tokens (Google ya29..., Microsoft EwB..., JWT eyJ...)
    const googleRaw = library.parseCloudAuthTokenInput('  ya29.a0AfH6SMB_example_token_12345  ', 'google');
    assert.equal(googleRaw.token, 'ya29.a0AfH6SMB_example_token_12345');
    assert.equal(googleRaw.expiresInSeconds, 3600);
    assert.equal(googleRaw.sourceFormat, 'raw');
    assert.equal(googleRaw.isValidFormat, true);

    const msRaw = library.parseCloudAuthTokenInput('"EwB4A8l6BAAU_ms_graph_token"', 'microsoft');
    assert.equal(msRaw.token, 'EwB4A8l6BAAU_ms_graph_token');
    assert.equal(msRaw.sourceFormat, 'raw');
    assert.equal(msRaw.isValidFormat, true);

    const jwtRaw = library.parseCloudAuthTokenInput('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig');
    assert.equal(jwtRaw.sourceFormat, 'raw');
    assert.equal(jwtRaw.isValidFormat, true);

    // 2.3 Bearer prefix (case-insensitive + quotes)
    const bearer1 = library.parseCloudAuthTokenInput('Bearer ya29.test_bearer_token');
    assert.equal(bearer1.token, 'ya29.test_bearer_token');
    assert.equal(bearer1.sourceFormat, 'bearer');
    assert.equal(bearer1.isValidFormat, true);

    const bearer2 = library.parseCloudAuthTokenInput('  "bearer   EwB.ms_token_99"  ');
    assert.equal(bearer2.token, 'EwB.ms_token_99');
    assert.equal(bearer2.sourceFormat, 'bearer');
    assert.equal(bearer2.isValidFormat, true);

    // 2.4 OAuth redirect URL & hash fragment
    const urlHash = library.parseCloudAuthTokenInput(
      'https://developers.google.com/oauthplayground/#access_token= XYZ &token_type=Bearer&expires_in=3599'
    );
    assert.deepEqual(urlHash, {
      token: 'XYZ',
      expiresInSeconds: 3599,
      sourceFormat: 'url',
      isValidFormat: true
    });

    const urlQuery = library.parseCloudAuthTokenInput(
      'https://localhost:8080/callback?access_token=ya29.uri%2Bdecoded_token&expires_in=1800&scope=drive.readonly'
    );
    assert.equal(urlQuery.token, 'ya29.uri+decoded_token');
    assert.equal(urlQuery.expiresInSeconds, 1800);
    assert.equal(urlQuery.sourceFormat, 'url');
    assert.equal(urlQuery.isValidFormat, true);

    const urlError = library.parseCloudAuthTokenInput('https://localhost:8080/callback#error=access_denied');
    assert.equal(urlError.sourceFormat, 'url');
    assert.equal(urlError.isValidFormat, false);
    assert.equal(urlError.token, '');

    // 2.5 JSON object & snippet
    const jsonFull = library.parseCloudAuthTokenInput('{"access_token": "XYZ", "expires_in": 3600}');
    assert.deepEqual(jsonFull, {
      token: 'XYZ',
      expiresInSeconds: 3600,
      sourceFormat: 'json',
      isValidFormat: true
    });

    const jsonSnippet = library.parseCloudAuthTokenInput('"access_token": "ya29.from_snippet", "expires_in": 3590,');
    assert.equal(jsonSnippet.token, 'ya29.from_snippet');
    assert.equal(jsonSnippet.expiresInSeconds, 3590);
    assert.equal(jsonSnippet.sourceFormat, 'json');
    assert.equal(jsonSnippet.isValidFormat, true);

    const jsonError = library.parseCloudAuthTokenInput('{"error": "invalid_client"}');
    assert.equal(jsonError.sourceFormat, 'json');
    assert.equal(jsonError.isValidFormat, false);
    assert.equal(jsonError.token, '');
  });

  await t.test('3. diagnoseCloudAuthError classifies all Google Drive and OneDrive OAuth error modes in Vietnamese', () => {
    assert.equal(typeof library.diagnoseCloudAuthError, 'function', 'diagnoseCloudAuthError must be exported');

    // 3.1 testing_or_access_denied
    const testingDiag = library.diagnoseCloudAuthError(
      'google',
      'Error 403: access_denied. The app has not completed the Google verification process.'
    );
    assert.equal(testingDiag.code, 'testing_or_access_denied');
    assert.ok(testingDiag.reasonVi.includes('Testing') && testingDiag.reasonVi.includes('In Production'));
    assert.ok(testingDiag.actionVi.includes('Test Users') || testingDiag.actionVi.includes('Dán Token Siêu Tốc'));
    assert.equal(testingDiag.recommendFastToken, true);

    // 3.2 webview_disallowed (via error string or env.isNativeAndroid)
    const webviewByMsg = library.diagnoseCloudAuthError('google', 'Error 403: disallowed_useragent');
    assert.equal(webviewByMsg.code, 'webview_disallowed');
    assert.ok(webviewByMsg.reasonVi.includes('WebView'));
    assert.equal(webviewByMsg.recommendFastToken, true);

    const webviewByEnv = library.diagnoseCloudAuthError('microsoft', new Error('OAuth failed'), { isNativeAndroid: true });
    assert.equal(webviewByEnv.code, 'webview_disallowed');
    assert.equal(webviewByEnv.recommendFastToken, true);

    // 3.3 origin_or_redirect_mismatch
    const originDiag = library.diagnoseCloudAuthError('google', 'Error 400: origin_mismatch / redirect_uri_mismatch');
    assert.equal(originDiag.code, 'origin_or_redirect_mismatch');
    assert.ok(originDiag.reasonVi.includes('Authorized JavaScript Origins') || originDiag.reasonVi.includes('Redirect URI'));
    assert.equal(originDiag.recommendFastToken, true);

    const aadRedirect = library.diagnoseCloudAuthError('microsoft', { errorCode: 'invalid_request', errorMessage: 'AADSTS50011: The redirect URI specified in the request does not match' });
    assert.equal(aadRedirect.code, 'origin_or_redirect_mismatch');

    // 3.4 unauthorized_consumer_client
    const consumerDiag = library.diagnoseCloudAuthError(
      'microsoft',
      'unauthorized_client: The client does not exist or is not enabled for consumers. AADSTS700016'
    );
    assert.equal(consumerDiag.code, 'unauthorized_consumer_client');
    assert.ok(consumerDiag.actionVi.includes('Graph Explorer') || consumerDiag.actionVi.includes('OAuth Playground'));
    assert.ok(consumerDiag.actionVi.includes('Client ID'));
    assert.equal(consumerDiag.recommendFastToken, true);

    const invalidClientDiag = library.diagnoseCloudAuthError('google', 'Error 401: invalid_client - The OAuth client was not found.');
    assert.equal(invalidClientDiag.code, 'unauthorized_consumer_client');

    // 3.5 popup_blocked
    const popupDiag = library.diagnoseCloudAuthError('microsoft', { errorCode: 'popup_window_error', message: 'Popup blocked by browser' });
    assert.equal(popupDiag.code, 'popup_blocked');
    assert.ok(popupDiag.reasonVi.toLowerCase().includes('popup'));
    assert.equal(popupDiag.recommendFastToken, true);

    const cancelledDiag = library.diagnoseCloudAuthError('microsoft', 'user_cancelled');
    assert.equal(cancelledDiag.code, 'popup_blocked');

    // 3.6 insecure_context
    const insecureDiag = library.diagnoseCloudAuthError('microsoft', 'crypto.subtle unavailable', { isSecureContext: false });
    assert.equal(insecureDiag.code, 'insecure_context');
    assert.ok(insecureDiag.reasonVi.includes('HTTP') || insecureDiag.actionVi.includes('HTTPS'));
    assert.ok(insecureDiag.actionVi.includes('localhost'));
    assert.equal(insecureDiag.recommendFastToken, true);

    // 3.7 generic fallback
    const genericDiag = library.diagnoseCloudAuthError('google', 'Network timeout while contacting accounts.google.com');
    assert.equal(genericDiag.code, 'generic');
    assert.ok(genericDiag.actionVi.includes('Dán Token Siêu Tốc'));
    assert.equal(genericDiag.recommendFastToken, true);
  });

  await t.test('4. Browser UMD attaches parseCloudAuthTokenInput and diagnoseCloudAuthError to window.library and window.NocturneLibrary', () => {
    const winSandbox = { library: { existingHelper: true } };
    vm.createContext(winSandbox);
    vm.runInContext(libraryCode, winSandbox, { filename: 'library-utils.js' });

    assert.equal(typeof winSandbox.NocturneLibrary.parseCloudAuthTokenInput, 'function');
    assert.equal(typeof winSandbox.NocturneLibrary.diagnoseCloudAuthError, 'function');
    assert.equal(typeof winSandbox.library.parseCloudAuthTokenInput, 'function');
    assert.equal(typeof winSandbox.library.diagnoseCloudAuthError, 'function');
    assert.equal(winSandbox.library.existingHelper, true, 'Merges cleanly into pre-existing window.library object');
  });

});
