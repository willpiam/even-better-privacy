import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import { fetchUsdRate } from "./rates.ts";

Deno.test("exchange rates require a fresh provider quote", async () => {
  const now = 1_800_000_000_000;
  const api = (updated: number, price: number): typeof fetch => () =>
    Promise.resolve(
      Response.json({ cardano: { usd: price, last_updated_at: updated } }),
    );
  assertEquals(
    await fetchUsdRate("ADA", "key", now, api(now / 1000 - 30, 0.345)),
    "0.345",
  );
  await assertRejects(() =>
    fetchUsdRate("ADA", "key", now, api(now / 1000 - 121, 0.345))
  );
  await assertRejects(() =>
    fetchUsdRate("ADA", "key", now, api(now / 1000 + 31, 0.345))
  );
  await assertRejects(() =>
    fetchUsdRate("ADA", "key", now, api(now / 1000, 0))
  );
});
