# Legacy and compatibility inventory

Unsupported data is rejected. Identity storage v2 with current AES v4 ciphertext
is the one supported recovery format: loading it preserves keys and state, and
the next save writes authenticated identity storage v3. V2 public metadata was
not authenticated, so use a trusted copy for recovery. V3 binds its entire public
snapshot to the ciphertext; changing the version to v2 does not bypass that
authentication. Older AES formats remain unsupported. Keep a backup before
deliberately discarding local development data.

## Removed

The unused minimum-protocol/semver-range helpers and their tests were also
removed. Identity storage checks the exact current protocol version; each other
payload reader validates its current format tag.

| Area                       | Removed behavior                                                                                      | Current behavior                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity encryption        | AES v1/v2 PBKDF2 and v3 without metadata binding; KDF upgrade-on-unlock                               | Only AES v4, Argon2id, and metadata-bound AES-GCM are accepted by every reader, including public-only reads.                                    |
| Identity passwords         | Retrying with a trimmed password                                                                      | Password bytes are used exactly as entered.                                                                                                     |
| Private identity metadata  | Unused upgrade flags, dead rewrite helpers, and inferring missing nonces from old proofs              | Explicit key types must match the public keys; the stored details nonce must be present and valid.                                              |
| Mail credentials           | Plaintext stores, the single-default-account layout, previous email PIN migration, and `/mail/unlock` | Per-account credential maps must be encrypted with the verified identity password. Existing incompatible stores are never silently overwritten. |
| Mail account configuration | Converting a single account object into a store                                                       | Current stores contain an account list and selected account ID.                                                                                 |
| Verification tokens        | Scanning plaintext historical tokens when the hash lookup fails                                       | Confirmation looks up the token hash only.                                                                                                      |
| Database startup           | Repeated `ALTER TABLE` upgrades for old schemas                                                       | Fresh schemas already declare the current columns. Recreate obsolete development databases.                                                     |
| Local permissions          | Recursively repairing old installations at every startup                                              | New private directories and files are created with restrictive modes; atomic identity writes preserve those modes.                              |
| Fingerprints               | The hexadecimal-to-Bech32 migration script                                                            | New identities and contacts use the current Bech32 format.                                                                                      |
| Signatures                 | Unused old message-hash builder and unreachable “valid unbound” UI/status branches                    | Unsupported signatures fail verification; signed envelopes must bind the intended recipient.                                                    |
| Mobile APIs                | Unused `listInboxMessages` wrapper and combined `RootStackParamList` alias                            | Use paginated mailbox APIs and stack-specific navigation types.                                                                                 |
| Demo identities            | Seven obsolete AES v1 fixtures without protocol metadata                                              | Regenerated fixtures use the current identity format, protocol, keys and proofs. They remain documented-password test data only.                |

## Retained deliberately

| Area                                             | Reason                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Current format numbers                           | A version numbered 1 or 2 is not automatically obsolete. `core/version.ts` defines the current version separately for each payload type.     |
| Protocol version checks                          | These validate current protocol interchange and reject unsupported versions; private identity storage requires the current protocol version. |
| Cross-client compatibility tests                 | CLI, GUI, mobile, website, C and Python interoperability is active functionality, not an older-format fallback.                              |
| PBKDF2 for the current mail vault and BIP39      | These are separate, current formats. Removing old identity PBKDF2 does not change mail-vault or mnemonic key derivation.                     |
| Native C and Python identity readers             | Like TypeScript, they write authenticated v3 storage and accept v2/AES-v4 storage for recovery and upgrade on save.                            |
| Old-format rejection tests                       | Historical inputs remain useful regression cases, but production code cannot create or accept those old formats.                             |
| Optional verification-token debug storage        | Local tests can inspect a generated token; confirmation still requires its stored hash. Plaintext-only records are unsupported.              |
| Historical audit/wiki/planning documents         | These describe past behavior and findings; they are not runtime support.                                                                     |
| Vendored dependencies and platform compatibility | Upstream portability code is not an EBP data migration path and was not edited.                                                              |

Searches covered `legacy`, `deprecated`, compatibility fallbacks, migration
helpers, old KDF branches, startup schema upgrades, and their callers and tests.
The native implementations were checked against the same current-format
boundary.
