// lib/ai-backend.js
// Common interface: async analyzeArticle(text) -> {
//   flags: [{ quote, category, reason }],
//   neutralVersion: string,
//   backend: "nano" | "hosted",
//   degraded: boolean
// }

import { getSettings } from "./settings.js";
import { validateAnalysis } from "./validate.js";

const SYSTEM_PROMPT = `You are a strict, politically neutral news-analysis assistant.
Your job has two parts:

1. FLAG loaded language, slanted framing, or unsupported editorializing in the
   article text. For each flag give: the exact quoted phrase (verbatim,
   under 15 words), a category ("loaded_language" | "framing" | "editorializing"),
   and a one-sentence neutral reason. Do NOT flag ordinary factual statements,
   direct quotes from named sources, or analysis clearly labeled as opinion.

2. Produce a NEUTRAL VERSION: the same article with ONLY the flagged phrases
   minimally rephrased to be fact-preserving and neutral. Do not summarize,
   reorder, cut content, or change anything that wasn't flagged. If nothing
   is flagged, the neutral version is identical to the original.

You must apply this standard symmetrically regardless of which political
direction the language leans. Do not add commentary of your own. Respond
only in the requested structured format.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          category: {
            type: "string",
            enum: ["loaded_language", "framing", "editorializing"]
          },
          reason: { type: "string" }
        },
        required: ["quote", "category", "reason"]
      }
    },
    neutralVersion: { type: "string" }
  },
  required: ["flags", "neutralVersion"]
};

function buildUserPrompt(articleText) {
  return `Analyze this article text:\n\n"""\n${articleText}\n"""`;
}

// ---------- Backend 1: Gemini Nano (Prompt API) ----------

async function nanoAvailability() {
  if (typeof LanguageModel === "undefined") return "unavailable";
  try {
    return await LanguageModel.availability();
  } catch {
    return "unavailable";
  }
}

async function analyzeWithNano(articleText) {
  const availability = await nanoAvailability();
  if (availability === "unavailable") {
    throw new Error("nano_unavailable");
  }

  // "downloadable" / "downloading" both mean not ready for a synchronous MVP call;
  // caller should fall back to hosted rather than block the user on a multi-minute download.
  if (availability !== "available") {
    throw new Error(`nano_not_ready:${availability}`);
  }

  const session = await LanguageModel.create({ systemPrompt: SYSTEM_PROMPT });
  try {
    const tokenCount = await session.countPromptTokens(articleText);
    if (session.tokensLeft !== undefined && tokenCount > session.tokensLeft) {
      throw new Error("nano_context_exceeded");
    }

    const raw = await session.prompt(buildUserPrompt(articleText), {
      responseConstraint: RESPONSE_SCHEMA
    });
    const parsed = JSON.parse(raw);
    return { ...parsed, backend: "nano", degraded: false };
  } finally {
    session.destroy();
  }
}

// ---------- Backend 2: Hosted fallback ----------
// Server owns the prompt and schema. Extension sends article text only.
// No API key is ever stored or shipped in this bundle.

async function analyzeWithHosted(articleText, endpoint) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: articleText })
  });

  if (!res.ok) throw new Error(`hosted_error:${res.status}`);
  const parsed = await res.json();
  return { ...parsed, backend: "hosted", degraded: false };
}

// ---------- Public entry point ----------

export async function analyzeArticle(articleText, options = {}) {
  const settings = { ...(await getSettings()), ...options };
  const preferNano = settings.preferNano !== false;
  const neverHosted = settings.neverHosted === true;
  const hostedEndpoint = settings.hostedEndpoint;

  if (preferNano) {
    try {
      return validateAnalysis(await analyzeWithNano(articleText));
    } catch (err) {
      console.warn("VeriLens: Nano unavailable, falling back to hosted.", err.message);
      if (neverHosted) {
        throw new Error(
          `On-device model unavailable and hosted fallback is disabled (${err.message})`
        );
      }
    }
  } else if (neverHosted) {
    throw new Error("Hosted backend is disabled and on-device analysis is not preferred.");
  }

  try {
    const result = await analyzeWithHosted(articleText, hostedEndpoint);
    return validateAnalysis({ ...result, degraded: preferNano });
  } catch (err) {
    throw new Error(`Both backends failed: ${err.message}`);
  }
}
