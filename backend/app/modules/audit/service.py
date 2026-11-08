"""Audit recording and querying (framework independent)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import redact, request_id_var
from app.core.tasks import WorkerContext
from app.modules.audit.models import AuditRecord


class Outcome(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"
    DENIED = "denied"


class ActorType(StrEnum):
    USER = "user"
    SYSTEM = "system"
    DISCORD = "discord"


@dataclass(frozen=True, slots=True)
class AuditScope:
    """What a reader may see: their own actions plus the given workspaces (or all)."""

    user_id: uuid.UUID
    workspace_ids: Sequence[uuid.UUID]
    see_everything: bool = False


class AuditRecorder:
    """Adds audit records to the caller's session.

    The record is committed together with the caller's own changes, so the
    audit trail and the business state cannot diverge.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    def record(
        self,
        action: str,
        *,
        outcome: Outcome = Outcome.SUCCESS,
        actor_type: ActorType = ActorType.USER,
        actor_user_id: uuid.UUID | None = None,
        workspace_id: uuid.UUID | None = None,
        target_type: str | None = None,
        target_id: str | uuid.UUID | None = None,
        ip_address: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditRecord:
        record = AuditRecord(
            id=uuid.uuid4(),
            action=action,
            outcome=outcome.value,
            actor_type=actor_type.value,
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            ip_address=ip_address,
            request_id=request_id_var.get(),
            # Sensitive keys are redacted before they are ever persisted.
            details=redact(details or {}),
        )
        self._db.add(record)
        return record


class AuditQueryService:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def list(
        self,
        scope: AuditScope,
        *,
        limit: int = 50,
        before: datetime | None = None,
        action_prefix: str | None = None,
        workspace_id: uuid.UUID | None = None,
    ) -> list[AuditRecord]:
        stmt = select(AuditRecord)
        if not scope.see_everything:
            stmt = stmt.where(
                or_(
                    AuditRecord.actor_user_id == scope.user_id,
                    AuditRecord.workspace_id.in_(list(scope.workspace_ids)),
                )
            )
        if workspace_id is not None:
            stmt = stmt.where(AuditRecord.workspace_id == workspace_id)
        if before is not None:
            stmt = stmt.where(AuditRecord.occurred_at < before)
        if action_prefix:
            escaped = action_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            stmt = stmt.where(AuditRecord.action.like(f"{escaped}%", escape="\\"))
        stmt = stmt.order_by(AuditRecord.occurred_at.desc(), AuditRecord.id.desc()).limit(limit)
        return list(await self._db.scalars(stmt))


async def purge_expired_audit_records(worker: WorkerContext) -> None:
    """Retention policy: delete audit records older than ``audit_retention_days``."""
    cutoff = worker.clock() - timedelta(days=worker.settings.audit_retention_days)
    async with worker.session_factory() as db:
        await db.execute(delete(AuditRecord).where(AuditRecord.occurred_at < cutoff))
        await db.commit()
