"""Automation persistence: definitions, immutable versions, schedules, executions."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ExecutionStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_DELAY = "waiting_delay"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"

    @property
    def is_terminal(self) -> bool:
        return self in TERMINAL_STATUSES


TERMINAL_STATUSES = frozenset(
    {
        ExecutionStatus.SUCCEEDED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
        ExecutionStatus.REJECTED,
        ExecutionStatus.EXPIRED,
    }
)


class StepStatus(StrEnum):
    RUNNING = "running"
    WAITING = "waiting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class Automation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "automations"
    __table_args__ = (Index("ix_automations_workspace", "workspace_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(default=True)
    current_version: Mapped[int] = mapped_column(default=1)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class AutomationVersion(UUIDPrimaryKeyMixin, Base):
    """Immutable snapshot of a workflow definition."""

    __tablename__ = "automation_versions"
    __table_args__ = (
        UniqueConstraint("automation_id", "version", name="uq_automation_versions_version"),
    )

    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE")
    )
    version: Mapped[int]
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB)
    definition_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime]
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class AutomationTrigger(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Index of the current version's triggers: schedule state and event matching."""

    __tablename__ = "automation_triggers"
    __table_args__ = (
        UniqueConstraint("automation_id", "trigger_key", name="uq_automation_triggers_key"),
        Index(
            "ix_automation_triggers_due",
            "next_fire_at",
            postgresql_where=text("enabled AND next_fire_at IS NOT NULL"),
        ),
        Index("ix_automation_triggers_event", "event_type", postgresql_where=text("enabled")),
    )

    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    trigger_key: Mapped[str] = mapped_column(String(50))
    trigger_type: Mapped[str] = mapped_column(String(16))
    event_type: Mapped[str | None] = mapped_column(String(100), default=None)
    enabled: Mapped[bool] = mapped_column(default=True)
    next_fire_at: Mapped[datetime | None] = mapped_column(default=None)
    last_fired_at: Mapped[datetime | None] = mapped_column(default=None)


class WorkflowExecution(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workflow_executions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'waiting_approval', 'waiting_delay', "
            "'succeeded', 'failed', 'cancelled', 'rejected', 'expired')",
            name="status_valid",
        ),
        Index("ix_workflow_executions_workspace_created", "workspace_id", "created_at"),
        Index("ix_workflow_executions_automation_created", "automation_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE")
    )
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_versions.id"))
    version: Mapped[int]
    trigger_key: Mapped[str] = mapped_column(String(50))
    trigger_type: Mapped[str] = mapped_column(String(16))
    trigger_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default=ExecutionStatus.PENDING.value)
    dry_run: Mapped[bool] = mapped_column(default=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True, default=None)
    current_step_key: Mapped[str | None] = mapped_column(String(50), default=None)
    # Outputs of completed steps, keyed by step key (never secrets).
    context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    steps_executed: Mapped[int] = mapped_column(default=0)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    triggered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class StepExecution(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "step_executions"
    __table_args__ = (
        UniqueConstraint("execution_id", "step_key", name="uq_step_executions_step"),
        CheckConstraint(
            "status IN ('running', 'waiting', 'succeeded', 'failed', 'skipped')",
            name="status_valid",
        ),
    )

    execution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_executions.id", ondelete="CASCADE")
    )
    step_key: Mapped[str] = mapped_column(String(50))
    step_type: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    attempts: Mapped[int] = mapped_column(default=0)
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    approval_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    resume_at: Mapped[datetime | None] = mapped_column(default=None)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)


class AutomationControl(Base):
    """Single-row runtime controls. ``emergency_stop`` blocks all side-effecting actions."""

    __tablename__ = "automation_controls"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    emergency_stop: Mapped[bool] = mapped_column(default=False)
    changed_at: Mapped[datetime | None] = mapped_column(default=None)
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    reason: Mapped[str | None] = mapped_column(String(500), default=None)
