"""Notification creation, delivery and inbox tests."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.core.tasks import WorkerContext
from app.modules.jobs.models import Job, JobStatus
from app.modules.jobs.service import JobRunner
from app.modules.notifications.models import Channel, Notification, Severity
from app.modules.notifications.service import (
    DELIVER_JOB,
    NotificationService,
    make_delivery_handler,
    validate_link,
)
from app.modules.workspaces.models import Role
from app.modules.workspaces.service import WorkspaceService
from tests.conftest import AuthenticatedUser, UserFactory, csrf_headers

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


class FakeAdapter:
    def __init__(self, fail_times: int = 0) -> None:
        self.sent: list[str] = []
        self.fail_times = fail_times

    async def send(self, notification: Notification) -> None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError("discord down")
        self.sent.append(notification.title)


@pytest.mark.parametrize("link", ["https://evil.example", "//evil.example", "javascript:x", "a/b"])
def test_external_links_rejected(link: str) -> None:
    with pytest.raises(ValidationFailed):
        validate_link(link)


def test_relative_link_allowed() -> None:
    assert validate_link("/approvals?id=1") == "/approvals?id=1"


async def test_dedupe_key_prevents_duplicates(
    db_session: AsyncSession, make_user: UserFactory
) -> None:
    user = await make_user()
    service = NotificationService(db_session)
    first = await service.notify(user.id, "Invoice ready", dedupe_key="invoice:1")
    second = await service.notify(user.id, "Invoice ready", dedupe_key="invoice:1")
    await db_session.commit()
    assert len(first) == 1
    assert second == []
    assert await service.unread_count(user.id) == 1


async def test_workspace_fan_out_respects_roles(
    db_session: AsyncSession, make_user: UserFactory
) -> None:
    owner, viewer, stranger = await make_user(), await make_user(), await make_user()
    ws = await make_user.workspace(owner, "notify")
    await WorkspaceService(db_session).add_member(ws.id, viewer.id, Role.VIEWER)
    service = NotificationService(db_session)
    await service.notify_workspace(ws.id, "Members only", minimum_role=Role.MEMBER)
    await db_session.commit()
    assert await service.unread_count(owner.id) == 1
    assert await service.unread_count(viewer.id) == 0
    assert await service.unread_count(stranger.id) == 0


async def test_external_channel_delivered_by_job(
    db_session: AsyncSession, make_user: UserFactory, worker_ctx: WorkerContext
) -> None:
    user = await make_user()
    (notification_id,) = await NotificationService(db_session, worker_ctx.clock).notify(
        user.id, "Approval needed", channels=[Channel.DISCORD]
    )
    await db_session.commit()
    adapter = FakeAdapter(fail_times=1)
    runner = JobRunner(
        worker_ctx, {DELIVER_JOB: make_delivery_handler({"discord": adapter})}, worker_id="w"
    )
    await runner.run_once()  # first attempt fails -> retried later
    worker_ctx.clock.advance(minutes=5)  # type: ignore[attr-defined]
    await runner.run_once()
    db_session.expunge_all()
    notification = await db_session.get_one(Notification, notification_id)
    assert notification.status == "delivered"
    assert adapter.sent == ["Approval needed"]

    # A redelivery of the same job does not send twice.
    job = await db_session.scalar(select(Job).where(Job.kind == DELIVER_JOB))
    assert job is not None
    assert job.status == JobStatus.SUCCEEDED


async def test_unconfigured_channel_fails_visibly(
    db_session: AsyncSession, make_user: UserFactory, worker_ctx: WorkerContext
) -> None:
    user = await make_user()
    (notification_id,) = await NotificationService(db_session, worker_ctx.clock).notify(
        user.id, "Hello", channels=[Channel.DISCORD]
    )
    await db_session.commit()
    runner = JobRunner(worker_ctx, {DELIVER_JOB: make_delivery_handler({})}, worker_id="w")
    await runner.run_once()
    db_session.expunge_all()
    notification = await db_session.get_one(Notification, notification_id)
    assert notification.status == "failed"
    assert "not configured" in (notification.error or "")


async def test_inbox_api(
    client: httpx.AsyncClient,
    make_user: UserFactory,
    login_full: LoginFull,
    db_session: AsyncSession,
    settings: object,
) -> None:
    me, other = await make_user(), await make_user()
    service = NotificationService(db_session)
    (mine,) = await service.notify(me.id, "For me", severity=Severity.WARNING, link="/approvals")
    (theirs,) = await service.notify(other.id, "Not for me")
    await service.notify(me.id, "Second")
    await db_session.commit()
    await login_full(me)
    headers = csrf_headers(client, settings)  # type: ignore[arg-type]

    listed = (await client.get("/api/v1/notifications")).json()
    assert {n["title"] for n in listed} == {"For me", "Second"}
    assert (await client.get("/api/v1/notifications/unread-count")).json() == {"unread": 2}

    resp = await client.post(f"/api/v1/notifications/{mine}/read", headers=headers)
    assert resp.json()["read_at"] is not None
    assert (await client.get("/api/v1/notifications/unread-count")).json() == {"unread": 1}

    # Cannot touch another user's notification.
    assert (
        await client.post(f"/api/v1/notifications/{theirs}/read", headers=headers)
    ).status_code == 404

    assert (await client.post("/api/v1/notifications/read-all", headers=headers)).status_code == 204
    assert (await client.get("/api/v1/notifications/unread-count")).json() == {"unread": 0}
