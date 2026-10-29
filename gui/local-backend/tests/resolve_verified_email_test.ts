import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { handleRequest } from "../routes.ts";
import { initSecurity, setCsrfTokenForTest } from "../security.ts";

const TEST_TOKEN = "s".repeat(64);
const SERVER = "https://keys.test";
const FINGERPRINT = "ebpdk1a7cluc75lj5mhxcts3fpf7cwteev7ez2ur0qf8ksayfg2amksy5sn6c8gt";
const EMAIL = "alice@pqpost.com";

function req(path: string): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: "GET",
    headers: {
      host: "127.0.0.1:8787",
      origin: "tauri://localhost",
      "x-ebp-csrf": TEST_TOKEN,
    },
  });
}

function identityBody(fingerprint: string, email: string, verified: boolean) {
  return {
    fingerprint,
    signingKeyType: "dilithium",
    encryptionKeyType: "kyber",
    signingKey: "signing-key",
    encryptionKey: "encryption-key",
    signingKeyDetails: { variant: "ml_dsa87" },
    encryptionKeyDetails: { variant: "ml_kem1024" },
    details: { email: [email, "proof"] },
    detailsMeta: { email: { verified, verifiedAt: verified ? 1 : null } },
    revoked: false,
    revokedDetails: [],
  };
}

function searchPage(identities: ReturnType<typeof identityBody>[]): Response {
  return Response.json({
    identities,
    pagination: {
      page: 1,
      pageSize: 100,
      total: identities.length,
      totalPages: 1,
      hasMore: false,
    },
  });
}

async function withServer(
  identities: ReturnType<typeof identityBody>[],
  fn: (home: string, calls: string[]) => Promise<void>,
): Promise<void> {
  const securityHome = await Deno.makeTempDir({ prefix: "ebp-resolve-sec-" });
  const home = await Deno.makeTempDir({ prefix: "ebp-resolve-home-" });
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname);
    if (url.pathname === "/api/v1/identities/search") {
      return Promise.resolve(searchPage(identities));
    }
    if (url.pathname.startsWith("/api/v1/identity/")) {
      const fingerprint = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const found = identities.find((item) => item.fingerprint === fingerprint);
      return Promise.resolve(found ? Response.json(found) : Response.json({ error: "missing" }, { status: 404 }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
  }) as typeof fetch;
  try {
    await initSecurity({ home: securityHome, persist: false });
    setCsrfTokenForTest(TEST_TOKEN);
    await fn(home, calls);
  } finally {
    globalThis.fetch = realFetch;
    await Deno.remove(securityHome, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

function resolveUrl(home: string, email = EMAIL): string {
  return `/api/v1/contacts/resolve-verified-email?home=${encodeURIComponent(home)}&server=${encodeURIComponent(SERVER)}&email=${encodeURIComponent(email)}`;
}

Deno.test({
  name: "resolve-verified-email imports one exact verified identity",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withServer([identityBody(FINGERPRINT, EMAIL, true)], async (home, calls) => {
      const res = await handleRequest(req(resolveUrl(home)));
      const body = await res.json();
      assertEquals(res.status, 200);
      assertEquals(body.status, "unique");
      assertEquals(body.imported, true);
      assertEquals(body.fingerprint, FINGERPRINT);
      assertEquals(body.name, FINGERPRINT.slice(0, 16));
      const saved = JSON.parse(await Deno.readTextFile(
        `${home}/.ebp/contacts/${body.name}.json`,
      ));
      assertEquals(saved.encryptionKey, "encryption-key");
      assertEquals(saved.details.email[0], EMAIL);
      assert(calls.some((path) => path.startsWith("/api/v1/identity/")));
    });
  },
});

Deno.test({
  name: "resolve-verified-email ignores unverified and ambiguous addresses",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withServer([identityBody(FINGERPRINT, EMAIL, false)], async (home, calls) => {
      const res = await handleRequest(req(resolveUrl(home)));
      assertEquals(await res.json(), { status: "none" });
      assertEquals(calls.some((path) => path.startsWith("/api/v1/identity/")), false);
    });
    await withServer([
      identityBody(FINGERPRINT, EMAIL, true),
      identityBody(`${FINGERPRINT.slice(0, -1)}q`, EMAIL, true),
    ], async (home, calls) => {
      const res = await handleRequest(req(resolveUrl(home)));
      assertEquals((await res.json()).status, "ambiguous");
      assertEquals(calls.some((path) => path.startsWith("/api/v1/identity/")), false);
    });
  },
});

Deno.test({
  name: "resolve-verified-email keeps a saved contact and does not fetch",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withServer([identityBody(FINGERPRINT, EMAIL, true)], async (home, calls) => {
      const dir = `${home}/.ebp/contacts`;
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(`${dir}/Alice.json`, JSON.stringify({
        fingerprint: "local-fingerprint",
        signingKey: "local-sign",
        encryptionKey: "local-key",
        details: { email: [EMAIL, "local-proof"] },
      }));
      const res = await handleRequest(req(resolveUrl(home)));
      const body = await res.json();
      assertEquals(body, {
        status: "unique",
        name: "Alice",
        fingerprint: "local-fingerprint",
        imported: false,
      });
      assertEquals(calls.length, 0);
      const stillLocal = JSON.parse(await Deno.readTextFile(`${dir}/Alice.json`));
      assertEquals(stillLocal.encryptionKey, "local-key");
    });
  },
});
