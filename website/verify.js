import { verifySignature, sha256Hex as clientSha256Hex } from "./crypto.mjs";

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
  if (reconstructedLabel) reconstructedLabel.style.display = "none";
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
    const serverBase = serverUrlInput.value.trim().replace(/\/+$/, "");
    if (!serverBase) throw new Error("Server URL is required.");

    const payload = tryParseJson(payloadJsonInput.value);
    if (!payload || typeof payload !== "object") {
      throw new Error("Signature payload JSON is required.");
    }

    const publicIdentity = tryParseJson(publicJsonInput.value);
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
        if (reconstructedLabel) reconstructedLabel.style.display = "";
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
    if (!signerIdentity && typeof effectivePayload.fingerprint === "string" && effectivePayload.fingerprint.length > 0) {
      try {
        const lookup = await fetch(
          `${serverBase}/api/v1/identity/${encodeURIComponent(effectivePayload.fingerprint)}`,
          { method: "GET" },
        );
        if (lookup.ok) {
          signerIdentity = await lookup.json();
          fetchedFromServer = true;
        }
      } catch {
        // ignore network errors — we'll raise a clear error below.
      }
    }

    if (!signerIdentity) {
      throw new Error("Could not obtain the signer's public identity. Paste a public identity JSON or ensure the signer is published on the configured server.");
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
      signerFingerprint: signerIdentity?.fingerprint ?? null,
      signerSource: fetchedFromServer ? "server" : (publicIdentity ? "pasted" : "payload"),
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
