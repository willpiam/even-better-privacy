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

    const res = await fetch(`${serverBase}/api/v1/verify-signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const body = await res.json().catch(() => ({}));
    resultJson.textContent = JSON.stringify(body, null, 2);

    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    if (body.verified) {
      if (payload.type === "ebp-signed-file" && fileReconstructedMessageInput?.value) {
        resultSummary.textContent = "Signature is valid and file hash matches.";
      } else if (typeof body.message === "string" && body.message.length > 0) {
        resultSummary.textContent = body.message;
      } else if (body.identityPublished) {
        resultSummary.textContent = "Signature is valid. Signer identity is published on the server.";
      } else {
        resultSummary.textContent = "Signature is valid. Signer identity is not published on this server.";
      }
      renderSignerDetails(body.signer);
    } else {
      resultSummary.textContent = typeof body.message === "string" && body.message.length > 0
        ? body.message
        : "Signature is invalid.";
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
