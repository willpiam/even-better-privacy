import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';
import {
  DEFAULT_MAIL_STORE,
  deleteAccountFromStore,
  filterPersistableSecrets,
  isEncryptedSecretsEnvelope,
  mailSecretsStoreKey,
  mergeMailAccountRecord,
  parseMailAccountStore,
  resolveSelectedAccountId,
  upsertAccountInStore,
} from '../src/services/mail/accountStoreLogic';

describe('accountStoreLogic', () => {
  test('mailSecretsStoreKey', () => {
    expect(mailSecretsStoreKey('id', 'acct')).toBe('id:acct');
  });

  test('isEncryptedSecretsEnvelope', () => {
    expect(isEncryptedSecretsEnvelope(null)).toBe(false);
    expect(
      isEncryptedSecretsEnvelope({
        version: 1,
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: 100000,
        salt: 's',
        iv: 'i',
        ciphertext: 'c',
      }),
    ).toBe(true);
    expect(
      isEncryptedSecretsEnvelope({
        version: 1,
        algorithm: 'AES-GCM',
        kdf: 'wrong',
        iterations: 1,
        salt: 's',
        iv: 'i',
        ciphertext: 'c',
      }),
    ).toBe(false);
  });

  test('parseMailAccountStore recovers from invalid json', () => {
    expect(parseMailAccountStore('not-json')).toEqual({
      ...DEFAULT_MAIL_STORE,
      accounts: [],
    });
    expect(
      parseMailAccountStore(
        JSON.stringify({selectedAccountId: 'a1', accounts: [{id: 'a1'}]}),
      ),
    ).toEqual({
      selectedAccountId: 'a1',
      accounts: [{id: 'a1'}],
    });
  });

  test('resolveSelectedAccountId falls back to first account', () => {
    expect(resolveSelectedAccountId({selectedAccountId: null, accounts: []})).toBe(
      null,
    );
    expect(
      resolveSelectedAccountId({
        selectedAccountId: null,
        accounts: [
          {
            id: 'first',
            name: 'A',
            config: DEFAULT_MAIL_ACCOUNT,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ).toBe('first');
  });

  test('upsert and delete account store mutations', () => {
    const record = mergeMailAccountRecord(
      undefined,
      {
        id: 'a1',
        name: 'Work',
        config: {...DEFAULT_MAIL_ACCOUNT, imapHost: 'imap.test'},
      },
      1000,
    );
    expect(record.createdAt).toBe(1000);
    expect(record.config.imapPort).toBe(993);

    let store = upsertAccountInStore(
      {selectedAccountId: null, accounts: []},
      record,
    );
    expect(store.selectedAccountId).toBe('a1');
    expect(store.accounts).toHaveLength(1);

    store = deleteAccountFromStore(store, 'a1');
    expect(store.accounts).toHaveLength(0);
    expect(store.selectedAccountId).toBeNull();
  });

  test('filterPersistableSecrets', () => {
    const secrets = filterPersistableSecrets(
      [
        {
          id: 'persist',
          name: 'P',
          config: {...DEFAULT_MAIL_ACCOUNT, persistSecrets: true},
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'ephemeral',
          name: 'E',
          config: {...DEFAULT_MAIL_ACCOUNT, persistSecrets: false},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      {
        persist: {imapPassword: 'i', smtpPassword: 's'},
        ephemeral: {imapPassword: 'i2', smtpPassword: 's2'},
      },
    );
    expect(secrets).toEqual({
      persist: {imapPassword: 'i', smtpPassword: 's'},
    });
  });
});
