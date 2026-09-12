"""
VeriLens hosted analyze backend.
POST /analyze — flag loaded language / framing / editorializing; return neutral rewrite.
GET  /health  — liveness.
API keys only from env (OPENROUTER_API_KEY or OPENAI_API_KEY). Never log article bodies.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("verilens")

# Do not log article bodies by default.
LOG_ARTICLE_BODY = os.getenv("LOG_ARTICLE_BODY", "").lower() in ("1", "true", "yes")

ALLOWED_CATEGORIES = frozenset({"loaded_language", "framing", "editorializing"})

SYSTEM_PROMPT = """You are a strict, politically neutral news-analysis assistant.
Your job has two parts:

1. FLAG loaded language, slanted framing, or unsupported editorializing in the
   article text. For each flag give: the exact quoted phrase (verbatim,
   under 15 words), a category ("loaded_language" | "framing" | "editorializing"),
   and a one-sentence neutral reason. Do NOT flag ordinary factual statements,
   direct quotes from named sources, or analysis clearly labeled as opinion.

2. Produce a NEUTRAL VERSION: the same article with ONLY the flagged phrases
   minimally rephrased to be fact-preserving and neutral. Do not summarize,
   reorder, cut content, or change anything that wasn't flagged. If nothing
   is flagged, the neutral version is identical to the original.

You must apply this standard symmetrically regardless of which political
direction the language leans. Do not add commentary of your own. Respond
only in the requested structured format."""

JSON_INSTRUCTION = """Respond with JSON only (no markdown fences), matching this schema:
{
  "flags": [
    {
      "quote": "<verbatim phrase under 15 words>",
      "category": "loaded_language" | "framing" | "editorializing",
      "reason": "<one sentence>"
    }
  ],
  "neutralVersion": "<full article text with only flagged phrases minimally neutralized>"
}"""


def build_user_prompt(article_text: str) -> str:
    return f"Analyze this article text:\n\n\"\"\"\n{article_text}\n\"\"\"\n\n{JSON_INSTRUCTION}"


class FlagItem(BaseModel):
    quote: str
    category: str
    reason: str


class AnalyzeResponse(BaseModel):
    flags: list[FlagItem]
    neutralVersion: str
    backend: str = "hosted"


app = FastAPI(title="VeriLens Hosted Analyze", version="0.1.0")

# Chrome extension + local dev. Prefer regex so chrome-extension://<id> works.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:8787",
        "http://127.0.0.1",
        "http://127.0.0.1:8787",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^chrome-extension://[a-z0-9-]+$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _provider_config() -> dict[str, str]:
    """Pick OpenRouter if key present, else OpenAI. Keys never leave env."""
    openrouter_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()

    if openrouter_key:
        return {
            "api_key": openrouter_key,
            "base_url": (
                os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
            ).rstrip("/"),
            "model": os.getenv("OPENROUTER_MODEL")
            or "google/gemini-2.0-flash-lite:free",
            "provider": "openrouter",
        }
    if openai_key:
        return {
            "api_key": openai_key,
            "base_url": (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip(
                "/"
            ),
            "model": os.getenv("OPENAI_MODEL") or "gpt-4o-mini",
            "provider": "openai",
        }
    return {}


def _extract_article_text(body: dict[str, Any]) -> str:
    """Accept {text}, {articleText}, or legacy {userPrompt} (extract text if possible)."""
    for key in ("text", "articleText", "article_text"):
        val = body.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()

    # Legacy: client may send systemPrompt/userPrompt/schema — we ignore systemPrompt.
    user_prompt = body.get("userPrompt") or body.get("user_prompt")
    if isinstance(user_prompt, str) and user_prompt.strip():
        # Prefer text inside triple-quote blocks from buildUserPrompt shape.
        m = re.search(r'"""\s*(.*?)\s*"""', user_prompt, re.DOTALL)
        if m and m.group(1).strip():
            return m.group(1).strip()
        # Or "Analyze this article text:\n\n..." remainder
        m2 = re.search(
            r"Analyze this article text:\s*(.*)", user_prompt, re.DOTALL | re.IGNORECASE
        )
        if m2 and m2.group(1).strip():
            return m2.group(1).strip().strip('"').strip()
        return user_prompt.strip()

    raise HTTPException(
        status_code=400,
        detail='Missing article text. Send JSON {"text": "..."} or {"articleText": "..."}.',
    )


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _validate_and_normalize(data: dict[str, Any], original_text: str) -> dict[str, Any]:
    flags_in = data.get("flags")
    if not isinstance(flags_in, list):
        flags_in = []

    flags_out: list[dict[str, str]] = []
    for item in flags_in:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote") or "").strip()
        category = str(item.get("category") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if not quote or not reason:
            continue
        if category not in ALLOWED_CATEGORIES:
            # Drop invalid categories rather than inventing.
            continue
        flags_out.append({"quote": quote, "category": category, "reason": reason})

    neutral = data.get("neutralVersion") or data.get("neutral_version")
    if not isinstance(neutral, str) or not neutral.strip():
        neutral = original_text

    return {
        "flags": flags_out,
        "neutralVersion": neutral,
        "backend": "hosted",
    }


async def _call_llm(article_text: str) -> dict[str, Any]:
    cfg = _provider_config()
    if not cfg:
        raise HTTPException(
            status_code=503,
            detail=(
                "No API key configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY "
                "in the backend environment (see .env.example)."
            ),
        )

    # Client-supplied systemPrompt is intentionally ignored for integrity.
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(article_text)},
    ]

    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": 0.2,
    }
    # Encourage JSON when the provider supports it.
    if cfg["provider"] == "openai" or "openai" in cfg["base_url"]:
        payload["response_format"] = {"type": "json_object"}
    # OpenRouter often accepts response_format for many models; harmless if ignored.
    if cfg["provider"] == "openrouter":
        payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    if cfg["provider"] == "openrouter":
        # OpenRouter optional ranking headers; safe defaults for local tool.
        headers["HTTP-Referer"] = "http://127.0.0.1:8787"
        headers["X-Title"] = "VeriLens"

    url = f"{cfg['base_url']}/chat/completions"
    log.info(
        "analyze request provider=%s model=%s chars=%d",
        cfg["provider"],
        cfg["model"],
        len(article_text),
    )
    if LOG_ARTICLE_BODY:
        log.info("article body (debug): %s", article_text[:2000])

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        log.error("upstream request failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail=f"Upstream model request failed: {type(exc).__name__}"
        ) from exc

    if resp.status_code >= 400:
        # Do not echo API key or full body; short upstream message only.
        detail = f"Upstream model error HTTP {resp.status_code}"
        try:
            err_json = resp.json()
            msg = (
                (err_json.get("error") or {}).get("message")
                if isinstance(err_json.get("error"), dict)
                else err_json.get("error") or err_json.get("message")
            )
            if msg:
                detail = f"{detail}: {str(msg)[:300]}"
        except Exception:
            pass
        log.error("upstream error status=%s", resp.status_code)
        raise HTTPException(status_code=502, detail=detail)

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            # Some multimodal-style responses return content parts.
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        if not isinstance(content, str):
            content = str(content)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Upstream response missing message content"
        ) from exc

    try:
        parsed = json.loads(_strip_json_fences(content))
        if not isinstance(parsed, dict):
            raise ValueError("root not object")
    except (json.JSONDecodeError, ValueError) as exc:
        log.error("model returned non-JSON")
        raise HTTPException(
            status_code=502, detail="Model did not return valid JSON"
        ) from exc

    return _validate_and_normalize(parsed, article_text)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON body must be an object")

    # Prefer server-owned prompt; ignore client systemPrompt if present.
    if body.get("systemPrompt") or body.get("system_prompt"):
        log.info("ignoring client-supplied systemPrompt (server-owned prompt in use)")

    article_text = _extract_article_text(body)
    if len(article_text) > 200_000:
        raise HTTPException(status_code=413, detail="Article text too large (max ~200k chars)")

    result = await _call_llm(article_text)
    return JSONResponse(content=result)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "VeriLens hosted analyze",
        "health": "/health",
        "analyze": "POST /analyze",
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8787"))
    uvicorn.run("main:app", host=host, port=port, reload=False)
