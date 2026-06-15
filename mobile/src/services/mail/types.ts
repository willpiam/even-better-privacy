export type MailAuthType = 'oauth' | 'password';
export type MailOauthProvider = 'gmail' | 'outlook' | '';

export type MailAuthSecrets = {
  imapPassword: string;
  smtpPassword: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
};

export type MailAccountConfig = {
  gmailMode: boolean;
  authType: MailAuthType;
  oauthProvider: MailOauthProvider;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
  persistSecrets: boolean;
};

export type MailAccountRecord = {
  id: string;
  name: string;
  config: MailAccountConfig;
  createdAt: number;
  updatedAt: number;
};

export type MailAccountStore = {
  selectedAccountId: string | null;
  accounts: MailAccountRecord[];
};

export type MailMessageSummary = {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
};

export type MailMessageDetail = {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  rawSource: string;
  ebpPayload: string | null;
};

export const DEFAULT_MAIL_ACCOUNT: MailAccountConfig = {
  gmailMode: false,
  authType: 'password',
  oauthProvider: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  username: '',
  fromEmail: '',
  fromName: '',
  persistSecrets: false,
};

export const MAIL_OAUTH_REDIRECT_URI = 'ebp://mail/oauth/callback';
