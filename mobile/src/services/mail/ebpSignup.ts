import {randomHex} from '../../ebpCore';
import {apiUrl} from '../contactsLogic';
import {loadIdentity, saveIdentity} from '../storage';
import {getMailPinInMemory, saveMailAccountWithSecrets, selectMailAccount} from './accountStore';
import {
  buildEbpMailAccountRecord,
  buildMailAddress,
  buildSignupRequest,
  parseSignupConfig,
  parseSignupResponse,
  validateMailUsername,
  type EbpSignupConfig,
  type EbpSignupResult,
} from './ebpSignupLogic';

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
    throw new Error(await readError(res));
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
