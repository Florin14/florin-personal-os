"""Contracts for background work, shared by modules and the worker.

Modules declare job handlers and periodic tasks on their ``Module``
descriptor; the worker process (``app.worker``) runs them. Handlers must be
idempotent: delivery is at-least-once.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.actions import ActionRegistry
from app.core.config import Settings
from app.core.security.encryption import SecretBox


class PermanentJobError(Exception):
    """The job can never succeed (bad input, missing resource). Not retried."""


class RetryableJobError(Exception):
    """A transient failure. Retried with backoff unless attempts are exhausted."""

    def __init__(self, message: str, *, retry_after_seconds: float | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True, slots=True)
class WorkerContext:
    """Long-lived dependencies available to background code."""

    session_factory: async_sessionmaker[AsyncSession]
    settings: Settings
    secret_box: SecretBox
    clock: Callable[[], datetime]
    actions: ActionRegistry = field(default_factory=ActionRegistry)


@dataclass(frozen=True, slots=True)
class JobContext:
    job_id: uuid.UUID
    kind: str
    payload: dict[str, Any]
    attempt: int
    max_attempts: int
    workspace_id: uuid.UUID | None
    worker: WorkerContext

    @property
    def is_last_attempt(self) -> bool:
        return self.attempt >= self.max_attempts


JobHandler = Callable[[JobContext], Awaitable[None]]
PeriodicFunction = Callable[[WorkerContext], Awaitable[object]]


@dataclass(frozen=True, slots=True)
class PeriodicTask:
    """Runs every ``interval_seconds`` in the worker (one instance cluster-wide)."""

    name: str
    interval_seconds: float
    run: PeriodicFunction = field(repr=False)
