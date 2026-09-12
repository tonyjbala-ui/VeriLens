import { DEFAULT_SETTINGS, getSettings, setSettings, normalizeEndpoint } from "../lib/settings.js";

const preferNanoEl = document.getElementById("preferNano");
const neverHostedEl = document.getElementById("neverHosted");
const hostedEndpointEl = document.getElementById("hostedEndpoint");
const statusEl = document.getElementById("status");
const form = document.getElementById("settings-form");

function setStatus(text) {
  statusEl.textContent = text;
}

async function ensureHostPermission(endpoint) {
  const url = new URL(endpoint);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return true;
  const origin = `${url.protocol}//${url.host}/*`;
  const already = await chrome.permissions.contains({ origins: [origin] });
  if (already) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function load() {
  const settings = await getSettings();
  preferNanoEl.checked = settings.preferNano;
  neverHostedEl.checked = settings.neverHosted;
  hostedEndpointEl.value = settings.hostedEndpoint || DEFAULT_SETTINGS.hostedEndpoint;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const hostedEndpoint = normalizeEndpoint(hostedEndpointEl.value || DEFAULT_SETTINGS.hostedEndpoint);

  try {
    const allowed = await ensureHostPermission(hostedEndpoint);
    if (!allowed) {
      setStatus("Permission denied for that hosted origin. Settings not saved.");
      return;
    }
    await setSettings({
      preferNano: preferNanoEl.checked,
      neverHosted: neverHostedEl.checked,
      hostedEndpoint
    });
    hostedEndpointEl.value = hostedEndpoint;
    setStatus("Saved.");
  } catch (err) {
    setStatus(err?.message || "Could not save settings.");
  }
});

load();
