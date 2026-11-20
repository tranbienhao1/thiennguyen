'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const indexHtmlPath = path.join(rootDir, 'index.html');

test('Android Project Integrity & Native Build Configuration Suite', async (t) => {
  await t.test('1. Android project files and directory structure', () => {
    assert.ok(fs.existsSync(androidDir), 'android/ directory must exist');

    // Settings gradle
    const settingsKts = path.join(androidDir, 'settings.gradle.kts');
    const settingsGroovy = path.join(androidDir, 'settings.gradle');
    assert.ok(
      fs.existsSync(settingsKts) || fs.existsSync(settingsGroovy),
      'settings.gradle.kts or settings.gradle must exist in android/'
    );
    const settingsContent = fs.readFileSync(fs.existsSync(settingsKts) ? settingsKts : settingsGroovy, 'utf8');
    assert.ok(
      settingsContent.includes(':app'),
      'settings.gradle(.kts) must include :app module'
    );

    // Root build.gradle(.kts)
    const rootBuildKts = path.join(androidDir, 'build.gradle.kts');
    const rootBuildGroovy = path.join(androidDir, 'build.gradle');
    assert.ok(
      fs.existsSync(rootBuildKts) || fs.existsSync(rootBuildGroovy),
      'build.gradle.kts or build.gradle must exist in android/'
    );

    // gradle.properties
    const gradlePropsPath = path.join(androidDir, 'gradle.properties');
    assert.ok(fs.existsSync(gradlePropsPath), 'gradle.properties must exist in android/');
    const gradleProps = fs.readFileSync(gradlePropsPath, 'utf8');
    assert.match(gradleProps, /android\.useAndroidX\s*=\s*true/i, 'gradle.properties must have android.useAndroidX=true');
    assert.match(gradleProps, /org\.gradle\.jvmargs/i, 'gradle.properties must specify org.gradle.jvmargs');

    // local.properties (or ANDROID_HOME / ANDROID_SDK_ROOT in CLI/CI environments)
    const localPropsPath = path.join(androidDir, 'local.properties');
    if (fs.existsSync(localPropsPath)) {
      const localProps = fs.readFileSync(localPropsPath, 'utf8');
      assert.match(localProps, /sdk\.dir/i, 'local.properties must define sdk.dir');
    } else {
      const defaultWinSdk = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '';
      assert.ok(
        Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (defaultWinSdk && fs.existsSync(defaultWinSdk))),
        'Either android/local.properties or Android SDK environment/directory must be available'
      );
    }

    // Gradle wrapper
    assert.ok(
      fs.existsSync(path.join(androidDir, 'gradlew')) || fs.existsSync(path.join(androidDir, 'gradlew.bat')),
      'Gradle wrapper executable (gradlew or gradlew.bat) must exist in android/'
    );
    const wrapperPropsPath = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    assert.ok(fs.existsSync(wrapperPropsPath), 'gradle-wrapper.properties must exist');
    const wrapperProps = fs.readFileSync(wrapperPropsPath, 'utf8');
    assert.match(wrapperProps, /gradle-8\./i, 'gradle-wrapper.properties must reference Gradle 8.x');
  });

  await t.test('2. android/app/build.gradle(.kts) specification & dependencies', () => {
    const appBuildKts = path.join(androidDir, 'app', 'build.gradle.kts');
    const appBuildGroovy = path.join(androidDir, 'app', 'build.gradle');
    assert.ok(
      fs.existsSync(appBuildKts) || fs.existsSync(appBuildGroovy),
      'app/build.gradle.kts or app/build.gradle must exist'
    );
    const appBuild = fs.readFileSync(fs.existsSync(appBuildKts) ? appBuildKts : appBuildGroovy, 'utf8');

    // Application ID & namespace
    assert.ok(
      appBuild.includes('com.nocturne.audiophile'),
      'app build file must define namespace or applicationId as com.nocturne.audiophile'
    );

    // SDK versions
    assert.match(appBuild, /compileSdk\s*(?:=|\s)\s*3[4-5]/i, 'compileSdk must be at least 34 (Android 14/15)');
    assert.match(appBuild, /minSdk\s*(?:=|\s)\s*2[6-9]/i, 'minSdk must be at least 26 (Android 8.0 Oreo)');
    assert.match(appBuild, /targetSdk\s*(?:=|\s)\s*3[4-5]/i, 'targetSdk must target at least 34');

    // Dependencies
    assert.ok(
      appBuild.includes('androidx.webkit:webkit'),
      'app dependencies must include androidx.webkit:webkit'
    );
    assert.ok(
      appBuild.includes('androidx.core:core') || appBuild.includes('androidx.core:core-ktx'),
      'app dependencies must include androidx.core'
    );
  });

  await t.test('3. AndroidManifest.xml audiophile audio permissions and activities', () => {
    const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
    assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist in android/app/src/main/');
    const manifest = fs.readFileSync(manifestPath, 'utf8');

    // Essential permissions
    const requiredPermissions = [
      'android.permission.INTERNET',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.WAKE_LOCK',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.POST_NOTIFICATIONS'
    ];

    for (const perm of requiredPermissions) {
      assert.ok(
        manifest.includes(perm),
        `AndroidManifest.xml must declare permission: ${perm}`
      );
    }

    // Hardware acceleration
    assert.match(
      manifest,
      /android:hardwareAccelerated\s*=\s*["']true["']/i,
      'AndroidManifest.xml must set android:hardwareAccelerated="true"'
    );

    // Activity with MAIN and LAUNCHER
    assert.ok(manifest.includes('android.intent.action.MAIN'), 'AndroidManifest must declare action MAIN');
    assert.ok(manifest.includes('android.intent.category.LAUNCHER'), 'AndroidManifest must declare category LAUNCHER');
  });

  await t.test('4. MainActivity.java audiophile WebSettings & background playback architecture', () => {
    const mainActivityJava = path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'nocturne',
      'audiophile',
      'MainActivity.java'
    );
    const mainActivityKt = path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'nocturne',
      'audiophile',
      'MainActivity.kt'
    );

    assert.ok(
      fs.existsSync(mainActivityJava) || fs.existsSync(mainActivityKt),
      'MainActivity (Java or Kotlin) must exist at com/nocturne/audiophile/MainActivity'
    );

    const sourcePath = fs.existsSync(mainActivityJava) ? mainActivityJava : mainActivityKt;
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Package declaration
    assert.match(source, /package\s+com\.nocturne\.audiophile\s*;/i, 'Package must be com.nocturne.audiophile');

    // WebSettings optimizations for audiophile player
    assert.match(source, /setJavaScriptEnabled\s*\(\s*true\s*\)/i, 'Must enable JavaScript in WebSettings');
    assert.match(source, /setDomStorageEnabled\s*\(\s*true\s*\)/i, 'Must enable DOM storage in WebSettings');
    assert.match(
      source,
      /setMediaPlaybackRequiresUserGesture\s*\(\s*false\s*\)/i,
      'Must disable mediaPlaybackRequiresUserGesture for continuous gapless playback'
    );
    assert.match(source, /setAllowFileAccess\s*\(\s*true\s*\)/i, 'Must allow file access for local FLAC/DSD files');
    assert.match(source, /setDatabaseEnabled\s*\(\s*true\s*\)/i, 'Must enable database storage in WebSettings');

    // Audio Focus & WakeLock for continuous background playback
    const hasAudioFocus =
      source.includes('AudioManager') ||
      source.includes('AudioFocusRequest') ||
      source.includes('AUDIOFOCUS_GAIN') ||
      source.includes('requestAudioFocus');
    assert.ok(hasAudioFocus, 'MainActivity must support Audio Focus management for background playback');

    const hasWakeLock =
      source.includes('PARTIAL_WAKE_LOCK') ||
      source.includes('newWakeLock') ||
      source.includes('wakeLock');
    assert.ok(hasWakeLock, 'MainActivity must acquire WakeLock for continuous background audiophile playback');

    // Insets / Notch handling
    const hasInsetsHandling =
      source.includes('WindowInsetsCompat') ||
      source.includes('setOnApplyWindowInsetsListener') ||
      source.includes('setDecorFitsSystemWindows') ||
      source.includes('WindowInsets');
    assert.ok(
      hasInsetsHandling,
      'MainActivity must configure WindowInsets or edge-to-edge system bar handling'
    );
  });

  await t.test('5. Web Audio API absolute invariant preservation', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});
