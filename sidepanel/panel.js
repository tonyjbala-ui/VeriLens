import {
  renderFlagList,
  renderHighlightedArticle,
  renderPlainParagraphs
} from "../lib/sanitize.js";

const statusArea = document.getElementById("status-area");
const disclosure = document.getElementById("disclosure");
const tabsNav = document.getElementById("tabs");
const panelsEl = document.getElementById("panels");
const badge = document.getElementById("backend-badge");
const feedbackEl = document.getElementById("feedback");

let currentArticleUrl = null;

function announceReady() {
  chrome.runtime.sendMessage({ type: "VERILENS_PANEL_READY" }).catch(() => {});
}

function holdPanelPort() {
  const port = chrome.runtime.connect({ name: "verilens-panel" });
  port.onDisconnect.addListener(() => {
    setTimeout(holdPanelPort, 250);
  });
  announceReady();
}

holdPanelPort();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") announceReady();
});
window.addEventListener("focus", announceReady);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "VERILENS_STATUS") handleStatus(msg);
  if (msg.type === "VERILENS_ANALYSIS_RESULT") handleResult(msg);
});

function handleStatus({ status, error }) {
  const messages = {
    extracting: "Reading the article on this page…",
    analyzing: "Analyzing for loaded language and framing…",
    error: error || "Something went wrong."
  };
  statusArea.textContent = messages[status] || "";
  statusArea.classList.remove("hidden");
  if (status === "error") {
    tabsNav.classList.add("hidden");
    panelsEl.classList.add("hidden");
    feedbackEl.classList.add("hidden");
  }
}

function handleResult(msg) {
  if (!msg.ok) {
    handleStatus({ status: "error", error: "Analysis failed: " + msg.error });
    return;
  }

  statusArea.classList.add("hidden");
  tabsNav.classList.remove("hidden");
  panelsEl.classList.remove("hidden");
  feedbackEl.classList.remove("hidden");

  const { article, analysis } = msg;
  currentArticleUrl = article.url;

  badge.textContent = analysis.backend === "nano" ? "On-device" : "Hosted AI";
  badge.className = "badge " + (analysis.backend === "nano" ? "nano" : "hosted");
  disclosure.classList.toggle("hidden", analysis.backend !== "hosted");

  renderHighlightedArticle(
    document.getElementById("panel-original"),
    article.text,
    analysis.flags
  );
  renderFlagList(document.getElementById("panel-flags"), analysis.flags);
  renderPlainParagraphs(
    document.getElementById("panel-neutral"),
    analysis.neutralVersion
  );
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

document.getElementById("learn-more").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("fb-up").addEventListener("click", () => submitFeedback(true));
document.getElementById("fb-down").addEventListener("click", () => submitFeedback(false));

async function submitFeedback(positive) {
  const key = "verilens_feedback";
  const { [key]: existing = [] } = await chrome.storage.local.get(key);
  existing.push({ url: currentArticleUrl, positive, ts: Date.now() });
  await chrome.storage.local.set({ [key]: existing });
  statusArea.textContent = "Thanks — feedback recorded.";
  statusArea.classList.remove("hidden");
  setTimeout(() => statusArea.classList.add("hidden"), 1500);
}
