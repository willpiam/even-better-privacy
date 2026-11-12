import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import { createServer, type Socket } from "node:net";
import { DEFAULT_MAIL_ACCOUNT } from "../mail-account.ts";
import { buildImapClient, isMessageSeen } from "../mail-imap.ts";
import { buildSmtpTransport, deliverSmtpAndAppendSent } from "../mail-send.ts";

for (const protocol of ["smtp", "smtp-check", "imap"] as const) {
  const isSmtp = protocol !== "imap";
  for (const advertiseTls of [false, true]) {
    Deno.test(`${protocol} refuses authentication when STARTTLS is ${advertiseTls ? "rejected" : "missing"}`, async () => {
      let authSent = false;
      let connected = false;
      let starttlsSent = false;
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        connected = true;
        sockets.add(socket);
        socket.on("error", () => {});
        socket.write(
          isSmtp ? "220 local probe\r\n" : "* OK local probe\r\n",
        );
        let buffer = "";
        socket.on("data", (data) => {
          buffer += data.toString();
          while (buffer.includes("\n")) {
            const end = buffer.indexOf("\n");
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            const [tag, second] = line.split(/\s+/);
            const command = (isSmtp ? tag : second).toUpperCase();
            if (["AUTH", "AUTHENTICATE", "LOGIN"].includes(command)) {
              authSent = true;
              socket.end(
                isSmtp ? "535 stopped\r\n" : `${tag} NO stopped\r\n`,
              );
            } else if (command === "STARTTLS") {
              starttlsSent = true;
              socket.write(
                isSmtp
                  ? "454 TLS unavailable\r\n"
                  : `${tag} NO TLS unavailable\r\n`,
              );
            } else if (isSmtp && command === "EHLO") {
              socket.write(
                `250-localhost\r\n${
                  advertiseTls ? "250-STARTTLS\r\n" : ""
                }250 AUTH PLAIN LOGIN\r\n`,
              );
            } else if (!isSmtp && command === "CAPABILITY") {
              socket.write(
                `* CAPABILITY IMAP4rev1 AUTH=PLAIN${
                  advertiseTls ? " STARTTLS" : ""
                }\r\n${tag} OK done\r\n`,
              );
            } else if (!isSmtp) socket.write(`${tag} OK done\r\n`);
          }
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const port = (server.address() as { port: number }).port;
      const account = {
        ...DEFAULT_MAIL_ACCOUNT,
        username: "probe@example.test",
        imapHost: "127.0.0.1",
        smtpHost: "127.0.0.1",
        imapPort: port,
        smtpPort: port,
        imapSecure: false,
        smtpSecure: false,
      };
      const secrets = { imapPassword: "dummy", smtpPassword: "dummy" };
      const imap = !isSmtp ? buildImapClient(account, secrets) : null;
      try {
        const error = await assertRejects(() =>
          imap
            ? imap.connect()
            : protocol === "smtp-check"
            ? buildSmtpTransport(account, secrets).verify()
            : deliverSmtpAndAppendSent({
              account,
              secrets,
              envelopeTo: ["recipient@example.test"],
              mail: {
                from: "probe@example.test",
                to: "recipient@example.test",
                subject: "local",
                text: "local",
              },
            })
        );
        assert(error instanceof Error);
        assert(error.message.toUpperCase().includes("TLS"), error.message);
        assertEquals(connected, true);
        assertEquals(authSent, false);
        if (advertiseTls) assertEquals(starttlsSent, true);
      } finally {
        imap?.close();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}

Deno.test("seen state handles the Set returned by ImapFlow and array fixtures", () => {
  assertEquals(isMessageSeen(new Set(["\\Seen", "\\Answered"])), true);
  assertEquals(isMessageSeen(new Set(["\\Answered"])), false);
  assertEquals(isMessageSeen(new Set(["\\sEeN"])), true);
  assertEquals(isMessageSeen(["\\Seen"]), true);
  assertEquals(isMessageSeen(), false);
});
