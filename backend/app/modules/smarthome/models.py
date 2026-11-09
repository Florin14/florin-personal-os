"""Discovered entities, local control policy and durable command intents."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class HomeDevice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "smarthome_devices"
    __table_args__ = (
        UniqueConstraint("workspace_id", "entity_id", name="uq_smarthome_devices_entity"),
        CheckConstraint("min_interval_seconds BETWEEN 10 AND 3600", name="interval_range"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    entity_id: Mapped[str] = mapped_column(String(255))
    domain: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(255))
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # A different host/mode must never inherit permissions from the old home.
    connection_key: Mapped[str] = mapped_column(String(64))
    available: Mapped[bool] = mapped_column(default=True)
    controllable: Mapped[bool] = mapped_column(default=False)
    min_interval_seconds: Mapped[int] = mapped_column(default=60)
    override_until: Mapped[datetime | None] = mapped_column(default=None)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_command_at: Mapped[datetime | None] = mapped_column(default=None)


class HomeCommand(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "smarthome_commands"
    __table_args__ = (
        UniqueConstraint("workspace_id", "idempotency_key", name="uq_smarthome_commands_key"),
        CheckConstraint("source IN ('manual', 'automation')", name="source_valid"),
        CheckConstraint(
            "status IN ('pending', 'succeeded', 'refused', 'failed', 'unknown')",
            name="status_valid",
        ),
        Index("ix_smarthome_commands_device_created", "device_id", "created_at"),
        Index("ix_smarthome_commands_workspace_created", "workspace_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("smarthome_devices.id", ondelete="CASCADE")
    )
    entity_id: Mapped[str] = mapped_column(String(255))
    service: Mapped[str] = mapped_column(String(60))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    source: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(12))
    message: Mapped[str] = mapped_column(String(300), default="")
    idempotency_key: Mapped[str] = mapped_column(String(200))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
