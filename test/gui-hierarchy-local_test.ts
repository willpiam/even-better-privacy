import { assertEquals, assertThrows } from "jsr:@std/assert";
import { stringToHex } from "../core/Hex.ts";
import { HttpError } from "../gui/local-backend/http.ts";
import {
  decodeHierarchyCertificateDraft,
  fingerprintColor,
  getHierarchyDir,
  getPendingHierarchyPath,
} from "../gui/local-backend/hierarchy-local.ts";
import type { CLIContext } from "../cli/utils.ts";

function sampleDraft(overrides: Record<string, unknown> = {}) {
  return {
    masterFingerprint: "fp_master",
    childFingerprint: "fp_child",
    timestamp: 1,
    expiry: 0,
    context: "",
    salt: "ab",
    ...overrides,
  };
}

Deno.test("gui hierarchy-local: decodeHierarchyCertificateDraft accepts valid hex JSON", () => {
  const encoded = stringToHex(JSON.stringify(sampleDraft()));
  const draft = decodeHierarchyCertificateDraft(encoded);
  assertEquals(draft.masterFingerprint, "fp_master");
  assertEquals(draft.childFingerprint, "fp_child");
  assertEquals(draft.salt, "ab");
});

Deno.test("gui hierarchy-local: decodeHierarchyCertificateDraft rejects bad encoding", () => {
  assertThrows(
    () => decodeHierarchyCertificateDraft("not-hex-json"),
    HttpError,
    "invalid hierarchy certificate encoding",
  );
  const bad = stringToHex(JSON.stringify({ masterFingerprint: "only" }));
  assertThrows(
    () => decodeHierarchyCertificateDraft(bad),
    HttpError,
    "invalid hierarchy certificate encoding",
  );
});

Deno.test("gui hierarchy-local: path helpers and fingerprintColor fallback", () => {
  const ctx = { identityDir: "/tmp/ebp-test-id" } as CLIContext;
  assertEquals(getHierarchyDir(ctx), "/tmp/ebp-test-id/hierarchy");
  assertEquals(
    getPendingHierarchyPath(ctx),
    "/tmp/ebp-test-id/hierarchy-pending.json",
  );
  assertEquals(fingerprintColor("not-a-fingerprint"), "#58a6ff");
});
