# Mobile native Argon2 (identity unlock)

Identity private keys are encrypted with Argon2id v1.3 (`m=64 MiB`, `t=3`, `p=1`, 32-byte output, 16-byte salt). The mobile app uses asynchronous **react-native-quick-crypto** Argon2id on a native background thread. The same library handles mail PBKDF2; a separate libsodium dependency and startup initialization are no longer needed.

The parameters and storage format match existing libsodium-encrypted identities and the shared `core/AES.ts` implementation. Quick Crypto's `memory` parameter is in **KiB** (`65536`), whereas libsodium used bytes (`67108864`). Keep password bytes exact, including whitespace and Unicode.

## Setup after pulling

```bash
cd mobile
npm ci
cd ios && pod install && cd ..
```

Rebuild the native app after removing libsodium so autolinking is regenerated:

```bash
npm run android
# or
npm run ios
```

## On-device verification

1. In a **development build**, open **More → Diagnostics → Verify Argon2 parity**.
   Must show `Argon2 parity OK`. If it fails, do not use mobile signing until params are fixed.
2. **Run core self-test** (no Argon2; confirms Dilithium path).
3. Sign a message on **Sign / Verify** — overlay should finish in under ~2s (not hang).
4. Optional interop: create identity on phone, copy `.identity.json` to desktop `~/.ebp/`, unlock with CLI/GUI using the same password.

Also import an identity created by the previous libsodium build, unlock it, sign/verify, and persist/reopen it. Run **Verify mail PBKDF2 parity** and unlock a saved mail account. Repeat on Android and iOS after native rebuilds. JS tests compare the wrapper with the existing Argon2 vector and storage format; device checks exercise the actual Nitro/OpenSSL binary.

Release builds omit the developer screens, parity vectors, and self-test. Test emails and payments are available in Settings after accepting the test-funds warning. Release Android builds enable R8 code optimization and resource shrinking; validate a release APK's navigation, file picker, sharing, SVG hierarchy, WebView mail, TCP/TLS, and both KDFs before distribution.

## Implementation map

- `mobile/src/services/argon2.ts` — native KDF + parity vector
- `mobile/src/services/storage.ts` — `loadIdentity` / `persistIdentity` / `saveIdentity`
- `core/AES.ts` — `encryptWithKey`, `decryptWithKey`, `readHeader`
- `core/Identity.ts` — `fromStorageFormatWithKey`, `toStorageFormatWithKey`
