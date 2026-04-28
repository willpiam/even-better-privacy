import {
  verifySignature,
  computeIdentityFingerprint,
  isValidFingerprintBech32,
} from "./crypto.js";

const serverUrlInput = document.getElementById("server-url");
const payloadFileInput = document.getElementById("payload-file");
const verifyFileInput = document.getElementById("verify-file");
const publicFileInput = document.getElementById("public-file");
const payloadJsonInput = document.getElementById("payload-json");
const publicJsonInput = document.getElementById("public-json");
const messageInput = document.getElementById("message");
const fileReconstructedMessageInput = document.getElementById("file-reconstructed-message");
const reconstructedLabel = document.getElementById("reconstructed-label");
const verifyButton = document.getElementById("verify-btn");
const clearButton = document.getElementById("clear-btn");
const resultSummary = document.getElementById("result-summary");
const resultSection = document.getElementById("result-section");
const resultJson = document.getElementById("result-json").querySelector("code");
const signerDetails = document.getElementById("signer-details");

async function readFileAsJson(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashFileSha256Hex(file) {
  const fileBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", fileBuffer);
  return bytesToHex(new Uint8Array(digest));
}

async function hashTextSha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

function buildFileSignMessage(fileHash, salt, contextMessage) {
  return `ebp::filehash::${fileHash}::${salt || ""}::${contextMessage || ""}`;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function validateServerBase(rawValue) {
  const serverBase = rawValue.trim().replace(/\/+$/, "");
  if (!serverBase) throw new Error("Server URL is required.");

  let parsed;
  try {
    parsed = new URL(serverBase);
  } catch {
    throw new Error("Server URL must be an absolute URL.");
  }

  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) {
    return serverBase;
  }

  throw new Error("Server URL must use HTTPS unless it targets localhost/127.0.0.1.");
}

// Mirror of the GUI verify-file flow: confirm that `publicIdentity`'s
// signing+encryption keys actually correspond to its claimed fingerprint.
// Returns { ok, computedFingerprint, error? }. Without this check, a
// hostile server response or an attacker-pasted identity could pair a
// matching `fingerprint` field with a mismatched `signingKey`, causing
// us to verify against the wrong key.
function deriveAndCheckFingerprint(publicIdentity, expectedFingerprint) {
  let computedFingerprint = "";
  try {
    computedFingerprint = computeIdentityFingerprint(publicIdentity);
  } catch (err) {
    return {
      ok: false,
      computedFingerprint: "",
      error: `Failed to compute fingerprint from public keys: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (expectedFingerprint && computedFingerprint !== expectedFingerprint) {
    return {
      ok: false,
      computedFingerprint,
      error: `Public keys do not match the expected fingerprint. Expected ${expectedFingerprint}, computed ${computedFingerprint}.`,
    };
  }
  return { ok: true, computedFingerprint };
}

function renderSignerDetails(signer) {
  if (!signer || typeof signer !== "object") {
    signerDetails.innerHTML = "";
    return;
  }
  const details = signer.details && typeof signer.details === "object"
    ? Object.entries(signer.details)
    : [];

  const detailHtml = details.length
    ? details.map(([path, value]) => {
      const detailValue = Array.isArray(value) ? value[0] : String(value ?? "");
      return `<li><strong>${escapeHtml(path)}:</strong> ${escapeHtml(detailValue)}</li>`;
    }).join("")
    : "<li>(no signer details)</li>";

  signerDetails.innerHTML = `
    <h3>Published Signer Details</h3>
    <ul>${detailHtml}</ul>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resetVerifierForm() {
  if (payloadFileInput) payloadFileInput.value = "";
  if (verifyFileInput) verifyFileInput.value = "";
  if (publicFileInput) publicFileInput.value = "";
  if (payloadJsonInput) payloadJsonInput.value = "";
  if (publicJsonInput) publicJsonInput.value = "";
  if (messageInput) messageInput.value = "";
  if (fileReconstructedMessageInput) fileReconstructedMessageInput.value = "";
  if (reconstructedLabel) reconstructedLabel.classList.add("is-hidden");
  if (resultSummary) resultSummary.textContent = "No verification run yet.";
  if (resultJson) resultJson.textContent = "{}";
  if (signerDetails) signerDetails.innerHTML = "";
}

payloadFileInput.addEventListener("change", async () => {
  const file = payloadFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = await readFileAsJson(file);
    payloadJsonInput.value = JSON.stringify(parsed, null, 2);
  } catch {
    resultSummary.textContent = "Failed to parse signature file JSON.";
  }
});

publicFileInput.addEventListener("change", async () => {
  const file = publicFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = await readFileAsJson(file);
    publicJsonInput.value = JSON.stringify(parsed, null, 2);
  } catch {
    resultSummary.textContent = "Failed to parse public identity file JSON.";
  }
});

clearButton?.addEventListener("click", () => {
  resetVerifierForm();
});

verifyButton.addEventListener("click", async () => {
  verifyButton.disabled = true;
  verifyButton.textContent = "Verifying...";
  resultSummary.textContent = "Verifying...";
  signerDetails.innerHTML = "";
  if (fileReconstructedMessageInput) fileReconstructedMessageInput.value = "";

  try {
    const serverBase = validateServerBase(serverUrlInput.value);

    const payload = tryParseJson(payloadJsonInput.value);
    if (!payload || typeof payload !== "object") {
      throw new Error("Signature payload JSON is required.");
    }

    const publicIdentity = tryParseJson(publicJsonInput.value);

    // Mirror of `core/handlers/verify.ts`: reject obviously malformed
    // fingerprints early so we never even ask the server about them.
    if (typeof payload.fingerprint === "string" && payload.fingerprint.length > 0
      && !isValidFingerprintBech32(payload.fingerprint)) {
      throw new Error("Signature payload fingerprint is not a valid EBP bech32 fingerprint.");
    }
    if (publicIdentity && typeof publicIdentity === "object"
      && typeof publicIdentity.fingerprint === "string" && publicIdentity.fingerprint.length > 0
      && !isValidFingerprintBech32(publicIdentity.fingerprint)) {
      throw new Error("Pasted public identity fingerprint is not a valid EBP bech32 fingerprint.");
    }

    // Mirror of GUI verify-file flow: when both the payload and the
    // embedded identity carry a fingerprint, they must agree.
    const embeddedIdentityCandidate = publicIdentity ?? (
      payload.identity && typeof payload.identity === "object" ? payload.identity : null
    );
    if (embeddedIdentityCandidate
      && typeof payload.fingerprint === "string" && payload.fingerprint.length > 0
      && typeof embeddedIdentityCandidate.fingerprint === "string"
      && embeddedIdentityCandidate.fingerprint.length > 0
      && payload.fingerprint !== embeddedIdentityCandidate.fingerprint) {
      throw new Error(
        `Fingerprint mismatch between payload (${payload.fingerprint}) and embedded public identity (${embeddedIdentityCandidate.fingerprint}).`,
      );
    }

    const requestBody = { payload };
    if (payload.type === "ebp-signed-file") {
      const file = verifyFileInput?.files?.[0];
      if (!file) {
        throw new Error("File upload is required for ebp-signed-file verification.");
      }
      const expectedFileHash = typeof payload.fileHash === "string" ? payload.fileHash : "";
      if (!expectedFileHash) {
        throw new Error("ebp-signed-file payload is missing fileHash.");
      }
      const computedFileHash = await hashFileSha256Hex(file);
      const salt = typeof payload.salt === "string" ? payload.salt : "";
      const contextMessage = typeof payload.contextMessage === "string" ? payload.contextMessage : "";
      const reconstructedMessage = buildFileSignMessage(computedFileHash, salt, contextMessage);
      const detachedPayload = {
        type: "ebp-signature",
        messageHash: await hashTextSha256Hex(reconstructedMessage),
        salt: "",
        signature: payload.signature,
        fingerprint: payload.fingerprint,
        identity: payload.identity,
      };
      requestBody.payload = detachedPayload;
      requestBody.message = reconstructedMessage;
      if (fileReconstructedMessageInput) {
        fileReconstructedMessageInput.value = reconstructedMessage;
        if (reconstructedLabel) reconstructedLabel.classList.remove("is-hidden");
      }

      if (computedFileHash !== expectedFileHash) {
        const failBody = {
          verified: false,
          reason: "file_hash_mismatch",
          expectedFileHash,
          computedFileHash,
          reconstructedMessage,
          message: "File hash mismatch. Uploaded file does not match the signed file hash.",
        };
        resultJson.textContent = JSON.stringify(failBody, null, 2);
        resultSummary.textContent = failBody.message;
        return;
      }
    } else if (messageInput.value.trim()) {
      requestBody.message = messageInput.value;
    }
    if (publicIdentity && typeof publicIdentity === "object") {
      requestBody.publicIdentity = publicIdentity;
    }

    // F-WEB-01: client-side verification. The server is trusted ONLY to
    // (a) host published public identities (fetched by fingerprint) and
    // (b) provide an advisory "verified" hint that we cross-check against
    // our own local verification result.
    const effectivePayload = requestBody.payload;
    const effectiveMessage = typeof requestBody.message === "string"
      ? requestBody.message
      : (typeof effectivePayload.message === "string" ? effectivePayload.message : "");
    const embeddedIdentity = publicIdentity ?? effectivePayload.identity ?? null;

    let signerIdentity = embeddedIdentity;
    let fetchedFromServer = false;
    let signerSource = publicIdentity ? "pasted" : (signerIdentity ? "payload" : "");
    if (!signerIdentity && typeof effectivePayload.fingerprint === "string" && effectivePayload.fingerprint.length > 0) {
      try {
        const lookup = await fetch(
          `${serverBase}/api/v1/identity/${encodeURIComponent(effectivePayload.fingerprint)}`,
          { method: "GET" },
        );
        if (lookup.ok) {
          signerIdentity = await lookup.json();
          fetchedFromServer = true;
          signerSource = "server";
        }
      } catch {
        // ignore network errors — we'll raise a clear error below.
      }
    }

    if (!signerIdentity) {
      throw new Error("Could not obtain the signer's public identity. Paste a public identity JSON or ensure the signer is published on the configured server.");
    }

    // Mirror of `gui/app.js` verify-file flow: re-derive the fingerprint
    // from the public keys we are about to verify with, and reject the
    // identity if the keys do not actually match the claimed fingerprint.
    // This closes the gap where a hostile server (or hostile pasted JSON)
    // could pair a real fingerprint with a different `signingKey`, making
    // verification "succeed" against the wrong key.
    const expectedSignerFingerprint = (typeof signerIdentity.fingerprint === "string" && signerIdentity.fingerprint.length > 0)
      ? signerIdentity.fingerprint
      : (typeof effectivePayload.fingerprint === "string" ? effectivePayload.fingerprint : "");
    const fingerprintCheck = deriveAndCheckFingerprint(signerIdentity, expectedSignerFingerprint);
    if (!fingerprintCheck.ok) {
      throw new Error(fingerprintCheck.error);
    }
    if (typeof effectivePayload.fingerprint === "string" && effectivePayload.fingerprint.length > 0
      && fingerprintCheck.computedFingerprint !== effectivePayload.fingerprint) {
      throw new Error(
        `Signer fingerprint mismatch: payload claims ${effectivePayload.fingerprint} but the supplied public keys hash to ${fingerprintCheck.computedFingerprint}.`,
      );
    }

    let clientVerified = false;
    try {
      clientVerified = verifySignature(signerIdentity, {
        message: effectiveMessage,
        messageHash: typeof effectivePayload.messageHash === "string" ? effectivePayload.messageHash : undefined,
        salt: typeof effectivePayload.salt === "string" ? effectivePayload.salt : "",
        signature: typeof effectivePayload.signature === "string" ? effectivePayload.signature : "",
      });
    } catch (err) {
      throw new Error(`Client-side verification failed: ${err instanceof Error ? err.message : err}`);
    }

    // Optionally cross-check against the server's advisory "verified"
    // flag. A mismatch is informational only — the client result is the
    // authoritative answer.
    let serverAdvisory = null;
    try {
      const res = await fetch(`${serverBase}/api/v1/verify-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (res.ok) {
        const body = await res.json();
        serverAdvisory = Boolean(body?.verified);
      }
    } catch {
      // ignore
    }

    const report = {
      verified: clientVerified,
      verifiedBy: "client",
      serverAdvisory,
      serverConsistent: serverAdvisory === null ? null : serverAdvisory === clientVerified,
      signerFingerprint: fingerprintCheck.computedFingerprint || (signerIdentity?.fingerprint ?? null),
      signerFingerprintConfirmedFromKeys: true,
      signerSource: signerSource || (fetchedFromServer ? "server" : (publicIdentity ? "pasted" : "payload")),
    };
    resultJson.textContent = JSON.stringify(report, null, 2);

    if (clientVerified) {
      if (payload.type === "ebp-signed-file" && fileReconstructedMessageInput?.value) {
        resultSummary.textContent = "Signature is valid and file hash matches (verified client-side).";
      } else {
        resultSummary.textContent = "Signature is valid (verified client-side).";
      }
      renderSignerDetails(signerIdentity);
    } else {
      resultSummary.textContent = "Signature is INVALID (verified client-side).";
    }
  } catch (err) {
    resultJson.textContent = JSON.stringify(
      { error: err instanceof Error ? err.message : "Verification failed." },
      null,
      2,
    );
    resultSummary.textContent = err instanceof Error ? err.message : "Verification failed.";
  } finally {
    verifyButton.disabled = false;
    verifyButton.textContent = "Verify";
    resultSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
