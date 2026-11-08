"""Calendar & tasks: Google Calendar access, free slots, tasks and scheduling."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.core.errors import NotFound, ValidationFailed
from app.core.integrations import ProviderError, ProviderErrorKind
from app.core.security.encryption import SecretBox
from app.modules.audit.public import AuditRecorder
from app.modules.google.public import CalendarEvent, google_api


class TaskStatus(StrEnum):
    OPEN = "open"
    DONE = "done"


class Task(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'done')", name="status_valid"),
        CheckConstraint("duration_minutes BETWEEN 5 AND 1440", name="duration_valid"),
        Index("ix_tasks_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[date | None] = mapped_column(default=None)
    duration_minutes: Mapped[int] = mapped_column(default=60)
    status: Mapped[str] = mapped_column(String(10), default=TaskStatus.OPEN.value)
    scheduled_start: Mapped[datetime | None] = mapped_column(default=None)
    calendar_event_id: Mapped[str | None] = mapped_column(String(1024), default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


def deterministic_event_id(idempotency_key: str) -> str:
    """Google accepts client ids in base32hex (0-9a-v); hex digests qualify.

    Re-inserting the same id fails with 409, so retries cannot duplicate events.
    """
    return hashlib.sha256(idempotency_key.encode()).hexdigest()[:40]


def event_body(
    *,
    summary: str,
    start: datetime,
    duration_minutes: int,
    timezone: str,
    description: str = "",
    reminder_minutes: int | None = None,
    event_id: str | None = None,
) -> dict[str, Any]:
    end = start + timedelta(minutes=duration_minutes)
    body: dict[str, Any] = {
        "summary": summary[:200],
        "description": description[:4000],
        "start": {"dateTime": start.isoformat(), "timeZone": timezone},
        "end": {"dateTime": end.isoformat(), "timeZone": timezone},
    }
    if reminder_minutes is not None:
        body["reminders"] = {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": reminder_minutes}],
        }
    if event_id:
        body["id"] = event_id
    return body


def first_free_slot(
    busy: list[tuple[datetime, datetime]],
    day: date,
    duration: timedelta,
    timezone: str,
    work_start: time = time(9),
    work_end: time = time(18),
    not_before: datetime | None = None,
) -> datetime | None:
    tz = ZoneInfo(timezone)
    cursor = datetime.combine(day, work_start, tz)
    end_of_day = datetime.combine(day, work_end, tz)
    if not_before and not_before > cursor:
        minutes = (not_before.minute // 15 + 1) * 15  # round up to a quarter hour
        cursor = not_before.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=minutes)
    for start, end in sorted(busy):
        if start >= end_of_day:
            break
        if end <= cursor:
            continue
        if start - cursor >= duration:
            return cursor
        cursor = max(cursor, end)
    return cursor if end_of_day - cursor >= duration else None


class CalendarService:
    def __init__(
        self, session: AsyncSession, box: SecretBox, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self._db = session
        self._box = box
        self._now = clock

    async def upcoming(self, workspace_id: uuid.UUID, days: int) -> list[CalendarEvent]:
        config, api = await google_api(self._db, self._box, workspace_id, "calendar", self._now)
        now = self._now()
        return await api.list_events(config.calendar_id, now, now + timedelta(days=days))

    async def create_event(
        self,
        workspace_id: uuid.UUID,
        *,
        summary: str,
        start: datetime,
        duration_minutes: int,
        timezone: str,
        description: str = "",
        reminder_minutes: int | None = None,
        idempotency_key: str | None = None,
    ) -> CalendarEvent:
        config, api = await google_api(self._db, self._box, workspace_id, "calendar", self._now)
        body = event_body(
            summary=summary,
            start=start.astimezone(ZoneInfo(timezone)),
            duration_minutes=duration_minutes,
            timezone=timezone,
            description=description,
            reminder_minutes=reminder_minutes,
            event_id=deterministic_event_id(idempotency_key) if idempotency_key else None,
        )
        try:
            return await api.create_event(config.calendar_id, body)
        except ProviderError as exc:
            if (
                idempotency_key
                and exc.kind is ProviderErrorKind.INVALID_REQUEST
                and "409" in exc.message
            ):
                # Already created by a previous attempt with the same key.
                return CalendarEvent(
                    id=body["id"],
                    summary=summary,
                    start=body["start"]["dateTime"],
                    end=body["end"]["dateTime"],
                    all_day=False,
                    html_link=None,
                    location=None,
                )
            raise

    async def free_slot(
        self,
        workspace_id: uuid.UUID,
        day: date,
        duration_minutes: int,
        timezone: str,
        work_start: time = time(9),
        work_end: time = time(18),
    ) -> datetime | None:
        config, api = await google_api(self._db, self._box, workspace_id, "calendar", self._now)
        tz = ZoneInfo(timezone)
        busy = await api.free_busy(
            [config.calendar_id],
            datetime.combine(day, work_start, tz),
            datetime.combine(day, work_end, tz),
        )
        return first_free_slot(
            busy,
            day,
            timedelta(minutes=duration_minutes),
            timezone,
            work_start,
            work_end,
            not_before=self._now().astimezone(tz),
        )

    # ------------------------------------------------------------------ tasks

    async def list_tasks(self, workspace_id: uuid.UUID, include_done: bool) -> list[Task]:
        stmt = select(Task).where(Task.workspace_id == workspace_id)
        if not include_done:
            stmt = stmt.where(Task.status == TaskStatus.OPEN.value)
        stmt = stmt.order_by(Task.due_date.asc().nulls_last(), Task.created_at)
        return list(await self._db.scalars(stmt))

    async def get_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        task = await self._db.scalar(
            select(Task).where(Task.id == task_id, Task.workspace_id == workspace_id)
        )
        if task is None:
            raise NotFound("Task not found.")
        return task

    async def save_task(
        self,
        workspace_id: uuid.UUID,
        data: dict[str, Any],
        actor_user_id: uuid.UUID,
        task: Task | None = None,
    ) -> Task:
        if task is None:
            task = Task(
                id=uuid.uuid4(), workspace_id=workspace_id, created_by_user_id=actor_user_id
            )
            self._db.add(task)
        for key in ("title", "notes", "due_date", "duration_minutes", "status"):
            if key in data and data[key] is not None:
                setattr(task, key, data[key])
        await self._db.commit()
        return task

    async def delete_task(self, task: Task) -> None:
        await self._db.delete(task)
        await self._db.commit()

    async def schedule_task(
        self,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
        timezone: str,
        actor_user_id: uuid.UUID | None,
        idempotency_key: str,
        search_days: int = 7,
    ) -> Task:
        """Book the task into the first free working-hours slot of the next days."""
        task = await self.get_task(workspace_id, task_id)
        if task.calendar_event_id:
            return task
        today = self._now().astimezone(ZoneInfo(timezone)).date()
        for offset in range(search_days):
            day = today + timedelta(days=offset)
            if day.weekday() >= 5:
                continue
            slot = await self.free_slot(workspace_id, day, task.duration_minutes, timezone)
            if slot is None:
                continue
            event = await self.create_event(
                workspace_id,
                summary=task.title,
                start=slot,
                duration_minutes=task.duration_minutes,
                timezone=timezone,
                description=task.notes,
                reminder_minutes=10,
                idempotency_key=idempotency_key,
            )
            task.scheduled_start = slot
            task.calendar_event_id = event.id
            AuditRecorder(self._db).record(
                "calendar.task_scheduled",
                actor_user_id=actor_user_id,
                workspace_id=workspace_id,
                target_type="task",
                target_id=task.id,
            )
            await self._db.commit()
            return task
        raise ValidationFailed("No free slot found in the next working days.", code="no_free_slot")
