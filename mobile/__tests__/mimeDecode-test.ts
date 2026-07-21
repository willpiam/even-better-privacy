import {Buffer} from 'buffer';
import {
  armorPayload,
  extractArmoredPayload,
} from '../../core/Payloads';
import {
  buildMultipartMimeMessage,
  decodeTransferEncoding,
  extractEbpPayloadFromMime,
  extractTextFromMimeSource,
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
    if (
      (b >= 33 && b <= 60) ||
      (b >= 62 && b <= 126) ||
      b === 9 ||
      b === 32
    ) {
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
