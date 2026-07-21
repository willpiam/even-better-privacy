import {
  deriveBadgeKind,
  extractEmailAddress,
  matchFromToIdentity,
} from '../src/services/mail/mailAuthenticity';
import type {ExternalIdentity} from '../src/ebpCore';

function baseContact(
  overrides: Partial<ExternalIdentity> = {},
): ExternalIdentity {
  return {
    fingerprint: 'ebpdk1test',
    signingKeyType: 'dilithium',
    encryptionKeyType: 'kyber',
    signingKey: 'sig',
    encryptionKey: 'enc',
    signingKeyDetails: {variant: 'ml_dsa87'},
    encryptionKeyDetails: {variant: 'ml_kem1024'},
    details: {},
    ...overrides,
  };
}

describe('mailAuthenticity', () => {
  test('extractEmailAddress parses angle brackets', () => {
    expect(extractEmailAddress('Alice <alice@Example.com>')).toBe(
      'alice@Example.com',
    );
  });

  test('matchFromToIdentity matches cleartext email', () => {
    const contact = baseContact({
      details: {email: ['alice@example.com', 'proof']},
    });
    const match = matchFromToIdentity(contact, 'Alice <alice@example.com>');
    expect(match.matches).toBe(true);
    expect(match.matchedPath).toBe('email');
  });

  test('deriveBadgeKind is bad for invalid, caution for From mismatch', () => {
    expect(
      deriveBadgeKind({
        verifyStatus: 'invalid',
        verified: false,
        signerMatchesSenderEmail: true,
        signerEmailVerified: true,
      }),
    ).toBe('bad');
    expect(
      deriveBadgeKind({
        verifyStatus: 'valid',
        verified: true,
        signerMatchesSenderEmail: false,
        signerEmailVerified: true,
      }),
    ).toBe('caution');
    expect(
      deriveBadgeKind({
        verifyStatus: 'valid',
        verified: true,
        signerMatchesSenderEmail: true,
        signerEmailVerified: true,
      }),
    ).toBe('good');
  });
});
