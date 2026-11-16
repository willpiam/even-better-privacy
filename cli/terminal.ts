/** Escape untrusted terminal controls while preserving ordinary Unicode text. */
export function terminalText(value: unknown): string {
  return String(value).replace(
    /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
