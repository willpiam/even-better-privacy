import {encryptMailBody} from './mailCrypto';
import type {MailCryptoRequest, MailCryptoResult} from './mailCryptoTypes';
import {parseEbpPayloadInput} from '../../ebpCore';
import {decryptMessage} from '../encryptDecrypt';
import {listContacts, getDetailValue, loadContact} from '../contacts';
import {loadIdentityForUse} from '../storage';
import {getMailIncludePublicKeys, getServerUrl} from '../settings';
import {resolveSelectedAccount} from './accountStore';
import {appendSentCopy} from './imap';
import {loadMailMessage} from './mailData';
import {
  buildMultipartMimeMessage,
  buildSimpleMimeMessage,
  type MailAttachmentPart,
} from './mime';
import {sendMimeMessage} from './smtp';
import {
  getDetailMeta,
  matchFromToIdentity,
  type MailAuthenticitySummary,
  type MailVerifyStatus,
} from './mailAuthenticity';
import {
  ebpMailPlainIntro,
  elevateUnknownSignerVerifyStatus,
  formatFromHeader,
  rejectEncryptedMailAttachments,
  resolveEbpMailRecipients,
  resolvePlainMailRecipients,
  sourceLooksLikeEbpArmor,
  type EbpMailRecipient,
} from './ebpMailLogic';

export type {MailAuthenticitySummary, EbpMailRecipient};
export {
  ebpMailPlainIntro,
  elevateUnknownSignerVerifyStatus,
  formatFromHeader,
  resolveEbpMailRecipients,
  resolvePlainMailRecipients,
  sourceLooksLikeEbpArmor,
} from './ebpMailLogic';

export type SendProgress = 'preparing' | 'encrypting' | 'sending' | 'saving';
export type SendResult = {
  savedToSent: boolean;
  retrySentCopy?: () => Promise<void>;
};
type SendOptions = {
  accountId?: string;
  onProgress?: (stage: SendProgress) => void;
  encrypt?: (request: MailCryptoRequest) => Promise<MailCryptoResult>;
};

export async function sendEbpMail(
  params: {
    identityName: string;
    password?: string;
    to?: string;
    subject: string;
    message: string;
    recipientContact?: string;
    /** Multi-recipient: each row needs email + contact name. */
    recipients?: EbpMailRecipient[];
    sign?: boolean;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: MailAttachmentPart[];
  } & SendOptions,
): Promise<SendResult> {
  rejectEncryptedMailAttachments(params.attachments);
  const resolved = await resolveSelectedAccount(
    params.identityName,
    params.accountId,
  );
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const includePublicKeys = await getMailIncludePublicKeys();
  const recipientRows = resolveEbpMailRecipients(params);
  if (recipientRows.length === 0) {
    throw new Error('At least one EBP recipient is required');
  }

  const loaded = [];
  for (const row of recipientRows) {
    loaded.push(await loadContact(row.contact));
  }
  params.onProgress?.('encrypting');
  const encrypted = params.encrypt
    ? await params.encrypt({
        identityName: params.identityName,
        contacts: loaded,
        message: params.message,
        sign: params.sign ?? true,
        includePublicKeys,
      })
    : encryptMailBody(
        await loadIdentityForUse(params.identityName, params.password),
        loaded,
        params.message,
        params.sign ?? true,
        includePublicKeys,
      );
  const fromName =
    resolved.account.config.fromName || encrypted.shortFingerprint;
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const toHeader = recipientRows.map(r => r.email.trim()).join(', ');
  const mime = buildMultipartMimeMessage({
    from: formatFromHeader(fromName, fromEmail),
    to: toHeader,
    subject: params.subject,
    plainBody: ebpMailPlainIntro(includePublicKeys),
    ebpArmor: encrypted.armor,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });
  params.onProgress?.('sending');
  await sendMimeMessage(
    resolved.account.config,
    resolved.secrets,
    mime,
    recipientRows.map(r => r.email.trim()),
  );
  params.onProgress?.('saving');
  return saveSentCopy(
    resolved.account.config,
    resolved.secrets,
    mime,
    params.identityName,
    resolved.account.id,
  );
}

async function saveSentCopy(
  config: Parameters<typeof appendSentCopy>[0],
  secrets: Parameters<typeof appendSentCopy>[1],
  mime: string,
  identityName: string,
  accountId: string,
): Promise<SendResult> {
  try {
    await appendSentCopy(config, secrets, mime);
    return {savedToSent: true};
  } catch {
    return {
      savedToSent: false,
      retrySentCopy: makeSentRetry(config, mime, identityName, accountId),
    };
  }
}

// Keep passwords out of the retained retry closure and pin the original account.
function makeSentRetry(
  config: Parameters<typeof appendSentCopy>[0],
  mime: string,
  identityName: string,
  accountId: string,
) {
  return async () => {
    const account = await resolveSelectedAccount(identityName, accountId);
    if (!account) throw new Error('The original mail account was removed.');
    const current = account.account.config;
    if (
      current.imapHost !== config.imapHost ||
      current.imapPort !== config.imapPort ||
      current.imapSecure !== config.imapSecure ||
      current.username !== config.username
    ) {
      throw new Error(
        'The original mail account settings changed. This Sent copy cannot be retried.',
      );
    }
    await appendSentCopy(current, account.secrets, mime);
  };
}

/** Send a plaintext (non-EBP) MIME message via the selected mail account. */
export async function sendPlainMail(
  params: {
    identityName: string;
    to: string;
    subject: string;
    message: string;
    inReplyTo?: string;
    references?: string;
    attachments?: MailAttachmentPart[];
    recipients?: string[];
  } & SendOptions,
): Promise<SendResult> {
  const resolved = await resolveSelectedAccount(
    params.identityName,
    params.accountId,
  );
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const fromName = resolved.account.config.fromName || fromEmail;
  const rcpts = resolvePlainMailRecipients(params);
  const mime = buildSimpleMimeMessage({
    from: formatFromHeader(fromName, fromEmail),
    to: rcpts.join(', '),
    subject: params.subject,
    body: params.message,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });
  params.onProgress?.('sending');
  await sendMimeMessage(resolved.account.config, resolved.secrets, mime, rcpts);
  params.onProgress?.('saving');
  return saveSentCopy(
    resolved.account.config,
    resolved.secrets,
    mime,
    params.identityName,
    resolved.account.id,
  );
}

export async function decryptMailBody(params: {
  identityName: string;
  password?: string;
  uid: number;
  folder?: string;
  uidValidity?: number;
  accountId?: string;
}): Promise<MailAuthenticitySummary> {
  const resolved = await resolveSelectedAccount(params.identityName, params.accountId);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const detail = await loadMailMessage(
    params.identityName,
    resolved,
    params.uid,
    params.folder ?? 'INBOX',
    params.uidValidity,
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

  let verifyStatus: MailVerifyStatus = elevateUnknownSignerVerifyStatus(
    result.verified,
    result.isKnownContact,
    result.verifyStatus,
  ) as MailVerifyStatus;

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

    if (result.verified && !result.isKnownContact && result.signerFingerprint) {
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
