"""Audit trail tests."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import REDACTED
from app.modules.audit.models import AuditRecord
from app.modules.audit.public import AuditRecorder, Outcome
from app.modules.workspaces.models import Role
from app.modules.workspaces.service import WorkspaceService
from tests.conftest import AuthenticatedUser, UserFactory

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


async def _actions(db: AsyncSession, user_id: object) -> list[str]:
    rows = await db.scalars(
        select(AuditRecord.action)
        .where(AuditRecord.actor_user_id == user_id)
        .order_by(AuditRecord.occurred_at, AuditRecord.action)
    )
    return list(rows)


async def test_authentication_events_are_audited(
    client: httpx.AsyncClient,
    make_user: UserFactory,
    login_full: LoginFull,
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    await login_full(user)
    actions = await _actions(db_session, user.id)
    assert "user.created" in actions
    assert "auth.login.password_ok" in actions
    assert "auth.mfa.enrolled" in actions


async def test_failed_login_is_audited_without_secrets(
    client: httpx.AsyncClient, make_user: UserFactory, db_session: AsyncSession
) -> None:
    user = await make_user()
    await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "wrong-password-xyz"}
    )
    record = await db_session.scalar(
        select(AuditRecord).where(
            AuditRecord.actor_user_id == user.id, AuditRecord.action == "auth.login.failed"
        )
    )
    assert record is not None
    assert record.outcome == "failure"
    assert "wrong-password-xyz" not in str(record.details)


async def test_details_are_redacted(db_session: AsyncSession) -> None:
    record = AuditRecorder(db_session).record(
        "test.event", details={"password": "p", "api_key": "k", "amount": "10.00"}
    )
    await db_session.commit()
    assert record.details == {"password": REDACTED, "api_key": REDACTED, "amount": "10.00"}


async def test_records_cannot_be_updated(db_session: AsyncSession) -> None:
    record = AuditRecorder(db_session).record("test.immutable", outcome=Outcome.SUCCESS)
    await db_session.commit()
    with pytest.raises(DBAPIError, match="append-only"):
        await db_session.execute(
            text("UPDATE audit_records SET action = 'tampered' WHERE id = :id"), {"id": record.id}
        )
    await db_session.rollback()


async def test_users_only_see_their_own_records(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
) -> None:
    other = await make_user()
    me = await make_user()
    await login_full(me)
    resp = await client.get("/api/v1/audit", params={"limit": 200})
    assert resp.status_code == 200
    actors = {r["actor_user_id"] for r in resp.json()}
    assert str(me.id) in actors
    assert str(other.id) not in actors


async def test_workspace_admins_see_workspace_records(
    client: httpx.AsyncClient,
    make_user: UserFactory,
    login_full: LoginFull,
    db_session: AsyncSession,
) -> None:
    owner, member = await make_user(), await make_user()
    ws = await make_user.workspace(owner, "audited")
    await WorkspaceService(db_session).add_member(ws.id, member.id, Role.MEMBER)
    AuditRecorder(db_session).record("ws.event", actor_user_id=member.id, workspace_id=ws.id)
    await db_session.commit()

    await login_full(owner)
    resp = await client.get("/api/v1/audit", params={"workspace_id": str(ws.id)})
    assert [r["action"] for r in resp.json()] == ["ws.event"]


async def test_action_prefix_filter(
    client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
) -> None:
    await login_full(await make_user())
    resp = await client.get("/api/v1/audit", params={"action_prefix": "auth.mfa"})
    assert resp.status_code == 200
    assert resp.json()
    assert all(r["action"].startswith("auth.mfa") for r in resp.json())
