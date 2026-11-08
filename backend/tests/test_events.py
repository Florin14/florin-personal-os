"""Transactional outbox and event delivery tests."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.module import Module
from app.core.tasks import JobContext, PermanentJobError, WorkerContext
from app.modules.events.models import OutboxEvent
from app.modules.events.public import DomainEvent, EventPublisher, event_from_job
from app.modules.events.service import relay_outbox
from app.modules.jobs.models import Job, JobStatus
from app.modules.jobs.service import JobRunner
from app.worker import collect_subscriptions
from tests.conftest import AuthenticatedUser, UserFactory

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]
SUBSCRIPTIONS = {"test.thing_happened": ["test.on_thing_a", "test.on_thing_b"]}


async def _job_count(db: AsyncSession, kind_prefix: str = "test.on_thing") -> int:
    return int(await db.scalar(select(func.count()).where(Job.kind.like(f"{kind_prefix}%"))) or 0)


async def test_event_is_only_stored_when_transaction_commits(db_session: AsyncSession) -> None:
    event_id = EventPublisher(db_session).publish("test.thing_happened", {"n": 1})
    await db_session.rollback()
    assert await db_session.get(OutboxEvent, event_id) is None

    event_id = EventPublisher(db_session).publish("test.thing_happened", {"n": 2})
    await db_session.commit()
    assert await db_session.get(OutboxEvent, event_id) is not None


async def test_relay_fans_out_once_per_subscriber(
    db_session: AsyncSession, worker_ctx: WorkerContext
) -> None:
    event_id = EventPublisher(db_session).publish("test.thing_happened", {"n": 1})
    EventPublisher(db_session).publish("test.nobody_listens", {})
    await db_session.commit()

    assert await relay_outbox(worker_ctx, SUBSCRIPTIONS) >= 2
    assert await _job_count(db_session) == 2
    assert await relay_outbox(worker_ctx, SUBSCRIPTIONS) == 0  # nothing left

    # Simulate a crash after enqueueing but before marking published: no duplicates.
    db_session.expunge_all()
    event = await db_session.get_one(OutboxEvent, event_id)
    assert event.published_at is not None
    event.published_at = None
    await db_session.commit()
    await relay_outbox(worker_ctx, SUBSCRIPTIONS)
    assert await _job_count(db_session) == 2


async def test_subscriber_receives_decoded_event(
    db_session: AsyncSession, worker_ctx: WorkerContext
) -> None:
    received: list[DomainEvent] = []

    async def handler(ctx: JobContext) -> None:
        received.append(event_from_job(ctx))

    workspace_id = None
    EventPublisher(db_session).publish(
        "test.thing_happened", {"amount": "12.50"}, workspace_id=workspace_id
    )
    await db_session.commit()
    await relay_outbox(worker_ctx, {"test.thing_happened": ["test.on_thing_a"]})
    runner = JobRunner(worker_ctx, {"test.on_thing_a": handler}, worker_id="w")
    assert await runner.run_once() == 1
    assert received[0].event_type == "test.thing_happened"
    assert received[0].payload == {"amount": "12.50"}

    jobs = list(await db_session.scalars(select(Job).where(Job.kind == "test.on_thing_a")))
    assert jobs[0].status == JobStatus.SUCCEEDED


def test_malformed_delivery_is_permanent_failure(worker_ctx: WorkerContext) -> None:
    ctx = JobContext(
        job_id=uuid.uuid4(),
        kind="x",
        payload={"event_type": "x"},
        attempt=1,
        max_attempts=1,
        workspace_id=None,
        worker=worker_ctx,
    )
    with pytest.raises(PermanentJobError):
        event_from_job(ctx)


def test_subscriptions_require_handlers() -> None:
    async def handler(ctx: JobContext) -> None:
        return None

    module = Module(name="m", title="M", description="", event_subscriptions={"e.t": ["m.handle"]})
    with pytest.raises(RuntimeError, match="no handler"):
        collect_subscriptions([module], {})
    assert collect_subscriptions([module], {"m.handle": handler}) == {"e.t": ["m.handle"]}


async def test_admin_can_list_events(
    client: httpx.AsyncClient,
    make_user: UserFactory,
    login_full: LoginFull,
    db_session: AsyncSession,
) -> None:
    EventPublisher(db_session).publish("test.listed", {"k": "v"})
    await db_session.commit()
    await login_full(await make_user(is_admin=True))
    resp = await client.get("/api/v1/events", params={"event_type": "test.listed"})
    assert resp.status_code == 200
    assert resp.json()[0]["payload"] == {"k": "v"}
