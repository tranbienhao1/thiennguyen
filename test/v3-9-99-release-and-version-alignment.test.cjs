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

describe('v3.9.99 R4: Release Pipeline, Version Alignment, Asset Parity, ES2019 & Old/New Android Compatibility', () => {
  it('1. Version strings across index.html, sw.js, build.gradle.kts & publish-release.cjs are aligned at v3.9.99 (versionCode 153)', () => {
    const mHtml = html.match(/id="fiio-dap-badge"[^>]*>FiiO M11S · v(\d+\.\d+\.\d+)</);
    const mSwVer = sw.match(/^const CACHE_VERSION = 'v(\d+\.\d+\.\d+)';/m);
    const mSwName = sw.match(/^const CACHE_NAME = 'nocturne-v(\d+\.\d+\.\d+)';/m);
    const mGCode = gradle.match(/^\s*versionCode = (\d+)\b/m);
    const mGName = gradle.match(/^\s*versionName = "(\d+\.\d+\.\d+)"/m);
    const mRelTag = releaseScript.match(/process\.argv\[2\] \|\| 'v(\d+\.\d+\.\d+)'/);

    assert.ok(mHtml && mSwVer && mSwName && mGCode && mGName && mRelTag, 'All version markers must be present');
    assert.equal(mHtml[1], '3.9.99', 'index.html #fiio-dap-badge must be v3.9.99');
    assert.equal(mSwVer[1], '3.9.99', 'sw.js CACHE_VERSION must be v3.9.99');
    assert.equal(mSwName[1], '3.9.99', 'sw.js CACHE_NAME must be nocturne-v3.9.99');
    assert.equal(Number(mGCode[1]), 153, 'build.gradle.kts versionCode must be 153');
    assert.equal(mGName[1], '3.9.99', 'build.gradle.kts versionName must be 3.9.99');
    assert.equal(mRelTag[1], '3.9.99', 'publish-release.cjs default tag must be v3.9.99');
    assert.ok(releaseScript.includes('(versionCode 153)'), 'publish-release.cjs bodyText must reference versionCode 153');
  });

  it('2. // History: comments in sw.js and android/app/build.gradle.kts preserve prior release markers including v3.9.98 / 152 down to v3.1.1 / 15 / 2.0.5', () => {
    const cacheVerLine = sw.split('\n').find(l => l.startsWith('const CACHE_VERSION ='));
    const cacheNameLine = sw.split('\n').find(l => l.startsWith('const CACHE_NAME ='));
    assert.ok(cacheVerLine && cacheVerLine.includes('// History:'), 'sw.js CACHE_VERSION must keep // History:');
    assert.ok(cacheNameLine && cacheNameLine.includes('// History:'), 'sw.js CACHE_NAME must keep // History:');
    for (const oldVer of ['v3.9.98', 'v3.9.97', 'v3.9.96', 'v3.9.95', 'v3.9.90', 'v3.9.14', 'v3.9.8', 'v3.1.1']) {
      assert.ok(cacheVerLine.includes(`const CACHE_VERSION = '${oldVer}';`), `sw.js CACHE_VERSION History must retain ${oldVer}`);
      assert.ok(cacheNameLine.includes(`const CACHE_NAME = 'nocturne-${oldVer}';`), `sw.js CACHE_NAME History must retain nocturne-${oldVer}`);
    }

    const vcLine = gradle.split('\n').find(l => l.trim().startsWith('versionCode ='));
    const vnLine = gradle.split('\n').find(l => l.trim().startsWith('versionName ='));
    assert.ok(vcLine && vcLine.includes('// History:'), 'build.gradle.kts versionCode must keep // History:');
    assert.ok(vnLine && vnLine.includes('// History:'), 'build.gradle.kts versionName must keep // History:');
    for (const oldCode of [152, 151, 150, 149, 148, 144, 86, 85, 84, 67, 15]) {
      assert.ok(vcLine.includes(`versionCode = ${oldCode}`), `build.gradle.kts versionCode History must retain ${oldCode}`);
    }
    for (const oldName of ['3.9.98', '3.9.97', '3.9.96', '3.9.95', '3.9.90', '3.9.32', '3.9.31', '3.9.13', '2.0.5']) {
      assert.ok(vnLine.includes(`versionName = "${oldName}"`), `build.gradle.kts versionName History must retain ${oldName}`);
    }
  });

  it('3. .agent/publish-release.cjs passes node --check, compiles via vm.Script, and renders valid v3.9.99 / versionCode 153 R1-R3 + Old/New Android release notes', () => {
    const releasePath = path.join(ROOT, '.agent', 'publish-release.cjs');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', releasePath], { stdio: 'pipe' }));
    assert.doesNotThrow(() => new vm.Script(releaseScript, { filename: '.agent/publish-release.cjs' }));

    const mBody = releaseScript.match(/const name = process\.argv\[3\] \|\| (`[\s\S]*?`);[\s\S]*?: (`[\s\S]*?`);\n\n\s*const headers/);
    assert.ok(mBody, 'publish-release.cjs must define name and bodyText template literals');
    const tag = 'v3.9.99';
    const renderedName = vm.runInNewContext(mBody[1], { tag });
    const renderedBody = vm.runInNewContext(mBody[2], { tag });

    assert.ok(renderedName.includes('v3.9.99'), 'Release title must include v3.9.99');
    assert.ok(renderedBody.includes('Nocturne v3.9.99 (versionCode 153)'), 'Release body must include Nocturne v3.9.99 (versionCode 153)');
    assert.ok(renderedBody.includes('#### 1.') && renderedBody.includes('#### 2.') && renderedBody.includes('#### 3.'), 'Release body must include structured #### 1./2./3. sections');
    assert.ok(renderedBody.includes('- **Nocturne-Android.apk**'), 'Release body must mention - **Nocturne-Android.apk**');
    assert.ok(renderedBody.includes('ensureInitialSeekAfterPlay') && renderedBody.includes('fetchCloudSidecarLrc'), 'Release body must summarize R1');
    assert.ok(renderedBody.includes('syncGoogleFolderTree') && renderedBody.includes('scanFiioStorage') && renderedBody.includes('TrackWindowSnapshot'), 'Release body must summarize R2');
    assert.ok(renderedBody.includes('rehydrateNativeBitPerfectPlayback') && renderedBody.includes('API 26–30') && renderedBody.includes('API 31–35+'), 'Release body must summarize R3 + Old/New Android compatibility');
  });

  it('4. All synced root files, 404.html, and android/app/src/main/assets/* have 0 CR bytes and SHA-256 + Buffer.compare parity', () => {
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

  it('5. index.html, library-utils.js & virtual-scroll.js parse cleanly via vm.Script and use strictly ES2019-only Chromium 74 syntax', () => {
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
        assert.equal(/\bPromise\.allSettled\s*\(/.test(stripped), false, `${rel} forbidden unguarded Promise.allSettled() in: ${line.trim()}`);
        assert.equal(/\bAbortSignal\.(timeout|any)\s*\(/.test(stripped), false, `${rel} forbidden AbortSignal.timeout/any() in: ${line.trim()}`);
      }
    }
  });

  it('6. Old (API 26-30 / FiiO M11S / Chromium 74) and New (API 31-35+ / Android 12-15+) Android compatibility guards are intact', () => {
    // Gradle SDK bounds
    assert.match(gradle, /^\s*compileSdk = 35\b/m, 'build.gradle.kts must set compileSdk = 35');
    assert.match(gradle, /^\s*minSdk = 26\b/m, 'build.gradle.kts must set minSdk = 26');
    assert.match(gradle, /^\s*targetSdk = 35\b/m, 'build.gradle.kts must set targetSdk = 35');

    // AndroidManifest.xml legacy + modern permissions & foregroundServiceType
    assert.ok(manifest.includes('android.permission.READ_MEDIA_AUDIO'), 'Manifest must declare READ_MEDIA_AUDIO');
    assert.match(manifest, /READ_EXTERNAL_STORAGE"[\s\S]*?android:maxSdkVersion="32"/, 'Manifest READ_EXTERNAL_STORAGE must keep maxSdkVersion="32"');
    assert.match(manifest, /WRITE_EXTERNAL_STORAGE"[\s\S]*?android:maxSdkVersion="29"/, 'Manifest WRITE_EXTERNAL_STORAGE must keep maxSdkVersion="29"');
    assert.ok(manifest.includes('android:requestLegacyExternalStorage="true"'), 'Manifest must retain requestLegacyExternalStorage="true"');
    assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'), 'Manifest must declare POST_NOTIFICATIONS');
    assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'Manifest must declare FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    assert.ok(manifest.includes('android:foregroundServiceType="mediaPlayback"'), 'Manifest service must declare foregroundServiceType="mediaPlayback"');

    // MainActivity.java Old + New Android SDK_INT guards, fallbacks, receivers & edge-to-edge
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.R[\s\S]*?extendedProjectionApi30/, 'extendedProjectionApi30 must be guarded by SDK_INT >= R');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*29[\s\S]*?loadThumbnail/, 'loadThumbnail must be guarded by SDK_INT >= 29');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.Q[\s\S]*?getCurrentThermalStatus/, 'getCurrentThermalStatus must be guarded by SDK_INT >= Q');
    assert.ok(mainJava.includes('@androidx.annotation.RequiresApi(34)') && mainJava.includes('Api34AudioHelper'), 'Api34AudioHelper must keep @RequiresApi(34)');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*34[\s\S]*?Api34AudioHelper/, 'Api34AudioHelper calls must be guarded by SDK_INT >= 34');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.O[\s\S]*?AudioFocusRequest/, 'AudioFocusRequest must be guarded by SDK_INT >= O');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.O[\s\S]*?NotificationChannel/, 'NotificationChannel must be guarded by SDK_INT >= O');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.TIRAMISU[\s\S]*?Context\.RECEIVER_EXPORTED/, 'RECEIVER_EXPORTED must be guarded by SDK_INT >= TIRAMISU');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.TIRAMISU[\s\S]*?Context\.RECEIVER_NOT_EXPORTED/, 'RECEIVER_NOT_EXPORTED must be guarded by SDK_INT >= TIRAMISU');
    assert.match(mainJava, /Build\.VERSION\.SDK_INT\s*<=\s*Build\.VERSION_CODES\.S_V2[\s\S]*?READ_EXTERNAL_STORAGE[\s\S]*?else[\s\S]*?READ_MEDIA_AUDIO[\s\S]*?POST_NOTIFICATIONS/, 'Runtime storage/notification permissions must branch at S_V2');
    assert.ok(mainJava.includes('rebuildAudioTrackWith16BitFallback') && mainJava.includes('convertPcmChunkTo16Bit'), 'MainActivity must retain 16-bit AudioTrack speaker fallback');
    assert.ok(mainJava.includes('PendingIntent.FLAG_IMMUTABLE'), 'MainActivity must apply PendingIntent.FLAG_IMMUTABLE');
    assert.ok(mainJava.includes('WindowCompat.setDecorFitsSystemWindows(window, false)'), 'MainActivity must configure edge-to-edge WindowCompat');
    assert.ok(mainJava.includes('WindowInsetsCompat.Type.systemBars()') && mainJava.includes('WindowInsetsCompat.Type.displayCutout()'), 'MainActivity must dispatch systemBars & displayCutout insets');

    // NocturnePlaybackService.java Old + New Android FGS & notification guards
    assert.match(serviceJava, /Build\.VERSION\.SDK_INT\s*>=\s*29[\s\S]*?FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK/, 'Service startForeground mediaPlayback must be guarded by SDK_INT >= 29');
    assert.match(serviceJava, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.N[\s\S]*?STOP_FOREGROUND_/, 'Service stopForeground must be guarded by SDK_INT >= N');
    assert.ok(serviceJava.includes('PendingIntent.FLAG_IMMUTABLE'), 'Service must apply PendingIntent.FLAG_IMMUTABLE');
    assert.ok(serviceJava.includes('syncBackgroundPauseIfRunning'), 'Service must retain syncBackgroundPauseIfRunning fallback');

    // index.html & virtual-scroll.js Chromium 74 / edge-to-edge / wide viewport parity
    assert.ok(html.includes('viewport-fit=cover'), 'index.html must include viewport-fit=cover');
    assert.ok(html.includes('--safe-area-top') && html.includes('--safe-area-bottom'), 'index.html must define --safe-area-top/--safe-area-bottom');
    assert.ok(html.includes('Blob.prototype.arrayBuffer'), 'index.html must retain Blob.prototype.arrayBuffer Chromium 74 polyfill');
    assert.ok(virtualScroll.includes('getScrollTarget'), 'virtual-scroll.js must retain getScrollTarget for wide viewports');
  });
});
