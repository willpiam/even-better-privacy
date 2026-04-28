import { DilithiumSigningKey } from "./Dilithium.ts";
import { SphincsSigningKey } from "./Sphincs.ts";
import {
  buildLegacyMessageHashEnvelopeFromHash,
  buildPurposeHashEnvelope,
  sha256Hex,
} from "./MessageHash.ts";
import { stringToHex, hexToString, toHex } from "./Hex.ts";
import { canonicalJsonStringify } from "./CanonicalJson.ts";

const textEncoder = new TextEncoder();

export const MAX_CONTEXT_LENGTH = 256;
export const HIERARCHY_CERTIFICATE_PREFIX = "HierarchyCertificate";

export interface HierarchyCertificateData {
  masterFingerprint: string;
  childFingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
  salt: string;
  masterSignature: string | null;
  childSignature: string | null;
}

export interface SignedHierarchyCertificate extends HierarchyCertificateData {
  masterSignature: string;
  childSignature: string;
}

export type HierarchySignerIdentity = {
  fingerprint: string;
  signingKeyType: "dilithium" | "sphincs";
  signingKey: string;
  signingKeyDetails: { variant: string } & Record<string, unknown>;
};

export type HierarchyValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function createHierarchyCertificate(
  masterFingerprint: string,
  childFingerprint: string,
  options?: { timestamp?: number; expiry?: number; context?: string; salt?: string },
): HierarchyCertificateData {
  if (masterFingerprint === childFingerprint) {
    throw new Error("master and child fingerprints must differ");
  }

  const context = options?.context ?? "";
  if (context.length > MAX_CONTEXT_LENGTH) {
    throw new Error(`context exceeds maximum length (${MAX_CONTEXT_LENGTH})`);
  }

  const expiry = options?.expiry ?? 0;
  if (!Number.isFinite(expiry) || expiry < 0) {
    throw new Error("expiry must be 0 or a positive unix timestamp in milliseconds");
  }

  const timestamp = options?.timestamp ?? Date.now();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("timestamp must be a positive unix timestamp in milliseconds");
  }

  return {
    masterFingerprint,
    childFingerprint,
    timestamp,
    expiry,
    context,
    salt: options?.salt ?? randomSaltHex(16),
    masterSignature: null,
    childSignature: null,
  };
}

export function getHierarchySignaturePayload(cert: Pick<
  HierarchyCertificateData,
  "masterFingerprint" | "childFingerprint" | "timestamp" | "expiry" | "context" | "salt"
>): string {
  return canonicalJsonStringify({
    type: HIERARCHY_CERTIFICATE_PREFIX,
    masterFingerprint: cert.masterFingerprint,
    childFingerprint: cert.childFingerprint,
    timestamp: cert.timestamp,
    expiry: cert.expiry,
    context: cert.context,
    salt: cert.salt,
  });
}

export function encodeHierarchyCertificate(cert: SignedHierarchyCertificate): string {
  return stringToHex(canonicalJsonStringify(cert));
}

export function decodeHierarchyCertificate(encoded: string): SignedHierarchyCertificate | null {
  try {
    const json = hexToString(encoded);
    const cert = JSON.parse(json) as SignedHierarchyCertificate;
    const valid = validateCertificateShape(cert, true);
    return valid.ok ? cert : null;
  } catch {
    return null;
  }
}

export function verifyHierarchyCertificate(
  cert: SignedHierarchyCertificate,
  masterIdentity: HierarchySignerIdentity,
  childIdentity: HierarchySignerIdentity,
): HierarchyValidationResult {
  const shapeResult = validateCertificateShape(cert, true);
  if (!shapeResult.ok) return shapeResult;

  if (masterIdentity.fingerprint !== cert.masterFingerprint) {
    return { ok: false, error: "master identity fingerprint mismatch" };
  }
  if (childIdentity.fingerprint !== cert.childFingerprint) {
    return { ok: false, error: "child identity fingerprint mismatch" };
  }

  const masterVariant = masterIdentity.signingKeyDetails?.variant;
  const childVariant = childIdentity.signingKeyDetails?.variant;
  if (!masterVariant || !childVariant) {
    return { ok: false, error: "missing signing variant" };
  }

  const payload = getHierarchySignaturePayload(cert);
  const envelope = buildPurposeHashEnvelope("hierarchy", payload);
  const legacyEnvelope = buildLegacyMessageHashEnvelopeFromHash(sha256Hex(payload));

  const masterOk = verifySignature(
    masterIdentity.signingKeyType,
    masterVariant,
    envelope,
    legacyEnvelope,
    cert.masterSignature,
    masterIdentity.signingKey,
  );
  if (!masterOk) {
    return { ok: false, error: "invalid master signature" };
  }

  const childOk = verifySignature(
    childIdentity.signingKeyType,
    childVariant,
    envelope,
    legacyEnvelope,
    cert.childSignature,
    childIdentity.signingKey,
  );
  if (!childOk) {
    return { ok: false, error: "invalid child signature" };
  }

  return { ok: true };
}

export function decodeAndVerifyHierarchyCertificate(
  encodedCertificate: string,
  masterIdentity: HierarchySignerIdentity,
  childIdentity: HierarchySignerIdentity,
): { ok: true; certificate: SignedHierarchyCertificate } | { ok: false; error: string } {
  const cert = decodeHierarchyCertificate(encodedCertificate);
  if (!cert) {
    return { ok: false, error: "invalid certificate encoding" };
  }
  const result = verifyHierarchyCertificate(cert, masterIdentity, childIdentity);
  if (!result.ok) return result;
  return { ok: true, certificate: cert };
}

export function isHierarchyCertificateExpired(
  cert: Pick<HierarchyCertificateData, "expiry">,
  now: number = Date.now(),
): boolean {
  return cert.expiry !== 0 && cert.expiry <= now;
}

export function validateHierarchy(
  certificates: Array<Pick<HierarchyCertificateData, "masterFingerprint" | "childFingerprint">>,
  proposed?: Pick<HierarchyCertificateData, "masterFingerprint" | "childFingerprint">,
): HierarchyValidationResult {
  const childToMaster = new Map<string, string>();
  for (const cert of certificates) {
    if (cert.masterFingerprint === cert.childFingerprint) {
      return { ok: false, error: "hierarchy cannot contain self-parenting relationships" };
    }
    if (childToMaster.has(cert.childFingerprint)) {
      return { ok: false, error: `child already has a master: ${cert.childFingerprint}` };
    }
    childToMaster.set(cert.childFingerprint, cert.masterFingerprint);
  }

  const edge = proposed;
  if (!edge) {
    return hasCycle(childToMaster)
      ? { ok: false, error: "hierarchy contains a loop" }
      : { ok: true };
  }

  if (edge.masterFingerprint === edge.childFingerprint) {
    return { ok: false, error: "master and child fingerprints must differ" };
  }
  if (childToMaster.has(edge.childFingerprint)) {
    return { ok: false, error: "child already has a master" };
  }

  let current: string | undefined = edge.masterFingerprint;
  const seen = new Set<string>([edge.childFingerprint]);
  while (current) {
    if (seen.has(current)) {
      return { ok: false, error: "hierarchy loop detected" };
    }
    seen.add(current);
    current = childToMaster.get(current);
  }
  return { ok: true };
}

function randomSaltHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function verifySignature(
  signingKeyType: "dilithium" | "sphincs",
  variant: string,
  envelope: string,
  legacyEnvelope: string,
  signature: string,
  signingKey: string,
): boolean {
  try {
    if (signingKeyType === "dilithium") {
      return DilithiumSigningKey.verify(variant, envelope, signature, signingKey)
        || DilithiumSigningKey.verify(variant, legacyEnvelope, signature, signingKey);
    }
    return SphincsSigningKey.verify(variant, envelope, signature, signingKey)
      || SphincsSigningKey.verify(variant, legacyEnvelope, signature, signingKey);
  } catch {
    return false;
  }
}

function validateCertificateShape(
  cert: HierarchyCertificateData | SignedHierarchyCertificate,
  requireSignatures: boolean,
): HierarchyValidationResult {
  if (!cert || typeof cert !== "object") {
    return { ok: false, error: "certificate must be an object" };
  }
  if (typeof cert.masterFingerprint !== "string" || cert.masterFingerprint.length === 0) {
    return { ok: false, error: "missing master fingerprint" };
  }
  if (typeof cert.childFingerprint !== "string" || cert.childFingerprint.length === 0) {
    return { ok: false, error: "missing child fingerprint" };
  }
  if (cert.masterFingerprint === cert.childFingerprint) {
    return { ok: false, error: "master and child fingerprints must differ" };
  }
  if (typeof cert.timestamp !== "number" || !Number.isFinite(cert.timestamp) || cert.timestamp < 0) {
    return { ok: false, error: "invalid timestamp" };
  }
  if (typeof cert.expiry !== "number" || !Number.isFinite(cert.expiry) || cert.expiry < 0) {
    return { ok: false, error: "invalid expiry" };
  }
  if (typeof cert.context !== "string" || cert.context.length > MAX_CONTEXT_LENGTH) {
    return { ok: false, error: "invalid context" };
  }
  if (typeof cert.salt !== "string" || cert.salt.length === 0) {
    return { ok: false, error: "invalid salt" };
  }

  if (requireSignatures) {
    if (typeof cert.masterSignature !== "string" || cert.masterSignature.length === 0) {
      return { ok: false, error: "missing master signature" };
    }
    if (typeof cert.childSignature !== "string" || cert.childSignature.length === 0) {
      return { ok: false, error: "missing child signature" };
    }
  }
  return { ok: true };
}

function hasCycle(childToMaster: Map<string, string>): boolean {
  for (const child of childToMaster.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = child;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = childToMaster.get(current);
    }
  }
  return false;
}
