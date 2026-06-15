import {
  Identity,
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeed,
  validatePassword,
  type HdProfile,
  type HdChange,
} from '../ebpCore';
import {getServerUrl, getEnforcePasswordPolicy} from './settings';
import {importIdentity, listIdentities, persistIdentity} from './storage';

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function createHdMnemonic(strength = 256): string {
  return generateMnemonic(strength);
}

export function verifyHdMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic);
}

export async function createHdIdentity(params: {
  name: string;
  mnemonic: string;
  passphrase?: string;
  password: string;
  profile: HdProfile;
  account?: number;
  change?: HdChange;
  index?: number;
  overwrite?: boolean;
}): Promise<{
  name: string;
  fingerprint: string;
  signingKeyType: string;
  encryptionKeyType: string;
}> {
  if (!validateMnemonic(params.mnemonic)) {
    throw new Error('valid mnemonic is required');
  }
  const enforce = await getEnforcePasswordPolicy();
  const passwordCheck = validatePassword(params.password, {enforcePolicy: enforce});
  if (!passwordCheck.ok) {
    throw new Error(passwordCheck.reason);
  }

  const seed = mnemonicToSeed(params.mnemonic, params.passphrase ?? '');
  const identity = Identity.fromAccount(seed, {
    profile: params.profile,
    account: params.account ?? 0,
    change: params.change ?? 'external',
    index: params.index ?? 0,
  });

  await persistIdentity({
    name: params.name,
    password: params.password,
    identity,
    overwrite: params.overwrite,
  });

  return {
    name: params.name,
    fingerprint: identity.toFingerprint(),
    signingKeyType: identity.signingKeyType,
    encryptionKeyType: identity.encryptionKeyType,
  };
}

export async function discoverHdIdentities(params: {
  mnemonic: string;
  passphrase?: string;
  profile: HdProfile;
  account?: number;
  gapLimit?: number;
  server?: string;
}): Promise<
  Array<{
    index: number;
    fingerprint: string;
    localName?: string;
    publishedToServer: boolean;
  }>
> {
  if (!validateMnemonic(params.mnemonic)) {
    throw new Error('valid mnemonic is required');
  }
  const seed = mnemonicToSeed(params.mnemonic, params.passphrase ?? '');
  const server = params.server ?? (await getServerUrl());
  const local = await listIdentities();
  const localFp = new Map(local.map(i => [i.fingerprint, i.name]));
  const gapLimit = params.gapLimit ?? 20;
  const matches: Array<{
    index: number;
    fingerprint: string;
    localName?: string;
    publishedToServer: boolean;
  }> = [];
  let gap = 0;
  for (let index = 0; gap < gapLimit; index++) {
    const identity = Identity.fromAccount(seed, {
      profile: params.profile,
      account: params.account ?? 0,
      change: 'external',
      index,
    });
    const fingerprint = identity.toFingerprint();
    const localName = localFp.get(fingerprint);
    let publishedToServer = false;
    try {
      const res = await fetch(
        apiUrl(server, `/api/v1/identity/${encodeURIComponent(fingerprint)}`),
      );
      publishedToServer = res.ok;
    } catch {
      // ignore unreachable server
    }
    if (localName || publishedToServer) {
      gap = 0;
      matches.push({index, fingerprint, localName, publishedToServer});
    } else {
      gap++;
    }
  }
  return matches;
}

/** Import HD-derived identity file produced on desktop (raw storage JSON). */
export async function importHdStorageFile(params: {
  storageJson: string;
  name: string;
  overwrite?: boolean;
}): Promise<{name: string; fingerprint: string}> {
  const meta = await importIdentity({
    storageJson: params.storageJson,
    name: params.name,
    overwrite: params.overwrite,
  });
  return {name: meta.name, fingerprint: meta.fingerprint};
}
