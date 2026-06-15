import {Buffer} from 'buffer';
import type {MailAccountConfig, MailAuthSecrets} from './types';
import {connectTlsLineClient, type TcpLineClient} from './tcpClient';

async function expectSmtpReady(client: TcpLineClient): Promise<void> {
  const line = await client.readLine();
  if (!line.startsWith('220')) {
    throw new Error(`SMTP greeting failed: ${line}`);
  }
}

async function smtpAuth(
  client: TcpLineClient,
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  client.writeLine('EHLO ebp-mobile');
  await readSmtpUntil(client, '250');
  if (config.authType === 'oauth' && secrets.accessToken) {
    client.writeLine('AUTH XOAUTH2');
    const line = await client.readLine();
    if (!line.startsWith('334')) {
      throw new Error(`SMTP AUTH challenge failed: ${line}`);
    }
    const user = config.username || secrets.imapPassword;
    const raw = `user=${user}\x01auth=Bearer ${secrets.accessToken}\x01\x01`;
    client.writeLine(Buffer.from(raw, 'utf8').toString('base64'));
    await readSmtpUntil(client, '235');
    return;
  }
  client.writeLine('AUTH LOGIN');
  await readSmtpUntil(client, '334');
  client.writeLine(Buffer.from(config.username, 'utf8').toString('base64'));
  await readSmtpUntil(client, '334');
  client.writeLine(Buffer.from(secrets.smtpPassword, 'utf8').toString('base64'));
  await readSmtpUntil(client, '235');
}

async function readSmtpUntil(client: TcpLineClient, code: string): Promise<void> {
  while (true) {
    const line = await client.readLine();
    if (!line.startsWith(code)) {
      continue;
    }
    if (line.length > 3 && line[3] === '-') {
      continue;
    }
    if (line.length >= 3 && (line.length === 3 || line[3] === ' ')) {
      const status = Number(line.slice(0, 3));
      if (status >= 400) {
        throw new Error(line);
      }
      return;
    }
  }
}

export async function sendMimeMessage(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  mime: string,
): Promise<void> {
  const client = await connectTlsLineClient({
    host: config.smtpHost,
    port: config.smtpPort,
  });
  try {
    await expectSmtpReady(client);
    await smtpAuth(client, config, secrets);
    const from = config.fromEmail || config.username;
    const toMatch = mime.match(/^To:\s*(.+)$/im);
    const to = toMatch ? toMatch[1].trim() : '';
    client.writeLine(`MAIL FROM:<${from}>`);
    await readSmtpUntil(client, '250');
    client.writeLine(`RCPT TO:<${to}>`);
    await readSmtpUntil(client, '250');
    client.writeLine('DATA');
    await readSmtpUntil(client, '354');
    const data = mime.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    client.writeLine(`${data}\r\n.`);
    await readSmtpUntil(client, '250');
    client.writeLine('QUIT');
  } finally {
    client.close();
  }
}
