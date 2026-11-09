"""Per-workspace AI consent and the usage log (ADR-023)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiWorkspaceSettings(TimestampMixin, Base):
    __tablename__ = "ai_workspace_settings"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    # Feature keys an admin explicitly enabled (consent). Everything else is off.
    enabled_features: Mapped[list[str]] = mapped_column(JSONB, default=list)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class AiUsage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "ai_usage"
    __table_args__ = (
        CheckConstraint(
            "outcome IN ('ok', 'error', 'invalid_output', 'disabled', 'not_consented', "
            "'over_budget')",
            name="outcome_valid",
        ),
        Index("ix_ai_usage_workspace_created", "workspace_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    feature: Mapped[str] = mapped_column(String(60))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(100), default="")
    outcome: Mapped[str] = mapped_column(String(20))
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    duration_ms: Mapped[int] = mapped_column(default=0)
    error: Mapped[str] = mapped_column(String(300), default="")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    created_at: Mapped[datetime]
