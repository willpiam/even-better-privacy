import { state } from "./state.js";
import { icon, initials } from "./icons.js";
import { setMailTab } from "./contact-search.js";

const APPEARANCE_KEY = "ebp.ui.appearance";
const places = {
  mail: ["mail", "Mail", "The mail meadow"],
  identities: ["identities", "Identities", "The identity grove"],
  contacts: ["contacts", "Contacts", "The contact garden"],
  tools: ["tools", "Crypto tools", "The crypto woodland"],
  "sign-verify": ["tools", "Sign / Verify", "The crypto woodland"],
  "encrypt-decrypt": ["tools", "Encrypt / Decrypt", "The crypto woodland"],
  certificates: ["tools", "Certificates", "The crypto woodland"],
  settings: ["settings", "Settings", "The quiet den"],
  "project-info": ["settings", "Project Info", "The quiet den"],
};

export function updateWorkspace(pageId) {
  let [place, title, label] = places[pageId] || places.identities;
  if (pageId === "mail" && state.mailActiveTab === "compose") {
    place = "compose";
    label = "The letter path";
  }
  document.body.dataset.place = place;
  document.body.dataset.workspacePage = pageId;
  document.getElementById("workspace-breadcrumb").textContent = title;
  document.getElementById("sidebar-place-art").className = `place-art place-${place}`;
  document.getElementById("sidebar-place-label").textContent = label;
  const heading = document.querySelector(`#page-${pageId} > .page-header`);
  if (pageId === "mail" && heading) {
    heading.querySelector(".place-art").className = `place-art place-${place}`;
    heading.querySelector(".place-label").lastChild.textContent = label;
  }
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    if (item.dataset.page === pageId) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelector('.nav-item[data-page="tools"]').classList.toggle("active", place === "tools");
  document.dispatchEvent(new CustomEvent("ebp:workspace-changed"));
}

export function updateWorkspaceIdentity() {
  const name = state.currentIdentity || "Choose an identity";
  document.getElementById("workspace-profile-name").textContent = name;
  document.getElementById("workspace-avatar").textContent = initials(state.currentIdentity);
  document.getElementById("workspace-profile-hint").textContent = state.currentIdentity
    ? "Manage your identities" : "Your keys stay with you";
}

function appearancePreference() {
  try { return localStorage.getItem(APPEARANCE_KEY) || "light"; }
  catch { return "light"; }
}

function syncAppearanceControls() {
  const dark = document.documentElement.dataset.theme === "dark";
  const toggle = document.getElementById("workspace-theme-toggle");
  toggle.innerHTML = icon(dark ? "sun" : "moon");
  toggle.setAttribute("aria-label", dark ? "Use light appearance" : "Use dark appearance");
  document.getElementById("settings-appearance").value = appearancePreference();
}

function setAppearance(value) {
  try { localStorage.setItem(APPEARANCE_KEY, value); } catch { /* session only */ }
  const dark = value === "dark" ||
    (value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  syncAppearanceControls();
  document.getElementById("settings-appearance").value = value;
}

export function initWorkspace({ navigateTo }) {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
  document.getElementById("workspace-theme-toggle").addEventListener("click", () => {
    setAppearance(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  document.getElementById("settings-appearance").addEventListener("change", (event) => {
    setAppearance(event.target.value);
  });
  new MutationObserver(syncAppearanceControls).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });
  syncAppearanceControls();

  document.getElementById("workspace-profile").addEventListener("click", () => {
    navigateTo("identities");
    document.getElementById("identity-list").closest("section").querySelector(".section-toggle")?.focus();
  });
  document.querySelectorAll("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.reveal);
      if (!target) return;
      const section = target.closest("section");
      if (section.classList.contains("is-collapsed")) section.querySelector(".section-toggle").click();
      section.scrollIntoView({ block: "center", behavior: "auto" });
      target.querySelector("input, textarea, select, button")?.focus({ preventScroll: true });
    });
  });
  document.querySelectorAll("[data-open-mail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setMailTab(button.dataset.openMailTab);
      if (button.dataset.openMailTab === "compose") document.getElementById("mail-compose-to-input").focus();
    });
  });
  document.addEventListener("ebp:mail-tab", () => {
    if (document.body.dataset.workspacePage === "mail") updateWorkspace("mail");
  });
  document.querySelectorAll("[data-tool-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(link.hash.slice(1));
      const target = document.getElementById(link.dataset.toolTarget);
      if (!target) return;
      const section = target.closest("section");
      if (section.classList.contains("is-collapsed")) section.querySelector(".section-toggle").click();
      section.scrollIntoView({ block: "start", behavior: "auto" });
      target.querySelector("input, textarea, select")?.focus({ preventScroll: true });
    });
  });

  const search = document.getElementById("contacts-search");
  search.addEventListener("input", filterContacts);
  document.getElementById("contacts-search-clear").addEventListener("click", () => {
    search.value = "";
    filterContacts();
    search.focus();
  });
  // Contact sync/import replaces the list; keep the current query applied.
  new MutationObserver(filterContacts).observe(document.getElementById("contacts-list"), { childList: true });

  document.getElementById("mail-reader-back").addEventListener("click", () => {
    document.getElementById("mail-tab-inbox").classList.remove("reader-open");
    document.querySelector("#mail-message-list [aria-current=true]")?.focus();
  });
  updateWorkspaceIdentity();
}

function filterContacts() {
  const search = document.getElementById("contacts-search");
  const query = search.value.trim().toLocaleLowerCase();
  const rows = document.querySelectorAll("#contacts-list .contact-item");
  let visible = 0;
  for (const row of rows) {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
    if (!row.hidden) visible += 1;
  }
  document.getElementById("contacts-search-empty").hidden = !query || visible > 0 || rows.length === 0;
  document.getElementById("contacts-search-clear").hidden = !query;
  document.getElementById("contacts-count").textContent = `${rows.length} ${rows.length === 1 ? "contact" : "contacts"}`;
}
