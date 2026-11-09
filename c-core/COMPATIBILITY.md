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
| Other exposed PQ variants | Not implemented | None |
| Fingerprints | Public-key fingerprint generation implemented | Both current profiles compared with TypeScript |
| Purpose-bound signature envelopes | Implemented for text messages | All four purposes and TypeScript Identity signatures exchanged in both directions |
| Single-recipient signature envelope | Implemented | Compared with TypeScript; recipient-bound signature checked |
| Other encodings, canonical JSON and multi-recipient envelopes | Not implemented | None |
| HD account derivation | Account seed derivation implemented | Both profiles and account paths compared with TypeScript |
| Mnemonics and arbitrary HD paths | Not implemented | None |
| Identity and storage, details and proofs | Not implemented | None |
| Revocations and hierarchy certificates | Not implemented | None |
| Message, file and attachment payloads | Not implemented | None |
| Single-recipient ML-KEM-1024 + AES-GCM | Implemented for raw keys | Ciphertexts exchanged with TypeScript in both directions |
| Multi-recipient encryption | Not implemented | None |
| Installable Python distribution | Not implemented | None |

Raw cryptographic primitives are not EBP identity or message operations. They
must not be used as a substitute for the missing protocol handling. OpenSSL 3.5+
is required for the listed post-quantum algorithms; Argon2 is provided by the
reference libargon2 library. The C API returns allocated output buffers to be
released with `ebp_free`, or `ebp_secure_free` for private key material.
