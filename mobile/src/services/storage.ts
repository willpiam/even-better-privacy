import RNFS from 'react-native-fs';
import {DecryptionAuthError} from '../../../core/AES';
import {
  AES,
  Identity,
  randomBytes,
  shortFingerprint,
} from '../ebpCore';
import {deriveIdentityKey} from './argon2';
import type {IdentityPublicData} from '../../../core/Identity';
import type {AppState, SigningType, StoredIdentityMeta} from '../types';
import {sameBytes} from './unlockSessionLogic';
import {
  cacheUnlockedIdentity,
  getUnlockMaterial,
  lock as lockIdentitySession,
} from './unlockSession';

export const BASE_DIR = `${RNFS.DocumentDirectoryPath}/ebp`;
const STATE_FILE = `${BASE_DIR}/state.json`;
const CONTACTS_DIR = `${BASE_DIR}/contacts`;
const CERTIFICATES_DIR = `${BASE_DIR}/certificates`;
const PENDING_CERTIFICATES_FILE = `${BASE_DIR}/pending-certificates.json`;

/** Ciphertext versions >= 3 use Argon2id (native on mobile). */
const ARGON2_AES_VERSION = 3;

/** No cached key, or the session was idle-locked. */
export class IdentityLockedError extends Error {
  readonly code = 'identity_locked';
  constructor(message = 'identity locked') {
    super(message);
    this.name = 'IdentityLockedError';
  }
}

/** Cached key no longer decrypts (salt change or corrupt ciphertext). The cache entry is dropped. */
export class IdentitySessionStaleError extends Error {
  readonly code = 'identity_session_stale';
  constructor(message = 'identity unlock is stale') {
    super(message);
    this.name = 'IdentitySessionStaleError';
  }
}

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

export async function persistIdentity(params: {
  name: string;
  password: string;
  identity: Identity;
  overwrite?: boolean;
}): Promise<StoredIdentityMeta> {
  const name = normalizeName(params.name);
  await ensureBaseDir();
  const path = identityPath(name);
  const exists = await RNFS.exists(path);
  if (exists && !params.overwrite) {
    throw new Error('Identity already exists');
  }
  const storageData = await writeIdentityStorage(
    path,
    params.identity,
    params.password,
  );
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

/**
 * Derive the storage key, cache it for the idle session, and verify it decrypts.
 * Returns the normalized identity name.
 */
export async function unlockIdentity(
  name: string,
  password: string,
): Promise<string> {
  const normalizedPassword = password.trim();
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }
  const normalized = normalizeName(name);
  await ensureAppDirs();
  const path = identityPath(normalized);
  if (!(await RNFS.exists(path))) {
    throw new Error('Identity not found');
  }
  const raw = await RNFS.readFile(path, 'utf8');
  const encrypted = parseEncryptedField(raw);
  const {version, salt} = AES.readHeader(encrypted);
  const key =
    version >= ARGON2_AES_VERSION
      ? await deriveIdentityKey(passwordBytes(normalizedPassword), salt)
      : AES.deriveKeyForStorage(normalizedPassword, salt, version);
  try {
    Identity.fromStorageFormatWithKey(raw, key);
  } catch (error) {
    key.fill(0);
    if (error instanceof DecryptionAuthError) {
      throw new Error('Wrong password');
    }
    throw error;
  }
  try {
    await cacheUnlockedIdentity(normalized, key, salt);
  } catch (error) {
    key.fill(0);
    throw error;
  }
  return normalized;
}

/**
 * Re-read the identity with the cached storage key.
 * A salt change or decrypt failure evicts the session and throws
 * {@link IdentitySessionStaleError}. A missing session throws
 * {@link IdentityLockedError}.
 */
export async function loadIdentityUnlocked(name: string): Promise<Identity> {
  const normalized = normalizeName(name);
  const material = getUnlockMaterial(normalized);
  if (!material) {
    throw new IdentityLockedError();
  }
  await ensureAppDirs();
  const path = identityPath(normalized);
  if (!(await RNFS.exists(path))) {
    lockIdentitySession(normalized);
    throw new IdentityLockedError();
  }
  const raw = await RNFS.readFile(path, 'utf8');
  let salt: Uint8Array;
  try {
    salt = AES.readHeader(parseEncryptedField(raw)).salt;
  } catch {
    lockIdentitySession(normalized);
    throw new IdentitySessionStaleError();
  }
  if (!sameBytes(salt, material.salt)) {
    lockIdentitySession(normalized);
    throw new IdentitySessionStaleError();
  }
  try {
    return Identity.fromStorageFormatWithKey(raw, material.key);
  } catch {
    lockIdentitySession(normalized);
    throw new IdentitySessionStaleError();
  }
}

/** Re-save with the cached key and salt so the session stays valid. */
export async function saveIdentityUnlocked(
  name: string,
  identity: Identity,
): Promise<void> {
  const normalized = normalizeName(name);
  const material = getUnlockMaterial(normalized);
  if (!material) {
    throw new IdentityLockedError();
  }
  await ensureAppDirs();
  const storageData = identity.toStorageFormatWithKey(material.key, material.salt);
  await RNFS.writeFile(identityPath(normalized), storageData, 'utf8');
}

/** Password path for creation flows; otherwise the unlock session. */
export async function loadIdentityForUse(
  name: string,
  password?: string,
): Promise<Identity> {
  if (password?.trim()) {
    return loadIdentity(name, password);
  }
  return loadIdentityUnlocked(name);
}

export async function saveIdentityForUse(
  name: string,
  identity: Identity,
  password?: string,
): Promise<void> {
  if (password?.trim()) {
    await saveIdentity(name, password, identity);
    return;
  }
  await saveIdentityUnlocked(name, identity);
}

export async function importIdentity(params: {
  storageJson: string;
  name?: string;
  overwrite?: boolean;
}): Promise<StoredIdentityMeta> {
  const parsed = JSON.parse(params.storageJson) as {encrypted?: unknown};
  if (typeof parsed.encrypted !== 'string') {
    throw new Error('Invalid identity file: missing encrypted field');
  }
  const publicData = Identity.readPublicData(params.storageJson);
  if (!publicData) {
    throw new Error('Invalid identity file: missing public data');
  }
  const name = normalizeName(
    params.name ?? publicData.fingerprint.slice(0, 16),
  );
  await ensureBaseDir();
  const path = identityPath(name);
  const exists = await RNFS.exists(path);
  if (exists && !params.overwrite) {
    throw new Error('Identity already exists; enable overwrite to replace');
  }
  await RNFS.writeFile(path, params.storageJson, 'utf8');
  return publicDataToMeta(name, publicData);
}

export async function deleteIdentity(name: string): Promise<void> {
  const normalized = normalizeName(name);
  await ensureBaseDir();
  const path = identityPath(normalized);
  if (!(await RNFS.exists(path))) {
    throw new Error('Identity not found');
  }
  await RNFS.unlink(path);
  lockIdentitySession(normalized);
  const current = await getCurrentIdentity();
  if (current === normalized) {
    await setCurrentIdentity(null);
  }
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

/** Public identity data for the current wallet (no password unlock). */
export async function readCurrentIdentityPublic(): Promise<{
  name: string;
  publicData: IdentityPublicData;
} | null> {
  const name = await getCurrentIdentity();
  if (!name) {
    return null;
  }
  const path = identityPath(normalizeName(name));
  if (!(await RNFS.exists(path))) {
    return null;
  }
  const raw = await RNFS.readFile(path, 'utf8');
  const publicData = Identity.readPublicData(raw);
  if (!publicData) {
    return null;
  }
  return {name, publicData};
}

export async function runCoreSelfTest(): Promise<string> {
  const identity = new Identity('dilithium', 'kyber');
  const fingerprint = identity.toFingerprint();
  const signature = identity.signMessage('mobile-self-test');
  const verified = identity.verifyMessage('mobile-self-test', signature);

  if (!fingerprint || !verified) {
    throw new Error('Core self-test failed');
  }

  return `Core OK (${shortFingerprint(fingerprint)})`;
}
