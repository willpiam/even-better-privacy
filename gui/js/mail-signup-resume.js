const PREFIX = "ebp.mail.signup:";
const COMPLETED_PREFIX = "ebp.mail.signup.completed:";

export function signupStorageKey({server, domain, identityName, username}) {
  return PREFIX + JSON.stringify([server, domain, identityName, username]);
}

// Only public setup metadata belongs here. Passwords and recovery phrases
// remain in memory; the encrypted identity is already saved before checkout.
export function savePendingSignup(storage, signup) {
  const {server, domain, identityName, username, orderId} = signup;
  storage.setItem(signupStorageKey(signup), JSON.stringify({
    server, domain, identityName, username, orderId,
  }));
  storage.removeItem(COMPLETED_PREFIX + signupStorageKey(signup));
}

export function pendingSignups(storage, server, domain) {
  const found = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const value = JSON.parse(storage.getItem(key));
      if (value.server === server && value.domain === domain &&
          typeof value.identityName === "string" && value.identityName &&
          typeof value.username === "string" && value.username &&
          typeof value.orderId === "string") {
        found.set(signupStorageKey(value), value);
      }
    } catch { /* Ignore a damaged record without hiding other pending orders. */ }
  }
  // Orders saved by older versions also need a route back into setup.
  const legacyPrefix = `ebp.mail.order:${server}:`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(legacyPrefix)) continue;
    const suffix = key.slice(legacyPrefix.length);
    const split = suffix.lastIndexOf(":");
    const orderId = storage.getItem(key);
    if (split < 1 || !orderId) continue;
    const value = {server, domain, identityName: suffix.slice(0, split), username: suffix.slice(split + 1), orderId};
    if (value.username) found.set(signupStorageKey(value), found.get(signupStorageKey(value)) ?? value);
  }
  return [...found.values()].filter(signup => storage.getItem(COMPLETED_PREFIX + signupStorageKey(signup)) !== '1');
}

export function removePendingSignup(storage, signup) {
  storage.setItem(COMPLETED_PREFIX + signupStorageKey(signup), '1');
  try {
    storage.removeItem(signupStorageKey(signup));
    storage.removeItem(`ebp.mail.order:${signup.server}:${signup.identityName}:${signup.username}`);
  } catch { /* The completion marker suppresses leftover records. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ebp-mail-signup-completed'));
}

export function completeMailboxSignup(storage, server, identityName, email) {
  const [username, domain] = email.toLowerCase().split('@');
  removePendingSignup(storage, {server, domain, identityName, username, orderId: ''});
}
