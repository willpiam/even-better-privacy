import {Buffer} from 'buffer';
import {armorPayload, extractArmoredPayload} from "../../core/Payloads.ts";
import {splitHeadersAndBody} from "./Headers.ts";

type HeaderMap = Record<string, string>;

type DecodedTextPart = {
  contentType: string;
  body: string;
};

export const MAX_MIME_DEPTH = 30;
export const MAX_MIME_ENTITIES = 1000;

function parseHeadersAndBody(part: string): {headers: HeaderMap; body: string} {
  return splitHeadersAndBody(part);
}
function parameter(header: string, name: string): string | null {
  const expression = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^;\\s]+))', 'i');
  const match = expression.exec(header);
  return match ? (match[1] ?? match[2]).replace(/\\(.)/g, '$1') : null;
}
function getBoundary(contentType: string): string | null { return parameter(contentType, 'boundary'); }

function headerValueParam(
  header: string | undefined,
  fallback: string,
): string {
  if (!header) {
    return fallback;
  }
  const semi = header.indexOf(';');
  return (semi >= 0 ? header.slice(0, semi) : header).trim().toLowerCase();
}

function transferBytes(body: string, cte: string): Uint8Array {
  const encoding = cte.trim().toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (encoding === 'quoted-printable') {
    const source = body.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '=' && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
        bytes.push(parseInt(source.slice(index + 1, index + 3), 16)); index += 2;
      } else { bytes.push(source.charCodeAt(index) & 255); }
    }
    return new Uint8Array(bytes);
  }
  return Buffer.from(body, 'latin1');
}
function charsetText(bytes: Uint8Array, charset: string): string {
  const label = charset.toLowerCase().replace(/_/g, '-');
  if (['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(label)) return Buffer.from(bytes).toString('utf8');
  if (['iso-8859-1', 'latin1', 'latin-1', 'windows-1252', 'cp1252'].includes(label)) {
    const windows = label === 'windows-1252' || label === 'cp1252';
    const extra = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
    const chunks: string[] = [];
    for (let start = 0; start < bytes.length; start += 8192) {
      chunks.push(Array.from(bytes.subarray(start, start + 8192), byte => windows && byte >= 128 && byte < 160 ? extra[byte - 128] : String.fromCharCode(byte)).join(''));
    }
    return chunks.join('');
  }
  try { return new TextDecoder(label).decode(bytes); }
  catch { throw new Error(`Unsupported MIME charset: ${charset}`); }
}
/** Transfer decoding precedes charset decoding; raw entities use octet strings. */
export function decodeTransferEncoding(body: string, cte: string, charset = 'utf-8'): string {
  const binary = ['base64', 'quoted-printable'].includes(cte.trim().toLowerCase())
    ? body : Buffer.from(body, 'utf8').toString('latin1');
  return charsetText(transferBytes(binary, cte), charset);
}

/** Split a multipart body into raw part strings (headers + body each). */
function* splitMultipartParts(
  body: string,
  boundary: string,
): Generator<string> {
  const normalized = body.replace(/\r\n/g, '\n');
  const sep = `--${boundary}`;
  const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const delimiter = new RegExp(`^${escaped}(--)?[ \\t]*(?:\\n|$)`, 'gm');
  let contentStart: number | null = null;
  for (
    let match = delimiter.exec(normalized);
    match;
    match = delimiter.exec(normalized)
  ) {
    if (contentStart !== null) {
      const end =
        match.index > contentStart && normalized[match.index - 1] === '\n'
          ? match.index - 1
          : match.index;
      if (end > contentStart) yield normalized.slice(contentStart, end);
    }
    if (match[1]) return;
    contentStart = delimiter.lastIndex;
  }
  if (contentStart !== null && contentStart < normalized.length)
    yield normalized.slice(contentStart);
}

function collectFromEntity(
  raw: string,
  into: DecodedTextPart[],
  budget: {entities: number},
  depth = 0,
): void {
  if (depth > MAX_MIME_DEPTH) {
    throw new Error('MIME nesting limit exceeded');
  }
  if (++budget.entities > MAX_MIME_ENTITIES) {
    throw new Error('MIME part limit exceeded');
  }
  const {headers, body} = parseHeadersAndBody(raw);
  const contentType = headers['content-type'] ?? 'text/plain';
  const mediaType = headerValueParam(contentType, 'text/plain');
  const cte = headers['content-transfer-encoding'] ?? '7bit';
  if (headerValueParam(headers['content-disposition'], '') === 'attachment') return;

  if (mediaType.startsWith('multipart/')) {
    const boundary = getBoundary(contentType);
    if (!boundary) {
      return;
    }
    for (const part of splitMultipartParts(body, boundary)) {
      collectFromEntity(part, into, budget, depth + 1);
    }
    return;
  }

  if (mediaType === 'text/plain' || mediaType === 'text/html') {
    into.push({
      contentType: mediaType,
      body: charsetText(transferBytes(body, cte), parameter(contentType, 'charset') ?? 'utf-8').replace(/\r\n?/g, '\n'),
    });
  }
}

/** Walk RFC822 / MIME and collect decoded text/plain and text/html parts. */
export function collectDecodedTextParts(source: string | Uint8Array): DecodedTextPart[] {
  const parts: DecodedTextPart[] = [];
  const octets = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
  collectFromEntity(octets.toString('latin1'), parts, {entities: 0});
  return parts;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTextFromMimeSource(
  source: string | Uint8Array,
  parts = collectDecodedTextParts(source),
): {
  text: string;
  html: string;
} {
  const plains = parts
    .filter(p => p.contentType === 'text/plain')
    .map(p => p.body);
  const htmls = parts
    .filter(p => p.contentType === 'text/html')
    .map(p => p.body);
  if (plains.length > 0 || htmls.length > 0) {
    const html = htmls.join('\n\n');
    const text =
      plains.length > 0 ? plains.join('\n\n') : html ? stripHtml(html) : '';
    return {text, html};
  }
  return {text: '', html: ''};
}

/**
 * Extract EBP armor only when JSON inside the block parses successfully
 * after MIME CTE decode. Returns a clean re-armored string, or null.
 */
export function extractEbpPayloadFromMime(
  source: string | Uint8Array,
  parts = collectDecodedTextParts(source),
): string | null {
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
    const fallback = extractTextFromMimeSource(source, parts);
    if (fallback.text) {
      candidates.push(fallback.text);
    }
    if (fallback.html) {
      candidates.push(fallback.html);
      candidates.push(stripHtml(fallback.html));
    }
  }

  for (const candidate of candidates) {
    const parsed = extractArmoredPayload(candidate);
    if (parsed) {
      return armorPayload(parsed);
    }
  }
  return null;
}

/** Decode the text entities once for both display and EBP extraction. */
export function parseMimeMessage(source: string | Uint8Array): {
  text: string;
  html: string;
  ebpPayload: string | null;
} {
  const parts = collectDecodedTextParts(source);
  return {
    ...extractTextFromMimeSource(source, parts),
    ebpPayload: extractEbpPayloadFromMime(source, parts),
  };
}
