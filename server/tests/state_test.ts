import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { buildState } from "../state.ts";

Deno.test("buildState maps identity row and details into identity state", () => {
  const identity = {
    fingerprint: "fp",
    signing_key_type: "sphincs" as const,
    encryption_key_type: "kyber" as const,
    signing_key: "signing",
    encryption_key: "encryption",
    signing_key_details: { variant: "v1" },
    encryption_key_details: null,
    created_at: 123,
  };

  const details = { "profile/name": ["alice", "proof"] as [string, string] };

  const state = buildState(identity, details);

  assertEquals(state, {
    fingerprint: "fp",
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: "signing",
    encryptionKey: "encryption",
    signingKeyDetails: { variant: "v1" },
    encryptionKeyDetails: null,
    details,
  });
});

