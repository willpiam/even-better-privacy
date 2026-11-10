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
| V4 recipient-set and attachment-bound envelopes | RFC 8785 canonical JSON and deterministic UTF-16 ordering | Unicode ordering, JSON controls and signatures compared with TypeScript |
| Canonical JSON and state hashing | RFC 8785 serialization and SHA-256 implemented | RFC vectors, number formatting and TypeScript state hashes compared |
| General encoding helpers | Fingerprint decoding, validation and shortening, hex and base64 implemented | Identity fingerprints, round trips and invalid encodings tested |
| HD account derivation | Account seed derivation implemented | Both profiles and account paths compared with TypeScript |
| Mnemonics | Entropy, validation, generation and seed derivation implemented | Existing vectors, supported entropy sizes and Unicode normalization compared with TypeScript |
| HD path strings | Five-segment path parsing, formatting, node derivation and identity creation implemented | Named, numeric, hardened, whitespace and invalid paths compared with TypeScript |
| Identity and storage | Public/private loading, public export options, password- and derived-key v2 storage, and exposed signing/KEM variants implemented | Identity profiles, variants, signatures and encrypted storage exchanged with TypeScript |
| Detail proofs | Creation and verification implemented for safe integer nonces and timestamps | Current proofs exchanged with TypeScript, including Unicode/control characters and tamper rejection |
| Identity details | Signed detail attachment and verified retrieval implemented | Details attached by each implementation survive storage and verify in the other |
| Revocations | Current certificate creation, verification and identity state changes implemented | Certificates and state exchanged with TypeScript |
| Hierarchy certificates | Two-party and separately staged signing, signature verification, expiration and graph checks implemented | Certificates and graph checks compared with TypeScript |
| Payload JSON and armor | Current message and file builders, type/version parsing and armor implemented; parsing does not authenticate payloads | Current signed and multi-recipient payloads exchanged in both directions; older and malformed types rejected |
| File and email attachment envelopes | In-memory cleartext creation and parsing, and encrypted email attachment parsing implemented | File and attachment bytes, Unicode metadata and validation compared with TypeScript |
| Single-recipient ML-KEM + AES-GCM | Implemented for ML-KEM-512, 768 and 1024 raw keys | Ciphertexts exchanged with TypeScript in both directions |
| Signed and encrypted identity messages | Current single-recipient v2 workflow implemented | Both directions, wrong sender and forwarded-recipient rejection |
| Multi-recipient encryption | C content/wrapping primitives and Python recipient orchestration implemented | Mixed KEM variants exchanged in both directions; duplicate and tamper checks |
| Signed multi-recipient workflow | Current v4 workflow implemented in C and Python | Two recipients and supplied content keys exchange in both directions; wrong sender, forwarding and attachment tampering rejected |
| Python distribution | Source-built Linux wheel implemented; system libraries remain required | Wheel built, installed in a clean environment and smoke-tested |

Raw cryptographic primitives are not EBP identity or message operations. Use
the identity and payload APIs when protocol handling is needed. OpenSSL 3.5+
is required for the listed post-quantum algorithms; Argon2 is provided by the
reference libargon2 library. The C API returns allocated output buffers to be
released with `ebp_free`, or `ebp_secure_free` for private key material.
The supported Linux build includes a pinned, patched Jansson parser with private
symbols; it does not depend on or share allocator state with system Jansson.

Public imports may omit one public key if its hash is supplied; verification
requires the signing key and encryption requires the encryption key.
Identity storage accepts the current protocol version `0.1.1` and v2 identity
storage containing v4 ciphertext. It rejects older formats, duplicate JSON
keys, mismatched fingerprints, and private keys that do not match the public
metadata. The shared strict JSON contract rejects duplicate keys, object keys
containing embedded NUL, unpaired Unicode surrogates and non-finite numbers.
Loading an identity preserves public details; it does not automatically verify
them. Detail attachment and revocation update only in-memory state. File I/O
and password prompts are the caller's responsibility.

Detail, revocation and hierarchy proof timestamps and nonces are limited to
JavaScript safe integers. Hierarchy signature verification does not automatically
enforce expiration or graph constraints; use the separate checks. Verification
APIs also expose structured validation status codes for detail proofs,
revocation certificates and hierarchy certificates.
