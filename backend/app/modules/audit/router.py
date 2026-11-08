"""Audit log HTTP endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.audit.service import AuditQueryService, AuditScope
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, accessible_workspace_ids

router = APIRouter(prefix="/api/v1/audit", tags=["audit"], responses=ERROR_RESPONSES)


class AuditRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    occurred_at: datetime
    action: str
    outcome: str
    actor_type: str
    actor_user_id: uuid.UUID | None
    workspace_id: uuid.UUID | None
    target_type: str | None
    target_id: str | None
    ip_address: str | None
    request_id: str | None
    details: dict[str, Any]


@router.get("", response_model=list[AuditRecordOut])
async def list_audit_records(
    ctx: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: datetime | None = None,
    action_prefix: Annotated[str | None, Query(max_length=100)] = None,
    workspace_id: uuid.UUID | None = None,
) -> list[AuditRecordOut]:
    """Own actions, plus records of workspaces where the user is admin/owner.

    System administrators see every record.
    """
    scope = AuditScope(
        user_id=ctx.user.id,
        workspace_ids=await accessible_workspace_ids(db, ctx.user.id, Role.ADMIN),
        see_everything=ctx.user.is_admin,
    )
    records = await AuditQueryService(db).list(
        scope, limit=limit, before=before, action_prefix=action_prefix, workspace_id=workspace_id
    )
    return [AuditRecordOut.model_validate(r) for r in records]
