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

  it('buildUidSearchCommand uses ALL or TEXT', () => {
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
      'a2 OK SELECT completed',
      '* SEARCH 10 11 12',
      'a3 OK SEARCH completed',
      '* 1 FETCH (FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {52}',
      'Subject: Newest',
      'From: n@e',
      'Date: today',
      '',
      ')',
      'f12 OK FETCH completed',
      '* 1 FETCH (FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {48}',
      'Subject: Mid',
      'From: m@e',
      'Date: yesterday',
      '',
      ')',
      'f11 OK FETCH completed',
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

    const {listMailboxMessages} = require('../src/services/mail/imap');
    const result = await listMailboxMessages(
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
        username: 'user',
        fromEmail: 'user@test',
        fromName: '',
        persistSecrets: false,
      },
      {imapPassword: 'secret', smtpPassword: 'secret'},
      {folder: 'Sent', page: 1, limit: 2},
    );

    expect(written.some(l => l.includes('SELECT Sent'))).toBe(true);
    expect(written.some(l => l.includes('SELECT INBOX'))).toBe(false);
    expect(result.folder).toBe('Sent');
    expect(result.total).toBe(3);
    expect(result.messages.map((m: {uid: number}) => m.uid)).toEqual([12, 11]);
    expect(result.messages[0].subject).toBe('Newest');
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
    expect(doc).toContain('<p>Hi</p>');
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
