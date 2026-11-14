---
title: "CIP-20: Cardano transaction message metadata"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - cardano
  - cip-20
  - metadata
---

# CIP-20: Cardano transaction message metadata

**Raw file:** `wiki/raw/cip-0020.md`
**Status:** Active
**License:** CC-BY-4.0

## Summary

CIP-20 reserves transaction metadata label `674` (the T9 encoding of "msg") for a human-readable memo. The value is an object whose `msg` property is an array of strings. A single-line message is still an array of one string. Each string must be at most 64 bytes when UTF-8 encoded, following Cardano JSON metadata limits.

```json
{ "674": { "msg": ["message-string 1"] } }
```

The ledger does not interpret the text. Wallets and explorers that implement the CIP look up label 674 and the `msg` array. A missing `msg`, or a string instead of an array, is not a valid transaction message. Extra keys beside `msg` do not, by themselves, make the message invalid. The CIP says the same label cannot appear twice in one transaction.

## Internal inconsistency

The specification section limits each string to 64 **bytes** of UTF-8. The later "Implementation conclusion" says 64 **characters**. Those are not the same limit once a string contains non-ASCII text. The byte limit is the one that matches the JSON metadata design the specification cites.

## EBP relevance

Paid Cardano checkout needs this label so the payment can be told apart from an ordinary transfer. EBP's checker is stricter than the CIP: it requires exactly one label-674 entry whose `msg` array has exactly one string, and that string must equal the order message. See [[analysis-checkout-wallet-submission]].

## Sources

- `wiki/raw/cip-0020.md`
