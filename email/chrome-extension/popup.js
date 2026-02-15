function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

function setStatus(message, type = "") {
  const status = document.getElementById("status");
  status.textContent = message || "";
  status.className = "status";
  if (type) status.classList.add(type);
}

function toIdentityLabel(identity) {
  const fingerprint = identity?.fingerprint ? String(identity.fingerprint) : "";
  const shortFp = fingerprint ? fingerprint.slice(0, 12) : "no fingerprint";
  return `${identity.name} (${shortFp})`;
}

async function loadPopup() {
  const currentIdentityEl = document.getElementById("currentIdentity");
  const identitySelect = document.getElementById("identitySelect");
  const switchButton = document.getElementById("switchButton");

  setStatus("");
  switchButton.disabled = true;

  const response = await sendMessage({ type: "ebp-identities-list" });
  if (!response?.ok) {
    currentIdentityEl.textContent = "Unavailable";
    identitySelect.innerHTML = "";
    setStatus(`Failed to load accounts: ${response?.error || "unknown error"}`, "error");
    return;
  }

  const identities = Array.isArray(response.data?.identities) ? response.data.identities : [];
  const selectedIdentity = response.data?.selectedIdentity || response.data?.currentIdentity || "";
  currentIdentityEl.textContent = selectedIdentity || "None";

  identitySelect.innerHTML = "";
  identities.forEach((identity) => {
    const option = document.createElement("option");
    option.value = identity.name;
    option.textContent = toIdentityLabel(identity);
    if (identity.name === selectedIdentity) option.selected = true;
    identitySelect.appendChild(option);
  });

  if (identities.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No local identities found";
    option.selected = true;
    identitySelect.appendChild(option);
    switchButton.disabled = true;
    return;
  }

  switchButton.disabled = false;
}

async function switchIdentity() {
  const currentIdentityEl = document.getElementById("currentIdentity");
  const identitySelect = document.getElementById("identitySelect");
  const switchButton = document.getElementById("switchButton");

  const name = identitySelect.value;
  if (!name) {
    setStatus("Choose an account to switch.", "error");
    return;
  }

  setStatus("Switching...");
  switchButton.disabled = true;
  const response = await sendMessage({ type: "ebp-identity-switch", name });
  switchButton.disabled = false;

  if (!response?.ok) {
    setStatus(`Switch failed: ${response?.error || "unknown error"}`, "error");
    return;
  }

  currentIdentityEl.textContent = response.data?.selectedIdentity || name;
  setStatus("Account switched.", "success");
}

document.getElementById("switchButton").addEventListener("click", switchIdentity);
document.getElementById("openOptions").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.addEventListener("DOMContentLoaded", loadPopup);
