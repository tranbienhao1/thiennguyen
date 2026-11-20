# Nocturne Autonomous Tail-Chaining Schedule State

- **run_id**: 4
- **timestamp**: 2026-11-20T15:48:55+07:00
- **current_version**: v3.9.17
- **versionCode**: 71
- **last_commit**: 9b4c32e -> v3.9.17
- **status**: DONE
- **active_chain**: none

## next_queue
1. `[P1]` Audit Android screen-off battery & background keep-alive hygiene (`WifiLock` / `WakeLock` release when paused/idle, `AudioTrack` / `MediaSession` state sync, and `timeupdate` throttling when display is off on FiiO M11S).
2. `[P2]` Refine Settings OTA Web Assets status badge (show active web version vs bundled APK version + 1-tap safe rollback to bundled assets) and compact catalog maintenance.

## completed_history
- `Run #4 (2026-11-20 15:48 +07 | v3.9.16 -> v3.9.17, versionCode 71)`: [P1] Eliminated Bit-Perfect +6 dB double-routing distortion by disconnecting `state.directAnalyser` downstream when `state.bitPerfectEnabled` is active (preserving metering & pure `deck.direct -> destination`); made `rebuildAudioRoutes` null-safe for single-deck init and made `applyEq` respect `state.bitPerfectEnabled`; eliminated audible clicks/pops in `applyRoomAcoustics` and `applyDsdUltrasonicFilter` via `setTargetAtTime(..., 0.015)`; stopped `applyToneControls` from causing audio dropouts on continuous slider drag (`_routedToTone` guard) and restored persisted tone routing in `setupAudio` while deduplicating `visibilitychange` listener across sample-rate recreations; verified 120/120 tests (0 ES2020+ syntax) + `assembleDebug` APK (`6.59 MB`).
- `Run #3 (2026-11-20 15:40 +07 | v3.9.15 -> v3.9.16, versionCode 70)`: [P1] Implemented non-blocking chunked MicroSD & MediaStore scanner (`MainActivity.startAsyncStorageScan` on `THREAD_PRIORITY_BACKGROUND` emitting 250-track chunks with overlapping root deduplication & `AtomicBoolean` concurrency guard; `index.html` `scanFiioStorage` consuming `onAndroidStorageScanChunk`/`onAndroidStorageScanDone` with `fiioScanInProgress` double-tap lock, 60s watchdog, progressive `scheduleTrackRender`, and yielding deduplicated legacy fallback); verified 70/70 tests (0 ES2020+ syntax) + `assembleDebug` APK (`6.59 MB`).
- `Run #2 (2026-11-20 15:29 +07 | v3.9.14 -> v3.9.15, versionCode 69)`: [P0] Made `library.fetchAudioResponse`/`fetchAudioBlob`/`isFetchAudioRetryable` abort-aware (stops immediately on `AbortError` instead of 3x retry loop); wired `AbortController` + `abortStaleFullAudioUpgrades()` into `upgradeSliceToFullAudio`, `playTrack`, and `releaseUnusedCloudUrl` so skipping tracks immediately aborts abandoned 80MB+ FLAC downloads and drops late blobs without leaking ObjectURLs on FiiO M11S 3GB RAM; added Google Drive 401 token refresh + retry directly on `fetchAudioFirstSlice` for instant 4MB playback after token expiry; verified 66/66 FiiO/OTA/ES5 tests + 76/76 cloud/slice/DSD tests + `assembleDebug` APK (`6.58 MB`).
- `Run #1 (2026-11-20 15:20 +07 | v3.9.13 -> v3.9.14, versionCode 68)`: [P0] Fixed Java `\s` regex escape in `MainActivity.extractCacheNameFromSw`, added numeric `compareSemverVersions` upgrade-only guard to prevent silent OTA downgrades from stale GitHub CDN, added `library-utils.js` integrity validation in OTA staging, removed remaining `<dialog>.showModal()` Top-Layer call in `showSettings()` in favor of pure overlay `setAttribute('open', '')`, synced `#fiio-dap-badge` to `v3.9.14`, fixed `#settings-modal[open]` CSS test parity, added `.agent/RUN.LOCK` to `.gitignore`, verified 62/62 FiiO/OTA/ES5 tests + `assembleDebug` APK (`6.58 MB`).

## do_not_repeat
- Do not use ES2020+ syntax (`?.`, `??`, `.replaceAll`, `.at`) in `index.html` or root `*.js`.
- Do not use `<dialog>.showModal()` Top-Layer for `#settings-modal`.
- Do not copy `.agent/` into `android/app/src/main/assets/`.
- Do not operate in `thiennguyen-git`; strictly use `C:\Users\thien\Downloads\thiennguyen-main`.
- Do not downgrade `CACHE_VERSION`/`versionCode`; always increment monotonically and keep history comments for legacy tests.
- Do not remove `native.scanMediaStoreAudio(10000)` or `scanDirectory` from legacy fallback paths (tested by regression suites).
- Keep exact `filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)` and `state.crossfeedNodes.output.connect(state.context.destination)` invariants.

## blockers
- none
