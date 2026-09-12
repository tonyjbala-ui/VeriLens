# VeriLens 0.2.0 — ship today

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

## Zip for CWS / sharing

```bash
node scripts/pack.mjs
```

Output:

`C:\Users\fight\Downloads\VeriLens\dist\verilens-0.2.0.zip`

The zip is the extension only (no `backend/`, no `.git`, no `node_modules`).

## Pre-flight

- [ ] `manifest.json` version is `0.2.0`
- [ ] Icons `icons/icon16.png`, `icon48.png`, `icon128.png` load
- [ ] Side panel appears on toolbar click
- [ ] Extract works on a Reuters/AP-style article
- [ ] Hosted POST body is `{ "text": "..." }` only — no API key
- [ ] Hosted path shows the disclosure
- [ ] `neverHosted` fails closed when Nano is missing
- [ ] `node scripts/symmetry-check.mjs` (needs backend) or `--offline`
- [ ] Options page saves `preferNano`, `hostedEndpoint`, `neverHosted`

## Store listing notes

- Single purpose: flag loaded language/framing on the current article.
- Privacy justification matches PRIVACY.md.
- Remote code: none. Hosted AI is a user-configured `fetch` of article text.
- Permission justification: activeTab user gesture only.

## Do not

- Put API keys in the extension.
- Commit this tree unless you explicitly decide to later.
- Overwrite `backend/` — that is a sibling deliverable.
