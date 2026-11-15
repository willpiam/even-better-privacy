import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import { fetchUsdRate } from "./rates.ts";

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
    const payload = body.method === "eth_chainId"
      ? chainId
      : body.method === "eth_call"
      ? result
      : null;
    if (payload === null) {
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -1, message: "unsupported" },
      }));
    }
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: payload,
    }));
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
