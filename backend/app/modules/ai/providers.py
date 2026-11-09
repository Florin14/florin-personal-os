"""Replaceable AI providers (ADR-023). No provider has tools: output is data only.

Ollama request/response fields follow the official API reference (POST /api/chat, non-streaming,
``format`` = JSON Schema for structured output; usage from ``prompt_eval_count``/``eval_count``).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.core.config import Settings


class AiUnavailable(Exception):
    """AI is disabled or not consented for this feature (deterministic paths still work)."""


class AiFailed(Exception):
    """The provider could not produce a valid answer (timeout, error, malformed output)."""


@dataclass(frozen=True, slots=True)
class AiRequest:
    system: str
    prompt: str
    schema: dict[str, Any]  # JSON Schema the answer must follow
    max_output_tokens: int = 600


@dataclass(frozen=True, slots=True)
class AiResult:
    content: str  # JSON text, validated by the caller
    input_tokens: int
    output_tokens: int
    duration_ms: int


class AiProvider(Protocol):
    name: str
    model: str

    async def complete(self, request: AiRequest) -> AiResult: ...


class DisabledProvider:
    name = "disabled"
    model = ""

    async def complete(self, request: AiRequest) -> AiResult:
        raise AiUnavailable("AI is disabled on this server (AI_PROVIDER=disabled).")


class OllamaProvider:
    """Local Ollama server; the base URL comes from the environment, never from users."""

    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float) -> None:
        self._url = base_url.rstrip("/") + "/api/chat"
        self.model = model
        self._timeout = timeout

    async def complete(self, request: AiRequest) -> AiResult:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.prompt},
            ],
            "stream": False,
            "format": request.schema,
            "options": {"temperature": 0, "num_predict": request.max_output_tokens},
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=False) as client:
                response = await client.post(self._url, json=body)
        except httpx.TimeoutException as exc:
            raise AiFailed("The local model did not answer in time.") from exc
        except httpx.HTTPError as exc:
            raise AiFailed("The local AI server is not reachable.") from exc
        if response.status_code != 200:
            raise AiFailed(f"The local AI server answered HTTP {response.status_code}.")
        try:
            data = response.json()
            content = data["message"]["content"]
        except (ValueError, KeyError, TypeError) as exc:
            raise AiFailed("The local AI server returned an unexpected response.") from exc
        if not isinstance(content, str):
            raise AiFailed("The local AI server returned an unexpected response.")
        return AiResult(
            content=content,
            input_tokens=int(data.get("prompt_eval_count") or 0),
            output_tokens=int(data.get("eval_count") or 0),
            duration_ms=int((time.monotonic() - started) * 1000),
        )


def provider_for(settings: Settings) -> AiProvider:
    if settings.ai_provider == "ollama":
        return OllamaProvider(
            settings.ollama_base_url, settings.ollama_model, settings.ai_timeout_seconds
        )
    return DisabledProvider()
