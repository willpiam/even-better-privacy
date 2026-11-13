import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.6";
import {
  DEFAULT_MAIL_ACCOUNT,
  buildSmtpAuth,
  getMailStore,
  normalizeMailConfig,
  parseLegacySecretsStore,
} from "../mail-account.ts";

const account = {
  ...DEFAULT_MAIL_ACCOUNT,
  imapHost: "mail.pqpost.com",
  smtpHost: "mail.pqpost.com",
  username: "alice@pqpost.com",
  fromEmail: "alice@pqpost.com",
};

Deno.test("password account normalization and SMTP authentication preserve managed mail", () => {
  assertEquals(normalizeMailConfig(DEFAULT_MAIL_ACCOUNT, account), account);
  assertEquals(buildSmtpAuth(account, { imapPassword: "imap", smtpPassword: "smtp" }), {
    user: "alice@pqpost.com", pass: "smtp",
  });
  assertThrows(() => normalizeMailConfig(account, { authType: "oauth" }), Error,
    "Only password authentication is supported");
});

Deno.test("stored unsupported accounts cannot be selected as password accounts", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/mail-account.json`, JSON.stringify({
      selectedAccountId: "old",
      accounts: [
        { id: "old", name: "Old", config: { ...account, authType: "oauth" } },
        { id: "managed", name: "Managed", config: account },
      ],
    }));
    const store = await getMailStore(dir);
    assertEquals(store.selectedAccountId, "managed");
    assertEquals(store.accounts.map(a => a.id), ["managed"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("legacy secret parsing keeps only password credentials", () => {
  assertEquals(parseLegacySecretsStore({
    account: { imapPassword: "imap", smtpPassword: "smtp", accessToken: "old", refreshToken: "old" },
  }), { account: { imapPassword: "imap", smtpPassword: "smtp" } });
});
