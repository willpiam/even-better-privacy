import {extractArmoredPayload} from '../../ebpCore';

export function extractTextFromMimeSource(source: string): {
  text: string;
  html: string;
} {
  const parts = source.split(/\r?\n\r?\n/);
  const body = parts.slice(1).join('\n\n');
  const contentType = (parts[0] ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    return {text: stripHtml(body), html: body};
  }
  return {text: body, html: ''};
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractEbpPayloadFromMime(source: string): string | null {
  if (extractArmoredPayload(source)) {
    const begin = source.indexOf('-----BEGIN EBP');
    const end = source.indexOf('-----END EBP');
    if (begin >= 0 && end > begin) {
      const tail = source.indexOf('\n', end);
      return source.slice(begin, tail > end ? tail : end + 20);
    }
  }
  const begin = source.indexOf('-----BEGIN EBP');
  if (begin < 0) {
    return null;
  }
  const end = source.indexOf('-----END EBP', begin);
  if (end < 0) {
    return null;
  }
  const lineEnd = source.indexOf('\n', end);
  return source.slice(begin, lineEnd > end ? lineEnd : end + 20);
}

export function buildSimpleMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
  ];
  return `${headers.join('\r\n')}${params.body}`;
}

export function buildMultipartMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  plainBody: string;
  ebpArmor?: string;
}): string {
  const boundary = `ebp_${Date.now().toString(36)}`;
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    params.plainBody,
  ];
  if (params.ebpArmor) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Disposition: inline',
      '',
      params.ebpArmor,
      '',
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}
