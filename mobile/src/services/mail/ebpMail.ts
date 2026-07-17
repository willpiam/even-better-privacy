import {armorPayload, parseEbpPayloadInput} from '../../ebpCore';
import {decryptMessage, encryptMessage} from '../encryptDecrypt';
import {loadContact} from '../contacts';
import {loadIdentity} from '../storage';
import {getMailIncludePublicKeys} from '../settings';
import {resolveSelectedAccount} from './accountStore';
import {fetchMessageDetail} from './imap';
import {buildMultipartMimeMessage, buildSimpleMimeMessage} from './mime';
import {sendMimeMessage} from './smtp';

export async function sendEbpMail(params: {
  identityName: string;
  password: string;
  to: string;
  subject: string;
  message: string;
  recipientContact: string;
  sign?: boolean;
}): Promise<void> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const identity = await loadIdentity(params.identityName, params.password);
  await loadContact(params.recipientContact);
  const includePublicKeys = await getMailIncludePublicKeys();
  const encrypted = await encryptMessage({
    identityName: params.identityName,
    password: params.password,
    message: params.message,
    recipient: params.recipientContact,
    sign: params.sign ?? true,
  });
  const armor = armorPayload(encrypted);
  const fromName = resolved.account.config.fromName || identity.toFingerprint().slice(0, 12);
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const mime = buildMultipartMimeMessage({
    from: `${fromName} <${fromEmail}>`,
    to: params.to,
    subject: params.subject,
    plainBody: includePublicKeys
      ? 'This message is encrypted with Even Better Privacy. Open the EBP block below.'
      : 'Encrypted with Even Better Privacy.',
    ebpArmor: armor,
  });
  await sendMimeMessage(resolved.account.config, resolved.secrets, mime);
}

/** Send a plaintext (non-EBP) MIME message via the selected mail account. */
export async function sendPlainMail(params: {
  identityName: string;
  to: string;
  subject: string;
  message: string;
}): Promise<void> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const fromEmail =
    resolved.account.config.fromEmail || resolved.account.config.username;
  const fromName = resolved.account.config.fromName || fromEmail;
  const mime = buildSimpleMimeMessage({
    from: `${fromName} <${fromEmail}>`,
    to: params.to,
    subject: params.subject,
    body: params.message,
  });
  await sendMimeMessage(resolved.account.config, resolved.secrets, mime);
}

export async function decryptMailBody(params: {
  identityName: string;
  password: string;
  uid: number;
}): Promise<{plaintext: string; verified: boolean}> {
  const resolved = await resolveSelectedAccount(params.identityName);
  if (!resolved) {
    throw new Error('No mail account configured');
  }
  const detail = await fetchMessageDetail(
    resolved.account.config,
    resolved.secrets,
    params.uid,
  );
  if (!detail.ebpPayload) {
    throw new Error('No EBP payload in message');
  }
  const payload = parseEbpPayloadInput(detail.ebpPayload);
  const result = await decryptMessage({
    identityName: params.identityName,
    password: params.password,
    payload,
  });
  return {
    plaintext: result.message,
    verified: result.verified ?? false,
  };
}
