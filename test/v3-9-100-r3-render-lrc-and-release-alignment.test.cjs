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
const releaseBuf = fs.readFileSync(path.join(ROOT, '.agent', 'publish-release.cjs'));

const html = htmlBuf.toString('utf8');
const sw = swBuf.toString('utf8');
const gradle = gradleBuf.toString('utf8');
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

describe('v3.9.100 R3 & R4: Render-Recovery + .lrc Persistence, Live Chrome CDP E2E (Groups E-G), Version Alignment, Asset Parity & ES2019', () => {
  it('1. Version strings across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at >= v3.9.100 (versionCode >= 154) with // History: preserved', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag && mRelCode, 'All version markers must be present');
    const ver = mHtml[1];
    assert.equal(geq(ver, '3.9.100'), true, `index.html #fiio-dap-badge must be >= v3.9.100 (got ${ver})`);
    assert.equal(mSwVer[1], ver, `sw.js CACHE_VERSION must match v${ver}`);
    assert.equal(mSwName[1], ver, `sw.js CACHE_NAME must match nocturne-v${ver}`);
    assert.equal(Number(mGCode[1]) >= 154, true, `build.gradle.kts versionCode must be >= 154 (got ${mGCode[1]})`);
    assert.equal(mGName[1], ver, `build.gradle.kts versionName must match ${ver}`);
    assert.equal(mRelTag[1], ver, `publish-release.cjs default tag must match v${ver}`);
    assert.equal(Number(mRelCode[1]), Number(mGCode[1]), 'publish-release.cjs versionCode must match build.gradle.kts');

    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine.includes("const CACHE_VERSION = 'v3.9.99';") && cacheVerLine.includes("const CACHE_VERSION = 'v3.1.1';"));
    assert.ok(cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.9.99';") && cacheNameLine.includes("const CACHE_NAME = 'nocturne-v3.1.1';"));

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine.includes('versionCode = 153') && vcLine.includes('versionCode = 15'));
    assert.ok(vnLine.includes('versionName = "3.9.99"') && vnLine.includes('versionName = "2.0.5"'));
  });

  it('2. .agent/publish-release.cjs passes node --check, compiles cleanly, and renders >= v3.9.100 release notes', () => {
    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));

    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);
    assert.ok(mRelTag && mRelCode);
    assert.equal(geq(mRelTag[1], '3.9.100'), true);
    assert.equal(Number(mRelCode[1]) >= 154, true);

    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\n\n\s*const headers/);
    assert.ok(mBody);
    const tag = `v${mRelTag[1]}`;
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });
    assert.ok(renderedName.includes(tag));
    assert.ok(renderedBody.includes(`Nocturne ${tag} (versionCode ${mRelCode[1]})`));
    assert.ok(renderedBody.includes('API 26–30') && renderedBody.includes('API 31–35+'));
  });

  it('3. All synced files, 404.html & android/app/src/main/assets/* have 0 CR bytes and SHA-256 parity; ES2020+ scan has only 13 baseline hits', () => {
    assert.equal(htmlBuf.includes(13), false);
    assert.equal(html404Buf.includes(13), false);
    assert.equal(sha256(htmlBuf), sha256(html404Buf));
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
    assert.ok(scanOut.includes('Total hits across all files: 13'), `Expected 13 baseline ES2020 scanner hits, got:\n${scanOut}`);
  });

  it('4. live-chrome-play-pause-test.cjs passes node --check, is LF-only, and includes Groups E, F, and G assertions', () => {
    assert.ok(fs.existsSync(E2E_PATH), `E2E script not found at ${E2E_PATH}`);
    execFileSync(process.execPath, ['--check', E2E_PATH], { stdio: 'pipe' });
    const e2eBuf = fs.readFileSync(E2E_PATH);
    assert.equal(e2eBuf.includes(13), false, 'live-chrome-play-pause-test.cjs must be LF-only (0 CR bytes)');
    const e2eSrc = e2eBuf.toString('utf8');

    assert.ok(e2eSrc.includes('// Group E —') && e2eSrc.includes('Run #87 Group E:'), 'Group E bridge/viewport parity checks required');
    assert.ok(e2eSrc.includes('// Group F —') && e2eSrc.includes('Run #87 Group F:'), 'Group F overlapping crossfade checks required');
    assert.ok(e2eSrc.includes('// Group G —') && e2eSrc.includes('Run #87 Group G:'), 'Group G render-recovery queue + .lrc persistence checks required');
    assert.ok(e2eSrc.includes('Emulation.setDeviceMetricsOverride'), 'Group E must use CDP viewport emulation');
    assert.ok(e2eSrc.includes('setValueCurveAtTime'), 'Group F must spy on setValueCurveAtTime');
    assert.ok(e2eSrc.includes('Persisted Recovery Line One'), 'Group G must assert persisted .lrc rehydration');
  });
});
