"""Recent domain events (system administrators only)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.events.service import EventQueryService
from app.modules.identity.public import AdminUser

router = APIRouter(prefix="/api/v1/events", tags=["events"], responses=ERROR_RESPONSES)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: str
    occurred_at: datetime
    published_at: datetime | None
    workspace_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    payload: dict[str, Any]


@router.get("", response_model=list[EventOut])
async def list_events(
    _: AdminUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    event_type: Annotated[str | None, Query(max_length=100)] = None,
) -> list[EventOut]:
    events = await EventQueryService(db).recent(limit=limit, event_type=event_type)
    return [EventOut.model_validate(e) for e in events]
