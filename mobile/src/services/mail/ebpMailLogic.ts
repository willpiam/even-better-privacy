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
  return `${fromName} <${fromEmail}>`;
}

export function resolvePlainMailRecipients(params: {
  to: string;
  recipients?: string[];
}): string[] {
  if (params.recipients && params.recipients.length > 0) {
    return params.recipients;
  }
  return params.to
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export {elevateUnknownSignerVerifyStatus} from '../../../../core/MailAuthenticity.ts';
