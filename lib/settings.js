// lib/settings.js
export const DEFAULT_SETTINGS = Object.freeze({
  preferNano: true,
  hostedEndpoint: "http://127.0.0.1:8787/analyze",
  neverHosted: false
});

export function normalizeEndpoint(value) {
  const fallback = DEFAULT_SETTINGS.hostedEndpoint;
  if (typeof value !== "string") return fallback;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

export async function getSettings() {
  const { verilens_settings } = await chrome.storage.sync.get("verilens_settings");
  const merged = { ...DEFAULT_SETTINGS, ...(verilens_settings || {}) };
  return {
    preferNano: merged.preferNano !== false,
    neverHosted: merged.neverHosted === true,
    hostedEndpoint: normalizeEndpoint(merged.hostedEndpoint)
  };
}

export async function setSettings(partial = {}) {
  const current = await getSettings();
  const next = {
    preferNano: (partial.preferNano ?? current.preferNano) !== false,
    neverHosted: (partial.neverHosted ?? current.neverHosted) === true,
    hostedEndpoint: normalizeEndpoint(partial.hostedEndpoint ?? current.hostedEndpoint)
  };
  await chrome.storage.sync.set({ verilens_settings: next });
  return next;
}
