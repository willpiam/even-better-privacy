---
title: "Hashcash and CPU cost-functions (Back 2002)"
type: concept
status: active
last_updated: 2026-05-11
source_count: 1
tags:
  - proof-of-work
  - email
  - dos
  - comparison
---

# Hashcash and CPU cost-functions (Back 2002)

This page summarizes Adam Back’s **Hashcash** paper (2002) as **comparison material**: a historically influential design for using **CPU proof-of-work** to throttle abuse of unmetered resources (especially email), framed in the language of **cost-functions** (mint, verify, optional challenge).

## What hashcash is

In Back’s terminology, **hashcash** is a **non-interactive**, **trapdoor-free**, **publicly auditable** cost-function with **unbounded probabilistic** cost: clients brute-force a partial preimage on a cryptographic hash until the output has enough leading zero bits (or, in an improved variant, a fixed zero prefix), binding the attempt to a **service string** so tokens are not portable across services. Verifiers must track **spent tokens** to prevent double spending and typically expire entries using a timestamp embedded in the service string.

An **interactive** variant and **hashcash-cookies** (TCP state exhaustion) extend the same ideas to connection-oriented protocols and dynamic work-factor adjustment.

## What EBP is doing instead

EBP’s email story is **not** “pay CPU to send SMTP.” Authenticity and confidentiality come from **PQ signatures and ML-KEM/AES-GCM** inside EBP JSON payloads carried over normal mail ([[email-transport]], [[message-payload-formats]]). Infrastructure **rate limits** on the discovery server address HTTP abuse patterns and are unrelated to hashcash tokens ([[component-server]]).

## Related pages

- [[source-hashcash-adam-back-2002]] — full source summary and citations into the PDF
- [[email-transport]] — SMTP/IMAP boundaries for EBP payloads
- [[overview]] — architecture context

## Sources

- `wiki/raw/hashcash.pdf` → [[source-hashcash-adam-back-2002]]
