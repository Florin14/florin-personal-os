"""Job queue and runner tests: retries, leases, fencing, admin API."""

from __future__ import annotations

import asyncio
import random
import uuid
from collections.abc import Awaitable, Callable

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.tasks import JobContext, PermanentJobError, RetryableJobError, WorkerContext
from app.modules.audit.models import AuditRecord
from app.modules.jobs.models import FailureClass, Job, JobStatus
from app.modules.jobs.service import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    JobQueue,
    JobRunner,
    backoff_delay,
)
from app.worker import advisory_key, collect_handlers
from tests.conftest import AuthenticatedUser, Clock, UserFactory

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


class Recorder:
    def __init__(self) -> None:
        self.calls: list[JobContext] = []

    async def ok(self, ctx: JobContext) -> None:
        self.calls.append(ctx)

    async def flaky(self, ctx: JobContext) -> None:
        self.calls.append(ctx)
        if ctx.attempt < 2:
            raise ConnectionError("provider unavailable")

    async def always_fails(self, ctx: JobContext) -> None:
        self.calls.append(ctx)
        raise RetryableJobError("still down")

    async def permanent(self, ctx: JobContext) -> None:
        self.calls.append(ctx)
        raise PermanentJobError("invalid input")

    async def slow(self, ctx: JobContext) -> None:
        self.calls.append(ctx)
        await asyncio.sleep(5)


@pytest.fixture
def recorder() -> Recorder:
    return Recorder()


@pytest.fixture
def runner(worker_ctx: WorkerContext, recorder: Recorder) -> JobRunner:
    handlers = {
        "test.ok": recorder.ok,
        "test.flaky": recorder.flaky,
        "test.always_fails": recorder.always_fails,
        "test.permanent": recorder.permanent,
        "test.slow": recorder.slow,
    }
    return JobRunner(worker_ctx, handlers, worker_id="test-worker", rng=random.Random(1))


async def _enqueue(db: AsyncSession, clock: Clock, kind: str, **kwargs: object) -> uuid.UUID:
    job_id = await JobQueue(db, clock).enqueue(kind, {"x": 1}, **kwargs)  # type: ignore[arg-type]
    await db.commit()
    return job_id


async def _job(db: AsyncSession, job_id: uuid.UUID) -> Job:
    db.expunge_all()
    job = await db.get(Job, job_id)
    assert job is not None
    return job


def test_backoff_grows_and_is_capped() -> None:
    rng = random.Random(0)
    for attempt in range(1, 20):
        delay = backoff_delay(attempt, rng)
        expected = min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1), BACKOFF_MAX_SECONDS)
        assert expected * 0.5 <= delay <= expected


async def test_enqueue_is_idempotent(db_session: AsyncSession, clock: Clock) -> None:
    first = await _enqueue(db_session, clock, "test.ok", idempotency_key="k-1")
    second = await _enqueue(db_session, clock, "test.ok", idempotency_key="k-1")
    assert first == second
    count = await db_session.scalars(select(Job.id).where(Job.idempotency_key == "k-1"))
    assert len(list(count)) == 1


async def test_successful_job(
    db_session: AsyncSession, clock: Clock, runner: JobRunner, recorder: Recorder
) -> None:
    job_id = await _enqueue(db_session, clock, "test.ok")
    assert await runner.run_once() == 1
    assert recorder.calls[0].payload == {"x": 1}
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.SUCCEEDED
    assert job.attempts == 1
    assert job.finished_at is not None


async def test_future_jobs_are_not_claimed(
    db_session: AsyncSession, clock: Clock, runner: JobRunner
) -> None:
    from datetime import timedelta

    await _enqueue(db_session, clock, "test.ok", run_at=clock.now + timedelta(minutes=5))
    assert await runner.run_once() == 0
    clock.advance(minutes=6)
    assert await runner.run_once() == 1


async def test_priority_order(
    db_session: AsyncSession, clock: Clock, runner: JobRunner, recorder: Recorder
) -> None:
    low = await _enqueue(db_session, clock, "test.ok", priority=200)
    high = await _enqueue(db_session, clock, "test.ok", priority=10)
    await runner.run_once(limit=1)
    assert recorder.calls[0].job_id == high
    await runner.run_once(limit=1)
    assert recorder.calls[1].job_id == low


async def test_transient_failure_is_retried_with_backoff(
    db_session: AsyncSession, clock: Clock, runner: JobRunner
) -> None:
    job_id = await _enqueue(db_session, clock, "test.flaky")
    await runner.run_once()
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.QUEUED
    assert job.attempts == 1
    assert job.failure_class == "transient"
    assert "provider unavailable" in (job.last_error or "")
    assert job.run_at > clock.now

    assert await runner.run_once() == 0  # backoff not elapsed yet
    clock.advance(seconds=BACKOFF_BASE_SECONDS + 1)
    assert await runner.run_once() == 1
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.SUCCEEDED
    assert job.attempts == 2


async def test_exhausted_attempts_fail_and_stay_inspectable(
    db_session: AsyncSession, clock: Clock, runner: JobRunner, recorder: Recorder
) -> None:
    job_id = await _enqueue(db_session, clock, "test.always_fails", max_attempts=3)
    for _ in range(3):
        await runner.run_once()
        clock.advance(hours=2)
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.FAILED
    assert job.attempts == 3
    assert job.failure_class == "transient"
    assert len(recorder.calls) == 3
    assert await runner.run_once() == 0


async def test_permanent_error_is_not_retried(
    db_session: AsyncSession, clock: Clock, runner: JobRunner
) -> None:
    job_id = await _enqueue(db_session, clock, "test.permanent")
    await runner.run_once()
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.FAILED
    assert job.failure_class == "permanent"
    assert job.attempts == 1


async def test_timeout_is_classified(
    db_session: AsyncSession, clock: Clock, runner: JobRunner
) -> None:
    job_id = await _enqueue(db_session, clock, "test.slow", timeout_seconds=1)
    await runner.run_once()
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.QUEUED
    assert job.failure_class == "timeout"


async def test_unknown_kind_fails_permanently(
    db_session: AsyncSession, clock: Clock, runner: JobRunner
) -> None:
    job_id = await _enqueue(db_session, clock, "test.nobody_handles_this")
    await runner.run_once()
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.FAILED
    assert job.failure_class == "unknown_kind"


async def test_crashed_worker_lease_is_recovered_and_stale_worker_is_fenced(
    db_session: AsyncSession,
    clock: Clock,
    worker_ctx: WorkerContext,
    recorder: Recorder,
) -> None:
    """A restarted worker re-runs an abandoned job; the old worker cannot clobber it."""
    job_id = await _enqueue(db_session, clock, "test.ok", timeout_seconds=60)
    crashed = JobRunner(worker_ctx, {"test.ok": recorder.ok}, worker_id="crashed")
    (abandoned,) = await crashed.claim()  # claimed, then the process "dies"

    fresh = JobRunner(worker_ctx, {"test.ok": recorder.ok}, worker_id="fresh")
    assert await fresh.run_once() == 0  # lease still valid
    clock.advance(seconds=60 + 31)
    assert await fresh.run_once() == 1
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.SUCCEEDED
    assert job.attempts == 2

    # The stale worker comes back and tries to record a failure: ignored.
    await crashed._finish_failed(
        abandoned,
        "late",
        failure=FailureClass.TRANSIENT,
    )
    assert (await _job(db_session, job_id)).status == JobStatus.SUCCEEDED


async def test_crash_loop_ends_in_failed_state(
    db_session: AsyncSession, clock: Clock, worker_ctx: WorkerContext, recorder: Recorder
) -> None:
    job_id = await _enqueue(db_session, clock, "test.ok", timeout_seconds=10, max_attempts=2)
    runner = JobRunner(worker_ctx, {"test.ok": recorder.ok}, worker_id="w")
    for _ in range(2):
        await runner.claim()  # crash after every claim
        clock.advance(seconds=60)
    await runner.claim()
    job = await _job(db_session, job_id)
    assert job.status == JobStatus.FAILED
    assert job.failure_class == "lease_expired"


async def test_concurrent_workers_never_claim_the_same_job(
    engine: AsyncEngine, worker_ctx: WorkerContext
) -> None:
    """Real concurrent transactions (committed), cleaned up afterwards."""
    kind = f"test.concurrency.{uuid.uuid4().hex}"
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        queue = JobQueue(db, worker_ctx.clock)
        for i in range(20):
            await queue.enqueue(kind, {"i": i})
        await db.commit()
    ctx = WorkerContext(
        session_factory=factory,
        settings=worker_ctx.settings,
        secret_box=worker_ctx.secret_box,
        clock=worker_ctx.clock,
    )
    try:
        runners = [JobRunner(ctx, {}, worker_id=f"w{i}") for i in range(4)]
        batches = await asyncio.gather(*(r.claim(limit=10) for r in runners))
        claimed = [job.id for batch in batches for job in batch]
        assert len(claimed) == len(set(claimed))
    finally:
        async with factory() as db:
            await db.execute(delete(Job).where(Job.kind == kind))
            await db.commit()


def test_duplicate_handlers_are_rejected() -> None:
    from app.core.module import Module

    async def handler(ctx: JobContext) -> None:
        return None

    mods = [
        Module(name="a", title="A", description="", job_handlers={"x.y": handler}),
        Module(name="b", title="B", description="", job_handlers={"x.y": handler}),
    ]
    with pytest.raises(RuntimeError, match="Duplicate"):
        collect_handlers(mods)


def test_advisory_key_is_stable() -> None:
    assert advisory_key("jobs.purge") == advisory_key("jobs.purge")
    assert advisory_key("a") != advisory_key("b")


class TestJobsApi:
    async def test_requires_admin(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        await login_full(await make_user())
        resp = await client.get("/api/v1/jobs")
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "admin_required"

    async def test_admin_can_inspect_retry_and_cancel(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        login_full: LoginFull,
        db_session: AsyncSession,
        clock: Clock,
        runner: JobRunner,
        settings: object,
    ) -> None:
        failed_id = await _enqueue(db_session, clock, "test.permanent")
        await runner.run_once()
        queued_id = await _enqueue(
            db_session, clock, "test.ok", run_at=clock.now.replace(year=2099)
        )

        admin = await make_user(is_admin=True)
        await login_full(admin)
        from tests.conftest import csrf_headers

        stats = (await client.get("/api/v1/jobs/stats")).json()
        assert stats["failed"] >= 1
        listed = (await client.get("/api/v1/jobs", params={"status": "failed"})).json()
        assert str(failed_id) in {j["id"] for j in listed}
        detail = (await client.get(f"/api/v1/jobs/{failed_id}")).json()
        assert detail["failure_class"] == "permanent"

        headers = csrf_headers(client, settings)  # type: ignore[arg-type]
        retried = await client.post(f"/api/v1/jobs/{failed_id}/retry", headers=headers)
        assert retried.status_code == 200
        assert retried.json()["status"] == "queued"
        assert retried.json()["attempts"] == 0
        again = await client.post(f"/api/v1/jobs/{failed_id}/retry", headers=headers)
        assert again.status_code == 409

        cancelled = await client.post(f"/api/v1/jobs/{queued_id}/cancel", headers=headers)
        assert cancelled.json()["status"] == "cancelled"

        actions = set(
            await db_session.scalars(
                select(AuditRecord.action).where(AuditRecord.actor_user_id == admin.id)
            )
        )
        assert {"jobs.retried", "jobs.cancelled"} <= actions
