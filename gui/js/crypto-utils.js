import { api, setStatus } from "./ui.js";

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashTextSha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashFileSha256Hex(file) {
  const arrayBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

export function generateRandomSaltHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function buildFileSignMessage(fileHash, salt, contextMessage) {
  return `ebp::filehash::${fileHash}::${salt || ""}::${contextMessage || ""}`;
}

export async function readFileAsBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function safeDownloadFileName(fileName) {
  if (!fileName || typeof fileName !== "string") return "decrypted.bin";
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\.\./g, "_") || "decrypted.bin";
}

export function getPayloadDownloadName(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  switch (payload.type) {
    case "ebp-signature":
      return "ebp-signature.json";
    case "ebp-signed-message":
      if (typeof payload.messageHash === "string" && payload.messageHash.length >= 8) {
        return `ebp-signed-message-${payload.messageHash.slice(0, 8)}.json`;
      }
      return "ebp-signed-message.json";
    case "ebp-signed-file":
      if (typeof payload.fileHash === "string" && payload.fileHash.length >= 8) {
        return `ebp-signed-file-${payload.fileHash.slice(0, 8)}.json`;
      }
      return "ebp-signed-file.json";
    case "ebp-encrypted-message":
      return "ebp-encrypted-message.json";
    case "ebp-encrypted-signed-message":
      return "ebp-encrypted-signed-message.json";
    case "ebp-encrypted-file":
      return `ebp-encrypted-file-${safeDownloadFileName(payload.fileName || "file")}.json`;
    case "ebp-encrypted-signed-file":
      return `ebp-encrypted-signed-file-${safeDownloadFileName(payload.fileName || "file")}.json`;
    default:
      return fallback;
  }
}

export async function downloadJsonFromTextarea(textareaId, fallbackName) {
  const textarea = document.getElementById(textareaId);
  if (!textarea || !textarea.value) return;

  try {
    const payload = JSON.parse(textarea.value);
    const filename = getPayloadDownloadName(payload, fallbackName);
    const pretty = JSON.stringify(payload, null, 2) + "\n";
    const res = await api("/save-file", {
      method: "POST",
      body: JSON.stringify({ content: pretty, filename }),
    });
    setStatus(`Saved to ${res.path}`, "success");
  } catch (err) {
    setStatus(err.message || "Failed to save file", "error");
  }
}

export async function loadJsonFileIntoTextarea(fileInput, textareaId) {
  const textarea = document.getElementById(textareaId);
  const file = fileInput?.files?.[0];
  if (!textarea || !file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    textarea.value = JSON.stringify(payload, null, 2);
    setStatus(`Loaded ${file.name}`, "success");
  } catch (err) {
    setStatus("Invalid JSON file", "error");
  } finally {
    fileInput.value = "";
  }
}
