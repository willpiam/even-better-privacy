---
title: "RFC 8391: XMSS – eXtended Merkle Signature Scheme"
type: source-summary
status: active
last_updated: 2026-04-12
source_count: 1
tags:
  - crypto
  - signatures
  - hash-based
  - xmss
  - post-quantum
  - stateful
---

# RFC 8391: XMSS – eXtended Merkle Signature Scheme

RFC 8391 (May 2018, Informational) specifies the eXtended Merkle Signature Scheme (XMSS), a **stateful** hash-based digital signature system. Published by the IRTF Crypto Forum Research Group, it defines WOTS+ (a one-time signature primitive), single-tree XMSS, and multi-tree XMSS^MT.

## Key Properties

- **Hash-only security:** XMSS relies solely on the properties of cryptographic hash functions — no lattice, code, or number-theoretic assumptions. Security holds even if the collision resistance of the underlying hash function is broken (only second-preimage resistance is needed).
- **Post-quantum:** Resistant to known quantum computer attacks. Parameters with n=32 provide 256-bit classical / 128-bit post-quantum security; n=64 provides 512-bit classical / 256-bit post-quantum.
- **Stateful:** The private key mutates after each signature. Reusing a one-time key state completely breaks security — a forger can produce arbitrary signatures. This is the primary deployment concern.
- **Compact keys, large signatures:** Public and private keys are small, but signatures are large (e.g. ~2,500 bytes for XMSS-SHA2\_10\_256 up to ~9,700 bytes for XMSS-SHA2\_20\_512).

## Building Blocks

### WOTS+ (Winternitz One-Time Signature Plus)

A one-time signature scheme parameterized by hash function, security parameter n, and Winternitz parameter w. Each WOTS+ key pair can sign exactly one message. The w parameter trades off signature size for signing/verification speed (all RFC 8391 parameter sets use w=16).

### XMSS (Single-Tree)

Combines 2^h WOTS+ key pairs via a Merkle hash tree. The tree root is the long-term public key. Each signature includes the WOTS+ signature, the OTS public key, and the authentication path through the tree. Tree height h determines the total number of signatures possible per key pair.

### XMSS^MT (Multi-Tree)

A hypertree of d layers of XMSS trees. The top tree signs roots of subtrees, which in turn sign further subtrees, with the bottom layer signing actual messages. This dramatically speeds up key generation (avoiding a single enormous tree) and enables distributed key management across cryptographic modules.

## Approved Parameter Sets (REQUIRED)

### XMSS (Single-Tree)

| Name | Hash | n | w | len | h | Sig Size | #Sigs |
|---|---|---|---|---|---|---|---|
| XMSS-SHA2\_10\_256 | SHA2-256 | 32 | 16 | 67 | 10 | 2,500 B | 2^10 |
| XMSS-SHA2\_16\_256 | SHA2-256 | 32 | 16 | 67 | 16 | 2,692 B | 2^16 |
| XMSS-SHA2\_20\_256 | SHA2-256 | 32 | 16 | 67 | 20 | 2,820 B | 2^20 |

Default recommendation: **XMSS-SHA2\_20\_256** (2^20 signatures per key pair).

### XMSS^MT (Multi-Tree, Selected)

| Name | Hash | n | h | d | #Sigs |
|---|---|---|---|---|---|
| XMSSMT-SHA2\_20/2\_256 | SHA2-256 | 32 | 20 | 2 | 2^20 |
| XMSSMT-SHA2\_40/4\_256 | SHA2-256 | 32 | 40 | 4 | 2^40 |
| XMSSMT-SHA2\_60/3\_256 | SHA2-256 | 32 | 60 | 3 | 2^60 |

Default recommendation: **XMSSMT-SHA2\_60/3\_256** for the most generic requirements.

Optional parameter sets use SHA2-512, SHAKE128, and SHAKE256 with n=32 or n=64.

## Hash Function Instantiation

The RFC defines keyed hash functions F, H, H\_msg, and PRF using domain-separated constructions:
- SHA2: `SHA2-256(toByte(domain, 32) || KEY || M)` for n=32
- SHA3: `SHAKE128(toByte(domain, 32) || KEY || M, 256)` for n=32

Domain bytes 0–3 distinguish F, H, H\_msg, and PRF respectively.

## Security Proof

A full proof appears in Hülsing, Rijnveld, Schwabe 2016 ([HRS16]). The proof requires:
- F and H: post-quantum multi-function multi-target second-preimage resistant
- PRF: post-quantum pseudorandom function
- H\_msg: post-quantum multi-target extended target collision resistant

Indexed randomized hashing `H(r || root || idx, M)` prevents multi-user multi-target attacks on message hashing.

## Relationship to EBP

EBP does **not** use XMSS or XMSS^MT directly. EBP uses [[slh-dsa]] (SPHINCS+, FIPS 205), which is a **stateless** hash-based signature scheme descended from the same design lineage. SLH-DSA was specifically created to eliminate the state-management burden of XMSS/LMS — at the cost of much larger signatures (~30 KB for SLH-DSA-SHA2-256s vs ~2.8 KB for XMSS-SHA2\_20\_256).

XMSS is relevant background because:
- It establishes the hash-only security model that SLH-DSA inherits.
- [[source-sp-800-208]] (NIST SP 800-208) profiles XMSS for federal use, making it the first NIST-recommended post-quantum signature scheme.
- The Merkle-tree and WOTS+ primitives in XMSS are also core building blocks inside SLH-DSA's hypertree structure.

## Related Pages

- [[slh-dsa]]
- [[source-sp-800-208]]
- [[source-fips-205]]
- [[overview]]

## Sources

- `wiki/raw/rfc8391.txt` (IRTF RFC 8391, May 2018)
