"""Notification inbox endpoints (current user only)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.notifications.models import Severity
from app.modules.notifications.service import NotificationService

router = APIRouter(
    prefix="/api/v1/notifications", tags=["notifications"], responses=ERROR_RESPONSES
)


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    severity: Severity
    category: str
    title: str
    body: str
    link: str | None
    workspace_id: uuid.UUID | None
    read_at: datetime | None


class UnreadCountOut(BaseModel):
    unread: int


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    ctx: CurrentUser,
    db: DbSession,
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[NotificationOut]:
    items = await NotificationService(db).list_for_user(
        ctx.user.id, unread_only=unread_only, limit=limit
    )
    return [NotificationOut.model_validate(n) for n in items]


@router.get("/unread-count", response_model=UnreadCountOut)
async def unread_count(ctx: CurrentUser, db: DbSession) -> UnreadCountOut:
    return UnreadCountOut(unread=await NotificationService(db).unread_count(ctx.user.id))


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: uuid.UUID, ctx: CurrentUser, db: DbSession) -> NotificationOut:
    notification = await NotificationService(db).mark_read(ctx.user.id, notification_id)
    return NotificationOut.model_validate(notification)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(ctx: CurrentUser, db: DbSession) -> None:
    await NotificationService(db).mark_all_read(ctx.user.id)
