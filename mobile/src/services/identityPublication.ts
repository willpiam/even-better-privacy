import type {ExternalIdentity} from '../ebpCore';
import {apiUrl, normalizeServerIdentity} from './contactsLogic';

export type IdentityDetail = {path: string; detail: string; proof: string};
export type IdentityPublication =
  | {state: 'checking'}
  | {state: 'unavailable'; message: string}
  | {state: 'unpublished'}
  | {state: 'published' | 'revoked'; identity: ExternalIdentity};

export async function fetchIdentityPublication(
  fingerprint: string,
  server: string,
  signal?: AbortSignal,
): Promise<IdentityPublication> {
  const response = await fetch(
    apiUrl(server, `/api/v1/identity/${encodeURIComponent(fingerprint)}`),
    {signal},
  );
  const body = await response.json().catch(() => ({}));
  if (
    response.status === 404 ||
    (response.status === 400 && body.error === 'unknown subject')
  ) {
    return {state: 'unpublished'};
  }
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  if (body.fingerprint !== fingerprint) {
    throw new Error('Server returned a different identity');
  }
  const identity = normalizeServerIdentity(body, fingerprint);
  return {state: identity.revoked ? 'revoked' : 'published', identity};
}

export function mergeIdentityDetails(
  local: IdentityDetail[],
  publication: IdentityPublication,
  locallyRevokedPaths: string[] = [],
): IdentityDetail[] {
  const details = new Map<string, IdentityDetail>();
  if (publication.state === 'published' || publication.state === 'revoked') {
    for (const [path, [detail, proof]] of Object.entries(
      publication.identity.details,
    )) {
      details.set(path, {path, detail, proof});
    }
  }
  // Local edits take precedence, including an email awaiting publication.
  for (const detail of local) details.set(detail.path, detail);
  for (const path of locallyRevokedPaths) details.delete(path);
  return [...details.values()];
}

export function isEmailVerified(
  detail: IdentityDetail,
  publication: IdentityPublication,
): boolean {
  return (
    (detail.path === 'email' || detail.path === 'opaque::email') &&
    isDetailPublished(detail, publication) &&
    publication.state === 'published' &&
    publication.identity.detailsMeta?.[detail.path]?.verified === true
  );
}

export function isDetailPublished(
  detail: IdentityDetail,
  publication: IdentityPublication,
): boolean {
  return (
    publication.state === 'published' &&
    !publication.identity.revokedDetails?.includes(detail.path) &&
    publication.identity.details[detail.path]?.[0] === detail.detail
  );
}
