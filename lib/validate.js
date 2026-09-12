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

/** Collapse whitespace so quote matching tolerates wrapping differences. */
export function normalizeWhitespace(text) {
  return asString(text).replace(/\s+/g, " ");
}

export function validateFlag(flag, sourceNormalized = "") {
  if (!flag || typeof flag !== "object") return null;
  const quote = asString(flag.quote, 200);
  const reason = asString(flag.reason, 500);
  const category = ALLOWED_CATEGORIES.includes(flag.category) ? flag.category : null;
  // Reject empty quote, category, OR reason.
  if (!quote || !category || !reason) return null;
  if (sourceNormalized) {
    const quoteNorm = normalizeWhitespace(quote);
    if (!quoteNorm || !sourceNormalized.includes(quoteNorm)) return null;
  }
  return { quote, category, reason };
}

/**
 * @param {object} raw
 * @param {string} [sourceText] article text used for quote-in-source + empty-neutral checks
 */
export function validateAnalysis(raw, sourceText = "") {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_analysis: expected an object");
  }
  const sourceNormalized = normalizeWhitespace(sourceText);
  const flags = Array.isArray(raw.flags)
    ? raw.flags
        .map((f) => validateFlag(f, sourceNormalized))
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const backend = raw.backend === "nano" ? "nano" : "hosted";
  const neutralVersion = asString(raw.neutralVersion, 200000);

  // Reject empty neutralVersion when the input article was non-empty.
  if (sourceNormalized.length > 0 && !neutralVersion) {
    throw new Error("invalid_analysis: empty neutralVersion for non-empty input");
  }

  return {
    flags,
    neutralVersion,
    backend,
    degraded: raw.degraded === true
  };
}
