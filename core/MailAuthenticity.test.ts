import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { sha256Hex } from "./MessageHash.ts";
import {
  type AuthenticityContact,
  badgeLabel,
  buildMailAuthenticityFields,
  deriveBadgeKind,
  elevateUnknownSignerVerifyStatus,
  extractEmailAddress,
  matchFromToIdentity,
  resolveSignerEmailClaim,
} from "./MailAuthenticity.ts";

function contact(overrides: AuthenticityContact = {}): AuthenticityContact {
  return { details: {}, ...overrides };
}

Deno.test("extractEmailAddress parses angle brackets", () => {
  assertEquals(
    extractEmailAddress("Alice <alice@Example.com>"),
    "alice@Example.com",
  );
  assertEquals(extractEmailAddress("  bob@example.com "), "bob@example.com");
  assertEquals(extractEmailAddress(""), "");
});

Deno.test("matchFromToIdentity matches cleartext email", () => {
  const match = matchFromToIdentity(
    contact({ details: { email: ["alice@example.com", "proof"] } }),
    "Alice <alice@example.com>",
  );
  assertEquals(match.matches, true);
  assertEquals(match.matchedPath, "email");
  assertEquals(match.opaqueEmailMatched, false);
});

Deno.test("matchFromToIdentity matches resolved opaque email", () => {
  const match = matchFromToIdentity(
    contact({
      details: { "opaque::email": ["deadbeef", "proof"] },
      resolvedOpaqueDetails: { "opaque::email": "alice@example.com" },
    }),
    "ALICE@example.com",
  );
  assertEquals(match.matches, true);
  assertEquals(match.matchedPath, "opaque::email");
  assertEquals(match.signerEmail, "alice@example.com");
  assertEquals(match.opaqueEmailMatched, true);
});

Deno.test("matchFromToIdentity matches opaque email hash of From", () => {
  const match = matchFromToIdentity(
    contact({
      details: { "opaque::email": [sha256Hex("alice@example.com"), "proof"] },
    }),
    "Alice <alice@example.com>",
  );
  assertEquals(match.matches, true);
  assertEquals(match.matchedPath, "opaque::email");
  assertEquals(match.signerEmail, "alice@example.com");
});

Deno.test("matchFromToIdentity reports mismatch only when a claim exists", () => {
  assertEquals(
    matchFromToIdentity(
      contact({ details: { email: ["alice@example.com", "proof"] } }),
      "mallory@example.com",
    ).matches,
    false,
  );
  assertEquals(
    matchFromToIdentity(contact(), "mallory@example.com").matches,
    null,
  );
  assertEquals(
    matchFromToIdentity(
      contact({ details: { email: ["alice@example.com", "proof"] } }),
      "",
    ).matches,
    null,
  );
});

Deno.test("resolveSignerEmailClaim reads verification from the matched path", () => {
  const claim = resolveSignerEmailClaim(
    contact({
      details: { "opaque::email": [sha256Hex("alice@example.com"), "proof"] },
      detailsMeta: { "opaque::email": { verified: true, verifiedAt: 1 } },
    }),
    "alice@example.com",
  );
  assertEquals(claim.matchedEmailPath, "opaque::email");
  assertEquals(claim.signerEmailVerified, true);
  assertEquals(claim.signerMatchesSenderEmail, true);

  const unverified = resolveSignerEmailClaim(
    contact({ details: { email: ["alice@example.com", "proof"] } }),
    "alice@example.com",
  );
  assertEquals(unverified.signerEmailVerified, false);
});

Deno.test("deriveBadgeKind is bad for invalid, caution for From mismatch", () => {
  assertEquals(
    deriveBadgeKind({
      verifyStatus: "invalid",
      verified: false,
      signerMatchesSenderEmail: true,
      signerEmailVerified: true,
    }),
    "bad",
  );
  assertEquals(
    deriveBadgeKind({
      verifyStatus: "fingerprint_mismatch",
      verified: false,
      signerMatchesSenderEmail: null,
      signerEmailVerified: null,
    }),
    "bad",
  );
  assertEquals(
    deriveBadgeKind({
      verifyStatus: "valid",
      verified: true,
      signerMatchesSenderEmail: false,
      signerEmailVerified: true,
    }),
    "caution",
  );
  assertEquals(
    deriveBadgeKind({
      verifyStatus: "valid",
      verified: true,
      signerMatchesSenderEmail: true,
      signerEmailVerified: true,
    }),
    "good",
  );
  assertEquals(
    deriveBadgeKind({
      verifyStatus: "unsigned",
      verified: null,
      signerMatchesSenderEmail: null,
      signerEmailVerified: null,
    }),
    "neutral",
  );
  assertEquals(badgeLabel("good"), "✓");
  assertEquals(badgeLabel("neutral"), "○");
});

Deno.test("elevateUnknownSignerVerifyStatus", () => {
  assertEquals(
    elevateUnknownSignerVerifyStatus(true, false, "valid"),
    "valid_unknown_signer",
  );
  assertEquals(elevateUnknownSignerVerifyStatus(true, true, "valid"), "valid");
  assertEquals(
    elevateUnknownSignerVerifyStatus(false, false, "invalid"),
    "invalid",
  );
});

Deno.test("buildMailAuthenticityFields prefers claims and falls back", () => {
  const fields = buildMailAuthenticityFields({
    verified: true,
    verifyStatus: "valid",
    contact: contact({
      details: { "opaque::email": [sha256Hex("alice@example.com"), "proof"] },
      detailsMeta: { "opaque::email": { verified: true, verifiedAt: 1 } },
    }),
    messageFrom: "Alice <alice@example.com>",
    isKnownContact: true,
    contactName: "alice",
    fallback: { signerMatchesSenderEmail: null, signerEmail: null },
  });
  assertEquals(fields.matchedEmailPath, "opaque::email");
  assertEquals(fields.opaqueEmailMatched, true);
  assertEquals(fields.signerMatchesSenderEmail, true);
  assertEquals(fields.contactName, "alice");
  assertEquals(fields.messageFrom, "Alice <alice@example.com>");
  assertEquals(fields.badgeKind, "good");
  assertEquals(fields.badgeLabel, "✓");

  const embedded = buildMailAuthenticityFields({
    verified: true,
    verifyStatus: "valid_unknown_signer",
    contact: contact(),
    messageFrom: "alice@example.com",
    fallback: {
      signerEmail: "bob@example.com",
      signerEmailVerified: true,
      signerMatchesSenderEmail: false,
    },
  });
  assertEquals(embedded.signerEmail, "bob@example.com");
  assertEquals(embedded.signerMatchesSenderEmail, false);
  assertEquals(embedded.isKnownContact, false);
  assertEquals(embedded.badgeKind, "caution");
});
