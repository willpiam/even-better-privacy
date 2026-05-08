---
title: "Analysis: Noble Library Usage Across EBP"
type: analysis
status: active
last_updated: 2026-05-06
source_count: 10
tags:
  - analysis
  - crypto
  - dependencies
  - noble
---

# Noble Library Usage Across EBP

This page centralizes where EBP uses the noble ecosystem packages and what each package is used for.

## Packages in scope

| Package | Purpose in EBP | Primary surfaces |
|---|---|---|
| `@noble/post-quantum` | Post-quantum ML-KEM / ML-DSA / SLH-DSA primitives | `core/`, website verifier |
| `@noble/hashes` | SHA-256 hashing and PBKDF2-HMAC-SHA256 KDF support | `core/`, website verifier, storage/envelope hashing paths |
| `@noble/ciphers` | AES-256-GCM symmetric encryption/decryption | `core/` encrypted storage and payload encryption |

## Documented usage by algorithm and package

### `@noble/post-quantum`

- `@noble/post-quantum/ml-kem` is documented as the implementation source for ML-KEM-1024 in `core/Kyber.ts` ([[ml-kem]]).
- `@noble/post-quantum/ml-dsa` is documented as the implementation source for ML-DSA-87 in `core/Dilithium.ts` ([[ml-dsa]]).
- `@noble/post-quantum/slh-dsa` is documented as the implementation source for SLH-DSA-SHA2-256s in `core/Sphincs.ts` ([[slh-dsa]]).
- The website verifier documents browser-side signature verification using `ml_dsa87.verify` and `slh_dsa_sha2_256s.verify`, loaded from `@noble/post-quantum` bundles ([[component-website]]).

### `@noble/hashes`

- `@noble/hashes` is documented as the SHA-256 and PBKDF2 provider in audit summaries of core/storage crypto usage ([[security-audit-2026-04/report]], [[security-audit-2026-04/phase-02-crypto-core]]).
- `randomBytes` from `@noble/hashes/utils` is explicitly called out in the core audit as a CSPRNG source in `core/` ([[security-audit-2026-04/phase-02-crypto-core]]).
- The website verifier documents `@noble/hashes@1.8.0/sha2` for hash-envelope SHA-256 operations ([[component-website]]).

### `@noble/ciphers`

- `@noble/ciphers` is documented in the audit report as the AES-GCM provider used by EBP ([[security-audit-2026-04/report]]).
- Storage review notes explicitly describe AES-256-GCM usage via `@noble/ciphers/aes` ([[security-audit-2026-04/phase-07-storage]]).

## Where this appears in the wiki today

- Scheme pages: [[ml-kem]], [[ml-dsa]], [[slh-dsa]]
- Component page: [[component-website]]
- Audit pages: [[security-audit-2026-04/report]], [[security-audit-2026-04/phase-02-crypto-core]], [[security-audit-2026-04/phase-07-storage]]

## Coverage notes and gaps

- Current noble usage documentation is distributed across scheme/component/audit pages rather than a single canonical component page.
- This analysis is intended to be the central cross-reference entry for "where we use noble" questions.
- If desired, this can later be promoted into a dedicated non-analysis page (for example, `component-noble-libraries`) and linked from crypto/component docs as the canonical dependency map.

## Related Pages

- [[overview]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[component-website]]
- [[aes-gcm]]
- [[identity-model]]

## Sources

- `wiki/ml-kem.md`
- `wiki/ml-dsa.md`
- `wiki/slh-dsa.md`
- `wiki/component-website.md`
- `wiki/security-audit-2026-04/report.md`
- `wiki/security-audit-2026-04/phase-02-crypto-core.md`
- `wiki/security-audit-2026-04/phase-07-storage.md`
- `wiki/message-payload-formats.md`
- `wiki/identity-model.md`
- `wiki/index.md`
