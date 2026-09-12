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

/**
 * True after we have started (or attempted) extract/analyze for the current
 * panel session. Cleared when the panel port disconnects so a later open can
 * kick off again. Prevents PANEL_READY / focus spam from double-starting.
 */
let panelSessionHadStart = false;

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

function isAnalysisInFlight(tabId) {
  if (tabId == null) return false;
  const bound = extractGenerationByTab.get(tabId);
  if (bound != null && bound === analyzeGeneration) return true;
  // Analyze phase after extract cleared the map binding.
  if (
    analyzeAbort &&
    !analyzeAbort.signal.aborted &&
    analyzeGeneration > 0 &&
    panelSessionHadStart
  ) {
    return true;
  }
  return false;
}

function setErrorBadge(reason) {
  console.error("VeriLens:", reason);
  try {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
  } catch (err) {
    console.error("VeriLens: could not set error badge", err);
  }
  try {
    if (chrome.notifications?.create) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "VeriLens",
        message: String(reason).slice(0, 120)
      });
    }
  } catch {
    /* notifications permission optional */
  }
}

function clearErrorBadge() {
  try {
    chrome.action.setBadgeText({ text: "" });
  } catch {
    /* ignore */
  }
}

function sidePanelAvailable() {
  return Boolean(chrome.sidePanel?.setOptions && chrome.sidePanel?.open);
}

async function enableOpenPanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    console.error("VeriLens: chrome.sidePanel.setPanelBehavior missing");
    return false;
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return true;
  } catch (err) {
    console.error("VeriLens: setPanelBehavior failed", err);
    setErrorBadge("Side panel behavior unavailable");
    return false;
  }
}

async function openSidePanelForTab(tab) {
  if (!tab?.id) return false;

  if (!sidePanelAvailable()) {
    const url = chrome.runtime.getURL("sidepanel/panel.html");
    try {
      await chrome.tabs.create({ url });
    } catch (err) {
      console.error("VeriLens: fallback panel tab failed", err);
    }
    setErrorBadge("Side panel API missing");
    sendToPanel({
      type: "VERILENS_STATUS",
      status: "error",
      error: "Side panel isn't available in this browser. Opened panel in a new tab instead."
    });
    return false;
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel/panel.html",
      enabled: true
    });
    await chrome.sidePanel.open({ tabId: tab.id });
    clearErrorBadge();
    return true;
  } catch (err) {
    console.error("VeriLens: sidePanel.open failed", err);
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/panel.html") });
    } catch (tabErr) {
      console.error("VeriLens: fallback panel tab failed", tabErr);
    }
    setErrorBadge("Couldn't open panel");
    sendToPanel({
      type: "VERILENS_STATUS",
      status: "error",
      error: "Couldn't open the side panel."
    });
    return false;
  }
}

/**
 * Inject extractor and start analyze pipeline for a tab.
 * Uses generation map so a concurrent onClicked + PANEL_READY kickoff
 * does not double-start the same wave.
 */
async function startExtractAndAnalyze(tab, { force = false } = {}) {
  if (!tab?.id) return false;

  if (!force && isAnalysisInFlight(tab.id)) {
    return false;
  }

  const { generation } = beginAnalyzeGeneration();
  extractGenerationByTab.set(tab.id, generation);
  panelSessionHadStart = true;
  clearErrorBadge();

  sendToPanel({ type: "VERILENS_STATUS", status: "extracting" });

  try {
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
    return true;
  } catch (err) {
    console.error("VeriLens: inject failed", err);
    if (extractGenerationByTab.get(tab.id) === generation) {
      extractGenerationByTab.delete(tab.id);
    }
    setErrorBadge("Page access failed");
    sendToPanel({
      type: "VERILENS_STATUS",
      status: "error",
      error: "Couldn't access this page. Try a standard article page (not chrome:// or a PDF)."
    });
    return false;
  }
}

async function maybeKickoffActiveTab() {
  if (panelSessionHadStart) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (isAnalysisInFlight(tab.id)) {
      panelSessionHadStart = true;
      return;
    }
    await startExtractAndAnalyze(tab, { force: false });
  } catch (err) {
    console.error("VeriLens: active-tab kickoff failed", err);
    setErrorBadge("Kickoff failed");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableOpenPanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  enableOpenPanelOnActionClick();
});

// Also set on SW wake (install/startup can miss a warm extension reload).
enableOpenPanelOnActionClick();

// User clicks the toolbar icon -> activeTab-granting user gesture when it fires.
// With setPanelBehavior({ openPanelOnActionClick: true }), Chrome often does NOT
// fire onClicked; Brave may be flaky either way — PANEL_READY kickoff covers that.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  panelSessionHadStart = true;
  await openSidePanelForTab(tab);
  // Force: explicit click always supersedes any prior in-flight work.
  await startExtractAndAnalyze(tab, { force: true });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "verilens-panel") return;
  panelReady = true;
  flushQueue();
  maybeKickoffActiveTab();
  port.onDisconnect.addListener(() => {
    panelReady = false;
    panelSessionHadStart = false;
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "VERILENS_PANEL_READY") {
    panelReady = true;
    flushQueue();
    maybeKickoffActiveTab();
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
    setErrorBadge(msg.error || "Extract failed");
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

      clearErrorBadge();
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: true,
        article: msg.article,
        analysis
      });
    } catch (err) {
      if (signal?.aborted || generation !== analyzeGeneration) return;
      if (err?.name === "AbortError") return;
      setErrorBadge(err?.message || "Analysis failed");
      sendToPanel({
        type: "VERILENS_ANALYSIS_RESULT",
        ok: false,
        error: err?.message || "Analysis failed."
      });
    }
  })();

  return false;
});
