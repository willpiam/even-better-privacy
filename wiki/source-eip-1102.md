---
title: "EIP-1102: Opt-in account exposure"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - ethereum
  - eip-1102
  - wallet
---

# EIP-1102: Opt-in account exposure

**Raw file:** `wiki/raw/eip-1102.md`
**Status:** Stagnant
**Requires:** EIP-1474

## Summary

EIP-1102 stops wallets from injecting accounts before the user agrees. The page must call `eth_requestAccounts` on the provider at `window.ethereum`. That call may show an approval UI. The Promise resolves to an array of one or more accounts, or rejects when no account is available, including when the user declines.

The earlier `enable()` method is deprecated in favor of `eth_requestAccounts`. The specification still writes the legacy call as `ethereum.send('eth_requestAccounts')`. [[source-eip-1193]] later requires `request` instead of `send`, and names this RPC as the way to ask for accounts before `eth_sendTransaction`.

The EIP's own status is Stagnant. The method is still the one EIP-1193 tells applications to use.

## EBP relevance

Checkout cannot call `eth_sendTransaction` until the user has granted an account. See [[analysis-checkout-wallet-submission]].

## Sources

- `wiki/raw/eip-1102.md`
