import {parseAddressList} from "../../../../common/ComposeRecipients.ts";
import {formatMailbox} from "../../../../common/mail/Mailbox.ts";
/**
 * Pure EBP mail helpers (Deno/Jest-testable; no IMAP/SMTP).
 */

export type EbpMailRecipient = {
  email: string;
  contact: string;
};

/** Thrown by sendEbpMail so compose can show it. Encrypted attachments are a later port. */
export const ENCRYPTED_MAIL_ATTACHMENT_ERROR =
  'Attachments on encrypted mail are not supported on mobile yet';

export function rejectEncryptedMailAttachments(
  attachments: readonly unknown[] | undefined,
): void {
  if (attachments && attachments.length > 0) {
    throw new Error(ENCRYPTED_MAIL_ATTACHMENT_ERROR);
  }
}

export function sourceLooksLikeEbpArmor(source: string): boolean {
  return (
    source.includes('-----BEGIN EBP') && source.includes('-----END EBP')
  );
}

export function resolveEbpMailRecipients(params: {
  to?: string;
  recipientContact?: string;
  recipients?: EbpMailRecipient[];
}): EbpMailRecipient[] {
  if (params.recipients && params.recipients.length > 0) {
    return params.recipients;
  }
  if (params.to && params.recipientContact) {
    return [{email: params.to, contact: params.recipientContact}];
  }
  return [];
}

export function ebpMailPlainIntro(includePublicKeys: boolean): string {
  return includePublicKeys
    ? 'This message is encrypted with Even Better Privacy. Open the EBP block below.'
    : 'Encrypted with Even Better Privacy.';
}

export function formatFromHeader(fromName: string, fromEmail: string): string {
  return formatMailbox(fromName, fromEmail);
}

export function resolvePlainMailRecipients(params: {
  to: string;
  recipients?: string[];
}): string[] {
  if (params.recipients && params.recipients.length > 0) {
    return params.recipients;
  }
  const parsed = parseAddressList(params.to);
  if (parsed.some(row => !row.valid)) throw new Error('Invalid mail recipient');
  return parsed.map(row => row.email);
}

export {elevateUnknownSignerVerifyStatus} from '../../../../common/MailAuthenticity.ts';
