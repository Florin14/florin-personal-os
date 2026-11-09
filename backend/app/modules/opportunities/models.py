"""Matching profile, sources and opportunity listings (ADR-024)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ListingStatus(StrEnum):
    NEW = "new"
    SAVED = "saved"
    APPLIED = "applied"
    DISMISSED = "dismissed"


class SourceKind(StrEnum):
    MANUAL = "manual"
    FEED = "feed"


class OpportunityProfile(TimestampMixin, Base):
    __tablename__ = "opportunity_profiles"
    __table_args__ = (
        CheckConstraint("notify_threshold BETWEEN 0 AND 100", name="threshold_range"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    # [{"term": "react", "weight": 3}, ...] — weight 1..5
    skills: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    include_keywords: Mapped[list[str]] = mapped_column(JSONB, default=list)
    exclude_keywords: Mapped[list[str]] = mapped_column(JSONB, default=list)
    min_hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), default=None)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    remote_only: Mapped[bool] = mapped_column(default=True)
    notify_threshold: Mapped[int] = mapped_column(default=60)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class OpportunitySource(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "opportunity_sources"
    __table_args__ = (
        UniqueConstraint("workspace_id", "url", name="uq_opportunity_sources_url"),
        CheckConstraint("kind IN ('manual', 'feed')", name="kind_valid"),
        CheckConstraint("poll_interval_minutes >= 30", name="poll_interval_min"),
        Index("ix_opportunity_sources_due", "kind", "enabled", "last_polled_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(10))
    url: Mapped[str | None] = mapped_column(String(500), default=None)
    enabled: Mapped[bool] = mapped_column(default=True)
    poll_interval_minutes: Mapped[int] = mapped_column(default=60)
    last_polled_at: Mapped[datetime | None] = mapped_column(default=None)
    last_status: Mapped[str | None] = mapped_column(String(20), default=None)
    last_error: Mapped[str] = mapped_column(String(300), default="")
    etag: Mapped[str | None] = mapped_column(String(200), default=None)
    last_modified: Mapped[str | None] = mapped_column(String(100), default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class Opportunity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "opportunity_listings"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_opportunity_listings_external"),
        CheckConstraint("status IN ('new', 'saved', 'applied', 'dismissed')", name="status_valid"),
        CheckConstraint("score BETWEEN 0 AND 100", name="score_range"),
        Index("ix_opportunity_listings_workspace_score", "workspace_id", "status", "score"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("opportunity_sources.id", ondelete="CASCADE")
    )
    external_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str | None] = mapped_column(String(1000), default=None)
    company: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    budget_text: Mapped[str] = mapped_column(String(200), default="")
    posted_at: Mapped[datetime | None] = mapped_column(default=None)
    score: Mapped[int] = mapped_column(default=0)
    reasons: Mapped[list[str]] = mapped_column(JSONB, default=list)
    excluded: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(12), default=ListingStatus.NEW.value)
    # AI output is untrusted data, rendered as plain text only (ADR-023).
    ai_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    ai_summarized_at: Mapped[datetime | None] = mapped_column(default=None)
