---
title: Current Core Format Contract
type: concept
status: active
tags:
  - wire-format
  - signing
---

# Current Core Format Contract

TypeScript, C, and Python use RFC 8785 JSON Canonicalization Scheme (JCS).
Canonical text is encoded as UTF-8 before hashing. JCS uses ECMAScript number
serialization and orders property names by UTF-16 code units, independent of
locale. Protocol input additionally rejects duplicate JSON keys, NUL in object
keys, unpaired surrogates, and non-finite numbers. Nonces and timestamps must
be JavaScript safe integers; individual formats can impose stricter bounds.

The identity state hash is the lowercase SHA-256 hex digest of canonical JSON
containing `fingerprint`, `signingKeyType`, `encryptionKeyType`, `signingKey`,
`encryptionKey`, `signingKeyDetails`, `encryptionKeyDetails`, and `details`.
Missing key-detail metadata is represented as JSON `null`.

## Signed records

The records below have version 2. Their encoded representation is the hex
encoding of their UTF-8 JSON. Signatures are base64. For each record, hash the
UTF-8 bytes of its canonical signing object using SHA-256, then sign the UTF-8
bytes of the corresponding string below. The final `::` is present even when
the optional signature salt is empty. These formats use an empty signature
salt; the hierarchy certificate's `salt` is a field of its signing object.

| Record | Canonical signing object | Signed string |
| --- | --- | --- |
| Detail proof | `version`, `nonce`, `path`, `detail`, `timestamp`, and `signature: null` | `ebp::detail-proof::v2::<sha256-hex>::` |
| Revocation | `version`, `type`, `fingerprint`, `nonce`, `timestamp`, optional `reason` and `target`, and `signature: null` | `ebp::revocation::v2::<sha256-hex>::` |
| Hierarchy certificate | `version`, `type: "HierarchyCertificate"`, `masterFingerprint`, `childFingerprint`, `timestamp`, `expiry`, `context`, and `salt` | `ebp::hierarchy::v2::<sha256-hex>::` |

Both hierarchy participants sign the same hierarchy string. The encoded
certificate has `masterSignature` and `childSignature` fields instead of the
signing object's `type` field. A draft can carry either signature before the
other signer adds theirs. Authenticating the certificate requires both
signatures; expiration and graph checks are separate operations.

The current multi-recipient signed envelope is v4 and its outer payload is v2;
its exact fields and ordering are described in [[message-payload-formats]].
Earlier detail proofs, revocations, hierarchy certificates and v3
multi-recipient signatures are rejected. Existing current-format encrypted
identity storage can be loaded, but embedded older proofs must be recreated.
