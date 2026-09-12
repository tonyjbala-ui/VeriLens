// background/service-worker.js
import { analyzeArticle } from "../lib/ai-backend.js";
import { validateAnalysis } from "../lib/validate.js";
import { getSettings } from "../lib/settings.js";

let panelReady = false;
const outboundQueue = [];

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

// User clicks the toolbar icon -> this is our activeTab-granting user gesture.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

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

  sendToPanel({ type: "VERILENS_STATUS", status: "analyzing" });

  (async () => {
    try {
      const settings = await getSettings();
      const analysis = validateAnalysis(
        await analyzeArticle(msg.article.text, settings)
      );
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: true,
        article: msg.article,
        analysis
      });
    } catch (err) {
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: false,
        error: err?.message || "Analysis failed."
      });
    }
  })();

  return false;
});
