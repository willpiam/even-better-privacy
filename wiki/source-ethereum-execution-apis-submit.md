---
title: "Ethereum execution APIs: eth_sendTransaction"
type: source-summary
status: active
last_updated: 2026-11-14
source_count: 1
tags:
  - source
  - ethereum
  - json-rpc
  - wallet
---

# Ethereum execution APIs: eth_sendTransaction

**Raw files:** `wiki/raw/ethereum-execution-apis-submit.yaml`, `wiki/raw/ethereum-execution-apis-transaction.yaml`
**Source:** `ethereum/execution-apis` `src/eth/submit.yaml` and `src/schemas/transaction.yaml`

## Summary

`eth_sendTransaction` signs and submits a transaction. Its parameter is a `GenericTransaction`. The result is a 32-byte transaction hash.

`GenericTransaction` sets `additionalProperties: false`. The payload field is named `input` and is hex bytes. Related fields include `from`, `to` (or `null` for contract creation), `value` in wei, `gas`, `nonce`, `gasPrice`, and the EIP-1559 pair `maxFeePerGas` / `maxPriorityFeePerGas`. The schema does not define a `data` property.

The example call sends `value` and `input` together to an externally owned address, which is the shape of a native-coin transfer that also carries calldata.

`eth_sendRawTransaction` is the separate method for a transaction that was already signed outside the node. A browser wallet uses `eth_sendTransaction` so the wallet holds the key.

## EBP relevance

An Ethereum checkout payment is a value transfer whose call data is the order message. The field the execution API names is `input`. Whether a particular injected wallet also accepts the older name `data` is not specified in these files. See [[analysis-checkout-wallet-submission]] and [[source-eip-1193]].

## Sources

- `wiki/raw/ethereum-execution-apis-submit.yaml`
- `wiki/raw/ethereum-execution-apis-transaction.yaml`
