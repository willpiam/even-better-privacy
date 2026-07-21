import {Buffer} from 'buffer';
import {
  armorPayload,
  extractArmoredPayload,
} from '../../../../core/Payloads';

type HeaderMap = Record<string, string>;

type DecodedTextPart = {
  contentType: string;
  body: string;
};

function parseHeadersAndBody(part: string): {headers: HeaderMap; body: string} {
  const normalized = part.replace(/\r\n/g, '\n');
  const split = normalized.indexOf('\n\n');
  const headerBlock = split >= 0 ? normalized.slice(0, split) : normalized;
  const body = split >= 0 ? normalized.slice(split + 2) : '';
  const headers: HeaderMap = {};
  let current = '';
  for (const line of headerBlock.split('\n')) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] = `${headers[current]} ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = value;
    current = name;
  }
  return {headers, body};
}

function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
  return match ? match[1] : null;
}

function headerValueParam(header: string | undefined, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const semi = header.indexOf(';');
  return (semi >= 0 ? header.slice(0, semi) : header).trim().toLowerCase();
}

/** Decode Content-Transfer-Encoding for text parts (QP, base64, 7bit/8bit/binary). */
export function decodeTransferEncoding(body: string, cte: string): string {
  const encoding = cte.trim().toLowerCase();
  if (encoding === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  if (encoding === 'base64') {
    const cleaned = body.replace(/\s+/g, '');
    return Buffer.from(cleaned, 'base64').toString('utf8');
  }
  return body;
}

function decodeQuotedPrintable(input: string): string {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i];
    if (
      ch === '=' &&
      i + 2 < withoutSoftBreaks.length &&
      /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))
    ) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    bytes.push(withoutSoftBreaks.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Split a multipart body into raw part strings (headers + body each). */
function splitMultipartParts(body: string, boundary: string): string[] {
  const normalized = body.replace(/\r\n/g, '\n');
  const sep = `--${boundary}`;
  const parts: string[] = [];
  let idx = 0;
  while (true) {
    const start = normalized.indexOf(sep, idx);
    if (start < 0) {
      break;
    }
    let contentStart = start + sep.length;
    if (normalized.startsWith('--', contentStart)) {
      break;
    }
    if (normalized[contentStart] === '\n') {
      contentStart += 1;
    }
    const next = normalized.indexOf(`\n${sep}`, contentStart);
    const end = next >= 0 ? next : normalized.length;
    const part = normalized.slice(contentStart, end);
    if (part.length > 0) {
      parts.push(part);
    }
    if (next < 0) {
      break;
    }
    idx = next + 1;
  }
  return parts;
}

function collectFromEntity(raw: string, into: DecodedTextPart[]): void {
  const {headers, body} = parseHeadersAndBody(raw);
  const contentType = headers['content-type'] ?? 'text/plain';
  const mediaType = headerValueParam(contentType, 'text/plain');
  const cte = headers['content-transfer-encoding'] ?? '7bit';

  if (mediaType.startsWith('multipart/')) {
    const boundary = getBoundary(contentType);
    if (!boundary) {
      return;
    }
    for (const part of splitMultipartParts(body, boundary)) {
      collectFromEntity(part, into);
    }
    return;
  }

  if (mediaType === 'text/plain' || mediaType === 'text/html') {
    into.push({
      contentType: mediaType,
      body: decodeTransferEncoding(body, cte),
    });
  }
}

/** Walk RFC822 / MIME and collect decoded text/plain and text/html parts. */
export function collectDecodedTextParts(source: string): DecodedTextPart[] {
  const parts: DecodedTextPart[] = [];
  collectFromEntity(source, parts);
  return parts;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractTextFromMimeSource(source: string): {
  text: string;
  html: string;
} {
  const parts = collectDecodedTextParts(source);
  const plains = parts.filter(p => p.contentType === 'text/plain').map(p => p.body);
  const htmls = parts.filter(p => p.contentType === 'text/html').map(p => p.body);
  if (plains.length > 0 || htmls.length > 0) {
    const html = htmls.join('\n\n');
    const text =
      plains.length > 0
        ? plains.join('\n\n')
        : html
          ? stripHtml(html)
          : '';
    return {text, html};
  }
  // Fallback for non-MIME / missing Content-Type bodies
  const {headers, body} = parseHeadersAndBody(source);
  const mediaType = headerValueParam(headers['content-type'], 'text/plain');
  const cte = headers['content-transfer-encoding'] ?? '7bit';
  const decoded = decodeTransferEncoding(body, cte);
  if (mediaType === 'text/html') {
    return {text: stripHtml(decoded), html: decoded};
  }
  return {text: decoded, html: ''};
}

/**
 * Extract EBP armor only when JSON inside the block parses successfully
 * after MIME CTE decode. Returns a clean re-armored string, or null.
 */
export function extractEbpPayloadFromMime(source: string): string | null {
  const parts = collectDecodedTextParts(source);
  const candidates: string[] = [];
  for (const part of parts) {
    if (part.contentType === 'text/plain') {
      candidates.push(part.body);
    }
  }
  for (const part of parts) {
    if (part.contentType === 'text/html') {
      candidates.push(part.body);
      candidates.push(stripHtml(part.body));
    }
  }
  if (candidates.length === 0) {
    const fallback = extractTextFromMimeSource(source);
    if (fallback.text) {
      candidates.push(fallback.text);
    }
    if (fallback.html) {
      candidates.push(fallback.html);
      candidates.push(stripHtml(fallback.html));
    }
  }
  // Also try full source after a best-effort decode of the top entity only
  candidates.push(source);

  for (const candidate of candidates) {
    const parsed = extractArmoredPayload(candidate);
    if (parsed) {
      return armorPayload(parsed);
    }
  }
  return null;
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
