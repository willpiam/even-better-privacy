import type {ExternalIdentity} from '../../ebpCore';
export type MailCryptoRequest = {
  identityName: string;
  contacts: ExternalIdentity[];
  message: string;
  sign: boolean;
  includePublicKeys: boolean;
};
export type MailCryptoResult = {
  armor: string;
  fingerprint: string;
  shortFingerprint: string;
};
export type MailCryptoInput = Omit<MailCryptoRequest, 'identityName'> & {
  raw: string;
  key: number[];
};
