---
name: Mobile logo branding
overview: "Wire EBP logos from repo-root `assets/` into the React Native app: Project Info hero, More-screen brand header, Android/iOS app icons and launch screens, and rename the visible app name from “mobile” to “EBP”."
todos:
  - id: project-info-logo
    content: Add large-logo.png as first item on ProjectInfoScreen before description
    status: completed
  - id: more-brand-header
    content: Add tiny-logo + EBP brand header atop MoreScreen
    status: completed
  - id: display-name
    content: Rename user-visible app name mobile → EBP (app.json, strings.xml, Info.plist)
    status: completed
  - id: android-icons-splash
    content: Generate Android mipmaps from medium-logo; branded launch windowBackground
    status: completed
  - id: ios-icons-splash
    content: Fill AppIcon.appiconset; update LaunchScreen with logo + EBP
    status: completed
isProject: false
---

# Mobile logo branding

## Scope

Cover every placement you confirmed:

| Place | Asset | Change |
|-------|--------|--------|
| Project Info (first item) | `assets/large-logo.png` | Above description, GUI-parity |
| More screen brand header | `assets/tiny-logo.png` | Logo + “EBP” title |
| Android / iOS app icons | generated from `assets/medium-logo.png` | Replace RN defaults |
| Launch / splash | `assets/medium-logo.png` | Replace “mobile” / RN branding |
| Display name | — | `mobile` → `EBP` (user-visible only) |

Do **not** rename native package IDs (`com.mobile`, Xcode target `mobile`) — that would break existing installs. Only change display strings and visuals.

## Asset access

Metro already watches the workspace root ([`mobile/metro.config.js`](mobile/metro.config.js)), so in-app code can `require('../../assets/….png')` from `mobile/src/` without copying files.

Native platforms need files under `android/…/res` and `ios/…/Images.xcassets` — generate those once from `medium-logo.png` / `large-logo.png` with ImageMagick or Pillow during implementation.

## 1. Project Info — large logo first

Update [`mobile/src/screens/ProjectInfoScreen.tsx`](mobile/src/screens/ProjectInfoScreen.tsx) to match GUI order in [`gui/index.html`](gui/index.html) (logo card, then description):

- Import `Image` from `react-native`
- First block: centered `Image` with `require('../../../assets/large-logo.png')`, `resizeMode="contain"`, width ~min(100%, 280–320), square aspect
- Keep existing description / How It Works / Security / Links cards after it
- Style lightly (border + radius) to echo GUI `.project-logo` without inventing a new design system

## 2. More screen — in-app chrome

Update [`mobile/src/screens/MoreScreen.tsx`](mobile/src/screens/MoreScreen.tsx):

- Add a compact brand header at the top (above Settings): `tiny-logo` (≈36–40px) + title “EBP” + short subtitle (“Even Better Privacy”)
- Mirror the email-extension popup pattern ([`email/chrome-extension/popup.html`](email/chrome-extension/popup.html))
- Leave list rows as-is (no ListRow API change required)

Optional small helper [`mobile/src/components/BrandHeader.tsx`](mobile/src/components/BrandHeader.tsx) if it keeps More/ProjectInfo DRY; otherwise inline on More only.

## 3. Display name → “EBP”

User-visible labels only:

- [`mobile/app.json`](mobile/app.json) — `displayName`: `"EBP"`
- [`mobile/android/app/src/main/res/values/strings.xml`](mobile/android/app/src/main/res/values/strings.xml) — `app_name` → `EBP`
- [`mobile/ios/mobile/Info.plist`](mobile/ios/mobile/Info.plist) — `CFBundleDisplayName` → `EBP`
- iOS launch storyboard title text → `EBP` (see splash)

Leave `name: "mobile"` / Gradle `applicationId` / Xcode product name alone.

## 4. Android app icons + splash

**Icons** — replace stock mipmaps under `mobile/android/app/src/main/res/mipmap-*/`:

- Source: `assets/medium-logo.png` (512²)
- Generate `ic_launcher.png` and `ic_launcher_round.png` at mdpi→xxxhdpi sizes (48 / 72 / 96 / 144 / 192)
- Square fox artwork already fits; no adaptive XML unless we need it later

**Splash** — [`styles.xml`](mobile/android/app/src/main/res/values/styles.xml) currently has no branded launch background:

- Add `drawable/launch_screen.xml` (or bitmap) centering medium logo on light page color (`#f4f5f7` from tokens)
- Set `android:windowBackground` on `AppTheme` / add a `SplashTheme` referenced from the launch activity if cleaner
- Keep post-JS UI unchanged (no Bootsplash dependency)

## 5. iOS AppIcon + LaunchScreen

**AppIcon** — [`Images.xcassets/AppIcon.appiconset`](mobile/ios/mobile/Images.xcassets/AppIcon.appiconset/Contents.json) slots exist but have no PNGs:

- Generate all required sizes from `medium-logo.png` (20@2x/3x, 29@2x/3x, 40@2x/3x, 60@2x/3x, 1024 marketing)
- Update `Contents.json` with `filename` entries

**LaunchScreen** — [`LaunchScreen.storyboard`](mobile/ios/mobile/LaunchScreen.storyboard):

- Remove “Powered by React Native”
- Change title from `mobile` → `EBP`
- Add a centered `UIImageView` using a new Images.xcassets image set (e.g. `LaunchLogo` from `medium-logo.png`)

## 6. Generation approach

One-shot script or shell during implementation (not a permanent build step unless useful):

```bash
# example: resize medium-logo into android mipmaps + ios appiconset
```

Prefer ImageMagick `convert` if available; else Python Pillow. Commit the generated PNGs so CI/devs do not need the tool.

## Out of scope

- Renaming npm package / Android `applicationId` / iOS bundle id
- Tab-bar icons (stay Unicode glyphs)
- Promo/marquee assets (`marquee-promo.png`, etc.)
