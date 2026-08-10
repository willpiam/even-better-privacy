/**
 * Mirrors core/Fingerprint.shortFingerprint — browser GUI cannot import Deno core/.
 * First 12 + … + last 12; unchanged if shorter than 25 chars.
 */
export function shortFingerprint(fp) {
  if (typeof fp !== "string" || fp.length < 25) {
    return fp ?? "";
  }
  return `${fp.slice(0, 12)}…${fp.slice(-12)}`;
}
