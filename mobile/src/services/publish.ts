import {
  buildIdentityStateFromExternal,
  computeStateHash,
  stableStringify,
  type ExternalIdentity,
} from '../ebpCore';
import {loadIdentity} from './storage';

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function publishIdentity(params: {
  identityName: string;
  password: string;
  server: string;
}): Promise<string> {
  const identity = await loadIdentity(params.identityName, params.password);
  const summary = identity.summary;

  let serverIdentity: ExternalIdentity | null = null;
  const identityRes = await fetch(
    apiUrl(params.server, `/api/v1/identity/${summary.fingerprint}`),
  );
  if (identityRes.ok) {
    const body = await identityRes.json();
    serverIdentity = {
      fingerprint: body.fingerprint,
      signingKeyType: body.signingKeyType,
      encryptionKeyType: body.encryptionKeyType,
      signingKey: body.signingKey,
      encryptionKey: body.encryptionKey,
      signingKeyDetails: body.signingKeyDetails ?? {variant: 'ml_dsa87'},
      encryptionKeyDetails: body.encryptionKeyDetails ?? {
        variant: 'ml_kem1024',
      },
      details: body.details ?? {},
      detailsMeta: body.detailsMeta ?? {},
      revoked: body.revoked ?? false,
      revokedDetails: body.revokedDetails ?? [],
    };
  } else if (identityRes.status !== 404) {
    const body = await identityRes.json().catch(() => ({}));
    const reason = body?.error ?? `HTTP ${identityRes.status}`;
    throw new Error(`Failed to query server identity: ${reason}`);
  }

  if (serverIdentity) {
    if (
      serverIdentity.signingKey !== summary.signingKey ||
      serverIdentity.encryptionKey !== summary.encryptionKey ||
      serverIdentity.signingKeyType !== summary.signingKeyType ||
      serverIdentity.encryptionKeyType !== summary.encryptionKeyType
    ) {
      throw new Error('Server identity keys differ from local identity');
    }
  }

  const serverDetails: Record<string, [string, string]> =
    serverIdentity?.details ?? {};
  const serverState = serverIdentity
    ? buildIdentityStateFromExternal(serverIdentity, serverDetails)
    : null;
  const fromState = serverState ? computeStateHash(serverState) : null;

  const nextState = buildIdentityStateFromExternal(
    {
      ...summary,
      details: serverDetails,
    },
    serverDetails,
  );

  const toState = computeStateHash(nextState);
  const transitionMessage = stableStringify({fromState, toState});
  const stateSignature = identity.signMessage(transitionMessage);

  const payload = {
    signingKeyType: summary.signingKeyType,
    encryptionKeyType: summary.encryptionKeyType,
    signingKey: summary.signingKey,
    encryptionKey: summary.encryptionKey,
    signingKeyDetails: summary.signingKeyDetails,
    encryptionKeyDetails: summary.encryptionKeyDetails,
    fingerprint: summary.fingerprint,
    fromState,
    toState,
    stateSignature,
  };

  const publishRes = await fetch(apiUrl(params.server, '/api/v1/identity'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload),
  });

  if (!publishRes.ok) {
    const body = await publishRes.json().catch(() => ({}));
    const reason = body?.error ?? `HTTP ${publishRes.status}`;
    throw new Error(`Failed to publish identity: ${reason}`);
  }

  return summary.fingerprint;
}
