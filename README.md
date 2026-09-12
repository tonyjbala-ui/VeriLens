# VeriLens

Flags loaded language and framing in the article you're already reading and
shows a minimal, fact-preserving neutral version side-by-side. The original
is always shown in full; nothing is hidden or summarized.

**Version 0.2.4** — production Chrome MV3 extension. No API keys in the bundle.

## Load it (unpacked)

1. Open `chrome://extensions` and enable Developer Mode.
2. Click **Load unpacked** and select this folder (`VeriLens`).
3. Open a standard news article and click the VeriLens toolbar icon.

Full ship checklist: [SHIP.md](SHIP.md). Privacy details: [PRIVACY.md](PRIVACY.md).

## What it does

- **Extract** the article with vendored Mozilla Readability (`lib/readability.js`),
  falling back to a paragraph-density heuristic if Readability returns too little text.
- **Analyze** with Gemini Nano (Chrome Prompt API) when available, otherwise POST
  `{ "text": "..." }` to a hosted endpoint. The server owns the prompt.
- **Show** original / flags / neutral suggestion in the side panel. Model output
  is validated against a category whitelist and rendered with `textContent` only.

## Options

Right-click the icon → Options, or open the options page from the hosted-AI disclosure.

| Setting | Default | Meaning |
| --- | --- | --- |
| `preferNano` | on | Try on-device Gemini Nano first |
| `hostedEndpoint` | `http://127.0.0.1:8787/analyze` | Hosted fallback URL |
| `neverHosted` | off | Fail instead of sending article text off-device |

## Before trusting output: symmetry test

`fixtures/symmetry.json` has 5 left-coded and 5 right-coded sentences for the
same five stories. Run:

```bash
node scripts/symmetry-check.mjs
```

This is the test most likely to catch the model laundering its own politics
as "neutral." Do it before trusting any output, not after.

## Pack for distribution

```bash
node scripts/pack.mjs
```

Writes `dist/verilens-0.2.4.zip` (extension only; does not include `backend/`).

## Known limitations (by design)

- No mobile support (Chrome extensions don't run on mobile Chrome).
- Omission bias is out of scope — single-article analysis cannot detect what a story left out.
- Analysis starts when you open the panel (toolbar click). Required `host_permissions`
  for `http(s)://*/*` let scripting run even when `action.onClicked` is swallowed by
  `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

## Vendored code

`lib/readability.js` is Mozilla Readability, Apache-2.0.
See `lib/READABILITY-LICENSE.txt`.
