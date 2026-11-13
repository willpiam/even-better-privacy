import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { sendVerificationEmail } from "../verify-email.ts";

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
      await assertRejects(() =>
        sendVerificationEmail(
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
