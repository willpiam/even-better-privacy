const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:8787",
  identity: "",
  home: ""
};

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

function buildUrl(base, path, params) {
  const url = new URL(path, base);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

async function apiFetch(path, options = {}, params) {
  const settings = await getSettings();
  const url = buildUrl(settings.backendUrl, path, params);
  const response = await fetch(url, options);
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) reason = body.error;
    } catch {
      // ignore
    }
    throw new Error(reason);
  }
  return response.json();
}

function buildIdentityPayload(settings) {
  const payload = {};
  if (settings.identity) payload.identity = settings.identity;
  if (settings.home) payload.home = settings.home;
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const settings = await getSettings();
      if (message?.type === "ebp-contacts") {
        const data = await apiFetch(
          "/api/v1/contacts",
          { method: "GET" },
          { home: settings.home || undefined }
        );
        sendResponse({ ok: true, data });
        return;
      }

      if (message?.type === "ebp-encrypt") {
        const { message: text, recipient, sign, password } = message;
        if (!text || !recipient) {
          throw new Error("missing message or recipient");
        }
        const payload = {
          message: text,
          recipient,
          sign: Boolean(sign),
          ...buildIdentityPayload(settings)
        };
        if (sign) {
          if (!password) throw new Error("password required for signing");
          payload.password = password;
        }
        const data = await apiFetch("/api/v1/encrypt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (message?.type === "ebp-sign") {
        const { message: text, password, detached } = message;
        if (!text) {
          throw new Error("missing message");
        }
        if (!password) {
          throw new Error("password required for signing");
        }
        const payload = {
          message: text,
          password,
          detached: Boolean(detached),
          ...buildIdentityPayload(settings)
        };
        const data = await apiFetch("/api/v1/sign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (message?.type === "ebp-identity-export-public") {
        const { password } = message;
        if (!password) {
          throw new Error("password required for public key export");
        }
        const payload = {
          password,
          ...buildIdentityPayload(settings)
        };
        const data = await apiFetch("/api/v1/identity/export-public", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (message?.type === "ebp-decrypt") {
        const { payload, password, sender } = message;
        if (!payload || !password) {
          throw new Error("missing payload or password");
        }
        const body = {
          payload,
          password,
          sender,
          ...buildIdentityPayload(settings)
        };
        const data = await apiFetch("/api/v1/decrypt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        sendResponse({ ok: true, data });
        return;
      }

      sendResponse({ ok: false, error: "unknown message type" });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();

  return true;
});
