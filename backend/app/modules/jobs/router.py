"""Job inspection and recovery endpoints (system administrators only)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import AdminUser
from app.modules.jobs.models import JobStatus
from app.modules.jobs.service import JobAdminService

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"], responses=ERROR_RESPONSES)


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: JobStatus
    priority: int
    attempts: int
    max_attempts: int
    run_at: datetime
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    locked_by: str | None
    workspace_id: uuid.UUID | None
    last_error: str | None
    failure_class: str | None
    payload: dict[str, Any]


class JobStatsOut(BaseModel):
    queued: int
    running: int
    succeeded: int
    failed: int
    cancelled: int


@router.get("", response_model=list[JobOut])
async def list_jobs(
    _: AdminUser,
    db: DbSession,
    status: JobStatus | None = None,
    kind: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[JobOut]:
    jobs = await JobAdminService(db).list(status=status, kind=kind, limit=limit)
    return [JobOut.model_validate(j) for j in jobs]


@router.get("/stats", response_model=JobStatsOut)
async def job_stats(_: AdminUser, db: DbSession) -> JobStatsOut:
    return JobStatsOut(**await JobAdminService(db).stats())


@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: uuid.UUID, _: AdminUser, db: DbSession) -> JobOut:
    return JobOut.model_validate(await JobAdminService(db).get(job_id))


@router.post("/{job_id}/retry", response_model=JobOut)
async def retry_job(job_id: uuid.UUID, ctx: AdminUser, db: DbSession) -> JobOut:
    job = await JobAdminService(db).retry(job_id, ctx.user.id)
    return JobOut.model_validate(job)


@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_job(job_id: uuid.UUID, ctx: AdminUser, db: DbSession) -> JobOut:
    job = await JobAdminService(db).cancel(job_id, ctx.user.id)
    return JobOut.model_validate(job)
