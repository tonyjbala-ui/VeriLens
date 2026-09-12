# VeriLens privacy policy

VeriLens is a Chrome extension that analyzes the article on the current tab
when you click its toolbar icon. It does not scrape the web in the background
and does not include API keys.

## What data is processed

- **On click only:** the current tab's article text (title, URL, extracted body).
- **Feedback (optional):** a thumbs-up/down, the article URL, and a timestamp,
  stored in `chrome.storage.local` on this device.

VeriLens does not collect account identifiers, does not sell data, and does
not include advertising or analytics SDKs.

## Where analysis runs

1. **On-device (Gemini Nano / Prompt API)** when Chrome reports the model as
   available and you have "Prefer on-device" enabled. Article text stays on
   this computer.
2. **Hosted fallback** when Nano is unavailable (or you disabled the Nano
   preference) and you have not enabled "Never send article text to a hosted
   service." The extension POSTs JSON `{ "text": "<article>" }` to the
   endpoint you configured (default `http://127.0.0.1:8787/analyze`). The
   server owns the prompt. A disclosure is shown whenever hosted analysis ran.

If both paths are unavailable, analysis fails and nothing further is sent.

## Permissions

- `activeTab`, `scripting` — read the page you asked to analyze.
- `storage` — settings and local feedback.
- `sidePanel` — show results beside the article.
- Host access to `http://127.0.0.1:8787` / `localhost:8787` for the default
  local backend, plus required `https://*/*` and `http://*/*` so article
  extraction can run on news sites when the side panel opens without a
  separate `activeTab` gesture (Chrome often skips `action.onClicked` when
  `openPanelOnActionClick` is enabled).

## What we do not do

- No API keys or secrets in the extension package.
- No remote code.
- No automatic collection from sites you did not open VeriLens on.
- Feedback never leaves the browser unless you export it yourself.

## Contact

Ship and review notes live in SHIP.md in this folder.
