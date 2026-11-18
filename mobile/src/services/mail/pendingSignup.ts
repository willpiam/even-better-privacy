import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'ebp.mail.signup:';
const COMPLETED_PREFIX = 'ebp.mail.signup.completed:';
export type PendingSignup = {
  server: string;
  domain: string;
  identityName: string;
  username: string;
  orderId: string;
  testMode: boolean;
};

function storageKey(signup: PendingSignup): string {
  return PREFIX + JSON.stringify([signup.server, signup.domain, signup.identityName, signup.username, signup.testMode]);
}

function completedKey(signup: PendingSignup): string {
  return COMPLETED_PREFIX + storageKey(signup);
}

export async function savePendingSignup(signup: PendingSignup): Promise<void> {
  // Explicitly whitelist public metadata: never persist passwords or mnemonics.
  const {server, domain, identityName, username, orderId, testMode} = signup;
  await AsyncStorage.setItem(storageKey(signup), JSON.stringify({
    server, domain, identityName, username, orderId, testMode,
  }));
  await AsyncStorage.removeItem(completedKey(signup));
}

export async function pendingSignups(server: string, domain: string | undefined, testMode: boolean): Promise<PendingSignup[]> {
  const keys = await AsyncStorage.getAllKeys();
  const legacyPrefix = `ebp.mail.order:${server}:`;
  const entries = await AsyncStorage.multiGet(keys.filter(key =>
    key.startsWith(PREFIX) || (testMode && key.startsWith(legacyPrefix)),
  ));
  const found = new Map<string, PendingSignup>();
  for (const [key, raw] of entries) {
    if (!key.startsWith(PREFIX) || !raw) continue;
    try {
      const value = JSON.parse(raw) as PendingSignup;
      if (value.server === server && typeof value.domain === 'string' && value.domain &&
          (domain === undefined || value.domain === domain) && value.testMode === testMode &&
          typeof value.identityName === 'string' && value.identityName &&
          typeof value.username === 'string' && value.username && typeof value.orderId === 'string') {
        found.set(storageKey(value), value);
      }
    } catch { /* A damaged record must not hide other pending orders. */ }
  }
  for (const [key, orderId] of entries) {
    if (!key.startsWith(legacyPrefix) || !orderId) continue;
    const suffix = key.slice(legacyPrefix.length);
    const split = suffix.lastIndexOf(':');
    if (split < 1) continue;
    const value = {server, domain: domain ?? 'test.pqpost.com', testMode, identityName: suffix.slice(0, split), username: suffix.slice(split + 1), orderId};
    if (value.username && !found.has(storageKey(value))) found.set(storageKey(value), value);
  }
  const active: PendingSignup[] = [];
  for (const signup of found.values()) {
    const marker = await AsyncStorage.getItem(completedKey(signup));
    if (marker !== '1' && marker !== 'cancelled' && marker !== 'dismissed') active.push(signup);
  }
  return active;
}

export async function removePendingSignup(
  signup: PendingSignup,
  reason: 'completed' | 'cancelled' | 'dismissed' = 'completed',
): Promise<void> {
  // Record completion first so a failed delete cannot resurrect a completed
  // signup through either the new record or the legacy order fallback.
  await AsyncStorage.setItem(completedKey(signup), reason === 'completed' ? '1' : reason);
  await AsyncStorage.multiRemove([
    storageKey(signup),
    `ebp.mail.order:${signup.server}:${signup.identityName}:${signup.username}`,
  ]).catch(() => {});
}

export async function completeMailboxSignup(server: string, identityName: string, email: string): Promise<void> {
  const [username, domain] = email.toLowerCase().split('@');
  await removePendingSignup({server, identityName, username, domain, orderId: '', testMode: domain === 'test.pqpost.com'});
}
