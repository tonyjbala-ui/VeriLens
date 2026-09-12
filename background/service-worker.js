// background/service-worker.js
import { analyzeArticle } from "../lib/ai-backend.js";
import { validateAnalysis } from "../lib/validate.js";
import { getSettings } from "../lib/settings.js";

let panelReady = false;
const outboundQueue = [];

/** Monotonic generation: bump on each new analyze request; ignore stale completions. */
let analyzeGeneration = 0;
/** AbortController for the in-flight analyze, if any. */
let analyzeAbort = null;
/**
 * tabId -> generation that owns the in-flight extract for that tab.
 * Set when inject starts; EXTRACT_RESULT must match or it is ignored.
 */
const extractGenerationByTab = new Map();

function sendToPanel(message) {
  if (!panelReady) {
    outboundQueue.push(message);
    return;
  }
  chrome.runtime.sendMessage(message).catch(() => {
    panelReady = false;
    outboundQueue.push(message);
  });
}

function flushQueue() {
  const pending = outboundQueue.splice(0, outboundQueue.length);
  for (const message of pending) {
    chrome.runtime.sendMessage(message).catch(() => {
      outboundQueue.push(message);
      panelReady = false;
    });
  }
}

function beginAnalyzeGeneration() {
  analyzeGeneration += 1;
  if (analyzeAbort) {
    try {
      analyzeAbort.abort();
    } catch {
      /* ignore */
    }
  }
  analyzeAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  return { generation: analyzeGeneration, signal: analyzeAbort?.signal };
}

// User clicks the toolbar icon -> this is our activeTab-granting user gesture.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  // New click supersedes any in-flight analyze / extract from a prior click.
  const { generation } = beginAnalyzeGeneration();
  extractGenerationByTab.set(tab.id, generation);

  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel/panel.html",
      enabled: true
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    sendToPanel({
      type: "VERILENS_STATUS",
      status: "error",
      error: "Couldn't open the side panel."
    });
    return;
  }

  sendToPanel({ type: "VERILENS_STATUS", status: "extracting" });

  try {
    // Tag the page with this click's generation before extractor runs so
    // VERILENS_EXTRACT_RESULT can be bound to generation + tabId.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/readability.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (gen) => {
        globalThis.__VERILENS_EXTRACT_GENERATION__ = gen;
      },
      args: [generation]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/extractor.js"]
    });
  } catch {
    // Inject failed — drop binding so a late stray result cannot claim this gen.
    if (extractGenerationByTab.get(tab.id) === generation) {
      extractGenerationByTab.delete(tab.id);
    }
    sendToPanel({
      type: "VERILENS_STATUS",
      status: "error",
      error: "Couldn't access this page. Try a standard article page (not chrome:// or a PDF)."
    });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "verilens-panel") return;
  panelReady = true;
  flushQueue();
  port.onDisconnect.addListener(() => {
    panelReady = false;
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "VERILENS_PANEL_READY") {
    panelReady = true;
    flushQueue();
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type !== "VERILENS_EXTRACT_RESULT") return false;

  const tabId = sender?.tab?.id;
  const msgGen = msg.generation;

  // Bind extract to the click that injected it: require tab + generation match.
  if (
    tabId == null ||
    msgGen == null ||
    extractGenerationByTab.get(tabId) !== msgGen ||
    msgGen !== analyzeGeneration
  ) {
    return false;
  }

  // This extract owns the current generation; clear pending binding.
  extractGenerationByTab.delete(tabId);

  if (!msg.ok) {
    sendToPanel({ type: "VERILENS_STATUS", status: "error", error: msg.error });
    return false;
  }

  // Reuse the click's generation + AbortSignal — do NOT bump again here
  // (a late extract must not call beginAnalyzeGeneration and win).
  const generation = msgGen;
  const signal = analyzeAbort?.signal;

  sendToPanel({ type: "VERILENS_STATUS", status: "analyzing" });

  (async () => {
    try {
      if (signal?.aborted || generation !== analyzeGeneration) return;

      const settings = await getSettings();
      const articleText = msg.article?.text || "";
      const analysis = validateAnalysis(
        await analyzeArticle(articleText, { ...settings, signal }),
        articleText
      );

      // Ignore stale results from an older generation.
      if (signal?.aborted || generation !== analyzeGeneration) return;

      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: true,
        article: msg.article,
        analysis
      });
    } catch (err) {
      if (signal?.aborted || generation !== analyzeGeneration) return;
      if (err?.name === "AbortError") return;
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: false,
        error: err?.message || "Analysis failed."
      });
    }
  })();

  return false;
});
