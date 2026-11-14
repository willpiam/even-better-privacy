---
title: "Cardano Developer Portal: Mesh metadata transaction"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - cardano
  - mesh
  - metadata
---

# Cardano Developer Portal: Mesh metadata transaction

**Raw file:** `wiki/raw/cardano-developer-portal-mesh-metadata.md`
**Origin:** Cardano Developer Portal, last standalone copy of `docs/build/transaction-metadata/mesh.md`, taken from the commit immediately before that page was folded into the transaction-building guide (`60d102d^`).

## Summary

The guide shows how to attach transaction metadata with Mesh SDK's `MeshTxBuilder`, then sign and submit.

A browser page can connect with `BrowserWallet.enable('eternl')` (or another CIP-30 wallet name). The worked example instead uses `MeshWallet` with a mnemonic, a `BlockfrostProvider`, `networkId: 0` for testnet and `1` for mainnet.

The CIP-20 example sets label `674` and metadata `{ msg: [ ... ] }`, then:

1. `txBuilder.changeAddress(changeAddress)`
2. `txBuilder.metadataValue(label, metadata)`
3. `txBuilder.selectUtxosFrom(utxos)`
4. `complete()` to produce the unsigned transaction
5. `wallet.signTx(unsignedTx)` and `wallet.submitTx(signedTx)`

The guide repeats the 64-byte UTF-8 limit on metadata strings. It does not add a payment output in the CIP-20 example; the snippet only attaches metadata and lets the builder select inputs and change. A payment still has to add an output for the recipient and amount.

Mesh's `signTx` / `submitTx` on `MeshWallet` and `BrowserWallet` hide the witness-merge step that raw [[source-cip-30|CIP-30]] leaves to the dApp. The guide assumes that familiarity with Mesh.

## EBP relevance

This is the practical companion to [[source-cip-30]] and [[source-cip-20]] for building the Cardano checkout transaction in the browser. See [[analysis-checkout-wallet-submission]].

## Sources

- `wiki/raw/cardano-developer-portal-mesh-metadata.md`
