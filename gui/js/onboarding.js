import { DEFAULT_SERVER_URL, state } from "./state.js";
import { api, setStatus } from "./ui.js";
import { requestPassword, showConfirmModal } from "./modals.js";
import { loadAll } from "./render.js";
import { pendingSignups, savePendingSignup, completeMailboxSignup, removePendingSignup } from "./mail-signup-resume.js";

const FIRST_RUN_DISMISSED_KEY = "ebp.onboarding.dismissed";
const STEPS = ["welcome", "address", "password", "phrase", "confirm", "create", "done"];
const QUIZ_WORDS = 3;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const modal = document.getElementById("onboarding-modal");
const $ = (id) => document.getElementById(id);
let pendingGeneration = 0;

const wizard = {
  server: "",
  domain: "",
  username: "",
  usernameOk: false,
  password: "",
  mnemonic: "",
  quiz: [],
  identityName: "",
  identityCreated: false,
  useExistingIdentity: false,
  published: false,
  paid: false,
  resuming: false,
  orderId: "",
  running: false,
  checkTimer: null,
  checkSeq: 0,
  navigateTo: null,
};

function serverUrl() {
  return state.server || DEFAULT_SERVER_URL;
}

function showStep(step) {
  modal.querySelectorAll(".onboarding-step").forEach((el) => {
    el.classList.toggle("active", el.dataset.step === step);
  });
  const index = STEPS.indexOf(step);
  $("onboarding-progress").querySelectorAll("span").forEach((bar, i) => {
    bar.classList.toggle("done", i < index);
  });
  wizard.step = step;
  const focusTarget = {
    address: "onboarding-username",
    password: "onboarding-password",
  }[step];
  if (focusTarget) setTimeout(() => $(focusTarget)?.focus(), 0);
}

function setHint(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.dataset.kind = kind;
}

function selectedIdentityName() {
  const name = state.currentIdentity;
  return typeof name === "string" && name.trim() ? name.trim() : "";
}

function setKeysTaskVisible(visible) {
  const li = $("onboarding-tasks").querySelector('[data-task="keys"]');
  if (li) li.hidden = !visible;
}

function syncUseCurrentButton(signupReady) {
  const btn = $("onboarding-use-current");
  const available = Boolean(selectedIdentityName());
  btn.hidden = !available;
  btn.disabled = !available || !signupReady;
}

function resetWizard() {
  clearTimeout(wizard.checkTimer);
  wizard.checkSeq++;
  Object.assign(wizard, {
    username: "",
    usernameOk: false,
    password: "",
    mnemonic: "",
    quiz: [],
    identityName: "",
    identityCreated: false,
    useExistingIdentity: false,
    published: false,
    paid: false,
    resuming: false,
    orderId: "",
  });
  setKeysTaskVisible(true);
  $("onboarding-username").value = "";
  $("onboarding-password").value = "";
  $("onboarding-password-confirm").value = "";
  $("onboarding-words").innerHTML = "";
  $("onboarding-quiz").innerHTML = "";
  $("onboarding-unavailable").textContent = "";
  $("onboarding-create-error").textContent = "";
  $("onboarding-checkout").hidden = true;
  $("onboarding-manage").hidden = true;
  $("onboarding-payment-wrap").hidden = true;
  $("onboarding-pending").hidden = true;
  $("onboarding-pending").replaceChildren();
  $("onboarding-address-next").disabled = true;
  setHint("onboarding-username-hint", "");
  setHint("onboarding-password-hint", "");
  setHint("onboarding-quiz-hint", "");
  $("onboarding-tasks").querySelectorAll("li").forEach((li) => delete li.dataset.state);
}

export async function openOnboarding() {
  if (wizard.running) return;
  resetWizard();
  wizard.server = serverUrl();
  wizard.domain = "";
  showStep("welcome");
  syncUseCurrentButton(false);
  modal.classList.add("active");
  const startBtn = $("onboarding-start");
  startBtn.disabled = true;
  try {
    const config = await api(
      `/mail/ebp-signup/config?server=${encodeURIComponent(wizard.server)}`,
    );
    if (!config?.enabled || !config.domain) {
      void renderPendingSignups();
      $("onboarding-unavailable").textContent =
        "This key server doesn't offer EBP email addresses yet. You can still create keys and connect an existing mailbox manually.";
      return;
    }
    wizard.domain = config.domain;
    $("onboarding-domain").textContent = `@${config.domain}`;
    startBtn.disabled = false;
    syncUseCurrentButton(true);
    void renderPendingSignups();
  } catch (err) {
    void renderPendingSignups();
    $("onboarding-unavailable").textContent =
      `Couldn't reach the key server (${err.message}).`;
  }
}

function signupCheckpoint() {
  const {server, domain, identityName, username, orderId} = wizard;
  return {server, domain, identityName, username, orderId};
}

async function renderPendingSignups() {
  const generation = ++pendingGeneration;
  const container = $("onboarding-pending");
  try {
    const saved = pendingSignups(localStorage, serverUrl());
    const results = await Promise.all(saved.map(async signup => {
      const email = `${signup.username}@${signup.domain}`;
      const result = await api("/mail/ebp-signup/resume-state", {
        method: "POST", body: JSON.stringify({identity: signup.identityName, server: signup.server, email, orderId: signup.orderId}),
      }).catch(() => ({
        action: "unavailable", reason: "Could not check the saved identity", unknown: true,
      }));
      return {signup, email, ...result};
    }));
    if (generation !== pendingGeneration) return [];
    const entries = [];
    container.replaceChildren();
    for (const {signup, email, action, reason, unknown} of results) {
      if (action === "completed" || action === "cancelled") {
        try {
          removePendingSignup(localStorage, signup, action === "cancelled" ? "cancelled" : "1", false);
        } catch { /* A matching mailbox or a cancelled order still hides the entry. */ }
        continue;
      }
      entries.push(action);
      const row = document.createElement("div");
      row.className = "stack";
      const label = document.createElement("p");
      label.textContent = `${email} (${signup.identityName})`;
      row.append(label);
      if (reason) {
        const hint = document.createElement("p");
        hint.className = "small muted";
        hint.textContent = reason;
        row.append(hint);
      }
      const addButton = (label, run) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = label;
        button.addEventListener("click", () => { if (!wizard.running) void run(); });
        row.append(button);
      };
      if (action === "resume" || action === "restore") {
        addButton(`${action === "resume" ? "Resume email setup" : "Restore mailbox access"}: ${email} (${signup.identityName})`, async () => {
          Object.assign(wizard, signup, {
            usernameOk: true, identityCreated: true, useExistingIdentity: true,
            published: false, paid: true, password: "", mnemonic: "", resuming: true,
          });
          if (action === "restore") await restoreAccess();
          else await runCreate();
        });
      }
      if (action !== "restore" && (!unknown || signup.orderId)) {
        const missingOrder = !signup.orderId && action === "unavailable";
        addButton(missingOrder ? "Remove reminder" : "Cancel email purchase", () => cancelSignup(signup, missingOrder));
      }
      container.append(row);
    }
    container.hidden = !container.childElementCount;
    document.querySelectorAll("[data-open-onboarding]").forEach(btn => {
      btn.dataset.onboardingLabel ??= btn.textContent.trim();
      btn.textContent = entries.includes("resume") ? "Resume email setup"
        : entries.includes("restore") ? "Restore mailbox access"
          : entries.length ? "Manage unfinished email purchases" : btn.dataset.onboardingLabel;
    });
    return entries;
  } catch (err) {
    $("onboarding-unavailable").textContent = `Couldn't read saved email setup: ${err.message}`;
    return [];
  }
}

async function cancelSignup(signup, localOnly) {
  wizard.running = true;
  $("onboarding-unavailable").textContent = "";
  try {
    const approved = await showConfirmModal(
      localOnly ? "Remove setup reminder?" : `Cancel ${signup.username}@${signup.domain}?`,
      localOnly ? "This device cannot find the purchase. Unpaid server reservations expire on their own."
        : "Confirm that you have not sent payment. Cancelling releases this address reservation and keeps your identity.",
      localOnly ? "Remove reminder" : "Cancel unpaid purchase",
    );
    if (!approved) return;
    let orderId = signup.orderId;
    if (!orderId && !localOnly) {
      const password = await requestPassword(`Unlock ${signup.identityName} to find the order`);
      if (!password) return;
      const order = await api("/mail/ebp-payment/recover", {
        method: "POST", body: JSON.stringify({
          identity: signup.identityName, password, username: signup.username, server: signup.server,
          domain: signup.domain, forCancellation: true,
        }),
      });
      orderId = order.orderId;
      if (!orderId && order.cancellationLookup !== true) {
        throw new Error("This key server could not check whether the purchase can be cancelled. Your setup is still saved.");
      }
      if (orderId) savePendingSignup(localStorage, {...signup, orderId});
    }
    if (orderId) {
      const result = await api("/mail/ebp-payment/cancel", {
        method: "POST", body: JSON.stringify({server: signup.server, orderId, confirmUnpaid: true}),
      });
      if (result.status !== "cancelled") throw new Error("Cancellation could not be confirmed. Try again.");
    }
    removePendingSignup(localStorage, signup, orderId ? "cancelled" : "dismissed");
  } catch (err) {
    $("onboarding-unavailable").textContent = err.message;
    void renderPendingSignups();
  } finally {
    wizard.running = false;
  }
}

function closeOnboarding() {
  modal.classList.remove("active");
  wizard.password = "";
  wizard.mnemonic = "";
}

function localUsernameError(username) {
  if (username.length < 3) return "Use at least 3 characters.";
  if (username.length > 30) return "Use at most 30 characters.";
  if (!/^[a-z0-9.-]+$/.test(username)) return "Use only letters, numbers, dots, and hyphens.";
  if (!USERNAME_PATTERN.test(username)) return "Start and end with a letter or number.";
  if (/[.-]{2}/.test(username)) return "Don't put two dots or hyphens in a row.";
  return "";
}

function onUsernameInput() {
  const username = $("onboarding-username").value.trim().toLowerCase();
  wizard.usernameOk = false;
  wizard.paid = false;
  $("onboarding-payment-wrap").hidden = true;
  $("onboarding-address-next").disabled = true;
  clearTimeout(wizard.checkTimer);
  if (!username) {
    setHint("onboarding-username-hint", "");
    return;
  }
  const localError = localUsernameError(username);
  if (localError) {
    setHint("onboarding-username-hint", localError, "error");
    return;
  }
  setHint("onboarding-username-hint", "Checking…");
  const seq = ++wizard.checkSeq;
  wizard.checkTimer = setTimeout(async () => {
    try {
      const res = await api(
        `/mail/ebp-signup/username?u=${encodeURIComponent(username)}&server=${encodeURIComponent(wizard.server)}`,
      );
      if (seq !== wizard.checkSeq) return;
      if (res.available) {
        wizard.username = res.username ?? username;
        wizard.usernameOk = true;
        $("onboarding-address-next").disabled = false;
        setHint("onboarding-username-hint", `${wizard.username}@${wizard.domain} is available`, "ok");
      } else if (res.purchasable) {
        const config = await api(`/mail/ebp-payment/config?server=${encodeURIComponent(wizard.server)}`);
        if (seq !== wizard.checkSeq) return;
        if (!config.enabled || !Array.isArray(config.assets) || !config.assets.length) throw new Error("Payment is not available.");
        const select = $("onboarding-payment-asset");
        select.replaceChildren();
        for (const asset of config.assets) {
          const option = document.createElement("option");
          option.value = JSON.stringify([asset.network, asset.symbol]);
          option.textContent = `${asset.symbol} · ${asset.network}`;
          select.append(option);
        }
        $("onboarding-payment-wrap").hidden = false;
        wizard.username = res.username ?? username;
        wizard.usernameOk = true;
        wizard.paid = true;
        $("onboarding-address-next").disabled = false;
        setHint("onboarding-username-hint", `One-time price: $${(res.usdCents / 100).toFixed(2)} USD`, "ok");
      } else {
        setHint("onboarding-username-hint", res.reason || "That address is taken.", "error");
      }
    } catch (err) {
      if (seq !== wizard.checkSeq) return;
      setHint("onboarding-username-hint", err.message, "error");
    }
  }, 350);
}

async function onPasswordNext() {
  const password = $("onboarding-password").value;
  const confirm = $("onboarding-password-confirm").value;
  if (!password) {
    setHint("onboarding-password-hint", "Enter a password.", "error");
    return;
  }
  if (password !== confirm) {
    setHint("onboarding-password-hint", "Passwords don't match.", "error");
    return;
  }
  try {
    const check = await api("/password/check", {
      method: "POST",
      body: JSON.stringify({
        password,
        enforcePasswordPolicy: state.enforcePasswordPolicy,
      }),
    });
    if (!check.ok) {
      const tips = (check.suggestions ?? []).join(" ");
      setHint("onboarding-password-hint", `${check.reason} ${tips}`.trim(), "error");
      return;
    }
  } catch (err) {
    setHint("onboarding-password-hint", err.message, "error");
    return;
  }
  wizard.password = password;
  setHint("onboarding-password-hint", "");
  if (!wizard.mnemonic) {
    try {
      const res = await api("/hd/mnemonic", {
        method: "POST",
        body: JSON.stringify({ strength: 256 }),
      });
      wizard.mnemonic = res.mnemonic;
    } catch (err) {
      setHint("onboarding-password-hint", err.message, "error");
      return;
    }
  }
  renderWords();
  showStep("phrase");
}

function renderWords() {
  const list = $("onboarding-words");
  list.innerHTML = "";
  wizard.mnemonic.split(/\s+/).forEach((word, i) => {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.textContent = `${i + 1}.`;
    li.append(num, document.createTextNode(word));
    list.appendChild(li);
  });
}

function pickQuizIndexes(count, total) {
  const picks = new Set();
  const rand = new Uint32Array(1);
  while (picks.size < count) {
    crypto.getRandomValues(rand);
    picks.add(rand[0] % total);
  }
  return [...picks].sort((a, b) => a - b);
}

function renderQuiz() {
  const words = wizard.mnemonic.split(/\s+/);
  wizard.quiz = pickQuizIndexes(QUIZ_WORDS, words.length);
  const container = $("onboarding-quiz");
  container.innerHTML = "";
  for (const index of wizard.quiz) {
    const label = document.createElement("label");
    label.textContent = `Word #${index + 1}`;
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.quizIndex = String(index);
    label.appendChild(input);
    container.appendChild(label);
  }
  setHint("onboarding-quiz-hint", "");
  setTimeout(() => container.querySelector("input")?.focus(), 0);
}

function quizPasses() {
  const words = wizard.mnemonic.split(/\s+/);
  return [...$("onboarding-quiz").querySelectorAll("input")].every((input) =>
    input.value.trim().toLowerCase() === words[Number(input.dataset.quizIndex)]
  );
}

function setTask(task, taskState) {
  const li = $("onboarding-tasks").querySelector(`[data-task="${task}"]`);
  if (li) li.dataset.state = taskState;
}

async function runTask(task, fn) {
  setTask(task, "running");
  try {
    const result = await fn();
    setTask(task, "done");
    return result;
  } catch (err) {
    setTask(task, "error");
    throw err;
  }
}

async function createIdentity() {
  const base = wizard.username;
  let lastError = null;
  for (const name of [base, `${base}-ebp`, `${base}-${Date.now().toString(36)}`]) {
    try {
      const res = await api("/hd/identity", {
        method: "POST",
        body: JSON.stringify({
          name,
          mnemonic: wizard.mnemonic,
          password: wizard.password,
          enforcePasswordPolicy: state.enforcePasswordPolicy,
        }),
      });
      wizard.identityName = res.identity.name;
      return res.identity;
    } catch (err) {
      lastError = err;
      if (!/already exists/i.test(err.message)) throw err;
    }
  }
  throw lastError;
}

async function signupMailbox() {
  return await api("/mail/ebp-signup", {
    method: "POST",
    body: JSON.stringify({
      identity: wizard.identityName,
      password: wizard.password,
      username: wizard.username,
      server: wizard.server,
    }),
  });
}

function startWithCurrentIdentity() {
  const name = selectedIdentityName();
  if (!name) return;
  wizard.useExistingIdentity = true;
  wizard.identityName = name;
  wizard.identityCreated = true;
  wizard.published = false;
  wizard.password = "";
  wizard.mnemonic = "";
  setKeysTaskVisible(false);
  showStep("address");
}

function isUnlockError(message) {
  return /wrong password|failed to decrypt identity/i.test(message);
}

async function runCreate() {
  if (wizard.running) return;
  wizard.running = true;
  try {
    await runCreateSteps();
  } finally {
    wizard.running = false;
  }
}

async function runCreateSteps() {
  if (wizard.useExistingIdentity && !wizard.password) {
    const password = await requestPassword(
      `Enter the password for ${wizard.identityName}`,
    );
    if (!password) return;
    wizard.password = password;
  }
  showStep("create");
  setKeysTaskVisible(!wizard.useExistingIdentity);
  $("onboarding-create-error").textContent = "";
  $("onboarding-retry").style.display = "none";
  try {
    if (!wizard.identityCreated) {
      await runTask("keys", createIdentity);
      wizard.identityCreated = true;
    }
    if (!wizard.published) {
      await runTask("publish", () =>
        api("/publish", {
          method: "POST",
          body: JSON.stringify({
            identity: wizard.identityName,
            password: wizard.password,
            server: wizard.server,
          }),
        }));
      wizard.published = true;
    }
    if (wizard.paid) {
      // Save before requesting an order so a lost response can be recovered
      // with this same identity and address after a restart.
      savePendingSignup(localStorage, signupCheckpoint());
      $("onboarding-manage").hidden = false;
      const storageKey = `ebp.mail.order:${wizard.server}:${wizard.identityName}:${wizard.username}`;
      if (!wizard.orderId) {
        try { wizard.orderId = localStorage.getItem(storageKey) || ""; } catch { /* storage may be unavailable */ }
      }
      if (!wizard.orderId) {
        const recovered = await api("/mail/ebp-payment/recover", { method: "POST", body: JSON.stringify({
          identity: wizard.identityName, password: wizard.password, username: wizard.username, server: wizard.server,
        }) });
        wizard.orderId = recovered.orderId || "";
      }
      if (!wizard.orderId) {
        if (wizard.resuming) throw new Error("No payment order was found. Contact support if you already paid.");
        const [network, asset] = JSON.parse($("onboarding-payment-asset").value);
        const order = await api("/mail/ebp-payment/order", { method: "POST", body: JSON.stringify({
          identity: wizard.identityName, password: wizard.password, username: wizard.username,
          server: wizard.server, network, asset,
        }) });
        wizard.orderId = order.orderId;
      }
      savePendingSignup(localStorage, signupCheckpoint());
      const status = await api("/mail/ebp-payment/status", { method: "POST", body: JSON.stringify({
        identity: wizard.identityName, server: wizard.server, orderId: wizard.orderId,
      }) });
      if (status.status === "cancelled") {
        removePendingSignup(localStorage, signupCheckpoint(), "cancelled");
        wizard.password = "";
        showStep("welcome");
        return;
      }
      if (status.status === "expired") {
        $("onboarding-checkout").hidden = true;
        $("onboarding-create-error").textContent = "The quote expired. Your order is saved. If you sent a payment, contact support before paying again.";
        $("onboarding-retry").textContent = "Check payment";
        $("onboarding-retry").style.display = "";
        return;
      }
      if (status.status !== "confirmed" && status.status !== "fulfilled") {
        const localTest = wizard.domain === "test.pqpost.com" && new URL(wizard.server).origin === "http://127.0.0.1:8789";
        const checkoutOrigin = localTest ? "http://127.0.0.1:8789" : wizard.domain === "test.pqpost.com" ? "https://test.pqpost.com" : "https://pqpost.com";
        $("onboarding-checkout-link").href = `${checkoutOrigin}/checkout.html#${encodeURIComponent(wizard.orderId)}`;
        $("onboarding-checkout").hidden = false;
        $("onboarding-create-error").textContent = status.status === "manual_review"
          ? "This order needs support. Contact support before paying again."
          : "Payment is not confirmed yet.";
        $("onboarding-retry").textContent = "Check payment";
        $("onboarding-retry").style.display = "";
        return;
      }
      $("onboarding-checkout").hidden = true;
    }
    const result = await runTask("mailbox", () => signupMailbox());
    renderDone(result);
  } catch (err) {
    if (wizard.useExistingIdentity && isUnlockError(err.message)) {
      wizard.password = "";
    }
    $("onboarding-create-error").textContent = err.message;
    $("onboarding-retry").style.display = "";
    if (/already has a mailbox/i.test(err.message)) {
      $("onboarding-create-error").textContent =
        "This identity already has an EBP mailbox. Restore access to set a new mailbox password on this device.";
      $("onboarding-retry").textContent = "Restore access";
    } else if (/taken/i.test(err.message)) {
      $("onboarding-retry").textContent = "Choose another address";
    } else {
      $("onboarding-retry").textContent = "Try again";
    }
  }
}

async function resetMailboxAccess() {
  return await api("/mail/ebp-reset-password", {
    method: "POST",
    body: JSON.stringify({
      identity: wizard.identityName,
      password: wizard.password,
      server: wizard.server,
      expectedEmail: wizard.resuming ? `${wizard.username}@${wizard.domain}` : undefined,
    }),
  });
}

async function restoreAccess() {
  if (wizard.running) return;
  wizard.running = true;
  try {
    if (!wizard.password) {
      const password = await requestPassword(`Enter the password for ${wizard.identityName}`);
      if (!password) return;
      wizard.password = password;
    }
    showStep("create");
    setKeysTaskVisible(false);
    $("onboarding-create-error").textContent = "";
    $("onboarding-retry").style.display = "none";
    const result = await runTask("mailbox", () => resetMailboxAccess());
    if (result.savedLocally === false) {
      $("onboarding-create-error").textContent = "Unlock your mail settings and try restoring access again.";
      $("onboarding-retry").style.display = "";
      $("onboarding-retry").textContent = "Restore access";
      return;
    }
    renderDone(result, "Restored");
  } catch (err) {
    if (isUnlockError(err.message)) wizard.password = "";
    $("onboarding-create-error").textContent = err.message;
    $("onboarding-retry").style.display = "";
    $("onboarding-retry").textContent = "Restore access";
  } finally {
    wizard.running = false;
  }
}

function renderDone(result, verb = "Created") {
  if (wizard.identityName && result.email) {
    try {
      completeMailboxSignup(localStorage, wizard.server, wizard.identityName, result.email);
    } catch { /* The ready mailbox is saved; stale setup can be retried safely. */ }
  }
  wizard.password = "";
  wizard.mnemonic = "";
  $("onboarding-result-email").textContent = result.email;
  $("onboarding-result-fingerprint").textContent = result.fingerprint;
  const dl = $("onboarding-connection");
  dl.innerHTML = "";
  const c = result.connection ?? {};
  const rows = [
    ["IMAP", c.imap ? `${c.imap.host}:${c.imap.port} (SSL/TLS)` : ""],
    ["SMTP", c.smtp ? `${c.smtp.host}:${c.smtp.port} (SSL/TLS)` : ""],
    ["Username", c.login ?? result.email],
    ["Password", c.password ?? ""],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  showStep("done");
  setStatus(`${verb} ${result.email}`, "success");
  void loadAll();
}

export function initOnboarding({ navigateTo }) {
  if (!modal) return;
  wizard.navigateTo = navigateTo;
  window.addEventListener('ebp-mail-signup-completed', renderPendingSignups);
  window.addEventListener('ebp-identities-refreshed', renderPendingSignups);
  window.addEventListener('focus', renderPendingSignups);
  window.addEventListener('storage', event => {
    if (event.key?.startsWith('ebp.mail.signup')) void renderPendingSignups();
  });

  document.querySelectorAll("[data-open-onboarding]").forEach((btn) => {
    btn.addEventListener("click", () => void openOnboarding());
  });

  modal.querySelectorAll("[data-onboarding-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = STEPS.indexOf(wizard.step);
      if (index > 0) showStep(STEPS[index - 1]);
    });
  });

  $("onboarding-skip").addEventListener("click", () => {
    try {
      localStorage.setItem(FIRST_RUN_DISMISSED_KEY, "1");
    } catch {
      // ignore storage failures
    }
    closeOnboarding();
  });
  $("onboarding-start").addEventListener("click", () => {
    resetWizard();
    showStep("address");
  });
  $("onboarding-use-current").addEventListener("click", () => {
    if ($("onboarding-use-current").disabled) return;
    resetWizard();
    startWithCurrentIdentity();
  });
  $("onboarding-username").addEventListener("input", onUsernameInput);
  const afterAddress = () => {
    if (!wizard.usernameOk) return;
    if (wizard.useExistingIdentity || wizard.identityCreated) void runCreate();
    else showStep("password");
  };
  $("onboarding-username").addEventListener("keydown", (e) => {
    if (e.key === "Enter") afterAddress();
  });
  $("onboarding-address-next").addEventListener("click", afterAddress);
  $("onboarding-password-next").addEventListener("click", () => void onPasswordNext());
  $("onboarding-password-confirm").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onPasswordNext();
  });
  $("onboarding-phrase-next").addEventListener("click", () => {
    renderQuiz();
    showStep("confirm");
  });
  $("onboarding-create").addEventListener("click", () => {
    if (!quizPasses()) {
      setHint("onboarding-quiz-hint", "Those words don't match your phrase. Check and try again.", "error");
      return;
    }
    void runCreate();
  });
  $("onboarding-retry").addEventListener("click", () => {
    if (/restore access/i.test($("onboarding-retry").textContent)) {
      void restoreAccess();
      return;
    }
    if (/another address/i.test($("onboarding-retry").textContent)) {
      wizard.orderId = "";
      wizard.resuming = false;
      wizard.usernameOk = false;
      $("onboarding-address-next").disabled = true;
      setHint("onboarding-username-hint", "");
      showStep("address");
      return;
    }
    void runCreate();
  });
  $("onboarding-open-inbox").addEventListener("click", () => {
    closeOnboarding();
    wizard.navigateTo?.("mail");
  });
  $("onboarding-manage").addEventListener("click", () => void openOnboarding());
}

export async function maybeOpenOnboardingOnFirstRun() {
  if (!modal || modal.classList.contains("active")) return;
  const entries = await renderPendingSignups();
  if (entries.length) {
    if (entries.includes("resume")) void openOnboarding();
    return;
  }
  try {
    const config = await api(`/mail/ebp-signup/config?server=${encodeURIComponent(serverUrl())}`);
    if (!config?.enabled) return;
  } catch { return; }
  if ((state.identities ?? []).length > 0) return;
  try {
    if (localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === "1") return;
  } catch {
    // ignore storage failures
  }
  void openOnboarding();
}
