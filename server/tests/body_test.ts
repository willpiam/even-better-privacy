import { assertEquals } from "jsr:@std/assert";
import { readJsonBody } from "../body.ts";
import { handlePostIdentity } from "../handlers/identity.ts";
import type { DatabaseAdapter } from "../db/index.ts";

Deno.test("request JSON rejects duplicate keys and invalid Unicode", async () => {
  for (const text of ['{"a":1,"a":2}', '{"\\u0000":1}', '"\\ud800"', '1e999']) {
    const result = await readJsonBody(new Request("http://example.test", {method: "POST", body: text}));
    assertEquals(result.ok, false);
  }
  const invalidUtf8 = new Request("http://example.test", {method: "POST", body: new Uint8Array([0x22, 0xff, 0x22])});
  assertEquals((await readJsonBody(invalidUtf8)).ok, false);
  const valid = new Request("http://example.test", {method: "POST", body: '{"value":"☃"}'});
  assertEquals(await readJsonBody(valid), {ok: true, data: {value: "☃"}});
});

Deno.test("identity registration rejects invalid post-quantum key metadata", async () => {
  const payload = {signingKeyType: "dilithium", encryptionKeyType: "kyber", signingKey: btoa("short"), encryptionKey: "00".repeat(32), toState: "state", stateSignature: "signature"};
  const request = new Request("http://example.test/api/v1/identity", {method: "POST", body: JSON.stringify(payload)});
  const response = await handlePostIdentity(request, {} as DatabaseAdapter);
  assertEquals(response.status, 400);
});
