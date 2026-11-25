'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const DEFAULT_E2E_PATH = 'C:\\Users\\thien\\.gemini\\antigravity\\brain\\7f662af1-69d0-48ce-a25e-4f41c5fcd848\\scratch\\live-chrome-play-pause-test.cjs';
const E2E_PATH = process.env.NOCTURNE_E2E_PATH || DEFAULT_E2E_PATH;

const htmlBuf = fs.readFileSync(path.join(ROOT, 'index.html'));
const html404Buf = fs.readFileSync(path.join(ROOT, '404.html'));
const swBuf = fs.readFileSync(path.join(ROOT, 'sw.js'));
const gradleBuf = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'));
const manifestBuf = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'));
const mainJavaBuf = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'));
const serviceJavaBuf = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'NocturnePlaybackService.java'));
const virtualScrollBuf = fs.readFileSync(path.join(ROOT, 'virtual-scroll.js'));
const releaseBuf = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'));

const html = htmlBuf.toString('utf8');
const sw = swBuf.toString('utf8');
const gradle = gradleBuf.toString('utf8');
const manifest = manifestBuf.toString('utf8');
const mainJava = mainJavaBuf.toString('utf8');
const serviceJava = serviceJavaBuf.toString('utf8');
const virtualScroll = virtualScrollBuf.toString('utf8');
const releaseScript = releaseBuf.toString('utf8');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function semverTuple(v) {
  return String(v).split('.').map(n => parseInt(n, 10) || 0);
}

function geq(a, b) {
  const ta = semverTuple(a);
  const tb = semverTuple(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const da = ta[i] || 0;
    const db = tb[i] || 0;
    if (da !== db) return da > db;
  }
  return true;
}

describe('v3.9.104 R3 & R4 — ES2019 Compat, Android API 26–35+ Parity, Chrome E2E Group M & Release Hygiene', () => {
  it('1. [Preserved] ES2019 (Chromium 74) compatibility: scan_es2020.cjs <= 13 baseline hits, 0 hits in library-utils.js & virtual-scroll.js', () => {
    const scanOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'scan_es2020.cjs')], { encoding: 'utf8' });
    const mHits = scanOut.match(/Total hits across all files:\s*(\d+)/);
    assert.ok(mHits && Number(mHits[1]) <= 13, `Expected <= 13 ES2020 scanner hits, got:\n${scanOut}`);
    assert.equal(scanOut.includes('library-utils.js'), false, 'library-utils.js must have 0 ES2020 hits');
    assert.equal(scanOut.includes('virtual-scroll.js'), false, 'virtual-scroll.js must have 0 ES2020 hits');
  });

  it('2. [Preserved] Android Old (API 26–30 / FiiO M11S / Chromium 74 CSS) & New (API 31–35+) parity across build.gradle.kts, AndroidManifest.xml, MainActivity.java & NocturnePlaybackService.java', () => {
    assert.match(gradle, /^\s*compileSdk = 35\b/m);
    assert.match(gradle, /^\s*minSdk = 26\b/m);
    assert.match(gradle, /^\s*targetSdk = 35\b/m);

    assert.ok(manifest.includes('android.permission.WAKE_LOCK'));
    assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE'));
    assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'));
    assert.ok(manifest.includes('android.permission.READ_MEDIA_AUDIO'));
    assert.ok(manifest.includes('android.permission.READ_EXTERNAL_STORAGE') && manifest.includes('maxSdkVersion="32"'));
    assert.ok(manifest.includes('android.permission.WRITE_EXTERNAL_STORAGE') && manifest.includes('maxSdkVersion="29"'));
    assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'));
    assert.ok(manifest.includes('android:requestLegacyExternalStorage="true"'));
    assert.ok(manifest.includes('android:foregroundServiceType="mediaPlayback"'));

    assert.ok(mainJava.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.S') && mainJava.includes('PendingIntent.FLAG_MUTABLE'));
    assert.ok(mainJava.includes('Build.VERSION.SDK_INT >= 33') && serviceJava.includes('Build.VERSION.SDK_INT >= 33'));
    assert.ok(mainJava.includes('RECEIVER_NOT_EXPORTED'));
    assert.ok(serviceJava.includes('ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK'));
    assert.ok(virtualScroll.includes('getScrollTarget'));

    const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
    const dvhMatches = [...styleBlocks.matchAll(/[^;{}]*\d+dvh[^;{}]*/g)];
    assert.ok(dvhMatches.length >= 10, 'Expected dvh viewport rules in index.html');
    for (const m of dvhMatches) {
      const idx = m.index;
      const blockStart = styleBlocks.lastIndexOf('{', idx);
      assert.ok(/\d+vh\b/.test(styleBlocks.slice(blockStart, idx)), `Missing vh fallback before: ${m[0].trim()}`);
    }
  });

  it('3. [R3-Contract] Live Chrome CDP E2E (live-chrome-play-pause-test.cjs) passes node --check, is LF-only (0 CR), and includes Group M (M-1, M-2, M-3) before errors.length === 0', () => {
    assert.ok(fs.existsSync(E2E_PATH), `E2E script not found at ${E2E_PATH}`);
    execFileSync(process.execPath, ['--check', E2E_PATH], { stdio: 'pipe' });
    const e2eBuf = fs.readFileSync(E2E_PATH);
    assert.equal(e2eBuf.includes(13), false, 'live-chrome-play-pause-test.cjs must be LF-only (0 CR bytes)');
    const e2eSrc = e2eBuf.toString('utf8');

    const groupMIdx = e2eSrc.indexOf('Group M');
    const errAssertIdx = e2eSrc.lastIndexOf('assertCheck(errors.length === 0');
    assert.ok(groupMIdx !== -1 && errAssertIdx !== -1 && groupMIdx < errAssertIdx, 'Group M must execute before assertCheck(errors.length === 0)');
    assert.ok(e2eSrc.includes('Group M-1') && /Nocturne Suite\/CD 1/.test(e2eSrc) && /Disc B/.test(e2eSrc), 'Group M-1 multi-disc merge assertions required');
    assert.ok(e2eSrc.includes('Group M-2') && e2eSrc.includes('replaygain-toggle') && e2eSrc.includes('bitperfect-mode-toggle'), 'Group M-2 ReplayGain & Bit-Perfect Deck A/B assertions required');
    assert.ok(e2eSrc.includes('Group M-3') && e2eSrc.includes('album-hero-m3u8') && e2eSrc.includes('playlist-import-file'), 'Group M-3 M3U8 export/import round-trip assertions required');
  });

  it('4. [R4-Contract] Monotonic version alignment at >= v3.9.104 (versionCode >= 158), // History: preserved in sw.js & build.gradle.kts, publish-release.cjs valid', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mJavaVer = mainJava.match(/getAppBuildInfoJson\(\)[\s\S]*?:\s*"(\d+\.\d+\.\d+)"/);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mJavaVer && mRelTag && mRelCode, 'All version markers must be present');
    const ver = mHtml[1];
    assert.equal(geq(ver, '3.9.104'), true, `index.html #fiio-dap-badge must be >= v3.9.104 (got ${ver})`);
    assert.equal(mSwVer[1], ver, 'sw.js CACHE_VERSION must match index.html version');
    assert.equal(mSwName[1], ver, 'sw.js CACHE_NAME must match index.html version');
    assert.equal(Number(mGCode[1]) >= 158, true, `build.gradle.kts versionCode must be >= 158 (got ${mGCode[1]})`);
    assert.equal(mGName[1], ver, 'build.gradle.kts versionName must match index.html version');
    assert.equal(mJavaVer[1], ver, 'MainActivity.java fallback versionName must match index.html version');
    assert.equal(mRelTag[1], ver, '.agent/publish-release.cjs default tag must match index.html version');
    assert.equal(Number(mRelCode[1]), Number(mGCode[1]), '.agent/publish-release.cjs versionCode must match build.gradle.kts');

    // Preserve // History: lines
    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine.includes("const CACHE_VERSION = 'v3.9.103';") && cacheVerLine.includes("const CACHE_VERSION = 'v3.1.1';"), 'sw.js CACHE_VERSION // History: must be preserved');
    assert.ok(cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.9.103';") && cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.1.1';"), 'sw.js CACHE_NAME // History: must be preserved');

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine.includes('versionCode = 157') && vcLine.includes('versionCode = 15'), 'build.gradle.kts versionCode // History: must be preserved');
    assert.ok(vnLine.includes('versionName = "3.9.103"') && vnLine.includes('versionName = "2.0.5"'), 'build.gradle.kts versionName // History: must be preserved');

    // publish-release.cjs syntax + vm.Script + rendered release body
    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));

    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\r?\n\s*const headers/);
    assert.ok(mBody, 'publish-release.cjs must define name and body templates');
    const tag = `v${mRelTag[1]}`;
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });
    assert.ok(renderedName.includes(tag));
    assert.ok(renderedBody.includes(`Nocturne ${tag} (versionCode ${mRelCode[1]})`));
    assert.ok(/API 26[–-]30/.test(renderedBody) && /API 31[–-]35\+/.test(renderedBody));
    assert.ok(renderedBody.includes('- **Nocturne-Android.apk**'));
  });

  it('5. [R4-Contract] Synced asset parity: 0 CR bytes and exact SHA-256 parity across index.html, 404.html, tailwind.min.css, and android/app/src/main/assets/*', () => {
    assert.equal(htmlBuf.includes(13), false, 'index.html must have 0 CR bytes');
    assert.equal(html404Buf.includes(13), false, '404.html must have 0 CR bytes');
    assert.equal(Buffer.compare(htmlBuf, html404Buf), 0, '404.html must match index.html byte-for-byte');

    const rootJsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();
    for (const rel of ['index.html', 'tailwind.min.css', ...rootJsFiles]) {
      const rBuf = fs.readFileSync(path.join(ROOT, rel));
      const aBuf = fs.readFileSync(path.join(ASSETS_DIR, rel));
      assert.equal(rBuf.includes(13), false, `${rel} must have 0 CR bytes`);
      assert.equal(aBuf.includes(13), false, `assets/${rel} must have 0 CR bytes`);
      assert.equal(sha256(rBuf), sha256(aBuf), `assets/${rel} SHA-256 parity`);
    }
  });
});
