// lib/validate.js
// Whitelist + shape-check untrusted model output before it reaches the UI.

export const ALLOWED_CATEGORIES = Object.freeze([
  "loaded_language",
  "framing",
  "editorializing"
]);

function asString(value, maxLen) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\u0000/g, "").trim();
  return maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function validateFlag(flag) {
  if (!flag || typeof flag !== "object") return null;
  const quote = asString(flag.quote, 200);
  const reason = asString(flag.reason, 500);
  const category = ALLOWED_CATEGORIES.includes(flag.category) ? flag.category : null;
  if (!quote || !category) return null;
  return { quote, category, reason };
}

export function validateAnalysis(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_analysis: expected an object");
  }
  const flags = Array.isArray(raw.flags)
    ? raw.flags.map(validateFlag).filter(Boolean).slice(0, 50)
    : [];
  const backend = raw.backend === "nano" ? "nano" : "hosted";
  return {
    flags,
    neutralVersion: asString(raw.neutralVersion, 200000),
    backend,
    degraded: raw.degraded === true
  };
}
