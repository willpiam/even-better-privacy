# Mobile native Argon2 (identity unlock)

Identity private keys are encrypted with Argon2id (`m=64 MiB`, `t=3`, `p=1`). Pure-JS `@noble/hashes` on Hermes is too slow for unlock; the mobile app uses **react-native-libsodium** `crypto_pwhash` on a background async path.

## Setup after pulling

```bash
cd mobile
npm install
cd ios && pod install && cd ..
```

Rebuild the native app (required for libsodium):

```bash
npm run android
# or
npm run ios
```

## On-device verification

1. Open **Settings → Diagnostics → Verify Argon2 / noble parity**.  
   Must show `Argon2 parity OK`. If it fails, do not use mobile signing until params are fixed.
2. **Run core self-test** (no Argon2; confirms Dilithium path).
3. Sign a message on **Sign / Verify** — overlay should finish in under ~2s (not hang).
4. Optional interop: create identity on phone, copy `.identity.json` to desktop `~/.ebp/`, unlock with CLI/GUI using the same password.

## Implementation map

- `mobile/src/services/argon2.ts` — native KDF + parity vector
- `mobile/src/services/storage.ts` — `loadIdentity` / `persistIdentity` / `saveIdentity`
- `core/AES.ts` — `encryptWithKey`, `decryptWithKey`, `readHeader`
- `core/Identity.ts` — `fromStorageFormatWithKey`, `toStorageFormatWithKey`
