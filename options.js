// Promise-based WebExtensions API: `browser` on Firefox, `chrome` on Chrome MV3.
const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_MAX_RECENT = 5;

async function loadSetting() {
  const stored = await api.storage.sync.get("maxRecent");
  const value = stored.maxRecent || DEFAULT_MAX_RECENT;
  const radio = document.querySelector(`input[name="maxRecent"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function wireUpChangeHandler() {
  const form = document.getElementById("settings-form");
  form.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    api.storage.sync.set({ maxRecent: value });
  });
}

wireUpChangeHandler();
loadSetting();
