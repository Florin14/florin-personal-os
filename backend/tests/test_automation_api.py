"""Automation HTTP API tests (authorization, validation, versioning, controls)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.modules.workspaces.models import Role
from app.modules.workspaces.service import WorkspaceService
from tests.conftest import AuthenticatedUser, UserFactory, csrf_headers

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]

DEFINITION: dict[str, Any] = {
    "steps": [{"key": "log", "type": "action", "action": "core.log", "params": {"message": "hi"}}]
}


async def _setup(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull, *, admin: bool = False
) -> tuple[str, AuthenticatedUser]:
    owner = await make_user(is_admin=admin)
    ws = await make_user.workspace(owner, "api")
    auth = await login_full(owner)
    return f"/api/v1/workspaces/{ws.id}", auth


async def test_crud_versioning_and_runs(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull, settings: Settings
) -> None:
    base, _ = await _setup(client, make_user, login_full)
    headers = csrf_headers(client, settings)

    created = await client.post(
        f"{base}/automations",
        json={"name": "Hello", "description": "d", "definition": DEFINITION},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    automation = created.json()
    assert automation["version"] == 1
    url = f"{base}/automations/{automation['id']}"

    # Same definition -> no new version; changed definition -> version 2.
    same = await client.put(url, json={"definition": DEFINITION}, headers=headers)
    assert same.json()["version"] == 1
    changed = DEFINITION | {
        "triggers": [{"type": "interval", "key": "hourly", "seconds": 3600}, {"type": "manual"}]
    }
    updated = await client.put(url, json={"definition": changed}, headers=headers)
    assert updated.json()["version"] == 2
    assert updated.json()["triggers"][0]["next_fire_at"] is not None
    versions = (await client.get(f"{url}/versions")).json()
    assert [v["version"] for v in versions] == [2, 1]

    run = await client.post(f"{url}/run", json={"dry_run": True}, headers=headers)
    assert run.status_code == 202
    assert run.json()["status"] == "pending"
    execution_id = run.json()["id"]
    listed = (await client.get(f"{base}/executions")).json()
    assert [e["id"] for e in listed] == [execution_id]
    detail = (await client.get(f"{base}/executions/{execution_id}")).json()
    assert detail["dry_run"] is True
    assert detail["steps"] == []

    cancelled = await client.post(f"{base}/executions/{execution_id}/cancel", headers=headers)
    assert cancelled.json()["cancel_requested"] is True

    disabled = await client.put(f"{url}/enabled", json={"enabled": False}, headers=headers)
    assert disabled.json()["enabled"] is False
    blocked = await client.post(f"{url}/run", json={}, headers=headers)
    assert blocked.status_code == 409


async def test_invalid_workflow_is_rejected(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull, settings: Settings
) -> None:
    base, _ = await _setup(client, make_user, login_full)
    resp = await client.post(
        f"{base}/automations",
        json={
            "name": "Bad",
            "definition": {"steps": [{"key": "x", "type": "action", "action": "os.system"}]},
        },
        headers=csrf_headers(client, settings),
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_workflow"


async def test_role_requirements(
    client: httpx.AsyncClient,
    make_user: UserFactory,
    login_full: LoginFull,
    settings: Settings,
    db_session: AsyncSession,
) -> None:
    owner, viewer, stranger = await make_user(), await make_user(), await make_user()
    ws = await make_user.workspace(owner, "roles")
    await WorkspaceService(db_session).add_member(ws.id, viewer.id, Role.VIEWER)
    await login_full(viewer)
    headers = csrf_headers(client, settings)
    base = f"/api/v1/workspaces/{ws.id}"
    assert (await client.get(f"{base}/automations")).status_code == 200
    denied = await client.post(
        f"{base}/automations", json={"name": "x", "definition": DEFINITION}, headers=headers
    )
    assert denied.status_code == 403

    await client.post("/api/v1/auth/logout", headers=headers)
    await login_full(stranger)
    assert (await client.get(f"{base}/automations")).status_code == 404


async def test_action_catalog_and_emergency_stop(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull, settings: Settings
) -> None:
    await _setup(client, make_user, login_full)
    headers = csrf_headers(client, settings)
    actions = (await client.get("/api/v1/automation/actions")).json()
    log = next(a for a in actions if a["name"] == "core.log")
    assert "message" in log["params_schema"]["properties"]

    assert (await client.get("/api/v1/automation/controls")).json()["emergency_stop"] is False
    forbidden = await client.put(
        "/api/v1/automation/controls/emergency-stop", json={"active": True}, headers=headers
    )
    assert forbidden.status_code == 403


async def test_admin_can_toggle_emergency_stop(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull, settings: Settings
) -> None:
    await _setup(client, make_user, login_full, admin=True)
    headers = csrf_headers(client, settings)
    resp = await client.put(
        "/api/v1/automation/controls/emergency-stop",
        json={"active": True, "reason": "suspicious activity"},
        headers=headers,
    )
    assert resp.json()["emergency_stop"] is True
    assert resp.json()["reason"] == "suspicious activity"
    resp = await client.put(
        "/api/v1/automation/controls/emergency-stop", json={"active": False}, headers=headers
    )
    assert resp.json()["emergency_stop"] is False
