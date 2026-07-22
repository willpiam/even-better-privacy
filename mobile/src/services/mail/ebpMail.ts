import {armorPayload, parseEbpPayloadInput} from '../../ebpCore';
import {decryptMessage, encryptMessage} from '../encryptDecrypt';
import {listContacts, getDetailValue} from '../contacts';
import {loadIdentity} from '../storage';
import {getMailIncludePublicKeys, getServerUrl} from '../settings';
import {resolveSelectedAccount} from './accountStore';
import {fetchMessageDetail} from './imap';
import {buildMultipartMimeMessage, buildSimpleMimeMessage} from './mime';
import {sendMimeMessage} from './smtp';
import {
  getDetailMeta,
  matchFromToIdentity,
  type MailAuthenticitySummary,
  type MailVerifyStatus,
} from './mailAuthenticity';

export type {MailAuthenticitySummary};

export async function sendEbpMail(params: {
  identityName: string;
  password: string;
  to: string;
  subject: string;
  message: string;
  recipientContact: string;
  sign?: boolean;
  inReplyTo?: string;
  references?: string;
}): Promise<void> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const identity = await loadIdentity(params.identityName, params.password);
  const includePublicKeys = await getMailIncludePublicKeys();
  const encrypted = await encryptMessage({
    identityName: params.identityName,
    password: params.password,
    message: params.message,
    recipient: params.recipientContact,
    sign: params.sign ?? true,
  });
  const armor = armorPayload(encrypted);
  const fromName = resolved.account.config.fromName || identity.toFingerprint().slice(0, 12);
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const mime = buildMultipartMimeMessage({
    from: `${fromName} <${fromEmail}>`,
    to: params.to,
    subject: params.subject,
    plainBody: includePublicKeys
      ? 'This message is encrypted with Even Better Privacy. Open the EBP block below.'
      : 'Encrypted with Even Better Privacy.',
    ebpArmor: armor,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  await sendMimeMessage(resolved.account.config, resolved.secrets, mime);
}

/** Send a plaintext (non-EBP) MIME message via the selected mail account. */
export async function sendPlainMail(params: {
  identityName: string;
  to: string;
  subject: string;
  message: string;
  inReplyTo?: string;
  references?: string;
}): Promise<void> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const fromName = resolved.account.config.fromName || fromEmail;
  const mime = buildSimpleMimeMessage({
    from: `${fromName} <${fromEmail}>`,
    to: params.to,
    subject: params.subject,
    body: params.message,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  await sendMimeMessage(resolved.account.config, resolved.secrets, mime);
}

function sourceLooksLikeEbpArmor(source: string): boolean {
  return (
    source.includes('-----BEGIN EBP') && source.includes('-----END EBP')
  );
}

export async function decryptMailBody(params: {
  identityName: string;
  password: string;
  uid: number;
}): Promise<MailAuthenticitySummary> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const detail = await fetchMessageDetail(
    resolved.account.config,
    resolved.secrets,
    params.uid,
  );
  if (!detail.ebpPayload) {
    if (
      sourceLooksLikeEbpArmor(detail.rawSource) ||
      sourceLooksLikeEbpArmor(detail.bodyText) ||
      sourceLooksLikeEbpArmor(detail.bodyHtml)
    ) {
      throw new Error(
        'Could not parse EBP armor (message may need MIME decode)',
      );
    }
    throw new Error('No EBP payload in message');
  }
  const payload = parseEbpPayloadInput(detail.ebpPayload);
  const result = await decryptMessage({
    identityName: params.identityName,
    password: params.password,
    payload,
  });

  let verifyStatus: MailVerifyStatus = result.verifyStatus;
  if (result.verified === true && !result.isKnownContact) {
    if (result.verifyStatus === 'valid' || result.verifyStatus === 'valid_unbound') {
      verifyStatus = 'valid_unknown_signer';
    }
  }

  const messageFrom = detail.from ?? '';
  let signerEmail: string | null = null;
  let opaqueEmailMatched = false;
  let matchedEmailPath: 'email' | 'opaque::email' | null = null;
  let signerEmailVerified: boolean | null = null;
  let signerMatchesSenderEmail: boolean | null = null;
  let serverIdentityMatch: boolean | null = null;
  let contactName: string | null = null;

  if (result.contact) {
    const match = matchFromToIdentity(result.contact, messageFrom);
    signerEmail = match.signerEmail;
    opaqueEmailMatched = match.opaqueEmailMatched;
    matchedEmailPath = match.matchedPath;
    signerMatchesSenderEmail = match.matches;
    if (match.matchedPath) {
      const meta = getDetailMeta(result.contact.detailsMeta, match.matchedPath);
      signerEmailVerified = meta ? meta.verified : false;
    } else if (
      getDetailValue(result.contact.details, 'email') ||
      getDetailValue(result.contact.details, 'opaque::email')
    ) {
      // Has a claim but it did not match From
      const emailMeta = getDetailMeta(result.contact.detailsMeta, 'email');
      const opaqueMeta = getDetailMeta(
        result.contact.detailsMeta,
        'opaque::email',
      );
      if (emailMeta || opaqueMeta) {
        signerEmailVerified = Boolean(
          emailMeta?.verified || opaqueMeta?.verified,
        );
      }
    }

    if (result.isKnownContact && result.signerFingerprint) {
      const contacts = await listContacts();
      const named = contacts.find(
        c => c.contact.fingerprint === result.signerFingerprint,
      );
      contactName = named?.name ?? null;
    }

    if (
      result.verified &&
      !result.isKnownContact &&
      result.signerFingerprint
    ) {
      try {
        const server = await getServerUrl();
        const res = await fetch(
          `${server.replace(/\/+$/, '')}/api/v1/identity/${encodeURIComponent(
            result.signerFingerprint,
          )}`,
        );
        if (res.ok) {
          const body = (await res.json()) as {
            fingerprint?: string;
            signingKey?: string;
            encryptionKey?: string;
            detailsMeta?: Record<
              string,
              {verified: boolean; verifiedAt: number | null}
            >;
          };
          serverIdentityMatch =
            body.fingerprint === result.contact.fingerprint &&
            body.signingKey === result.contact.signingKey &&
            body.encryptionKey === result.contact.encryptionKey;
          if (body.detailsMeta && match.matchedPath) {
            const serverMeta = body.detailsMeta[match.matchedPath];
            if (serverMeta && typeof serverMeta.verified === 'boolean') {
              signerEmailVerified = serverMeta.verified;
            }
          }
        } else {
          serverIdentityMatch = false;
        }
      } catch {
        serverIdentityMatch = false;
      }
    }
  }

  return {
    plaintext: result.message,
    verified: result.verified,
    verifyStatus,
    signerFingerprint: result.signerFingerprint,
    contactName,
    isKnownContact: result.isKnownContact,
    signerEmail,
    opaqueEmailMatched,
    matchedEmailPath,
    signerEmailVerified,
    signerMatchesSenderEmail,
    serverIdentityMatch,
    messageFrom,
  };
}
