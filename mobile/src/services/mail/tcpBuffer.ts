/**
 * Octet-buffer helpers for line- and literal-oriented protocol reads (IMAP/SMTP).
 *
 * Important: on React Native, `Buffer#subarray` can yield a plain Uint8Array.
 * `Uint8Array#toString()` ignores encoding and returns comma-separated decimals
 * (e.g. "42,32,79,75" for "* OK"), which broke IMAP greeting checks. Always
 * decode via `Buffer.prototype.toString.call` / range `toString`.
 */

import {Buffer} from 'buffer';

function asBuffer(view: Uint8Array): Buffer {
  return Buffer.isBuffer(view) ? view : Buffer.from(view);
}

/**
 * Extract one complete line from the front of `buffer`.
 * Accepts CRLF or bare LF; strips a trailing CR if present.
 * Returns null if no full line is available yet.
 */
export function takeLineFromBuffer(buffer: Buffer): {
  line: string;
  rest: Buffer;
} | null {
  const buf = asBuffer(buffer);
  const lf = buf.indexOf(0x0a);
  if (lf < 0) {
    return null;
  }
  let end = lf;
  if (end > 0 && buf[end - 1] === 0x0d) {
    end -= 1;
  }
  return {
    line: buf.toString('utf8', 0, end),
    rest: asBuffer(buf.subarray(lf + 1)),
  };
}

/**
 * Take exactly `n` octets from the front of `buffer`, or null if not enough data.
 */
export function takeBytesFromBuffer(
  buffer: Buffer,
  n: number,
): {chunk: string; rest: Buffer} | null {
  if (n < 0) {
    throw new Error('readBytes count must be non-negative');
  }
  const buf = asBuffer(buffer);
  if (n === 0) {
    return {chunk: '', rest: buf};
  }
  if (buf.length < n) {
    return null;
  }
  return {
    chunk: buf.toString('utf8', 0, n),
    rest: asBuffer(buf.subarray(n)),
  };
}
