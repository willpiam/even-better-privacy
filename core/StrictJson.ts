import { validateJsonValue } from "./CanonicalJson.ts";

/** Parse the shared JSON subset, rejecting duplicate names before they are lost. */
// deno-lint-ignore no-explicit-any
export function parseStrictJson<T = any>(text: string): T {
  // JSON.parse validates grammar first. The scanner below visits that valid
  // grammar only to retain duplicate object names, including escaped spellings.
  const value = JSON.parse(text) as T;
  let cursor = 0;
  const skipWhitespace = (): void => {
    while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor]!)) cursor++;
  };
  // On entry cursor points at the opening quote; on return just after closing.
  const readString = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === "\\") {
        cursor++; // Skip the escaped character; JSON.parse already checked it.
      } else if (character === '"') {
        return JSON.parse(text.slice(start, cursor)) as string;
      }
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  // On return cursor is immediately after the value, before its delimiter.
  const scanValue = (): void => {
    skipWhitespace();
    if (text[cursor] === "{") {
      cursor++;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[cursor] === "}") { cursor++; return; }
      for (;;) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) throw new SyntaxError("Duplicate JSON object key");
        keys.add(key);
        skipWhitespace();
        cursor++; // Colon, guaranteed by the initial grammar validation.
        scanValue();
        skipWhitespace();
        const delimiter = text[cursor++];
        if (delimiter === "}") return;
        // Otherwise the delimiter was a comma; the next iteration reads a key.
      }
    }
    if (text[cursor] === "[") {
      cursor++;
      skipWhitespace();
      if (text[cursor] === "]") { cursor++; return; }
      for (;;) {
        scanValue();
        skipWhitespace();
        const delimiter = text[cursor++];
        if (delimiter === "]") return;
      }
    }
    if (text[cursor] === '"') { readString(); return; }
    while (cursor < text.length && !/[\x20\t\r\n,\]}]/.test(text[cursor]!)) cursor++;
  };
  scanValue();
  validateJsonValue(value);
  return value;
}
