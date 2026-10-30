// Mirror of parseAddressList / deriveComposeIntent in core/ComposeRecipients.ts.
// Kept in sync by core/ComposeRecipients.test.ts, which runs both against
// core/tests/fixtures/compose-recipients.json.

const ADDRESS_SEPARATORS = /[,;\n\r]+/;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export function normalizeAddress(raw) {
  let value = String(raw ?? "").trim();
  const angle = value.match(/<([^<>]*)>\s*$/);
  if (angle) value = angle[1].trim();
  value = value.replace(/^mailto:/i, "");
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}

export function isValidAddress(address) {
  return EMAIL_PATTERN.test(address);
}

export function parseAddressList(text, existing = []) {
  const seen = new Set(existing.map((email) => String(email).toLowerCase()));
  const out = [];
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

export function deriveComposeIntent(chips) {
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
      message: "Choose a contact for each amber recipient, or mark it as not encrypted.",
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
