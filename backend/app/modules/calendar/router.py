"""Calendar & tasks endpoints and workflow actions."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.actions import (
    ActionContext,
    ActionDefinition,
    ActionError,
    ActionRisk,
    RetryableActionError,
)
from app.core.dependencies import DbSession, SecretBoxDep
from app.core.errors import DomainError, ValidationFailed
from app.core.http import ERROR_RESPONSES
from app.core.integrations import ProviderError
from app.modules.calendar.service import CalendarService, Task, TaskStatus
from app.modules.google.public import google_connected
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}", tags=["calendar"], responses=ERROR_RESPONSES
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]


class EventOut(BaseModel):
    id: str
    summary: str
    start: str
    end: str
    all_day: bool
    html_link: str | None
    location: str | None


class CalendarOut(BaseModel):
    connected: bool
    error: str | None
    events: list[EventOut]


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=200)
    start: datetime
    duration_minutes: int = Field(default=60, ge=5, le=1440)
    timezone: str = "Europe/Bucharest"
    description: str = Field(default="", max_length=4000)
    reminder_minutes: int | None = Field(default=None, ge=0, le=40320)


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=4000)
    due_date: date | None = None
    duration_minutes: int = Field(default=60, ge=5, le=1440)
    status: TaskStatus = TaskStatus.OPEN


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    notes: str
    due_date: date | None
    duration_minutes: int
    status: TaskStatus
    scheduled_start: datetime | None
    calendar_event_id: str | None


class ScheduleIn(BaseModel):
    timezone: str = "Europe/Bucharest"


def _provider_error(exc: ProviderError) -> ValidationFailed:
    return ValidationFailed(f"Google Calendar: {exc.message}", code="calendar_unavailable")


@router.get("/calendar/events", response_model=CalendarOut)
async def upcoming(
    access: Viewer,
    db: DbSession,
    box: SecretBoxDep,
    days: Annotated[int, Query(ge=1, le=60)] = 14,
) -> CalendarOut:
    if not await google_connected(db, access.workspace_id):
        return CalendarOut(connected=False, error=None, events=[])
    try:
        events = await CalendarService(db, box).upcoming(access.workspace_id, days)
    except ProviderError as exc:
        return CalendarOut(connected=True, error=exc.message, events=[])
    return CalendarOut(connected=True, error=None, events=[EventOut(**e.__dict__) for e in events])


@router.post("/calendar/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(body: EventIn, access: Member, db: DbSession, box: SecretBoxDep) -> EventOut:
    try:
        event = await CalendarService(db, box).create_event(
            access.workspace_id, **body.model_dump()
        )
    except ProviderError as exc:
        raise _provider_error(exc) from exc
    return EventOut(**event.__dict__)


@router.get("/tasks", response_model=list[TaskOut])
async def list_tasks(
    access: Viewer, db: DbSession, box: SecretBoxDep, include_done: bool = False
) -> list[TaskOut]:
    tasks = await CalendarService(db, box).list_tasks(access.workspace_id, include_done)
    return [TaskOut.model_validate(t) for t in tasks]


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskIn, access: Member, ctx: CurrentUser, db: DbSession, box: SecretBoxDep
) -> TaskOut:
    task = await CalendarService(db, box).save_task(
        access.workspace_id, body.model_dump(), ctx.user.id
    )
    return TaskOut.model_validate(task)


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskIn,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
) -> TaskOut:
    service = CalendarService(db, box)
    task = await service.save_task(
        access.workspace_id,
        body.model_dump(),
        ctx.user.id,
        await service.get_task(access.workspace_id, task_id),
    )
    return TaskOut.model_validate(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: uuid.UUID, access: Member, db: DbSession, box: SecretBoxDep) -> None:
    service = CalendarService(db, box)
    await service.delete_task(await service.get_task(access.workspace_id, task_id))


@router.post("/tasks/{task_id}/schedule", response_model=TaskOut)
async def schedule_task(
    task_id: uuid.UUID,
    body: ScheduleIn,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
) -> TaskOut:
    try:
        task: Task = await CalendarService(db, box).schedule_task(
            access.workspace_id, task_id, body.timezone, ctx.user.id, f"task:{task_id}"
        )
    except ProviderError as exc:
        raise _provider_error(exc) from exc
    return TaskOut.model_validate(task)


# ------------------------------------------------------------------ actions


class CreateEventParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=200)
    start: datetime
    duration_minutes: int = Field(default=30, ge=5, le=1440)
    timezone: str = "Europe/Bucharest"
    description: str = Field(default="", max_length=4000)
    reminder_minutes: int | None = Field(default=None, ge=0, le=40320)


class ScheduleTaskParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    timezone: str = "Europe/Bucharest"


def _translate(exc: Exception) -> Exception:
    if isinstance(exc, ProviderError):
        return RetryableActionError(exc.message) if exc.retryable else ActionError(exc.message)
    if isinstance(exc, DomainError):
        return ActionError(exc.message)
    return exc


async def _create_event(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, CreateEventParams)
    async with ctx.worker.session_factory() as db:
        try:
            event = await CalendarService(db, ctx.worker.secret_box, ctx.worker.clock).create_event(
                ctx.workspace_id, **params.model_dump(), idempotency_key=ctx.idempotency_key
            )
        except (ProviderError, DomainError) as exc:
            raise _translate(exc) from exc
    return {"event_id": event.id, "start": event.start, "link": event.html_link}


async def _schedule_task(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, ScheduleTaskParams)
    async with ctx.worker.session_factory() as db:
        try:
            task = await CalendarService(db, ctx.worker.secret_box, ctx.worker.clock).schedule_task(
                ctx.workspace_id, params.task_id, params.timezone, None, ctx.idempotency_key
            )
        except (ProviderError, DomainError) as exc:
            raise _translate(exc) from exc
    return {
        "task_id": str(task.id),
        "scheduled_start": task.scheduled_start.isoformat() if task.scheduled_start else None,
        "event_id": task.calendar_event_id,
    }


CALENDAR_ACTIONS = (
    ActionDefinition(
        name="calendar.create_event",
        title="Create calendar event / reminder",
        description="Creates a Google Calendar event (retries never duplicate it).",
        params_model=CreateEventParams,
        handler=_create_event,
        risk=ActionRisk.LOW,
    ),
    ActionDefinition(
        name="calendar.schedule_task",
        title="Schedule task in a free slot",
        description="Books a task into the first free working-hours slot.",
        params_model=ScheduleTaskParams,
        handler=_schedule_task,
        risk=ActionRisk.LOW,
    ),
)
