import {splitMailboxList} from "../../../../common/mail/Mailbox.ts";
import {Buffer} from 'buffer';
import type {MailAccountConfig, MailAuthSecrets} from './types';
import {connectMailLineClient, type TcpLineClient} from './tcpClient';
import {mailStub} from './mailTrace';

export async function expectSmtpReady(client: TcpLineClient): Promise<void> {
  await readSmtpUntil(client, '220');
}

/** Read exactly one SMTP reply, including all of its continuation lines. */
async function readSmtpUntil(client: TcpLineClient, expected: string | string[]): Promise<void> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  let replyCode: string | null = null;
  for (let count = 0; count < 100; count++) {
    const line = await client.readLine();
    const reply = /^(\d{3})([ -]|$)/.exec(line);
    if (!reply || (replyCode && reply[1] !== replyCode)) throw new Error(`Invalid SMTP reply: ${line}`);
    replyCode = reply[1];
    if (/^[45]/.test(replyCode)) throw new Error(line);
    if (reply[2] === '-') continue;
    if (!allowed.includes(replyCode)) throw new Error(`Unexpected SMTP reply: ${line}`);
    return;
  }
  throw new Error('SMTP reply exceeds line limit');
}

async function smtpEhlo(client: TcpLineClient): Promise<void> {
  await mailStub('smtp.ehlo.wait');
  client.writeLine('EHLO ebp-mobile');
  await readSmtpUntil(client, '250');
  await mailStub('smtp.ehlo.ok');
}

async function maybeSmtpStartTls(
  client: TcpLineClient,
  secure: boolean,
): Promise<void> {
  if (secure) {
    return;
  }
  await mailStub('smtp.starttls.wait');
  client.writeLine('STARTTLS');
  await readSmtpUntil(client, '220');
  if (!client.startTls) {
    throw new Error('SMTP STARTTLS upgrade unavailable on this connection');
  }
  await client.startTls();
  await mailStub('smtp.starttls.ok');
  // RFC 3207: must EHLO again after TLS upgrade.
  await smtpEhlo(client);
}

export async function smtpAuth(
  client: TcpLineClient,
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  await smtpEhlo(client);
  await maybeSmtpStartTls(client, config.smtpSecure);
  await mailStub('smtp.auth.wait', 'LOGIN');
  client.writeLine('AUTH LOGIN');
  await readSmtpUntil(client, '334');
  client.writeLine(Buffer.from(config.username, 'utf8').toString('base64'));
  await readSmtpUntil(client, '334');
  client.writeLine(Buffer.from(secrets.smtpPassword, 'utf8').toString('base64'));
  await readSmtpUntil(client, '235');
  await mailStub('smtp.auth.ok', 'LOGIN');
}

/** Extract RCPT addresses from a To: header (comma-separated). */
export function parseRecipientAddresses(toHeader: string): string[] {
  const parts = splitMailboxList(toHeader);
  const out: string[] = [];
  for (const part of parts) {
    const angle = part.match(/<([^>]+)>/);
    const addr = (angle ? angle[1] : part).trim();
    if (addr.includes('@')) {
      out.push(addr);
    }
  }
  return out;
}

export async function sendMimeMessage(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  mime: string,
  recipients?: string[],
): Promise<void> {
  if (/[^\x00-\x7f]/.test(mime)) throw new Error('MIME must use encoded headers and transfer encoding before SMTP delivery');
  await mailStub(
    'smtp.send.start',
    `${config.smtpHost}:${config.smtpPort}`,
  );
  const client = await connectMailLineClient({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
  });
  try {
    await expectSmtpReady(client);
    await smtpAuth(client, config, secrets);
    const from = config.fromEmail || config.username;
    const toMatch = mime.match(/^To:\s*(.+)$/im);
    const toHeader = toMatch ? toMatch[1].trim() : '';
    const rcpts =
      recipients && recipients.length > 0
        ? recipients
        : parseRecipientAddresses(toHeader);
    if (rcpts.length === 0) {
      throw new Error('No SMTP recipients found in To header');
    }
    for (const address of [from, ...rcpts]) {
      if (!address || /[<>\s\x00-\x1f\x7f-\uffff]/.test(address)) throw new Error('Invalid or non-ASCII SMTP envelope address');
    }
    client.writeLine(`MAIL FROM:<${from}>`);
    await readSmtpUntil(client, '250');
    for (const rcpt of rcpts) {
      client.writeLine(`RCPT TO:<${rcpt}>`);
      await readSmtpUntil(client, ['250', '251', '252']);
    }
    client.writeLine('DATA');
    await readSmtpUntil(client, '354');
    const data = mime.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    client.writeLine(`${data}\r\n.`);
    await readSmtpUntil(client, '250');
    client.writeLine('QUIT');
    await mailStub('smtp.send.done');
  } finally {
    client.close();
  }
}
