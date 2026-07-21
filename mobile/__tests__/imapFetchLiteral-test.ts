import {Buffer} from 'buffer';
import {
  takeBytesFromBuffer,
  takeLineFromBuffer,
} from '../src/services/mail/tcpBuffer';
import {
  messageDetailFromRfc822,
  parseHeaderField,
  readFetchRfc822Source,
  type FetchBodyClient,
} from '../src/services/mail/imapFetchBody';

function scriptedClient(chunks: string[]): FetchBodyClient {
  let buffer = Buffer.from(chunks.join(''), 'utf8');
  return {
    readLine: async () => {
      const taken = takeLineFromBuffer(buffer);
      if (!taken) {
        throw new Error('scriptedClient: no line available');
      }
      buffer = taken.rest;
      return taken.line;
    },
    readBytes: async (n: number) => {
      const taken = takeBytesFromBuffer(buffer, n);
      if (!taken) {
        throw new Error(`scriptedClient: need ${n} bytes, have ${buffer.length}`);
      }
      buffer = taken.rest;
      return taken.chunk;
    },
  };
}

describe('IMAP BODY literal parsing', () => {
  it('decodes greeting as UTF-8 text, not comma-separated byte values', () => {
    // Regression: Uint8Array#toString() returns "42,32,79,75,..." for "* OK".
    const greeting =
      '* OK [CAPABILITY IMAP4rev1 SASL-IR] Dovecot ready.\r\n';
    const asUint8 = Uint8Array.from(Buffer.from(greeting, 'utf8'));
    const taken = takeLineFromBuffer(Buffer.from(asUint8));
    expect(taken).not.toBeNull();
    expect(taken!.line.startsWith('* OK')).toBe(true);
    expect(taken!.line).toContain('Dovecot ready.');
    expect(taken!.line.includes(',')).toBe(false);
  });

  it('takeLineFromBuffer and takeBytesFromBuffer preserve literal octets', () => {
    const rfc822 =
      'From: a@test\r\nSubject: Hello\r\n\r\nbody text\r\n';
    const wire = Buffer.from(
      `* 1 FETCH (UID 42 BODY[] {${Buffer.byteLength(rfc822, 'utf8')}}\r\n${rfc822})\r\nb3 OK FETCH completed\r\n`,
      'utf8',
    );
    const line1 = takeLineFromBuffer(wire);
    expect(line1).not.toBeNull();
    expect(line1!.line).toMatch(/BODY\[\] \{(\d+)\}$/);
    const n = Number(line1!.line.match(/\{(\d+)\}/)![1]);
    const lit = takeBytesFromBuffer(line1!.rest, n);
    expect(lit).not.toBeNull();
    expect(lit!.chunk).toBe(rfc822);
    const close = takeLineFromBuffer(lit!.rest);
    expect(close!.line).toBe(')');
  });

  it('readFetchRfc822Source extracts RFC822 from BODY[] {n} literal', async () => {
    const rfc822 = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Secret note',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      '-----BEGIN EBP MESSAGE-----',
      'payload-bytes',
      '-----END EBP MESSAGE-----',
      '',
    ].join('\r\n');
    const n = Buffer.byteLength(rfc822, 'utf8');
    const client = scriptedClient([
      `* 1 FETCH (UID 7 BODY[] {${n}}\r\n`,
      rfc822,
      ')\r\n',
      'b3 OK FETCH completed\r\n',
    ]);
    const source = await readFetchRfc822Source(client, 'b3');
    expect(source).toBe(rfc822);
    expect(parseHeaderField(source, 'Subject')).toBe('Secret note');
    expect(source).toContain('-----BEGIN EBP MESSAGE-----');
    const detail = messageDetailFromRfc822(
      7,
      source,
      {text: 'armor', html: ''},
      '-----BEGIN EBP MESSAGE-----\npayload-bytes\n-----END EBP MESSAGE-----',
    );
    expect(detail.subject).toBe('Secret note');
    expect(detail.from).toBe('alice@example.com');
    expect(detail.ebpPayload).toContain('-----BEGIN EBP MESSAGE-----');
  });

  it('readFetchRfc822Source handles quoted BODY[] strings', async () => {
    // IMAP quoted strings cannot contain CR/LF; tiny payloads use this form.
    const rfc822 = 'Subject: Tiny';
    const client = scriptedClient([
      `* 1 FETCH (UID 1 BODY[] "${rfc822}")\r\n`,
      'b3 OK FETCH completed\r\n',
    ]);
    const source = await readFetchRfc822Source(client, 'b3');
    expect(source).toBe(rfc822);
    expect(
      messageDetailFromRfc822(1, source, {text: '', html: ''}, null).subject,
    ).toBe('Tiny');
  });

  it('regression: star-only accumulation would drop the body', () => {
    // Documents the old bug: only lines starting with "* " were kept, so the
    // literal payload (and subject) never appeared in the parsed source.
    const rfc822 = 'Subject: Kept\r\n\r\nhello';
    const lines = [
      `* 1 FETCH (UID 9 BODY[] {${Buffer.byteLength(rfc822, 'utf8')}}`,
      rfc822,
      ')',
      'b3 OK FETCH completed',
    ];
    const starOnly = lines.filter(l => l.startsWith('* ')).join('\n');
    expect(parseHeaderField(starOnly, 'Subject')).toBe('');
    expect(starOnly).not.toContain('hello');
  });

  it('parseHeaderField ignores from: lines in the body', () => {
    const rfc822 = [
      'From: willdoyle422@gmail.com',
      'To: bob@example.com',
      'Subject: Hello',
      '',
      'from:to:cc:subject:date:message-id:reply-to',
      'body mentions From: spoof@evil.test as well',
      '',
    ].join('\r\n');
    expect(parseHeaderField(rfc822, 'From')).toBe('willdoyle422@gmail.com');
    expect(messageDetailFromRfc822(1, rfc822, {text: '', html: ''}, null).from).toBe(
      'willdoyle422@gmail.com',
    );
  });

  it('parseHeaderField unfolds continued header lines', () => {
    const rfc822 = [
      'From: Alice Example',
      ' <alice@example.com>',
      'Subject: Hello',
      '',
      'body',
      '',
    ].join('\r\n');
    expect(parseHeaderField(rfc822, 'From')).toBe(
      'Alice Example <alice@example.com>',
    );
  });
});
