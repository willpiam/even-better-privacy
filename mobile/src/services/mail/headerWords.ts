import {Buffer} from 'buffer';

/** Decode RFC 2047 words for display; retain unknown charsets and malformed words. */
export function decodeHeaderWords(value: string): string {
  const word = /[=]\?([^?\s]+)\?([bq])\?([^?]*)\?=/gi;
  let result = '';
  let end = 0;
  let previousDecoded = false;
  for (let match = word.exec(value); match; match = word.exec(value)) {
    let decoded: string | undefined;
    try {
      const charset = match[1].toLowerCase().replace(/_/g, '-');
      let bytes: Buffer;
      if (match[2].toLowerCase() === 'b') {
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            match[3],
          )
        )
          throw new Error('Invalid base64');
        bytes = Buffer.from(match[3], 'base64');
      } else {
        const text = match[3].replace(/_/g, ' ');
        if (/[=](?![0-9a-f]{2})|[^\x20-\x7e]/i.test(text))
          throw new Error('Invalid quoted-printable');
        const raw: number[] = [];
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '=') {
            raw.push(parseInt(text.slice(i + 1, i + 3), 16));
            i += 2;
          } else raw.push(text.charCodeAt(i));
        }
        bytes = Buffer.from(raw);
      }
      if (charset === 'utf-8' || charset === 'utf8')
        decoded = bytes.toString('utf8');
      else if (charset === 'iso-8859-1' || charset === 'latin1')
        decoded = bytes.toString('latin1');
      else if (charset === 'us-ascii' || charset === 'ascii')
        decoded = bytes.toString('ascii');
      // Never turn encoded words into new header lines or control sequences.
      if (decoded && /[\r\n\0]/.test(decoded)) decoded = undefined;
    } catch {
      decoded = undefined;
    }
    const gap = value.slice(end, match.index);
    result +=
      previousDecoded && decoded !== undefined && /^\s*$/.test(gap) ? '' : gap;
    result += decoded ?? match[0];
    previousDecoded = decoded !== undefined;
    end = word.lastIndex;
  }
  return result + value.slice(end);
}
