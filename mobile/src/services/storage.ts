import RNFS from 'react-native-fs';
import {Identity} from '../ebpCore';
import type {IdentityPublicData} from '../../../core/Identity';
import type {AppState, SigningType, StoredIdentityMeta} from '../types';

const BASE_DIR = `${RNFS.DocumentDirectoryPath}/ebp`;
const STATE_FILE = `${BASE_DIR}/state.json`;

function identityPath(name: string): string {
  return `${BASE_DIR}/${name}.identity.json`;
}

async function ensureBaseDir(): Promise<void> {
  const exists = await RNFS.exists(BASE_DIR);
  if (!exists) {
    await RNFS.mkdir(BASE_DIR);
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
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  await ensureBaseDir();
  const path = identityPath(name);
  const exists = await RNFS.exists(path);
  if (exists) {
    throw new Error('Identity already exists');
  }

  const identity = new Identity(params.signingType, 'kyber');
  const storageData = identity.toStorageFormat(password);
  await RNFS.writeFile(path, storageData, 'utf8');

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
  await ensureBaseDir();
  const path = identityPath(normalizeName(name));
  const exists = await RNFS.exists(path);
  if (!exists) {
    throw new Error('Identity not found');
  }
  const raw = await RNFS.readFile(path, 'utf8');
  return Identity.fromStorageFormat(raw, password);
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
