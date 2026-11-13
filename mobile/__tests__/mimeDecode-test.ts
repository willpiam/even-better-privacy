import {Buffer} from 'buffer';
import {armorPayload, extractArmoredPayload} from '../../core/Payloads';
import {
  buildMultipartMimeMessage,
  buildSimpleMimeMessage,
  decodeTransferEncoding,
  extractEbpPayloadFromMime,
  extractTextFromMimeSource,
  parseMimeMessage,
  MAX_MIME_DEPTH,
  MAX_MIME_ENTITIES,
} from '../src/services/mail/mime';

const MINIMAL_PAYLOAD = {
  type: 'ebp-encrypted-message',
  version: 1,
  recipientFingerprint: 'ebp1qqtestfingerprint000000000000000000000000000',
  ciphertext: 'aabbcc',
};

function qpEncodeWithSoftBreaks(text: string, lineLen = 76): string {
  const bytes = Buffer.from(text, 'utf8');
  let out = '';
  let col = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    let enc: string;
    if ((b >= 33 && b <= 60) || (b >= 62 && b <= 126) || b === 9 || b === 32) {
      enc = String.fromCharCode(b);
    } else {
      enc = `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    if (col + enc.length >= lineLen) {
      out += '=\r\n';
      col = 0;
    }
    out += enc;
    col += enc.length;
  }
  return out;
}

function parseEbpArmor(text: string): Record<string, unknown> | null {
  return extractArmoredPayload(text);
}

describe('mime decode for EBP armor', () => {
  it('rejects control characters in every outgoing header', () => {
    const base = {
      from: 'alice@example.test',
      to: 'bob@example.test',
      subject: 'hello',
      body: 'body',
      plainBody: 'body',
    };
    for (const field of [
      'from',
      'to',
      'subject',
      'messageId',
      'inReplyTo',
      'references',
    ] as const) {
      for (const control of ['\r\n', '\r', '\n', '\0']) {
        const params = {...base, [field]: `value${control}X-Injected: yes`};
        expect(() => buildSimpleMimeMessage(params)).toThrow(
          'invalid control characters',
        );
        expect(() => buildMultipartMimeMessage(params)).toThrow(
          'invalid control characters',
        );
      }
    }
    for (const field of ['filename', 'contentType'] as const) {
      const attachment = {
        filename: 'note.txt',
        contentType: 'text/plain',
        contentBase64: 'aGVsbG8=',
        [field]: 'value\r\nX-Injected: yes',
      };
      expect(() =>
        buildMultipartMimeMessage({...base, attachments: [attachment]}),
      ).toThrow('invalid control characters');
      expect(() =>
        buildSimpleMimeMessage({...base, attachments: [attachment]}),
      ).toThrow('invalid control characters');
    }
    const message = buildMultipartMimeMessage({
      ...base,
      attachments: [{filename: 'a"b\\c.txt', contentBase64: 'aGVsbG8='}],
    });
    expect(message).toContain('filename="a\\"b\\\\c.txt"');
  });
  it('round-trips attachment-free messages, including multiline bodies', () => {
    const body = 'first line\r\n\r\nlast line';
    const source = buildSimpleMimeMessage({
      from: 'a@example.test',
      to: 'b@example.test',
      subject: 'test',
      body,
    });
    expect(source).toContain('charset=utf-8\r\n\r\nfirst line');
    expect(extractTextFromMimeSource(source).text).toBe(
      'first line\n\nlast line',
    );
  });

  it('rejects excessive nesting and excessive sibling parts', () => {
    let nested = 'Content-Type: text/plain\r\n\r\nhello';
    for (let i = 0; i <= MAX_MIME_DEPTH; i++) {
      const boundary = `level${i}x`;
      nested = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${nested}\r\n--${boundary}--`;
    }
    expect(() => parseMimeMessage(nested)).toThrow(
      'MIME nesting limit exceeded',
    );
    const wide =
      'Content-Type: multipart/mixed; boundary="part"\r\n\r\n' +
      '--part\r\nContent-Type: text/plain\r\n\r\nhello\r\n'.repeat(
        MAX_MIME_ENTITIES,
      ) +
      '--part--';
    expect(() => parseMimeMessage(wide)).toThrow('MIME part limit exceeded');
  });

  it('decodes each base64 text part once for display and EBP extraction', () => {
    const armor = armorPayload(MINIMAL_PAYLOAD);
    const source = `Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(
      armor,
    ).toString('base64')}`;
    const from = jest.spyOn(Buffer, 'from');
    try {
      const parsed = parseMimeMessage(source);
      expect(parsed.text).toBe(armor);
      expect(parsed.ebpPayload).toBe(armor);
      expect(from.mock.calls.filter(call => call[1] === 'base64')).toHaveLength(
        1,
      );
    } finally {
      from.mockRestore();
    }
  });
  it('extracts armor from multipart mixed 7bit (mobile compose shape)', () => {
    const armor = armorPayload(MINIMAL_PAYLOAD);
    const source = buildMultipartMimeMessage({
      from: 'Alice <alice@example.com>',
      to: 'bob@example.com',
      subject: 'Secret',
      plainBody: 'This message is encrypted with Even Better Privacy.',
      ebpArmor: armor,
    });
    const extracted = extractEbpPayloadFromMime(source);
    expect(extracted).toBeTruthy();
    const parsed = parseEbpArmor(extracted!);
    expect(parsed).toMatchObject({
      type: 'ebp-encrypted-message',
      version: 1,
      ciphertext: 'aabbcc',
    });
  });

  it('extracts armor from quoted-printable text/plain with soft breaks', () => {
    const armor = armorPayload(MINIMAL_PAYLOAD);
    const qpBody = qpEncodeWithSoftBreaks(armor);
    expect(qpBody).toContain('=\r\n');
    const source = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: QP secret',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      qpBody,
    ].join('\r\n');

    // Raw marker slice would fail JSON.parse without CTE decode
    expect(extractArmoredPayload(source)).toBeNull();

    const extracted = extractEbpPayloadFromMime(source);
    expect(extracted).toBeTruthy();
    expect(parseEbpArmor(extracted!)).toMatchObject({
      type: 'ebp-encrypted-message',
      ciphertext: 'aabbcc',
    });

    const text = extractTextFromMimeSource(source);
    expect(text.text).toContain('-----BEGIN EBP MESSAGE-----');
    expect(text.text).not.toContain('=\r\n');
  });

  it('extracts armor from base64-encoded text/plain', () => {
    const armor = armorPayload(MINIMAL_PAYLOAD);
    const b64 = Buffer.from(armor, 'utf8').toString('base64');
    const source = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: B64 secret',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64,
    ].join('\r\n');

    expect(extractArmoredPayload(source)).toBeNull();

    const extracted = extractEbpPayloadFromMime(source);
    expect(extracted).toBeTruthy();
    expect(parseEbpArmor(extracted!)).toMatchObject({
      type: 'ebp-encrypted-message',
      version: 1,
    });
  });

  it('returns null when BEGIN/END markers exist but JSON is corrupt', () => {
    const source = [
      'From: alice@example.com',
      'Subject: Broken',
      'Content-Type: text/plain; charset=utf-8',
      '',
      '-----BEGIN EBP MESSAGE-----',
      '{ not valid json @@',
      '-----END EBP MESSAGE-----',
      '',
    ].join('\r\n');

    expect(extractEbpPayloadFromMime(source)).toBeNull();
  });

  it('decodeTransferEncoding handles QP hex escapes', () => {
    expect(decodeTransferEncoding('a=3Db', 'quoted-printable')).toBe('a=b');
    expect(decodeTransferEncoding('hi=\r\nthere', 'quoted-printable')).toBe(
      'hithere',
    );
  });
});
