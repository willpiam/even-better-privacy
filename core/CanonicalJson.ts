/** Validate strings in the shared JSON contract (Unicode scalar values only). */
function validateString(value: string, key = false): void {
  if (key && value.includes("\0")) throw new TypeError("JSON object key contains NUL");
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError("Unpaired Unicode surrogate");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("Unpaired Unicode surrogate");
    }
  }
}

/** Return a validated deep copy; stableStringify supplies canonical byte ordering. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { validateString(value); return value; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalize(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      validateString(key, true);
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) Object.defineProperty(out, key, {value: canonicalize(item), enumerable: true, writable: true, configurable: true});
    }
    return out;
  }
  throw new TypeError("Value is not JSON");
}

/** Serialize an I-JSON value according to RFC 8785, independently of locale. */
export function stableStringify(value: unknown): string {
  function serialize(item: unknown): string {
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "string") { validateString(item); return JSON.stringify(item); }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Non-finite JSON number");
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${Array.from(item, (v) => v === undefined ? "null" : serialize(v)).join(",")}]`;
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      const fields: string[] = [];
      for (const key of Object.keys(record).sort()) {
        validateString(key, true);
        if (record[key] !== undefined) fields.push(`${JSON.stringify(key)}:${serialize(record[key])}`);
      }
      return `{${fields.join(",")}}`;
    }
    throw new TypeError("Value is not JSON");
  }
  return serialize(value);
}

export function canonicalJsonStringify(value: unknown): string {
  return stableStringify(value);
}
