export const DEFAULT_SERVER_URL = "https://ebp-cqyo.onrender.com";
export const LOCAL_BACKEND_ORIGIN = "http://127.0.0.1:8787";
export const MAIL_RENDER_HTML_PREF_KEY = "ebp.mail.renderHtml";
export const MAIL_INCLUDE_PUBLIC_KEYS_PREF_KEY = "ebp.mail.includePublicKeys";
export const STARTUP_RETRY_ATTEMPTS = 12;
export const STARTUP_RETRY_DELAY_MS = 500;
export const TOAST_LOG_LIMIT = 50;

export const state = {
  currentIdentity: null,
  currentFingerprint: null,
  currentDetails: [],
  serverDetails: [],
  serverDetailsMeta: {},
  server: null,
  protocolVersion: null,
  identities: [],
  contacts: [],
  serverIdentities: [],
  hierarchyRelationships: [],
  serverIdentitiesPagination: { page: 1, totalPages: 1, total: 0 },
  serverIdentitiesSearch: "",
  identityDirLabel: "",
  isRevoked: false,
  revokedDetails: [],
  mailAccount: null,
  mailAccounts: [],
  selectedMailAccountId: null,
  mailCreatingNewAccount: false,
  mailSecretsInMemory: false,
  mailSecretsLocked: false,
  settingsMailCredentials: [],
  mailMessages: [],
  mailPagination: { page: 1, totalPages: 1, total: 0 },
  selectedMailMessage: null,
  selectedMailMessageUid: null,
  mailMessageLoading: false,
  mailMessageLoadRequestId: 0,
  mailRenderHtml: false,
  mailIncludePublicKeys: true,
  mailOAuthPendingState: "",
  mailOAuthProvider: "",
  mailOAuthEmail: "",
  mailActiveTab: "inbox",
  mailComposeAttachments: [],
  mailComposeRecipients: [],
  decryptedMailAttachments: {},
  selectedMailMessageContentKey: null,
  selectedMailMessageAttachmentManifest: [],
  selectedMailMessageRecipientFingerprints: [],
  decryptedFileResult: null,
  toastLogs: [],
  serverDefaultApplied: false,
};

export function loadBooleanPreference(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function saveBooleanPreference(key, value) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

export function loadUiPreferences() {
  state.mailRenderHtml = loadBooleanPreference(MAIL_RENDER_HTML_PREF_KEY, false);
  state.mailIncludePublicKeys = loadBooleanPreference(MAIL_INCLUDE_PUBLIC_KEYS_PREF_KEY, true);
}

export function getDetailValue(details, path) {
  if (!details) return null;
  if (Array.isArray(details)) {
    const found = details.find(d => d.path === path);
    return found?.detail || null;
  }
  const val = details[path];
  if (Array.isArray(val)) return val[0];
  return val || null;
}

export function getDetailMeta(detailsMeta, path) {
  if (!detailsMeta || typeof detailsMeta !== "object") return null;
  return detailsMeta[path] ?? null;
}

export function isOpaqueDetailPath(path) {
  return typeof path === "string" && path.startsWith("opaque::");
}

export function formatOpaqueHash(value) {
  if (typeof value !== "string") return "";
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}
