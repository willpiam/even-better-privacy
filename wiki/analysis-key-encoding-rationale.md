---
title: "Analysis: Signing vs KEM Key Encoding"
type: analysis
status: active
last_updated: 2026-05-26
source_count: 18
tags:
  - analysis
  - encoding
  - interoperability
  - keys
  - wire-format
---

# Signing vs KEM Key Encoding

EBP currently uses two different text encodings for public key material:

- Signing public keys and signatures use RFC 4648 Base64, including the standard
  Table 1 alphabet and padding.
- ML-KEM/Kyber public keys, private keys in key JSON, and single-recipient KEM
  ciphertext payloads use lowercase hex.

This is a serialization convention, not a cryptographic requirement. A port must
match it byte-for-byte because the encodings feed identity fingerprint
derivation and payload verification, but ML-DSA, SLH-DSA, and ML-KEM themselves
operate on raw bytes.

## Evidence

The signing classes expose public keys as `bytesToBase64(...)`, sign methods
return Base64 signatures, and verification decodes both the signature and public
key from Base64 before calling the post-quantum primitive. This applies to both
[[ml-dsa]] and [[slh-dsa]].

The KEM class exposes the ML-KEM public key as hex, parses recipient encryption
keys with `hexToBytes(...)`, returns encrypted single-recipient payloads as
`encapsulatedKey || nonce || ciphertext` encoded as hex, and serializes the
ML-KEM secret key as hex. See [[ml-kem]].

The split is part of fingerprint construction: `computeSigningLeafRaw()`
hashes `base64_decode(signingPublicKey)`, while `computeEncryptionLeafRaw()`
hashes `hex_decode(encryptionPublicKey)`. See [[identity-model]] and
[[analysis-reimplementation-building-blocks]].

## Why the Split Exists

Both encodings predate EBP. RFC 4648 standardized Base16/hex and Base64 in 2006
to reduce ambiguity around alphabets, padding, line wrapping, and decoder
behavior. The broader habits are older still: Base64 is a compact way to carry
arbitrary bytes through text formats, while hex is easy to inspect, compare, and
segment by byte boundaries.

The exact EBP split does not appear to come from the NIST algorithm standards or
the OpenPGP PQC work. FIPS 203/204/205 specify ML-KEM, ML-DSA, and SLH-DSA in
terms of byte strings and byte lengths, while OpenPGP PQC integrates these
algorithms into OpenPGP packets rather than EBP's JSON payloads.

The split also does not appear to originate as a noble default. EBP imports
`@noble/post-quantum` primitives from `deno.json`, but the noble ML-DSA,
SLH-DSA, and ML-KEM APIs operate on `Uint8Array` values: key generation returns
byte-array public/secret keys, signing returns a byte-array signature, and
ML-KEM encapsulation returns byte-array ciphertext/shared-secret values. EBP's
wrapper classes convert those bytes to Base64 or hex at their public API and
JSON boundaries.

The wiki does not record a single intentional design rationale for choosing
Base64 on the signing side and hex on the KEM side. The safest interpretation is
historical API and wire-format consistency:

- Signing keys/signatures were implemented as Base64-returning API strings and
  later documented as RFC 4648 Base64 for signed-message interoperability.
- KEM encryption was implemented as a binary concatenation that is hex-framed
  for easy parsing and debugging, and that convention extended to ML-KEM public
  and private key JSON.

Base64 is more compact than hex, especially for large post-quantum signatures
and public keys. Hex is simpler to inspect and segment, but doubles byte length.
So the current KEM hex choice is not size-optimal; it is an established EBP
compatibility rule.

## Interop Notes

Unqualified "Base64" in EBP means RFC 4648 Base64, not base64url, unless a field
explicitly says otherwise. Hex fields should be lowercase on output and parsed
strictly as Base16 byte strings.

`message-payload-formats` has a contradiction log noting that older text
described signatures as hex, but the implemented and documented signed-message
fields use Base64. Treat any remaining placeholder text that says "hex
signature" as stale unless a specific payload field is updated to say otherwise.

For sign-then-encrypt flows, EBP does not encrypt raw signature bytes directly.
The signing wrapper returns a Base64 signature string, then `Identity` places
that string in an inner JSON object beside the message and envelope metadata.
The JSON text is UTF-8 encoded and encrypted with ML-KEM-derived AES-GCM. After
decryption, verification Base64-decodes the signature string back to raw bytes
before calling the ML-DSA or SLH-DSA verifier.

## What Unifying Key Encoding Would Involve

Unifying key material only means changing public/private key strings, not every
binary field. This is materially smaller than converting all byte strings, which
would also touch signatures, ciphertexts, nonces, hashes, proofs, revocation
certificates, and attachment/file payloads.

If the goal is a single key-material encoding, Base64 is the lower-friction
target because signing keys/signatures already use Base64 and ML-KEM keys are
large enough that hex has a significant size penalty. A Base64-key migration
would mainly move ML-KEM public/secret keys from hex to Base64.

Required work:

1. Define the canonical key encoding in protocol/version docs and helper APIs.
   The code should decode key strings to raw bytes before hashing, verifying,
   encrypting, or comparing, so text encoding changes do not accidentally become
   cryptographic changes.
2. Update `KyberEncryptionKey` public/private key serialization:
   `publicKey`, `toJSON()`, `fromJSON()`, `fromPublicKey()`, and recipient
   parsing in `EncryptFor()` currently assume hex.
3. Update fingerprint derivation while preserving existing fingerprints.
   `computeSigningLeafRaw()` and `computeEncryptionLeafRaw()` should both hash
   decoded key bytes. Existing fingerprints can remain stable if old hex ML-KEM
   keys and new Base64 ML-KEM keys decode to the same raw key bytes before
   hashing.
4. Add dual-read/canonical-write migration for local identity storage, contacts,
   and public exports. `~/.ebp/*.identity.json` stores public keys outside the
   encrypted blob and private key JSON inside the AES-encrypted blob; both need
   migration.
5. Handle server compatibility. The server stores `signing_key` and
   `encryption_key` as text and includes those strings in state hashes. A
   re-encoded key with identical bytes is still a different state string, so
   publish/update flows need either explicit versioned migration, canonicalized
   server comparison, or a planned breaking protocol cutover.
6. Update embedded/public identity consumers: encrypted payloads may include
   `senderIdentity`, CLI/GUI import/export share public identity JSON, and the
   static website verifier mirrors fingerprint and signature logic outside
   `core/`.
7. Update tests, fixtures, generated test identities, and reimplementation
   guidance. Cross-language ports currently need strict hex and Base64 handling;
   they would need updated vectors for the new canonical key strings.

The main risk is confusing "same bytes" with "same string." The fingerprint can
be preserved if it is always derived from decoded key bytes, but signed state
transitions and database identity equality currently use the literal key
strings. Those textual surfaces need a migration story before changing emitted
keys.

## Related Pages

- [[identity-model]]
- [[message-payload-formats]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[ml-kem]]
- [[source-rfc-4648]]
- [[analysis-reimplementation-building-blocks]]
- [[component-cli]]
- [[component-gui]]
- [[component-server]]

## Sources

- [[identity-model]]
- [[message-payload-formats]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[ml-kem]]
- [[source-rfc-4648]]
- [[analysis-reimplementation-building-blocks]]
- `core/Dilithium.ts`
- `core/Sphincs.ts`
- `core/Kyber.ts`
- `core/Fingerprint.ts`
- `core/Identity.ts`
- `core/MultiRecipientCipher.ts`
- `server/crypto.ts`
- `server/handlers/identity.ts`
- `server/db/`
- `website/crypto.js`
- `deno.json`
- `@noble/post-quantum@0.5.4` API docs inspected with `deno doc`
