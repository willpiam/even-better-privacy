import {loadIdentityForUse, mutateIdentityForUse} from './storage';
import {getServerUrl} from './settings';
import {apiUrl} from './contactsLogic';
import {prepareDetailValue, requirePathAndDetail} from './detailsLogic';

async function pushStoredDetail(
  fingerprint: string,
  path: string,
  entry: [string, string] | undefined,
  server: string,
): Promise<void> {
  if (!entry) throw new Error('Failed to locate attached detail');
  const [detail, proof] = entry;
  const res = await fetch(apiUrl(server, '/api/v1/detail'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({fingerprint, path, detail, proof}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(
      `Failed to push detail: ${body.error ?? `HTTP ${res.status}`}`,
    );
  }
}

/** Publish an existing signed detail without changing or re-hashing its value. */
export async function publishDetail(params: {
  identityName: string;
  path: string;
  server?: string;
}): Promise<void> {
  const identity = await loadIdentityForUse(params.identityName);
  await pushStoredDetail(
    identity.toFingerprint(),
    params.path,
    identity.details.get(params.path),
    params.server ?? (await getServerUrl()),
  );
}

export {prepareDetailValue, requirePathAndDetail} from './detailsLogic';

export async function listDetails(params: {
  identityName: string;
  password?: string;
}): Promise<Array<{path: string; detail: string; proof: string}>> {
  return (await getIdentityDetails(params)).details;
}

export async function getIdentityDetails(params: {
  identityName: string;
  password?: string;
}) {
  const identity = await loadIdentityForUse(
    params.identityName,
    params.password,
  );
  const details = Array.from(identity.details.entries()).map(
    ([path, [detail, proof]]) => ({
      path,
      detail,
      proof,
    }),
  );
  return {
    details,
    revokedPaths: [...identity.revokedDetails.keys()],
    revoked: identity.revocationCertificate !== null,
  };
}

export async function addDetail(params: {
  identityName: string;
  password?: string;
  path: string;
  detail: string;
  push?: boolean;
  server?: string;
}): Promise<void> {
  requirePathAndDetail(params.path, params.detail);
  const detailToAttach = prepareDetailValue(params.path, params.detail);
  const {identity} = await mutateIdentityForUse(
    params.identityName,
    params.password,
    current => {
      current.attachDetail(params.path, detailToAttach);
    },
  );

  if (params.push) {
    const server = params.server ?? (await getServerUrl());
    await pushStoredDetail(
      identity.toFingerprint(),
      params.path,
      identity.details.get(params.path),
      server,
    );
  }
}
