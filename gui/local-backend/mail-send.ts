import { Buffer } from "node:buffer";
import nodemailer from "nodemailer";
import {
  buildSmtpAuth,
  type MailAccountConfig,
  type MailAuthSecrets,
} from "./mail-account.ts";
import { appendSentCopy, withImapReconnect } from "./mail-imap.ts";

export type OutboundMail = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Uint8Array;
  }>;
};

/** Sending and account connection checks use the same mandatory TLS policy. */
export function buildSmtpTransport(account: MailAccountConfig, secrets: MailAuthSecrets) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    requireTLS: !account.smtpSecure,
    auth: buildSmtpAuth(account, secrets),
  });
}

export async function compileRawMessage(mail: OutboundMail): Promise<Uint8Array> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built = await composer.sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
    headers: mail.headers,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
  });
  const message = (built as { message?: unknown }).message;
  if (typeof message === "string") return new TextEncoder().encode(message);
  if (message instanceof Uint8Array) return Buffer.from(message);
  throw new Error("mail composer did not return a message");
}

/**
 * Submit the message over SMTP, then APPEND the same bytes to Sent.
 * Delivery success stands if the copy cannot be saved.
 */
export async function deliverSmtpAndAppendSent(params: {
  account: MailAccountConfig;
  secrets: MailAuthSecrets;
  mail: OutboundMail;
  envelopeTo: string[];
}): Promise<{ messageId: string | null; savedToSent: boolean }> {
  const raw = await compileRawMessage(params.mail);
  const from = params.account.fromEmail || params.account.username;
  const transport = buildSmtpTransport(params.account, params.secrets);
  const info = await transport.sendMail({
    envelope: { from, to: params.envelopeTo },
    raw,
  });
  let savedToSent = false;
  try {
    await withImapReconnect(params.account, params.secrets, async (imap) => {
      await appendSentCopy(imap, raw);
    });
    savedToSent = true;
  } catch (err) {
    console.warn(
      `mail/send sent-copy failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return {
    messageId: info.messageId ?? null,
    savedToSent,
  };
}
