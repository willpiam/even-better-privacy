---
title: "CIP-30: Cardano dApp-Wallet Web Bridge"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - cardano
  - cip-30
  - wallet
---

# CIP-30: Cardano dApp-Wallet Web Bridge

**Raw file:** `wiki/raw/cip-0030.md`
**Status:** Active
**License:** CC-BY-4.0

## Summary

CIP-30 is the browser bridge a web page uses to talk to a Cardano wallet extension. The page does not receive private keys. It discovers injected wallets, asks the user to connect, builds an unsigned transaction itself, and asks the wallet to sign and optionally submit that transaction.

Initial discovery objects live at `window.cardano.{walletName}` and expose `enable()`, `isEnabled()`, `apiVersion`, `name`, and `icon`. `enable()` returns the full API. Read-only methods should not prompt again. `signTx` and `signData` must prompt on every call.

## Methods that matter for a payment

- `getNetworkId()` returns `0` for testnet and `1` for mainnet. Other values are outside this CIP. The id does not say which testnet (preview versus preprod).
- `getUtxos()` returns CBOR-hex unspent outputs, optionally limited to those needed to cover an amount. It returns `null` when the target cannot be met.
- `getChangeAddress()` returns an address the dApp should use for leftover assets.
- `signTx(tx, partialSign = false)` takes CBOR of the unsigned transaction and returns only the CBOR `transaction_witness_set` produced by this call. `partialSign: false` fails with `TxSignError` code `ProofGeneration` when the wallet cannot sign every required input. User refusal is `UserDeclined`.
- `submitTx(tx)` takes the assembled signed transaction CBOR and returns the transaction id. The wallet may refuse (`Refused`) or fail (`Failure`).

The dApp must merge the returned witness set into the unsigned transaction before `submitTx`. CIP-30 does not define a convenience method that both signs and broadcasts.

The specification says it was written for the Mary era. The collateral method `getCollateral` is deprecated in favor of Babbage collateral return. The deprecation note names Mesh, Lucid Evolution, and cardano-serialization-lib as the libraries that build those transactions.

## EBP relevance

A checkout page that pays from a CIP-30 wallet has to construct the transaction, including the output and [[source-cip-20|CIP-20]] metadata, then call `signTx` and `submitTx`. See [[analysis-checkout-wallet-submission]].

## Sources

- `wiki/raw/cip-0030.md`
