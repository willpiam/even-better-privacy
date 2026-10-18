import type {MailAccountConfig, MailAuthSecrets} from './types';
import {connectMailLineClient, readTaggedOk} from './tcpClient';
import {imapAuthenticate} from './imap';
import {expectSmtpReady, smtpAuth} from './smtp';
import {mailStub} from './mailTrace';

export type MailTestProgress = (step: string) => void;

const DEFAULT_OVERALL_TIMEOUT_MS = 60_000;

export async function testImapConnection(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  onProgress?: MailTestProgress,
): Promise<void> {
  onProgress?.('Connecting IMAP…');
  await mailStub(
    'test.imap.start',
    `${config.imapHost}:${config.imapPort} secure=${config.imapSecure}`,
  );
  const client = await connectMailLineClient({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
  });
  try {
    onProgress?.('Authenticating IMAP…');
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', 'INBOX');
    onProgress?.('Selecting INBOX…');
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
  onProgress?: MailTestProgress,
): Promise<void> {
  onProgress?.('Connecting SMTP…');
  await mailStub(
    'test.smtp.start',
    `${config.smtpHost}:${config.smtpPort} secure=${config.smtpSecure}`,
  );
  const client = await connectMailLineClient({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
  });
  try {
    await expectSmtpReady(client);
    onProgress?.('Authenticating SMTP…');
    await smtpAuth(client, config, secrets);
    client.writeLine('QUIT');
    await mailStub('test.smtp.done');
  } finally {
    client.close();
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function testMailConnection(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  options?: {
    onProgress?: MailTestProgress;
    overallTimeoutMs?: number;
  },
): Promise<void> {
  const onProgress = options?.onProgress;
  const overallTimeoutMs =
    options?.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  await mailStub('test.start');
  const run = async () => {
    try {
      await testImapConnection(config, secrets, onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await mailStub('test.error', `IMAP: ${message}`);
      throw new Error(`IMAP failed: ${message}`);
    }
    try {
      await testSmtpConnection(config, secrets, onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await mailStub('test.error', `SMTP: ${message}`);
      throw new Error(`SMTP failed: ${message}`);
    }
    onProgress?.('Mail connection test passed');
    await mailStub('test.done');
  };
  await withTimeout(run(), overallTimeoutMs, 'Mail connection test');
}
