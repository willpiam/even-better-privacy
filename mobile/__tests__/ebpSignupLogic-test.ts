import {
  buildEbpMailAccountRecord,
  buildMailAddress,
  buildMailDeleteRequest,
  buildMailPasswordResetRequest,
  buildSignupRequest,
  chooseIdentityName,
  isAddressTakenError,
  isAlreadyHasMailboxError,
  isManagedMailAddress,
  mailboxDeleteConfirmed,
  managedMailboxRestoreHint,
  parseSignupConfig,
  parseSignupResponse,
  parseVerifiedManagedEmail,
  pickQuizIndexes,
  quizMatches,
  validateMailUsername,
  wizardSteps,
} from '../src/services/mail/ebpSignupLogic';

const IMAP = {host: 'mail.pqpost.test', port: 993, secure: true};
const SMTP = {host: 'mail.pqpost.test', port: 465, secure: true};
const ENABLED = {enabled: true as const, domain: 'pqpost.test', imap: IMAP, smtp: SMTP};

describe('ebpSignupLogic', () => {
  test('validateMailUsername normalizes and enforces rules', () => {
    expect(validateMailUsername('  Alice ')).toEqual({ok: true, username: 'alice'});
    expect(validateMailUsername('ab').ok).toBe(false);
    expect(validateMailUsername('a'.repeat(31)).ok).toBe(false);
    expect(validateMailUsername('al_ice').ok).toBe(false);
    expect(validateMailUsername('.alice').ok).toBe(false);
    expect(validateMailUsername('al--ice').ok).toBe(false);
    expect(validateMailUsername('postmaster').ok).toBe(false);
  });

  test('parseSignupConfig requires domain and both endpoints', () => {
    expect(parseSignupConfig({enabled: true, domain: 'pqpost.test', imap: IMAP, smtp: SMTP})).toEqual(ENABLED);
    expect(parseSignupConfig({enabled: false})).toEqual({enabled: false});
    expect(parseSignupConfig({enabled: true, domain: 'pqpost.test', imap: IMAP})).toEqual({enabled: false});
    expect(parseSignupConfig(null)).toEqual({enabled: false});
    expect(parseSignupConfig('nope')).toEqual({enabled: false});
  });

  test('buildMailAddress lowercases', () => {
    expect(buildMailAddress(' Alice ', 'PQPost.test')).toBe('alice@pqpost.test');
  });

  test('buildSignupRequest normalizes the username', () => {
    const body = JSON.parse(
      buildSignupRequest({
        fingerprint: 'ebpdk1abc',
        username: 'Alice',
        mailPassword: 'p'.repeat(32),
        detailProof: 'deadbeef',
      }),
    );
    expect(body).toEqual({
      fingerprint: 'ebpdk1abc',
      username: 'alice',
      mailPassword: 'p'.repeat(32),
      detailProof: 'deadbeef',
    });
  });

  test('parseSignupResponse prefers server values and falls back to config', () => {
    const fallback = {email: 'alice@pqpost.test', fingerprint: 'fp', config: ENABLED};
    expect(parseSignupResponse({email: 'alice@pqpost.test', login: 'alice@pqpost.test', imap: IMAP, smtp: SMTP}, fallback))
      .toEqual({email: 'alice@pqpost.test', login: 'alice@pqpost.test', fingerprint: 'fp', imap: IMAP, smtp: SMTP});
    expect(parseSignupResponse({}, fallback).imap).toEqual(IMAP);
    expect(() =>
      parseSignupResponse({}, {email: 'a@b', fingerprint: 'fp', config: {enabled: false}}),
    ).toThrow('connection settings');
  });

  test('buildEbpMailAccountRecord produces a persisted password account', () => {
    const record = buildEbpMailAccountRecord({
      id: 'ebp-1',
      result: {email: 'alice@pqpost.test', login: 'alice@pqpost.test', fingerprint: 'fp', imap: IMAP, smtp: SMTP},
    });
    expect(record.id).toBe('ebp-1');
    expect(record.name).toBe('EBP Mail');
    expect(record.config).toMatchObject({
      authType: 'password',
      imapHost: 'mail.pqpost.test',
      imapPort: 993,
      smtpPort: 465,
      username: 'alice@pqpost.test',
      fromEmail: 'alice@pqpost.test',
      persistSecrets: true,
    });
  });

  test('pickQuizIndexes returns distinct sorted positions', () => {
    const seq = [5, 5, 1, 20, 1];
    let i = 0;
    const picks = pickQuizIndexes(3, 24, () => seq[i++ % seq.length]);
    expect(picks).toEqual([1, 5, 20]);
    expect(pickQuizIndexes(5, 2, max => Math.floor(Math.random() * max))).toHaveLength(2);
  });

  test('quizMatches checks only requested words, case-insensitively', () => {
    const mnemonic = 'one two three four five six';
    expect(quizMatches(mnemonic, {0: 'One', 3: ' four '}, [0, 3])).toBe(true);
    expect(quizMatches(mnemonic, {0: 'one', 3: 'five'}, [0, 3])).toBe(false);
    expect(quizMatches(mnemonic, {0: 'one'}, [0, 3])).toBe(false);
  });

  test('chooseIdentityName avoids collisions', () => {
    expect(chooseIdentityName('alice', [], () => 'x')).toBe('alice');
    expect(chooseIdentityName('alice', ['alice'], () => 'x')).toBe('alice-ebp');
    let n = 0;
    expect(
      chooseIdentityName('alice', ['alice', 'alice-ebp', 'alice-1'], () => String(++n)),
    ).toBe('alice-2');
  });

  test('isAddressTakenError', () => {
    expect(isAddressTakenError('That address is taken.')).toBe(true);
    expect(isAddressTakenError('mailbox already exists')).toBe(true);
    expect(isAddressTakenError('mail server unreachable')).toBe(false);
  });

  test('wizardSteps skips password, phrase, and confirm for an existing identity', () => {
    expect(wizardSteps(false)).toEqual([
      'welcome',
      'address',
      'password',
      'phrase',
      'confirm',
      'create',
      'done',
    ]);
    expect(wizardSteps(true)).toEqual([
      'welcome',
      'address',
      'unlock',
      'create',
      'done',
    ]);
    expect(wizardSteps(true)).not.toEqual(expect.arrayContaining(['password', 'phrase', 'confirm']));
  });

  test('isManagedMailAddress matches the signup domain exactly', () => {
    expect(isManagedMailAddress(' Alice@PQPost.test ', 'pqpost.test')).toBe(true);
    expect(isManagedMailAddress('alice@mail.pqpost.test', 'pqpost.test')).toBe(false);
    expect(isManagedMailAddress('alice@pqpost.test.evil', 'pqpost.test')).toBe(false);
    expect(isManagedMailAddress('not-an-email', 'pqpost.test')).toBe(false);
    expect(isManagedMailAddress('alice@pqpost.test', '')).toBe(false);
  });

  test('parseVerifiedManagedEmail requires a verified, unrevoked managed address', () => {
    const body = {
      details: {email: ['Alice@pqpost.test', 'proof']},
      detailsMeta: {email: {verified: true}},
      revokedDetails: [],
    };
    expect(parseVerifiedManagedEmail(body, 'pqpost.test')).toBe('alice@pqpost.test');
    expect(parseVerifiedManagedEmail({...body, detailsMeta: {email: {verified: false}}}, 'pqpost.test')).toBeNull();
    expect(parseVerifiedManagedEmail({...body, revokedDetails: ['email']}, 'pqpost.test')).toBeNull();
    expect(parseVerifiedManagedEmail(body, 'other.test')).toBeNull();
    expect(parseVerifiedManagedEmail(null, 'pqpost.test')).toBeNull();
  });

  test('isAlreadyHasMailboxError is the signup 409 mailbox conflict', () => {
    expect(isAlreadyHasMailboxError('this identity already has a mailbox', 409)).toBe(true);
    expect(isAlreadyHasMailboxError('this identity already has a mailbox')).toBe(true);
    expect(isAlreadyHasMailboxError('this identity already has a mailbox', 500)).toBe(false);
    expect(isAlreadyHasMailboxError('That address is taken.', 409)).toBe(false);
  });

  test('reset and delete request bodies', () => {
    expect(JSON.parse(buildMailPasswordResetRequest({
      fingerprint: 'ebpdk1abc',
      mailPassword: 'ab'.repeat(16),
      proof: 'deadbeef',
    }))).toEqual({
      fingerprint: 'ebpdk1abc',
      mailPassword: 'ab'.repeat(16),
      proof: 'deadbeef',
    });
    expect(JSON.parse(buildMailDeleteRequest({
      fingerprint: 'ebpdk1abc',
      proof: 'cafebabe',
    }))).toEqual({
      fingerprint: 'ebpdk1abc',
      proof: 'cafebabe',
    });
  });

  test('mailboxDeleteConfirmed ignores case and surrounding space', () => {
    expect(mailboxDeleteConfirmed('Alice@pqpost.test', '  alice@pqpost.test ')).toBe(true);
    expect(mailboxDeleteConfirmed('alice@pqpost.test', 'bob@pqpost.test')).toBe(false);
    expect(mailboxDeleteConfirmed('', 'alice@pqpost.test')).toBe(false);
  });

  test('managedMailboxRestoreHint points at Mail accounts', () => {
    expect(managedMailboxRestoreHint('alice@pqpost.test')).toContain('alice@pqpost.test');
    expect(managedMailboxRestoreHint('alice@pqpost.test')).toContain('Mail accounts');
  });
});
