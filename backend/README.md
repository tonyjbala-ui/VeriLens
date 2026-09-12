# VeriLens Hosted Analyze Backend

Minimal FastAPI service for the Chrome extension hosted fallback.

- `GET /health` → `{ "status": "ok" }`
- `POST /analyze` → `{ flags, neutralVersion, backend: "hosted" }`
- Default listen: `http://127.0.0.1:8787`
- Extension should set `HOSTED_ENDPOINT` to `http://127.0.0.1:8787/analyze`

## Setup (Windows)

```powershell
cd C:\Users\fight\Downloads\VeriLens\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY
```

## Run

```powershell
cd C:\Users\fight\Downloads\VeriLens\backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 127.0.0.1 --port 8787
```

Or:

```powershell
python main.py
```

## Request body

Preferred:

```json
{ "text": "article paragraphs..." }
```

Also accepted: `{ "articleText": "..." }`.

Legacy `{ "systemPrompt", "userPrompt", "schema" }` is accepted for compatibility, but **client `systemPrompt` is ignored** — the server always uses its built-in VeriLens SYSTEM_PROMPT.

## Response

```json
{
  "flags": [
    { "quote": "...", "category": "loaded_language", "reason": "..." }
  ],
  "neutralVersion": "...",
  "backend": "hosted"
}
```

Categories whitelist: `loaded_language` | `framing` | `editorializing`.

## Provider defaults

| Env | Default |
|-----|---------|
| `OPENROUTER_API_KEY` | (preferred if set) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-lite:free` |
| `OPENAI_API_KEY` | used if OpenRouter key absent |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | `gpt-4o-mini` |

With no key configured, `/analyze` returns **503** with a clear message (server still starts).

## CORS

Allows `chrome-extension://*` and `http://localhost` / `http://127.0.0.1` (any port).

## Privacy

Article body is **not** logged by default. Set `LOG_ARTICLE_BODY=1` only for local debugging.

## Smoke test

```powershell
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/analyze -H "Content-Type: application/json" -d "{\"text\":\"Officials said the policy would help families. Critics called it a reckless giveaway.\"}"
```
