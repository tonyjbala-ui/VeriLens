// lib/sanitize.js
// DOM-only rendering. Model strings are assigned via textContent, never innerHTML.

import { ALLOWED_CATEGORIES } from "./validate.js";

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function safeCategory(category) {
  return ALLOWED_CATEGORIES.includes(category) ? category : null;
}

export function renderPlainParagraphs(container, text) {
  container.replaceChildren();
  const parts = String(text ?? "").split(/\n\n+/);
  for (const part of parts) {
    const p = document.createElement("p");
    p.textContent = part;
    container.appendChild(p);
  }
}

export function renderHighlightedArticle(container, text, flags) {
  container.replaceChildren();
  const safeFlags = (Array.isArray(flags) ? flags : [])
    .map((f) => ({
      quote: typeof f.quote === "string" ? f.quote : "",
      category: safeCategory(f.category),
      reason: typeof f.reason === "string" ? f.reason : ""
    }))
    .filter((f) => f.quote && f.category);

  const parts = String(text ?? "").split(/\n\n+/);
  for (const part of parts) {
    const p = document.createElement("p");
    appendHighlightedText(p, part, safeFlags);
    container.appendChild(p);
  }
}

function appendHighlightedText(el, text, flags) {
  let remaining = text;
  while (remaining.length) {
    let bestIdx = -1;
    let bestFlag = null;
    for (const flag of flags) {
      const idx = remaining.indexOf(flag.quote);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestFlag = flag;
      }
    }
    if (!bestFlag) {
      el.appendChild(document.createTextNode(remaining));
      break;
    }
    if (bestIdx > 0) {
      el.appendChild(document.createTextNode(remaining.slice(0, bestIdx)));
    }
    const mark = document.createElement("mark");
    mark.className = bestFlag.category;
    if (bestFlag.reason) mark.title = bestFlag.reason;
    mark.textContent = bestFlag.quote;
    el.appendChild(mark);
    remaining = remaining.slice(bestIdx + bestFlag.quote.length);
  }
}

export function renderFlagList(container, flags) {
  container.replaceChildren();
  const list = Array.isArray(flags) ? flags : [];
  if (list.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No loaded language or framing flagged in this article.";
    container.appendChild(p);
    return;
  }

  for (const flag of list) {
    const category = safeCategory(flag.category);
    if (!category) continue;
    const item = document.createElement("div");
    item.className = "flag-item";

    const cat = document.createElement("div");
    cat.className = "category";
    cat.textContent = category.replaceAll("_", " ");

    const quote = document.createElement("div");
    quote.className = "quote";
    quote.textContent = `"${flag.quote}"`;

    const reason = document.createElement("div");
    reason.className = "reason";
    reason.textContent = flag.reason || "";

    item.append(cat, quote, reason);
    container.appendChild(item);
  }
}
