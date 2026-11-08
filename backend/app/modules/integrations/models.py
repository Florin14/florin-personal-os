"""Integration connections (credentials stored encrypted)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ConnectionStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"
    ERROR = "error"  # e.g. credentials revoked: affected workflows stop safely


class IntegrationConnection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "integration_connections"
    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="uq_integration_connections_provider"),
        CheckConstraint("status IN ('active', 'disabled', 'error')", name="status_valid"),
        Index("ix_integration_connections_provider", "provider"),
    )

    # NULL for system-scoped integrations (e.g. the Discord bot).
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), default=None
    )
    provider: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default=ConnectionStatus.ACTIVE.value)
    # Non-secret settings, validated by the provider's config model.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Fernet ciphertext of the provider's secrets model (JSON). Never returned by the API.
    credentials_encrypted: Mapped[str | None] = mapped_column(Text, default=None)
    last_checked_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error: Mapped[str | None] = mapped_column(String(500), default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
