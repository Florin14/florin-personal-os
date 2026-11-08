"""ASGI middleware: request ids, security headers and Origin validation."""

from __future__ import annotations

import re
import secrets
from collections.abc import Iterable

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.http import error_response
from app.core.logging import request_id_var

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

API_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
}
# JSON API responses never need to load anything.
API_CSP = "default-src 'none'; frame-ancestors 'none'"
# Interactive API docs (development only) are excluded from the strict CSP.
DOCS_PATH_PREFIXES = ("/api/docs", "/api/redoc")


class RequestIdMiddleware:
    """Assigns a request id (or accepts a well-formed incoming one) for log correlation."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if _REQUEST_ID_PATTERN.match(incoming) else secrets.token_hex(8)
        token = request_id_var.set(request_id)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["x-request-id"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_docs = str(scope.get("path", "")).startswith(DOCS_PATH_PREFIXES)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in API_SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                if not is_docs:
                    headers.setdefault("content-security-policy", API_CSP)
                    headers.setdefault("cache-control", "no-store")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class OriginCheckMiddleware:
    """Rejects unsafe browser requests whose Origin is not explicitly allowed.

    Browsers always send ``Origin`` on cross-origin and same-origin ``fetch``
    POST requests, so this blocks cross-site form/fetch submissions (including
    login CSRF). Requests without an ``Origin`` header (non-browser clients)
    pass; authenticated endpoints additionally require a CSRF token.
    """

    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str]) -> None:
        self.app = app
        self.allowed = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("method") in UNSAFE_METHODS:
            origin = Headers(scope=scope).get("origin")
            if origin is not None and origin.rstrip("/") not in self.allowed:
                response = error_response(403, "origin_not_allowed", "Request origin not allowed.")
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
