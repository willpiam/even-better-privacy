import {Buffer} from 'buffer';
import {splitMailboxList, formatMailbox} from '../../../../common/mail/Mailbox.ts';
export {MAX_MIME_DEPTH, MAX_MIME_ENTITIES, decodeTransferEncoding, collectDecodedTextParts, extractTextFromMimeSource, extractEbpPayloadFromMime, parseMimeMessage} from '../../../../common/mail/Mime.ts';
function headerValue(value: string, name: string): string {
  // Header metadata must never introduce a new line or other controls.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) {
    throw new Error(`${name} contains invalid control characters`);
  }
  return value;
}

function encodedWord(value: string): string {
  headerValue(value, 'Header');
  if (!/[^\x00-\x7f]/.test(value)) return value;
  const words: string[] = []; let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`); chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  return words.join('\r\n ');
}
function mailboxHeader(value: string): string {
  headerValue(value, 'Mailbox');
  return splitMailboxList(value).filter(part => part.trim()).map(part => {
    const angle = /^(.*)<([^<>]+)>\s*$/.exec(part.trim());
    if (!angle) {
      if (/[^\x00-\x7f]/.test(part)) throw new Error('Non-ASCII email addresses require SMTPUTF8');
      return part.trim();
    }
    const email = angle[2].trim();
    if (/[^\x00-\x7f]/.test(email)) throw new Error('Non-ASCII email addresses require SMTPUTF8');
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1');
    return /[^\x00-\x7f]/.test(name) ? `${encodedWord(name)} <${email}>` : formatMailbox(name, email);
  }).join(', ');
}
function textPart(body: string): {encoding: string; body: string} {
  return /[^\x00-\x7f]/.test(body)
    ? {encoding: 'base64', body: Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''}
    : {encoding: '7bit', body};
}

function formatMessageId(value: string | null | undefined): string {
  const trimmed = headerValue(value ?? '', 'Message-ID').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, '')}>`;
}

function threadingHeaders(params: {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}): string[] {
  const headers: string[] = [];
  const messageId = formatMessageId(params.messageId);
  if (messageId) {
    headers.push(`Message-ID: ${messageId}`);
  }
  const inReplyTo = headerValue(params.inReplyTo ?? '', 'In-Reply-To').trim();
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  const references = headerValue(params.references ?? '', 'References').trim();
  if (references) {
    headers.push(`References: ${references}`);
  }
  return headers;
}

export function buildSimpleMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachmentPart[];
}): string {
  if (params.attachments && params.attachments.length > 0) {
    return buildMultipartMimeMessage({
      from: params.from,
      to: params.to,
      subject: params.subject,
      plainBody: params.body,
      messageId: params.messageId,
      inReplyTo: params.inReplyTo,
      references: params.references,
      attachments: params.attachments,
    });
  }
  const text = textPart(params.body);
  const headers = [
    `From: ${mailboxHeader(params.from)}`,
    `To: ${mailboxHeader(params.to)}`,
    `Subject: ${encodedWord(params.subject)}`,
    ...threadingHeaders(params),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${text.encoding}`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n${text.body}`;
}

export type MailAttachmentPart = {
  filename: string;
  contentType?: string;
  /** Raw bytes as a Buffer or base64 string. */
  contentBase64: string;
};

export function buildMultipartMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  plainBody: string;
  ebpArmor?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachmentPart[];
}): string {
  const boundary = `ebp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const text = textPart(params.plainBody);
  const lines = [
    `From: ${mailboxHeader(params.from)}`,
    `To: ${mailboxHeader(params.to)}`,
    `Subject: ${encodedWord(params.subject)}`,
    ...threadingHeaders(params),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${text.encoding}`,
    '',
    text.body,
  ];
  if (params.ebpArmor) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Disposition: inline',
      `Content-Transfer-Encoding: ${textPart(params.ebpArmor).encoding}`,
      '',
      textPart(params.ebpArmor).body,
      '',
    );
  }
  for (const attachment of params.attachments ?? []) {
    const rawFilename = headerValue(attachment.filename, 'Attachment filename');
    const filename = headerValue(
      attachment.filename.replace(/[^\x20-\x7e]/g, '_'),
      'Attachment filename',
    ).replace(/[\\"]/g, '\\$&');
    const contentType =
      headerValue(
        attachment.contentType ?? '',
        'Attachment content type',
      ).trim() || 'application/octet-stream';
    const b64 = attachment.contentBase64.replace(/\s+/g, '');
    const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
    lines.push(
      `--${boundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"${/[^\x00-\x7f]/.test(rawFilename) ? "; filename*=utf-8\'\'" + encodeURIComponent(rawFilename) : ""}`,
      '',
      wrapped,
      '',
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}
