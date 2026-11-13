
export type MailAuthSecrets = {
  imapPassword: string;
  smtpPassword: string;
};

export type MailAccountConfig = {
  authType: 'password';
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
  to: string;
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
  authType: 'password',
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
