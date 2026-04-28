import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.6";
import { handleRequest } from "../routes.ts";
import { mailOauthStarts } from "../mail-oauth.ts";

Deno.test({
  name: "F-GUI-12: mail OAuth callback escapes provider error text",
  permissions: { read: true, write: true, env: true, net: true },
  fn: async () => {
    const state = "oauth-state-for-xss-test";
    const payload = `<img src=x onerror=alert(1)>`;
    mailOauthStarts.set(state, {
      provider: "gmail",
      createdAt: Date.now(),
      serverUrl: "https://server.example",
    });

    const res = await handleRequest(
      new Request(
        `http://127.0.0.1:8787/api/v1/mail/oauth/callback?state=${
          encodeURIComponent(state)
        }&error=${encodeURIComponent(payload)}`,
        { headers: { host: "127.0.0.1:8787" } },
      ),
    );
    const body = await res.text();

    assertEquals(res.status, 400);
    assert(!body.includes(payload));
    assertStringIncludes(body, "&lt;img src=x onerror=alert(1)&gt;");
  },
});
