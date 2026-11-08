"""Notification records (one row per recipient and channel)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Channel(StrEnum):
    IN_APP = "in_app"
    DISCORD = "discord"


class Severity(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("channel IN ('in_app', 'discord')", name="channel_valid"),
        CheckConstraint(
            "severity IN ('info', 'success', 'warning', 'error')", name="severity_valid"
        ),
        CheckConstraint("status IN ('pending', 'delivered', 'failed')", name="status_valid"),
        Index("ix_notifications_recipient_created", "recipient_user_id", "created_at"),
        Index(
            "ix_notifications_unread",
            "recipient_user_id",
            postgresql_where=text("read_at IS NULL AND channel = 'in_app'"),
        ),
    )

    recipient_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), default=None
    )
    channel: Mapped[str] = mapped_column(String(16))
    severity: Mapped[str] = mapped_column(String(16), default=Severity.INFO.value)
    category: Mapped[str] = mapped_column(String(50), default="general")
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    # Relative in-app path only (validated); never an external URL.
    link: Mapped[str | None] = mapped_column(String(300), default=None)
    dedupe_key: Mapped[str | None] = mapped_column(String(200), unique=True, default=None)
    status: Mapped[str] = mapped_column(String(16), default=DeliveryStatus.PENDING.value)
    delivered_at: Mapped[datetime | None] = mapped_column(default=None)
    read_at: Mapped[datetime | None] = mapped_column(default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
