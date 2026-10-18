jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {
    connectTLS: jest.fn(),
    createConnection: jest.fn(),
    TLSSocket: jest.fn(),
  },
}));

jest.mock('../src/services/mail/mailTrace', () => ({
  mailStub: jest.fn(async () => undefined),
}));

import {parseRecipientAddresses} from '../src/services/mail/smtp';
import {resolveMailTlsMode} from '../src/services/mail/tcpClient';

type ScriptedClient = {
  written: string[];
  writeLine: (line: string) => void;
  readLine: () => Promise<string>;
  readBytes: (n: number) => Promise<string>;
  close: () => void;
  startTls?: () => Promise<void>;
};

function scriptedClient(lines: string[], opts?: {startTls?: boolean}): ScriptedClient {
  let idx = 0;
  const written: string[] = [];
  const client: ScriptedClient = {
    written,
    writeLine: (line: string) => {
      written.push(line);
    },
    readLine: async () => {
      const line = lines[idx++];
      if (line === undefined) {
        throw new Error(`scriptedClient: no line at ${idx}`);
      }
      return line;
    },
    readBytes: async () => {
      throw new Error('unexpected readBytes');
    },
    close: () => undefined,
  };
  if (opts?.startTls) {
    client.startTls = async () => undefined;
  }
  return client;
}

describe('SMTP send multi RCPT', () => {
  it('issues RCPT TO for each recipient and uses STARTTLS when insecure', async () => {
    const client = scriptedClient(
      [
        '220 smtp ready',
        '250-smtp Hello',
        '250 STARTTLS',
        '220 Ready to start TLS',
        '250-smtp Hello',
        '250 AUTH LOGIN',
        '334 VXNlcm5hbWU6',
        '334 UGFzc3dvcmQ6',
        '235 2.7.0 Authentication successful',
        '250 2.1.0 Ok',
        '250 2.1.5 Ok',
        '250 2.1.5 Ok',
        '354 End data with <CR><LF>.<CR><LF>',
        '250 2.0.0 Ok: queued',
      ],
      {startTls: true},
    );

    jest.resetModules();
    jest.doMock('react-native-tcp-socket', () => ({
      __esModule: true,
      default: {
        connectTLS: jest.fn(),
        createConnection: jest.fn(),
        TLSSocket: jest.fn(),
      },
    }));
    jest.doMock('../src/services/mail/mailTrace', () => ({
      mailStub: jest.fn(async () => undefined),
    }));
    jest.doMock('../src/services/mail/tcpClient', () => {
      const actual = jest.requireActual('../src/services/mail/tcpClient');
      return {
        ...actual,
        connectMailLineClient: jest.fn(async () => client),
      };
    });

    const {sendMimeMessage} = require('../src/services/mail/smtp');
    await sendMimeMessage(
      {
        gmailMode: false,
        authType: 'password',
        oauthProvider: '',
        imapHost: 'imap.test',
        imapPort: 143,
        imapSecure: false,
        smtpHost: 'smtp.test',
        smtpPort: 587,
        smtpSecure: false,
        username: 'user@test',
        fromEmail: 'user@test',
        fromName: '',
        persistSecrets: false,
      },
      {imapPassword: 'x', smtpPassword: 'x'},
      [
        'From: user@test',
        'To: Alice <a@ex.com>, bob@ex.com',
        'Subject: Hi',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'hello',
      ].join('\r\n'),
    );

    expect(client.written).toContain('STARTTLS');
    expect(client.written.filter((l: string) => l.startsWith('RCPT TO:'))).toEqual([
      'RCPT TO:<a@ex.com>',
      'RCPT TO:<bob@ex.com>',
    ]);
    expect(resolveMailTlsMode(false)).toBe('starttls');
    expect(parseRecipientAddresses('a@ex.com, b@ex.com')).toEqual([
      'a@ex.com',
      'b@ex.com',
    ]);
  });

  it('skips STARTTLS when smtpSecure is true (implicit TLS)', async () => {
    const client = scriptedClient([
      '220 smtp ready',
      '250-smtp Hello',
      '250 AUTH LOGIN',
      '334 VXNlcm5hbWU6',
      '334 UGFzc3dvcmQ6',
      '235 ok',
      '250 ok',
      '250 ok',
      '354 go',
      '250 queued',
    ]);

    jest.resetModules();
    jest.doMock('react-native-tcp-socket', () => ({
      __esModule: true,
      default: {
        connectTLS: jest.fn(),
        createConnection: jest.fn(),
        TLSSocket: jest.fn(),
      },
    }));
    jest.doMock('../src/services/mail/mailTrace', () => ({
      mailStub: jest.fn(async () => undefined),
    }));
    jest.doMock('../src/services/mail/tcpClient', () => {
      const actual = jest.requireActual('../src/services/mail/tcpClient');
      return {
        ...actual,
        connectMailLineClient: jest.fn(async (params: {secure: boolean}) => {
          expect(params.secure).toBe(true);
          return client;
        }),
      };
    });

    const {sendMimeMessage} = require('../src/services/mail/smtp');
    await sendMimeMessage(
      {
        gmailMode: false,
        authType: 'password',
        oauthProvider: '',
        imapHost: 'imap.test',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.test',
        smtpPort: 465,
        smtpSecure: true,
        username: 'user@test',
        fromEmail: 'user@test',
        fromName: '',
        persistSecrets: false,
      },
      {imapPassword: 'x', smtpPassword: 'x'},
      'From: user@test\r\nTo: a@ex.com\r\nSubject: Hi\r\n\r\nhello',
    );

    expect(client.written).not.toContain('STARTTLS');
    expect(client.written).toContain('RCPT TO:<a@ex.com>');
  });
});
