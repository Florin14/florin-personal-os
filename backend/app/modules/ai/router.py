"""AI status, per-workspace feature consent and usage (ADR-023)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession, SettingsDep
from app.core.http import ERROR_RESPONSES
from app.modules.ai.service import FEATURES, AiService
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/ai", tags=["ai"], responses=ERROR_RESPONSES
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]


class AiFeatureOut(BaseModel):
    key: str
    title: str
    description: str
    data_sent: str
    enabled: bool


class AiStatusOut(BaseModel):
    provider: Literal["disabled", "ollama"]
    model: str
    available: bool
    budget_limit: int
    budget_used: int
    features: list[AiFeatureOut]


class AiFeaturesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled_features: list[str] = Field(max_length=50)


class AiUsageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    feature: str
    provider: str
    model: str
    outcome: str
    input_tokens: int
    output_tokens: int
    duration_ms: int
    error: str
    created_at: datetime


async def _status(
    service: AiService, settings: SettingsDep, workspace_id: uuid.UUID
) -> AiStatusOut:
    enabled = set(await service.enabled_features(workspace_id))
    return AiStatusOut(
        provider=settings.ai_provider,
        model=settings.ollama_model if settings.ai_provider == "ollama" else "",
        available=service.available,
        budget_limit=settings.ai_monthly_request_budget,
        budget_used=await service.used_this_month(workspace_id),
        features=[
            AiFeatureOut(
                key=f.key,
                title=f.title,
                description=f.description,
                data_sent=f.data_sent,
                enabled=f.key in enabled,
            )
            for f in FEATURES.values()
        ],
    )


@router.get("", response_model=AiStatusOut)
async def ai_status(access: Viewer, db: DbSession, settings: SettingsDep) -> AiStatusOut:
    return await _status(AiService(db, settings), settings, access.workspace_id)


@router.put("/features", response_model=AiStatusOut)
async def set_ai_features(
    body: AiFeaturesIn, access: Admin, ctx: CurrentUser, db: DbSession, settings: SettingsDep
) -> AiStatusOut:
    """Consent: only the listed features may send data to the configured AI provider."""
    service = AiService(db, settings)
    await service.set_features(access.workspace_id, body.enabled_features, ctx.user.id)
    return await _status(service, settings, access.workspace_id)


@router.get("/usage", response_model=list[AiUsageOut])
async def ai_usage(access: Viewer, db: DbSession, settings: SettingsDep) -> list[AiUsageOut]:
    rows = await AiService(db, settings).recent_usage(access.workspace_id)
    return [AiUsageOut.model_validate(r) for r in rows]
