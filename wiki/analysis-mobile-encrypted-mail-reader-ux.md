---
title: "Mobile Encrypted Mail Reader UX"
type: analysis
status: active
last_updated: 2026-07-21
source_count: 9
tags:
  - analysis
  - mobile
  - email
  - decrypt
  - ux
  - authenticity
  - verify-email
---

# Mobile Encrypted Mail Reader UX

## Problem

On [[component-mobile]], opening an EBP-encrypted mail shows the raw message body (armored JSON / hex ciphertext from [[message-payload-formats]]) **above** the decrypt control. Users must scroll a long ciphertext block to reach **Decrypt EBP body**; after decrypt, plaintext is appended **below** that button, so they scroll again to see the result.

Ciphertext is not actionable for typical readers. It should stay hidden unless the user explicitly asks for technical detail (e.g. an **(i)** control).

Separately, after decrypt the reader only surfaces a status string (“Decrypted and verified” / “Decrypted (unsigned)”). That is not enough for a clear authenticity judgment: users need a compact **signature / From-binding / email-endorsement** indicator and a drill-down page that explains who signed and what is known about them.

This is separate from decrypt correctness ([[analysis-mobile-mail-decrypt-invalid-json]]): MIME decode may succeed while the reader UX remains ciphertext-first and authenticity-opaque.

## Current layout (evidence)

`mobile/src/screens/mail/MailMessageScreen.tsx` order:

1. Status banner (“EBP payload detected…”)
2. Subject
3. Full `body` in a card (`detail.bodyText || detail.bodyHtml`) — for EBP mail this is usually the armor block
4. Decrypt button (only if `hasEbp`)
5. Decrypted plaintext card (only after success)

`decryptMailBody` currently returns `{ plaintext, verified }` only — no sender fingerprint, From match, or `detailsMeta` endorsement summary.

So the primary reading surface is wire payload, and authenticity is a one-line status at best.

## Recommended UX

Treat EBP mail as a **locked message**, then after unlock as a **signed message with an authenticity affordance** — not a plain MIME body with a decrypt footer.

### 1. Default view when `ebpPayload` is present

| Zone | Content |
|------|---------|
| Header | Subject (+ From/date if available) |
| Status | Short locked state: e.g. “Encrypted with EBP” / “Decrypt to read” |
| Primary CTA | **Decrypt** (and password prompt) **above the fold** — first interactive control after the header |
| Body slot | Placeholder card: “This message is encrypted.” No armor, no hex |
| Disclosure | Compact **(i)** / “Technical details” for armor / payload type / fingerprints (wire debug, not authenticity) |

Do **not** render `bodyText`/`bodyHtml` as the main content when a parseable EBP payload exists.

### 2. After successful decrypt

- **Replace** the placeholder in the same body slot with plaintext (do not append below the button).
- Show a tappable **authenticity indicator** near the subject / From line (see §3).
- Leave Decrypt available as secondary (“Decrypt again”) only if needed; primary focus stays on plaintext.
- Optionally scroll the body slot into view after decrypt so success is obvious without hunting.

### 3. Authenticity indicator (inline)

A small icon (check, X, or colored circle — optionally composite) summarizing three independent questions. SMTP From alone is **not** EBP authenticity ([[email-transport]]); the indicator must reflect cryptographic and identity-detail state.

| Dimension | Green / check | Amber / caution | Red / X | Neutral / grey |
|-----------|---------------|-----------------|---------|----------------|
| **Signature** | Crypto verify succeeded on signed payload | — | Signature present but invalid | Unsigned (`ebp-encrypted-message`) / not yet decrypted |
| **From ↔ identity** | IMAP/SMTP From matches a claimed `email` or `opaque::email` on the signer’s identity ([[identity-model]], same matching rules as [[analysis-mobile-compose-recipient-resolve]]) | Identity has email claim(s) but none match From | Explicit mismatch when a claim exists and From differs | No email / opaque::email claim on resolved identity |
| **Email endorsement** | Matching email path has `detailsMeta[path].verified === true` (server verify-email link flow, [[component-server]]) | Email claim exists but unverified | — (treat forged endorsement attempts via invalid proofs as part of detail validity, not a separate icon state) | No email claim to endorse |

**Presentation guidance:**

- Prefer one glanceable glyph driven by the **worst** of {signature, From-binding} first; endorsement can be a second badge or folded into the drill-down if a single icon would overclaim.
- Never show green for “From matches” alone without a valid signature — transport From is spoofable.
- Unsigned-but-decrypted mail should not look like a verified sender.

Tap the indicator → **Sender authenticity** screen (§4). Keep wire **(i)** separate so “who is this?” and “show ciphertext” stay distinct.

### 4. Sender authenticity screen (drill-down)

This is the page users visit to understand sender authenticity. Content should answer the user’s questions in plain language, then show supporting facts.

#### A. Who signed?

- Signer fingerprint (`senderFingerprint` from payload).
- Local contact name if known; else “Unknown contact”.
- How keys were resolved ([[message-payload-formats]]): local contact → server identity → embedded `senderIdentity` (and whether embedded keys recomputed to the fingerprint).
- Optional: `serverIdentityMatch` when verification used embedded keys (same keys published on server / absent / mismatch), if mobile decrypt exposes it (GUI already does).

#### B. Does this identity claim an email?

Inspect resolved identity details ([[identity-model]]):

| Claim type | What to show |
|------------|--------------|
| `email` | Cleartext address(es) from published detail |
| `opaque::email` | That an opaque email detail exists; whether the **message From** hashes to that opaque value (compose already matches via `sha256Hex` / `resolvedOpaqueDetails` — [[analysis-mobile-compose-recipient-resolve]]); do not invent cleartext if only the hash is known |
| Neither | Explicit: “No email detail on this identity” |
| Revoked email paths | Omit or mark revoked (strip revoked details like contact sync) |

Local-only notes (`localEmail`) are **not** published claims — do not treat them as identity email for authenticity (same rule as compose).

#### C. Is that email endorsed (verified)?

[[component-server]] exposes `POST /api/v1/verify-email/request` and `GET/POST /api/v1/verify-email`: the holder opens a link sent to the address to establish an endorsement from that email to the identity. Client-visible state lives in `detailsMeta[path].{ verified, verifiedAt }` on server/contact records.

Show for each relevant path (`email` and/or matching `opaque::email`):

- Verified or not
- `verifiedAt` when present
- Plain explanation: verified means they completed the link-in-email procedure; unverified means the identity merely *claims* the address via a signed detail.

**Wiki gap / uncertainty:** [[overview]] still lists “Hashed/opaque detail endorsement” under upcoming features. Cleartext email verify-email is implemented on the server; whether opaque paths get the same `detailsMeta.verified` endorsement should be confirmed in implementation when building this UI — do not claim opaque endorsement works unless `detailsMeta` says so for that path.

#### D. From header vs claims (explicit comparison)

- Message From (transport)
- Matching claim type (`email` / `opaque::email` / none)
- Pass / fail / unknown with one-sentence rationale

#### E. Signature result

- Valid / invalid / unsigned
- Signing scheme if known (ML-DSA / SLH-DSA)
- Point to full fingerprint for out-of-band compare

### 5. Progressive disclosure for ciphertext

- Hidden by default.
- Revealed only via **(i)** (modal, bottom sheet, or expandable section): armor text, optional copy, payload type (`ebp-encrypted-signed-message`, etc.).
- Distinct from the authenticity indicator: ciphertext is a debug/interop surface; authenticity is a trust surface.

### 6. Non-EBP and mixed mail

- No EBP payload: keep today’s plain body rendering; no authenticity indicator (or grey “not an EBP message”).
- Plain text above an armor block (rare): prefer showing non-armor preamble if detectable; still gate the armor behind **(i)** when `ebpPayload` is set.
- Encrypted attachments: keep attachment-level decrypt actions; do not dump attachment ciphertext into the body reader. Attachment verify status can reuse the same indicator vocabulary later.

### 7. Optional later improvements

- Session unlock / biometric so Decrypt skips retyping when the identity is already unlocked.
- Align [[component-gui]] mail reader with locked-first layout + the same authenticity indicator / drill-down ([[analysis-gui-mobile-parity-deltas]]).
- Auto-open authenticity screen on **invalid** signature (hard fail), keep it opt-in tap for valid/amber.

## Implementation sketch

Primary surfaces:

- `MailMessageScreen.tsx` — layout, indicator, navigation to authenticity screen
- New screen or modal: e.g. `MailSenderAuthenticityScreen` (or bottom sheet)
- Enrich `decryptMailBody` / decrypt result to return (at least): `plaintext`, `verified` / `verifyStatus`, `senderFingerprint`, resolved contact/server identity snapshot, email-claim match against From, and `detailsMeta` endorsement flags for matched paths

Suggested render priority after decrypt:

```
subject + authenticityIndicator → [optional Decrypt again] → bodySlot(plaintext) → (i) wire details
```

Before decrypt:

```
subject → locked status → Decrypt → bodySlot(placeholder) → (i) wire details
```

Reuse contact email matching helpers from compose (`findContactsByEmail` / opaque hash) for From ↔ identity binding so inbox and compose stay consistent.

## Success criteria

- Opening an encrypted message: decrypt control visible without scrolling past ciphertext.
- After decrypt: plaintext visible in the main body area without further scrolling to “find” it.
- Ciphertext visible only after explicit **(i)** / technical-details action.
- After decrypt (signed or unsigned): authenticity indicator visible without scrolling; tap opens a summary covering signer, email/`opaque::email` claims, verify-email endorsement, and From binding.
- Green never means “From looks right” without a valid signature.

## Related Pages

- [[component-mobile]]
- [[identity-model]]
- [[message-payload-formats]]
- [[component-server]]
- [[email-transport]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-mail-decrypt-invalid-json]]
- [[analysis-gui-mobile-parity-deltas]]
- [[component-gui]]
- [[overview]]

## Sources

- `mobile/src/screens/mail/MailMessageScreen.tsx`
- `mobile/src/services/mail/ebpMail.ts` (`decryptMailBody`)
- `mobile/src/services/contacts.ts` (`detailsMeta`, email / opaque matching)
- [[message-payload-formats]]
- [[identity-model]]
- [[component-server]] (verify-email endpoints)
- [[email-transport]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-mail-decrypt-invalid-json]]
