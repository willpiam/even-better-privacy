import nodemailer from "nodemailer";

export function installVerificationSmtp() {
  const config = {
    SMTP_HOST: "smtp.example.test",
    SMTP_FROM: "sender@example.test",
    SMTP_PORT: "587",
    PUBLIC_BASE_URL: "https://keys.example.test",
  };
  const previous = Object.entries(config).map(([key, value]) => {
    const original = Deno.env.get(key);
    Deno.env.set(key, value);
    return [key, original] as const;
  });

  const originalCreateTransport = nodemailer.createTransport;
  const fixture = {
    deliveries: [] as { recipients: string[]; text: string }[],
    failDelivery: false,
    restore() {
      nodemailer.createTransport = originalCreateTransport;
      for (const [key, value] of previous) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    },
  };
  const transport = originalCreateTransport({
    name: "Verification test transport",
    version: "1",
    send(mail, callback) {
      const envelope = mail.message!.getEnvelope();
      const text = String(mail.data.text);
      fixture.deliveries.push({ recipients: envelope.to, text });
      if (fixture.failDelivery) {
        callback(new Error(text));
        return;
      }
      callback(null, {
        envelope,
        messageId: mail.message!.messageId(),
        accepted: envelope.to,
      });
    },
  });
  nodemailer.createTransport =
    (() => transport) as typeof originalCreateTransport;
  return fixture;
}
