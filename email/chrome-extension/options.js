const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:8787",
  identity: "",
  home: ""
};

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    document.getElementById("backendUrl").value = settings.backendUrl || "";
    document.getElementById("identity").value = settings.identity || "";
    document.getElementById("home").value = settings.home || "";
  });
}

function saveSettings() {
  const backendUrl = document.getElementById("backendUrl").value.trim();
  const identity = document.getElementById("identity").value.trim();
  const home = document.getElementById("home").value.trim();

  chrome.storage.sync.set(
    {
      backendUrl: backendUrl || DEFAULT_SETTINGS.backendUrl,
      identity,
      home
    },
    () => {
      const status = document.getElementById("status");
      status.textContent = "Saved.";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    }
  );
}

document.getElementById("save").addEventListener("click", saveSettings);
document.addEventListener("DOMContentLoaded", loadSettings);
