/**
 * Pure EBP mail helpers (Deno/Jest-testable; no IMAP/SMTP).
 */

export type EbpMailRecipient = {
  email: string;
  contact: string;
};

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

/**
 * When crypto verified but signer is not a known contact, elevate verify status.
 */
export function elevateUnknownSignerVerifyStatus(
  verified: boolean | null,
  isKnownContact: boolean,
  verifyStatus: string,
): string {
  if (verified === true && !isKnownContact) {
    if (verifyStatus === 'valid' || verifyStatus === 'valid_unbound') {
      return 'valid_unknown_signer';
    }
  }
  return verifyStatus;
}
