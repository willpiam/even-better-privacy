import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { Identity } from "../../../core/Identity.ts";
import { handleRequest } from "../routes.ts";
import { initSecurity, setCsrfTokenForTest } from "../security.ts";
import {
  encryptSecretsStore,
  mailPinCache,
  mailSecretCache,
} from "../mail-account.ts";
import {
  getUnlockStatus,
  lockAll,
  setUnlockClockForTest,
  sweepExpiredSessions,
} from "../unlock-session.ts";
import { getContext, writeState } from "../../../cli/utils.ts";
import { hexToString } from "../../../core/Hex.ts";

const TEST_TOKEN = "u".repeat(64);
const PASSWORD = "Unlock-Session-Pass-7";

Deno.test({
  name:
    "unlock-session: concurrent route mutations preserve every detail and distinct nonces",
  permissions: {
    read: true,
    write: true,
    env: true,
    net: true,
    sys: ["hostname"],
  },
  fn: () =>
    withIdentityHome(async (home) => {
      assertEquals(
        (await post("/api/v1/identity/unlock", {
          home,
          identity: "me",
          password: PASSWORD,
        })).status,
        200,
      );
      const responses = await Promise.all(
        ["first", "second", "third"].map((path) =>
          post("/api/v1/detail", { home, identity: "me", path, detail: path })
        ),
      );
      assertEquals(responses.map((response) => response.status), [
        200,
        200,
        200,
      ]);
      const identity = Identity.fromStorageFormat(
        await Deno.readTextFile(`${home}/.ebp/me.identity.json`),
        PASSWORD,
      );
      assertEquals(identity.details.size, 3);
      const nonces = [...identity.details.values()].map(([, proof]) =>
        JSON.parse(hexToString(proof)).nonce
      );
      assertEquals(nonces.sort(), [0, 1, 2]);
      assertEquals(
        (await post("/api/v1/revoke/detail", {
          home,
          identity: "me",
          path: "absent",
        })).status,
        404,
      );
      assertEquals(
        (await post("/api/v1/detail", {
          home,
          identity: "me",
          path: "after-failure",
          detail: "still works",
        })).status,
        200,
      );
    }),
});
const PERMS: Deno.PermissionOptionsObject = {
  read: true,
  write: true,
  env: true,
  net: true,
  sys: ["hostname"],
};

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: {
      host: "127.0.0.1:8787",
      origin: "tauri://localhost",
      "content-type": "application/json",
      "x-ebp-csrf": TEST_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function post(path: string, body: unknown) {
  const res = await handleRequest(req("POST", path, body));
  return { status: res.status, body: await res.json() };
}

async function withIdentityHome(fn: (home: string) => Promise<void>) {
  const securityHome = await Deno.makeTempDir({ prefix: "ebp-unlock-sec-" });
  const home = await Deno.makeTempDir({ prefix: "ebp-unlock-home-" });
  try {
    await initSecurity({ home: securityHome, persist: false });
    setCsrfTokenForTest(TEST_TOKEN);
    const ebpDir = `${home}/.ebp`;
    await Deno.mkdir(ebpDir, { recursive: true });
    const identity = new Identity("dilithium", "kyber");
    await Deno.writeTextFile(
      `${ebpDir}/me.identity.json`,
      identity.toStorageFormat(PASSWORD),
    );
    await writeState(ebpDir, { currentIdentity: "me" });
    await fn(home);
  } finally {
    lockAll();
    setUnlockClockForTest(null);
    await Deno.remove(securityHome, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test({
  name: "unlock-session: unlock once, use without password, lock forces 401",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      const locked = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(locked.status, 401);
      assertEquals(locked.body.error, "identity locked");
      assertEquals(locked.body.details?.code, "identity_locked");

      const wrong = await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: "nope-nope-nope-1",
      });
      assertEquals(wrong.status, 401);

      const unlocked = await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
        timeoutMinutes: 5,
      });
      assertEquals(unlocked.status, 200);
      assertEquals(unlocked.body.unlocked, true);
      assertEquals(unlocked.body.timeoutMinutes, 5);

      const info = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(info.status, 200);
      assertEquals(info.body.fingerprint, unlocked.body.fingerprint);

      const statusRes = await handleRequest(req(
        "GET",
        `/api/v1/identity/unlock-status?home=${
          encodeURIComponent(home)
        }&identity=me`,
      ));
      const status = await statusRes.json();
      assertEquals(status.unlocked, true);
      assert(status.remainingMs > 0);

      const lockRes = await post("/api/v1/identity/lock", {
        home,
        identity: "me",
      });
      assertEquals(lockRes.body.locked, true);
      assertEquals(lockRes.body.unlocked, false);

      const after = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(after.status, 401);
      assertEquals(after.body.error, "identity locked");
    }),
});

Deno.test({
  name: "unlock-session: idle expiry slides on use and then locks",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      let now = 1_000_000;
      setUnlockClockForTest(() => now);
      await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
        timeoutMinutes: 1,
      });
      now += 50_000;
      const used = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(used.status, 200);
      now += 50_000;
      const stillOpen = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(stillOpen.status, 200, "use should refresh idle timer");
      now += 61_000;
      assertEquals(sweepExpiredSessions(), 1);
      const expired = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(expired.status, 401);
    }),
});

Deno.test({
  name: "unlock-session: salt change (password change) evicts session",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      const path = `${home}/.ebp/me.identity.json`;
      const reencrypted = Identity.fromStorageFormat(
        await Deno.readTextFile(path),
        PASSWORD,
      ).toStorageFormat("Brand-New-Password-42");
      await Deno.writeTextFile(path, reencrypted);

      const res = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(res.status, 401);
      assertEquals(res.body.error, "identity locked");
      const ctx = await getContext(home, "me");
      assertEquals(getUnlockStatus(ctx).unlocked, false);
    }),
});

Deno.test({
  name: "unlock-session: session re-save keeps salt and stays unlocked",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      const detail = await post("/api/v1/detail", {
        home,
        identity: "me",
        path: "name",
        detail: "Alice",
      });
      assertEquals(detail.status, 200, JSON.stringify(detail.body));
      const info = await post("/api/v1/identity/info", {
        home,
        identity: "me",
      });
      assertEquals(info.status, 200);
      assert(
        info.body.details.some((d: { path: string }) => d.path === "name"),
      );
      const reloaded = Identity.fromStorageFormat(
        await Deno.readTextFile(`${home}/.ebp/me.identity.json`),
        PASSWORD,
      );
      assertEquals(reloaded.getDetail("name"), "Alice");
    }),
});

Deno.test({
  name:
    "unlock-session: identity unlock opens PIN-matching mail secrets; lock clears them",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      const ebpDir = `${home}/.ebp`;
      const envelope = await encryptSecretsStore({
        acct: { imapPassword: "imap", smtpPassword: "smtp" },
      }, PASSWORD);
      await Deno.writeTextFile(
        `${ebpDir}/mail-account.secrets.json`,
        JSON.stringify(envelope),
      );
      const unlocked = await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      assertEquals(unlocked.body.mailSecretsUnlocked, true);
      assertEquals(mailSecretCache.get(ebpDir)?.acct?.imapPassword, "imap");

      await post("/api/v1/identity/lock", { home, identity: "me" });
      assertEquals(mailSecretCache.has(ebpDir), false);
      assertEquals(mailPinCache.has(ebpDir), false);

      const otherPin = await encryptSecretsStore({
        acct: { imapPassword: "imap", smtpPassword: "smtp" },
      }, "a-different-pin");
      await Deno.writeTextFile(
        `${ebpDir}/mail-account.secrets.json`,
        JSON.stringify(otherPin),
      );
      const second = await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      assertEquals(second.status, 200);
      assertEquals(second.body.mailSecretsUnlocked, false);
      assertEquals(mailSecretCache.has(ebpDir), false);
    }),
});

Deno.test({
  name:
    "mail credentials: identity password protects new accounts; supplied PIN is ignored",
  permissions: PERMS,
  fn: () =>
    withIdentityHome(async (home) => {
      const locked = await post("/api/v1/mail/account", {
        home,
        createNew: true,
      });
      assertEquals(locked.status, 401);
      await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      const saved = await post("/api/v1/mail/account", {
        home,
        createNew: true,
        pin: "must-not-be-used",
        account: {
          authType: "password",
          persistSecrets: true,
          imapHost: "imap.example.com",
          smtpHost: "smtp.example.com",
          username: "me@example.com",
          fromEmail: "me@example.com",
        },
        imapPassword: "imap-secret",
        smtpPassword: "smtp-secret",
      });
      assertEquals(saved.status, 200, JSON.stringify(saved.body));
      await post("/api/v1/identity/lock", { home, identity: "me" });
      const unlocked = await post("/api/v1/identity/unlock", {
        home,
        identity: "me",
        password: PASSWORD,
      });
      assertEquals(unlocked.body.mailSecretsUnlocked, true);
      assertEquals(
        Object.values(mailSecretCache.get(`${home}/.ebp`) ?? {})[0]
          ?.imapPassword,
        "imap-secret",
      );
    }),
});

Deno.test({
  name: "obsolete mail PIN migration route is unavailable and leaves credentials untouched",
  permissions: PERMS,
  fn: () => withIdentityHome(async (home) => {
    const path = `${home}/.ebp/mail-account.secrets.json`;
    const original = JSON.stringify(await encryptSecretsStore({acct: {imapPassword: "imap", smtpPassword: "smtp"}}, "old-pin"));
    await Deno.writeTextFile(path, original);
    await post("/api/v1/identity/unlock", {home, identity: "me", password: PASSWORD});
    assertEquals((await post("/api/v1/mail/unlock", {home, pin: "old-pin"})).status, 404);
    assertEquals(await Deno.readTextFile(path), original);
    assertEquals(mailSecretCache.has(`${home}/.ebp`), false);
  }),
});
