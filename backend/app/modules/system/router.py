"""Health, readiness and system information endpoints."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app.core.db import utcnow
from app.core.dependencies import DbSession, SettingsDep
from app.core.http import ERROR_RESPONSES
from app.core.module import Module
from app.modules.identity.public import CurrentUser

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"], responses=ERROR_RESPONSES)


class LivenessResponse(BaseModel):
    status: Literal["ok"]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]


class ModuleInfo(BaseModel):
    name: str
    title: str
    description: str


class SystemInfoResponse(BaseModel):
    name: str
    version: str
    environment: str
    server_time: datetime
    mfa_required: bool
    modules: list[ModuleInfo]


@router.get("/healthz", response_model=LivenessResponse, include_in_schema=False)
async def liveness() -> LivenessResponse:
    """Process is up. Does not touch dependencies (used by container health checks)."""
    return LivenessResponse(status="ok")


@router.get("/api/v1/system/health", response_model=HealthResponse)
async def health(db: DbSession, response: Response) -> HealthResponse:
    """Readiness: the API can serve requests (database reachable)."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("readiness_database_unavailable")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="degraded", database="unavailable")
    return HealthResponse(status="ok", database="ok")


@router.get("/api/v1/system/info", response_model=SystemInfoResponse)
async def system_info(
    request: Request, _: CurrentUser, settings: SettingsDep
) -> SystemInfoResponse:
    modules: tuple[Module, ...] = request.app.state.modules
    return SystemInfoResponse(
        name=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env.value,
        server_time=utcnow(),
        mfa_required=settings.auth_require_mfa,
        modules=[
            ModuleInfo(name=m.name, title=m.title, description=m.description) for m in modules
        ],
    )
