import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { fetchUsdRate, getCachedUsdRate } from "./rates.ts";

const KEY = "alchemykey";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function roundData(args: {
  roundId?: bigint;
  answer: bigint;
  updatedAt: bigint;
  answeredInRound?: bigint;
}): string {
  const roundId = args.roundId ?? 5n;
  return "0x" + [
    roundId,
    args.answer,
    0n,
    args.updatedAt,
    args.answeredInRound ?? roundId,
  ].map(word).join("");
}

function rpc(host: string, chainId: string, result: string): typeof fetch {
  return (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body));
    if (
      url.host !== host || url.pathname !== `/v2/${KEY}` ||
      init?.method !== "POST"
    ) {
      return Promise.resolve(new Response("no", { status: 404 }));
    }
    assertEquals(body.map(({ method }: { method: string }) => method), [
      "eth_chainId",
      "eth_call",
    ]);
    return Promise.resolve(Response.json([
      { jsonrpc: "2.0", id: body[1].id, result },
      { jsonrpc: "2.0", id: body[0].id, result: chainId },
    ]));
  };
}

Deno.test("exchange rates require a fresh Chainlink round", async () => {
  const now = 1_800_000_000_000;
  const fresh = BigInt(Math.floor(now / 1000) - 30);
  assertEquals(
    await fetchUsdRate(
      "ADA",
      KEY,
      now,
      rpc("polygon-mainnet.g.alchemy.com", "0x89", roundData({
        answer: 34_500_000n,
        updatedAt: fresh,
      })),
    ),
    "0.345",
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ADA",
      KEY,
      now,
      rpc("polygon-mainnet.g.alchemy.com", "0x89", roundData({
        answer: 34_500_000n,
        updatedAt: BigInt(Math.floor(now / 1000) - 301),
      })),
    )
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ADA",
      KEY,
      now,
      rpc("polygon-mainnet.g.alchemy.com", "0x89", roundData({
        answer: 34_500_000n,
        updatedAt: BigInt(Math.floor(now / 1000) + 31),
      })),
    )
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ADA",
      KEY,
      now,
      rpc("polygon-mainnet.g.alchemy.com", "0x89", roundData({
        answer: 0n,
        updatedAt: fresh,
      })),
    )
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ETH",
      KEY,
      now,
      rpc("eth-mainnet.g.alchemy.com", "0x89", roundData({
        answer: 200_050_000_000n,
        updatedAt: fresh,
      })),
    )
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ETH",
      KEY,
      now,
      rpc("eth-mainnet.g.alchemy.com", "0x1", roundData({
        answer: 200_050_000_000n,
        updatedAt: fresh,
        roundId: 9n,
        answeredInRound: 8n,
      })),
    )
  );
  assertEquals(
    await fetchUsdRate(
      "ETH",
      KEY,
      now,
      rpc("eth-mainnet.g.alchemy.com", "0x1", roundData({
        answer: 200_050_000_000n,
        updatedAt: BigInt(Math.floor(now / 1000) - 60 * 60),
      })),
    ),
    "2000.5",
  );
  await assertRejects(() =>
    fetchUsdRate(
      "ETH",
      KEY,
      now,
      rpc("eth-mainnet.g.alchemy.com", "0x1", roundData({
        answer: 200_050_000_000n,
        updatedAt: BigInt(Math.floor(now / 1000) - 70 * 60 - 1),
      })),
    )
  );
  await assertRejects(() =>
    fetchUsdRate("ETH", "bad key", now, rpc("eth-mainnet.g.alchemy.com", "0x1", "0x"))
  );
});

Deno.test("checkout shares one refresh per asset per two hours, including after failures", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  const interval = 2 * 60 * 60 * 1000;
  const startTime = 1_800_000_000_000;
  let time = startTime;
  const calls: string[] = [];
  let failEth = false;
  const fetchImpl: typeof fetch = (input, init) => {
    const host = new URL(String(input)).host;
    calls.push(host);
    if (host === "eth-mainnet.g.alchemy.com" && failEth) {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    const cardano = host === "polygon-mainnet.g.alchemy.com";
    return rpc(host, cardano ? "0x89" : "0x1", roundData({
      answer: cardano ? 34_500_000n : 200_050_000_000n,
      updatedAt: BigInt(Math.floor(time / 1000)),
    }))(input, init);
  };
  const loadRate = (asset: "ETH" | "ADA") => getCachedUsdRate(db, asset, KEY, () => time, fetchImpl);

  try {
    assertEquals(await Promise.all([loadRate("ETH"), loadRate("ETH")]), ["2000.5", "2000.5"]);
    assertEquals(await loadRate("ADA"), "0.345");
    time += interval - 1;
    assertEquals(await loadRate("ETH"), "2000.5");
    assertEquals(await loadRate("ADA"), "0.345");
    assertEquals(calls, ["eth-mainnet.g.alchemy.com", "polygon-mainnet.g.alchemy.com"]);

    time += 1;
    failEth = true;
    await assertRejects(() => loadRate("ETH"));
    await assertRejects(() => loadRate("ETH"));
    assertEquals(calls.length, 3);
    assertEquals(await loadRate("ADA"), "0.345");
    assertEquals(calls.length, 4);
    const timestamps = await db.query<[string, number, number]>(
      "SELECT asset, last_attempt_at, cached_at FROM mail_payment_rates ORDER BY asset",
    );
    assertEquals(timestamps.map(([asset, attempted, cached]) => [asset, Number(attempted), Number(cached)]), [
      ["ADA", time, time],
      ["ETH", time, startTime],
    ]);

    time += interval;
    failEth = false;
    assertEquals(await loadRate("ETH"), "2000.5");
    assertEquals(calls.length, 5);
  } finally {
    await db.close();
  }
});
