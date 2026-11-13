import { assertEquals } from "jsr:@std/assert";
import { MAX_BODY_SIZE, readJsonBody } from "../body.ts";
import { readVerificationTokenFromRequest } from "../verify-email.ts";
import { handlePostIdentity } from "../handlers/identity.ts";
import type { DatabaseAdapter } from "../db/index.ts";

Deno.test("API JSON rejects null, arrays and scalar bodies before handlers access fields", async () => {
  for (const body of ["null", "[]", "true", "42", '"value"']) {
    const result = await readJsonBody(
      new Request("http://example.test", { method: "POST", body }),
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 400);
    const response = await handlePostIdentity(
      new Request("http://example.test/api/v1/identity", {
        method: "POST",
        body,
      }),
      {} as DatabaseAdapter,
    );
    assertEquals(response.status, 400);
  }
});

Deno.test("verification form bodies enforce the same limit as JSON, including streamed bodies", async () => {
  const token = "a".repeat(64);
  const valid = await readVerificationTokenFromRequest(
    new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${token}`,
    }),
  );
  assertEquals(valid, { ok: true, token });
  const headerCases: Record<string, string>[] = [
    {},
    { "content-length": "1" },
    { "content-length": String(MAX_BODY_SIZE + 1) },
  ];
  for (const headers of headerCases) {
    const result = await readVerificationTokenFromRequest(
      new Request("http://example.test", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: `token=${token}&padding=${"x".repeat(MAX_BODY_SIZE)}`,
      }),
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 413);
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readVerificationTokenFromRequest(
    new Request("http://example.test", { method: "POST", body: stream }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 413);
  assertEquals(cancelled, true);
});

Deno.test("request JSON rejects duplicate keys and invalid Unicode", async () => {
  for (const text of ['{"a":1,"a":2}', '{"\\u0000":1}', '"\\ud800"', "1e999"]) {
    const result = await readJsonBody(
      new Request("http://example.test", { method: "POST", body: text }),
    );
    assertEquals(result.ok, false);
  }
  const invalidUtf8 = new Request("http://example.test", {
    method: "POST",
    body: new Uint8Array([0x22, 0xff, 0x22]),
  });
  assertEquals((await readJsonBody(invalidUtf8)).ok, false);
  const valid = new Request("http://example.test", {
    method: "POST",
    body: '{"value":"☃"}',
  });
  assertEquals(await readJsonBody(valid), { ok: true, data: { value: "☃" } });
});

Deno.test("identity registration rejects invalid post-quantum key metadata", async () => {
  const payload = {
    signingKeyType: "dilithium",
    encryptionKeyType: "kyber",
    signingKey: btoa("short"),
    encryptionKey: "00".repeat(32),
    toState: "state",
    stateSignature: "signature",
  };
  const request = new Request("http://example.test/api/v1/identity", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const response = await handlePostIdentity(request, {} as DatabaseAdapter);
  assertEquals(response.status, 400);
});
