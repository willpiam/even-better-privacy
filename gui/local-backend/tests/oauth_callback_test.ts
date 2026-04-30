import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@^1.0.6";
import {
  HttpError,
  MAX_BODY_SIZE,
  readJson,
  tryServeStatic,
  writeFileExclusive,
} from "../http.ts";
import { handleRequest } from "../routes.ts";
import {
  isAllowedMailOAuthBrowserUrl,
  MAIL_OAUTH_MAX_PENDING_STARTS,
  MAIL_OAUTH_START_RATE_LIMIT,
  mailOauthStarts,
  registerMailOAuthStart,
} from "../mail-oauth.ts";

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

Deno.test("F-GUI-08: readJson rejects bodies larger than MAX_BODY_SIZE", async () => {
  const body = JSON.stringify({ value: "x".repeat(MAX_BODY_SIZE) });
  await assertRejects(
    () =>
      readJson(
        new Request("http://127.0.0.1:8787/api/v1/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
    HttpError,
    "payload too large",
  );
});

Deno.test("F-GUI-10: mail OAuth starts are rate-limited and capped", () => {
  mailOauthStarts.clear();
  const now = Date.now();
  for (let i = 0; i < MAIL_OAUTH_START_RATE_LIMIT; i += 1) {
    registerMailOAuthStart(
      `state-rate-${i}`,
      {
        provider: "gmail",
        createdAt: now,
        serverUrl: "https://server.example",
      },
      "rate-test-client",
      now,
    );
  }
  assertThrows(
    () =>
      registerMailOAuthStart(
        "state-rate-blocked",
        {
          provider: "gmail",
          createdAt: now,
          serverUrl: "https://server.example",
        },
        "rate-test-client",
        now,
      ),
    HttpError,
    "too many mail oauth starts",
  );

  mailOauthStarts.clear();
  for (let i = 0; i < MAIL_OAUTH_MAX_PENDING_STARTS; i += 1) {
    registerMailOAuthStart(
      `state-cap-${i}`,
      {
        provider: "gmail",
        createdAt: now,
        serverUrl: "https://server.example",
      },
      `cap-test-client-${i}`,
      now,
    );
  }
  assertThrows(
    () =>
      registerMailOAuthStart(
        "state-cap-blocked",
        {
          provider: "gmail",
          createdAt: now,
          serverUrl: "https://server.example",
        },
        "cap-test-extra-client",
        now,
      ),
    HttpError,
    "too many pending mail oauth starts",
  );
  mailOauthStarts.clear();
});

Deno.test("F-GUI-04: mail OAuth browser opener only allows provider hosts", () => {
  assertEquals(
    isAllowedMailOAuthBrowserUrl(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    ),
    true,
  );
  assertEquals(
    isAllowedMailOAuthBrowserUrl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    ),
    true,
  );
  assertEquals(
    isAllowedMailOAuthBrowserUrl("http://127.0.0.1:8787/callback"),
    true,
  );
  assertEquals(
    isAllowedMailOAuthBrowserUrl("https://attacker.example/phish"),
    false,
  );
  assertEquals(
    isAllowedMailOAuthBrowserUrl("javascript:alert(1)"),
    false,
  );
  assertEquals(
    isAllowedMailOAuthBrowserUrl("http://192.168.1.1/callback"),
    false,
  );
});

Deno.test({
  name: "F-GUI-02: writeFileExclusive refuses to overwrite existing files",
  permissions: { read: true, write: true },
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "ebp-save-file-test-" });
    try {
      const path = `${dir}/existing.txt`;
      await Deno.writeTextFile(path, "original");
      await assertRejects(
        () => writeFileExclusive(path, new TextEncoder().encode("replacement")),
        HttpError,
        "file already exists",
      );
      assertEquals(await Deno.readTextFile(path), "original");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "F-GUI-11: static file serving rejects encoded traversal",
  permissions: { read: true },
  fn: async () => {
    for (const path of ["/%252e%252e/deno.json"]) {
      const res = await tryServeStatic(
        new Request(`http://127.0.0.1:8787${path}`),
        new URL(`http://127.0.0.1:8787${path}`),
      );
      assertEquals(res?.status, 404);
    }

    const ok = await tryServeStatic(
      new Request("http://127.0.0.1:8787/index.html"),
      new URL("http://127.0.0.1:8787/index.html"),
    );
    assertEquals(ok?.status, 200);
  },
});
