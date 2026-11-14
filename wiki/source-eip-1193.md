---
title: "EIP-1193: Ethereum Provider JavaScript API"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - ethereum
  - eip-1193
  - wallet
---

# EIP-1193: Ethereum Provider JavaScript API

**Raw file:** `wiki/raw/eip-1193.md`
**Status:** Final
**Requires:** EIP-155, EIP-695

## Summary

EIP-1193 defines the JavaScript object a wallet injects so a web page can make Ethereum RPC calls. The required method is `request({ method, params })`, which returns a Promise of the RPC result or rejects with a `ProviderRpcError` (`message`, `code`, optional `data`).

The Provider is connected when it can service RPC requests to at least one chain. Authorization failure should use error `4100`. A disconnected provider uses `4900`. A request aimed at a chain the provider is not connected to, while it is connected to some other chain, uses `4901`. An unsupported finalized EIP method should use `4200`.

`window.ethereum` is described as a common convention, not part of the specification. The EIP tells consumers to consult the wallet's own documentation for where the provider object lives.

Account exposure is not granted by the provider existing. The EIP points at `eth_requestAccounts` ([[source-eip-1102]]) or `wallet_requestPermissions` (EIP-2255) before write methods such as `eth_sendTransaction`. Chain identity uses `eth_chainId` (EIP-695), returned as a 0x-prefixed hexadecimal string, with a `chainChanged` event when it changes.

The deprecated `send` method is superseded by `request`.

## EBP relevance

A checkout page that submits an Ethereum payment through MetaMask or another injected wallet uses this `request` entry point, then the transaction object in [[source-ethereum-execution-apis-submit]]. See [[analysis-checkout-wallet-submission]].

## Sources

- `wiki/raw/eip-1193.md`
