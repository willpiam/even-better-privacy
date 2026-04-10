---
title: "Message Payload Formats"
type: concept
status: active
last_updated: 2026-04-10
source_count: 3
tags:
  - payload
  - email
  - encryption
  - signing
  - wire-format
---

# Message Payload Formats

EBP defines a family of JSON payload types for signed and encrypted messages. These payloads are used by the [[component-gui|GUI's native email system]], the [[component-cli|CLI]], and the [[component-email-extension|Chrome extension]]. This page documents their structure, what they contain, and what they deliberately omit.

## Armor Wrapping

All payloads are transmitted as JSON wrapped in PEM-style armor markers:

```
-----BEGIN EBP MESSAGE-----
{
  "type": "ebp-encrypted-signed-message",
  ...
}
-----END EBP MESSAGE-----
```

In the GUI's native email system, the armored block is placed directly in the plain-text body of the email (sent via SMTP as `text/plain`). The recipient's mail client displays it as-is; the EBP GUI extracts and parses the block on receipt.

Implementation: `armorPayload()` and `extractArmoredPayload()` in `core/Payloads.ts`.

## Payload Types

### `ebp-encrypted-signed-message` (version 1)

The primary payload used by GUI native email compose (EBP mode). Provides both confidentiality and authenticity.

| Field | Type | Description |
|---|---|---|
| `type` | string | `"ebp-encrypted-signed-message"` |
| `version` | number | `1` |
| `recipientFingerprint` | string | Bech32 [[identity-model|fingerprint]] of the intended recipient |
| `senderFingerprint` | string | Bech32 fingerprint of the sender/signer |
| `ciphertext` | string | Hex-encoded [[ml-kem|ML-KEM]] ciphertext (see below) |
| `senderIdentity` | object? | Optional: sender's public identity (keys, types, fingerprint) |

When `senderIdentity` is present, the recipient can verify the signature without a server lookup. This is controlled by the **"Include your public keys in encrypted emails"** setting in the GUI (enabled by default). When omitted, the recipient resolves the sender's full public identity from local contacts or by fetching from the [[component-server|EBP server]] using the fingerprint.

#### Ciphertext structure

The `ciphertext` field is a hex-encoded byte sequence: `encapsulatedKey || nonce || aesCiphertext`.

| Segment | Size | Description |
|---|---|---|
| Encapsulated key | 1,568 bytes (ML-KEM-1024) | KEM ciphertext bound to recipient's public encryption key |
| Nonce | 12 bytes | Random AES-256-GCM nonce |
| AES ciphertext | variable | AES-256-GCM encrypted inner payload |

The shared secret derived from ML-KEM decapsulation is used directly as the AES-256-GCM key (32 bytes). A fresh encapsulation is performed for every message.

#### Inner payload (after decryption)

Decrypting the AES ciphertext yields a JSON string:

```json
{ "message": "<plaintext>", "signature": "<hex signature>" }
```

The `signature` is produced by signing `buildMessageHashEnvelope(message)` with the sender's signing key ([[ml-dsa]] or [[slh-dsa]]). Verification requires the sender's public signing key, resolved from the `senderFingerprint`.

### `ebp-encrypted-message` (version 1)

Encryption-only payload (no signature). Used when `sign: false` is passed to the encrypt API.

| Field | Type | Description |
|---|---|---|
| `type` | string | `"ebp-encrypted-message"` |
| `version` | number | `1` |
| `recipientFingerprint` | string | Bech32 fingerprint of the intended recipient |
| `ciphertext` | string | Hex-encoded ML-KEM ciphertext |

The ciphertext structure is identical to the encrypted-signed variant, but the inner payload is the raw message string (not wrapped in a `{ message, signature }` JSON object). No sender fingerprint is included since there is no signer.

### `ebp-signed-message` (version 2)

Cleartext signed message — the message is readable without decryption, but its integrity and origin are verifiable.

| Field | Type | Description |
|---|---|---|
| `type` | string | `"ebp-signed-message"` |
| `version` | number | `2` |
| `fingerprint` | string | Bech32 fingerprint of the signer |
| `message` | string | The cleartext message |
| `messageHash` | string | Hash of the message envelope |
| `salt` | string | Random salt used in the hash envelope |
| `signature` | string | Hex-encoded signature over the hash envelope |
| `identity` | object? | Optional: full public identity of the signer |

Unlike the encrypted variants, this type **may** include the signer's full public identity in the `identity` field, allowing standalone verification without a server lookup.

### `ebp-signature` (version 2)

Detached signature — the signature is separate from the message it covers.

| Field | Type | Description |
|---|---|---|
| `type` | string | `"ebp-signature"` |
| `version` | number | `2` |
| `fingerprint` | string | Bech32 fingerprint of the signer |
| `messageHash` | string | Hash of the message envelope |
| `salt` | string | Random salt used in the hash envelope |
| `signature` | string | Hex-encoded signature over the hash envelope |
| `identity` | object? | Optional: full public identity of the signer |

Same as `ebp-signed-message` but without the `message` field. The verifier must have the original message independently.

## Key Material in Payloads: Summary

| Payload type | Sender public keys included? | Sender fingerprint included? |
|---|---|---|
| `ebp-encrypted-signed-message` | Optional (`senderIdentity` field) | Yes |
| `ebp-encrypted-message` | N/A (no sender) | No |
| `ebp-signed-message` | Optional (`identity` field) | Yes |
| `ebp-signature` | Optional (`identity` field) | Yes |

For encrypted payloads, the recipient resolves the sender's identity through (in priority order):

1. **Local contacts** — looked up by name or fingerprint prefix.
2. **EBP server** — `GET /api/v1/identity/{fingerprint}` as a fallback.
3. **Embedded `senderIdentity`** — if present in the payload, the keys are verified against the `senderFingerprint` via fingerprint recomputation. If the fingerprint doesn't match the embedded keys, the embedded identity is rejected.

When verification succeeds using embedded keys (i.e. the sender is not a known contact), the decrypt handler also queries the [[component-server|EBP server]] to check whether the same identity is published there. The response includes a `serverIdentityMatch` field (`true` if the server holds the same keys, `false` if the server has no record or different keys, `null` if not applicable).

## GUI Native Email Flow

The [[component-gui|GUI]] compose form offers two modes:

- **Plain** — body sent as-is, no EBP payload.
- **EBP sign + encrypt** — body is encrypted and signed via `POST /api/v1/encrypt` (with `sign: true`), armored, and sent as the email's plain-text body via SMTP.

GUI compose always uses `sign: true`, so outbound EBP emails are always `ebp-encrypted-signed-message`.

On the receiving side, `GET /api/v1/mail/message` parses the full MIME source and extracts any armored EBP payload from the text or HTML body. If the payload contains a `senderFingerprint` that matches a local contact, the "Sender contact" field is auto-filled. The user then triggers decryption via `POST /api/v1/decrypt`, which decapsulates the ML-KEM ciphertext, decrypts the AES payload, and verifies the signature against the resolved sender identity.

## Version Constants

Payload format versions are defined in `core/version.ts` under `FILE_FORMAT_VERSIONS`:

| Payload | Version |
|---|---|
| `encryptedSignedMessage` | 1 |
| `encryptedMessage` | 1 |
| `signedMessage` | 2 |
| `signature` | 2 |

## Related Pages

- [[identity-model]] — fingerprint construction and dual-key model
- [[ml-kem]] — encryption/KEM scheme details
- [[ml-dsa]] — lattice-based signing scheme
- [[slh-dsa]] — hash-based signing scheme
- [[component-gui]] — GUI native email integration
- [[component-cli]] — CLI sign/encrypt commands
- [[overview]]

## Sources

- `core/Payloads.ts`
- `core/Identity.ts`
- `gui/local-backend/main.ts`
