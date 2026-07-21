import RNFS from 'react-native-fs';
import type {ExternalIdentity} from '../ebpCore';
import {sha256Hex} from '../../../core/MessageHash.ts';
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
  createdAt?: number;
  revoked?: boolean;
};

export type BrowseServerIdentitiesResult = {
  identities: ServerIdentitySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
};

export function getDetailValue(
  details: Record<string, [string, string]> | undefined,
  path: string,
): string | null {
  if (!details) {
    return null;
  }
  const val = details[path];
  if (Array.isArray(val)) {
    return val[0] || null;
  }
  return typeof val === 'string' ? val : null;
}

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
  const revokedDetails = Array.isArray(source.revokedDetails)
    ? (source.revokedDetails as string[])
    : [];

  // Strip revoked details from the details and detailsMeta maps
  const details = { ...((source.details as ExternalIdentity['details']) ?? {}) };
  const detailsMeta = { ...((source.detailsMeta as ExternalIdentity['detailsMeta']) ?? {}) };
  for (const path of revokedDetails) {
    delete details[path];
    delete detailsMeta[path];
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
    details,
    detailsMeta,
    revoked: Boolean(source.revoked),
    revokedDetails,
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

/** Cleartext compare helper (trim + lowercase). */
function emailsEqualIgnoreCase(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Match a typed address against published `email` detail or `opaque::email`
 * (resolved cleartext or SHA-256 hash of the trimmed typed value). Does not
 * match local-only `localEmail` notes.
 */
function contactMatchesEmail(
  contact: ExternalIdentity,
  trimmedEmail: string,
  normalizedEmail: string,
): boolean {
  const detailEmail = getDetailValue(contact.details, 'email');
  if (detailEmail && emailsEqualIgnoreCase(detailEmail, normalizedEmail)) {
    return true;
  }
  const resolved = contact.resolvedOpaqueDetails?.['opaque::email'];
  if (resolved && emailsEqualIgnoreCase(resolved, normalizedEmail)) {
    return true;
  }
  const opaqueHash = getDetailValue(contact.details, 'opaque::email');
  if (opaqueHash && sha256Hex(trimmedEmail) === opaqueHash) {
    return true;
  }
  return false;
}

/**
 * Find local contacts whose `email` detail or `opaque::email` matches.
 * On opaque hash match, persists cleartext via resolveOpaqueDetail when needed.
 */
export async function findContactsByEmail(
  email: string,
): Promise<StoredContact[]> {
  const trimmed = email.trim();
  if (!trimmed) {
    return [];
  }
  const normalized = trimmed.toLowerCase();
  const contacts = await listContacts();
  const matches: StoredContact[] = [];
  for (const item of contacts) {
    if (!contactMatchesEmail(item.contact, trimmed, normalized)) {
      continue;
    }
    matches.push(item);
    const opaqueHash = getDetailValue(item.contact.details, 'opaque::email');
    const resolved = item.contact.resolvedOpaqueDetails?.['opaque::email'];
    if (
      opaqueHash &&
      sha256Hex(trimmed) === opaqueHash &&
      !(resolved && emailsEqualIgnoreCase(resolved, normalized))
    ) {
      try {
        await resolveOpaqueDetail({
          fingerprint: item.contact.fingerprint,
          path: 'opaque::email',
          value: trimmed,
        });
      } catch {
        // Lookup still succeeds even if persist fails.
      }
    }
  }
  return matches;
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
  const path = contactPath(contactName);
  if (await RNFS.exists(path)) {
    try {
      const existingRaw = await RNFS.readFile(path, 'utf8');
      const existing = JSON.parse(existingRaw) as ExternalIdentity;
      const preservedEntries = Object.entries(existing.resolvedOpaqueDetails ?? {}).filter(
        ([detailPath, value]) =>
          typeof value === 'string' && contact.details[detailPath] !== undefined,
      );
      if (preservedEntries.length > 0) {
        contact.resolvedOpaqueDetails = Object.fromEntries(preservedEntries);
      }
    } catch {
      // Ignore parse/read errors and continue with normalized contact payload.
    }
  }
  await RNFS.writeFile(path, JSON.stringify(contact, null, 2), 'utf8');
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

async function findContactByFingerprint(
  fingerprint: string,
): Promise<{name: string; contact: ExternalIdentity; path: string}> {
  const contacts = await listContacts();
  const target = contacts.find(c => c.contact.fingerprint === fingerprint);
  if (!target) {
    throw new Error('Contact not found');
  }
  return {name: target.name, contact: target.contact, path: contactPath(target.name)};
}

export async function resolveOpaqueDetail(params: {
  fingerprint: string;
  path: string;
  value: string;
}): Promise<{ok: boolean; path: string}> {
  if (!params.path.startsWith('opaque::')) {
    throw new Error('path must start with opaque::');
  }
  const found = await findContactByFingerprint(params.fingerprint);
  const detailEntry = found.contact.details?.[params.path];
  const expectedHash = Array.isArray(detailEntry) ? detailEntry[0] : detailEntry;
  if (typeof expectedHash !== 'string' || !expectedHash.length) {
    throw new Error('opaque detail not found');
  }
  const candidateHash = sha256Hex(params.value);
  if (candidateHash !== expectedHash) {
    throw new Error('value does not match opaque detail hash');
  }
  found.contact.resolvedOpaqueDetails = {
    ...(found.contact.resolvedOpaqueDetails ?? {}),
    [params.path]: params.value,
  };
  await RNFS.writeFile(
    found.path,
    JSON.stringify(found.contact, null, 2),
    'utf8',
  );
  return {ok: true, path: params.path};
}

export async function updateContactLocalNotes(params: {
  fingerprint: string;
  localAlias?: string | null;
  localDescription?: string | null;
  localEmail?: string | null;
}): Promise<void> {
  const found = await findContactByFingerprint(params.fingerprint);
  const raw = found.contact as ExternalIdentity & {
    localAlias?: string;
    localDescription?: string;
    localEmail?: string;
  };
  if (params.localAlias !== undefined) {
    if (params.localAlias === null || params.localAlias === '') {
      delete raw.localAlias;
    } else {
      raw.localAlias = params.localAlias;
    }
  }
  if (params.localDescription !== undefined) {
    if (params.localDescription === null || params.localDescription === '') {
      delete raw.localDescription;
    } else {
      raw.localDescription = params.localDescription;
    }
  }
  if (params.localEmail !== undefined) {
    if (params.localEmail === null || params.localEmail === '') {
      delete raw.localEmail;
    } else {
      raw.localEmail = params.localEmail;
    }
  }
  await RNFS.writeFile(found.path, JSON.stringify(raw, null, 2), 'utf8');
}

export async function requestVerifyEmail(params: {
  fingerprint: string;
  detail: string;
  path?: string;
  server?: string;
}): Promise<unknown> {
  const server = params.server ?? (await getServerUrl());
  const res = await fetch(apiUrl(server, '/api/v1/verify-email/request'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      fingerprint: params.fingerprint,
      detail: params.detail,
      ...(params.path ? {path: params.path} : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason =
      typeof (body as {error?: string}).error === 'string'
        ? (body as {error?: string}).error
        : `HTTP ${res.status}`;
    throw new Error(`Failed to send verification email: ${reason}`);
  }
  return body;
}

export async function browseServerIdentities(params?: {
  query?: string;
  page?: number;
  server?: string;
}): Promise<BrowseServerIdentitiesResult> {
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
  const pagination =
    body.pagination && typeof body.pagination === 'object'
      ? (body.pagination as Record<string, unknown>)
      : {};
  const page = Number(pagination.page ?? body.page ?? 1);
  const pageSize = Number(pagination.pageSize ?? body.pageSize ?? identities.length);
  const total = Number(pagination.total ?? body.total ?? identities.length);
  const totalPages = Number(
    pagination.totalPages ??
      body.totalPages ??
      (total > 0 ? Math.ceil(total / Math.max(pageSize, 1)) : 1),
  );
  const hasMore = pagination.hasMore;
  const hasNextPage =
    typeof hasMore === 'boolean' ? hasMore : page < totalPages;
  return {
    identities,
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage,
  };
}
