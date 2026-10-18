import {sha256Hex} from '../../core/MessageHash.ts';
import {
  apiUrl,
  contactMatchesEmail,
  emailsEqualIgnoreCase,
  getDetailValue,
  normalizeContactName,
  normalizeExternalIdentity,
  normalizeServerIdentity,
  stripRevokedDetails,
} from '../src/services/contactsLogic';

describe('contactsLogic', () => {
  test('getDetailValue reads tuple or string', () => {
    expect(getDetailValue(undefined, 'email')).toBeNull();
    expect(getDetailValue({email: ['a@b.c', 'proof']}, 'email')).toBe('a@b.c');
    expect(getDetailValue({email: ['', 'proof']}, 'email')).toBeNull();
  });

  test('normalizeContactName validates', () => {
    expect(normalizeContactName('  Alice_1  ')).toBe('Alice_1');
    expect(() => normalizeContactName('')).toThrow(/required/);
    expect(() => normalizeContactName('bad name')).toThrow(/letters/);
  });

  test('stripRevokedDetails removes paths from both maps', () => {
    const {details, detailsMeta} = stripRevokedDetails(
      {email: ['a@b.c', 'p'], name: ['N', 'p']},
      {
        email: {verified: true, verifiedAt: 1},
        name: {verified: false, verifiedAt: null},
      },
      ['email'],
    );
    expect(details.email).toBeUndefined();
    expect(details.name).toEqual(['N', 'p']);
    expect(detailsMeta.email).toBeUndefined();
    expect(detailsMeta.name).toEqual({verified: false, verifiedAt: null});
  });

  test('normalizeExternalIdentity strips revoked details', () => {
    const identity = normalizeExternalIdentity({
      fingerprint: 'fp1',
      signingKey: 'sk',
      encryptionKey: 'ek',
      signingKeyType: 'sphincs',
      details: {email: ['a@b.c', 'p'], phone: ['1', 'p']},
      detailsMeta: {
        email: {verified: true, verifiedAt: 1},
        phone: {verified: false, verifiedAt: null},
      },
      revokedDetails: ['email'],
      revoked: true,
    });
    expect(identity.signingKeyType).toBe('sphincs');
    expect(identity.details.email).toBeUndefined();
    expect(identity.details.phone).toEqual(['1', 'p']);
    expect(identity.detailsMeta?.email).toBeUndefined();
    expect(identity.revoked).toBe(true);
  });

  test('normalizeExternalIdentity rejects incomplete payloads', () => {
    expect(() =>
      normalizeExternalIdentity({fingerprint: 'fp', signingKey: 'sk'}),
    ).toThrow(/Invalid public identity/);
  });

  test('normalizeServerIdentity keeps empty keys and strips revoked', () => {
    const identity = normalizeServerIdentity(
      {
        details: {email: ['a@b.c', 'p']},
        revokedDetails: ['email'],
      },
      'fallback-fp',
    );
    expect(identity.fingerprint).toBe('fallback-fp');
    expect(identity.signingKey).toBe('');
    expect(identity.details.email).toBeUndefined();
  });

  test('emailsEqualIgnoreCase and contactMatchesEmail', () => {
    expect(emailsEqualIgnoreCase(' A@B.C ', 'a@b.c')).toBe(true);
    const contact = {
      fingerprint: 'fp',
      signingKeyType: 'dilithium' as const,
      encryptionKeyType: 'kyber' as const,
      signingKey: 'sk',
      encryptionKey: 'ek',
      signingKeyDetails: {variant: 'ml_dsa87' as const},
      encryptionKeyDetails: {variant: 'ml_kem1024' as const},
      details: {
        email: ['known@example.com', 'p'],
        'opaque::email': [sha256Hex('opaque@example.com'), 'p'],
      },
    };
    expect(
      contactMatchesEmail(contact, 'known@example.com', 'known@example.com'),
    ).toBe(true);
    expect(
      contactMatchesEmail(contact, 'opaque@example.com', 'opaque@example.com'),
    ).toBe(true);
    expect(
      contactMatchesEmail(contact, 'other@example.com', 'other@example.com'),
    ).toBe(false);
  });

  test('apiUrl joins without double slashes', () => {
    expect(apiUrl('https://ex.com/', '/api/v1/x')).toBe('https://ex.com/api/v1/x');
    expect(apiUrl('https://ex.com', 'api/v1/x')).toBe('https://ex.com/api/v1/x');
  });
});
