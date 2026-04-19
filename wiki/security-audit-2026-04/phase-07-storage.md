---
title: "Phase 7 — Identity storage & key management"
type: analysis
status: completed
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-7
  - storage
  - kdf
  - permissions
---

# Phase 7 — Identity storage & key management

Part of the April 2026 [[README|EBP Security Audit]]. Covers the on-disk identity envelope ([`core/AES.ts`](../../core/AES.ts), [`core/Identity.ts`](../../core/Identity.ts) `toStorageFormat` / `fromStorageFormat`), the disk layout under `~/.ebp/`, and password/permissions hygiene across CLI and GUI.

## Snapshot

- Encrypted storage format: `{version, protocolVersion, public, encrypted}` JSON. The `encrypted` field is base64 of `[version(1) | salt(16) | iv(12) | AES-256-GCM(plaintext)]`.
- KDF: PBKDF2-HMAC-SHA256, 310,000 iterations, 256-bit derived key, 128-bit per-encryption salt. (See [`core/AES.ts:13`](../../core/AES.ts).)
- AEAD: AES-256-GCM via `@noble/ciphers/aes`, random 96-bit IV. No AAD bound to the ciphertext.
- File permissions: every `Deno.writeTextFile`/`Deno.writeFile` call uses default mode (typically 0644 on POSIX). `Deno.mkdir({recursive:true})` uses default mode (typically 0777, modulo umask).
- Password floor: 8 characters minimum (CLI; GUI does not enforce on its `setPassword` modal — to confirm in dynamic testing).

## Findings

### F-STORAGE-01 — Identity files written world-readable (High)

**Files:** [`cli/utils.ts:219`](../../cli/utils.ts), [`cli/commands/identity.ts:73`](../../cli/commands/identity.ts), and every other `Deno.writeTextFile` in the CLI/GUI.

```ts
await Deno.writeTextFile(newPath, storageData);  // mode defaults to 0644
```

`Deno.writeTextFile` does not apply a restrictive `mode` option. On POSIX systems with the typical 022 umask, `~/.ebp/<name>.identity.json` is created with mode 0644 — world-readable.

**Impact.** Although the private keys inside the file are AES-GCM-encrypted under a password-derived key, world-readability means:
- Any local user (multi-user system) can read the encrypted blob.
- Any sandboxed app with `read` access to `$HOME` (browsers, editors, language servers, IDE indexers) can read it.
- A compromised non-root process (the textbook "co-tenant" threat) can exfiltrate it for offline brute-force.
- Combined with F-STORAGE-02 (PBKDF2 only at 310k), low-entropy passwords are realistically brute-forceable.

**Recommendation:** explicitly set restrictive permissions:
```ts
await Deno.writeTextFile(newPath, storageData, { mode: 0o600 });
```
And tighten the directory at creation:
```ts
await Deno.mkdir(path, { recursive: true, mode: 0o700 });
```
Apply across `cli/utils.ts`, `cli/commands/*.ts`, and the GUI local backend's identity write paths.

**CVSS 3.1:** AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N — 4.4 Medium per CVSS, raised to High here because (a) it composes with F-STORAGE-02 to enable offline brute force, and (b) "any local process running as $USER" is a realistic threat model for a privacy tool.

### F-STORAGE-02 — PBKDF2 iteration count (310,000) below OWASP 2024 baseline (Medium)

**File:** [`core/AES.ts:13`](../../core/AES.ts).

```ts
const PBKDF2_ITERATIONS = 310_000; // strong default as of 2024
```

OWASP's 2023/2024 Password Storage Cheat Sheet recommends:
- **PBKDF2-HMAC-SHA256 ≥ 600,000 iterations** for password storage.
- **Argon2id (preferred):** 19 MiB, t=2, p=1, or stronger.

EBP uses 310,000 — half the OWASP minimum and far short of the GPU/ASIC reality in 2026. With a modern GPU farm, PBKDF2-HMAC-SHA256 at 310k iterations costs roughly the same as ~10⁵ password attempts/sec/GPU. An 8-character lowercase-alphanumeric password (≈40 bits) is recoverable in days by a motivated attacker who has obtained the file (per F-STORAGE-01).

**Recommendation:**
- Short-term: bump `PBKDF2_ITERATIONS` to **600,000** (OWASP 2024 minimum). Add a storage version bump so old files keep their original count and re-encrypt on next save.
- Medium-term: migrate to **Argon2id**. `@noble/hashes` ≥ 1.4 ships `argon2`. Recommended params for desktop apps: 19 MiB memory, 2 iterations, 1 lane.
- Long-term: support hardware-key-wrapped private-key storage on platforms that have it (Touch ID, Windows Hello, TPM-backed via Tauri's keyring plugin).

### F-STORAGE-03 — AES-GCM ciphertext lacks AAD context binding (Low)

**File:** [`core/AES.ts:17-34`](../../core/AES.ts).

The encrypt path builds `[version | salt | iv | ciphertext+tag]` and does not pass any AAD to GCM. This means the ciphertext is not bound to the storage-format version byte (which is prepended outside GCM). A future format-version expansion (e.g. v2 with a different IV size) could be downgrade-attacked: an attacker who creates a malicious v1 ciphertext can still have it accepted by a v2-aware reader if the version handling is loose.

**Recommendation:** pass the version byte (and any other format-context bytes) as AAD:
```ts
const cipher = gcm(key, iv, encoder.encode(`ebp-identity-v${VERSION}`));
const ciphertext = cipher.encrypt(data);
```

### F-STORAGE-04 — `~/.ebp/` directory created world-readable/executable (Medium)

**File:** [`cli/utils.ts:113-119`](../../cli/utils.ts).

```ts
export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }
}
```

Default mode is 0777 with the user's umask (typically 022 → 0755). Even if F-STORAGE-01 is fixed (files at 0600), other users on the system can `ls ~/.ebp/` and see identity *names* — disclosure of which identities exist is an unwanted side channel for a privacy tool.

**Recommendation:**
```ts
await Deno.mkdir(path, { recursive: true, mode: 0o700 });
```
And on existing installs, `chmod 700 ~/.ebp` as a one-time migration in CLI startup.

### F-STORAGE-05 — `state.json` includes `currentIdentity` and `server` URL in plaintext (Low)

**File:** [`cli/utils.ts:35-38`](../../cli/utils.ts).

`state.json` records the user's currently-active identity and configured server URL. Combined with F-STORAGE-04, any local user can read which identity is active. While not directly exploitable, it weakens privacy. Apply 0600 here as well.

### F-STORAGE-06 — Emergency revocation certificate exported to user-chosen path with no permission tightening (Medium)

**File:** [`cli/commands/identity.ts:94`](../../cli/commands/identity.ts), [`cli/commands/details.ts:201`](../../cli/commands/details.ts).

```ts
await Deno.writeTextFile(revocationOutput, certData);
```

The emergency revocation certificate is the *most powerful single artifact* in EBP — anyone holding it can revoke the identity. It is written with default 0644 perms and the CLI prints a "store this securely" warning, which is best-effort. A user who saves it next to other downloads will have a world-readable kill-switch on disk indefinitely.

**Recommendation:** write with mode 0600. Better: also encrypt it with a passphrase (separate from the identity password), and warn loudly that printing it on paper / cold storage is the recommended mode.

### F-STORAGE-07 — Public-only identity loading silently produces a partly-functional `Identity` (Low)

**File:** [`core/Identity.ts:674-700`](../../core/Identity.ts).

`fromStorageFormat(data)` (no password) constructs a public-only `Identity` whose signing/encryption keys are derived from public components. Calls to `signMessage`, `decryptFor`, etc. on such an instance will fail at runtime — but the type system does not distinguish. If a developer mistakenly threads a public-only identity through a sign path, the failure is at runtime rather than at compile time.

**Recommendation:** introduce a separate `PublicIdentity` type or runtime-tag the instance and have `signMessage` throw immediately with "this identity is loaded in public-only mode; password required".

### F-STORAGE-08 — Decryption of the private blob does not validate JSON shape before key-construction (Low)

**File:** [`core/Identity.ts:655-673`](../../core/Identity.ts).

```ts
const privateJson = AES.decrypt(password, parsed.encrypted);
const privateData = JSON.parse(privateJson);
switch (pub.signingKeyType) {
  case 'dilithium':
    identity.signingKey = DilithiumSigningKey.fromJSON(privateData.signingKey);
    ...
}
```

If decryption succeeds (correct password, intact tag) but the inner JSON is *type-confused* — e.g. an attacker who can write to the file substitutes the encrypted blob with one decrypting to `{signingKey: <sphincs-bytes>, encryptionKey: <kyber-bytes>}` while keeping `pub.signingKeyType === 'dilithium'` — `DilithiumSigningKey.fromJSON` may still construct an "object" that signs with garbage. The key-construction path should validate that the embedded type marker matches `pub.signingKeyType`.

This is a low-severity hardening: an attacker who can write the identity file already has high power, but the principle of "decrypt, then validate" should mean explicit cross-checks.

### F-STORAGE-09 — No password complexity policy (Low)

**File:** [`cli/commands/identity.ts:63-66`](../../cli/commands/identity.ts).

```ts
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  Deno.exit(1);
}
```

8-character passwords are the floor. Combined with F-STORAGE-02 (310k PBKDF2), an 8-char alphanumeric password is recoverable in hours-to-days from a stolen file.

**Recommendation:** raise minimum to 12, enforce at least one of (uppercase, lowercase, digit, symbol), and add a `zxcvbn`-style strength meter in the CLI/GUI password prompts.

### F-STORAGE-10 — `state.json` is unauthenticated (Informational)

**File:** [`cli/utils.ts:25-38`](../../cli/utils.ts).

`state.json` includes `server` URL. A local attacker (with write access to `~/.ebp/`) can swap in a hostile server URL. The CLI has no integrity check on `state.json` (no signature, no ToFU pin per server). This composes with F-CLI-03 (no scheme validation) to make `state.json` a silent attack vector.

**Recommendation:** require an interactive confirmation if `state.json` server URL changes between runs; or sign `state.json` with the identity's signing key on every write.

### F-STORAGE-11 — `test_identities/` and `ebp.sqlite` shipped with documented passwords (Informational, cross-ref F-SECRETS-02)

The repo ships test identities with documented passwords for development. Already raised. Risk: developer copy-pastes one of these into production.

## Hand-off to Phase 8

Phase 8 covers dynamic testing — running the cluster locally, fuzzing endpoints, and producing additional PoCs for the open findings.

- Re-run `F-CRYPTO-01` and `F-CRYPTO-02` PoCs (already done in Phase 2).
- Bring up the GUI and demonstrate F-GUI-01 cross-origin attack live.
- Bring up the server (after fixing the `./db.ts` import) and demonstrate F-SERVER-01 / F-SERVER-02.
- Property-fuzz the verify-signature endpoint.
- File-permission proofs for F-STORAGE-01 (just `stat ~/.ebp/identity.identity.json` after generating).

## Related Pages

- [[README]]
- [[findings]]
- [[phase-02-crypto-core]]
