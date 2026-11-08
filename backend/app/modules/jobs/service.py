"""Job queue, runner and administration (framework independent).

Guarantees: at-least-once execution. A job may run more than once when a
worker crashes after the side effect but before recording success, so every
handler must be idempotent (use ``idempotency_key`` and provider safeguards).
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, NotFound
from app.core.tasks import (
    JobContext,
    JobHandler,
    PermanentJobError,
    RetryableJobError,
    WorkerContext,
)
from app.modules.audit.public import AuditRecorder
from app.modules.jobs.models import FailureClass, Job, JobStatus

logger = logging.getLogger(__name__)

BACKOFF_BASE_SECONDS = 10.0
BACKOFF_MAX_SECONDS = 3600.0
LEASE_GRACE_SECONDS = 30
MAX_ERROR_LENGTH = 2000


def backoff_delay(attempt: int, rng: random.Random | None = None) -> float:
    """Exponential backoff with jitter: base * 2^(attempt-1), capped, then 50-100%."""
    raw: float = min(BACKOFF_BASE_SECONDS * 2.0 ** max(attempt - 1, 0), BACKOFF_MAX_SECONDS)
    jitter = rng.random() if rng is not None else random.random()  # noqa: S311 - jitter
    return raw * (0.5 + 0.5 * jitter)


def _safe_error(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:MAX_ERROR_LENGTH]


class JobQueue:
    """Enqueues jobs inside the caller's transaction (commit is the caller's job)."""

    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    async def enqueue(
        self,
        kind: str,
        payload: dict[str, Any] | None = None,
        *,
        idempotency_key: str | None = None,
        run_at: datetime | None = None,
        max_attempts: int = 5,
        priority: int = 100,
        timeout_seconds: int = 300,
        workspace_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        """Insert a job; with an existing ``idempotency_key`` the existing id is returned."""
        values = {
            "id": uuid.uuid4(),
            "kind": kind,
            "payload": payload or {},
            "status": JobStatus.QUEUED.value,
            "priority": priority,
            "attempts": 0,
            "max_attempts": max_attempts,
            "run_at": run_at or self._now(),
            "timeout_seconds": timeout_seconds,
            "idempotency_key": idempotency_key,
            "workspace_id": workspace_id,
        }
        stmt = insert(Job).values(**values)
        if idempotency_key is not None:
            stmt = stmt.on_conflict_do_nothing(index_elements=[Job.idempotency_key])
        job_id: uuid.UUID | None = await self._db.scalar(stmt.returning(Job.id))
        if job_id is None:
            existing = await self._db.scalar(
                select(Job.id).where(Job.idempotency_key == idempotency_key)
            )
            assert existing is not None
            return existing
        return job_id


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    id: uuid.UUID
    kind: str
    payload: dict[str, Any]
    attempt: int
    max_attempts: int
    timeout_seconds: int
    workspace_id: uuid.UUID | None
    lease_token: uuid.UUID


class JobRunner:
    """Claims and executes jobs. Several runners may share the queue safely."""

    def __init__(
        self,
        worker: WorkerContext,
        handlers: Mapping[str, JobHandler],
        *,
        worker_id: str,
        rng: random.Random | None = None,
    ) -> None:
        self._worker = worker
        self._handlers = handlers
        self._worker_id = worker_id
        self._rng = rng or random.Random()  # noqa: S311 - jitter only

    async def claim(self, limit: int = 1) -> list[ClaimedJob]:
        now = self._worker.clock()
        async with self._worker.session_factory() as db:
            await self._fail_exhausted_leases(db, now)
            candidates = (
                select(Job.id)
                .where(
                    or_(
                        (Job.status == JobStatus.QUEUED.value) & (Job.run_at <= now),
                        (Job.status == JobStatus.RUNNING.value)
                        & (Job.locked_until < now)
                        & (Job.attempts < Job.max_attempts),
                    )
                )
                .order_by(Job.priority, Job.run_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            ids = list(await db.scalars(candidates))
            claimed: list[ClaimedJob] = []
            for job_id in ids:
                token = uuid.uuid4()
                job = await db.get_one(Job, job_id)
                job.status = JobStatus.RUNNING.value
                job.attempts += 1
                job.locked_by = self._worker_id
                job.lease_token = token
                job.started_at = now
                job.locked_until = now + timedelta(
                    seconds=job.timeout_seconds + LEASE_GRACE_SECONDS
                )
                claimed.append(
                    ClaimedJob(
                        id=job.id,
                        kind=job.kind,
                        payload=dict(job.payload),
                        attempt=job.attempts,
                        max_attempts=job.max_attempts,
                        timeout_seconds=job.timeout_seconds,
                        workspace_id=job.workspace_id,
                        lease_token=token,
                    )
                )
            await db.commit()
            return claimed

    async def run_once(self, limit: int = 1) -> int:
        """Claim up to ``limit`` jobs and execute them. Returns the number processed."""
        jobs = await self.claim(limit)
        for job in jobs:
            await self._execute(job)
        return len(jobs)

    async def _execute(self, job: ClaimedJob) -> None:
        handler = self._handlers.get(job.kind)
        if handler is None:
            await self._finish_failed(
                job, f"No handler registered for job kind {job.kind!r}", FailureClass.UNKNOWN_KIND
            )
            return
        ctx = JobContext(
            job_id=job.id,
            kind=job.kind,
            payload=job.payload,
            attempt=job.attempt,
            max_attempts=job.max_attempts,
            workspace_id=job.workspace_id,
            worker=self._worker,
        )
        try:
            await asyncio.wait_for(handler(ctx), timeout=job.timeout_seconds)
        except TimeoutError as exc:
            await self._finish_retry_or_fail(job, exc, FailureClass.TIMEOUT)
        except PermanentJobError as exc:
            await self._finish_failed(job, _safe_error(exc), FailureClass.PERMANENT)
        except RetryableJobError as exc:
            await self._finish_retry_or_fail(
                job, exc, FailureClass.TRANSIENT, retry_after=exc.retry_after_seconds
            )
        except Exception as exc:
            logger.exception("job_failed", extra={"job_id": str(job.id), "kind": job.kind})
            await self._finish_retry_or_fail(job, exc, FailureClass.TRANSIENT)
        else:
            await self._update_if_owner(
                job,
                status=JobStatus.SUCCEEDED.value,
                finished_at=self._worker.clock(),
                locked_until=None,
                last_error=None,
                failure_class=None,
            )

    async def _finish_retry_or_fail(
        self,
        job: ClaimedJob,
        exc: BaseException,
        failure: FailureClass,
        retry_after: float | None = None,
    ) -> None:
        if job.attempt >= job.max_attempts:
            await self._finish_failed(job, _safe_error(exc), failure)
            return
        delay = retry_after if retry_after is not None else backoff_delay(job.attempt, self._rng)
        await self._update_if_owner(
            job,
            status=JobStatus.QUEUED.value,
            run_at=self._worker.clock() + timedelta(seconds=delay),
            locked_until=None,
            locked_by=None,
            last_error=_safe_error(exc),
            failure_class=failure.value,
        )

    async def _finish_failed(self, job: ClaimedJob, error: str, failure: FailureClass) -> None:
        logger.warning(
            "job_dead", extra={"job_id": str(job.id), "kind": job.kind, "failure": failure.value}
        )
        await self._update_if_owner(
            job,
            status=JobStatus.FAILED.value,
            finished_at=self._worker.clock(),
            locked_until=None,
            last_error=error[:MAX_ERROR_LENGTH],
            failure_class=failure.value,
        )

    async def _update_if_owner(self, job: ClaimedJob, **values: Any) -> None:
        """Fenced update: a worker whose lease was taken over cannot overwrite the job."""
        async with self._worker.session_factory() as db:
            result = await db.execute(
                update(Job)
                .where(Job.id == job.id, Job.lease_token == job.lease_token)
                .values(**values)
            )
            await db.commit()
            if result.rowcount == 0:  # type: ignore[attr-defined]
                logger.warning("job_lease_lost", extra={"job_id": str(job.id)})

    async def _fail_exhausted_leases(self, db: AsyncSession, now: datetime) -> None:
        """Running jobs whose lease expired with no attempts left are dead (crash loop)."""
        await db.execute(
            update(Job)
            .where(
                Job.status == JobStatus.RUNNING.value,
                Job.locked_until < now,
                Job.attempts >= Job.max_attempts,
            )
            .values(
                status=JobStatus.FAILED.value,
                finished_at=now,
                failure_class=FailureClass.LEASE_EXPIRED.value,
                last_error="Worker lease expired with no attempts left.",
            )
        )


class JobAdminService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    async def list(
        self, *, status: JobStatus | None = None, kind: str | None = None, limit: int = 50
    ) -> list[Job]:
        stmt = select(Job)
        if status is not None:
            stmt = stmt.where(Job.status == status.value)
        if kind:
            stmt = stmt.where(Job.kind == kind)
        stmt = stmt.order_by(Job.updated_at.desc()).limit(limit)
        return list(await self._db.scalars(stmt))

    async def get(self, job_id: uuid.UUID) -> Job:
        job = await self._db.get(Job, job_id)
        if job is None:
            raise NotFound("Job not found.")
        return job

    async def stats(self) -> dict[str, int]:
        rows = await self._db.execute(select(Job.status, func.count()).group_by(Job.status))
        counts = {s.value: 0 for s in JobStatus}
        counts.update({str(status): int(count) for status, count in rows.all()})
        return counts

    async def retry(self, job_id: uuid.UUID, actor_user_id: uuid.UUID) -> Job:
        job = await self.get(job_id)
        if job.status not in (JobStatus.FAILED.value, JobStatus.CANCELLED.value):
            raise Conflict("Only failed or cancelled jobs can be retried.", code="not_retryable")
        job.status = JobStatus.QUEUED.value
        job.attempts = 0
        job.run_at = self._now()
        job.finished_at = None
        job.lease_token = None
        self._audit("jobs.retried", job, actor_user_id)
        await self._db.commit()
        return job

    async def cancel(self, job_id: uuid.UUID, actor_user_id: uuid.UUID) -> Job:
        job = await self.get(job_id)
        if job.status != JobStatus.QUEUED.value:
            raise Conflict("Only queued jobs can be cancelled.", code="not_cancellable")
        job.status = JobStatus.CANCELLED.value
        job.finished_at = self._now()
        self._audit("jobs.cancelled", job, actor_user_id)
        await self._db.commit()
        return job

    def _audit(self, action: str, job: Job, actor_user_id: uuid.UUID) -> None:
        AuditRecorder(self._db).record(
            action,
            actor_user_id=actor_user_id,
            workspace_id=job.workspace_id,
            target_type="job",
            target_id=job.id,
            details={"kind": job.kind},
        )


async def purge_finished_jobs(worker: WorkerContext) -> None:
    """Retention: remove succeeded/cancelled jobs older than the configured window."""
    cutoff = worker.clock() - timedelta(days=worker.settings.job_retention_days)
    async with worker.session_factory() as db:
        await db.execute(
            delete(Job).where(
                Job.status.in_([JobStatus.SUCCEEDED.value, JobStatus.CANCELLED.value]),
                Job.finished_at < cutoff,
            )
        )
        await db.commit()
