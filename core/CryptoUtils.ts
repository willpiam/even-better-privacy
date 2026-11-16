/**
 * Shared crypto helpers for CLI, GUI local backend, and mobile (via Metro).
 */

export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildFileSignMessage(
  fileHash: string,
  salt: string,
  contextMessage: string,
): string {
  if (!/^[0-9a-f]+$/.test(fileHash) || !/^[0-9a-f]*$/.test(salt)) {
    throw new Error("File signature hash and salt must be canonical hexadecimal");
  }
  return `ebp::filehash::${fileHash}::${salt || ""}::${contextMessage || ""}`;
}
