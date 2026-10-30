// Compose "To" field parsing and send-intent rules shared by the GUI and
// mobile composers. The GUI frontend cannot import core/, so
// gui/js/compose-recipients-logic.js mirrors these two functions; both are
// checked against core/tests/fixtures/compose-recipients.json.

export type ComposeChipState =
  | "resolving"
  | "encrypted"
  | "unresolved"
  | "plaintext"
  | "invalid";

export type ComposeChip = {
  email: string;
  state: ComposeChipState;
  /** Local contact name used to encrypt; set when state is "encrypted". */
  contact?: string;
  /** Lookup or validation note shown on the chip. */
  note?: string;
};

export type ParsedAddress = {
  email: string;
  valid: boolean;
};

export type ComposeIntent =
  | { kind: "empty" }
  | { kind: "encrypted" }
  | { kind: "plaintext" }
  | {
    kind: "blocked";
    reason: "invalid" | "resolving" | "unresolved" | "mixed";
    message: string;
  };

const ADDRESS_SEPARATORS = /[,;\n\r]+/;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/** Trim, unwrap `Name <addr>`, and lowercase the domain. */
export function normalizeAddress(raw: string): string {
  let value = String(raw ?? "").trim();
  const angle = value.match(/<([^<>]*)>\s*$/);
  if (angle) value = angle[1].trim();
  value = value.replace(/^mailto:/i, "");
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}

export function isValidAddress(address: string): boolean {
  return EMAIL_PATTERN.test(address);
}

/**
 * Split a typed or pasted list into addresses. Drops empties and duplicates
 * (case-insensitive, including any in `existing`); keeps invalid entries so
 * the UI can show them as red chips.
 */
export function parseAddressList(
  text: string,
  existing: readonly string[] = [],
): ParsedAddress[] {
  const seen = new Set(existing.map((email) => email.toLowerCase()));
  const out: ParsedAddress[] = [];
  for (const token of String(text ?? "").split(ADDRESS_SEPARATORS)) {
    const email = normalizeAddress(token);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, valid: isValidAddress(email) });
  }
  return out;
}

export function deriveComposeIntent(
  chips: readonly Pick<ComposeChip, "state">[],
): ComposeIntent {
  if (!chips.length) return { kind: "empty" };
  if (chips.some((chip) => chip.state === "invalid")) {
    return {
      kind: "blocked",
      reason: "invalid",
      message: "Fix or remove invalid addresses before sending.",
    };
  }
  if (chips.some((chip) => chip.state === "resolving")) {
    return {
      kind: "blocked",
      reason: "resolving",
      message: "Looking up recipient identities…",
    };
  }
  if (chips.some((chip) => chip.state === "unresolved")) {
    return {
      kind: "blocked",
      reason: "unresolved",
      message:
        "Choose a contact for each amber recipient, or mark it as not encrypted.",
    };
  }
  if (chips.every((chip) => chip.state === "encrypted")) {
    return { kind: "encrypted" };
  }
  if (chips.every((chip) => chip.state === "plaintext")) {
    return { kind: "plaintext" };
  }
  return {
    kind: "blocked",
    reason: "mixed",
    message:
      "Some recipients are encrypted and some are not. Remove the unencrypted recipients or send to them separately.",
  };
}
