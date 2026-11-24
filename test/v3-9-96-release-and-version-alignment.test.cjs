'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

describe('v3.9.96 M3: Release Pipeline, Version Alignment, Asset Parity & ES2019 Compliance (R4)', () => {
  it('1. Version strings across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at v3.9.96 (versionCode 150)', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag, 'All version markers must be present');
    assert.equal(mHtml[1], '3.9.96', 'index.html #fiio-dap-badge must be v3.9.96');
    assert.equal(mSwVer[1], '3.9.96', 'sw.js CACHE_VERSION must be v3.9.96');
    assert.equal(mSwName[1], '3.9.96', 'sw.js CACHE_NAME must be nocturne-v3.9.96');
    assert.equal(Number(mGCode[1]), 150, 'build.gradle.kts versionCode must be 150');
    assert.equal(mGName[1], '3.9.96', 'build.gradle.kts versionName must be 3.9.96');
    assert.equal(mRelTag[1], '3.9.96', 'publish-release.cjs default tag must be v3.9.96');
    assert.ok(releaseScript.includes('(versionCode 150)'), 'publish-release.cjs bodyText must reference versionCode 150');
  });

  it('2. // History: comments in sw.js and android/app/build.gradle.kts preserve prior release markers', () => {
    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine && cacheVerLine.includes('// History:'), 'sw.js CACHE_VERSION must keep // History:');
    assert.ok(cacheNameLine && cacheNameLine.includes('// History:'), 'sw.js CACHE_NAME must keep // History:');
    for (const oldVer of ['v3.9.95', 'v3.9.94', 'v3.9.90', 'v3.9.14', 'v3.1.1']) {
      assert.ok(cacheVerLine.includes(`const CACHE_VERSION = '${oldVer}';`), `sw.js CACHE_VERSION History must retain ${oldVer}`);
      assert.ok(cacheNameLine.includes(`const CACHE_NAME = 'nocturne-${oldVer}';`), `sw.js CACHE_NAME History must retain nocturne-${oldVer}`);
    }

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine && vcLine.includes('// History:'), 'build.gradle.kts versionCode must keep // History:');
    assert.ok(vnLine && vnLine.includes('// History:'), 'build.gradle.kts versionName must keep // History:');
    for (const oldCode of [149, 148, 144, 86, 85, 84, 67, 15]) {
      assert.ok(vcLine.includes(`versionCode = ${oldCode}`), `build.gradle.kts versionCode History must retain ${oldCode}`);
    }
    for (const oldName of ['3.9.95', '3.9.94', '3.9.90', '3.9.32', '3.9.31', '3.9.13', '2.0.5']) {
      assert.ok(vnLine.includes(`versionName = "${oldName}"`), `build.gradle.kts versionName History must retain ${oldName}`);
    }
  });

  it('3. .agent/publish-release.cjs parses cleanly and renders valid v3.9.96 / versionCode 150 release notes', () => {
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));
    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\n\n\s*const headers/);
    assert.ok(mBody, 'publish-release.cjs must define name and bodyText template literals');
    const tag = 'v3.9.96';
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });
    assert.ok(renderedName.includes('v3.9.96'), 'Release title must include v3.9.96');
    assert.ok(renderedBody.includes('Nocturne v3.9.96 (versionCode 150)'), 'Release body must include Nocturne v3.9.96 (versionCode 150)');
    assert.ok(renderedBody.includes('Nocturne-Android.apk'), 'Release body must mention Nocturne-Android.apk');
    assert.ok(renderedBody.includes('HttpRangeMediaDataSource') && renderedBody.includes('tryLoadGoogleChangesDelta') && renderedBody.includes('clearCloudSourceCatalog'), 'Release body must summarize R1, R2, and R3');
  });

  it('4. All synced root files, 404.html, and android/app/src/main/assets/* have 0 CR bytes and exact parity', () => {
    assert.equal(htmlBuf.includes(13), false, 'index.html must have 0 CR bytes');
    assert.equal(html404Buf.includes(13), false, '404.html must have 0 CR bytes');
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
      }
    }
  });
});
