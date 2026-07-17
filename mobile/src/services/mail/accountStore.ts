import RNFS from 'react-native-fs';
import {gcm} from '@noble/ciphers/aes';
import {randomBytes} from '../../ebpCore';
import {bytesToBase64, base64ToBytes} from '../../ebpCore';
import {
  deriveMailSecretsKey,
  MAIL_SECRETS_KDF_ITERATIONS,
} from './pbkdf2Native';
import {
  DEFAULT_MAIL_ACCOUNT,
  type MailAccountConfig,
  type MailAccountRecord,
  type MailAccountStore,
  type MailAuthSecrets,
} from './types';
import {ensureIdentityMailDir, mailAccountPath, mailSecretsPath} from './paths';

const DEFAULT_STORE: MailAccountStore = {selectedAccountId: null, accounts: []};

const secretsMemory = new Map<string, MailAuthSecrets>();
const pinMemory = new Map<string, string>();

function storeKey(identityName: string, accountId: string): string {
  return `${identityName}:${accountId}`;
}

type EncryptedMailSecretsEnvelope = {
  version: number;
  algorithm: string;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

function isEncryptedSecretsEnvelope(value: unknown): value is EncryptedMailSecretsEnvelope {
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

function getSecretsStoreInMemory(
  identityName: string,
): Record<string, MailAuthSecrets> {
  const out: Record<string, MailAuthSecrets> = {};
  const prefix = `${identityName}:`;
  for (const [key, secrets] of secretsMemory.entries()) {
    if (key.startsWith(prefix)) {
      out[key.slice(prefix.length)] = secrets;
    }
  }
  return out;
}

function setSecretsStoreInMemory(
  identityName: string,
  store: Record<string, MailAuthSecrets>,
  pin?: string,
): void {
  const prefix = `${identityName}:`;
  for (const key of [...secretsMemory.keys()]) {
    if (key.startsWith(prefix)) {
      secretsMemory.delete(key);
    }
  }
  for (const [accountId, secrets] of Object.entries(store)) {
    secretsMemory.set(storeKey(identityName, accountId), secrets);
  }
  if (pin) {
    pinMemory.set(identityName, pin);
  }
}

export function getMailPinInMemory(identityName: string): string | null {
  return pinMemory.get(identityName) ?? null;
}

export function hasMailSecretsInMemory(identityName: string): boolean {
  const prefix = `${identityName}:`;
  for (const key of secretsMemory.keys()) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export async function getMailSecretsStatus(
  identityName: string,
): Promise<{inMemory: boolean; locked: boolean}> {
  if (hasMailSecretsInMemory(identityName)) {
    return {inMemory: true, locked: false};
  }
  const path = mailSecretsPath(identityName);
  if (!(await RNFS.exists(path))) {
    return {inMemory: false, locked: false};
  }
  const raw = await RNFS.readFile(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    return {inMemory: false, locked: isEncryptedSecretsEnvelope(parsed)};
  } catch {
    return {inMemory: false, locked: false};
  }
}

export async function unlockMailSecretsWithPin(
  identityName: string,
  pin: string,
): Promise<Record<string, MailAuthSecrets>> {
  const path = mailSecretsPath(identityName);
  if (!(await RNFS.exists(path))) {
    setSecretsStoreInMemory(identityName, {}, pin);
    return {};
  }
  const raw = await RNFS.readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid email secrets file');
  }
  if (isEncryptedSecretsEnvelope(parsed)) {
    try {
      const decrypted = await decryptSecretsStore(pin, raw);
      setSecretsStoreInMemory(identityName, decrypted, pin);
      return decrypted;
    } catch {
      throw new Error('Invalid email PIN');
    }
  }
  const legacy = parsed as Record<string, MailAuthSecrets>;
  setSecretsStoreInMemory(identityName, legacy, pin);
  return legacy;
}

export async function persistMailSecretsStore(
  identityName: string,
): Promise<void> {
  const pin = pinMemory.get(identityName);
  const store = await readMailStore(identityName);
  const secretStore: Record<string, MailAuthSecrets> = {};
  const inMemory = getSecretsStoreInMemory(identityName);
  for (const account of store.accounts) {
    if (!account.config.persistSecrets) {
      continue;
    }
    const secrets = inMemory[account.id];
    if (secrets) {
      secretStore[account.id] = secrets;
    }
  }
  const secretsPath = mailSecretsPath(identityName);
  if (Object.keys(secretStore).length === 0) {
    if (await RNFS.exists(secretsPath)) {
      if (!pin) {
        return;
      }
      await RNFS.unlink(secretsPath);
    }
    return;
  }
  if (!pin) {
    throw new Error('Email PIN is required to persist encrypted mail passwords');
  }
  await saveEncryptedSecrets(identityName, pin, secretStore);
}

export async function saveMailAccountWithSecrets(
  identityName: string,
  params: {
    record: Omit<MailAccountRecord, 'createdAt' | 'updatedAt'>;
    imapPassword?: string;
    smtpPassword?: string;
    pin?: string;
  },
): Promise<MailAccountRecord> {
  const {record, imapPassword, smtpPassword, pin} = params;
  const accountId = record.id;
  const existingSecrets = getMailSecretsInMemory(identityName, accountId);
  const nextSecrets: MailAuthSecrets = {
    imapPassword:
      imapPassword && imapPassword.length > 0
        ? imapPassword
        : existingSecrets?.imapPassword ?? '',
    smtpPassword:
      smtpPassword && smtpPassword.length > 0
        ? smtpPassword
        : existingSecrets?.smtpPassword ?? '',
    accessToken: existingSecrets?.accessToken,
    refreshToken: existingSecrets?.refreshToken,
    tokenExpiry: existingSecrets?.tokenExpiry,
  };
  if (record.config.authType === 'password') {
    if (!nextSecrets.imapPassword || !nextSecrets.smtpPassword) {
      throw new Error('IMAP and SMTP passwords are required');
    }
  }
  const effectivePin = pin || pinMemory.get(identityName);
  const saved = await upsertMailAccount(identityName, record);
  setMailSecretsInMemory(identityName, accountId, nextSecrets, effectivePin);
  if (record.config.persistSecrets) {
    if (!effectivePin) {
      throw new Error('Email PIN is required to persist encrypted mail passwords');
    }
    pinMemory.set(identityName, effectivePin);
    await persistMailSecretsStore(identityName);
  } else if (pinMemory.has(identityName)) {
    await persistMailSecretsStore(identityName);
  }
  return saved;
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
  if (pinMemory.has(identityName)) {
    await persistMailSecretsStore(identityName);
  }
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

export async function encryptSecretsStore(
  pin: string,
  secrets: Record<string, MailAuthSecrets>,
): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveMailSecretsKey(pin, salt, MAIL_SECRETS_KDF_ITERATIONS);
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
  const key = await deriveMailSecretsKey(
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
