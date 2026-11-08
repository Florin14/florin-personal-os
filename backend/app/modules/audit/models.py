"""Append-only audit records."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UUIDPrimaryKeyMixin, utcnow


class AuditRecord(UUIDPrimaryKeyMixin, Base):
    """One security- or business-relevant event.

    Actor and workspace ids are stored without foreign keys on purpose: audit
    history must survive deletion of the referenced rows. Rows cannot be
    updated (enforced by a database trigger); retention deletes old rows.
    """

    __tablename__ = "audit_records"
    __table_args__ = (
        Index("ix_audit_records_occurred_at", "occurred_at"),
        Index("ix_audit_records_workspace_occurred", "workspace_id", "occurred_at"),
        Index("ix_audit_records_actor_occurred", "actor_user_id", "occurred_at"),
    )

    occurred_at: Mapped[datetime] = mapped_column(server_default=func.now(), default=utcnow)
    action: Mapped[str] = mapped_column(String(100))
    outcome: Mapped[str] = mapped_column(String(16))
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    target_type: Mapped[str | None] = mapped_column(String(50), default=None)
    target_id: Mapped[str | None] = mapped_column(String(100), default=None)
    ip_address: Mapped[str | None] = mapped_column(String(45), default=None)
    request_id: Mapped[str | None] = mapped_column(String(64), default=None)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
