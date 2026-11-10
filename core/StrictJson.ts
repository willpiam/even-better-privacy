import { canonicalize } from "./CanonicalJson.ts";

/** Parse the shared JSON subset, rejecting duplicate names before they are lost. */
// deno-lint-ignore no-explicit-any
export function parseStrictJson<T = any>(text: string): T {
  const value = JSON.parse(text) as T;
  let pos = 0;
  const ws = () => { while (pos < text.length && /[\x20\t\r\n]/.test(text[pos]!)) pos++; };
  const string = (): string => {
    const start = pos++;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === "\\") pos++;
      else if (c === '"') return JSON.parse(text.slice(start, pos)) as string;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const scan = (): void => {
    ws();
    if (text[pos] === "{") {
      pos++; ws();
      const keys = new Set<string>();
      if (text[pos] === "}") { pos++; return; }
      for (;;) {
        ws(); const key = string();
        if (keys.has(key)) throw new SyntaxError("Duplicate JSON object key");
        keys.add(key); ws(); pos++; scan(); ws();
        if (text[pos++] === "}") return;
      }
    }
    if (text[pos] === "[") {
      pos++; ws();
      if (text[pos] === "]") { pos++; return; }
      for (;;) { scan(); ws(); if (text[pos++] === "]") return; }
    }
    if (text[pos] === '"') { string(); return; }
    while (pos < text.length && !/[\x20\t\r\n,\]}]/.test(text[pos]!)) pos++;
  };
  scan();
  canonicalize(value); // Validate all strings, object names, and finite numeric values.
  return value;
}
