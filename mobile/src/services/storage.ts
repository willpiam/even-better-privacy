import RNFS from 'react-native-fs';
import {
  AES,
  Identity,
  randomBytes,
  validatePassword,
} from '../ebpCore';
import {deriveIdentityKey} from './argon2';
import {getEnforcePasswordPolicy} from './settings';
import type {IdentityPublicData} from '../../../core/Identity';
import type {AppState, SigningType, StoredIdentityMeta} from '../types';

export const BASE_DIR = `${RNFS.DocumentDirectoryPath}/ebp`;
const STATE_FILE = `${BASE_DIR}/state.json`;
const CONTACTS_DIR = `${BASE_DIR}/contacts`;
const CERTIFICATES_DIR = `${BASE_DIR}/certificates`;
const PENDING_CERTIFICATES_FILE = `${BASE_DIR}/pending-certificates.json`;

/** Ciphertext versions >= 3 use Argon2id (native on mobile). */
const ARGON2_AES_VERSION = 3;

function identityPath(name: string): string {
  return `${BASE_DIR}/${name}.identity.json`;
}

function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password);
}

async function writeIdentityStorage(
  path: string,
  identity: Identity,
  password: string,
): Promise<string> {
  const normalizedPassword = password.trim();
  const salt = randomBytes(16);
  const key = await deriveIdentityKey(
    passwordBytes(normalizedPassword),
    salt,
  );
  const storageData = identity.toStorageFormatWithKey(key, salt);
  await RNFS.writeFile(path, storageData, 'utf8');
  return storageData;
}

async function ensureBaseDir(): Promise<void> {
  const exists = await RNFS.exists(BASE_DIR);
  if (!exists) {
    await RNFS.mkdir(BASE_DIR);
  }
}

export async function ensureAppDirs(): Promise<void> {
  await ensureBaseDir();
  if (!(await RNFS.exists(CONTACTS_DIR))) {
    await RNFS.mkdir(CONTACTS_DIR);
  }
  if (!(await RNFS.exists(CERTIFICATES_DIR))) {
    await RNFS.mkdir(CERTIFICATES_DIR);
  }
}

function normalizeName(name: string): string {
  const value = name.trim();
  if (!value) {
    throw new Error('Identity name is required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      'Identity name must use only letters, numbers, dash, underscore',
    );
  }
  return value;
}

function publicDataToMeta(
  name: string,
  publicData: IdentityPublicData,
): StoredIdentityMeta {
  return {
    name,
    fingerprint: publicData.fingerprint,
    signingKeyType: publicData.signingKeyType as SigningType,
    encryptionKeyType: publicData.encryptionKeyType,
  };
}

function parseEncryptedField(raw: string): string {
  const parsed = JSON.parse(raw) as {encrypted?: unknown};
  if (typeof parsed.encrypted !== 'string') {
    throw new Error('Missing encrypted private identity data');
  }
  return parsed.encrypted;
}

export async function listIdentities(): Promise<StoredIdentityMeta[]> {
  await ensureBaseDir();
  const entries = await RNFS.readDir(BASE_DIR);
  const identities: StoredIdentityMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.identity.json')) {
      continue;
    }
    const name = entry.name.replace(/\.identity\.json$/, '');
    const raw = await RNFS.readFile(entry.path, 'utf8');
    const publicData = Identity.readPublicData(raw);
    if (!publicData) {
      continue;
    }
    identities.push(publicDataToMeta(name, publicData));
  }

  identities.sort((a, b) => a.name.localeCompare(b.name));
  return identities;
}

export async function createIdentity(params: {
  name: string;
  password: string;
  signingType: SigningType;
}): Promise<StoredIdentityMeta> {
  const name = normalizeName(params.name);
  const password = params.password;
  const enforcePasswordPolicy = await getEnforcePasswordPolicy();
  const passwordCheck = validatePassword(password, {
    enforcePolicy: enforcePasswordPolicy,
  });
  if (!passwordCheck.ok) {
    const hint = passwordCheck.suggestions.length
      ? ` ${passwordCheck.suggestions.join(' ')}`
      : '';
    throw new Error(`${passwordCheck.reason}.${hint}`);
  }

  await ensureBaseDir();
  const path = identityPath(name);
  const exists = await RNFS.exists(path);
  if (exists) {
    throw new Error('Identity already exists');
  }

  const identity = new Identity(params.signingType, 'kyber');
  const storageData = await writeIdentityStorage(path, identity, password);

  const publicData = Identity.readPublicData(storageData);
  if (!publicData) {
    throw new Error('Failed to read identity public data');
  }

  await setCurrentIdentity(name);
  return publicDataToMeta(name, publicData);
}

export async function loadIdentity(
  name: string,
  password: string,
): Promise<Identity> {
  const normalizedPassword = password.trim();
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }
  await ensureAppDirs();
  const path = identityPath(normalizeName(name));
  const exists = await RNFS.exists(path);
  if (!exists) {
    throw new Error('Identity not found');
  }
  const raw = await RNFS.readFile(path, 'utf8');
  const encrypted = parseEncryptedField(raw);
  const {version, salt} = AES.readHeader(encrypted);

  if (version >= ARGON2_AES_VERSION) {
    const key = await deriveIdentityKey(
      passwordBytes(normalizedPassword),
      salt,
    );
    return Identity.fromStorageFormatWithKey(raw, key);
  }

  // Legacy PBKDF2 (v1/v2): slow noble path; rare for mobile-created identities.
  return Identity.fromStorageFormat(raw, normalizedPassword);
}

export async function readIdentityRaw(name: string): Promise<string> {
  await ensureAppDirs();
  const path = identityPath(normalizeName(name));
  const exists = await RNFS.exists(path);
  if (!exists) {
    throw new Error('Identity not found');
  }
  return RNFS.readFile(path, 'utf8');
}

export async function saveIdentity(
  name: string,
  password: string,
  identity: Identity,
): Promise<void> {
  await ensureAppDirs();
  const path = identityPath(normalizeName(name));
  await writeIdentityStorage(path, identity, password);
}

export async function getCurrentIdentityRequired(): Promise<string> {
  const current = await getCurrentIdentity();
  if (!current) {
    throw new Error('No current identity selected');
  }
  return current;
}

export function getContactsDir(): string {
  return CONTACTS_DIR;
}

export function getCertificatesDir(): string {
  return CERTIFICATES_DIR;
}

export function getPendingCertificatesFile(): string {
  return PENDING_CERTIFICATES_FILE;
}

export async function setCurrentIdentity(name: string | null): Promise<void> {
  await ensureBaseDir();
  const payload: AppState = {currentIdentity: name};
  await RNFS.writeFile(STATE_FILE, JSON.stringify(payload), 'utf8');
}

export async function getCurrentIdentity(): Promise<string | null> {
  await ensureBaseDir();
  const exists = await RNFS.exists(STATE_FILE);
  if (!exists) {
    return null;
  }
  const raw = await RNFS.readFile(STATE_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw) as AppState;
    return parsed.currentIdentity ?? null;
  } catch {
    return null;
  }
}

export async function runCoreSelfTest(): Promise<string> {
  const identity = new Identity('dilithium', 'kyber');
  const fingerprint = identity.toFingerprint();
  const signature = identity.signMessage('mobile-self-test');
  const verified = identity.verifyMessage('mobile-self-test', signature);

  if (!fingerprint || !verified) {
    throw new Error('Core self-test failed');
  }

  return `Core OK (${fingerprint.slice(0, 16)}...)`;
}
