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
} from '../../../../common/MailAuthenticity.ts';
export type {
  AuthenticityBadgeKind,
  AuthenticityContact,
  MailAuthenticityFields,
  MailAuthenticitySummary,
  MailVerifyStatus,
  MatchedEmailPath,
} from '../../../../common/MailAuthenticity.ts';
