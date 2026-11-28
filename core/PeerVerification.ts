import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { canonicalJsonStringify } from "./CanonicalJson.ts";
import { randomHex } from "./CryptoUtils.ts";
import { externalIdentityFromEmbeddedRecord } from "./EmbeddedIdentity.ts";
import type { ExternalIdentity } from "./ExternalIdentity.ts";
import { Identity } from "./Identity.ts";
import { sha256Hex } from "./MessageHash.ts";
import { parseStrictJson } from "./StrictJson.ts";

type PublicKeys = Pick<
  ExternalIdentity,
  | "fingerprint"
  | "signingKeyType"
  | "signingKey"
  | "signingKeyDetails"
  | "encryptionKeyType"
  | "encryptionKey"
  | "encryptionKeyDetails"
>;

export type VerificationOffer = {
  identity: ExternalIdentity;
  name: string;
  nonce: string;
};

export type VerificationProof = {
  fingerprint: string;
  session: string;
  signature: string;
};

type Endorsement = {
  issuer: string;
  subject: string;
  name: string;
  createdAt: number;
  nonce: string;
  signature: string;
};

type Withdrawal = {
  endorsementId: string;
  signature: string;
};

export type EndorsementBundle = {
  version: 1;
  issuer: ExternalIdentity;
  subject: ExternalIdentity;
  endorsement: Endorsement;
  withdrawal?: Withdrawal;
};

export const MAX_ENDORSEMENT_BYTES = 150_000;
export const VERIFICATION_SESSION_MS = 10 * 60 * 1000;
export const VERIFIED_NAME_LIMIT = 64;

const purpose = "peer-verification";
const hex32 = /^[0-9a-f]{32}$/;
const hex64 = /^[0-9a-f]{64}$/;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid verification record.");
  }
  return value as Record<string, unknown>;
}

function publicIdentity(value: unknown): ExternalIdentity {
  const record = asRecord(value);
  const keys = externalIdentityFromEmbeddedRecord(record);
  if (!keys || keys.fingerprint !== record.fingerprint) {
    throw new Error("Public keys do not match the fingerprint.");
  }
  return {
    fingerprint: keys.fingerprint,
    signingKeyType: keys.signingKeyType,
    signingKey: keys.signingKey,
    signingKeyDetails: { variant: keys.signingKeyDetails.variant },
    encryptionKeyType: keys.encryptionKeyType,
    encryptionKey: keys.encryptionKey.toLowerCase(),
    encryptionKeyDetails: { variant: keys.encryptionKeyDetails.variant },
    details: {},
  };
}

function nameClaim(value: unknown): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > VERIFIED_NAME_LIMIT ||
    /[\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw new Error("Enter a valid name or handle to verify.");
  }
  return value.trim();
}

export function createVerificationOffer(
  keys: PublicKeys,
  name: string,
): VerificationOffer {
  return {
    identity: publicIdentity(keys),
    name: nameClaim(name),
    nonce: randomHex(32),
  };
}

export function parseVerificationOffer(raw: string): VerificationOffer {
  const { identity, name, nonce } = asRecord(parseStrictJson(raw));
  if (typeof nonce !== "string" || !hex64.test(nonce)) {
    throw new Error("Invalid verification challenge.");
  }
  return { identity: publicIdentity(identity), name: nameClaim(name), nonce };
}

export function verificationSession(
  a: VerificationOffer,
  b: VerificationOffer,
): string {
  if (a.identity.fingerprint === b.identity.fingerprint) {
    throw new Error("Choose two different identities.");
  }
  const participants = [a, b].map(({ identity, nonce, name }) => ({
    fingerprint: identity.fingerprint,
    nonce,
    name,
  })).sort((left, right) => left.fingerprint < right.fingerprint ? -1 : 1);
  return sha256Hex(
    canonicalJsonStringify({ type: "peer-session", version: 1, participants }),
  );
}

export function verificationCode(session: string): string {
  return session.slice(0, 32).match(/.{4}/g)?.join(" ").toUpperCase() ?? "";
}

function proofPayload(fingerprint: string, session: string): string {
  return canonicalJsonStringify({
    type: "peer-proof",
    version: 1,
    fingerprint,
    session,
  });
}

export function signVerificationProof(
  identity: Identity,
  own: VerificationOffer,
  peer: VerificationOffer,
): VerificationProof {
  const fingerprint = identity.toFingerprint();
  if (fingerprint !== own.identity.fingerprint || identity.isRevoked()) {
    throw new Error(
      "The verification identity changed or was revoked. Start over.",
    );
  }
  const session = verificationSession(own, peer);
  const signature = identity.signMessage(
    proofPayload(fingerprint, session),
    undefined,
    purpose,
  );
  return { fingerprint, session, signature };
}

function hasValidSignature(
  signer: ExternalIdentity,
  payload: string,
  signature: unknown,
): signature is string {
  if (
    typeof signature !== "string" || signature.length === 0 ||
    signature.length > 66_476
  ) return false;
  try {
    if (bytesToBase64(base64ToBytes(signature)) !== signature) return false;
    return Identity.VerifySignature(
      signer,
      payload,
      signature,
      undefined,
      purpose,
    );
  } catch {
    return false;
  }
}

export function verifyPeerProof(
  raw: string,
  own: VerificationOffer,
  peer: VerificationOffer,
): VerificationProof {
  const { fingerprint, session, signature } = asRecord(parseStrictJson(raw));
  const expected = verificationSession(own, peer);
  const signer = peer.identity.fingerprint;
  if (
    fingerprint !== signer || session !== expected ||
    !hasValidSignature(peer.identity, proofPayload(signer, expected), signature)
  ) {
    throw new Error("The proof does not match this verification session.");
  }
  return { fingerprint: signer, session: expected, signature };
}

function endorsementPayload(
  endorsement: Omit<Endorsement, "signature">,
): string {
  const { issuer, subject, name, createdAt, nonce } = endorsement;
  return canonicalJsonStringify({
    type: "in-person-endorsement",
    version: 1,
    issuer,
    subject,
    name,
    createdAt,
    nonce,
  });
}

export function endorsementId(endorsement: Endorsement): string {
  return sha256Hex(endorsementPayload(endorsement));
}

export function signEndorsement(
  identity: Identity,
  own: VerificationOffer,
  peer: VerificationOffer,
  proof: VerificationProof,
  name: string,
): EndorsementBundle {
  const issuer = publicIdentity(own.identity);
  const subject = publicIdentity(peer.identity);
  if (identity.toFingerprint() !== issuer.fingerprint || identity.isRevoked()) {
    throw new Error(
      "The verification identity changed or was revoked. Start over.",
    );
  }
  verifyPeerProof(JSON.stringify(proof), own, peer);
  const claim = {
    issuer: issuer.fingerprint,
    subject: subject.fingerprint,
    name: nameClaim(name),
    createdAt: Date.now(),
    nonce: randomHex(16),
  };
  return {
    version: 1,
    issuer,
    subject,
    endorsement: {
      ...claim,
      signature: identity.signMessage(
        endorsementPayload(claim),
        undefined,
        purpose,
      ),
    },
  };
}

function withdrawalPayload(id: string): string {
  return canonicalJsonStringify({
    type: "endorsement-withdrawal",
    version: 1,
    endorsementId: id,
  });
}

export function withdrawEndorsement(
  identity: Identity,
  bundle: EndorsementBundle,
): EndorsementBundle {
  if (identity.toFingerprint() !== bundle.endorsement.issuer) {
    throw new Error(
      "Only the identity that signed the endorsement can withdraw it.",
    );
  }
  if (bundle.withdrawal) return bundle;
  const id = endorsementId(bundle.endorsement);
  return {
    ...bundle,
    withdrawal: {
      endorsementId: id,
      signature: identity.signMessage(
        withdrawalPayload(id),
        undefined,
        purpose,
      ),
    },
  };
}

export function parseEndorsement(raw: string): EndorsementBundle {
  if (raw.length > MAX_ENDORSEMENT_BYTES) {
    throw new Error("The endorsement file is too large.");
  }
  const data = asRecord(parseStrictJson(raw));
  if (data.version !== 1) throw new Error("Unsupported endorsement version.");
  const issuer = publicIdentity(data.issuer);
  const subject = publicIdentity(data.subject);
  const claim = asRecord(data.endorsement);
  const name = nameClaim(claim.name);
  const { createdAt, nonce, signature } = claim;
  if (
    claim.issuer !== issuer.fingerprint ||
    claim.subject !== subject.fingerprint ||
    issuer.fingerprint === subject.fingerprint || name !== claim.name ||
    typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) ||
    createdAt < 0 || createdAt > 8.64e15 ||
    typeof nonce !== "string" || !hex32.test(nonce)
  ) {
    throw new Error("Invalid endorsement claim.");
  }
  const fields = {
    issuer: issuer.fingerprint,
    subject: subject.fingerprint,
    name,
    createdAt,
    nonce,
  };
  if (!hasValidSignature(issuer, endorsementPayload(fields), signature)) {
    throw new Error("Invalid endorsement signature.");
  }
  const endorsement = { ...fields, signature };
  const bundle: EndorsementBundle = {
    version: 1,
    issuer,
    subject,
    endorsement,
  };
  if (data.withdrawal !== undefined) {
    const withdrawal = asRecord(data.withdrawal);
    const id = endorsementId(endorsement);
    if (
      withdrawal.endorsementId !== id ||
      !hasValidSignature(issuer, withdrawalPayload(id), withdrawal.signature)
    ) {
      throw new Error("Invalid endorsement withdrawal.");
    }
    bundle.withdrawal = { endorsementId: id, signature: withdrawal.signature };
  }
  return bundle;
}
