# Nocturne - Android Native Studio & Gradle Build Guide

## 1. Overview
The Nocturne Android native host (`com.nocturne.audiophile`) provides a production-grade, hardware-accelerated Android environment for Nocturne's bit-perfect Web Audio & DSD playback engine.

### Key Capabilities:
- **Bit-Perfect Background Playback**: Continuously runs high-resolution audio (FLAC, DSD, WAV, ALAC, MP3) in the background with `PowerManager.WakeLock` (`PARTIAL_WAKE_LOCK`) and Android `AudioManager` Audio Focus management.
- **Edge-to-Edge Audiophile UI**: Fully supports Android display cutouts (notches, hole punches) and dynamic gesture navigation bars with `WindowCompat` and `WindowInsetsCompat`.
- **Hardware-Accelerated WebView**: High-performance Chromium WebView with DOM storage, Web Workers, IndexedDB, and `WebViewAssetLoader` for secure `https://appassets.androidplatform.net/assets/` offline asset resolution.
- **Native JavaScript Bridge (`window.NocturneNative`)**: Exposes native controls to the web application:
  - `acquireWakeLock()` / `releaseWakeLock()`
  - `requestAudioFocus()` / `abandonAudioFocus()`
  - `isNativeAndroid()`, `getPlatform()`, `getAndroidSdk()`
  - `showToast(message)`

---

## 2. Environment Prerequisites

- **Java Development Kit (JDK)**: OpenJDK 21 (Microsoft HotSpot JDK 21)
  - Location: `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot`
- **Android SDK**:
  - Location: `C:\Users\thien\AppData\Local\Android\Sdk`
  - Compile SDK: `35` (Android 15)
  - Target SDK: `35`
  - Minimum SDK: `26` (Android 8.0 Oreo)
  - Build-Tools: `35.0.0` or `34.0.0`
- **Gradle Version**: `8.14.3` (configured via Gradle Wrapper)
- **Android Gradle Plugin (AGP)**: `8.7.3`

---

## 3. Project Configuration Files

- `settings.gradle.kts`: Declares root project name `Nocturne` and includes `:app`. Configures Google and MavenCentral repositories.
- `build.gradle.kts`: Top-level build configuration declaring AGP `8.7.3`.
- `gradle.properties`: Configures `org.gradle.jvmargs=-Xmx2048m`, `android.useAndroidX=true`, and `org.gradle.java.home`.
- `local.properties`: Contains SDK directory pointer `sdk.dir=C\:\\Users\\thien\\AppData\\Local\\Android\\Sdk`.
- `app/build.gradle.kts`: Application module config specifying namespace `com.nocturne.audiophile`, compileSdk 35, Java 21 compatibility, and dependencies:
  - `androidx.webkit:webkit:1.12.0`
  - `androidx.core:core-ktx:1.13.1`
  - `androidx.appcompat:appcompat:1.7.0`
  - `androidx.activity:activity:1.9.3`
  - `com.google.android.material:material:1.12.0`

---

## 4. Building the Project

### Building Debug APK:
Open PowerShell or Terminal inside the `android/` directory:
```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
cd android
.\gradlew.bat assembleDebug
```
Output location:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Verifying Built APK:
```powershell
& "C:\Users\thien\AppData\Local\Android\Sdk\build-tools\35.0.0\aapt.exe" dump badging app/build/outputs/apk/debug/app-debug.apk
```

### Installing on Connected Android Device or Emulator:
```powershell
.\gradlew.bat installDebug
```
Or with ADB:
```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Android Studio Usage
1. Launch **Android Studio**.
2. Select **Open** and browse to the repository's `android/` directory.
3. Allow Gradle to sync dependencies and build tasks.
4. Select the `app` run configuration and click **Run** (Shift+F10) targeting your physical Android phone or emulator.
