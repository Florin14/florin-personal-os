"""Contracts for third-party integrations (provider adapters).

Every provider declares a typed, non-secret ``config_model`` and a
``secrets_model`` (stored encrypted, never returned by the API), plus a
health check. Adapters raise ``ProviderError`` with a normalized kind so
callers and the job system can decide whether to retry.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import httpx
from pydantic import BaseModel


class ProviderErrorKind(StrEnum):
    AUTH = "auth"  # credentials rejected/revoked: stop and require reconnection
    RATE_LIMITED = "rate_limited"  # retry later
    UNAVAILABLE = "unavailable"  # 5xx / network: retry with backoff
    TIMEOUT = "timeout"  # outcome unknown: retry with the same idempotency key
    INVALID_REQUEST = "invalid_request"  # 4xx validation: do not retry
    NOT_CONFIGURED = "not_configured"


RETRYABLE_KINDS = frozenset(
    {ProviderErrorKind.RATE_LIMITED, ProviderErrorKind.UNAVAILABLE, ProviderErrorKind.TIMEOUT}
)


class ProviderError(Exception):
    def __init__(self, provider: str, kind: ProviderErrorKind, message: str) -> None:
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.kind = kind
        self.message = message

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE_KINDS


class IntegrationScope(StrEnum):
    WORKSPACE = "workspace"  # e.g. Oblio account of a business workspace
    SYSTEM = "system"  # e.g. the private Discord bot


HealthCheck = Callable[[BaseModel, BaseModel], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class IntegrationProvider:
    key: str
    title: str
    description: str
    scope: IntegrationScope
    config_model: type[BaseModel]
    secrets_model: type[BaseModel]
    health_check: HealthCheck = field(repr=False)
    capabilities: Sequence[str] = ()
    docs_url: str | None = None


def normalize_http_error(provider: str, exc: Exception) -> ProviderError:
    """Map httpx exceptions/responses to a normalized ProviderError (no secrets in messages)."""
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, httpx.TimeoutException):
        return ProviderError(provider, ProviderErrorKind.TIMEOUT, "request timed out")
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        detail = _safe_detail(exc.response)
        if status in (401, 403):
            return ProviderError(provider, ProviderErrorKind.AUTH, f"HTTP {status}: {detail}")
        if status == 429:
            return ProviderError(provider, ProviderErrorKind.RATE_LIMITED, "rate limit exceeded")
        if status >= 500:
            return ProviderError(provider, ProviderErrorKind.UNAVAILABLE, f"HTTP {status}")
        return ProviderError(
            provider, ProviderErrorKind.INVALID_REQUEST, f"HTTP {status}: {detail}"
        )
    if isinstance(exc, httpx.TransportError):
        return ProviderError(provider, ProviderErrorKind.UNAVAILABLE, type(exc).__name__)
    return ProviderError(provider, ProviderErrorKind.UNAVAILABLE, type(exc).__name__)


def _safe_detail(response: httpx.Response) -> str:
    try:
        body: Any = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(body, dict):
        for key in ("statusMessage", "message", "error"):
            if isinstance(body.get(key), str):
                return str(body[key])[:200]
    return str(body)[:200]


def http_client(base_url: str, *, timeout: float = 20.0) -> httpx.AsyncClient:
    """Outbound client for fixed provider URLs only (never user-supplied URLs: SSRF)."""
    return httpx.AsyncClient(
        base_url=base_url,
        timeout=httpx.Timeout(timeout, connect=5.0),
        follow_redirects=False,
        headers={"User-Agent": "personal-os/0.1"},
    )
