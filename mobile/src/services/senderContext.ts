import type {ExternalIdentity} from '../ebpCore';
import {resolveSenderIdentity} from '../../../core/SenderResolution';
import type {ResolveSenderIdentityParams} from '../../../core/SenderResolution';
import {getServerUrl} from './settings';
import {loadContact} from './contacts';

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeServerIdentity(
  body: Record<string, unknown>,
  fallbackFingerprint: string,
): ExternalIdentity {
  const signingKeyType =
    body.signingKeyType === 'sphincs' ? 'sphincs' : 'dilithium';
  const fingerprint =
    typeof body.fingerprint === 'string' && body.fingerprint
      ? body.fingerprint
      : fallbackFingerprint;
  const revokedDetails = Array.isArray(body.revokedDetails)
    ? (body.revokedDetails as string[])
    : [];
  const details = {
    ...((body.details as ExternalIdentity['details']) ?? {}),
  };
  const detailsMeta = {
    ...((body.detailsMeta as ExternalIdentity['detailsMeta']) ?? {}),
  };
  for (const path of revokedDetails) {
    delete details[path];
    delete detailsMeta[path];
  }
  return {
    fingerprint,
    signingKeyType,
    encryptionKeyType: 'kyber',
    signingKey: String(body.signingKey ?? ''),
    encryptionKey: String(body.encryptionKey ?? ''),
    signingKeyDetails:
      (body.signingKeyDetails as ExternalIdentity['signingKeyDetails']) ?? {
        variant: 'ml_dsa87',
      },
    encryptionKeyDetails:
      (body.encryptionKeyDetails as ExternalIdentity['encryptionKeyDetails']) ??
      {variant: 'ml_kem1024'},
    details,
    detailsMeta,
    revoked: Boolean(body.revoked),
    revokedDetails,
  };
}

export async function resolveSenderForDecrypt(
  params: Omit<
    ResolveSenderIdentityParams,
    'loadContact' | 'fetchFromServer'
  >,
): Promise<{contact: ExternalIdentity; isKnownContact: boolean}> {
  return resolveSenderIdentity({
    ...params,
    loadContact,
    fetchFromServer: async (fingerprint: string) => {
      try {
        const server = await getServerUrl();
        const res = await fetch(
          apiUrl(server, `/api/v1/identity/${encodeURIComponent(fingerprint)}`),
        );
        if (!res.ok) {
          return null;
        }
        const body = (await res.json()) as Record<string, unknown>;
        if (
          typeof body.signingKey !== 'string' ||
          typeof body.encryptionKey !== 'string'
        ) {
          return null;
        }
        return normalizeServerIdentity(body, fingerprint);
      } catch {
        return null;
      }
    },
  });
}
