import AsyncStorage from '@react-native-async-storage/async-storage';
import {completeMailboxSignup} from './pendingSignup';
import {
  Identity,
  MAIL_DELETE_PATH,
  MAIL_PASSWORD_RESET_PATH,
  MAIL_PAYMENT_ORDER_PATH,
  MAIL_PAYMENT_RECOVER_PATH,
  buildMailDeleteDetail,
  buildMailPaymentOrderDetail,
  buildMailPasswordResetDetail,
  randomHex,
  sha256Hex,
} from '../../ebpCore';
import {apiUrl} from '../contactsLogic';
import {
  unlockIdentity,
  loadIdentityUnlocked,
  mutateIdentityForUse,
} from '../storage';
import {
  deleteMailAccount,
  getMailSecretsStatus,
  readMailStore,
  saveMailAccountWithSecrets,
  selectMailAccount,
} from './accountStore';
import {
  buildEbpMailAccountRecord,
  buildMailAddress,
  buildMailDeleteRequest,
  buildMailPasswordResetRequest,
  buildSignupRequest,
  MAIL_TEST_MODE_HEADER,
  mailboxDeleteConfirmed,
  managedEmailLookupError,
  parseSignupConfig,
  parseSignupResponse,
  parseTestPaymentAssets,
  parseUsernameAvailability,
  parseVerifiedManagedEmail,
  testCheckoutUrl,
  validateMailUsername,
  type EbpSignupConfig,
  type EbpSignupResult,
  type PaymentAsset,
  type UsernameAvailability,
} from './ebpSignupLogic';

export class EbpMailApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'EbpMailApiError';
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {error?: string};
  return body.error ?? `HTTP ${res.status}`;
}

function testModeInit(testMode: boolean, init: RequestInit = {}): RequestInit {
  if (!testMode) return init;
  const headers = new Headers(init.headers);
  headers.set(MAIL_TEST_MODE_HEADER, 'test');
  return {...init, headers};
}

export async function fetchEbpSignupConfig(
  server: string,
  testMode = false,
): Promise<EbpSignupConfig> {
  const res = await fetch(
    apiUrl(server, '/api/v1/mail/signup/config'),
    testModeInit(testMode),
  );
  if (res.status === 404) {
    return {enabled: false};
  }
  if (!res.ok) {
    throw new Error(`Mail sign-up config failed: ${await readError(res)}`);
  }
  return parseSignupConfig(await res.json());
}

export async function checkEbpUsername(
  server: string,
  raw: string,
  testMode = false,
): Promise<UsernameAvailability> {
  const check = validateMailUsername(raw);
  if (!check.ok) {
    return {available: false, purchasable: false, username: check.username, reason: check.reason};
  }
  const res = await fetch(
    apiUrl(
      server,
      `/api/v1/mail/username-available?u=${encodeURIComponent(check.username)}`,
    ),
    testModeInit(testMode),
  );
  if (!res.ok) {
    throw new Error(`Username check failed: ${await readError(res)}`);
  }
  return parseUsernameAvailability(await res.json(), check.username);
}

export async function fetchTestPaymentAssets(
  server: string,
): Promise<PaymentAsset[]> {
  const res = await fetch(
    apiUrl(server, '/api/v1/mail/payment/config'),
    testModeInit(true),
  );
  if (!res.ok) {
    throw new Error(`Payment config failed: ${await readError(res)}`);
  }
  return parseTestPaymentAssets(await res.json());
}

export type PaymentOrderStatus =
  | 'quoted'
  | 'pending'
  | 'confirmed'
  | 'fulfilled'
  | 'expired'
  | 'manual_review';

function orderStorageKey(server: string, identityName: string, username: string): string {
  return `ebp.mail.order:${server}:${identityName}:${username}`;
}

export async function rememberedPaymentOrder(
  server: string,
  identityName: string,
  username: string,
): Promise<string> {
  return (await AsyncStorage.getItem(orderStorageKey(server, identityName, username))) ?? '';
}

export async function rememberPaymentOrder(
  server: string,
  identityName: string,
  username: string,
  orderId: string | null,
): Promise<void> {
  const key = orderStorageKey(server, identityName, username);
  if (orderId) await AsyncStorage.setItem(key, orderId);
  else await AsyncStorage.removeItem(key);
}

async function signedPaymentProof(
  identityName: string,
  password: string,
  path: string,
  detail: string,
): Promise<{fingerprint: string; proof: string}> {
  const {result} = await mutateIdentityForUse(identityName, password, identity => {
    identity.attachDetail(path, detail);
    const proof = identity.details.get(path)?.[1];
    if (!proof) throw new Error('Failed to sign payment authorization');
    identity.details.delete(path);
    return {fingerprint: identity.toFingerprint(), proof};
  });
  return result;
}

export async function createTestPaymentOrder(params: {
  identityName: string;
  password: string;
  username: string;
  domain: string;
  server: string;
  asset: PaymentAsset;
}): Promise<{orderId: string; checkoutUrl: string}> {
  const check = validateMailUsername(params.username);
  if (!check.ok) throw new Error(check.reason);
  const email = buildMailAddress(check.username, params.domain);
  const signed = await signedPaymentProof(
    params.identityName,
    params.password,
    MAIL_PAYMENT_ORDER_PATH,
    buildMailPaymentOrderDetail(email, params.asset.network, params.asset.symbol),
  );
  const res = await fetch(
    apiUrl(params.server, '/api/v1/mail/payment/order'),
    testModeInit(true, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        fingerprint: signed.fingerprint,
        username: check.username,
        network: params.asset.network,
        asset: params.asset.symbol,
        proof: signed.proof,
      }),
    }),
  );
  const body = (await res.json().catch(() => ({}))) as {orderId?: string; error?: string};
  if (!res.ok || typeof body.orderId !== 'string') {
    throw new EbpMailApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  const checkoutUrl = testCheckoutUrl(params.server, body.orderId);
  if (!checkoutUrl) throw new Error('Checkout is not available for this key server.');
  await rememberPaymentOrder(params.server, params.identityName, check.username, body.orderId);
  return {orderId: body.orderId, checkoutUrl};
}

export async function recoverTestPaymentOrder(params: {
  identityName: string;
  password: string;
  username: string;
  domain: string;
  server: string;
}): Promise<string | null> {
  const check = validateMailUsername(params.username);
  if (!check.ok) throw new Error(check.reason);
  const signed = await signedPaymentProof(
    params.identityName,
    params.password,
    MAIL_PAYMENT_RECOVER_PATH,
    buildMailAddress(check.username, params.domain),
  );
  const res = await fetch(
    apiUrl(params.server, '/api/v1/mail/payment/recover'),
    testModeInit(true, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        fingerprint: signed.fingerprint,
        username: check.username,
        proof: signed.proof,
      }),
    }),
  );
  const body = (await res.json().catch(() => ({}))) as {orderId?: string | null; error?: string};
  if (!res.ok) throw new EbpMailApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return typeof body.orderId === 'string' ? body.orderId : null;
}

export async function fetchPaymentOrderStatus(
  server: string,
  orderId: string,
): Promise<PaymentOrderStatus> {
  const res = await fetch(
    apiUrl(server, '/api/v1/mail/payment/status'),
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({orderId}),
    },
  );
  const body = (await res.json().catch(() => ({}))) as {status?: string; error?: string};
  if (!res.ok || typeof body.status !== 'string') {
    throw new EbpMailApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return body.status as PaymentOrderStatus;
}

/**
 * Sign an `email` detail for `username@domain`, ask the key server to create
 * the mailbox, then persist the detail and a ready-to-use mail account.
 * The identity is only saved after the server accepts, so a rejected signup
 * leaves local state untouched.
 */
export async function signupEbpMailbox(params: {
  identityName: string;
  password: string;
  username: string;
  server: string;
  config: EbpSignupConfig;
  testMode?: boolean;
}): Promise<EbpSignupResult & {accountId: string; mailPassword: string}> {
  if (!params.config.enabled) {
    throw new Error('This key server does not offer EBP email sign-up');
  }
  const check = validateMailUsername(params.username);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  await openIdentity(params.identityName, params.password);
  if ((await getMailSecretsStatus(params.identityName)).locked) {
    throw new Error(
      'Stored mail credentials could not be unlocked with the identity password',
    );
  }
  const email = buildMailAddress(check.username, params.config.domain);
  const mailPassword = randomHex(16);
  const {result} = await mutateIdentityForUse(
    params.identityName,
    undefined,
    async identity => {
      identity.attachDetail('email', email);
      const entry = identity.details.get('email');
      if (!entry) {
        throw new Error('Failed to sign email detail');
      }
      const fingerprint = identity.toFingerprint();

      const res = await fetch(apiUrl(params.server, '/api/v1/mail/signup'), testModeInit(params.testMode === true, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: buildSignupRequest({
          fingerprint,
          username: check.username,
          mailPassword,
          detailProof: entry[1],
        }),
      }));
      if (!res.ok) {
        throw new EbpMailApiError(res.status, await readError(res));
      }
      return parseSignupResponse(await res.json(), {
        email,
        fingerprint,
        config: params.config,
      });
    },
  );

  const accountId = `ebp-${Date.now()}`;
  await saveMailAccountWithSecrets(params.identityName, {
    record: buildEbpMailAccountRecord({id: accountId, result}),
    imapPassword: mailPassword,
    smtpPassword: mailPassword,
  });
  await selectMailAccount(params.identityName, accountId);
  await completeMailboxSignup(params.server, params.identityName, result.email).catch(() => {});
  return {...result, accountId, mailPassword};
}

/**
 * Decrypt with the password the caller already collected.
 * `unlockSession.ts` does not export `loadIdentityUnlocked`.
 */
async function openIdentity(name: string, password: string): Promise<Identity> {
  await unlockIdentity(name, password);
  return loadIdentityUnlocked(name);
}

/** Sign on a copy so the saved identity's `detailsNonce` is not consumed. */
function signThrowawayDetail(
  identity: Identity,
  path: string,
  detail: string,
): string {
  const signer = Identity.fromJSON(identity.toJSON());
  const nonce = identity.detailsNonce;
  signer.attachDetail(path, detail);
  if (identity.detailsNonce !== nonce) {
    throw new Error('Mailbox proof consumed the saved identity nonce');
  }
  const proof = signer.details.get(path)?.[1];
  if (!proof) {
    throw new Error('Failed to sign mailbox proof');
  }
  return proof;
}

function missingMailboxError(domain: string): Error {
  return new Error(
    `this identity has no verified @${domain.toLowerCase()} mailbox on the key server`,
  );
}

/** Verified managed address from `GET /api/v1/identity/:fp`, or throws. */
export async function fetchVerifiedManagedEmail(
  server: string,
  fingerprint: string,
  domain: string,
): Promise<string> {
  const res = await fetch(
    apiUrl(server, `/api/v1/identity/${encodeURIComponent(fingerprint)}`),
  );
  if (!res.ok) {
    throw new Error(managedEmailLookupError(res.status, domain));
  }
  const email = parseVerifiedManagedEmail(await res.json(), domain);
  if (!email) {
    throw missingMailboxError(domain);
  }
  return email;
}

/** Same lookup as {@link fetchVerifiedManagedEmail}, but missing or unreachable is null. */
export async function lookupVerifiedManagedEmail(
  server: string,
  fingerprint: string,
  domain: string,
): Promise<string | null> {
  try {
    return await fetchVerifiedManagedEmail(server, fingerprint, domain);
  } catch {
    return null;
  }
}

async function saveManagedMailboxAccount(params: {
  identityName: string;
  result: EbpSignupResult;
  mailPassword: string;
  accountId?: string;
  fromName?: string;
}): Promise<string> {
  const store = await readMailStore(params.identityName);
  const email = params.result.email.toLowerCase();
  const byId = params.accountId
    ? store.accounts.find(account => account.id === params.accountId)
    : undefined;
  const byEmail = store.accounts.find(
    account => account.config.fromEmail.toLowerCase() === email,
  );
  const existing = byId ?? byEmail;
  const accountId = existing?.id ?? `ebp-${Date.now()}`;
  await saveMailAccountWithSecrets(params.identityName, {
    record: buildEbpMailAccountRecord({
      id: accountId,
      result: params.result,
      fromName: params.fromName ?? existing?.config.fromName,
    }),
    imapPassword: params.mailPassword,
    smtpPassword: params.mailPassword,
  });
  await selectMailAccount(params.identityName, accountId);
  return accountId;
}

/**
 * Set a new mailbox password for the identity's verified managed address and
 * store it locally. The reset proof is signed on a clone and is not saved.
 */
export async function resetEbpMailbox(params: {
  identityName: string;
  password: string;
  server: string;
  config: EbpSignupConfig;
  accountId?: string;
  fromName?: string;
}): Promise<EbpSignupResult & {accountId: string; mailPassword: string}> {
  if (!params.config.enabled) {
    throw new Error('This key server does not offer EBP email');
  }
  const identity = await openIdentity(params.identityName, params.password);
  if ((await getMailSecretsStatus(params.identityName)).locked) {
    throw new Error(
      'Stored mail credentials could not be unlocked with the identity password',
    );
  }
  const email = await fetchVerifiedManagedEmail(
    params.server,
    identity.toFingerprint(),
    params.config.domain,
  );
  const mailPassword = randomHex(16);
  const proof = signThrowawayDetail(
    identity,
    MAIL_PASSWORD_RESET_PATH,
    buildMailPasswordResetDetail(email, sha256Hex(mailPassword)),
  );
  const res = await fetch(
    apiUrl(params.server, '/api/v1/mail/reset-password'),
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: buildMailPasswordResetRequest({
        fingerprint: identity.toFingerprint(),
        mailPassword,
        proof,
      }),
    },
  );
  if (!res.ok) {
    throw new EbpMailApiError(res.status, await readError(res));
  }
  const result = parseSignupResponse(await res.json(), {
    email,
    fingerprint: identity.toFingerprint(),
    config: params.config,
  });
  const accountId = await saveManagedMailboxAccount({
    identityName: params.identityName,
    result,
    mailPassword,
    accountId: params.accountId,
    fromName: params.fromName,
  });
  await completeMailboxSignup(params.server, params.identityName, result.email).catch(() => {});
  return {...result, accountId, mailPassword};
}

async function deleteLocalMailboxAccounts(
  identityName: string,
  email: string,
): Promise<void> {
  const store = await readMailStore(identityName);
  const target = email.toLowerCase();
  const ids = store.accounts
    .filter(account => account.config.fromEmail.toLowerCase() === target)
    .map(account => account.id);
  for (const id of ids) {
    await deleteMailAccount(identityName, id);
  }
}

/**
 * Revoke the managed mailbox on the key server, then remove the matching
 * local mail account. The delete proof is signed on a clone and is not saved.
 */
export async function deleteEbpMailbox(params: {
  identityName: string;
  password: string;
  server: string;
  confirm: string;
}): Promise<{email: string}> {
  const config = await fetchEbpSignupConfig(params.server);
  if (!config.enabled) {
    throw new Error('This key server does not offer EBP email');
  }
  const identity = await openIdentity(params.identityName, params.password);
  const email = await fetchVerifiedManagedEmail(
    params.server,
    identity.toFingerprint(),
    config.domain,
  );
  if (!mailboxDeleteConfirmed(email, params.confirm)) {
    throw new Error(`Type ${email} to confirm`);
  }
  const proof = signThrowawayDetail(
    identity,
    MAIL_DELETE_PATH,
    buildMailDeleteDetail(email),
  );
  const res = await fetch(apiUrl(params.server, '/api/v1/mail/delete'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: buildMailDeleteRequest({
      fingerprint: identity.toFingerprint(),
      proof,
    }),
  });
  if (!res.ok) {
    throw new EbpMailApiError(res.status, await readError(res));
  }
  await deleteLocalMailboxAccounts(params.identityName, email);
  return {email};
}
