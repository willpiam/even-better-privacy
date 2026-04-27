---
title: "Message Payload Formats"
type: concept
status: active
last_updated: 2026-04-27
source_count: 8
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

In the GUI's native email system, the armored block is placed directly in the plain-text body of the email (sent via SMTP as `text/plain`). SMTP is the transport layer described by [[source-rfc-5321]]; it carries the message but does not authenticate the EBP sender or encrypt the body. The recipient's mail client displays the block as-is; the EBP GUI can fetch the message through IMAP4rev2 concepts described by [[source-rfc-9051]], then extracts and parses the block on receipt.

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

AES itself is specified by [[source-fips-197]], while GCM is specified by [[source-sp-800-38d]]. See [[aes-gcm]] for nonce/IV and associated-data context.

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

### `ebp-encrypted-email-attachment` / `ebp-encrypted-signed-email-attachment` (version 1)

Native GUI email supports MIME-native encrypted attachments using JSON attachment payloads with content type `application/ebp-encrypted-attachment+json`.

| Field | Type | Description |
|---|---|---|
| `type` | string | `"ebp-encrypted-email-attachment"` or `"ebp-encrypted-signed-email-attachment"` |
| `version` | number | `1` |
| `recipientFingerprint` | string | Bech32 fingerprint of intended recipient |
| `senderFingerprint` | string? | Present for signed attachment payloads |
| `attachmentId` | string | Stable attachment identifier for reader/decrypt flow |
| `ciphertext` | string | Hex-encoded ML-KEM + AES-GCM ciphertext of the attachment envelope |

After decrypt, the cleartext envelope contains:

- `fileName`, `mimeType`, `fileSize`, `fileDataBase64`
- `attachmentId`
- optional `bodyPayloadHash` used to bind the attachment to the encrypted message body payload

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
- **EBP sign + encrypt** — body is encrypted and signed, armored, and sent as the email's plain-text body via SMTP. If attachments are selected, each one is encrypted into a MIME attachment payload (`application/ebp-encrypted-attachment+json`) and sent in the same message.

GUI compose always uses `sign: true`, so outbound EBP emails are always `ebp-encrypted-signed-message`.

On the receiving side, `GET /api/v1/mail/message` parses the full MIME source and extracts any armored EBP payload from the text or HTML body plus EBP-encrypted attachment payloads from MIME attachments. If the payload contains a `senderFingerprint` that matches a local contact, the "Sender contact" field is auto-filled. The user then triggers body decryption via `POST /api/v1/decrypt` and attachment decryption via `POST /api/v1/mail/decrypt-attachment`.

## Version Constants

Payload format versions are defined in `core/version.ts` under `FILE_FORMAT_VERSIONS`:

| Payload | Version |
|---|---|
| `encryptedSignedMessage` | 1 |
| `encryptedMessage` | 1 |
| `signedMessage` | 2 |
| `signature` | 2 |
| `encryptedEmailAttachment` | 1 |
| `encryptedSignedEmailAttachment` | 1 |
| `emailAttachmentCleartextEnvelope` | 1 |

## Standards Boundaries

EBP armor is PEM-style wrapping around EBP JSON payloads. It is not OpenPGP armor and does not use OpenPGP packets. The IETF OpenPGP PQC draft summarized in [[source-draft-ietf-openpgp-pqc-17]] is useful comparison material for PQC messaging, but EBP's payloads are a separate format.

EBP's identity and revocation fields also differ from X.509/PKIX certificates and CRLs. See [[x509-pki]] and [[source-rfc-5280]] for that contrast.

Email standards provide carriage and access, not EBP semantics. [[email-transport]] summarizes the SMTP/IMAP boundary: SMTP envelope addresses and IMAP mailbox state are operational metadata, while EBP sender fingerprints, signatures, and encryption live inside the payload format documented here.

## Related Pages

- [[identity-model]] — fingerprint construction and dual-key model
- [[ml-kem]] — encryption/KEM scheme details
- [[aes-gcm]] — AES-GCM mode and nonce context
- [[ml-dsa]] — lattice-based signing scheme
- [[slh-dsa]] — hash-based signing scheme
- [[openpgp-pqc]] — related OpenPGP PQC standards context
- [[email-transport]] — SMTP/IMAP carriage and mailbox access context
- [[component-gui]] — GUI native email integration
- [[component-cli]] — CLI sign/encrypt commands
- [[overview]]

## Sources

- `core/Payloads.ts`
- `core/EmailAttachmentPayload.ts`
- `core/Identity.ts`
- `gui/local-backend/main.ts`
- `gui/local-backend/routes.ts`
- `wiki/raw/NIST.FIPS.197-upd1.pdf` → [[source-fips-197]]
- `wiki/raw/nistspecialpublication800-38d.pdf` → [[source-sp-800-38d]]
- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
- `wiki/raw/rfc5321.txt` → [[source-rfc-5321]]
- `wiki/raw/rfc9051.txt` → [[source-rfc-9051]]
