"""Freelance opportunity endpoints (workspace scoped)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession, SettingsDep
from app.core.errors import Conflict
from app.core.http import ERROR_RESPONSES
from app.modules.ai.public import AiFailed, AiUnavailable
from app.modules.identity.public import CurrentUser
from app.modules.opportunities.models import (
    ListingStatus,
    Opportunity,
    OpportunityProfile,
    OpportunitySource,
)
from app.modules.opportunities.service import OpportunityService, OpportunitySummary
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/opportunities",
    tags=["opportunities"],
    responses=ERROR_RESPONSES,
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]
# Feeds make the server fetch external URLs: admins only.
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]

Term = Annotated[str, Field(min_length=1, max_length=60)]
StatusName = Literal["new", "saved", "applied", "dismissed"]


def _terms(values: list[str]) -> list[str]:
    """Whitespace-normalized, de-duplicated keywords (order kept)."""
    seen: dict[str, None] = {}
    for value in values:
        cleaned = " ".join(value.split())
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


Terms = Annotated[list[Term], AfterValidator(_terms)]


class SkillWeightIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: Term
    weight: int = Field(default=3, ge=1, le=5)


class OpportunityProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skills: list[SkillWeightIn] = Field(default_factory=list, max_length=60)
    include_keywords: Terms = Field(default_factory=list, max_length=60)
    exclude_keywords: Terms = Field(default_factory=list, max_length=60)
    min_hourly_rate: Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=2)] | None = None
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    remote_only: bool = True
    notify_threshold: int = Field(default=60, ge=0, le=100)


class OpportunityProfileOut(BaseModel):
    skills: list[SkillWeightIn]
    include_keywords: list[str]
    exclude_keywords: list[str]
    min_hourly_rate: Decimal | None
    currency: str
    remote_only: bool
    notify_threshold: int
    configured: bool


class FeedSourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=8, max_length=500)
    enabled: bool = True
    poll_interval_minutes: int = Field(default=60, ge=30, le=24 * 60)


class OpportunitySourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: Literal["manual", "feed"]
    url: str | None
    enabled: bool
    poll_interval_minutes: int
    last_polled_at: datetime | None
    last_status: str | None
    last_error: str


class FeedPollOut(BaseModel):
    status: str | None
    new: int
    error: str


class ManualOpportunityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=1000, pattern=r"^https?://")
    company: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=20_000)
    budget_text: str = Field(default="", max_length=200)


class OpportunityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    title: str
    url: str | None
    company: str
    description: str
    budget_text: str
    posted_at: datetime | None
    score: int
    reasons: list[str]
    excluded: bool
    status: StatusName
    ai_summary: OpportunitySummary | None
    ai_summarized_at: datetime | None
    created_at: datetime


class OpportunityStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusName


def _profile(p: OpportunityProfile | None) -> OpportunityProfileOut:
    if p is None:
        return OpportunityProfileOut(
            skills=[],
            include_keywords=[],
            exclude_keywords=[],
            min_hourly_rate=None,
            currency="EUR",
            remote_only=True,
            notify_threshold=60,
            configured=False,
        )
    return OpportunityProfileOut(
        skills=[SkillWeightIn.model_validate(s) for s in p.skills],
        include_keywords=p.include_keywords,
        exclude_keywords=p.exclude_keywords,
        min_hourly_rate=p.min_hourly_rate,
        currency=p.currency,
        remote_only=p.remote_only,
        notify_threshold=p.notify_threshold,
        configured=True,
    )


def _listing(o: Opportunity) -> OpportunityOut:
    return OpportunityOut.model_validate(o)


def _source(s: OpportunitySource) -> OpportunitySourceOut:
    return OpportunitySourceOut.model_validate(s)


# ------------------------------------------------------------------- profile


@router.get("/profile", response_model=OpportunityProfileOut)
async def get_profile(access: Viewer, db: DbSession) -> OpportunityProfileOut:
    return _profile(await OpportunityService(db).profile(access.workspace_id))


@router.put("/profile", response_model=OpportunityProfileOut)
async def save_profile(
    body: OpportunityProfileIn, access: Member, ctx: CurrentUser, db: DbSession
) -> OpportunityProfileOut:
    """Saving re-scores every stored listing with the new profile."""
    data: dict[str, Any] = body.model_dump()
    data["skills"] = [s.model_dump() for s in body.skills]
    return _profile(
        await OpportunityService(db).save_profile(access.workspace_id, data, ctx.user.id)
    )


# ------------------------------------------------------------------- sources


@router.get("/sources", response_model=list[OpportunitySourceOut])
async def list_sources(access: Viewer, db: DbSession) -> list[OpportunitySourceOut]:
    return [_source(s) for s in await OpportunityService(db).list_sources(access.workspace_id)]


@router.post("/sources", response_model=OpportunitySourceOut, status_code=status.HTTP_201_CREATED)
async def add_feed(
    body: FeedSourceIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> OpportunitySourceOut:
    return _source(
        await OpportunityService(db).save_feed(access.workspace_id, body.model_dump(), ctx.user.id)
    )


@router.put("/sources/{source_id}", response_model=OpportunitySourceOut)
async def update_feed(
    source_id: uuid.UUID, body: FeedSourceIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> OpportunitySourceOut:
    service = OpportunityService(db)
    source = await service.get_source(access.workspace_id, source_id)
    return _source(
        await service.save_feed(access.workspace_id, body.model_dump(), ctx.user.id, source)
    )


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: uuid.UUID, access: Admin, ctx: CurrentUser, db: DbSession
) -> None:
    """Deletes the source and the listings it brought in."""
    service = OpportunityService(db)
    await service.delete_source(
        await service.get_source(access.workspace_id, source_id), ctx.user.id
    )


@router.post("/sources/{source_id}/poll", response_model=FeedPollOut)
async def poll_now(source_id: uuid.UUID, access: Member, db: DbSession) -> FeedPollOut:
    service = OpportunityService(db)
    source = await service.get_source(access.workspace_id, source_id)
    return FeedPollOut(**await service.poll(source))


# ------------------------------------------------------------------ listings


@router.get("/listings", response_model=list[OpportunityOut])
async def list_listings(
    access: Viewer,
    db: DbSession,
    status_filter: Annotated[StatusName | None, Query(alias="status")] = None,
    min_score: Annotated[int, Query(ge=0, le=100)] = 0,
    q: Annotated[str | None, Query(max_length=100)] = None,
    include_excluded: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[OpportunityOut]:
    listings = await OpportunityService(db).list_listings(
        access.workspace_id,
        status=status_filter,
        min_score=min_score,
        query=q,
        include_excluded=include_excluded,
        limit=limit,
    )
    return [_listing(o) for o in listings]


@router.post("/listings", response_model=OpportunityOut, status_code=status.HTTP_201_CREATED)
async def add_listing(
    body: ManualOpportunityIn, access: Member, ctx: CurrentUser, db: DbSession
) -> OpportunityOut:
    return _listing(
        await OpportunityService(db).add_manual(access.workspace_id, body.model_dump(), ctx.user.id)
    )


@router.put("/listings/{listing_id}/status", response_model=OpportunityOut)
async def set_listing_status(
    listing_id: uuid.UUID,
    body: OpportunityStatusIn,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
) -> OpportunityOut:
    service = OpportunityService(db)
    listing = await service.get_listing(access.workspace_id, listing_id)
    return _listing(await service.set_status(listing, ListingStatus(body.status), ctx.user.id))


@router.post("/listings/{listing_id}/summary", response_model=OpportunityOut)
async def summarize_listing(
    listing_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession, settings: SettingsDep
) -> OpportunityOut:
    """Optional AI summary (ADR-023). 409 when AI is unavailable, 502-style message on failure."""
    service = OpportunityService(db)
    listing = await service.get_listing(access.workspace_id, listing_id)
    try:
        return _listing(await service.summarize(listing, settings, ctx.user.id))
    except AiUnavailable as exc:
        raise Conflict(str(exc)) from exc
    except AiFailed as exc:
        raise Conflict(f"AI summary failed: {exc}") from exc
