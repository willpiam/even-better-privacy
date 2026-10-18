/**
 * Pure mail account store helpers (Deno/Jest-testable; no RNFS / PBKDF2).
 */
import {
  DEFAULT_MAIL_ACCOUNT,
  type MailAccountRecord,
  type MailAccountStore,
  type MailAuthSecrets,
} from './types';

export const DEFAULT_MAIL_STORE: MailAccountStore = {
  selectedAccountId: null,
  accounts: [],
};

export type EncryptedMailSecretsEnvelope = {
  version: number;
  algorithm: string;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export function mailSecretsStoreKey(
  identityName: string,
  accountId: string,
): string {
  return `${identityName}:${accountId}`;
}

export function isEncryptedSecretsEnvelope(
  value: unknown,
): value is EncryptedMailSecretsEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    v.algorithm === 'AES-GCM' &&
    v.kdf === 'PBKDF2-SHA-256' &&
    typeof v.iterations === 'number' &&
    typeof v.salt === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.ciphertext === 'string'
  );
}

export function parseMailAccountStore(raw: string): MailAccountStore {
  try {
    const parsed = JSON.parse(raw) as MailAccountStore;
    return {
      selectedAccountId: parsed.selectedAccountId ?? null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return {...DEFAULT_MAIL_STORE, accounts: []};
  }
}

export function resolveSelectedAccountId(
  store: MailAccountStore,
): string | null {
  return store.selectedAccountId ?? store.accounts[0]?.id ?? null;
}

export function mergeMailAccountRecord(
  existing: MailAccountRecord | undefined,
  record: Omit<MailAccountRecord, 'createdAt' | 'updatedAt'> & {
    createdAt?: number;
    updatedAt?: number;
  },
  now: number,
): MailAccountRecord {
  return {
    ...record,
    config: {...DEFAULT_MAIL_ACCOUNT, ...record.config},
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    updatedAt: now,
  };
}

export function upsertAccountInStore(
  store: MailAccountStore,
  next: MailAccountRecord,
): MailAccountStore {
  const accounts = store.accounts.filter(a => a.id !== next.id);
  accounts.push(next);
  return {
    accounts,
    selectedAccountId: store.selectedAccountId ?? next.id,
  };
}

export function deleteAccountFromStore(
  store: MailAccountStore,
  accountId: string,
): MailAccountStore {
  const accounts = store.accounts.filter(a => a.id !== accountId);
  return {
    accounts,
    selectedAccountId:
      store.selectedAccountId === accountId
        ? accounts[0]?.id ?? null
        : store.selectedAccountId,
  };
}

export function filterPersistableSecrets(
  accounts: MailAccountRecord[],
  inMemory: Record<string, MailAuthSecrets>,
): Record<string, MailAuthSecrets> {
  const secretStore: Record<string, MailAuthSecrets> = {};
  for (const account of accounts) {
    if (!account.config.persistSecrets) {
      continue;
    }
    const secrets = inMemory[account.id];
    if (secrets) {
      secretStore[account.id] = secrets;
    }
  }
  return secretStore;
}
