import { SphincsSigningKey } from "../../core/Sphincs.ts";
import {
  computeIdentityFingerprint,
  computeStateHash,
  stableStringify,
  toHex,
} from "../crypto.ts";
import type { IdentityRow } from "../types.ts";
import { buildMessageHashEnvelope, buildMessageHashEnvelopeFromHash, sha256Hex } from "../../core/MessageHash.ts";

const textEncoder = new TextEncoder();

type SigningKeyLike = {
  variant: string;
  sign: (message: string) => string;
  publicKey: string;
};

export function createSphincsIdentity(): { identity: IdentityRow; signingKey: SphincsSigningKey } {
  const signingKey = new SphincsSigningKey();
  const encryptionKey = "enc-key-deadbeef";
  const createdAt = Date.now();

  const identity: IdentityRow = {
    fingerprint: "",
    signing_key_type: "sphincs",
    encryption_key_type: "kyber",
    signing_key: signingKey.publicKey,
    encryption_key: encryptionKey,
    signing_key_details: { variant: signingKey.variant },
    encryption_key_details: null,
    created_at: createdAt,
  };

  identity.fingerprint = computeIdentityFingerprint({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: identity.signing_key,
    encryptionKey: identity.encryption_key,
  });

  return { identity, signingKey };
}

export function encodeProof(record: Record<string, unknown>): string {
  return toHex(textEncoder.encode(JSON.stringify(record)));
}

export function createIdentityPayload(): {
  payload: Record<string, unknown>;
  fingerprint: string;
  signingKey: SphincsSigningKey;
} {
  const signingKey = new SphincsSigningKey();
  const encryptionKey = `enc-${crypto.randomUUID()}`;

  const fingerprint = computeIdentityFingerprint({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: signingKey.publicKey,
    encryptionKey,
  });

  const toState = computeStateHash({
    fingerprint,
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: signingKey.publicKey,
    encryptionKey,
    signingKeyDetails: { variant: signingKey.variant },
    encryptionKeyDetails: null,
    details: {},
  });

  const transitionMessage = stableStringify({ fromState: null, toState });
  const stateSignature = signingKey.sign(buildMessageHashEnvelope(transitionMessage));

  return {
    payload: {
      signingKeyType: "sphincs",
      encryptionKeyType: "kyber",
      signingKey: signingKey.publicKey,
      encryptionKey,
      signingKeyDetails: { variant: signingKey.variant },
      encryptionKeyDetails: null,
      toState,
      fromState: null,
      stateSignature,
      fingerprint,
    },
    fingerprint,
    signingKey,
  };
}

export function createSignedProof(
  signingKey: SigningKeyLike,
  record: { nonce: number; path: string; detail: string; timestamp: number },
): { proof: string; record: Record<string, unknown> } {
  const payload = {
    nonce: record.nonce,
    path: record.path,
    detail: record.detail,
    timestamp: record.timestamp,
    signature: null as string | null,
  };

  const signature = signingKey.sign(buildMessageHashEnvelope(JSON.stringify(payload)));
  const signedRecord = { ...payload, signature };

  return { proof: encodeProof(signedRecord), record: signedRecord };
}

export function createRevocationCertificate(
  signingKey: SphincsSigningKey,
  data: {
    type: "detail" | "identity";
    fingerprint: string;
    nonce: number;
    timestamp: number;
    reason?: string;
    target?: string;
  },
): string {
  const payload = {
    type: data.type,
    fingerprint: data.fingerprint,
    nonce: data.nonce,
    timestamp: data.timestamp,
    reason: data.reason,
    target: data.target,
    signature: null,
  };

  const signature = signingKey.sign(buildMessageHashEnvelope(JSON.stringify(payload)));
  const signedCert = { ...payload, signature };

  return toHex(textEncoder.encode(JSON.stringify(signedCert)));
}

export function signHashedMessage(
  signingKey: SigningKeyLike,
  message: string,
  salt = "",
): { messageHash: string; salt: string; signature: string } {
  const messageHash = sha256Hex(message);
  const envelope = buildMessageHashEnvelopeFromHash(messageHash, salt);
  return {
    messageHash,
    salt,
    signature: signingKey.sign(envelope),
  };
}
