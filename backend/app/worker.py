"""Background worker (composition root): job runner + periodic tasks.

Run with ``python -m app.worker``. A single worker is the default deployment;
several workers can run concurrently (jobs are claimed with SKIP LOCKED and
periodic tasks are serialized by PostgreSQL advisory locks).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import os
import signal
import socket
from collections.abc import Mapping, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import Settings, get_settings
from app.core.db import create_engine, create_session_factory, utcnow
from app.core.logging import configure_logging
from app.core.module import Module
from app.core.security.encryption import SecretBox
from app.core.tasks import JobHandler, PeriodicTask, WorkerContext
from app.modules.jobs.service import JobRunner
from app.modules.registry import MODULES

logger = logging.getLogger("app.worker")


def collect_handlers(modules: Sequence[Module]) -> dict[str, JobHandler]:
    handlers: dict[str, JobHandler] = {}
    for module in modules:
        for kind, handler in module.job_handlers.items():
            if kind in handlers:
                raise RuntimeError(f"Duplicate job handler for {kind!r}")
            handlers[kind] = handler
    return handlers


def collect_periodic_tasks(modules: Sequence[Module]) -> list[PeriodicTask]:
    return [task for module in modules for task in module.periodic_tasks]


def advisory_key(name: str) -> int:
    """Stable signed 64-bit key for pg advisory locks."""
    return int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big", signed=True)


async def run_periodic(
    task: PeriodicTask, ctx: WorkerContext, engine: AsyncEngine, stop: asyncio.Event
) -> None:
    while not stop.is_set():
        try:
            async with engine.connect() as conn:
                key = advisory_key(task.name)
                if await conn.scalar(select(func.pg_try_advisory_lock(key))):
                    try:
                        await task.run(ctx)
                    finally:
                        await conn.scalar(select(func.pg_advisory_unlock(key)))
        except Exception:
            logger.exception("periodic_task_failed", extra={"task": task.name})
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=task.interval_seconds)


async def run_jobs(runner: JobRunner, settings: Settings, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            processed = await runner.run_once(limit=settings.worker_batch_size)
        except Exception:
            logger.exception("job_loop_error")
            processed = 0
        if processed == 0:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_interval_seconds)


async def main(
    settings: Settings | None = None,
    modules: Sequence[Module] = MODULES,
    extra_handlers: Mapping[str, JobHandler] | None = None,
) -> None:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    engine = create_engine(settings)
    ctx = WorkerContext(
        session_factory=create_session_factory(engine),
        settings=settings,
        secret_box=SecretBox([k.get_secret_value() for k in settings.encryption_keys]),
        clock=utcnow,
    )
    handlers = collect_handlers(modules) | dict(extra_handlers or {})
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    runner = JobRunner(ctx, handlers, worker_id=worker_id)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # Windows
            loop.add_signal_handler(sig, stop.set)

    tasks = [asyncio.create_task(run_jobs(runner, settings, stop), name="jobs")]
    tasks += [
        asyncio.create_task(run_periodic(t, ctx, engine, stop), name=t.name)
        for t in collect_periodic_tasks(modules)
    ]
    logger.info("worker_started", extra={"worker_id": worker_id, "handlers": sorted(handlers)})
    try:
        await stop.wait()
    finally:
        logger.info("worker_stopping")
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
