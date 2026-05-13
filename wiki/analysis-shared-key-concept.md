---
title: "Shared Key Concept"
type: analysis
status: active
last_updated: 2026-05-13
source_count: 8
tags:
  - shared-key
  - aes-gcm
  - fingerprint
  - key-management
  - certificates
---

# Shared Key Concept

## Summary

A shared key should be modeled as a short-lived pairwise content-encryption root between two EBP identities, not as a new identity. The existing identity fingerprint continues to authenticate people/devices; the shared-key fingerprint identifies a high-entropy symmetric secret for local lookup, audit display, and protocol binding.

The proposed bootstrap message fits EBP's current pattern: an encrypted+signed message can carry a certificate that says "the key used to decrypt this certificate has shared-key fingerprint X and may be retained until T." The recipient computes the fingerprint from the actual decrypted key material and accepts the certificate only if the signed claim matches the key used in the decryption path.

## Design Anchors

- Existing EBP identities are dual-key objects: a signing key plus an ML-KEM encryption key, fingerprinted as a bech32-encoded Merkle root over public key leaves. Shared-key fingerprints should use a separate HRP and domain-separated hash so they cannot be confused with identity fingerprints. See [[identity-model]].
- Current encrypted+signed payloads already combine ML-KEM, AES-256-GCM, and signatures. A shared key should initially be introduced through this existing authenticated channel before it is used to replace per-message KEM encapsulation. See [[message-payload-formats]] and [[ml-kem]].
- Reusing one AES-GCM key across multiple messages changes the risk profile. AES-GCM is safe only if nonces are unique for a given key, and protocol metadata should be bound through AAD or signatures. See [[aes-gcm]].
- A 14-day retention window is a cryptoperiod decision. The wiki's key-management page already flags future expiry, rotation, compromise, and destruction work as areas that need explicit assumptions. See [[key-management]].
- The certificate shape should borrow from EBP revocation certificates: signed structured data, canonical signing payload, nonce/serial, timestamp, and independently verifiable signature. See [[revocation-system]].

## Recommended Model

Treat the stored secret as a `SharedKeyRoot`, a random 32-byte value with metadata:

- `keyFingerprint`: bech32 over `SHA-256("EBP shared key v1" || algorithm || key_bytes)`.
- `algorithm`: initially `AES-256-GCM`, or preferably "shared-root-v1" if per-message AEAD keys are derived from the root.
- `issuerFingerprint`: identity that introduced the key.
- `peerFingerprint`: intended peer identity.
- `validFrom`, `expiresAt`, `issuedAt`.
- `direction`: `sender-to-recipient`, `recipient-to-sender`, or `bidirectional`; for bidirectional use, require both identities to sign key-state claims.
- `usage`: narrow purpose, e.g. `message-content-encryption`.
- `serial` or `nonce`: replay-resistant certificate identifier.

The bech32 HRP should be distinct from identity HRPs such as `ebpdk` and `ebpsk`. Candidate HRPs: `ebpsh` for shared keys or `ebpck` for content keys. The important rule is that decoders must dispatch by HRP and type; a shared-key fingerprint must never be accepted where an identity fingerprint is expected.

## Certificate Shape

A first version could be:

```json
{
  "type": "ebp-shared-key-certificate",
  "version": 1,
  "keyFingerprint": "ebpsh1...",
  "algorithm": "shared-root-v1",
  "issuerFingerprint": "ebp...",
  "peerFingerprint": "ebp...",
  "direction": "sender-to-recipient",
  "usage": "message-content-encryption",
  "issuedAt": 1778695200000,
  "validFrom": 1778695200000,
  "expiresAt": 1779904800000,
  "serial": "hex-random-128-bit",
  "signature": "base64..."
}
```

The signature should cover the certificate with `signature: null`, following the revocation-certificate pattern. The enclosing message may also be signed, but the certificate should remain independently verifiable after local storage.

## Retirement and Acceptance Certificates

Either party should be able to retire a shared key by sending a signed `ebp-shared-key-retirement-certificate`. A retirement certificate should name the `keyFingerprint`, the retiring identity, the peer identity, a `retiresAt` timestamp, a reason code, and a serial/nonce. Recipients should treat the effective retirement time as the earliest valid retirement certificate or the original `expiresAt`, whichever comes first.

This should be a local pairwise state transition, not a public revocation by default. Publishing shared-key retirement events would reveal relationship metadata, while local signed retirement preserves auditability between the two identities.

The original recipient should not sign a promise to "keep the key until it retires" in the strong sense. A signature cannot prove future retention, and asking users to promise retention creates a misleading security guarantee. A better return message is an acceptance/receipt certificate:

```json
{
  "type": "ebp-shared-key-acceptance-certificate",
  "version": 1,
  "keyFingerprint": "ebpsh1...",
  "issuerFingerprint": "ebp-original-sender...",
  "acceptorFingerprint": "ebp-original-recipient...",
  "acceptedAt": 1778695200000,
  "notAfter": 1779904800000,
  "acceptedUsage": "message-content-encryption",
  "acceptedDirection": "bidirectional",
  "serial": "hex-random-128-bit",
  "signature": "base64..."
}
```

The acceptance certificate should mean: "I verified and stored this key for this scope until no later than `notAfter`, unless retired earlier." It should not mean: "I guarantee I will retain this key." Software can lose state, users can delete devices, and secure deletion/compromise responses may require earlier destruction.

## Bootstrap Flow

1. Sender generates a fresh shared root and certificate.
2. Sender delivers it inside the existing `ebp-encrypted-signed-message` path, using the recipient identity's ML-KEM key and the sender identity's signing key.
3. Recipient decrypts the message, verifies the sender signature, computes the shared-key fingerprint from the actual keying material, and checks that it matches the certificate.
4. Recipient stores the key only if the certificate is valid, unexpired, addressed to the recipient, and scoped to the sender.
5. Recipient may send an acceptance certificate if the key is intended to support bidirectional use or sender-side state confirmation.
6. Future messages may reference `keyFingerprint` and use the stored shared root, but should still be signed by the sender identity.
7. Either party may later send a retirement certificate to end use before the original expiry.

## Current Tooling Surface

The current single-recipient ML-KEM encrypt path already computes an internal 32-byte `sharedSecret` and uses it directly as the AES-GCM key, but `KyberEncryptionKey.encrypt()` and `KyberEncryptionKey.EncryptFor()` return only the packed ciphertext (`encapsulatedKey || nonce || ciphertext`). They do not expose the AES key/shared secret to callers.

The multi-recipient path does expose a generated 32-byte `contentKey`: `MultiRecipientCipher.encryptForMany()` returns `contentKey`, and `Identity.signAndEncryptForMany()` returns it as hex. That is useful for tests and attachment reuse, but it is not the same thing as capturing the KEM shared secret for a single recipient. It is a content-encryption key wrapped to recipients using ML-KEM.

For this feature, the cleaner implementation is probably not "capture the KEM shared secret" from the existing single-recipient encrypt call. Instead, create an explicit shared-key bootstrap API that generates a random shared root, fingerprints it, signs the certificate, and wraps that root for the peer using the existing KEM channel. This keeps KEM internals separate from the application-level shared-key lifecycle.

## Open Design Questions

- Should the key be usable only from issuer to peer, or can the peer reply using it? Bidirectional use is convenient but should require an acceptance certificate signed by the peer.
- Should future message encryption use the raw shared key directly, or derive a per-message AES-GCM key from the root? Deriving per-message keys is safer because it reduces nonce-management pressure.
- Should retirement certificates be sent only in-band, or should clients also surface a manual "retire local shared key" action that emits a best-effort signed notice?
- What UX should display when a message arrives under an unknown-but-valid shared key, an expired key, or a key whose issuer identity has since been revoked?

## Recommendation

Build this in two phases. First, specify and implement the shared-key fingerprint plus certificate as a bootstrap-only object carried by existing encrypted+signed messages. Second, after storage, expiry, and UX are clear, add a shared-key encrypted payload type that derives per-message AEAD keys from the shared root and signs every message with the existing identity signing key.

This keeps the concept small: shared keys are an optimization and continuity mechanism for message encryption, while EBP identities remain the authority for authentication.

## Sources

- [[identity-model]]
- [[message-payload-formats]]
- [[aes-gcm]]
- [[key-management]]
- [[revocation-system]]
- `core/Kyber.ts`
- `core/MultiRecipientCipher.ts`
- `core/Identity.ts`
