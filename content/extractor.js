// content/extractor.js
// Runs in the page context (injected on user click via activeTab, not on every page load).
// Prefers vendored Mozilla Readability; falls back to simpleExtract().

function simpleExtract() {
  const clone = document.cloneNode(true);

  const junkSelectors = [
    "script", "style", "noscript", "iframe", "svg",
    "nav", "header", "footer", "aside",
    "[class*='ad-']", "[class*='advert']", "[id*='ad-']",
    "[class*='comment']", "[class*='related']", "[class*='newsletter']",
    "[class*='social']", "[class*='share']"
  ];
  junkSelectors.forEach((sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()));

  const candidates = Array.from(clone.querySelectorAll("article, main, div, section"));
  let best = null;
  let bestScore = 0;

  for (const el of candidates) {
    const paragraphs = el.querySelectorAll("p");
    if (paragraphs.length < 3) continue;
    const text = Array.from(paragraphs).map((p) => p.textContent.trim()).join(" ");
    const score = text.length * Math.min(paragraphs.length, 20);
    if (score > bestScore) {
      bestScore = score;
      best = paragraphs;
    }
  }

  if (!best) {
    best = clone.querySelectorAll("p");
  }

  const paragraphTexts = Array.from(best)
    .map((p) => p.textContent.trim())
    .filter((t) => t.length > 40);

  return {
    title: document.title,
    url: location.href,
    text: paragraphTexts.join("\n\n"),
    paragraphCount: paragraphTexts.length,
    extractor: "simple"
  };
}

function extractWithReadability() {
  if (typeof Readability !== "function") return null;
  try {
    const clone = document.cloneNode(true);
    const parsed = new Readability(clone, { charThreshold: 200 }).parse();
    if (!parsed || !parsed.textContent) return null;

    const text = String(parsed.textContent)
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const paragraphs = text.split(/\n\n+/).map((t) => t.trim()).filter((t) => t.length > 40);
    if (paragraphs.length < 2 && text.length < 200) return null;

    return {
      title: parsed.title || document.title,
      url: location.href,
      text: paragraphs.length ? paragraphs.join("\n\n") : text,
      paragraphCount: paragraphs.length || 1,
      extractor: "readability"
    };
  } catch (err) {
    console.warn("VeriLens: Readability failed, using simpleExtract", err);
    return null;
  }
}

const result = extractWithReadability() || simpleExtract();

if (!result.text || result.paragraphCount < 2) {
  chrome.runtime.sendMessage({
    type: "VERILENS_EXTRACT_RESULT",
    ok: false,
    error: "Couldn't find enough article text on this page. VeriLens works best on standard news article pages."
  });
} else {
  chrome.runtime.sendMessage({
    type: "VERILENS_EXTRACT_RESULT",
    ok: true,
    article: result
  });
}
