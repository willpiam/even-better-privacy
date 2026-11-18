import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import {
  createVerificationMailer,
  parseVerificationMailbox,
  prepareVerificationDelivery,
} from "../verify-email.ts";
import { installVerificationSmtp } from "./verification_smtp_fixture.ts";

Deno.test("verification accepts only a bare mailbox and normalizes its domain", () => {
  assertEquals(
    parseVerificationMailbox("User+tag@BÜCHER.example"),
    "User+tag@xn--bcher-kva.example",
  );
  for (const value of [
    "alice@example.test, bob@example.test",
    "Example <alice@example.test>",
    "Family: alice@example.test;",
    "alice@example.test\r\n",
    "alice(comment)@example.test",
    "alice..bob@example.test",
    "alice@-example.test",
    "alice@example..test",
    "alice@[127.0.0.1]",
    "alice@127.0.0.1",
    "alice@exa／mple.test",
  ]) assertEquals(parseVerificationMailbox(value), null, value);
});

Deno.test("verification rejects public URLs with query or fragment delimiters", () => {
  const smtp = installVerificationSmtp();
  try {
    const request = new Request("https://keys.example.test/api/v1/detail");
    for (const suffix of ["?", "#", "?key=value", "#fragment"]) {
      Deno.env.set("PUBLIC_BASE_URL", `https://keys.example.test/${suffix}`);
      assertEquals(prepareVerificationDelivery(request), null);
    }
  } finally {
    smtp.restore();
  }
});

for (const advertiseTls of [false, true]) {
  Deno.test(`verification SMTP refuses credentials and mail when STARTTLS is ${advertiseTls ? "rejected" : "missing"}`, async () => {
    const keys = [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_FROM",
      "SMTP_USER",
      "SMTP_PASS",
    ];
    const previous = keys.map((key) => Deno.env.get(key));
    const sockets = new Set<Socket>();
    let authSent = false;
    let mailSent = false;
    let starttlsSent = false;
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.write("220 localhost test\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (line.startsWith("EHLO")) {
            socket.write(
              `250-localhost\r\n${
                advertiseTls ? "250-STARTTLS\r\n" : ""
              }250 AUTH PLAIN LOGIN\r\n`,
            );
          } else if (line === "STARTTLS") {
            starttlsSent = true;
            socket.write("454 TLS unavailable\r\n");
          } else if (line.startsWith("AUTH")) {
            authSent = true;
            socket.end("535 stopped\r\n");
          } else if (line.startsWith("MAIL")) {
            mailSent = true;
            socket.end("550 stopped\r\n");
          } else socket.write("500 unknown command\r\n");
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const values = [
      "127.0.0.1",
      String((server.address() as { port: number }).port),
      "false",
      "sender@example.test",
      "dummy-user",
      "dummy-pass",
    ];
    keys.forEach((key, i) => Deno.env.set(key, values[i]));
    try {
      const send = createVerificationMailer();
      assert(send);
      await assertRejects(() =>
        send(
          "recipient@example.test",
          "https://example.test/verify#test",
          "test-fingerprint",
        )
      );
      assertEquals(starttlsSent, true);
      assertEquals(authSent, false);
      assertEquals(mailSent, false);
    } finally {
      keys.forEach((key, i) =>
        previous[i] === undefined
          ? Deno.env.delete(key)
          : Deno.env.set(key, previous[i]!)
      );
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
