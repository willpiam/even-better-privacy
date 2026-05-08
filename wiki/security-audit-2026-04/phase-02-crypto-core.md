---
title: "Phase 2 — Cryptographic Core Review"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-2
  - crypto
---

# Phase 2 — Cryptographic Core Review

Part of the April 2026 [[README|EBP Security Audit]]. Covers [`core/`](../../core) (~2.0k LOC).

## Summary

The cryptographic core uses correctly-chosen NIST-standardized primitives (ML-KEM-1024, ML-DSA-87, SLH-DSA-SHA2-256s) from a reputable library (`@noble/post-quantum`), AES-256-GCM for symmetric authenticated encryption, and PBKDF2-HMAC-SHA256 with 310k iterations for password-based key derivation. CSPRNG usage is consistent. There is no `eval`, `Function()`, or `Math.random` in the core. The 84-test core suite passes.

However, the construction layer above the primitives has several real-world weaknesses, two of which are confirmed exploitable PoCs:

- **F-CRYPTO-01 (High, confirmed)** — emergency revocation certificates and the first regular revocation share nonce 0; a single benign user-initiated revocation invalidates the pre-stored emergency cert.
- **F-CRYPTO-02 (High, confirmed)** — the encrypt+sign blob does not bind sender to recipient, enabling surreptitious forwarding (Davis 2001).
- **F-CRYPTO-03–11** — domain-separation, canonicalization, fingerprint-leaf inconsistency, type-construction, and parser-fragility issues, all individually Medium / Low severity, but collectively forming a fragile cryptographic envelope layer that is one regression away from a more serious break.

## Methodology

1. Read every file in [`core/`](../../core) (15 files, ~2.0k LOC).
2. Cross-checked against [[../identity-model]], [[../revocation-system]], and [[../message-payload-formats]] wiki pages.
3. Static checks:
   - `rg "Math.random"` over the whole repo (no matches in `core/` or `server/` or `gui/local-backend/`).
   - `rg "eval\(|new Function"` (no matches anywhere).
   - `deno lint core/` — see `tooling-output/phase-02-deno-lint.txt` (2 unused-var warnings only).
   - `deno test ./test` — 84/84 pass, see `tooling-output/phase-02-deno-test-core.txt`.
4. Built two PoCs for the High findings under `pocs/`. Both reproduce the issues end-to-end.

## What is correct

- **AES** ([`core/AES.ts`](../../core/AES.ts)): AES-256-GCM (AEAD, not raw CTR), 96-bit IV, 128-bit per-encryption salt, PBKDF2-SHA256 with 310k iterations. Meets OWASP 2024 guidance. Proper version byte and tag-failure handling on decrypt.
- **CSPRNG**: every random source in `core/` is either `randomBytes` from `@noble/hashes/utils` (Web Crypto under the hood) or `crypto.getRandomValues`. No `Math.random`.
- **KEM/DEM**: [`core/Kyber.ts`](../../core/Kyber.ts) does encapsulate → AES-256-GCM with the shared secret as the key. Standard hybrid pattern.
- **Hierarchy validation**: cycle detection in `validateHierarchy` is correct; explicit "child already has master" rejection prevents diamond/multi-parent confusion.
- **Bech32 fingerprint**: case-strict, length-validated, HRP-restricted to `ebpdk` / `ebpsk`.
- **Test coverage**: 84 tests across MessageExchange, Identity, Revocation, Sphincs, Kyber, Hierarchy, Fingerprint.

## Findings (detailed)

### F-CRYPTO-01 — Emergency revocation certificate nonce-0 collision (High, confirmed)

**Files:** [`core/Identity.ts:97`](../../core/Identity.ts), [`core/Identity.ts:303-325`](../../core/Identity.ts) (`revokeDetail`), [`core/Identity.ts:333-352`](../../core/Identity.ts) (`createIdentityRevocation`), [`core/Identity.ts:396-408`](../../core/Identity.ts) (`generateEmergencyRevocationCertificate`), [`core/Revocation.ts:217-219`](../../core/Revocation.ts) (`isValidRevocationNonce`).

The constructor sets `this.revocationNonce = 0`. `revokeDetail` and `createIdentityRevocation` both sign with `this.revocationNonce` (initially 0) and then increment it. `generateEmergencyRevocationCertificate` always signs with literal `0`. The server-side nonce-validation rule from `isValidRevocationNonce` is `nonce > maxSeenNonce`, which means the FIRST regular revocation (which uses nonce 0) reserves slot 0 — and any subsequent attempt to apply the emergency certificate will be rejected as a replay.

This contradicts the design intent documented in [[../revocation-system]] which describes emergency certs as long-lived "pre-generated certificates that can revoke an identity even if the private key is lost".

**Impact:** A user who follows the documented best-practice workflow — generate identity, generate emergency cert (`generate-revocation-cert`), then later perform a routine `revoke-detail` to update an email — silently invalidates their disaster-recovery certificate. They will discover this only when they try to use it after a key compromise, at which point recovery may be impossible.

**PoC:** [`pocs/F-CRYPTO-01-emergency-nonce-collision.ts`](pocs/F-CRYPTO-01-emergency-nonce-collision.ts). Output reproduced in `tooling-output/`:
```
Emergency certificate nonce: 0
First regular detail-revoke nonce: 0
Both certificates use nonce 0: true
After server stores the regular revocation, would the emergency cert still be accepted? false
CONFIRMED F-CRYPTO-01
```

**CVSS 3.1:** AV:L/AC:H/PR:H/UI:R/S:U/C:N/I:H/A:H — 5.6 Medium per CVSS, but rated High in this audit because the failure mode is silent, the design intent is explicit, and recovery from the failure is impossible without the very key the cert was meant to back up.

**Recommendations (pick one):**
1. Reserve a dedicated emergency-cert nonce range, e.g. always sign emergency certs with `nonce = 2^53 - 1` (or use a separate `emergency: true` flag and a separate counter on the server).
2. Initialize regular `revocationNonce` to 1, leaving slot 0 exclusively for emergency certs.
3. Make `generateEmergencyRevocationCertificate` consume a slot at generation time by bumping `revocationNonce` to at least 1 (and write that bump into storage). This is destructive of the lazy-emergency-cert idea.
4. Add a separate `emergencyNonce` counter in storage and a server-side rule that emergency certs are accepted only on a specific reserved nonce.

The cleanest fix is option 1 (reserved high nonce or a `purpose: "emergency"` field) so existing workflows continue to work.

### F-CRYPTO-02 — Surreptitious forwarding on encrypt+sign (High, confirmed)

**Files:** [`core/Identity.ts:127-135`](../../core/Identity.ts) (`signAndEncryptMessage`, `signAndEncryptFor`), [`core/Identity.ts:137-142`](../../core/Identity.ts) (`decryptAndVerify`).

`signAndEncryptFor(message, recipient)` produces `recipient.encrypt(JSON.stringify({ message, signature }))`. The signature covers only `buildMessageHashEnvelope(message, salt)` — neither sender nor recipient fingerprint. The encryption layer adds confidentiality but no sender authentication.

This is the classic "Defective Sign & Encrypt" pattern documented by Don Davis in 2001 (Section 5 — surreptitious forwarding). Bob can decrypt Alice's blob, recover the inner `{message, signature}`, re-encrypt it to Charlie, and Charlie sees a perfectly valid "signed message from Alice" that Alice never sent to Charlie.

EBP partially mitigates this at the wire-format layer ([`core/Payloads.ts`](../../core/Payloads.ts) `EbpEncryptedSignedMessagePayload` carries `recipientFingerprint`), but those wire fields are not signed — they are routing metadata. The cryptographic core that the wire format wraps is still vulnerable.

**Impact:** Cross-recipient repudiation/forwarding attacks. Realistic scenarios:
- Bob receives a private confession from Alice, forwards it to Charlie, and Charlie believes Alice intended the message for him.
- A legal "signed message from Alice to Bob" can be reframed by Bob as having been sent to Charlie.

**PoC:** [`pocs/F-CRYPTO-02-surreptitious-forwarding.ts`](pocs/F-CRYPTO-02-surreptitious-forwarding.ts). Output:
```
Bob decrypted message: "Hi Bob, the deal is yours alone. — Alice"
Bob verified signature: true
Bob re-packages Alice's signed-message blob and encrypts it for Charlie.
Charlie sees message: "Hi Bob, the deal is yours alone. — Alice"
Charlie's signature verification result: true
CONFIRMED F-CRYPTO-02
```

**CVSS 3.1:** AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N — 8.1 High.

**Recommendation:** include the recipient fingerprint (and ideally a fresh salt) inside the signed payload. New envelope, e.g.:
```
ebp::encryptedsigned::v1::{senderFingerprint}::{recipientFingerprint}::{salt}::{sha256(plaintext)}
```
Then sign that envelope. On the receive side, additionally check that `recipientFingerprint` matches the local identity. Bump `FILE_FORMAT_VERSIONS.encryptedSignedMessage` and add migration tests.

### F-CRYPTO-03 — Signature envelope lacks per-purpose domain separation (Medium)

**Files:** [`core/MessageHash.ts`](../../core/MessageHash.ts), [`core/Revocation.ts:158-159`](../../core/Revocation.ts), [`core/HierarchyCertificate.ts:125-126`](../../core/HierarchyCertificate.ts), [`core/DetailProof.ts:52`](../../core/DetailProof.ts), [`core/Identity.ts:122-125`](../../core/Identity.ts).

Every signed object in the system passes through the same `buildMessageHashEnvelope(message, salt)` envelope:
```
ebp::messagehash::{sha256_hex(message)}::{salt}
```
There is no per-purpose tag distinguishing "this signature covers a user message" from "this signature covers a revocation certificate" from "this signature covers a hierarchy certificate" from "this signature covers a detail proof".

Today this is safe because the inner `message` strings differ in shape (raw user text, JSON revocation cert, `HIERARCHY_CERTIFICATE_PREFIX::...` join, JSON detail-proof record), and SHA-256 is collision-resistant. But:
- A future format change that converges on a similar shape (e.g. JSON-normalizing user messages) could create a cross-protocol oracle.
- The envelope structure makes it impossible to have a future signature scheme where the envelope itself encodes the purpose.

**Recommendation:** add a purpose tag to the envelope, e.g.
```
ebp::v1::{purpose}::{sha256_hex(message)}::{salt}
```
where `purpose ∈ {message, detail-proof, revocation, hierarchy, state}`. Bump `FILE_FORMAT_VERSIONS.signature`.

### F-CRYPTO-04 — Inconsistent fingerprint leaf hashing (Medium)

**Files:** [`core/Fingerprint.ts:33-47`](../../core/Fingerprint.ts).

`computeSigningLeafRaw` hashes `base64ToBytes(signingPublicKey)` — i.e. the decoded raw public-key bytes.

`computeEncryptionLeafRaw` hashes `textEncoder.encode(encryptionPublicKey)` — i.e. the bytes of the *hex string*, not the decoded key bytes. The code has a comment explicitly preserving this for backwards-compat.

The fingerprint is still well-defined and collision-resistant (as long as the construction is fixed), but:
- It is a footgun for anyone porting the fingerprint computation to another language.
- It means the signing leaf carries 32 bytes of preimage, whereas the encryption leaf carries ~3,000+ ASCII bytes (hex of an ML-KEM-1024 1568-byte public key) — wasteful but not insecure.

**Recommendation:** plan a fingerprint format v2 that hashes raw key bytes for both leaves, with explicit per-leaf domain separators (`sha256(0x00 || sigKeyBytes)`, `sha256(0x01 || encKeyBytes)`). Migrate via a separate HRP (`ebpdk2`, `ebpsk2`). This is breaking, so should be batched with other changes.

### F-CRYPTO-05 — Detail-proof and revocation-cert payloads rely on `JSON.stringify` insertion order (Medium)

**Files:** [`core/Identity.ts:149-162`](../../core/Identity.ts) (`attachDetail`), [`core/Identity.ts:193-205`](../../core/Identity.ts) (verify side in `getDetail`), [`core/DetailProof.ts:45-52`](../../core/DetailProof.ts), [`core/Revocation.ts:80-92`](../../core/Revocation.ts) (`getRevocationSignaturePayload`).

`attachDetail` constructs `{ nonce, path, detail, timestamp, signature: null }` and signs `JSON.stringify(...)` of it. Verification reconstructs the same JSON in the same property order. This works because V8's `JSON.stringify` preserves insertion order — but the protocol depends on JS-engine behaviour rather than a canonical encoding.

Same pattern in `getRevocationSignaturePayload`. Note that [`core/StateHash.ts`](../../core/StateHash.ts) DOES define `canonicalize` + `stableStringify`, so the project knows the right pattern; it is just not used for detail proofs and revocation certs.

**Recommendation:** route all signed payload construction through `stableStringify` from [`core/StateHash.ts`](../../core/StateHash.ts), or define explicit per-purpose tagged-tuple encodings (e.g. `ebp::detail-proof::v1::{nonce}::{path}::{detail}::{timestamp}`). Add a regression test that signs in JS and verifies a hand-rolled byte-equal payload.

### F-CRYPTO-06 — `Object.create(Identity.prototype)` bypasses constructor invariants (Medium)

**Files:** [`core/Identity.ts:644-700`](../../core/Identity.ts), [`core/Dilithium.ts:65-73`](../../core/Dilithium.ts), [`core/Sphincs.ts:92-100`](../../core/Sphincs.ts), [`core/Kyber.ts:147-156`](../../core/Kyber.ts).

`Identity.fromStorageFormat` uses `Object.create(Identity.prototype)` rather than `new Identity(...)` and then manually re-assigns every field. The `*.fromPublicKey` constructors do the same and assign `secretKey: new Uint8Array(0)`.

If a public-only Identity is later asked to `signMessage(...)`, the call descends to `DilithiumSigningKey.sign` which passes a zero-length `secretKey` to the underlying `@noble/post-quantum` ml-dsa `sign(message, secretKey)`. The library typically throws (good), but the failure mode is opaque and depends on library behaviour. Future library upgrades could change this to silent garbage. Same risk with Kyber decrypt on a public-only KEM key.

**Recommendation:** add explicit `if (this.secretKey.length === 0) throw new Error("public-only key cannot sign/decrypt")` guards in `sign`/`decrypt`. Add tests that assert the throw.

### F-CRYPTO-07 — Hierarchy certificate signing payload uses non-parser-secure `::` joining (Low)

**Files:** [`core/HierarchyCertificate.ts:74-87`](../../core/HierarchyCertificate.ts).

`getHierarchySignaturePayload` joins fields with `"::"`. `context` is a user-supplied string up to 256 chars. If `context = "::evil-master::evil-child::0::0"`, the joined payload becomes `HierarchyCertificate::M::C::T::E::::evil-master::evil-child::0::0::salt`, which a permissive parser could reinterpret. The current code doesn't parse it back — it just hashes the byte sequence — so this is not exploitable today. It is a fragility flag for any future tooling that reverses the join.

**Recommendation:** length-prefix each field, or use canonical JSON via `stableStringify`. Add `context.includes("::")` rejection at construction time as a quick defensive measure.

### F-CRYPTO-08 — `hexToBytes` accepts non-hex characters (Low)

**File:** [`core/Hex.ts:8-15`](../../core/Hex.ts).

```ts
out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
```
`parseInt("zz", 16)` returns `NaN`, which is then coerced to `0` by `Uint8Array` assignment. Two attacker-controlled non-hex characters silently become a `0` byte. Not exploitable in current call sites (always feeding it library-produced hex), but trivially breakable if used on attacker input.

**Recommendation:**
```ts
if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error("invalid hex");
```

### F-CRYPTO-09 — Inner `{message, signature}` blob has no version/type tag (Low)

**File:** [`core/Identity.ts:127-142`](../../core/Identity.ts).

The encrypt+sign inner JSON is just `{message, signature}` with no `type`, no `version`, no `senderFingerprint`. Combined with F-CRYPTO-02 this is the substrate of the attack. Even after fixing F-CRYPTO-02, adding a `type` discriminator (`"ebp-inner-signed-v1"`) is cheap defence-in-depth.

### F-CRYPTO-10 — No length cap on `reason` strings in revocation certs (Informational)

**Files:** [`core/Revocation.ts:65-75`](../../core/Revocation.ts).

`reason` is signed and stored unbounded. A malicious user could pin megabyte-sized reason strings on the server (server-side body limits do help). Hierarchy certs cap context at 256; revocation reasons should similarly cap (suggest 1024).

### F-CRYPTO-11 — `isProtocolVersionSupported` ignores patch (Informational)

**File:** [`core/version.ts:42-49`](../../core/version.ts).

Compares `major` and `minor` only. Patch differences are silently accepted. Today this is intentional (patch = bug fixes), but the function name does not telegraph that.

## Open question status (from threat-model)

- **Q1** — `@noble/post-quantum` ML-DSA: per upstream README, `ml_dsa87.sign` is hedged (random + deterministic). Verified by inspecting [https://github.com/paulmillr/noble-post-quantum](https://github.com/paulmillr/noble-post-quantum). Resolved.

## Hand-off to Phase 3

Phase 3 will examine the server (`server/`), where `Identity.VerifyDetails` and the various signature-verifying handlers determine whether the client-side findings above are amplified or contained. Particularly important:
- Does the server re-verify each detail proof on `POST /api/v1/identity` (otherwise F-CRYPTO-05 amplifies into trivial detail forgery)?
- Does the server enforce nonce ordering on the emergency-cert path with any special-case logic that mitigates F-CRYPTO-01?

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[../identity-model]]
- [[../revocation-system]]
- [[../message-payload-formats]]
