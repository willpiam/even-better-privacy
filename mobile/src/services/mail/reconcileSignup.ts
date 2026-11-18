import type {StoredIdentityMeta} from '../../types';
import {fetchIdentityPublication, isEmailVerified} from '../identityPublication';
import {listIdentities} from '../storage';
import {readMailStore} from './accountStore';
import {fetchPaymentOrderSnapshot} from './ebpSignup';
import {pendingSignups, removePendingSignup, type PendingSignup} from './pendingSignup';

export type SignupEntry = PendingSignup & {
  action: 'resume' | 'restore' | 'unavailable';
  reason?: string;
};

export async function reconcilePendingSignups(
  server: string,
  testMailEnabled: boolean,
  identities?: StoredIdentityMeta[],
): Promise<SignupEntry[]> {
  const saved = [
    ...await pendingSignups(server, undefined, false),
    ...(testMailEnabled ? await pendingSignups(server, undefined, true) : []),
  ];
  if (!saved.length) return [];
  const local = identities ?? await listIdentities();
  const entries = await Promise.all(saved.map(async (signup): Promise<SignupEntry | null> => {
    const identity = local.find(item => item.name === signup.identityName);
    const email = `${signup.username}@${signup.domain}`.toLowerCase();
    const store = identity && !identity.revoked ? await readMailStore(identity.name).catch(() => null) : null;
    if (store?.accounts.some(({config}) => (config.fromEmail || config.username).trim().toLowerCase() === email)) {
      await removePendingSignup(signup).catch(() => {});
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const [publication, order] = await Promise.all([
        identity && !identity.revoked
          ? fetchIdentityPublication(identity.fingerprint, signup.server, controller.signal).catch(() => null)
          : null,
        signup.orderId
          ? fetchPaymentOrderSnapshot(signup.server, signup.orderId, controller.signal).catch(() => null)
          : null,
      ]);
      if (order?.status === 'cancelled') {
        await removePendingSignup(signup, 'cancelled').catch(() => {});
        return null;
      }
      if (!identity || identity.revoked) {
        return {...signup, action: 'unavailable', reason: identity ? 'Identity revoked' : 'Identity removed from this device'};
      }
      if (publication?.state === 'revoked' || (order?.fingerprint && order.fingerprint !== identity.fingerprint)) {
        return {...signup, action: 'unavailable', reason: publication?.state === 'revoked' ? 'Identity revoked' : 'Original identity is missing'};
      }
      const detail = publication?.state === 'published' ? publication.identity.details.email : undefined;
      const verified = detail?.[0]?.trim().toLowerCase() === email && publication &&
        isEmailVerified({path: 'email', detail: detail[0], proof: detail[1]}, publication);
      const fulfilled = order?.status === 'fulfilled' && order.email?.toLowerCase() === email &&
        order.fingerprint === identity.fingerprint;
      if (verified || fulfilled) {
        return {...signup, action: 'restore'};
      }
      return {...signup, action: 'resume'};
    } finally {
      clearTimeout(timeout);
    }
  }));
  return entries.filter((entry): entry is SignupEntry => entry !== null);
}
