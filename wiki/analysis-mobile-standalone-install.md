---
title: "Analysis: Mobile Standalone Install (Offline From Computer)"
type: analysis
status: active
last_updated: 2026-07-22
source_count: 5
tags:
  - mobile
  - install
  - release
  - react-native
  - gap
---

# Mobile Standalone Install (Offline From Computer)

## Summary

The wiki and project docs do **not** describe a supported way to install
[[component-mobile]] so it keeps working after USB/computer disconnect.
Documented mobile workflow is a **debug** React Native install that loads JS
from Metro on the development machine. Desktop packaging is documented
([[analysis-linux-build]], [[component-desktop]]); mobile release packaging is
not.

## Why disconnect breaks the current install

Typical local run path (from `mobile/package.json` and `mobile/MAIL.md`):

1. `cd mobile && npm install`
2. Start Metro: `npm start` (optionally `--reset-cache`)
3. Install/run debug binary: `npm run android` or `npm run ios`

Debug builds expect the Metro bundler on the host. Unplugging (or stopping
Metro) leaves the native shell without a JS bundle host, so the app stops
working for development use. That is expected RN debug behavior, not an EBP
bug.

## What standalone would require

To run without the computer, the phone needs a **release** (or otherwise
bundled) binary where the JS bundle is embedded in the APK/IPA:

| Platform | Artifact | Wiki / project status |
| -------- | -------- | --------------------- |
| Android | Release APK/AAB | Local script `build_mobile_android.sh` runs `assembleRelease` and copies to `dist/mobile/ebp-mobile-release.apk`; still signed with the **debug** keystore |
| iOS | Signed IPA / App Store / TestFlight / device provisioning | Not documented in wiki; needs Apple tooling beyond `npm run ios` |
| Store / GitHub Releases | Published installers | [[release-process]] covers desktop checksums; **no mobile artifacts** |

`mobile/package.json` includes `android:release` / `android:release:install` wrappers
around the root script (plus the usual `android` / `ios` / Metro debug flow).

## Contrast with desktop

[[analysis-linux-build]] / ReadMe installation cover AppImage / MSI / local
Tauri builds for offline desktop use. Mobile has no equivalent page.

## Android standalone script

From the repo root (same family as `build_desktop_*.sh`):

```bash
./build_mobile_android.sh              # build only → dist/mobile/ebp-mobile-release.apk
./build_mobile_android.sh --install    # build + adb install -r
./build_mobile_android.sh --skip-npm   # reuse existing node_modules
./build_mobile_android.sh --arch arm64-v8a,armeabi-v7a
```

Or from `mobile/`: `npm run android:release` / `npm run android:release:install`.

The release APK embeds the JS bundle, so Metro is not required at runtime.
Signing remains the debug keystore until a production keystore is configured
in `mobile/android/app/build.gradle`.

## Still open

1. **Verify** build + install + launch with Metro stopped / USB unplugged.
2. **iOS:** Xcode archive + signing; not covered by EBP docs.
3. Wire into [[release-process]] / store distribution if/when mobile ships publicly.

## Sources

- [[component-mobile]]
- `build_mobile_android.sh`
- `mobile/MAIL.md`
- `mobile/package.json`
- `mobile/android/app/build.gradle`
- [[analysis-linux-build]]
- [[release-process]]
