import {loadIdentity, saveIdentity} from './storage';
import {getServerUrl} from './settings';
import {apiUrl} from './contactsLogic';
import {prepareDetailValue, requirePathAndDetail} from './detailsLogic';

export {prepareDetailValue, requirePathAndDetail} from './detailsLogic';

export async function listDetails(params: {
  identityName: string;
  password: string;
}): Promise<Array<{path: string; detail: string; proof: string}>> {
  const identity = await loadIdentity(params.identityName, params.password);
  return Array.from(identity.details.entries()).map(([path, [detail, proof]]) => ({
    path,
    detail,
    proof,
  }));
}

export async function addDetail(params: {
  identityName: string;
  password: string;
  path: string;
  detail: string;
  push?: boolean;
  server?: string;
}): Promise<void> {
  requirePathAndDetail(params.path, params.detail);
  const detailToAttach = prepareDetailValue(params.path, params.detail);
  const identity = await loadIdentity(params.identityName, params.password);
  identity.attachDetail(params.path, detailToAttach);
  await saveIdentity(params.identityName, params.password, identity);

  if (params.push) {
    const server = params.server ?? (await getServerUrl());
    const entry = identity.details.get(params.path);
    if (!entry) {
      throw new Error('Failed to locate attached detail');
    }
    const [detailValue, proof] = entry;
    const res = await fetch(apiUrl(server, '/api/v1/detail'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        path: params.path,
        detail: detailValue,
        proof,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {error?: string};
      throw new Error(
        `Failed to push detail: ${body.error ?? `HTTP ${res.status}`}`,
      );
    }
  }
}
