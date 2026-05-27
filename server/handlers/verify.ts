import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import {
  buildMessageHashEnvelopeFromHash,
  sha256Hex,
} from "../../core/MessageHash.ts";
import { LIMITS, readJsonBody, validateStringLength } from "../body.ts";
import { json } from "../response.ts";
import {
  getDetailsMap,
  getDetailsMetaMap,
  getIdentity,
  getRevokedDetailPaths,
  isIdentityRevoked,
} from "../db/index.ts";
import type { DatabaseAdapter } from "../db/index.ts";
import { computeIdentityFingerprint } from "../crypto.ts";

export type VerifyInput = {
  message: string;
  messageHash: string;
  salt: string;
  signature: string;
  fingerprint: string | null;
  publicIdentity: {
    signingKeyType: "dilithium" | "sphincs";
    signingKey: string;
    signingVariant: string;
    fingerprint: string | null;
  } | null;
};

export function parseVerifyInput(
  payload: Record<string, unknown>,
): { ok: true; data: VerifyInput } | { ok: false; error: string } {
  const bodyPayload = payload.payload;
  const bodyMessage = payload.message;
  const bodySignature = payload.signature;
  const bodyPublicIdentity = payload.publicIdentity ?? payload.identity;

  const messageOverride = typeof bodyMessage === "string" ? bodyMessage : "";
  const signatureOverride = typeof bodySignature === "string"
    ? bodySignature
    : "";

  let message = "";
  let messageHash = "";
  let salt = "";
  let signature = "";
  let fingerprint: string | null = null;
  let payloadPublicIdentity: unknown = null;

  if (bodyPayload && typeof bodyPayload === "object") {
    const obj = bodyPayload as Record<string, unknown>;
    payloadPublicIdentity = obj.publicIdentity ?? obj.identity ?? null;
    const payloadMessage = typeof obj.message === "string" ? obj.message : "";
    const payloadMessageHash = typeof obj.messageHash === "string"
      ? obj.messageHash
      : "";
    const payloadSalt = typeof obj.salt === "string" ? obj.salt : "";
    const payloadSignature = typeof obj.signature === "string"
      ? obj.signature
      : "";
    const payloadFingerprint = typeof obj.fingerprint === "string"
      ? obj.fingerprint
      : "";
    const payloadType = typeof obj.type === "string" ? obj.type : "";

    if (payloadType === "ebp-signed-message") {
      message = payloadMessage || messageOverride;
      messageHash = payloadMessageHash;
      salt = payloadSalt;
      signature = payloadSignature || signatureOverride;
      fingerprint = payloadFingerprint || null;
      if (!message) return { ok: false, error: "missing message" };
      if (!messageHash) return { ok: false, error: "missing messageHash" };
      if (!signature) return { ok: false, error: "missing signature" };
      if (sha256Hex(message) !== messageHash) {
        return { ok: false, error: "message hash mismatch" };
      }
    } else if (payloadType === "ebp-signature") {
      message = payloadMessage || messageOverride;
      messageHash = payloadMessageHash;
      salt = payloadSalt;
      signature = payloadSignature || signatureOverride;
      fingerprint = payloadFingerprint || null;
      if (!message) {
        return {
          ok: false,
          error: "message is required for detached signatures",
        };
      }
      if (!messageHash) return { ok: false, error: "missing messageHash" };
      if (!signature) return { ok: false, error: "missing signature" };
      if (sha256Hex(message) !== messageHash) {
        return { ok: false, error: "message hash mismatch" };
      }
    } else {
      return { ok: false, error: "unsupported payload type" };
    }
  } else {
    message = messageOverride;
    messageHash = typeof payload.messageHash === "string"
      ? payload.messageHash
      : "";
    salt = typeof payload.salt === "string" ? payload.salt : "";
    signature = signatureOverride;
    fingerprint = typeof payload.fingerprint === "string"
      ? payload.fingerprint
      : null;
    if (!message || !signature || !messageHash) {
      return {
        ok: false,
        error: "message, messageHash, and signature required",
      };
    }
    if (sha256Hex(message) !== messageHash) {
      return { ok: false, error: "message hash mismatch" };
    }
  }

  const messageCheck = validateStringLength(message, "message", LIMITS.message);
  if (!messageCheck.ok) return { ok: false, error: messageCheck.error };
  const messageHashCheck = validateStringLength(messageHash, "messageHash", 64);
  if (!messageHashCheck.ok) return { ok: false, error: messageHashCheck.error };
  if (!/^[0-9a-f]{64}$/i.test(messageHashCheck.value)) {
    return {
      ok: false,
      error: "messageHash must be a 64-character hex string",
    };
  }
  const saltCheck = validateStringLength(salt, "salt", 256, false);
  if (!saltCheck.ok) return { ok: false, error: saltCheck.error };
  const signatureCheck = validateStringLength(
    signature,
    "signature",
    LIMITS.signature,
  );
  if (!signatureCheck.ok) return { ok: false, error: signatureCheck.error };
  const fingerprintCheck = validateStringLength(
    fingerprint,
    "fingerprint",
    LIMITS.fingerprint,
    false,
  );
  if (!fingerprintCheck.ok) return { ok: false, error: fingerprintCheck.error };
  if (
    fingerprintCheck.value && !isValidFingerprintBech32(fingerprintCheck.value)
  ) {
    return { ok: false, error: "fingerprint must be valid bech32" };
  }

  const chosenPublicIdentity = bodyPublicIdentity ?? payloadPublicIdentity;
  let publicIdentity: VerifyInput["publicIdentity"] = null;
  if (chosenPublicIdentity !== null && chosenPublicIdentity !== undefined) {
    if (typeof chosenPublicIdentity !== "object") {
      return { ok: false, error: "publicIdentity must be an object" };
    }
    const candidate = chosenPublicIdentity as Record<string, unknown>;
    const signingKeyType = candidate.signingKeyType;
    const signingKey = candidate.signingKey;
    const signingKeyDetails = candidate.signingKeyDetails;
    const fingerprintFromIdentity = candidate.fingerprint;

    if (signingKeyType !== "dilithium" && signingKeyType !== "sphincs") {
      return {
        ok: false,
        error: "publicIdentity has invalid signing key type",
      };
    }
    if (typeof signingKey !== "string" || !signingKey) {
      return { ok: false, error: "publicIdentity missing signing key" };
    }
    if (!signingKeyDetails || typeof signingKeyDetails !== "object") {
      return { ok: false, error: "publicIdentity missing signing key details" };
    }
    const signingVariant =
      (signingKeyDetails as Record<string, unknown>).variant;
    if (typeof signingVariant !== "string" || !signingVariant) {
      return { ok: false, error: "publicIdentity missing signing variant" };
    }

    const payloadFingerprint = fingerprintCheck.value || null;
    const providedIdentityFingerprint =
      typeof fingerprintFromIdentity === "string"
        ? fingerprintFromIdentity
        : null;
    let computedFingerprint: string | null = null;
    const encryptionKeyType = candidate.encryptionKeyType;
    const encryptionKey = candidate.encryptionKey;
    const encryptionKeyHash = candidate.encryptionKeyHash;
    if (
      encryptionKeyType === "kyber" &&
      ((typeof encryptionKey === "string" && encryptionKey) ||
        (typeof encryptionKeyHash === "string" && encryptionKeyHash))
    ) {
      try {
        computedFingerprint = computeIdentityFingerprint({
          signingKeyType,
          encryptionKeyType: "kyber",
          signingKey,
          encryptionKey: typeof encryptionKey === "string"
            ? encryptionKey
            : undefined,
          encryptionKeyHash: typeof encryptionKeyHash === "string"
            ? encryptionKeyHash
            : undefined,
        });
      } catch {
        return {
          ok: false,
          error:
            "failed to compute fingerprint from provided public identity keys",
        };
      }
    }

    if (
      providedIdentityFingerprint && computedFingerprint &&
      providedIdentityFingerprint !== computedFingerprint
    ) {
      return {
        ok: false,
        error:
          "public identity fingerprint does not match provided public keys",
      };
    }

    const resolvedFingerprint = providedIdentityFingerprint ??
      computedFingerprint;
    if (
      resolvedFingerprint && payloadFingerprint &&
      resolvedFingerprint !== payloadFingerprint
    ) {
      return {
        ok: false,
        error:
          "fingerprint mismatch between payload and provided public identity",
      };
    }

    const resolvedFingerprintCheck = validateStringLength(
      resolvedFingerprint,
      "publicIdentity fingerprint",
      LIMITS.fingerprint,
      false,
    );
    if (!resolvedFingerprintCheck.ok) {
      return { ok: false, error: resolvedFingerprintCheck.error };
    }
    if (
      resolvedFingerprintCheck.value &&
      !isValidFingerprintBech32(resolvedFingerprintCheck.value)
    ) {
      return {
        ok: false,
        error: "publicIdentity fingerprint must be valid bech32",
      };
    }

    publicIdentity = {
      signingKeyType,
      signingKey,
      signingVariant,
      fingerprint: resolvedFingerprintCheck.value || null,
    };
  }

  const resolvedFingerprint = publicIdentity?.fingerprint ??
    (fingerprintCheck.value || null);
  return {
    ok: true,
    data: {
      message: messageCheck.value,
      messageHash: messageHashCheck.value,
      salt: saltCheck.value,
      signature: signatureCheck.value,
      fingerprint: resolvedFingerprint,
      publicIdentity,
    },
  };
}

export function verifySignatureWithIdentity(
  signingKeyType: "dilithium" | "sphincs",
  variant: string,
  messageHash: string,
  salt: string,
  signature: string,
  signingKey: string,
): boolean {
  const envelope = buildMessageHashEnvelopeFromHash(messageHash, salt);
  if (signingKeyType === "dilithium") {
    return DilithiumSigningKey.verify(variant, envelope, signature, signingKey);
  }
  return SphincsSigningKey.verify(variant, envelope, signature, signingKey);
}

export async function handleVerifySignature(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }

  const parsed = parseVerifyInput(bodyResult.data);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  const { messageHash, salt, signature, fingerprint, publicIdentity } =
    parsed.data;

  let signerIdentity: {
    fingerprint: string;
    signingKeyType: "dilithium" | "sphincs";
    signingKey: string;
    signingVariant: string;
  } | null = null;

  if (publicIdentity) {
    signerIdentity = {
      fingerprint: publicIdentity.fingerprint ?? (fingerprint ?? ""),
      signingKeyType: publicIdentity.signingKeyType,
      signingKey: publicIdentity.signingKey,
      signingVariant: publicIdentity.signingVariant,
    };
  } else {
    if (!fingerprint) {
      return json({
        error: "fingerprint or publicIdentity is required for verification",
      }, 400);
    }
    const identity = await getIdentity(db, fingerprint);
    if (!identity) {
      return json({ error: "identity not found" }, 404);
    }
    const signingVariant =
      (identity.signing_key_details as { variant?: string } | null)?.variant;
    if (!signingVariant || typeof signingVariant !== "string") {
      return json({ error: "missing signing variant for identity" }, 400);
    }
    signerIdentity = {
      fingerprint,
      signingKeyType: identity.signing_key_type as "dilithium" | "sphincs",
      signingKey: identity.signing_key,
      signingVariant,
    };
  }

  let verified = false;
  try {
    verified = verifySignatureWithIdentity(
      signerIdentity.signingKeyType,
      signerIdentity.signingVariant,
      messageHash,
      salt,
      signature,
      signerIdentity.signingKey,
    );
  } catch {
    verified = false;
  }

  if (!verified) {
    return json({
      verified: false,
      fingerprint: signerIdentity.fingerprint || null,
      identityPublished: false,
      message: "Signature is invalid.",
    });
  }

  const resolvedFingerprint = signerIdentity.fingerprint || null;
  if (!resolvedFingerprint) {
    return json({
      verified: true,
      fingerprint: null,
      identityPublished: false,
      message: "Signature verified, but signer fingerprint is unavailable.",
    });
  }

  const publishedIdentity = await getIdentity(db, resolvedFingerprint);
  if (!publishedIdentity) {
    return json({
      verified: true,
      fingerprint: resolvedFingerprint,
      identityPublished: false,
      message:
        `Signature verified with ${resolvedFingerprint}, but identity was not found on this server.`,
    });
  }

  const details = await getDetailsMap(db, resolvedFingerprint);
  const detailsMeta = await getDetailsMetaMap(db, resolvedFingerprint);
  const revoked = await isIdentityRevoked(db, resolvedFingerprint);
  const revokedDetails = await getRevokedDetailPaths(db, resolvedFingerprint);

  return json({
    verified: true,
    fingerprint: resolvedFingerprint,
    identityPublished: true,
    message: `Signature verified with ${resolvedFingerprint}.`,
    signer: {
      fingerprint: resolvedFingerprint,
      signingKeyType: publishedIdentity.signing_key_type,
      encryptionKeyType: publishedIdentity.encryption_key_type,
      details,
      detailsMeta,
      revoked,
      revokedDetails,
    },
  });
}
