'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainActivityJava = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');

test('1. Local Stream URL Preservation: releaseUnusedLocalUrl does not wipe persistent local media URLs', () => {
  const inlineScripts = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1].trim()).filter(Boolean);
  const appCode = inlineScripts.join('\n');

  // Verify releaseUnusedLocalUrl guards against wiping non-blob URLs
  assert.ok(
    appCode.includes("if (!track.url.startsWith('blob:')) return;"),
    'releaseUnusedLocalUrl must only revoke temporary blob: URLs and preserve persistent local media streaming URLs'
  );
});

test('2. Self-signed SSL & HTTPS LAN Proxy in MainActivity.java', () => {
  // Check initTrustAllSsl existence
  assert.ok(
    mainActivityJava.includes('initTrustAllSsl'),
    'MainActivity must provide initTrustAllSsl for LAN servers'
  );

  // Check onReceivedSslError handles local / private network hosts
  assert.ok(
    mainActivityJava.includes('onReceivedSslError') && mainActivityJava.includes('handler.proceed()'),
    'MainActivity must proceed on SSL errors for private local networks (Jellyfin/Subsonic self-signed certs)'
  );

  // Check proxy handles both http and https
  assert.ok(
    mainActivityJava.includes('"http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)'),
    'MainActivity shouldInterceptRequest must intercept both http and https for private LAN servers'
  );

  // Check httpFetch sets SSL socket factory for HTTPS LAN connections
  assert.ok(
    mainActivityJava.includes('conn instanceof HttpsURLConnection && isLocalOrPrivateNetwork(url.getHost())'),
    'httpFetch must configure trust-all SSL for HttpsURLConnection to private LAN IPs'
  );
});

test('3. safeNativeFetch and Local Server Integration in index.html', () => {
  // Check safeNativeFetch is defined
  assert.ok(
    indexHtml.includes('async function safeNativeFetch('),
    'index.html must define safeNativeFetch to route calls through NocturneNative.httpFetch on Android'
  );

  // Check Subsonic and Jellyfin connect calls use safeNativeFetch
  assert.ok(
    indexHtml.includes('const pingRes = await safeNativeFetch(pingUrl)'),
    'connectSubsonicServer must use safeNativeFetch for ping.view'
  );
  assert.ok(
    indexHtml.includes('const res = await safeNativeFetch(queryUrl, { headers })'),
    'connectJellyfinServer must use safeNativeFetch for Items query'
  );
});

test('4. Google Drive & OneDrive Direct Token Inputs & Clipboard Paste', () => {
  // Verify UI elements exist
  assert.ok(indexHtml.includes('id="google-token-direct"'), 'google-token-direct input must exist in index.html');
  assert.ok(indexHtml.includes('id="google-paste-btn"'), 'google-paste-btn must exist in index.html');
  assert.ok(indexHtml.includes('id="microsoft-token-direct"'), 'microsoft-token-direct input must exist in index.html');
  assert.ok(indexHtml.includes('id="microsoft-paste-btn"'), 'microsoft-paste-btn must exist in index.html');

  // Verify event listeners
  assert.ok(indexHtml.includes("$('google-paste-btn')"), 'google-paste-btn listener must be wired');
  assert.ok(indexHtml.includes("$('microsoft-paste-btn')"), 'microsoft-paste-btn listener must be wired');
});

test('5. Crossfade Default & Chromium setValueCurveAtTime Fallback Protection', () => {
  // Check crossfade fallback in applyCrossfade
  assert.ok(
    indexHtml.includes('catch (errCurve)') || indexHtml.includes('linearRampToValueAtTime'),
    'applyCrossfade must have fallback error handling around setValueCurveAtTime for Chromium robustness'
  );

  // Check crossfade initialization and Android default restoration
  assert.ok(
    indexHtml.includes("const savedCrossfade = library.clampCrossfadeSeconds(localStorage.getItem('nocturne-crossfade-seconds')"),
    'state.crossfadeSeconds must be restored on startup from localStorage with DAP fallback'
  );

  // Bất biến Web Audio Graph
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'STRICT INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) MUST NOT BE BROKEN'
  );
});
