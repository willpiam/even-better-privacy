import {armorPayload, parseEbpPayloadInput} from '../../ebpCore';
import {
  chatPeerAllowed,
  EBP_CHAT_SUBJECT,
  generateMessageId,
} from '../../../../core/ChatChannel';
import {includeSenderAmongRecipients} from '../../../../core/SentMailbox';
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
import {appendSentCopy, fetchMessageDetail} from './imap';
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
  channel?: 'chat';
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachmentPart[];
}): Promise<{savedToSent: boolean}> {
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

  const loaded = [];
  for (const row of recipientRows) {
    loaded.push(await loadContact(row.contact));
  }
  const encryptFor = (params.sign ?? true)
    ? includeSenderAmongRecipients(loaded, identity.summary)
    : loaded;

  let armor: string;
  if (encryptFor.length === 1 && (params.sign ?? true)) {
    const contact = encryptFor[0];
    const ciphertext = identity.signAndEncryptFor(params.message, contact);
    const payload = buildEncryptedSignedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      ciphertext,
      senderIdentity: publicIdentityBlock(identity),
    });
    armor = armorPayload(payload);
  } else if (encryptFor.length === 1) {
    const contact = encryptFor[0];
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
    const encrypted = identity.signAndEncryptForMany(params.message, encryptFor);
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
  const chat = params.channel === 'chat';
  if (chat) {
    if (recipientRows.length !== 1) {
      throw new Error('Chat allows one recipient');
    }
    if (!(params.sign ?? true)) {
      throw new Error('Chat messages are signed');
    }
    if (params.attachments?.length) {
      throw new Error('Chat messages cannot include attachments');
    }
    if (!chatPeerAllowed(fromEmail, recipientRows[0].email)) {
      throw new Error('Chat is only available for addresses on your mail domain');
    }
  }
  const toHeader = recipientRows.map(r => r.email.trim()).join(', ');
  const mime = buildMultipartMimeMessage({
    from: formatFromHeader(fromName, fromEmail),
    to: toHeader,
    subject: chat ? EBP_CHAT_SUBJECT : params.subject,
    plainBody: ebpMailPlainIntro(includePublicKeys),
    ebpArmor: armor,
    channel: chat ? 'chat' : undefined,
    messageId: chat
      ? params.messageId || generateMessageId(fromEmail)
      : params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: chat ? undefined : params.attachments,
  });
  await sendMimeMessage(
    resolved.account.config,
    resolved.secrets,
    mime,
    recipientRows.map(r => r.email.trim()),
  );
  return {savedToSent: await saveSentCopy(resolved.account.config, resolved.secrets, mime)};
}

async function saveSentCopy(
  config: Parameters<typeof appendSentCopy>[0],
  secrets: Parameters<typeof appendSentCopy>[1],
  mime: string,
): Promise<boolean> {
  try {
    await appendSentCopy(config, secrets, mime);
    return true;
  } catch {
    return false;
  }
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
}): Promise<{savedToSent: boolean}> {
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
  return {savedToSent: await saveSentCopy(resolved.account.config, resolved.secrets, mime)};
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
