import { extractArmoredPayload } from "./Payloads.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse user paste input: PEM-style armor block or raw JSON payload object.
 */
export function parseEbpPayloadInput(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Payload input is empty");
  }

  const armored = extractArmoredPayload(trimmed);
  if (armored) {
    if (typeof armored.type !== "string") {
      throw new Error("Armored payload missing type field");
    }
    return armored;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid JSON payload");
  }

  if (!isRecord(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  if (typeof parsed.type !== "string") {
    throw new Error("Payload missing type field");
  }
  return parsed;
}

export type ParsedRecipientEncapsulation = {
  fingerprint: string;
  kemCiphertext: string;
  keyWrapNonce: string;
  wrappedContentKey: string;
};

export function parseMultiRecipientEntries(
  recipientsRaw: unknown,
): ParsedRecipientEncapsulation[] {
  if (!Array.isArray(recipientsRaw)) {
    return [];
  }
  return recipientsRaw
    .map((entry) => {
      const row = entry as Record<string, unknown> | null;
      return {
        fingerprint: typeof row?.fingerprint === "string" ? row.fingerprint : "",
        kemCiphertext: typeof row?.kemCiphertext === "string"
          ? row.kemCiphertext
          : "",
        keyWrapNonce: typeof row?.keyWrapNonce === "string"
          ? row.keyWrapNonce
          : "",
        wrappedContentKey: typeof row?.wrappedContentKey === "string"
          ? row.wrappedContentKey
          : "",
      };
    })
    .filter((entry) => (
      entry.fingerprint.length > 0 &&
      entry.kemCiphertext.length > 0 &&
      entry.keyWrapNonce.length > 0 &&
      entry.wrappedContentKey.length > 0
    ));
}
