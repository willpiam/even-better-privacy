---
title: "EBP Revocation System"
type: concept
status: active
last_updated: 2026-04-09
source_count: 3
tags:
  - revocation
  - trust
  - certificates
  - nonce
---

# EBP Revocation System

EBP supports signed revocation for both individual identity details and entire identities. Only the identity holder can revoke their own data — all revocations require a valid signature from the identity's signing key.

## Revocation Types

### Detail Revocation

Removes a specific detail path (e.g., an old email) from an identity. Use cases:
- Information has changed (new email address)
- Information was entered incorrectly
- Detail should no longer be associated with the identity

Detail revocation is also a **prerequisite for updating a detail** — the server enforces one active value per detail path. To change an email, for example, you must revoke the old value before setting the new one. See [[identity-model#Updating a Detail]] for the full workflow.

CLI: `ebp revoke-detail <path> [--reason <reason>] [--push]`

### Identity Revocation

Marks an entire identity as compromised or invalid. **This is irreversible.** Use cases:
- Private key compromised
- Migrating to a new identity
- Identity should no longer be trusted

CLI: `ebp revoke --reason <reason> --force [--push]`

## Certificate Structure

Every revocation produces a signed certificate (`core/Revocation.ts`):

```
RevocationCertificateData {
  type: "detail" | "identity"
  fingerprint: string        // identity fingerprint
  nonce: number              // monotonically increasing
  timestamp: number          // Unix ms
  reason?: string            // human-readable
  target?: string            // detail path (for detail revocations)
  signature: string | null   // null before signing
}
```

The certificate is signed over a JSON payload with `signature: null`, then the signature is attached. The signed certificate is hex-encoded for storage and transmission.

## Nonce Protection

- Revocation nonces must be **strictly increasing** — the server and clients reject certificates with nonces ≤ the highest previously seen nonce.
- This prevents replay attacks: an attacker cannot re-submit an old revocation certificate.
- Emergency revocation certificates use **nonce 0** as a special case (see below).

## Emergency Revocation Certificates

Pre-generated certificates that can revoke an identity even if the private key is lost:

- Generated at identity creation (`--revocation-cert`) or later (`generate-revocation-cert`).
- Use nonce 0, which is accepted as long as nonce 0 hasn't been used before.
- Should be stored securely (printed, safe deposit box) — anyone with this certificate can revoke the identity.
- One-time use: once applied, nonce 0 is consumed.

## Server Integration

The [[component-server|server]] validates and stores revocation certificates:

- `POST /api/v1/revoke` accepts a revocation payload with fingerprint, type, target, and certificate.
- Server verifies the signature using the identity's public signing key and checks nonce validity.
- `GET /api/v1/identity/:fingerprint` returns `revoked` boolean, `revocationCertificate`, and `revokedDetails` array.
- `GET /api/v1/revocations/:fingerprint` returns the full revocation history.

## Client-Side Behavior

- The [[component-cli|CLI]] strips revoked details locally and saves the identity.
- The [[component-gui|GUI]] backend strips `revokedDetails` from fetched contacts before saving (fixed in [[analysis-sync-revoked-details-bug]]).
- Applications should warn users when interacting with revoked identities or details.

## Verification

Anyone can verify a revocation certificate using the identity's public signing key:

1. Decode the hex-encoded certificate.
2. Reconstruct the signing payload (certificate with `signature: null`).
3. Verify the signature using the identity's signing scheme and variant.
4. Check that the fingerprint matches.

Implementation: `verifyRevocationCertificate()` in `core/Revocation.ts`

## Related Pages

- [[identity-model]]
- [[component-cli]]
- [[component-server]]
- [[component-gui]]
- [[analysis-sync-revoked-details-bug]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Revocation.ts`
- `core/Identity.ts`
