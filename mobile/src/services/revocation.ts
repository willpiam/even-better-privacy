import {loadIdentity, saveIdentity} from './storage';
import {getServerUrl} from './settings';

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function revokeDetail(params: {
  identityName: string;
  password: string;
  path: string;
  reason?: string;
  push?: boolean;
  server?: string;
}): Promise<void> {
  const identity = await loadIdentity(params.identityName, params.password);
  const certificate = identity.revokeDetail(params.path, params.reason);
  await saveIdentity(params.identityName, params.password, identity);
  if (params.push) {
    const server = params.server ?? (await getServerUrl());
    const res = await fetch(apiUrl(server, '/api/v1/revoke'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        type: 'detail',
        target: params.path,
        certificate,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {error?: string};
      throw new Error(`Failed to push revocation: ${body.error ?? `HTTP ${res.status}`}`);
    }
  }
}

export async function revokeIdentity(params: {
  identityName: string;
  password: string;
  reason?: string;
  push?: boolean;
  server?: string;
}): Promise<void> {
  const identity = await loadIdentity(params.identityName, params.password);
  const certificate = identity.createIdentityRevocation(params.reason);
  await saveIdentity(params.identityName, params.password, identity);
  if (params.push) {
    const server = params.server ?? (await getServerUrl());
    const res = await fetch(apiUrl(server, '/api/v1/revoke'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        type: 'identity',
        certificate,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {error?: string};
      throw new Error(`Failed to push revocation: ${body.error ?? `HTTP ${res.status}`}`);
    }
  }
}

export async function generateEmergencyCert(params: {
  identityName: string;
  password: string;
}): Promise<{
  type: string;
  fingerprint: string;
  certificate: string;
  createdAt: string;
  warning: string;
}> {
  const identity = await loadIdentity(params.identityName, params.password);
  const certificate = identity.generateEmergencyRevocationCertificate();
  return {
    type: 'ebp-emergency-revocation-certificate',
    fingerprint: identity.toFingerprint(),
    certificate,
    createdAt: new Date().toISOString(),
    warning: 'KEEP THIS SECURE. Anyone with this certificate can revoke your identity.',
  };
}
