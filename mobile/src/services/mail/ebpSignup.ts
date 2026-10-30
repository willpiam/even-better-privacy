import {
  Identity,
  MAIL_DELETE_PATH,
  MAIL_PASSWORD_RESET_PATH,
  buildMailDeleteDetail,
  buildMailPasswordResetDetail,
  randomHex,
  sha256Hex,
} from '../../ebpCore';
import {apiUrl} from '../contactsLogic';
import {loadIdentity, saveIdentity} from '../storage';
import {
  deleteMailAccount,
  getMailPinInMemory,
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
  mailboxDeleteConfirmed,
  parseSignupConfig,
  parseSignupResponse,
  parseVerifiedManagedEmail,
  validateMailUsername,
  type EbpSignupConfig,
  type EbpSignupResult,
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

export async function fetchEbpSignupConfig(server: string): Promise<EbpSignupConfig> {
  const res = await fetch(apiUrl(server, '/api/v1/mail/signup/config'));
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
): Promise<{available: boolean; username: string; reason?: string}> {
  const check = validateMailUsername(raw);
  if (!check.ok) {
    return {available: false, username: check.username, reason: check.reason};
  }
  const res = await fetch(
    apiUrl(
      server,
      `/api/v1/mail/username-available?u=${encodeURIComponent(check.username)}`,
    ),
  );
  if (!res.ok) {
    throw new Error(`Username check failed: ${await readError(res)}`);
  }
  const body = (await res.json()) as {available?: boolean; reason?: string};
  return {
    available: body.available === true,
    username: check.username,
    reason: body.reason,
  };
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
  pin?: string;
}): Promise<EbpSignupResult & {accountId: string; mailPassword: string}> {
  if (!params.config.enabled) {
    throw new Error('This key server does not offer EBP email sign-up');
  }
  const check = validateMailUsername(params.username);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  const pin = params.pin || getMailPinInMemory(params.identityName) || params.password;
  const identity = await loadIdentity(params.identityName, params.password);
  const email = buildMailAddress(check.username, params.config.domain);
  identity.attachDetail('email', email);
  const entry = identity.details.get('email');
  if (!entry) {
    throw new Error('Failed to sign email detail');
  }
  const fingerprint = identity.toFingerprint();
  const mailPassword = randomHex(16);

  const res = await fetch(apiUrl(params.server, '/api/v1/mail/signup'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: buildSignupRequest({
      fingerprint,
      username: check.username,
      mailPassword,
      detailProof: entry[1],
    }),
  });
  if (!res.ok) {
    throw new EbpMailApiError(res.status, await readError(res));
  }
  const result = parseSignupResponse(await res.json(), {
    email,
    fingerprint,
    config: params.config,
  });
  await saveIdentity(params.identityName, params.password, identity);

  const accountId = `ebp-${Date.now()}`;
  await saveMailAccountWithSecrets(params.identityName, {
    record: buildEbpMailAccountRecord({id: accountId, result}),
    imapPassword: mailPassword,
    smtpPassword: mailPassword,
    pin,
  });
  await selectMailAccount(params.identityName, accountId);
  return {...result, accountId, mailPassword};
}

/**
 * Decrypt with the password the caller already collected.
 * `unlockSession.ts` does not export `loadIdentityUnlocked`.
 */
async function openIdentity(name: string, password: string): Promise<Identity> {
  return loadIdentity(name, password);
}

/** Sign on a copy so the saved identity's `detailsNonce` is not consumed. */
function signThrowawayDetail(identity: Identity, path: string, detail: string): string {
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
    throw missingMailboxError(domain);
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
  pin: string;
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
    pin: params.pin,
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
  pin?: string;
  accountId?: string;
  fromName?: string;
}): Promise<EbpSignupResult & {accountId: string; mailPassword: string}> {
  if (!params.config.enabled) {
    throw new Error('This key server does not offer EBP email');
  }
  const pin = params.pin || getMailPinInMemory(params.identityName) || params.password;
  const identity = await openIdentity(params.identityName, params.password);
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
  const res = await fetch(apiUrl(params.server, '/api/v1/mail/reset-password'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: buildMailPasswordResetRequest({
      fingerprint: identity.toFingerprint(),
      mailPassword,
      proof,
    }),
  });
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
    pin,
    result,
    mailPassword,
    accountId: params.accountId,
    fromName: params.fromName,
  });
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
