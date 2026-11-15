---
name: Chainlink checkout prices
overview: Replace the CoinGecko USD quote with Chainlink price feeds read through the Alchemy key already in `.env`. After the code and tests are in place, set that key on the live key server and then push to master.
todos:
  - id: rates
    content: Replace CoinGecko fetchUsdRate with Chainlink reads via the Alchemy key
    status: completed
  - id: config
    content: Require ETHEREUM_ALCHEMY_API_KEY and remove the CoinGecko config key
    status: completed
  - id: tests-docs
    content: Update payment tests, README, and the env example
    status: completed
  - id: live-then-push
    content: Confirm live feed ages, set the Render env var, then push to master
    status: pending
isProject: false
---

# Chainlink prices for checkout

ETH and ADA quotes in [`server/handlers/mail-payment.ts`](server/handlers/mail-payment.ts) today call CoinGecko from [`server/payments/rates.ts`](server/payments/rates.ts). Stablecoins stay at one dollar. The replacement reads Chainlink `latestRoundData()` with the existing `ETHEREUM_ALCHEMY_API_KEY`. Payment confirmation keeps using `MAIL_PAYMENT_ETH_RPC_URL` / `MAIL_TEST_PAYMENT_ETH_RPC_URL`; those calls are not price quotes.

Ethereum mainnet no longer has a live ADA/USD feed (it was deprecated). Both dollar prices are still market prices, so testnet orders use the same feeds as production:

- ETH/USD on Ethereum mainnet, proxy `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, 8 decimals, heartbeat 3600 seconds. Accept a round up to 70 minutes old.
- ADA/USD on Polygon mainnet, proxy `0x882554df528115a743c4537828DA8D5B58e52544`, 8 decimals. Chainlink’s feed list gives this feed a 27-second heartbeat. Accept a round up to 5 minutes old so one late update still quotes, and reject anything older.

Alchemy URLs from that one key:

- `https://eth-mainnet.g.alchemy.com/v2/<key>`
- `https://polygon-mainnet.g.alchemy.com/v2/<key>`

## Rate fetch

Rewrite `fetchUsdRate` so it takes the Alchemy key instead of a CoinGecko key.

- Require the key to be a single URL-safe token. Build the two URLs above. Never log the key or the URL.
- `eth_chainId` must be 1 for ETH and 137 for ADA before trusting the call.
- `eth_call` `latestRoundData()` (`0xfeaf968c`). Require a positive 8-decimal answer, a completed round (`answeredInRound >= roundId`), and `updatedAt` inside the window above and not more than 30 seconds in the future.
- Turn the integer answer into the plain decimal string [`quoteAtomicUnits`](server/payments/quote.ts) already accepts, using integer division only.
- Any RPC, decode, or staleness failure throws. The handler already turns that into “exchange rate unavailable; please retry”.

Before calling this done, read both feeds once with the local key and confirm each `updatedAt` falls inside its window. If the Polygon ADA round is older than 5 minutes, stop and widen that window to the feed’s real heartbeat instead of shipping a quote path that always fails.

## Config

In [`server/payments/config.ts`](server/payments/config.ts), drop `coinGeckoKey` and `MAIL_PAYMENT_COINGECKO_KEY`. Payment config stays disabled unless `ETHEREUM_ALCHEMY_API_KEY` is set, for both the production and test prefixes. [`server/db/postgres.ts`](server/db/postgres.ts) already loads the root `.env` at startup, which is where the key lives. Do not commit `.env`.

Update the tests and docs that still require the CoinGecko key: [`server/payments/rates_test.ts`](server/payments/rates_test.ts), [`server/payments/config_test.ts`](server/payments/config_test.ts), [`server/payments/flow_test.ts`](server/payments/flow_test.ts), [`server/handlers/mail_mode_test.ts`](server/handlers/mail_mode_test.ts), [`server/handlers/mail_payment_guard_test.ts`](server/handlers/mail_payment_guard_test.ts), [`mail-server/README.md`](mail-server/README.md), and [`mail-server/.env.test.example`](mail-server/.env.test.example). The rate test should use a fake `eth_call` response, including a stale round, a wrong chain id, and a non-positive price.

## Live server, then master

After the unit tests pass:

1. Add `ETHEREUM_ALCHEMY_API_KEY` to the Render env for `ebp-cqyo.onrender.com`. An unknown variable does not affect the currently deployed CoinGecko code, so this can land before the push. Leave the existing payment RPC URLs in place.
2. Push the branch to master so the new process starts with the key already set.

If the Render API token is not available from this machine, the env step stops for you to paste the variable in the Render dashboard, and the push waits until that is done.
