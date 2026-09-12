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

  // New click supersedes any in-flight analyze from a prior click.
  beginAnalyzeGeneration();

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
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/readability.js", "content/extractor.js"]
    });
  } catch {
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "VERILENS_PANEL_READY") {
    panelReady = true;
    flushQueue();
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type !== "VERILENS_EXTRACT_RESULT") return false;

  if (!msg.ok) {
    sendToPanel({ type: "VERILENS_STATUS", status: "error", error: msg.error });
    return false;
  }

  // Serialize: cancel/ignore older in-flight when a new extract starts analyze.
  const { generation, signal } = beginAnalyzeGeneration();

  sendToPanel({ type: "VERILENS_STATUS", status: "analyzing" });

  (async () => {
    try {
      if (signal?.aborted || generation !== analyzeGeneration) return;

      const settings = await getSettings();
      const articleText = msg.article?.text || "";
      const analysis = validateAnalysis(
        await analyzeArticle(articleText, settings),
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
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: false,
        error: err?.message || "Analysis failed."
      });
    }
  })();

  return false;
});
