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

import {
  buildUidSearchCommand,
  clampMailLimit,
  paginateUids,
  quoteImap,
} from '../src/services/mail/imap';
import {resolveMailTlsMode} from '../src/services/mail/tcpClient';
import {parseRecipientAddresses} from '../src/services/mail/smtp';
import {buildSandboxedEmailSrcDoc} from '../src/services/mail/sandboxedHtml';
import {
  buildMultipartMimeMessage,
  extractTextFromMimeSource,
} from '../src/services/mail/mime';

describe('mail list helpers', () => {
  it('clampMailLimit clamps to 1–100 with default 20', () => {
    expect(clampMailLimit(0)).toBe(1);
    expect(clampMailLimit(20)).toBe(20);
    expect(clampMailLimit(100)).toBe(100);
    expect(clampMailLimit(101)).toBe(100);
    expect(clampMailLimit(Number.NaN)).toBe(20);
  });

  it('paginateUids matches GUI newest-first math', () => {
    const uids = [1, 2, 3, 4, 5];
    expect(paginateUids(uids, 1, 2)).toEqual({
      uids: [5, 4],
      page: 1,
      totalPages: 3,
      total: 5,
    });
    expect(paginateUids(uids, 2, 2)).toEqual({
      uids: [3, 2],
      page: 2,
      totalPages: 3,
      total: 5,
    });
    expect(paginateUids(uids, 3, 2)).toEqual({
      uids: [1],
      page: 3,
      totalPages: 3,
      total: 5,
    });
    expect(paginateUids([], 1, 20)).toEqual({
      uids: [],
      page: 1,
      totalPages: 1,
      total: 0,
    });
    expect(paginateUids(uids, 99, 2).page).toBe(3);
  });

  it('quoteImap quotes mailbox names with spaces', () => {
    expect(quoteImap('INBOX')).toBe('INBOX');
    expect(quoteImap('Sent Mail')).toBe('"Sent Mail"');
  });

  it.each([
    ['pass)word', '"pass)word"'],
    ['pass(word', '"pass(word"'],
    ['pass{word', '"pass{word"'],
    ['pass]word', '"pass]word"'],
    ['pass%word', '"pass%word"'],
    ['pass*word', '"pass*word"'],
    ['pass\\word', '"pass\\\\word"'],
    ['pass"word', '"pass\\"word"'],
    ['', '""'],
  ])('quoteImap safely encodes %j', (value, expected) => {
    expect(quoteImap(value)).toBe(expected);
  });

  it.each(['a\rb', 'a\nb', 'a\0b', 'a\tb'])('rejects IMAP control characters in %j', value => {
    expect(() => quoteImap(value)).toThrow('control characters');
  });

  it('buildUidSearchCommand searches the whole mailbox or a text query', () => {
    expect(buildUidSearchCommand('a3')).toBe('a3 UID SEARCH ALL');
    expect(buildUidSearchCommand('a3', '  ')).toBe('a3 UID SEARCH ALL');
    expect(buildUidSearchCommand('a3', 'hello "world"')).toBe(
      'a3 UID SEARCH TEXT "hello \\"world\\""',
    );
  });

  it('resolveMailTlsMode chooses implicit vs STARTTLS', () => {
    expect(resolveMailTlsMode(true)).toBe('implicit-tls');
    expect(resolveMailTlsMode(false)).toBe('starttls');
  });
});

describe('listMailboxMessages IMAP commands (mocked client)', () => {
  it('issues SELECT for folder and paginated FETCH', async () => {
    const written: string[] = [];
    const lines = [
      '* OK ready',
      'a1 OK LOGIN completed',
      '* LIST (\\Sent) "/" "Sent Items"',
      's1 OK LIST completed',
      'a2 OK SELECT completed',
      '* SEARCH 10 11 12',
      'a3 OK SEARCH completed',
      '* 1 FETCH (UID 12 FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {52}',
      ')',
      '* 2 FETCH (UID 11 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {48}',
      ')',
      'a4 OK FETCH completed',
    ];
    let idx = 0;
    const client = {
      writeLine: (line: string) => {
        written.push(line);
      },
      readLine: async () => {
        const line = lines[idx++];
        if (line === undefined) {
          throw new Error('no more lines');
        }
        return line;
      },
      readBytes: jest.fn()
        .mockResolvedValueOnce('Subject: Newest\r\nFrom: n@e\r\nDate: today\r\n\r\n')
        .mockResolvedValueOnce('Subject: Mid\r\nFrom: m@e\r\nDate: yesterday\r\n\r\n'),
      writeBytes: () => undefined,
      close: () => undefined,
    };

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

    const {listMailboxMessages} = require('../src/services/mail/imap');
    const result = await listMailboxMessages(
      {
        authType: 'password',
        imapHost: 'imap.test',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.test',
        smtpPort: 465,
        smtpSecure: true,
        username: 'user',
        fromEmail: 'user@test',
        fromName: '',
        persistSecrets: false,
      },
      {imapPassword: 'secret', smtpPassword: 'secret'},
      {folder: 'Sent', page: 1, limit: 2},
    );

    expect(written.some(l => l.includes('LIST "" "*"'))).toBe(true);
    expect(written.some(l => l.includes('SELECT "Sent Items"'))).toBe(true);
    expect(written.some(l => l.includes('SELECT INBOX'))).toBe(false);
    expect(result.folder).toBe('Sent Items');
    expect(result.total).toBe(3);
    expect(result.messages.map((m: {uid: number}) => m.uid)).toEqual([12, 11]);
    expect(result.messages[0].subject).toBe('Newest');
  });
});

describe('appendSentCopy', () => {
  const account = {
    authType: 'password' as const,
    imapHost: 'imap.test',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.test',
    smtpPort: 465,
    smtpSecure: true,
    username: 'user',
    fromEmail: 'user@test',
    fromName: '',
    persistSecrets: false,
  };
  const secrets = {imapPassword: 'secret', smtpPassword: 'secret'};

  function mockClient(lines: string[]) {
    const written: string[] = [];
    const bytes: string[] = [];
    let idx = 0;
    const client = {
      written,
      bytes,
      writeLine: (line: string) => {
        written.push(line);
      },
      writeBytes: (data: string | Uint8Array) => {
        bytes.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
      },
      readLine: async () => {
        const line = lines[idx++];
        if (line === undefined) {
          throw new Error('no more lines');
        }
        return line;
      },
      readBytes: async () => {
        throw new Error('unexpected readBytes');
      },
      close: () => undefined,
    };
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
    return client;
  }

  it('appends to the \\Sent mailbox', async () => {
    const client = mockClient([
      '* OK ready',
      'a1 OK LOGIN completed',
      '* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"',
      's1 OK LIST completed',
      '+ go ahead',
      's3 OK APPEND completed',
    ]);
    const {appendSentCopy} = require('../src/services/mail/imap');
    const mailbox = await appendSentCopy(account, secrets, 'Subject: Hi\r\n\r\nBody\r\n');
    expect(mailbox).toBe('Sent Items');
    expect(client.written.some((line: string) => line.startsWith('s3 APPEND "Sent Items" (\\Seen) {'))).toBe(true);
    expect(client.bytes[0]).toContain('Subject: Hi');
    const appendLine = client.written.find((line: string) => line.startsWith('s3 APPEND'));
    const literalSize = Number(appendLine.match(/\{(\d+)\}/)?.[1]);
    expect(Buffer.byteLength(client.bytes[0])).toBe(literalSize);
    expect(client.bytes[1]).toBe('\r\n');
    expect(client.written.some((line: string) => line.startsWith('s2 CREATE'))).toBe(false);
  });

  it('creates Sent when the server has no sent mailbox', async () => {
    const client = mockClient([
      '* OK ready',
      'a1 OK LOGIN completed',
      's1 OK LIST completed',
      's2 OK CREATE completed',
      '+ go ahead',
      's3 OK APPEND completed',
    ]);
    const {appendSentCopy} = require('../src/services/mail/imap');
    const mailbox = await appendSentCopy(account, secrets, 'Subject: Hi\n\nBody');
    expect(mailbox).toBe('Sent');
    expect(client.written).toContain('s2 CREATE Sent');
    expect(client.bytes[0].endsWith('\r\n')).toBe(true);
    expect(client.bytes[1]).toBe('\r\n');
  });
});

describe('SMTP multi-recipient parsing', () => {
  it('parseRecipientAddresses extracts angle and bare addresses', () => {
    expect(
      parseRecipientAddresses('Alice <a@ex.com>, bob@ex.com, "C" <c@ex.com>'),
    ).toEqual(['a@ex.com', 'bob@ex.com', 'c@ex.com']);
  });
});

describe('sandboxed HTML', () => {
  it('includes CSP meta and embeds body html without script execution hooks', () => {
    const doc = buildSandboxedEmailSrcDoc('<p>Hi</p><script>alert(1)</script>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('sandbox=""');
    expect(doc).toContain('&lt;p&gt;Hi&lt;/p&gt;');
    expect(doc).toContain('Content-Security-Policy');
  });
});

describe('MIME attachments', () => {
  it('round-trips multipart/mixed with base64 attachment part', () => {
    const payload = Buffer.from('hello attachment').toString('base64');
    const mime = buildMultipartMimeMessage({
      from: 'a@ex.com',
      to: 'b@ex.com, c@ex.com',
      subject: 'Files',
      plainBody: 'See attached',
      attachments: [
        {
          filename: 'note.txt',
          contentType: 'text/plain',
          contentBase64: payload,
        },
      ],
    });
    expect(mime).toContain('Content-Type: multipart/mixed');
    expect(mime).toContain('Content-Disposition: attachment; filename="note.txt"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime.replace(/\s+/g, '')).toContain(payload);
    const text = extractTextFromMimeSource(mime);
    expect(text.text).toContain('See attached');
  });
});
