# VeriLens 0.2.2 — ship checklist

## Unpacked load (fastest path)

1. Start the local analyze server if you will use hosted fallback
   (sibling `VeriLens\backend\`, default `http://127.0.0.1:8787/analyze`).
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select:

   `C:\Users\fight\Downloads\VeriLens`

   Do not select `backend\`. The extension root is the folder that contains
   `manifest.json`.
4. Pin the VeriLens icon. Open a news article. Click the icon.
5. If Nano is not downloaded, you should see the hosted disclosure (unless
   "Never send article text to a hosted service" is on).

## Optional: on-device Nano

Chrome 138+, desktop. Enable:

- `chrome://flags/#prompt-api-for-gemini-nano`
- `chrome://flags/#optimization-guide-on-device-model`

Then wait until `LanguageModel.availability()` reports `available`.

Nano session create uses the current Prompt API shape:

```js
LanguageModel.create({
  initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }]
});
// context check: session.measureContextUsage(...) vs session.contextWindow
// structured output: prompt(..., { responseConstraint })
```

Do **not** use obsolete `systemPrompt` / `countPromptTokens` / `tokensLeft`.

## Zip for CWS / sharing

```bash
node scripts/pack.mjs
```

Output:

`C:\Users\fight\Downloads\VeriLens\dist\verilens-0.2.2.zip`

The zip is the extension only (no `backend/`, no `.git`, no `node_modules`,
no `.env` / `**/.env`).

## Symmetry / bias ship-gate

`--offline` validates **fixture shape only**. It is **NOT** a bias PASS and
must not be treated as the ship-gate.

Ship-gate (live, paired, required for release):

```bash
# Start backend first (default http://127.0.0.1:8787/analyze)
node scripts/symmetry-check.mjs --ship-gate
```

Optional endpoint override:

```bash
VERILENS_ENDPOINT=http://127.0.0.1:8787/analyze node scripts/symmetry-check.mjs --ship-gate
```

Live rules (0.2.2):

- Per-story left/right pairing (same `id` on both sides).
- Every known-loaded cartoon must produce ≥1 valid flag; silent sides FAIL.
- 0-vs-0 pairs FAIL as theater.
- Asymmetry uses paired flag-**count** ratios (`maxCountRatio` / `maxPairRatio`
  in `fixtures/symmetry.json`), **not** binary any-flag Δ≤0.4 with n=5
  (that previously allowed 5-vs-3).

`--offline` + `--ship-gate` together exits non-zero.

Shape-only (CI fixture lint, not bias):

```bash
node scripts/symmetry-check.mjs --offline
```

## Pre-flight

- [ ] `manifest.json` version is `0.2.2`
- [ ] Icons `icons/icon16.png`, `icon48.png`, `icon128.png` load
- [ ] Side panel appears on toolbar click
- [ ] Rapid re-clicks ignore stale analyze results (generation token)
- [ ] EXTRACT_RESULT bound to click generation + tabId (late extract ignored)
- [ ] AbortSignal passed through analyzeArticle -> hosted fetch (and Nano when supported)
- [ ] Extract works on a Reuters/AP-style article
- [ ] Hosted POST body is `{ "text": "..." }` only — no API key
- [ ] Hosted path shows the disclosure
- [ ] `neverHosted` fails closed when Nano is missing
- [ ] `node scripts/symmetry-check.mjs --ship-gate` PASS (live backend)
- [ ] Options page saves `preferNano`, `hostedEndpoint`, `neverHosted`
- [ ] Custom HTTP hosted origins can request `http://*/*` optional host permission
- [ ] Validate rejects empty `neutralVersion` (non-empty input), empty `reason`,
      and quotes not present in source (whitespace-normalized)

## Host permissions

- Hard-coded localhost analyze: `http://127.0.0.1:8787/*`, `http://localhost:8787/*`
- Optional (user-granted via Options `ensureHostPermission`):
  - `https://*/*`
  - `http://*/*` — required so custom **HTTP** backends (not just HTTPS) work

## Store listing notes

- Single purpose: flag loaded language/framing on the current article.
- Privacy justification matches PRIVACY.md.
- Remote code: none. Hosted AI is a user-configured `fetch` of article text.
- Permission justification: activeTab user gesture only.

## Do not

- Put API keys in the extension or ship `.env` in the zip.
- Treat `--offline` symmetry as a bias/ship PASS.
- Overwrite `backend/` casually — that is a sibling deliverable.
