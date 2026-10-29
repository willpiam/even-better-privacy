import { DEFAULT_SERVER_URL, state } from "./state.js";
import { api, setStatus } from "./ui.js";
import { requestPassword } from "./modals.js";
import { loadAll } from "./render.js";

const FIRST_RUN_DISMISSED_KEY = "ebp.onboarding.dismissed";
const STEPS = ["welcome", "address", "password", "phrase", "confirm", "create", "done"];
const QUIZ_WORDS = 3;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const modal = document.getElementById("onboarding-modal");
const $ = (id) => document.getElementById(id);

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
  });
  setKeysTaskVisible(true);
  $("onboarding-username").value = "";
  $("onboarding-password").value = "";
  $("onboarding-password-confirm").value = "";
  $("onboarding-words").innerHTML = "";
  $("onboarding-quiz").innerHTML = "";
  $("onboarding-unavailable").textContent = "";
  $("onboarding-create-error").textContent = "";
  $("onboarding-address-next").disabled = true;
  setHint("onboarding-username-hint", "");
  setHint("onboarding-password-hint", "");
  setHint("onboarding-quiz-hint", "");
  $("onboarding-tasks").querySelectorAll("li").forEach((li) => delete li.dataset.state);
}

export async function openOnboarding() {
  resetWizard();
  wizard.server = serverUrl();
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
      $("onboarding-unavailable").textContent =
        "This key server doesn't offer EBP email addresses yet. You can still create keys and connect an existing mailbox manually.";
      return;
    }
    wizard.domain = config.domain;
    $("onboarding-domain").textContent = `@${config.domain}`;
    startBtn.disabled = false;
    syncUseCurrentButton(true);
  } catch (err) {
    $("onboarding-unavailable").textContent =
      `Couldn't reach the key server (${err.message}).`;
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

async function signupMailbox(pin) {
  return await api("/mail/ebp-signup", {
    method: "POST",
    body: JSON.stringify({
      identity: wizard.identityName,
      password: wizard.password,
      username: wizard.username,
      server: wizard.server,
      ...(pin ? { pin } : {}),
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
  return /failed to decrypt identity/i.test(message);
}

async function runCreate() {
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
    const result = await runTask("mailbox", async () => {
      try {
        return await signupMailbox();
      } catch (err) {
        if (!/email pin required/i.test(err.message)) throw err;
        const pin = await requestPassword("Enter your existing email PIN to save the new mailbox");
        if (!pin) throw new Error("Email PIN is required to save the mailbox password.");
        return await signupMailbox(pin);
      }
    });
    renderDone(result);
  } catch (err) {
    if (wizard.useExistingIdentity && isUnlockError(err.message)) {
      wizard.password = "";
    }
    $("onboarding-create-error").textContent = err.message;
    $("onboarding-retry").style.display = "";
    if (/taken/i.test(err.message)) {
      $("onboarding-retry").textContent = "Choose another address";
    } else {
      $("onboarding-retry").textContent = "Try again";
    }
  }
}

function renderDone(result) {
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
  setStatus(`Created ${result.email}`, "success");
  void loadAll();
}

export function initOnboarding({ navigateTo }) {
  if (!modal) return;
  wizard.navigateTo = navigateTo;

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
    if (wizard.useExistingIdentity) {
      wizard.useExistingIdentity = false;
      wizard.identityCreated = false;
      wizard.identityName = "";
      wizard.published = false;
      wizard.password = "";
      setKeysTaskVisible(true);
    }
    showStep("address");
  });
  $("onboarding-use-current").addEventListener("click", () => {
    if ($("onboarding-use-current").disabled) return;
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
    if (/another address/i.test($("onboarding-retry").textContent)) {
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
}

export async function maybeOpenOnboardingOnFirstRun() {
  if (!modal || modal.classList.contains("active")) return;
  if ((state.identities ?? []).length > 0) return;
  try {
    if (localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === "1") return;
  } catch {
    // ignore storage failures
  }
  try {
    const config = await api(
      `/mail/ebp-signup/config?server=${encodeURIComponent(serverUrl())}`,
    );
    if (!config?.enabled) return;
  } catch {
    return;
  }
  void openOnboarding();
}
