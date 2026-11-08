"""Approval requests bound to an exact action payload and version."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class DecisionChannel(StrEnum):
    IN_APP = "in_app"
    DISCORD = "discord"


class ApprovalRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "approval_requests"
    __table_args__ = (
        CheckConstraint("risk_level IN ('low', 'medium', 'high')", name="risk_valid"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')",
            name="status_valid",
        ),
        Index("ix_approval_requests_workspace_status", "workspace_id", "status"),
        Index("ix_approval_requests_status_expires", "status", "expires_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    # Stable key from the requester (e.g. "execution:<id>:<step>") for idempotent requests.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True, default=None)
    subject_type: Mapped[str] = mapped_column(String(50))
    subject_id: Mapped[str] = mapped_column(String(200))
    action_type: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    # Display copy of the action parameters (never secrets).
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # SHA-256 of the canonical JSON of the exact parameters that will execute.
    payload_hash: Mapped[str] = mapped_column(String(64))
    version_ref: Mapped[str | None] = mapped_column(String(100), default=None)
    risk_level: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default=ApprovalStatus.PENDING.value)
    expires_at: Mapped[datetime]
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    decided_at: Mapped[datetime | None] = mapped_column(default=None)
    decided_via: Mapped[str | None] = mapped_column(String(16), default=None)
    decision_note: Mapped[str | None] = mapped_column(String(500), default=None)
    consumed_at: Mapped[datetime | None] = mapped_column(default=None)
