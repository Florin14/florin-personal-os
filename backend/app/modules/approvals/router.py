"""Approval inbox endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.approvals.models import ApprovalStatus, DecisionChannel, RiskLevel
from app.modules.approvals.service import RISK_POLICIES, ApprovalService, Decision
from app.modules.identity.public import CurrentUser, IdentityServiceDep

router = APIRouter(prefix="/api/v1/approvals", tags=["approvals"], responses=ERROR_RESPONSES)


class ApprovalOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    action_type: str
    title: str
    summary: str
    payload: dict[str, Any]
    payload_hash: str
    version_ref: str | None
    risk_level: RiskLevel
    status: ApprovalStatus
    subject_type: str
    subject_id: str
    created_at: datetime
    expires_at: datetime
    decided_at: datetime | None
    decided_by_user_id: uuid.UUID | None
    decided_via: str | None
    decision_note: str | None
    consumed_at: datetime | None
    requires_step_up: bool


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Decision
    note: str | None = Field(default=None, max_length=500)
    mfa_code: Annotated[str, StringConstraints(pattern=r"^\d{6}$")] | None = None


def _out(approval: Any) -> ApprovalOut:
    data = {
        name: getattr(approval, name)
        for name in ApprovalOut.model_fields
        if name != "requires_step_up"
    }
    data["requires_step_up"] = RISK_POLICIES[RiskLevel(approval.risk_level)].requires_step_up
    return ApprovalOut.model_validate(data)


@router.get("", response_model=list[ApprovalOut])
async def list_approvals(
    ctx: CurrentUser,
    db: DbSession,
    status: ApprovalStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ApprovalOut]:
    items = await ApprovalService(db).list_for_user(ctx.user.id, status=status, limit=limit)
    return [_out(a) for a in items]


@router.get("/{approval_id}", response_model=ApprovalOut)
async def get_approval(approval_id: uuid.UUID, ctx: CurrentUser, db: DbSession) -> ApprovalOut:
    return _out(await ApprovalService(db).get_for_user(ctx.user.id, approval_id))


@router.post("/{approval_id}/decision", response_model=ApprovalOut)
async def decide(
    approval_id: uuid.UUID,
    body: DecisionIn,
    ctx: CurrentUser,
    db: DbSession,
    identity: IdentityServiceDep,
) -> ApprovalOut:
    async def step_up(code: str) -> None:
        await identity.confirm_step_up(ctx, code)

    approval = await ApprovalService(db).decide(
        approval_id,
        actor_user_id=ctx.user.id,
        decision=body.decision,
        channel=DecisionChannel.IN_APP,
        note=body.note,
        mfa_code=body.mfa_code,
        step_up=step_up,
    )
    return _out(approval)
