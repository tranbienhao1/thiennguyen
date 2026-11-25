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

describe('v3.9.98 R4: Release Pipeline, Version Alignment, Asset Parity & ES2019 Compliance', () => {
  it('1. Version strings across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at >= v3.9.98 (versionCode >= 152)', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag && mRelCode, 'All version markers must be present');
    const ver = mHtml[1];
    assert.equal(geq(ver, '3.9.98'), true, `index.html #fiio-dap-badge must be >= v3.9.98 (got ${ver})`);
    assert.equal(mSwVer[1], ver, `sw.js CACHE_VERSION must match v${ver}`);
    assert.equal(mSwName[1], ver, `sw.js CACHE_NAME must match nocturne-v${ver}`);
    assert.equal(Number(mGCode[1]) >= 152, true, `build.gradle.kts versionCode must be >= 152 (got ${mGCode[1]})`);
    assert.equal(mGName[1], ver, `build.gradle.kts versionName must match ${ver}`);
    assert.equal(mRelTag[1], ver, `publish-release.cjs default tag must match v${ver}`);
    assert.equal(Number(mRelCode[1]), Number(mGCode[1]), 'publish-release.cjs bodyText versionCode must match build.gradle.kts');
  });

  it('2. // History: comments in sw.js and android/app/build.gradle.kts preserve prior release markers including v3.9.97 / 151', () => {
    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine && cacheVerLine.includes('// History:'), 'sw.js CACHE_VERSION must keep // History:');
    assert.ok(cacheNameLine && cacheNameLine.includes('// History:'), 'sw.js CACHE_NAME must keep // History:');
    for (const oldVer of ['v3.9.97', 'v3.9.96', 'v3.9.95', 'v3.9.94', 'v3.9.90', 'v3.9.14', 'v3.1.1']) {
      assert.ok(cacheVerLine.includes(`const CACHE_VERSION = '${oldVer}';`), `sw.js CACHE_VERSION History must retain ${oldVer}`);
      assert.ok(cacheNameLine.includes(`const CACHE_NAME = 'nocturne-${oldVer}';`), `sw.js CACHE_NAME History must retain nocturne-${oldVer}`);
    }

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine && vcLine.includes('// History:'), 'build.gradle.kts versionCode must keep // History:');
    assert.ok(vnLine && vnLine.includes('// History:'), 'build.gradle.kts versionName must keep // History:');
    for (const oldCode of [151, 150, 149, 148, 144, 86, 85, 84, 67, 15]) {
      assert.ok(vcLine.includes(`versionCode = ${oldCode}`), `build.gradle.kts versionCode History must retain ${oldCode}`);
    }
    for (const oldName of ['3.9.97', '3.9.96', '3.9.95', '3.9.94', '3.9.90', '3.9.32', '3.9.31', '3.9.13', '2.0.5']) {
      assert.ok(vnLine.includes(`versionName = "${oldName}"`), `build.gradle.kts versionName History must retain ${oldName}`);
    }
  });

  it('3. .agent/publish-release.cjs passes node --check, parses cleanly, and renders valid >= v3.9.98 / versionCode >= 152 release notes', () => {
    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));

    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);
    const mRelCode = releaseScript.match(/\(versionCode (\d+)\)/);
    assert.ok(mRelTag && mRelCode, 'publish-release.cjs must define default tag and versionCode');
    assert.equal(geq(mRelTag[1], '3.9.98'), true);
    assert.equal(Number(mRelCode[1]) >= 152, true);

    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\n\n\s*const headers/);
    assert.ok(mBody, 'publish-release.cjs must define name and bodyText template literals');
    const tag = `v${mRelTag[1]}`;
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });
    assert.ok(renderedName.includes(tag), `Release title must include ${tag}`);
    assert.ok(renderedBody.includes(`Nocturne ${tag} (versionCode ${mRelCode[1]})`), `Release body must include Nocturne ${tag} (versionCode ${mRelCode[1]})`);
    assert.ok(renderedBody.includes('#### 1.') && renderedBody.includes('#### 2.') && renderedBody.includes('#### 3.'), 'Release body must include structured #### 1./2./3. sections');
    assert.ok(renderedBody.includes('- **Nocturne-Android.apk**'), 'Release body must mention - **Nocturne-Android.apk**');
  });

  it('4. All synced root files, 404.html, and android/app/src/main/assets/* have 0 CR bytes and SHA-256 + byte parity', () => {
    assert.equal(htmlBuf.includes(13), false, 'index.html must have 0 CR bytes');
    assert.equal(html404Buf.includes(13), false, '404.html must have 0 CR bytes');
    assert.equal(sha256(htmlBuf), sha256(html404Buf), '404.html SHA-256 must match index.html');
    assert.equal(Buffer.compare(htmlBuf, html404Buf), 0, '404.html must be byte-identical to index.html');

    const rootJsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();
    assert.ok(rootJsFiles.includes('sw.js') && rootJsFiles.includes('library-utils.js') && rootJsFiles.includes('virtual-scroll.js'));
    const syncedNames = ['index.html', 'tailwind.min.css', ...rootJsFiles];

    for (const rel of syncedNames) {
      const rootPath = path.join(ROOT, rel);
      const assetPath = path.join(ASSETS_DIR, rel);
      assert.ok(fs.existsSync(assetPath), `Missing synced Android asset: ${rel}`);
      const rBuf = fs.readFileSync(rootPath);
      const aBuf = fs.readFileSync(assetPath);
      assert.equal(rBuf.includes(13), false, `${rel} must have 0 CR bytes`);
      assert.equal(aBuf.includes(13), false, `android/app/src/main/assets/${rel} must have 0 CR bytes`);
      assert.equal(sha256(rBuf), sha256(aBuf), `android/app/src/main/assets/${rel} SHA-256 must match root ${rel}`);
      assert.equal(Buffer.compare(rBuf, aBuf), 0, `android/app/src/main/assets/${rel} must match root ${rel}`);
    }
  });

  it('5. index.html, library-utils.js & virtual-scroll.js compile cleanly and use strictly ES2019-only syntax', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim().length > 0);
    assert.ok(scripts.length >= 2, 'index.html must contain inline script blocks');
    scripts.forEach((scriptCode, idx) => {
      assert.doesNotThrow(() => new vm.Script(scriptCode, { filename: `index.html#script-${idx}` }));
    });

    for (const rel of ['index.html', 'library-utils.js', 'virtual-scroll.js']) {
      let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (rel === 'index.html') {
        src = scripts.join('\n');
      } else {
        assert.doesNotThrow(() => new vm.Script(src, { filename: rel }));
      }
      const lines = src.split('\n').filter(l => !/^\s*\/\//.test(l));
      for (const line of lines) {
        const stripped = line
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '');
        assert.equal(/\?\.(?!\d)/.test(stripped), false, `${rel} forbidden optional chaining (?.) in: ${line.trim()}`);
        assert.equal(/\?\?/.test(stripped), false, `${rel} forbidden nullish coalescing (??/??=) in: ${line.trim()}`);
        assert.equal(/\|\|=|&&=/.test(stripped), false, `${rel} forbidden logical assignment in: ${line.trim()}`);
        assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${rel} forbidden .replaceAll() in: ${line.trim()}`);
        assert.equal(/\.at\s*\(/.test(stripped), false, `${rel} forbidden .at() in: ${line.trim()}`);
        assert.equal(/Object\.hasOwn\s*\(/.test(stripped), false, `${rel} forbidden Object.hasOwn() in: ${line.trim()}`);
        assert.equal(/\bstructuredClone\s*\(/.test(stripped), false, `${rel} forbidden structuredClone() in: ${line.trim()}`);
        assert.equal(/\bcatch\s*\{/.test(stripped), false, `${rel} forbidden bare catch {} in: ${line.trim()}`);
        assert.equal(/\b\d+_\d+\b/.test(stripped), false, `${rel} forbidden numeric separator in: ${line.trim()}`);
        assert.equal(/\b\d+n\b/.test(stripped), false, `${rel} forbidden BigInt literal in: ${line.trim()}`);
      }
    }
  });
});
