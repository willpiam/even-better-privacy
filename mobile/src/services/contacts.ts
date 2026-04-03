import RNFS from 'react-native-fs';
import type {ExternalIdentity} from '../ebpCore';
import {getServerUrl} from './settings';
import {ensureAppDirs, getContactsDir} from './storage';

export type StoredContact = {
  name: string;
  contact: ExternalIdentity;
};

export type ServerIdentitySummary = {
  fingerprint: string;
  signingKeyType: 'dilithium' | 'sphincs';
  encryptionKeyType: 'kyber';
  details: Record<string, [string, string]>;
  detailsMeta?: Record<string, {verified: boolean; verifiedAt: number | null}>;
};

function normalizeContactName(name: string): string {
  const value = name.trim();
  if (!value) {
    throw new Error('Contact name is required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      'Contact name must use only letters, numbers, dash, underscore',
    );
  }
  return value;
}

function contactPath(name: string): string {
  return `${getContactsDir()}/${name}.json`;
}

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeExternalIdentity(
  source: Record<string, unknown>,
  fallbackFingerprint?: string,
): ExternalIdentity {
  const signingKeyType =
    source.signingKeyType === 'sphincs' ? 'sphincs' : 'dilithium';
  const fingerprint =
    typeof source.fingerprint === 'string' && source.fingerprint
      ? source.fingerprint
      : fallbackFingerprint ?? '';
  const signingKey =
    typeof source.signingKey === 'string' ? source.signingKey : '';
  const encryptionKey =
    typeof source.encryptionKey === 'string' ? source.encryptionKey : '';
  if (!fingerprint || !signingKey || !encryptionKey) {
    throw new Error('Invalid public identity payload');
  }
  return {
    fingerprint,
    signingKeyType,
    encryptionKeyType: 'kyber',
    signingKey,
    encryptionKey,
    signingKeyDetails:
      (source.signingKeyDetails as ExternalIdentity['signingKeyDetails']) ?? {
        variant: 'ml_dsa87',
      },
    encryptionKeyDetails:
      (source.encryptionKeyDetails as ExternalIdentity['encryptionKeyDetails']) ??
      {
        variant: 'ml_kem1024',
      },
    details: (source.details as ExternalIdentity['details']) ?? {},
    detailsMeta: (source.detailsMeta as ExternalIdentity['detailsMeta']) ?? {},
    revoked: Boolean(source.revoked),
    revokedDetails: Array.isArray(source.revokedDetails)
      ? (source.revokedDetails as string[])
      : [],
  };
}

export async function listContacts(): Promise<StoredContact[]> {
  await ensureAppDirs();
  const dir = getContactsDir();
  const entries = await RNFS.readDir(dir);
  const contacts: StoredContact[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const name = entry.name.replace(/\.json$/, '');
    const raw = await RNFS.readFile(entry.path, 'utf8');
    const contact = JSON.parse(raw) as ExternalIdentity;
    contacts.push({name, contact});
  }
  contacts.sort((a, b) => a.name.localeCompare(b.name));
  return contacts;
}

export async function importContact(
  payload: string | ExternalIdentity,
  name?: string,
): Promise<{name: string; fingerprint: string}> {
  await ensureAppDirs();
  const parsed =
    typeof payload === 'string'
      ? (JSON.parse(payload) as Record<string, unknown>)
      : (payload as unknown as Record<string, unknown>);
  const contact = normalizeExternalIdentity(parsed);
  const contactName = normalizeContactName(name ?? contact.fingerprint.slice(0, 16));
  await RNFS.writeFile(contactPath(contactName), JSON.stringify(contact, null, 2), 'utf8');
  return {name: contactName, fingerprint: contact.fingerprint};
}

export async function deleteContact(params: {
  name?: string;
  fingerprint?: string;
}): Promise<string> {
  await ensureAppDirs();
  const contacts = await listContacts();
  let target = params.name
    ? contacts.find(c => c.name === params.name)
    : undefined;
  if (!target && params.fingerprint) {
    target = contacts.find(c => c.contact.fingerprint === params.fingerprint);
  }
  if (!target) {
    throw new Error('Contact not found');
  }
  await RNFS.unlink(contactPath(target.name));
  return target.name;
}

export async function loadContact(nameOrFingerprint: string): Promise<ExternalIdentity> {
  await ensureAppDirs();
  const byNamePath = contactPath(nameOrFingerprint);
  if (await RNFS.exists(byNamePath)) {
    const raw = await RNFS.readFile(byNamePath, 'utf8');
    return JSON.parse(raw) as ExternalIdentity;
  }
  const contacts = await listContacts();
  const byPrefix = contacts.find(c =>
    c.contact.fingerprint.startsWith(nameOrFingerprint),
  );
  if (!byPrefix) {
    throw new Error('Contact not found');
  }
  return byPrefix.contact;
}

export async function fetchContactFromServer(params: {
  fingerprint: string;
  name?: string;
  server?: string;
}): Promise<{name: string; fingerprint: string}> {
  const server = params.server ?? (await getServerUrl());
  const res = await fetch(
    apiUrl(server, `/api/v1/identity/${encodeURIComponent(params.fingerprint)}`),
  );
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`Failed to fetch identity: ${reason}`);
  }
  const normalized = normalizeExternalIdentity(body, params.fingerprint);
  return importContact(normalized, params.name);
}

export async function browseServerIdentities(params?: {
  query?: string;
  page?: number;
  server?: string;
}): Promise<{
  identities: ServerIdentitySummary[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}> {
  const server = params?.server ?? (await getServerUrl());
  const query = (params?.query ?? '').trim();
  const path = query ? '/api/v1/identities/search' : '/api/v1/identities';
  const url = new URL(apiUrl(server, path));
  if (params?.page && Number.isFinite(params.page)) {
    url.searchParams.set('page', String(Math.max(1, Math.floor(params.page))));
  }
  if (query) {
    url.searchParams.set('query', query);
  }
  const res = await fetch(url.toString());
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`Failed to browse server identities: ${reason}`);
  }
  const identities = Array.isArray(body.identities)
    ? (body.identities as ServerIdentitySummary[])
    : [];
  return {
    identities,
    page: Number(body.page ?? 1),
    pageSize: Number(body.pageSize ?? identities.length),
    total: Number(body.total ?? identities.length),
    hasNextPage: Boolean(body.hasNextPage),
  };
}
