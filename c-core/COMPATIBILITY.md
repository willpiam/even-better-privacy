# C core compatibility

The target is current TypeScript core formats and operations. Earlier storage,
signature, or payload formats and compatibility fallbacks are out of scope.
The shared TypeScript application logic in `common/` is outside this port.

| Area | C / Python status | Cross-language coverage |
| --- | --- | --- |
| SHA-256 | Implemented | Matching UTF-8 message hashes |
| AES v4 with derived keys | Implemented | Ciphertexts exchanged in both directions; auth failures and older versions |
| Argon2id and password AES v4 | Implemented | Derived key comparisons and ciphertext exchange |
| ML-DSA-87, SLH-DSA-SHA2-256s, ML-KEM-1024 | Low-level primitives implemented | Seeded key byte comparisons, signatures and KEM in both directions |
| Other exposed PQ variants | Raw signing and KEM primitives implemented | Seeded keys, signatures and encapsulations exchanged for each TypeScript-exposed variant |
| Fingerprints | Public-key fingerprint generation implemented | Both current profiles compared with TypeScript |
| Purpose-bound signature envelopes | Implemented for text messages | All four purposes and TypeScript Identity signatures exchanged in both directions |
| Single-recipient signature envelope | Implemented | Compared with TypeScript; recipient-bound signature checked |
| V3 recipient-set and attachment-bound envelopes | Implemented with ICU collation | Unicode ordering, JSON controls and signatures compared with TypeScript |
| Other encodings and general canonical JSON | Not implemented | None |
| HD account derivation | Account seed derivation implemented | Both profiles and account paths compared with TypeScript |
| Mnemonics | Entropy, validation, generation and seed derivation implemented | Existing vectors, supported entropy sizes and Unicode normalization compared with TypeScript |
| HD path strings | Five-segment path parsing and node derivation implemented | Named, numeric, hardened, whitespace and invalid paths compared with TypeScript |
| Identity and storage | Creation, public-only/private loading, full and partial public imports, v2 password storage and purpose-bound signatures implemented | Both identity profiles, public/private loading, signatures and encrypted storage exchanged with TypeScript |
| Detail proofs | Creation and verification implemented for safe integer nonces and timestamps | Current proofs exchanged with TypeScript, including Unicode/control characters and tamper rejection |
| Identity details | Signed detail attachment and verified retrieval implemented | Details attached by each implementation survive storage and verify in the other |
| Revocations | Current certificate creation, verification and identity state changes implemented | Certificates and state exchanged with TypeScript |
| Hierarchy certificates | Two-party creation, signature verification, expiration and graph checks implemented | Certificates and graph checks compared with TypeScript |
| Payload JSON and armor | Current type/version parsing and armor implemented; most field validation and authenticated workflows remain | Current signed and multi-recipient payloads exchanged in both directions; older and malformed types rejected |
| Cleartext file envelopes | In-memory creation and parsing implemented | File bytes, Unicode metadata and base64 variants exchanged with TypeScript |
| Single-recipient ML-KEM + AES-GCM | Implemented for ML-KEM-512, 768 and 1024 raw keys | Ciphertexts exchanged with TypeScript in both directions |
| Signed and encrypted identity messages | Current single-recipient v2 workflow implemented | Both directions, wrong sender and forwarded-recipient rejection |
| Multi-recipient encryption | C content/wrapping primitives and Python recipient orchestration implemented | Mixed KEM variants exchanged in both directions; duplicate and tamper checks |
| Signed multi-recipient workflow | Current v3 workflow implemented in C and Python | Two recipients and supplied content keys exchange in both directions; wrong sender, forwarding and attachment tampering rejected |
| Python distribution | Source-built Linux wheel implemented; system libraries remain required | Wheel built, installed in a clean environment and smoke-tested |

Raw cryptographic primitives are not EBP identity or message operations. They
must not be used as a substitute for the missing protocol handling. OpenSSL 3.5+
is required for the listed post-quantum algorithms; Argon2 is provided by the
reference libargon2 library. The C API returns allocated output buffers to be
released with `ebp_free`, or `ebp_secure_free` for private key material.

Public imports may omit one public key if its hash is supplied; verification
requires the signing key and encryption requires the encryption key.
Identity storage accepts the current protocol version `0.1.1` and v2 identity
storage containing v4 ciphertext. It rejects older formats, duplicate JSON
keys, mismatched fingerprints, and private keys that do not match the public
metadata. Jansson rejects JSON object keys containing embedded NUL, which the
TypeScript implementation can accept; such identity storage and payloads are rejected.
The parser also rejects unpaired Unicode surrogates in JSON strings.
Loading an identity preserves public details; it does not automatically verify
them. Detail attachment and revocation update only in-memory state. File I/O
and password prompts are the caller's responsibility.

Detail, revocation and hierarchy proof timestamps and nonces are limited to
JavaScript safe integers; fractional timestamps accepted by TypeScript are not
yet supported. Hierarchy signature verification does not automatically enforce
expiration or graph constraints; use the separate checks. The multi-recipient
attachment ordering defaults to ICU `en-US`; callers must match the TypeScript
runtime locale, and ICU version differences can affect Unicode ordering. Other
payload workflows and general canonical JSON remain incomplete.
