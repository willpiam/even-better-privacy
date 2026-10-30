export {
  badgeLabel,
  buildMailAuthenticityFields,
  deriveBadgeKind,
  elevateUnknownSignerVerifyStatus,
  extractEmailAddress,
  getDetailMeta,
  matchFromToIdentity,
  normalizeEmail,
  resolveSignerEmailClaim,
} from '../../../../core/MailAuthenticity.ts';
export type {
  AuthenticityBadgeKind,
  AuthenticityContact,
  MailAuthenticityFields,
  MailAuthenticitySummary,
  MailVerifyStatus,
  MatchedEmailPath,
} from '../../../../core/MailAuthenticity.ts';
