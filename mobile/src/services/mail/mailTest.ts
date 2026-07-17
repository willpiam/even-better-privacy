import type {MailAccountConfig, MailAuthSecrets} from './types';
import {connectTlsLineClient, readTaggedOk} from './tcpClient';
import {imapAuthenticate} from './imap';
import {expectSmtpReady, smtpAuth} from './smtp';
import {mailStub} from './mailTrace';

export async function testImapConnection(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  await mailStub(
    'test.imap.start',
    `${config.imapHost}:${config.imapPort}`,
  );
  const client = await connectTlsLineClient({
    host: config.imapHost,
    port: config.imapPort,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', 'INBOX');
    client.writeLine('t2 SELECT INBOX');
    await readTaggedOk(client, 't2');
    await mailStub('imap.select.ok');
    await mailStub('test.imap.done');
  } finally {
    client.close();
  }
}

export async function testSmtpConnection(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  await mailStub(
    'test.smtp.start',
    `${config.smtpHost}:${config.smtpPort}`,
  );
  const client = await connectTlsLineClient({
    host: config.smtpHost,
    port: config.smtpPort,
  });
  try {
    await expectSmtpReady(client);
    await smtpAuth(client, config, secrets);
    client.writeLine('QUIT');
    await mailStub('test.smtp.done');
  } finally {
    client.close();
  }
}

export async function testMailConnection(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  await mailStub('test.start');
  try {
    await testImapConnection(config, secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mailStub('test.error', `IMAP: ${message}`);
    throw new Error(`IMAP failed: ${message}`);
  }
  try {
    await testSmtpConnection(config, secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mailStub('test.error', `SMTP: ${message}`);
    throw new Error(`SMTP failed: ${message}`);
  }
  await mailStub('test.done');
}
