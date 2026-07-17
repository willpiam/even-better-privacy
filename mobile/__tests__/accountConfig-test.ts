import {
  clampPort,
  normalizeManualMailConfig,
  validateManualSecrets,
} from '../src/services/mail/accountConfig';
import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';

describe('accountConfig', () => {
  it('clampPort rejects invalid values', () => {
    expect(clampPort(993, 143)).toBe(993);
    expect(clampPort(0, 993)).toBe(993);
    expect(clampPort(99999, 993)).toBe(993);
    expect(clampPort('587', 993)).toBe(587);
  });

  it('normalizeManualMailConfig requires core fields', () => {
    expect(() =>
      normalizeManualMailConfig(DEFAULT_MAIL_ACCOUNT, {imapHost: 'imap.test'}),
    ).toThrow(/required/);
    const config = normalizeManualMailConfig(DEFAULT_MAIL_ACCOUNT, {
      imapHost: 'imap.test',
      smtpHost: 'smtp.test',
      username: 'a@test',
      fromEmail: 'a@test',
    });
    expect(config.authType).toBe('password');
    expect(config.imapPort).toBe(993);
  });

  it('validateManualSecrets requires passwords on create', () => {
    expect(() => validateManualSecrets('', '', true, false)).toThrow();
    expect(() => validateManualSecrets('a', 'b', true, false)).not.toThrow();
    expect(() => validateManualSecrets('', '', false, true)).not.toThrow();
  });
});
