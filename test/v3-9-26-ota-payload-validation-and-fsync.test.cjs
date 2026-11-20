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

test('1. OTA rejects HTML/captive-portal payloads for every .js/.css asset before staging', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('static boolean isPlausibleOtaPayload(String relFile, byte[] data) {'));
  assert.ok(java.includes('if (!isPlausibleOtaPayload(relFile, data)) {'));
  assert.ok(java.indexOf('if (!isPlausibleOtaPayload(relFile, data)) {') < java.indexOf('File outFile = new File(stagingDir, relFile);'), 'payload check must run before writing to staging');
  assert.ok(java.includes("data[i] == '<'"), 'must reject payloads starting with <');
  assert.ok(java.includes('(data[0] & 0xFF) == 0xEF'), 'must tolerate a UTF-8 BOM before inspecting the first character');
});

test('2. OTA fsyncs staged files and always removes partial staging on failure', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const syncCount = (java.match(/fos\.getFD\(\)\.sync\(\)/g) || []).length;
  assert.ok(syncCount >= 2, 'both asset files and .ota_ready must be fsynced');
  const catchIdx = java.indexOf('OTA background check failed:');
  assert.ok(catchIdx > 0);
  assert.ok(java.slice(catchIdx, catchIdx + 400).includes('deleteDirRecursive(new File(getOtaRootDir(), "staging"))'), 'catch must clean staging');
});

test('3. OTA_FILES still covers every APP_SHELL script/stylesheet (parity guard)', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const shell = sw.slice(sw.indexOf('const APP_SHELL = ['), sw.indexOf('];', sw.indexOf('const APP_SHELL = [')));
  const files = (shell.match(/'([^']+\.(?:js|css|html))'/g) || []).map(s => s.replace(/'/g, ''));
  assert.ok(files.length >= 14);
  for (const f of files) assert.ok(java.includes('"' + f + '"'), 'OTA_FILES missing ' + f);
});

test('4. Version sync v3.9.26 (versionCode 80), Unix LF asset parity, and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.26';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.26';"));
  assert.ok(gradle.includes('versionCode = 80'));
  assert.ok(gradle.includes('versionName = "3.9.26"'));
  assert.ok(/:\s*"3\.9\.26";/.test(java));
  assert.ok(html.includes('FiiO M11S \u00b7 v3.9.26'));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});