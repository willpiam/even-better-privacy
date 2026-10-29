import { assertEquals } from "jsr:@std/assert@^1.0.6";
import {
  decideRecipientResolution,
  matchVerifiedEmailIdentities,
  searchVerifiedEmailIdentity,
  type EmailIdentityCandidate,
} from "./VerifiedEmailMatch.ts";

const EMAIL = "alice@pqpost.com";

function candidate(
  fingerprint: string,
  email: string,
  extras: Partial<EmailIdentityCandidate> = {},
): EmailIdentityCandidate {
  return {
    fingerprint,
    details: { email: [email, "proof"] },
    detailsMeta: { email: { verified: true, verifiedAt: 1 } },
    ...extras,
  };
}

Deno.test("matchVerifiedEmailIdentities accepts one exact verified address", () => {
  const match = matchVerifiedEmailIdentities(
    [
      candidate("fp-alice", EMAIL),
      candidate("fp-substring", `x${EMAIL}`),
      candidate("fp-name", "other@example.com", {
        details: { name: [EMAIL, "proof"], email: ["other@example.com", "proof"] },
      }),
    ],
    `  ${EMAIL.toUpperCase()}  `,
  );
  assertEquals(match, { status: "unique", fingerprint: "fp-alice" });
});

Deno.test("matchVerifiedEmailIdentities rejects unverified, revoked, and ambiguous hits", () => {
  assertEquals(
    matchVerifiedEmailIdentities([
      candidate("fp-plain", EMAIL, {
        detailsMeta: { email: { verified: false, verifiedAt: null } },
      }),
    ], EMAIL),
    { status: "none" },
  );
  assertEquals(
    matchVerifiedEmailIdentities([
      candidate("fp-revoked-id", EMAIL, { revoked: true }),
      candidate("fp-revoked-detail", EMAIL, { revokedDetails: ["email"] }),
    ], EMAIL),
    { status: "none" },
  );
  assertEquals(
    matchVerifiedEmailIdentities([
      candidate("fp-a", EMAIL),
      candidate("fp-b", EMAIL),
    ], EMAIL),
    { status: "ambiguous" },
  );
  assertEquals(matchVerifiedEmailIdentities([], "not-an-email"), {
    status: "none",
  });
});

Deno.test("searchVerifiedEmailIdentity pages until the directory is exhausted", async () => {
  const pages = [
    { identities: [candidate("fp-other", "other@pqpost.com")], hasNextPage: true },
    { identities: [candidate("fp-alice", EMAIL)], hasNextPage: false },
  ];
  const match = await searchVerifiedEmailIdentity(EMAIL, (page) => {
    return Promise.resolve(pages[page - 1]);
  });
  assertEquals(match, { status: "unique", fingerprint: "fp-alice" });
});

Deno.test("searchVerifiedEmailIdentity stops when a later page could still match", async () => {
  const match = await searchVerifiedEmailIdentity(EMAIL, () => {
    return Promise.resolve({
      identities: [candidate("fp-alice", EMAIL)],
      hasNextPage: true,
    });
  });
  assertEquals(match, { status: "ambiguous" });
});

Deno.test("decideRecipientResolution keeps a saved contact and imports only a new unique fingerprint", () => {
  assertEquals(
    decideRecipientResolution({
      localEmailMatches: [{ name: "Alice", fingerprint: "fp-local" }],
      serverMatch: { status: "unique", fingerprint: "fp-server" },
      localFingerprintMatches: [],
    }),
    { action: "use", name: "Alice", source: "local" },
  );
  assertEquals(
    decideRecipientResolution({
      localEmailMatches: [],
      serverMatch: { status: "unique", fingerprint: "fp-server" },
      localFingerprintMatches: [{ name: "Saved", fingerprint: "fp-server" }],
    }),
    { action: "use", name: "Saved", source: "pinned" },
  );
  assertEquals(
    decideRecipientResolution({
      localEmailMatches: [],
      serverMatch: { status: "unique", fingerprint: "fp-server" },
      localFingerprintMatches: [],
    }),
    { action: "import", fingerprint: "fp-server" },
  );
  assertEquals(
    decideRecipientResolution({
      localEmailMatches: [],
      serverMatch: { status: "none" },
      localFingerprintMatches: [],
    }),
    { action: "unresolved" },
  );
});
