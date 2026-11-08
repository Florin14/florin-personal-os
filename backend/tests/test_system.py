"""System endpoints and cross-cutting HTTP behaviour."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Environment
from tests.conftest import AuthenticatedUser, UserFactory, build_app, make_settings

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


async def test_liveness(client: httpx.AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_health_reports_database(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/system/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "database": "ok"}


async def test_system_info_requires_full_auth(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
) -> None:
    assert (await client.get("/api/v1/system/info")).status_code == 401
    await login_full(await make_user())
    resp = await client.get("/api/v1/system/info")
    assert resp.status_code == 200
    body = resp.json()
    assert body["environment"] == "test"
    assert body["mfa_required"] is True
    assert {m["name"] for m in body["modules"]} == {"system", "identity", "workspaces"}


async def test_security_headers(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/system/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in resp.headers["content-security-policy"]


async def test_request_id_is_generated_or_propagated(client: httpx.AsyncClient) -> None:
    generated = await client.get("/healthz")
    assert len(generated.headers["x-request-id"]) == 16
    propagated = await client.get("/healthz", headers={"X-Request-ID": "abc-123"})
    assert propagated.headers["x-request-id"] == "abc-123"
    malformed = await client.get("/healthz", headers={"X-Request-ID": "bad id <script>"})
    assert malformed.headers["x-request-id"] != "bad id <script>"


async def test_unknown_route_uses_error_envelope(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


async def test_openapi_available_outside_production(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/openapi.json")
    assert resp.status_code == 200
    assert "/api/v1/auth/login" in resp.json()["paths"]


async def test_docs_disabled_in_production(encryption_key: str, db_session: AsyncSession) -> None:
    app = build_app(
        make_settings(encryption_key, app_env=Environment.PRODUCTION, session_cookie_secure=True),
        db_session,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/openapi.json")).status_code == 404
        assert (await client.get("/api/docs")).status_code == 404
