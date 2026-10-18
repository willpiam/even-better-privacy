import {
  ebpMailPlainIntro,
  elevateUnknownSignerVerifyStatus,
  formatFromHeader,
  resolveEbpMailRecipients,
  resolvePlainMailRecipients,
  sourceLooksLikeEbpArmor,
} from '../src/services/mail/ebpMailLogic';

describe('ebpMailLogic', () => {
  test('sourceLooksLikeEbpArmor', () => {
    expect(sourceLooksLikeEbpArmor('plain text')).toBe(false);
    expect(
      sourceLooksLikeEbpArmor(
        '-----BEGIN EBP MESSAGE-----\nabc\n-----END EBP MESSAGE-----',
      ),
    ).toBe(true);
  });

  test('resolveEbpMailRecipients prefers multi list', () => {
    expect(resolveEbpMailRecipients({})).toEqual([]);
    expect(
      resolveEbpMailRecipients({to: 'a@b.c', recipientContact: 'alice'}),
    ).toEqual([{email: 'a@b.c', contact: 'alice'}]);
    expect(
      resolveEbpMailRecipients({
        to: 'ignored',
        recipientContact: 'ignored',
        recipients: [{email: 'x@y.z', contact: 'bob'}],
      }),
    ).toEqual([{email: 'x@y.z', contact: 'bob'}]);
  });

  test('resolvePlainMailRecipients splits To header', () => {
    expect(resolvePlainMailRecipients({to: 'a@b.c,  c@d.e '})).toEqual([
      'a@b.c',
      'c@d.e',
    ]);
    expect(
      resolvePlainMailRecipients({to: 'a@b.c', recipients: ['x@y.z']}),
    ).toEqual(['x@y.z']);
  });

  test('intro and from header helpers', () => {
    expect(ebpMailPlainIntro(true)).toContain('Open the EBP block');
    expect(ebpMailPlainIntro(false)).toBe('Encrypted with Even Better Privacy.');
    expect(formatFromHeader('Alice', 'a@b.c')).toBe('Alice <a@b.c>');
  });

  test('elevateUnknownSignerVerifyStatus', () => {
    expect(elevateUnknownSignerVerifyStatus(true, false, 'valid')).toBe(
      'valid_unknown_signer',
    );
    expect(elevateUnknownSignerVerifyStatus(true, true, 'valid')).toBe('valid');
    expect(elevateUnknownSignerVerifyStatus(false, false, 'invalid')).toBe(
      'invalid',
    );
  });
});
