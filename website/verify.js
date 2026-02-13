const serverUrlInput = document.getElementById("server-url");
const payloadFileInput = document.getElementById("payload-file");
const publicFileInput = document.getElementById("public-file");
const payloadJsonInput = document.getElementById("payload-json");
const publicJsonInput = document.getElementById("public-json");
const messageInput = document.getElementById("message");
const verifyButton = document.getElementById("verify-btn");
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

verifyButton.addEventListener("click", async () => {
  verifyButton.disabled = true;
  verifyButton.textContent = "Verifying...";
  resultSummary.textContent = "Verifying...";
  signerDetails.innerHTML = "";

  try {
    const serverBase = serverUrlInput.value.trim().replace(/\/+$/, "");
    if (!serverBase) throw new Error("Server URL is required.");

    const payload = tryParseJson(payloadJsonInput.value);
    if (!payload || typeof payload !== "object") {
      throw new Error("Signature payload JSON is required.");
    }

    const publicIdentity = tryParseJson(publicJsonInput.value);
    const requestBody = { payload };
    if (messageInput.value.trim()) {
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
      if (body.identityPublished) {
        resultSummary.textContent = "Signature is valid. Signer identity is published on the server.";
      } else {
        resultSummary.textContent = "Signature is valid. Signer identity is not published on this server.";
      }
      renderSignerDetails(body.signer);
    } else {
      resultSummary.textContent = "Signature is invalid.";
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
