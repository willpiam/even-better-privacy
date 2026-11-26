import {Identity} from '../../core/Identity';
import {sha256Hex} from '../../core/MessageHash';
import {ContactQrScanner, encodeContactQr} from '../src/services/contactQr';

describe('contact QR exchange', () => {
  test.each(['dilithium', 'sphincs'] as const)(
    'recovers the %s identity from shuffled frames with duplicates',
    keyType => {
      const {summary} = new Identity(keyType, 'kyber');
      const frames = encodeContactQr(summary, 'Zoë 🦊');
      const scanner = new ContactQrScanner();
      const reversed = [...frames].reverse();

      expect(frames.length).toBeGreaterThan(1);
      expect(scanner.add(reversed[0])).toEqual({
        received: 1,
        total: frames.length,
      });
      expect(scanner.add(reversed[0])).toEqual({
        received: 1,
        total: frames.length,
      });
      const results = reversed.slice(1).map(frame => scanner.add(frame));
      expect(
        results.slice(0, -1).every(result => result.contact === undefined),
      ).toBe(true);
      expect(results.at(-1)?.contact).toEqual({
        name: 'Zoë 🦊',
        identity: expect.objectContaining({
          fingerprint: summary.fingerprint,
          signingKey: summary.signingKey,
          encryptionKey: summary.encryptionKey,
          signingKeyDetails: summary.signingKeyDetails,
          encryptionKeyDetails: summary.encryptionKeyDetails,
          details: {},
        }),
      });
    },
  );

  test('rejects unrelated codes, mixed identities, and damaged frames', () => {
    const {summary} = new Identity('dilithium', 'kyber');
    const frames = encodeContactQr(summary, 'Alice');
    const other = encodeContactQr(summary, 'Bob');
    const scanner = new ContactQrScanner();

    expect(() => scanner.add('https://example.com')).toThrow(/EBP contact QR/);
    scanner.add(frames[0]);
    expect(() => scanner.add(other[1])).toThrow(/different contact/);
    scanner.add(frames[1]);
    expect(() => scanner.add(frames[1].replace(/.$/, '!'))).toThrow(/conflict/);
    frames.slice(2, -1).forEach(frame => scanner.add(frame));
    expect(() => scanner.add(frames.at(-1)!.replace(/.$/, '!'))).toThrow(
      /damaged/,
    );
  });

  test('rejects a mismatched fingerprint even when all frame digests match', () => {
    const {summary} = new Identity('dilithium', 'kyber');
    const wrongFingerprint = new Identity('dilithium', 'kyber').toFingerprint();
    const frames = encodeContactQr(summary, 'Alice');
    const oldDigest = frames[0].split(':')[1];
    const chunks = frames
      .map(frame => frame.split(':').slice(3).join(':'))
      .map(chunk => chunk.replace(summary.fingerprint, wrongFingerprint));
    const newDigest = sha256Hex(chunks.join(''));
    const tamperedFrames = frames.map((frame, index) => {
      const header = frame.split(':').slice(0, 3).join(':');
      return `${header.replace(oldDigest, newDigest)}:${chunks[index]}`;
    });
    const scanner = new ContactQrScanner();
    tamperedFrames.slice(0, -1).forEach(frame => scanner.add(frame));
    expect(() => scanner.add(tamperedFrames.at(-1)!)).toThrow(/fingerprint/);
  });
});
