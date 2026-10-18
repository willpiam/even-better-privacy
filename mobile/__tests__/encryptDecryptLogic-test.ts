import {
  isEncryptedFileType,
  isEncryptedMessageType,
  isEncryptedSignedFileType,
  isEncryptedSignedMessageMultiType,
  isEncryptedSignedMessageType,
  normalizeFileUri,
  requireCiphertext,
  senderFieldsFromPayload,
} from '../src/services/encryptDecryptLogic';

describe('encryptDecryptLogic', () => {
  test('normalizeFileUri strips file://', () => {
    expect(normalizeFileUri('file:///tmp/a.bin')).toBe('/tmp/a.bin');
    expect(normalizeFileUri('/tmp/a.bin')).toBe('/tmp/a.bin');
  });

  test('requireCiphertext throws when missing', () => {
    expect(() => requireCiphertext({})).toThrow(/ciphertext/);
    expect(requireCiphertext({ciphertext: 'abc'})).toBe('abc');
  });

  test('senderFieldsFromPayload extracts optional fields', () => {
    expect(senderFieldsFromPayload({})).toEqual({
      senderFingerprint: undefined,
      embeddedIdentity: undefined,
    });
    const embedded = {fingerprint: 'fp'};
    expect(
      senderFieldsFromPayload({
        senderFingerprint: 'sender',
        senderIdentity: embedded,
      }),
    ).toEqual({
      senderFingerprint: 'sender',
      embeddedIdentity: embedded,
    });
  });

  test('payload type predicates', () => {
    expect(isEncryptedMessageType('ebp-encrypted-message')).toBe(true);
    expect(isEncryptedSignedMessageType('ebp-encrypted-signed-message')).toBe(
      true,
    );
    expect(
      isEncryptedSignedMessageMultiType('ebp-encrypted-signed-message-multi'),
    ).toBe(true);
    expect(isEncryptedFileType('ebp-encrypted-file')).toBe(true);
    expect(isEncryptedSignedFileType('ebp-encrypted-signed-file')).toBe(true);
    expect(isEncryptedMessageType('other')).toBe(false);
  });
});
