import { type ExternalIdentity, Identity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { buildMailAuthenticityFields } from "../../common/MailAuthenticity.ts";
import {
  buildDetachedSignaturePayload,
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
  buildSignedMessagePayload,
} from "../../core/Payloads.ts";
import { parseMultiRecipientEntries } from "../../core/PayloadInput.ts";
import { apiUrl, getContext } from "../../cli/utils.ts";
import { HttpError, json, randomHex, readJson, STATUS } from "./http.ts";
import { loadIdentityForRequest } from "./unlock-session.ts";
import {
  computeExternalFingerprint,
  listContacts,
  loadContact,
} from "./contacts.ts";
import { tryResolveSenderForCtx } from "./sender-context.ts";
import {
  extractEmailAddress,
  getIdentityDetailMeta,
  getIdentityDetailValue,
} from "./mail-imap.ts";

export async function handleMessageRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/sign") {
    const body = await readJson<{
      message?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      detached?: unknown;
      includeIdentity?: unknown;
      includeSalt?: unknown;
      salt?: unknown;
      signConfirmation?: unknown;
    }>(req);
    const message = typeof body.message === "string" ? body.message : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const detached = Boolean(body.detached);
    const includeIdentity = Boolean(body.includeIdentity);
    const includeSalt = body.includeSalt === undefined
      ? true
      : Boolean(body.includeSalt);
    const providedSalt = typeof body.salt === "string" ? body.salt : undefined;
    const signConfirmation = body.signConfirmation as
      | Record<string, unknown>
      | undefined;
    if (!message) {
      throw new HttpError(STATUS.BadRequest, "message is required");
    }
    if (
      (Deno.env.get("GUI_SIGN_CONFIRM_BYPASS") ?? "false").toLowerCase() !==
        "true"
    ) {
      const approved = signConfirmation?.approved === true;
      const approvedAt = typeof signConfirmation?.approvedAt === "number"
        ? signConfirmation.approvedAt
        : NaN;
      const confirmedMessageHash =
        typeof signConfirmation?.messageHash === "string"
          ? signConfirmation.messageHash
          : "";
      const expectedHash = sha256Hex(message);
      const stale = !Number.isFinite(approvedAt) ||
        Math.abs(Date.now() - approvedAt) > 60_000;
      if (!approved || stale || confirmedMessageHash !== expectedHash) {
        throw new HttpError(
          STATUS.BadRequest,
          "sign confirmation required (approve the exact message immediately before signing)",
        );
      }
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    const salt = providedSalt ?? (includeSalt ? randomHex(16) : "");
    const signature = (identity as Identity & {
      signMessage: (
        value: string,
        optionalSalt?: string,
        purpose?: "message",
      ) => string;
    })
      .signMessage(message, salt, "message");
    const messageHash = sha256Hex(message);
    const summary = identity.summary;
    const identityPayload = includeIdentity
      ? {
        fingerprint: summary.fingerprint,
        signingKeyType: summary.signingKeyType,
        encryptionKeyType: summary.encryptionKeyType,
        signingKey: summary.signingKey,
        encryptionKey: summary.encryptionKey,
        signingKeyDetails: summary.signingKeyDetails,
        encryptionKeyDetails: summary.encryptionKeyDetails,
      }
      : undefined;
    if (detached) {
      return json(buildDetachedSignaturePayload({
        fingerprint: identity.toFingerprint(),
        messageHash,
        salt,
        signature,
        identity: identityPayload,
      }));
    }
    return json(buildSignedMessagePayload({
      fingerprint: identity.toFingerprint(),
      message,
      messageHash,
      salt,
      signature,
      identity: identityPayload,
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/v1/verify") {
    const body = await readJson<{
      payload?: unknown;
      message?: unknown;
      signature?: unknown;
      sender?: unknown;
      home?: unknown;
      publicIdentity?: unknown;
      salt?: unknown;
    }>(req);
    const payload = body.payload;
    const messageOverride = typeof body.message === "string"
      ? body.message
      : undefined;
    const signatureOverride = typeof body.signature === "string"
      ? body.signature
      : undefined;
    const sender = typeof body.sender === "string" ? body.sender : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const publicIdentity = body.publicIdentity;
    if (!payload) {
      throw new HttpError(STATUS.BadRequest, "payload is required");
    }

    const ctx = await getContext(home);
    let message: string;
    let signature: string;
    let fingerprint: string;
    let messageHash: string;
    let salt = "";

    if (typeof payload === "object" && payload && "type" in payload) {
      const obj = payload as Record<string, unknown>;
      if (obj.type === "ebp-signed-message") {
        message = String(obj.message ?? "");
        messageHash = String(obj.messageHash ?? "");
        salt = String(obj.salt ?? "");
        signature = String(obj.signature ?? "");
        fingerprint = String(obj.fingerprint ?? "");
        if (!message || !signature || !messageHash) {
          throw new HttpError(
            STATUS.BadRequest,
            "signed message payload missing required fields",
          );
        }
        if (sha256Hex(message) !== messageHash) {
          throw new HttpError(STATUS.BadRequest, "message hash mismatch");
        }
      } else if (obj.type === "ebp-signature") {
        if (!messageOverride) {
          throw new HttpError(
            STATUS.BadRequest,
            "message is required for detached signatures",
          );
        }
        message = messageOverride;
        messageHash = String(obj.messageHash ?? "");
        salt = String(obj.salt ?? "");
        signature = String(obj.signature ?? "");
        fingerprint = String(obj.fingerprint ?? "");
        if (!signature || !messageHash) {
          throw new HttpError(
            STATUS.BadRequest,
            "detached signature payload missing required fields",
          );
        }
        if (sha256Hex(message) !== messageHash) {
          throw new HttpError(STATUS.BadRequest, "message hash mismatch");
        }
      } else {
        throw new HttpError(STATUS.BadRequest, "unsupported payload type");
      }
    } else {
      if (!messageOverride || !signatureOverride) {
        throw new HttpError(
          STATUS.BadRequest,
          "message and signature required for detached verify",
        );
      }
      message = messageOverride;
      messageHash = sha256Hex(messageOverride);
      salt = typeof body.salt === "string" ? body.salt : "";
      signature = signatureOverride;
      fingerprint = "";
    }

    let contact: ExternalIdentity;
    if (publicIdentity && typeof publicIdentity === "object") {
      const candidate = publicIdentity as Record<string, unknown>;
      const signingKey = typeof candidate.signingKey === "string"
        ? candidate.signingKey
        : "";
      const signingKeyType = typeof candidate.signingKeyType === "string"
        ? candidate.signingKeyType
        : "";
      const encryptionKey = typeof candidate.encryptionKey === "string"
        ? candidate.encryptionKey
        : "";
      const encryptionKeyHash = typeof candidate.encryptionKeyHash === "string"
        ? candidate.encryptionKeyHash
        : "";
      const encryptionKeyType = typeof candidate.encryptionKeyType === "string"
        ? candidate.encryptionKeyType
        : "";
      if (!signingKey || !signingKeyType) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity missing signing key",
        );
      }
      if ((!encryptionKey && !encryptionKeyHash) || !encryptionKeyType) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity missing encryption key or hash",
        );
      }
      if (!["dilithium", "sphincs"].includes(signingKeyType)) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity has invalid signing key type",
        );
      }
      if (encryptionKeyType !== "kyber") {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity has invalid encryption key type",
        );
      }
      contact = {
        fingerprint: typeof candidate.fingerprint === "string"
          ? candidate.fingerprint
          : fingerprint,
        signingKey,
        signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
        signingKeyDetails: (candidate
          .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
          { variant: "ml_dsa87" },
        encryptionKey,
        encryptionKeyHash: encryptionKeyHash || undefined,
        encryptionKeyType: "kyber",
        encryptionKeyDetails: (candidate
          .encryptionKeyDetails as ExternalIdentity[
            "encryptionKeyDetails"
          ]) ?? { variant: "ml_kem1024" },
        details: (candidate.details as ExternalIdentity["details"]) ?? {},
      };
    } else {
      contact = await loadContact(
        ctx,
        sender ?? fingerprint.substring(0, 16),
      );
    }
    const verified = (Identity as typeof Identity & {
      VerifySignature: (
        sender: ExternalIdentity,
        value: string,
        sig: string,
        optionalSalt?: string,
      ) => boolean;
    }).VerifySignature(contact, message, signature, salt);
    return json({ verified });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/v1/identity/fingerprint-from-public"
  ) {
    const body = await readJson<{ publicIdentity?: unknown }>(req);
    const publicIdentity = body.publicIdentity;
    if (!publicIdentity || typeof publicIdentity !== "object") {
      throw new HttpError(
        STATUS.BadRequest,
        "publicIdentity object is required",
      );
    }
    const candidate = publicIdentity as Record<string, unknown>;
    const signingKey = typeof candidate.signingKey === "string"
      ? candidate.signingKey
      : "";
    const signingKeyHash = typeof candidate.signingKeyHash === "string"
      ? candidate.signingKeyHash
      : "";
    const signingKeyType = typeof candidate.signingKeyType === "string"
      ? candidate.signingKeyType
      : "";
    const encryptionKey = typeof candidate.encryptionKey === "string"
      ? candidate.encryptionKey
      : "";
    const encryptionKeyHash = typeof candidate.encryptionKeyHash === "string"
      ? candidate.encryptionKeyHash
      : "";
    const encryptionKeyType = typeof candidate.encryptionKeyType === "string"
      ? candidate.encryptionKeyType
      : "";
    if ((!signingKey && !signingKeyHash) || !signingKeyType) {
      throw new HttpError(
        STATUS.BadRequest,
        "public identity missing signing key or hash",
      );
    }
    if ((!encryptionKey && !encryptionKeyHash) || !encryptionKeyType) {
      throw new HttpError(
        STATUS.BadRequest,
        "public identity missing encryption key or hash",
      );
    }
    if (!["dilithium", "sphincs"].includes(signingKeyType)) {
      throw new HttpError(
        STATUS.BadRequest,
        "public identity has invalid signing key type",
      );
    }
    if (encryptionKeyType !== "kyber") {
      throw new HttpError(
        STATUS.BadRequest,
        "public identity has invalid encryption key type",
      );
    }
    const externalIdentity: ExternalIdentity = {
      fingerprint: typeof candidate.fingerprint === "string"
        ? candidate.fingerprint
        : "",
      signingKey,
      signingKeyHash: signingKeyHash || undefined,
      signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
      signingKeyDetails: (candidate
        .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
        { variant: "ml_dsa87" },
      encryptionKey,
      encryptionKeyHash: encryptionKeyHash || undefined,
      encryptionKeyType: "kyber",
      encryptionKeyDetails: (candidate
        .encryptionKeyDetails as ExternalIdentity[
          "encryptionKeyDetails"
        ]) ?? { variant: "ml_kem1024" },
      details: (candidate.details as ExternalIdentity["details"]) ?? {},
    };
    const computedFingerprint = computeExternalFingerprint(externalIdentity);
    if (!computedFingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "could not compute fingerprint from provided public identity",
      );
    }
    return json({ fingerprint: computedFingerprint });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/encrypt") {
    const body = await readJson<{
      message?: unknown;
      recipient?: unknown;
      sign?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      includePublicKeys?: unknown;
    }>(req);
    const message = typeof body.message === "string" ? body.message : undefined;
    const recipient = typeof body.recipient === "string"
      ? body.recipient
      : undefined;
    const sign = Boolean(body.sign);
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const includePublicKeys = Boolean(body.includePublicKeys);
    if (!message) {
      throw new HttpError(STATUS.BadRequest, "message is required");
    }
    if (!recipient) {
      throw new HttpError(STATUS.BadRequest, "recipient is required");
    }

    const ctx = await getContext(home, identityName);
    const contact = await loadContact(ctx, recipient);

    if (sign) {
      const identity = await loadIdentityForRequest(ctx, password);
      const ciphertext = identity.signAndEncryptFor(message, contact);
      const summary = identity.summary;
      const senderIdentity = includePublicKeys
        ? {
          fingerprint: summary.fingerprint,
          signingKeyType: summary.signingKeyType,
          encryptionKeyType: summary.encryptionKeyType,
          signingKey: summary.signingKey,
          encryptionKey: summary.encryptionKey,
          signingKeyDetails: summary.signingKeyDetails,
          encryptionKeyDetails: summary.encryptionKeyDetails,
        }
        : undefined;
      return json(buildEncryptedSignedMessagePayload({
        recipientFingerprint: contact.fingerprint,
        senderFingerprint: identity.toFingerprint(),
        ciphertext,
        senderIdentity,
      }));
    }

    const ciphertext = Identity.EncryptFor(contact, message);
    return json(buildEncryptedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      ciphertext,
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/v1/decrypt") {
    const body = await readJson<{
      payload?: unknown;
      password?: unknown;
      sender?: unknown;
      senderEmail?: unknown;
      home?: unknown;
      identity?: unknown;
    }>(req);
    const payload = body.payload as Record<string, unknown> | undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const sender = typeof body.sender === "string" ? body.sender : undefined;
    const senderEmail = typeof body.senderEmail === "string"
      ? body.senderEmail
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    if (!payload) {
      throw new HttpError(STATUS.BadRequest, "payload is required");
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);

    const type = payload.type;
    const rawMessageFrom = (body as Record<string, unknown>).messageFrom;
    const messageFrom = typeof rawMessageFrom === "string"
      ? rawMessageFrom
      : senderEmail ?? "";
    // Claims are matched against `claimSource` (server copy when fetched).
    const signer: {
      contact: ExternalIdentity | null;
      claimSource: ExternalIdentity | null;
      isKnownContact: boolean;
    } = { contact: null, claimSource: null, isKnownContact: false };
    const respond = async (
      result: {
        verified: boolean | null;
        verifyStatus: string;
        signerEmail?: string | null;
        signerEmailVerified?: boolean | null;
        signerMatchesSenderEmail?: boolean | null;
      } & Record<string, unknown>,
    ) => {
      let contactName: string | null = null;
      const signerFp = signer.contact?.fingerprint;
      if (signerFp && signer.isKnownContact) {
        try {
          const contacts = await listContacts(ctx);
          contactName = contacts.find((c) =>
            c.contact.fingerprint === signerFp
          )?.name ?? null;
        } catch {
          contactName = null;
        }
      }
      return json({
        ...result,
        ...buildMailAuthenticityFields({
          verified: result.verified,
          verifyStatus: result.verifyStatus,
          contact: signer.claimSource ?? signer.contact,
          messageFrom,
          isKnownContact: signer.isKnownContact,
          contactName,
          fallback: {
            signerEmail: result.signerEmail,
            signerEmailVerified: result.signerEmailVerified,
            signerMatchesSenderEmail: result.signerMatchesSenderEmail,
          },
        }),
      });
    };
    if (type === "ebp-encrypted-message") {
      const ciphertext = String(payload.ciphertext ?? "");
      let message: string;
      try {
        message = identity.encryptionKey.decrypt(ciphertext);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - message may be corrupted or not intended for this identity",
        );
      }
      return await respond({
        message,
        verified: null,
        verifyStatus: "unsigned",
        signerFingerprint: null,
        signerEmail: null,
        signerEmailVerified: null,
        signerMatchesSenderEmail: null,
        serverIdentityMatch: null,
      });
    }

    if (type === "ebp-encrypted-signed-message-multi") {
      const ciphertext = String(payload.ciphertext ?? "");
      const contentNonce = String(payload.contentNonce ?? "");
      const senderFp = typeof payload.senderFingerprint === "string"
        ? payload.senderFingerprint
        : undefined;
      const embeddedIdentity = payload.senderIdentity as
        | Record<string, unknown>
        | undefined;
      const recipients = parseMultiRecipientEntries(payload.recipients);
      if (!ciphertext || !contentNonce || recipients.length === 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "invalid multi-recipient payload",
        );
      }

      const resolvedMulti = await tryResolveSenderForCtx(ctx, {
        senderHint: sender,
        senderFingerprint: senderFp,
        embeddedIdentity,
      });
      if (!resolvedMulti) {
        throw new HttpError(
          STATUS.BadRequest,
          "sender contact is required for multi-recipient signed payloads",
        );
      }
      const contact = resolvedMulti.contact;
      const isKnownContact = resolvedMulti.isKnownContact;
      const computedFingerprint = computeExternalFingerprint(contact);
      if (
        !computedFingerprint || computedFingerprint !== contact.fingerprint ||
        (senderFp && computedFingerprint !== senderFp)
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "sender identity fingerprint mismatch",
        );
      }
      let result: ReturnType<Identity["decryptAndVerifyMulti"]>;
      try {
        result = identity.decryptAndVerifyMulti({
          recipients,
          contentNonce,
          ciphertext,
        }, contact);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - message may be corrupted or not intended for this identity",
        );
      }
      const signerEmail = getIdentityDetailValue(contact.details, "email");
      const emailMeta = getIdentityDetailMeta(
        (contact as ExternalIdentity & { detailsMeta?: unknown }).detailsMeta,
        "email",
      );
      const signerEmailVerified =
        emailMeta && typeof emailMeta.verified === "boolean"
          ? Boolean(emailMeta.verified)
          : null;
      const senderEmailNormalized = extractEmailAddress(senderEmail ?? "");
      const signerEmailNormalized = extractEmailAddress(signerEmail ?? "");
      const signerMatchesSenderEmail =
        senderEmailNormalized && signerEmailNormalized
          ? senderEmailNormalized === signerEmailNormalized
          : null;
      const status = result.verified
        ? (isKnownContact ? "valid" : "valid_unknown_signer")
        : "invalid";
      signer.contact = contact;
      signer.isKnownContact = isKnownContact;
      return await respond({
        message: result.message,
        verified: result.verified,
        verifyStatus: status,
        signerFingerprint: contact.fingerprint,
        signerEmail,
        signerEmailVerified,
        signerMatchesSenderEmail,
        serverIdentityMatch: null,
        contentKey: result.contentKey,
        recipientFingerprints: result.recipientFingerprints,
        attachmentManifest: result.attachmentManifest,
      });
    }

    if (type === "ebp-encrypted-signed-message") {
      const ciphertext = String(payload.ciphertext ?? "");
      const senderFp = typeof payload.senderFingerprint === "string"
        ? payload.senderFingerprint
        : undefined;
      const embeddedIdentity = payload.senderIdentity as
        | Record<string, unknown>
        | undefined;
      let contact: ExternalIdentity | undefined;
      let isKnownContact = false;
      let signerFingerprint: string | null = senderFp ?? null;
      let signerEmail: string | null = null;
      let signerEmailVerified: boolean | null = null;
      let signerMatchesSenderEmail: boolean | null = null;
      let serverIdentityMatch: boolean | null = null;

      const safeDecrypt = (ct: string): string => {
        try {
          return identity.encryptionKey.decrypt(ct);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - message may be corrupted or not intended for this identity",
          );
        }
      };

      const tryFetchFromServer = async (
        fp: string,
      ): Promise<ExternalIdentity | null> => {
        if (!ctx.server) return null;
        try {
          const res = await fetch(
            apiUrl(ctx.server, `/api/v1/identity/${fp}`),
          );
          if (!res.ok) return null;
          const data = await res.json();
          if (!data.signingKey || !data.encryptionKey) return null;
          return {
            fingerprint: data.fingerprint ?? fp,
            signingKeyType: data.signingKeyType === "sphincs"
              ? "sphincs"
              : "dilithium",
            encryptionKeyType: "kyber",
            signingKey: data.signingKey,
            encryptionKey: data.encryptionKey,
            signingKeyDetails: (data
              .signingKeyDetails as ExternalIdentity[
                "signingKeyDetails"
              ]) ?? { variant: "ml_dsa87" },
            encryptionKeyDetails: (data
              .encryptionKeyDetails as ExternalIdentity[
                "encryptionKeyDetails"
              ]) ?? { variant: "ml_kem1024" },
            details: data.details ?? {},
            detailsMeta: data.detailsMeta ?? {},
          };
        } catch {
          return null;
        }
      };

      const buildEmbeddedContact = (): ExternalIdentity | null => {
        if (!embeddedIdentity) return null;
        const signingKey = typeof embeddedIdentity.signingKey === "string"
          ? embeddedIdentity.signingKey
          : undefined;
        const encryptionKey = typeof embeddedIdentity.encryptionKey === "string"
          ? embeddedIdentity.encryptionKey
          : undefined;
        if (!signingKey || !encryptionKey) return null;
        const signingKeyType = embeddedIdentity.signingKeyType === "sphincs"
          ? "sphincs" as const
          : "dilithium" as const;
        const ext: ExternalIdentity = {
          fingerprint: typeof embeddedIdentity.fingerprint === "string"
            ? embeddedIdentity.fingerprint
            : "",
          signingKeyType,
          encryptionKeyType: "kyber",
          signingKey,
          encryptionKey,
          signingKeyDetails: (embeddedIdentity
            .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
            {
              variant: signingKeyType === "sphincs"
                ? "slh_dsa_sha2_256s"
                : "ml_dsa87",
            },
          encryptionKeyDetails: (embeddedIdentity
            .encryptionKeyDetails as ExternalIdentity[
              "encryptionKeyDetails"
            ]) ?? { variant: "ml_kem1024" },
          details: {},
        };
        const computed = computeExternalFingerprint(ext);
        if (!computed) return null;
        if (senderFp && computed !== senderFp) return null;
        ext.fingerprint = computed;
        return ext;
      };

      const unverifiedResult = async (
        verifyStatus: string,
        verified: false | null,
      ) => {
        const message = safeDecrypt(ciphertext);
        let text = message;
        try {
          const inner = JSON.parse(message);
          text = inner.message ?? message;
        } catch {
          text = message;
        }
        return await respond({
          message: text,
          verified,
          verifyStatus,
          signerFingerprint,
          signerEmail,
          signerEmailVerified,
          signerMatchesSenderEmail,
          serverIdentityMatch,
        });
      };

      const resolvedSigned = await tryResolveSenderForCtx(ctx, {
        senderHint: sender,
        senderFingerprint: senderFp,
        embeddedIdentity,
      });
      if (resolvedSigned) {
        contact = resolvedSigned.contact;
        isKnownContact = resolvedSigned.isKnownContact;
      } else if (sender) {
        try {
          contact = await loadContact(ctx, sender);
          isKnownContact = true;
        } catch {
          if (senderFp) {
            contact = await tryFetchFromServer(senderFp) ?? undefined;
          }
          if (!contact) {
            const embedded = buildEmbeddedContact();
            if (embedded) {
              contact = embedded;
            } else {
              return await unverifiedResult("sender_not_found", null);
            }
          }
        }
      } else if (senderFp) {
        try {
          contact = await loadContact(ctx, senderFp.substring(0, 16));
          isKnownContact = true;
        } catch {
          contact = await tryFetchFromServer(senderFp) ?? undefined;
          if (!contact) {
            const embedded = buildEmbeddedContact();
            if (embedded) {
              contact = embedded;
            } else {
              return await unverifiedResult("sender_not_in_contacts", null);
            }
          }
        }
      } else {
        const embedded = buildEmbeddedContact();
        if (embedded) {
          contact = embedded;
          signerFingerprint = embedded.fingerprint;
        } else {
          return await unverifiedResult("sender_not_specified", null);
        }
      }

      signer.contact = contact;
      signer.isKnownContact = isKnownContact;
      try {
        const computedFingerprint = computeExternalFingerprint(contact);
        signerFingerprint = contact.fingerprint ?? signerFingerprint;
        signerEmail = getIdentityDetailValue(contact.details, "email");
        const emailMeta = getIdentityDetailMeta(
          (contact as ExternalIdentity & { detailsMeta?: unknown })
            .detailsMeta,
          "email",
        );
        signerEmailVerified =
          emailMeta && typeof emailMeta.verified === "boolean"
            ? Boolean(emailMeta.verified)
            : null;
        const senderEmailNormalized = extractEmailAddress(senderEmail ?? "");
        const signerEmailNormalized = extractEmailAddress(signerEmail ?? "");
        if (senderEmailNormalized && signerEmailNormalized) {
          signerMatchesSenderEmail =
            senderEmailNormalized === signerEmailNormalized;
        }
        if (
          !computedFingerprint ||
          computedFingerprint !== contact.fingerprint ||
          (senderFp && computedFingerprint !== senderFp)
        ) {
          return await unverifiedResult("fingerprint_mismatch", false);
        }
        const result = identity.decryptAndVerify(ciphertext, contact);

        if (
          result.verified && embeddedIdentity && !isKnownContact &&
          computedFingerprint
        ) {
          const serverIdentity = await tryFetchFromServer(
            computedFingerprint,
          );
          if (serverIdentity) {
            const serverFp = computeExternalFingerprint(serverIdentity);
            serverIdentityMatch = serverFp === computedFingerprint &&
              serverIdentity.signingKey === contact.signingKey &&
              serverIdentity.encryptionKey === contact.encryptionKey;
            if (serverIdentityMatch) {
              signer.claimSource = serverIdentity;
            }
            if (serverIdentity.details) {
              const serverEmail = getIdentityDetailValue(
                serverIdentity.details,
                "email",
              );
              if (serverEmail) {
                signerEmail = serverEmail;
                const meta = getIdentityDetailMeta(
                  (serverIdentity as ExternalIdentity & {
                    detailsMeta?: unknown;
                  }).detailsMeta,
                  "email",
                );
                signerEmailVerified = meta && typeof meta.verified === "boolean"
                  ? Boolean(meta.verified)
                  : null;
                const sEnorm = extractEmailAddress(senderEmail ?? "");
                const sigEnorm = extractEmailAddress(signerEmail ?? "");
                if (sEnorm && sigEnorm) {
                  signerMatchesSenderEmail = sEnorm === sigEnorm;
                }
              }
            }
          } else {
            serverIdentityMatch = false;
          }
        }

        if (result.verified) {
          const status = isKnownContact ? "valid" : "valid_unknown_signer";
          return await respond({
            message: result.message,
            verified: result.verified,
            verifyStatus: status,
            signerFingerprint,
            signerEmail,
            signerEmailVerified,
            signerMatchesSenderEmail,
            serverIdentityMatch,
          });
        } else {
          return await respond({
            message: result.message,
            verified: false,
            verifyStatus: "invalid",
            signerFingerprint,
            signerEmail,
            signerEmailVerified,
            signerMatchesSenderEmail,
            serverIdentityMatch,
          });
        }
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - message may be corrupted or not intended for this identity",
        );
      }
    }

    throw new HttpError(STATUS.BadRequest, "unsupported payload type");
  }

  return null;
}
