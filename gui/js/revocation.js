import { state } from "./state.js";
import { escapeHtml } from "./ui.js";

export function updateRevokeDetailPathOptions() {
  const select = document.getElementById("revoke-detail-path");
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a detail to revoke...</option>';
  
  const details = Array.isArray(state.currentDetails) 
    ? state.currentDetails 
    : Object.entries(state.currentDetails || {}).map(([path, val]) => ({
        path,
        detail: Array.isArray(val) ? val[0] : val
      }));
  
  for (const item of details) {
    const option = document.createElement("option");
    option.value = item.path;
    const detailText = String(item.detail);
    const maxLen = 60;
    const truncated = detailText.length > maxLen ? detailText.slice(0, maxLen) + "…" : detailText;
    option.textContent = `${item.path}: ${truncated}`;
    select.appendChild(option);
  }
}

export function updateRevocationStatus(isRevoked) {
  const statusDiv = document.getElementById("revocation-status");
  const revokeIdentityForm = document.getElementById("revoke-identity-form");
  
  if (isRevoked) {
    statusDiv.style.display = "block";
    if (revokeIdentityForm) {
      revokeIdentityForm.closest("details").style.display = "none";
    }
  } else {
    statusDiv.style.display = "none";
    if (revokeIdentityForm) {
      revokeIdentityForm.closest("details").style.display = "block";
    }
  }
}
