const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

/** Encode a UTF-8 string as hex */
export function stringToHex(str: string): string {
  return toHex(textEncoder.encode(str));
}

/** Decode a hex-encoded UTF-8 string */
export function hexToString(hex: string): string {
  return textDecoder.decode(hexToBytes(hex));
}

/** Concatenate multiple Uint8Arrays into one */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
