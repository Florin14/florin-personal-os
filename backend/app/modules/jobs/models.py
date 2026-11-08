"""Durable job queue table."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FailureClass(StrEnum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    TIMEOUT = "timeout"
    LEASE_EXPIRED = "lease_expired"
    UNKNOWN_KIND = "unknown_kind"


class Job(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A unit of background work. Payloads must never contain secrets."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="status_valid",
        ),
        CheckConstraint("attempts >= 0 AND max_attempts >= 1", name="attempts_valid"),
        Index(
            "ix_jobs_claimable",
            "priority",
            "run_at",
            postgresql_where=text("status = 'queued'"),
        ),
        Index("ix_jobs_running_lease", "locked_until", postgresql_where=text("status = 'running'")),
        Index("ix_jobs_status_updated", "status", "updated_at"),
    )

    kind: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default=JobStatus.QUEUED.value)
    # Lower runs first.
    priority: Mapped[int] = mapped_column(default=100)
    attempts: Mapped[int] = mapped_column(default=0)
    max_attempts: Mapped[int] = mapped_column(default=5)
    run_at: Mapped[datetime]
    timeout_seconds: Mapped[int] = mapped_column(default=300)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True, default=None)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), default=None
    )
    locked_by: Mapped[str | None] = mapped_column(String(100), default=None)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(default=None)
    locked_until: Mapped[datetime | None] = mapped_column(default=None)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error: Mapped[str | None] = mapped_column(Text, default=None)
    failure_class: Mapped[str | None] = mapped_column(String(32), default=None)
