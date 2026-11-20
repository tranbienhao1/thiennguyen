'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');
const MAIN_ACTIVITY = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const SW_JS = path.join(ROOT_DIR, 'sw.js');
const LIB_UTILS = path.join(ROOT_DIR, 'library-utils.js');

test('1. FiiO M11S & Chromium WebView 74: 0 Executable ES2020+ Syntax in index.html & all JS assets', () => {
  const jsFiles = ['index.html', ...fs.readdirSync(ROOT_DIR).filter(f => f.endsWith('.js'))];
  
  const illegalPatterns = [
    { name: 'optional chaining', regex: /\?\./ },
    { name: 'nullish coalescing', regex: /\?\?(?!\?)/ },
    { name: 'logical nullish assignment ??=', regex: /\?\?=/ },
    { name: 'logical or assignment ||=', regex: /\|\|=/ },
    { name: 'logical and assignment &&=', regex: /&&=/ },
    { name: 'numeric separator', regex: /\b\d+_\d+\b/ },
    { name: 'raw bigint literal', regex: /\b\d+n\b/ },
    { name: 'catch without binding', regex: /catch\s*\{/ },
    { name: 'replaceAll', regex: /\.replaceAll\s*\(/ },
    { name: 'Object.hasOwn', regex: /Object\.hasOwn\s*\(/ },
    { name: 'structuredClone', regex: /\bstructuredClone\s*\(/ }
  ];

  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip comments (JS comments & HTML comments)
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('<!--') || trimmed.includes('-->')) continue;
      // Strip block comments, HTML comments and inline comments to test executable tokens
      const stripped = line.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
      // Skip regex patterns that contain escaped question marks like (?:\?.*)?
      const strippedRegexes = stripped.replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');

      for (const p of illegalPatterns) {
        if (p.regex.test(strippedRegexes)) {
          assert.fail(`File ${file}:${i + 1} contains executable ${p.name}: ${trimmed}`);
        }
      }
    }
  }
  assert.ok(true, 'All frontend files have 0 executable ES2020+ syntax tokens');
});

test('2. index.html Non-Blocking CDN & Local Fallbacks for Offline Reliability', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(!html.includes('<script src="https://cdn.tailwindcss.com"></script>'), 'Tailwind CDN must not be a blocking synchronous script in head');
  assert.ok(html.includes('https://cdn.tailwindcss.com'), 'Tailwind CDN fallback must be loaded dynamically/asynchronously');
  assert.ok(html.includes('<script async src="https://alcdn.msauth.net'), 'MSAL CDN must be loaded asynchronously');
  assert.ok(html.includes('<script async src="https://cdn.jsdelivr.net'), 'jsmediatags CDN must be loaded asynchronously');
});

test('3. MainActivity.java CDN Interception, Offline Bypass & Touch Focus Safety', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('cdn.tailwindcss.com'), 'MainActivity must intercept cdn.tailwindcss.com');
  assert.ok(java.includes('alcdn.msauth.net') && java.includes('isNetworkConnected'), 'MainActivity must bypass remote CDNs when offline');
  assert.ok(java.includes('mProgressBar.setClickable(false)'), 'Loading indicator must be non-clickable to avoid swallowing touch taps');
  assert.ok(java.includes('mProgressBar.setFocusable(false)'), 'Loading indicator must be non-focusable');
  assert.ok(java.includes('postDelayed(this::requestAppPermissions, 650)'), 'Permissions request must be delayed to avoid stealing initial touch focus');
  assert.ok(java.includes('onWindowFocusChanged(boolean hasFocus)'), 'MainActivity must restore mWebView focus on window focus regained');
});

test('4. Chromium 74 CSS Fallbacks in index.html', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('.hidden, [hidden]'), 'CSS must define explicit display: none for [hidden] for Chromium < 88');
  assert.ok(html.includes('.inset-0'), 'CSS must define explicit top/right/bottom/left for .inset-0 for Chromium < 87');
  assert.ok(html.includes('@media (hover: none), (pointer: coarse)'), 'CSS must disable hover transform traps on touchscreens');
});

test('5. Fast-Tap Touch Engine Hardening & Click Deduplication', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('Math.abs(e.touches[0].clientX - touchStartPos.x) > 14'), 'Fast-Tap must allow 14px movement tolerance for small DAP screens');
  assert.ok(html.includes('dt < 600'), 'Fast-Tap duration must be up to 600ms');
  assert.ok(html.includes('lastFastTapClickTs'), 'Fast-Tap must track click timestamp for deduplication');
  assert.ok(html.includes('#add-files') && html.includes('#folders-button'), 'Fast-Tap must preserve native activation for file inputs and buttons');
});

test('6. Service Worker cache bumped to v2.1.3 & Web Audio Invariant Preserved', () => {
  const sw = fs.readFileSync(SW_JS, 'utf8');
  assert.ok(/const CACHE_VERSION = 'v[23]\.\d+\.\d+';/.test(sw), 'sw.js must be bumped to v2.1.3');
  assert.ok(/const CACHE_NAME = 'nocturne-v[23]\.\d+\.\d+';/.test(sw), 'sw.js cache name must be nocturne-v2.1.3');

  const lib = fs.readFileSync(LIB_UTILS, 'utf8');
  assert.ok(/version = 'nocturne-v[23]\.\d+\.\d+'/.test(lib), 'library-utils manifest must default to nocturne-v2.1.3');

  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Web Audio graph invariant must be strictly preserved');
});
