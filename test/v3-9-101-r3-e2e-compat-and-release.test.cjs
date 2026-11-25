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

describe('v3.9.101 R3 & R4: Chrome CDP E2E (Groups H-J), Version Alignment, Asset Parity, ES2019 & Old/New Android Compat', () => {
  it('1. Version strings across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at >= v3.9.101 (versionCode >= 155) with // History: preserved', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag && mRelCode, 'All version markers must be present');
    const ver = mHtml[1];
    assert.equal(geq(ver, '3.9.101'), true, `index.html #fiio-dap-badge must be >= v3.9.101 (got ${ver})`);
    assert.equal(mSwVer[1], ver);
    assert.equal(mSwName[1], ver);
    assert.equal(Number(mGCode[1]) >= 155, true, `build.gradle.kts versionCode must be >= 155 (got ${mGCode[1]})`);
    assert.equal(mGName[1], ver);
    assert.equal(mRelTag[1], ver);
    assert.equal(Number(mRelCode[1]), Number(mGCode[1]));

    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine.includes("const CACHE_VERSION = 'v3.9.100';") && cacheVerLine.includes("const CACHE_VERSION = 'v3.1.1';"));
    assert.ok(cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.9.100';") && cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.1.1';"));

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine.includes('versionCode = 154') && vcLine.includes('versionCode = 15'));
    assert.ok(vnLine.includes('versionName = "3.9.100"') && vnLine.includes('versionName = "2.0.5"'));
  });

  it('2. .agent/publish-release.cjs passes node --check, compiles via vm.Script, and renders valid v3.9.101 release notes', () => {
    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));

    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\n\n\s*const headers/);
    assert.ok(mBody);
    const tag = 'v3.9.101';
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });
    assert.ok(renderedName.includes('v3.9.101'));
    assert.ok(renderedBody.includes('Nocturne v3.9.101 (versionCode 155)'));
    assert.ok(renderedBody.includes('MEDIA_BUTTON') && renderedBody.includes('DocumentsContract'));
    assert.ok(renderedBody.includes('API 26–30') && renderedBody.includes('API 31–35+'));
    assert.ok(renderedBody.includes('- **Nocturne-Android.apk**'));
  });

  it('3. All synced files, 404.html & android/app/src/main/assets/* have 0 CR bytes and SHA-256 parity; ES2020+ scan has <= 13 hits', () => {
    assert.equal(htmlBuf.includes(13), false);
    assert.equal(html404Buf.includes(13), false);
    assert.equal(Buffer.compare(htmlBuf, html404Buf), 0);

    const rootJsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();
    for (const rel of ['index.html', 'tailwind.min.css', ...rootJsFiles]) {
      const rBuf = fs.readFileSync(path.join(ROOT, rel));
      const aBuf = fs.readFileSync(path.join(ASSETS_DIR, rel));
      assert.equal(rBuf.includes(13), false, `${rel} must have 0 CR bytes`);
      assert.equal(aBuf.includes(13), false, `assets/${rel} must have 0 CR bytes`);
      assert.equal(sha256(rBuf), sha256(aBuf), `assets/${rel} SHA-256 parity`);
    }

    const scanOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'scan_es2020.cjs')], { encoding: 'utf8' });
    const mHits = scanOut.match(/Total hits across all files:\s*(\d+)/);
    assert.ok(mHits && Number(mHits[1]) <= 13, `Expected <= 13 ES2020 scanner hits, got:\n${scanOut}`);
    assert.equal(scanOut.includes('library-utils.js'), false, 'library-utils.js must have 0 ES2020 hits');
    assert.equal(scanOut.includes('virtual-scroll.js'), false, 'virtual-scroll.js must have 0 ES2020 hits');
  });

  it('4. Old (API 26-30 / Chromium 74 CSS & ES2019) and New (API 31-35+) compatibility contracts remain intact', () => {
    assert.match(gradle, /^\s*compileSdk = 35\b/m);
    assert.match(gradle, /^\s*minSdk = 26\b/m);
    assert.match(gradle, /^\s*targetSdk = 35\b/m);
    assert.ok(manifest.includes('android.permission.READ_MEDIA_AUDIO'));
    assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'));
    assert.ok(manifest.includes('android:requestLegacyExternalStorage="true"'));
    assert.ok(manifest.includes('android:foregroundServiceType="mediaPlayback"'));
    assert.ok(mainJava.includes('Build.VERSION.SDK_INT >= Build.VERSION_CODES.S') && mainJava.includes('PendingIntent.FLAG_MUTABLE'));
    assert.ok(mainJava.includes('Build.VERSION.SDK_INT >= 33') && serviceJava.includes('Build.VERSION.SDK_INT >= 33'));
    assert.ok(virtualScroll.includes('getScrollTarget'));
    const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
    const dvhMatches = [...styleBlocks.matchAll(/[^;{}]*\d+dvh[^;{}]*/g)];
    assert.ok(dvhMatches.length >= 10);
    for (const m of dvhMatches) {
      const idx = m.index;
      const blockStart = styleBlocks.lastIndexOf('{', idx);
      assert.ok(/\d+vh\b/.test(styleBlocks.slice(blockStart, idx)), `Missing vh fallback before: ${m[0].trim()}`);
    }
  });

  it('5. live-chrome-play-pause-test.cjs passes node --check, is LF-only, and includes Groups H, I, and J assertions', () => {
    assert.ok(fs.existsSync(E2E_PATH), `E2E script not found at ${E2E_PATH}`);
    execFileSync(process.execPath, ['--check', E2E_PATH], { stdio: 'pipe' });
    const e2eBuf = fs.readFileSync(E2E_PATH);
    assert.equal(e2eBuf.includes(13), false, 'live-chrome-play-pause-test.cjs must be LF-only (0 CR bytes)');
    const e2eSrc = e2eBuf.toString('utf8');

    assert.ok(e2eSrc.includes('// Group H —') && e2eSrc.includes('Run #88 Group H:'), 'Group H multi-source queue handoff required');
    assert.ok(e2eSrc.includes('// Group I —') && e2eSrc.includes('Run #88 Group I:'), 'Group I AudioFocus/becoming-noisy recovery required');
    assert.ok(e2eSrc.includes('// Group J —') && e2eSrc.includes('Run #88 Group J:'), 'Group J metadata/cover/.lrc move/rename delta reconciliation required');
  });
});
