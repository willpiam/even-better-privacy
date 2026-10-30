import {armorPayload, parseEbpPayloadInput} from '../../ebpCore';
import {
  buildEncryptedSignedMessageMultiPayload,
  buildEncryptedSignedMessagePayload,
  buildEncryptedMessagePayload,
  Identity,
} from '../../ebpCore';
import {decryptMessage} from '../encryptDecrypt';
import {publicIdentityBlock} from '../encryptDecryptLogic';
import {listContacts, getDetailValue, loadContact} from '../contacts';
import {loadIdentityForUse} from '../storage';
import {getMailIncludePublicKeys, getServerUrl} from '../settings';
import {resolveSelectedAccount} from './accountStore';
import {fetchMessageDetail} from './imap';
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

export async function sendEbpMail(params: {
  identityName: string;
  password?: string;
  to?: string;
  subject: string;
  message: string;
  recipientContact?: string;
  /** Multi-recipient: each row needs email + contact name. */
  recipients?: EbpMailRecipient[];
  sign?: boolean;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachmentPart[];
}): Promise<void> {
  rejectEncryptedMailAttachments(params.attachments);
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const identity = await loadIdentityForUse(params.identityName, params.password);
  const includePublicKeys = await getMailIncludePublicKeys();
  const recipientRows = resolveEbpMailRecipients(params);
  if (recipientRows.length === 0) {
    throw new Error('At least one EBP recipient is required');
  }

  let armor: string;
  if (recipientRows.length === 1 && (params.sign ?? true)) {
    const contact = await loadContact(recipientRows[0].contact);
    const ciphertext = identity.signAndEncryptFor(params.message, contact);
    const payload = buildEncryptedSignedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      ciphertext,
      senderIdentity: publicIdentityBlock(identity),
    });
    armor = armorPayload(payload);
  } else if (recipientRows.length === 1) {
    const contact = await loadContact(recipientRows[0].contact);
    const ciphertext = Identity.EncryptFor(contact, params.message);
    const payload = buildEncryptedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      ciphertext,
    });
    armor = armorPayload(payload);
  } else {
    if (!(params.sign ?? true)) {
      throw new Error('Multi-recipient EBP mail requires signing');
    }
    const contacts = [];
    for (const row of recipientRows) {
      contacts.push(await loadContact(row.contact));
    }
    const encrypted = identity.signAndEncryptForMany(params.message, contacts);
    const payload = buildEncryptedSignedMessageMultiPayload({
      senderFingerprint: identity.toFingerprint(),
      recipients: encrypted.recipients,
      contentNonce: encrypted.contentNonce,
      ciphertext: encrypted.ciphertext,
      senderIdentity: publicIdentityBlock(identity),
    });
    armor = armorPayload(payload);
  }

  const fromName = resolved.account.config.fromName || identity.toShortFingerprint();
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const toHeader = recipientRows.map(r => r.email.trim()).join(', ');
  const mime = buildMultipartMimeMessage({
    from: formatFromHeader(fromName, fromEmail),
    to: toHeader,
    subject: params.subject,
    plainBody: ebpMailPlainIntro(includePublicKeys),
    ebpArmor: armor,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });
  await sendMimeMessage(
    resolved.account.config,
    resolved.secrets,
    mime,
    recipientRows.map(r => r.email.trim()),
  );
}

/** Send a plaintext (non-EBP) MIME message via the selected mail account. */
export async function sendPlainMail(params: {
  identityName: string;
  to: string;
  subject: string;
  message: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachmentPart[];
  recipients?: string[];
}): Promise<void> {
  const resolved = await resolveSelectedAccount(params.identityName);
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
  await sendMimeMessage(
    resolved.account.config,
    resolved.secrets,
    mime,
    rcpts,
  );
}

export async function decryptMailBody(params: {
  identityName: string;
  password?: string;
  uid: number;
  folder?: string;
}): Promise<MailAuthenticitySummary> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const detail = await fetchMessageDetail(
    resolved.account.config,
    resolved.secrets,
    params.uid,
    params.folder ?? 'INBOX',
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
