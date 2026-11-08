"""Transactional outbox for domain events."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UUIDPrimaryKeyMixin, utcnow


class OutboxEvent(UUIDPrimaryKeyMixin, Base):
    """A domain event written in the same transaction as the state change it describes."""

    __tablename__ = "outbox_events"
    __table_args__ = (
        Index(
            "ix_outbox_events_unpublished",
            "occurred_at",
            postgresql_where=text("published_at IS NULL"),
        ),
        Index("ix_outbox_events_type_occurred", "event_type", "occurred_at"),
    )

    event_type: Mapped[str] = mapped_column(String(100))
    occurred_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(default=None)
