import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  loadEnvFile,
  type Mailbox,
  type MailTestConfig,
  readMailTestConfig,
  runMailE2e,
  TEST_MAIL_DOMAIN,
} from "./pqpost_mail_e2e.ts";

const CONFIG: MailTestConfig = {
  keyServer: "http://127.0.0.1:8789",
  mailHost: "mail.pqpost.com",
  secret: "test-only-e2e-secret",
};

function signupConfig(domain = TEST_MAIL_DOMAIN) {
  return {
    enabled: true,
    domain,
    imap: { host: CONFIG.mailHost, port: 993, secure: true },
    smtp: { host: CONFIG.mailHost, port: 465, secure: true },
  };
}

function fixture(
  options: {
    failSecondSignup?: boolean;
    wrongEmail?: boolean;
    failCleanup?: boolean;
  } = {},
) {
  const calls: Array<
    { path: string; body: Record<string, unknown> | undefined }
  > = [];
  const created: string[] = [];
  const sent: Array<
    { from: Mailbox; to: Mailbox; subject: string; text: string }
  > = [];
  const received: string[] = [];
  const cleaned: string[][] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assertEquals(url.origin, CONFIG.keyServer);
    const path = url.pathname;
    const request = new Request(input, init);
    const body = request.body ? await request.json() : undefined;
    calls.push({ path, body });
    if (path === "/api/v1/mail/signup/config") {
      assertEquals(init?.method ?? "GET", "GET");
      assertEquals(new Headers(init?.headers).has("x-ebp-e2e-secret"), false);
      return Response.json(signupConfig());
    }
    assertEquals(init?.method, "POST");
    if (path === "/api/v1/identity") return Response.json({ ok: true });
    assertEquals(
      new Headers(init?.headers).get("x-ebp-e2e-secret"),
      CONFIG.secret,
    );
    if (path === "/api/v1/mail/e2e/cleanup") {
      if (body.usernames) {
        cleaned.push(body.usernames);
        if (options.failCleanup) {
          return Response.json({ error: "cleanup unavailable" }, {
            status: 502,
          });
        }
      } else assertEquals(body, { sweepOlderThanHours: 6 });
      return Response.json({ removed: body.usernames ?? [] });
    }
    if (path === "/api/v1/mail/signup") {
      if (options.failSecondSignup && created.length === 1) {
        return Response.json({ error: "provisioning unavailable" }, {
          status: 502,
        });
      }
      const username = body.username as string;
      assert(/^e2e\d+$/.test(username));
      assert(/^[0-9a-f]+$/.test(body.mailPassword));
      assertEquals(body.mailPassword.length, 48);
      const proof = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(
          body.detailProof.match(/../g),
          (hex: string) => parseInt(hex, 16),
        ),
      ));
      assertEquals(proof.path, "email");
      assertEquals(proof.detail, `${username}@${TEST_MAIL_DOMAIN}`);
      assert(typeof proof.signature === "string" && proof.signature.length > 0);
      created.push(username);
      const email = `${username}@${
        options.wrongEmail ? "pqpost.com" : TEST_MAIL_DOMAIN
      }`;
      return Response.json({ email, login: email });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return {
    calls,
    created,
    sent,
    received,
    cleaned,
    deps: {
      fetchImpl,
      send: (
        host: string,
        from: Mailbox,
        to: Mailbox,
        subject: string,
        text: string,
      ) => {
        assertEquals(host, CONFIG.mailHost);
        sent.push({ from, to, subject, text });
        return Promise.resolve();
      },
      wait: (host: string, account: Mailbox, subject: string) => {
        assertEquals(host, CONFIG.mailHost);
        const mail = sent.find((m) =>
          m.subject === subject && m.to.email === account.email
        );
        assert(mail, "receive must check the message sent to this mailbox");
        received.push(subject);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("mail e2e loads file configuration before reading it and preserves process overrides", async () => {
  const keys = ["EBP_KEY_SERVER", "MAIL_HOST", "MAIL_E2E_SECRET"];
  const previous = keys.map((key) => Deno.env.get(key));
  const dir = await Deno.makeTempDir();
  try {
    keys.forEach((key) => Deno.env.delete(key));
    await Deno.writeTextFile(
      `${dir}/test.env`,
      [
        'export EBP_KEY_SERVER="http://localhost:9876/"',
        "MAIL_HOST='mail.fixture.test'",
        `MAIL_E2E_SECRET=${CONFIG.secret}`,
      ].join("\n"),
    );
    Deno.env.set("MAIL_HOST", CONFIG.mailHost);
    loadEnvFile(`${dir}/test.env`);
    assertEquals(readMailTestConfig(), {
      keyServer: "http://localhost:9876",
      mailHost: CONFIG.mailHost,
      secret: CONFIG.secret,
    });
    Deno.env.delete("EBP_KEY_SERVER");
    assertEquals(readMailTestConfig().keyServer, CONFIG.keyServer);
    Deno.env.set("MAIL_E2E_SECRET", "short");
    let failed = false;
    try {
      readMailTestConfig();
    } catch {
      failed = true;
    }
    assert(failed, "missing test credentials must fail locally");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous[index]!);
    });
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("mail e2e rejects production, disabled signup, and wrong transport settings before any mutation", async () => {
  const wrongHost = signupConfig();
  wrongHost.imap.host = "mail.other.test";
  const wrongPort = signupConfig();
  wrongPort.smtp.port = 587;
  const insecure = signupConfig();
  insecure.smtp.secure = false;
  for (
    const advertised of [
      signupConfig("pqpost.com"),
      { enabled: false },
      wrongHost,
      wrongPort,
      insecure,
    ]
  ) {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      assertEquals(init?.method ?? "GET", "GET");
      return Promise.resolve(Response.json(advertised));
    };
    await assertRejects(
      () => runMailE2e(CONFIG, { fetchImpl }),
      Error,
      "Refusing to run",
    );
    assertEquals(calls, ["/api/v1/mail/signup/config"]);
  }
});

Deno.test("mail e2e provisions test-domain accounts, delivers a unique message, and cleans both accounts", async () => {
  const f = fixture();
  await runMailE2e(CONFIG, f.deps);
  assertEquals(f.created.length, 2);
  assertEquals(f.sent.length, 1);
  assertEquals(f.sent[0].from.email, `${f.created[0]}@${TEST_MAIL_DOMAIN}`);
  assertEquals(f.sent[0].to.email, `${f.created[1]}@${TEST_MAIL_DOMAIN}`);
  assertEquals(f.received, [f.sent[0].subject]);
  assertEquals(f.cleaned, [f.created]);
});

Deno.test("mail e2e cleans the first mailbox when the second signup fails", async () => {
  const f = fixture({ failSecondSignup: true });
  await assertRejects(() => runMailE2e(CONFIG, f.deps), Error, "returned 502");
  assertEquals(f.created.length, 1);
  assertEquals(f.cleaned, [f.created]);
  assertEquals(f.sent, []);
});

Deno.test("mail e2e cleans a successful signup whose response has the wrong domain", async () => {
  const f = fixture({ wrongEmail: true });
  await assertRejects(
    () => runMailE2e(CONFIG, f.deps),
    Error,
    "expected test-domain email",
  );
  assertEquals(f.created.length, 1);
  assertEquals(f.cleaned, [f.created]);
  assertEquals(f.sent, []);
});

Deno.test("mail e2e cleans both mailboxes after delivery failure and preserves cleanup errors", async () => {
  for (const failCleanup of [false, true]) {
    const f = fixture({ failCleanup });
    const deliveryFailure = new Error("SMTP connection failed");
    const err = await assertRejects(() =>
      runMailE2e(CONFIG, {
        ...f.deps,
        send: () => Promise.reject(deliveryFailure),
      })
    );
    assertEquals(f.cleaned, [f.created]);
    assertEquals(f.created.length, 2);
    assertEquals(f.received, []);
    if (failCleanup) {
      assert(err instanceof AggregateError);
      assertEquals(err.errors[0], deliveryFailure);
      assertStringIncludes(err.errors[1].message, "returned 502");
    } else assertEquals(err, deliveryFailure);
  }
});
