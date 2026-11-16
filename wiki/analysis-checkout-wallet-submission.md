---
title: "Checkout wallet submission"
type: analysis
status: active
last_updated: 2026-11-16
source_count: 11
tags:
  - analysis
  - checkout
  - cardano
  - ethereum
  - payments
---

# Checkout wallet submission

`website/checkout.js` connects to injected Ethereum and Cardano wallets for test-address purchases using native Sepolia ETH or preview ADA. It also supports manual transaction-id submission. This corrects the earlier description of checkout as manual-only. The key server independently decides whether the resulting chain transaction is a payment (`server/payments/verification.ts`).

Checkout refreshes the order before asking the wallet, rejects expired quotes before sending, and retains a returned transaction hash in the manual submission field. Ethereum sends are never automatically retried after an uncertain outcome. The server keeps the reservation through `graceUntil` and accepts delayed hash submission during that period, including approval that finishes after `expiresAt`; an unpaid hold is released at the end of grace.

The on-chain message is `pqpost:` plus a random UUID, created in `server/handlers/mail-payment.ts`. It is not the order id. The checkout page already displays that string as `order.message`.

## Cardano (CIP-30)

[[source-cip-30]] puts the unsigned transaction in the page and the keys in the wallet.

1. Find an injected wallet under `window.cardano` and call `enable()`.
2. `getNetworkId()` must be `0` for a preview or preprod order and `1` for mainnet. The CIP does not distinguish preview from preprod; both are testnet id `0`.
3. Build an unsigned transaction that pays the order's recipient at least the quoted quantity, and attach [[source-cip-20]] metadata label `674` whose `msg` array is exactly `[order.message]`.
4. `signTx` returns only the new witness set. Merge it into the transaction, then `submitTx` returns the transaction id to post back to the checkout form.

[[source-cardano-mesh-metadata]] is the worked Mesh path: `BrowserWallet.enable(name)` in a page, or a mnemonic `MeshWallet` in a script, then `MeshTxBuilder.metadataValue(674, { msg })`, `complete()`, `signTx`, and `submitTx`. That guide's CIP-20 sample does not add the payment output; the builder call still needs an output to the order recipient for the quoted amount. Native tokens also need the minimum ADA the protocol requires on that output. The current checkout instructions already say that.

EBP is stricter than CIP-20. CIP-20 allows several `msg` lines and extra keys next to `msg`. `checkCardanoPayment` accepts the transaction only when there is one label-674 entry, `msg` has length 1, and that string equals the order message. Only non-collateral outputs of transactions explicitly marked `valid_contract=true` are counted. Their total for the configured asset unit must be at least the quoted amount. Failed script transactions are rejected. The wallet requests a funding amount through CIP-30; the server accepts at most 256 supplied UTxOs and selects the largest 40 by lovelace before construction.

CIP-20's specification says 64 UTF-8 bytes per string, then its conclusion says 64 characters. The order message is ASCII and shorter than both limits (`pqpost:` plus a UUID).

## Ethereum (injected provider)

[[source-eip-1193]] is the `request` method MetaMask and other injected wallets implement. [[source-eip-1102]] is the account prompt: `eth_requestAccounts` before any send. EIP-1102's status is Stagnant; EIP-1193 still points at that RPC. `window.ethereum` is a convention, not part of EIP-1193.

[[source-ethereum-execution-apis-submit]] names the send method `eth_sendTransaction` and the payload field `input`. A native payment is `from` the connected account, `to` the order recipient, `value` the quoted wei, and `input` the hex of the order message. `checkEthereumPayment` accepts a native transfer only when the transaction's data is exactly `0x` plus the UTF-8 hex of `order.message`, `to` is the recipient, and `value` is at least the quoted amount. A normal send that omits that data does not count.

The execution API schema rejects unknown properties (`additionalProperties: false`) and does not list a `data` field. Some wallets still document `data` as the name they accept. These stored specs do not say which alias a given wallet requires. EBP currently uses the injected-wallet `data` shape once; it does not retry the send using another alias. The chain check looks at the transaction input after it is mined, not at the JSON key the page used.

Token payments are a separate encoding in `checkEthereumPayment`: a zero-value call to the token contract whose data is the `transfer(address,uint256)` selector, the recipient, the amount, and then the same order-message bytes. That path is not a plain ETH transfer.

`eth_chainId` should be checked against the order network before sending. The stored EIPs do not list Sepolia's chain id; that value has to come from the wallet or the chain the order names.

## Browser integration constraints

The page's content security policy allows scripts only from `'self'` and connections only to the page origin plus the key server. A wallet injection is a page object, so it does not need a new network host, but any SDK loaded from a CDN would violate that policy. Mesh, if used, has to be bundled or self-hosted.

## Sources

- `wiki/raw/cip-0030.md` → [[source-cip-30]]
- `wiki/raw/cip-0020.md` → [[source-cip-20]]
- `wiki/raw/cardano-developer-portal-mesh-metadata.md` → [[source-cardano-mesh-metadata]]
- `wiki/raw/eip-1193.md` → [[source-eip-1193]]
- `wiki/raw/eip-1102.md` → [[source-eip-1102]]
- `wiki/raw/ethereum-execution-apis-submit.yaml` and `wiki/raw/ethereum-execution-apis-transaction.yaml` → [[source-ethereum-execution-apis-submit]]
- `website/checkout.js`
- `server/payments/verification.ts`
- `server/handlers/mail-payment.ts`

- `website/checkout-wallet.js`
- `server/payments/orders.ts`
