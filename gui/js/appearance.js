// Apply before paint, including in the native webview. Storage may be unavailable.
(() => {
  const key = "ebp.ui.appearance";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function preference() {
    try { return localStorage.getItem(key) || "light"; }
    catch { return "light"; }
  }
  function apply() {
    const value = preference();
    document.documentElement.dataset.theme = value === "dark" ||
        (value === "system" && system.matches) ? "dark" : "light";
  }
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply();
  });
})();
