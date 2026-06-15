import RNFS from 'react-native-fs';
import {gcm} from '@noble/ciphers/aes';
import {pbkdf2} from '@noble/hashes/pbkdf2';
import {sha256} from '@noble/hashes/sha2';
import {randomBytes} from '../../ebpCore';
import {bytesToBase64, base64ToBytes} from '../../ebpCore';
import {
  DEFAULT_MAIL_ACCOUNT,
  type MailAccountConfig,
  type MailAccountRecord,
  type MailAccountStore,
  type MailAuthSecrets,
} from './types';
import {ensureIdentityMailDir, mailAccountPath, mailSecretsPath} from './paths';

const DEFAULT_STORE: MailAccountStore = {selectedAccountId: null, accounts: []};
const MAIL_SECRETS_KDF_ITERATIONS = 210_000;

const secretsMemory = new Map<string, MailAuthSecrets>();
const pinMemory = new Map<string, string>();

function storeKey(identityName: string, accountId: string): string {
  return `${identityName}:${accountId}`;
}

export async function readMailStore(
  identityName: string,
): Promise<MailAccountStore> {
  await ensureIdentityMailDir(identityName);
  const path = mailAccountPath(identityName);
  if (!(await RNFS.exists(path))) {
    return {...DEFAULT_STORE, accounts: []};
  }
  const raw = await RNFS.readFile(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as MailAccountStore;
    return {
      selectedAccountId: parsed.selectedAccountId ?? null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return {...DEFAULT_STORE, accounts: []};
  }
}

export async function writeMailStore(
  identityName: string,
  store: MailAccountStore,
): Promise<void> {
  await ensureIdentityMailDir(identityName);
  await RNFS.writeFile(
    mailAccountPath(identityName),
    JSON.stringify(store, null, 2),
    'utf8',
  );
}

export async function upsertMailAccount(
  identityName: string,
  record: Omit<MailAccountRecord, 'createdAt' | 'updatedAt'> & {
    createdAt?: number;
    updatedAt?: number;
  },
): Promise<MailAccountRecord> {
  const store = await readMailStore(identityName);
  const now = Date.now();
  const existing = store.accounts.find(a => a.id === record.id);
  const next: MailAccountRecord = {
    ...record,
    config: {...DEFAULT_MAIL_ACCOUNT, ...record.config},
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    updatedAt: now,
  };
  store.accounts = store.accounts.filter(a => a.id !== record.id);
  store.accounts.push(next);
  if (!store.selectedAccountId) {
    store.selectedAccountId = next.id;
  }
  await writeMailStore(identityName, store);
  return next;
}

export async function deleteMailAccount(
  identityName: string,
  accountId: string,
): Promise<void> {
  const store = await readMailStore(identityName);
  store.accounts = store.accounts.filter(a => a.id !== accountId);
  if (store.selectedAccountId === accountId) {
    store.selectedAccountId = store.accounts[0]?.id ?? null;
  }
  await writeMailStore(identityName, store);
  secretsMemory.delete(storeKey(identityName, accountId));
}

export async function selectMailAccount(
  identityName: string,
  accountId: string,
): Promise<void> {
  const store = await readMailStore(identityName);
  if (!store.accounts.some(a => a.id === accountId)) {
    throw new Error('Mail account not found');
  }
  store.selectedAccountId = accountId;
  await writeMailStore(identityName, store);
}

export function setMailSecretsInMemory(
  identityName: string,
  accountId: string,
  secrets: MailAuthSecrets,
  pin?: string,
): void {
  secretsMemory.set(storeKey(identityName, accountId), secrets);
  if (pin) {
    pinMemory.set(identityName, pin);
  }
}

export function getMailSecretsInMemory(
  identityName: string,
  accountId: string,
): MailAuthSecrets | null {
  return secretsMemory.get(storeKey(identityName, accountId)) ?? null;
}

function deriveMailSecretsKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(pin), salt, {
    c: iterations,
    dkLen: 32,
  });
}

export async function encryptSecretsStore(
  pin: string,
  secrets: Record<string, MailAuthSecrets>,
): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveMailSecretsKey(pin, salt, MAIL_SECRETS_KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  return JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: MAIL_SECRETS_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
}

export async function decryptSecretsStore(
  pin: string,
  envelopeJson: string,
): Promise<Record<string, MailAuthSecrets>> {
  const envelope = JSON.parse(envelopeJson) as {
    salt: string;
    ciphertext: string;
    iv: string;
    iterations?: number;
  };
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = deriveMailSecretsKey(
    pin,
    salt,
    envelope.iterations ?? MAIL_SECRETS_KDF_ITERATIONS,
  );
  const cipher = gcm(key, iv);
  const decrypted = cipher.decrypt(base64ToBytes(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<
    string,
    MailAuthSecrets
  >;
}

export async function saveEncryptedSecrets(
  identityName: string,
  pin: string,
  secrets: Record<string, MailAuthSecrets>,
): Promise<void> {
  await ensureIdentityMailDir(identityName);
  const blob = await encryptSecretsStore(pin, secrets);
  await RNFS.writeFile(mailSecretsPath(identityName), blob, 'utf8');
}

export async function loadEncryptedSecrets(
  identityName: string,
  pin: string,
): Promise<Record<string, MailAuthSecrets>> {
  const path = mailSecretsPath(identityName);
  if (!(await RNFS.exists(path))) {
    return {};
  }
  const raw = await RNFS.readFile(path, 'utf8');
  return decryptSecretsStore(pin, raw);
}

export async function resolveSelectedAccount(
  identityName: string,
): Promise<{account: MailAccountRecord; secrets: MailAuthSecrets} | null> {
  const store = await readMailStore(identityName);
  const id = store.selectedAccountId ?? store.accounts[0]?.id;
  if (!id) {
    return null;
  }
  const account = store.accounts.find(a => a.id === id);
  if (!account) {
    return null;
  }
  const secrets = getMailSecretsInMemory(identityName, id);
  if (!secrets) {
    throw new Error('Mail secrets locked; unlock with PIN first');
  }
  return {account, secrets};
}
