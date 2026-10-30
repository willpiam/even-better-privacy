// Sender-authenticity badge and modal for the mail reader. The backend
// computes badgeKind/badgeLabel (core/MailAuthenticity.ts); this module only
// renders them.

const BADGE_CLASS_BY_KIND = {
  good: "valid",
  caution: "warning",
  bad: "invalid",
  neutral: "pending",
};

const BADGE_TEXT_BY_KIND = {
  good: "Verified sender",
  caution: "Check sender",
  bad: "Signature problem",
  neutral: "Not signed",
};

const FALLBACK_LABEL_BY_KIND = {
  good: "✓",
  caution: "!",
  bad: "✗",
  neutral: "○",
};

let currentResult = null;

export function resolveBadgeKind(result) {
  if (!result) return "neutral";
  if (BADGE_CLASS_BY_KIND[result.badgeKind]) return result.badgeKind;
  if (result.verified === false) return "bad";
  if (result.verified === true) {
    return result.signerMatchesSenderEmail === false || result.signerEmailVerified === false
      ? "caution"
      : "good";
  }
  return "neutral";
}

export function badgeClassForKind(kind) {
  return BADGE_CLASS_BY_KIND[kind] || "pending";
}

function applyBadge(el, result) {
  const kind = resolveBadgeKind(result);
  const label = result?.badgeLabel || FALLBACK_LABEL_BY_KIND[kind];
  el.className = el.className
    .split(/\s+/)
    .filter((c) => c && !Object.values(BADGE_CLASS_BY_KIND).includes(c))
    .concat(badgeClassForKind(kind))
    .join(" ");
  el.dataset.badgeKind = kind;
  return { kind, label };
}

export function renderMailAuthenticityBadge(result) {
  currentResult = result || null;
  const badge = document.getElementById("mail-authenticity-badge");
  if (!badge) return;
  if (!result) {
    badge.style.display = "none";
    badge.textContent = FALLBACK_LABEL_BY_KIND.neutral;
    delete badge.dataset.badgeKind;
    return;
  }
  const { kind, label } = applyBadge(badge, result);
  badge.textContent = `${label} ${BADGE_TEXT_BY_KIND[kind]}`;
  badge.style.display = "";
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "N/A";
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function signatureNote(status) {
  if (status === "unsigned") return "This message was encrypted but not signed.";
  if (status === "invalid") return "The signature is invalid.";
  if (status === "fingerprint_mismatch") {
    return "The signer's keys do not match the fingerprint the message claims. Treat this message as forged.";
  }
  if (status === "valid_unbound" || status === "valid_unknown_signer_unbound") {
    return "Signature is valid but not bound to the recipient (legacy).";
  }
  if (status === "valid_unknown_signer") {
    return "Signature is valid. Signer is not in your local contacts.";
  }
  if (status === "sender_not_found" || status === "sender_not_in_contacts" || status === "sender_not_specified") {
    return "The signer could not be identified, so the signature was not checked.";
  }
  if (status === "valid") return "Signature is valid.";
  return "";
}

function fromNote(result) {
  const path = result.matchedEmailPath || "email";
  if (result.signerMatchesSenderEmail === true) {
    return `Message From matches the signer’s ${path} claim.`;
  }
  if (result.signerMatchesSenderEmail === false) {
    return "Message From does not match any email claim on the signer’s identity.";
  }
  return "No email claim on the signer’s identity to compare with From.";
}

function endorseNote(result) {
  const path = result.matchedEmailPath || "email";
  if (result.signerEmailVerified === true) {
    return `The matched ${path} detail has a verify-email endorsement.`;
  }
  if (result.signerEmailVerified === false) {
    return "An email claim exists but is not endorsed via verify-email.";
  }
  return "No email endorsement applies.";
}

export function openMailAuthenticityModal(result = currentResult) {
  const modal = document.getElementById("mail-authenticity-modal");
  if (!modal || !result) return;
  const badge = document.getElementById("mail-authenticity-modal-badge");
  if (badge) {
    const { label } = applyBadge(badge, result);
    badge.textContent = label;
  }
  const contactLabel = result.contactName ||
    (result.isKnownContact ? "Local contact" : "Unknown contact");
  setText("mail-authenticity-contact", contactLabel);
  setText("mail-authenticity-fingerprint", result.signerFingerprint || "(none)");
  setText("mail-authenticity-known", result.isKnownContact ? "Yes" : "No");
  const hasServer = typeof result.serverIdentityMatch === "boolean";
  const serverLabel = document.getElementById("mail-authenticity-server-label");
  const serverValue = document.getElementById("mail-authenticity-server");
  if (serverLabel) serverLabel.style.display = hasServer ? "" : "none";
  if (serverValue) {
    serverValue.style.display = hasServer ? "" : "none";
    serverValue.textContent = yesNo(result.serverIdentityMatch);
  }
  setText("mail-authenticity-from", result.messageFrom || "(missing)");
  setText("mail-authenticity-signer-email", result.signerEmail || "(none)");
  setText("mail-authenticity-matched-path", result.matchedEmailPath || "(none)");
  setText("mail-authenticity-opaque", result.opaqueEmailMatched ? "Yes" : "No");
  setText("mail-authenticity-from-note", fromNote(result));
  setText("mail-authenticity-endorsed", yesNo(result.signerEmailVerified));
  setText("mail-authenticity-endorse-note", endorseNote(result));
  setText("mail-authenticity-status", result.verifyStatus || "-");
  setText("mail-authenticity-signature-note", signatureNote(result.verifyStatus));
  modal.classList.add("active");
}

export function closeMailAuthenticityModal() {
  document.getElementById("mail-authenticity-modal")?.classList.remove("active");
}

export function initMailAuthenticityModal() {
  const modal = document.getElementById("mail-authenticity-modal");
  document.getElementById("mail-authenticity-badge")?.addEventListener("click", () => {
    openMailAuthenticityModal();
  });
  document.getElementById("mail-authenticity-close")?.addEventListener("click", closeMailAuthenticityModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeMailAuthenticityModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !modal?.classList.contains("active")) return;
    // The password modal stacks above this one; let it handle Escape first.
    if (document.getElementById("password-modal")?.classList.contains("active")) return;
    closeMailAuthenticityModal();
  }, { capture: true });
}
