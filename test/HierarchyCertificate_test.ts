import {
  assert,
  assertEquals,
  assertFalse,
  assertThrows,
} from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  createHierarchyCertificate,
  decodeAndVerifyHierarchyCertificate,
  decodeHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  isHierarchyCertificateExpired,
  MAX_CONTEXT_LENGTH,
  type SignedHierarchyCertificate,
  validateHierarchy,
} from "../core/HierarchyCertificate.ts";

Deno.test("HierarchyCertificate: create + encode/decode round trip", () => {
  const cert = createHierarchyCertificate("master-fp", "child-fp", {
    expiry: 0,
    context: "team",
  });
  cert.masterSignature = "sig-a";
  cert.childSignature = "sig-b";

  const encoded = encodeHierarchyCertificate(
    cert as SignedHierarchyCertificate,
  );
  const decoded = decodeHierarchyCertificate(encoded);

  assert(decoded !== null);
  assertEquals(decoded.masterFingerprint, "master-fp");
  assertEquals(decoded.childFingerprint, "child-fp");
  assertEquals(decoded.context, "team");
});

Deno.test("HierarchyCertificate: dual signature verification succeeds with real keys", () => {
  const master = new Identity("dilithium", "kyber");
  const child = new Identity("sphincs", "kyber");
  const cert = createHierarchyCertificate(
    master.toFingerprint(),
    child.toFingerprint(),
    {
      context: "parent",
      expiry: 0,
    },
  );
  const payload = getHierarchySignaturePayload(cert);
  cert.masterSignature = master.signMessage(payload, undefined, "hierarchy");
  cert.childSignature = child.signMessage(payload, undefined, "hierarchy");
  const encoded = encodeHierarchyCertificate(
    cert as SignedHierarchyCertificate,
  );

  const result = decodeAndVerifyHierarchyCertificate(
    encoded,
    {
      fingerprint: master.toFingerprint(),
      signingKeyType: master.signingKeyType,
      signingKey: master.signingKey.publicKey,
      signingKeyDetails: master.summary.signingKeyDetails,
    },
    {
      fingerprint: child.toFingerprint(),
      signingKeyType: child.signingKeyType,
      signingKey: child.signingKey.publicKey,
      signingKeyDetails: child.summary.signingKeyDetails,
    },
  );
  assert(result.ok);
});

Deno.test("HierarchyCertificate: missing signature fails decode", () => {
  const cert = createHierarchyCertificate("master", "child");
  cert.masterSignature = "only-one";
  const encoded = encodeHierarchyCertificate(
    cert as unknown as SignedHierarchyCertificate,
  );
  const decoded = decodeHierarchyCertificate(encoded);
  assertEquals(decoded, null);
});

Deno.test("HierarchyCertificate: expiry checks", () => {
  assertFalse(isHierarchyCertificateExpired({ expiry: 0 }, Date.now()));
  assert(isHierarchyCertificateExpired({ expiry: 1000 }, 1001));
});

Deno.test("HierarchyCertificate: context length limit enforced", () => {
  const tooLong = "a".repeat(MAX_CONTEXT_LENGTH + 1);
  assertThrows(() =>
    createHierarchyCertificate("a", "b", { context: tooLong })
  );
});

Deno.test("F-CRYPTO-07: hierarchy signing payload is parser-secure canonical JSON", () => {
  const withDelimiters = createHierarchyCertificate("master", "child", {
    timestamp: 1,
    expiry: 0,
    context: "ops::admin::team",
    salt: "abc123",
  });
  const shiftedFields = createHierarchyCertificate(
    "master::ops",
    "admin::child",
    {
      timestamp: 1,
      expiry: 0,
      context: "team",
      salt: "abc123",
    },
  );

  const payload = getHierarchySignaturePayload(withDelimiters);
  assertEquals(JSON.parse(payload).context, "ops::admin::team");
  assert(payload.startsWith("{"));
  assertFalse(payload.includes("HierarchyCertificate::"));
  assertFalse(payload === getHierarchySignaturePayload(shiftedFields));
});

Deno.test("HierarchyCertificate: loop and single-master validation", () => {
  const existing = [
    { masterFingerprint: "A", childFingerprint: "B" },
    { masterFingerprint: "B", childFingerprint: "C" },
  ];

  const loop = validateHierarchy(existing, {
    masterFingerprint: "C",
    childFingerprint: "A",
  });
  assertFalse(loop.ok);

  const duplicateMaster = validateHierarchy(existing, {
    masterFingerprint: "X",
    childFingerprint: "C",
  });
  assertFalse(duplicateMaster.ok);

  const valid = validateHierarchy(existing, {
    masterFingerprint: "C",
    childFingerprint: "D",
  });
  assert(valid.ok);
});
