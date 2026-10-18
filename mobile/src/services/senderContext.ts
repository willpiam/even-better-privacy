import type {ExternalIdentity} from '../ebpCore';
import {resolveSenderIdentity} from '../../../core/SenderResolution';
import type {ResolveSenderIdentityParams} from '../../../core/SenderResolution';
import {apiUrl, normalizeServerIdentity} from './contactsLogic';
import {getServerUrl} from './settings';
import {loadContact} from './contacts';

export {normalizeServerIdentity} from './contactsLogic';

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
