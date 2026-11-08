"""Notification creation, delivery and inbox (framework independent)."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import Protocol

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import NotFound, ValidationFailed
from app.core.tasks import JobContext, JobHandler, PermanentJobError
from app.modules.integrations.public import is_connected
from app.modules.jobs.public import JobQueue
from app.modules.notifications.models import Channel, DeliveryStatus, Notification, Severity
from app.modules.workspaces.public import Role, workspace_member_ids

DELIVER_JOB = "notifications.deliver"
_SAFE_LINK = re.compile(r"^/[A-Za-z0-9/_\-?=&.%]*$")
MAX_TITLE = 200
MAX_BODY = 2000


class ChannelAdapter(Protocol):
    """Delivers a notification to an external channel (e.g. Discord). Must be idempotent."""

    async def send(self, notification: Notification) -> None: ...


def validate_link(link: str | None) -> str | None:
    """Only same-origin relative paths are allowed (no open redirects / phishing links)."""
    if link is None:
        return None
    if not _SAFE_LINK.match(link) or link.startswith("//"):
        raise ValidationFailed("Notification links must be relative in-app paths.")
    return link


class NotificationService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    async def notify(
        self,
        recipient_user_id: uuid.UUID,
        title: str,
        body: str = "",
        *,
        severity: Severity = Severity.INFO,
        category: str = "general",
        channels: Sequence[Channel] = (Channel.IN_APP,),
        workspace_id: uuid.UUID | None = None,
        link: str | None = None,
        dedupe_key: str | None = None,
    ) -> list[uuid.UUID]:
        """Create notifications in the caller's transaction. Duplicate dedupe keys are skipped.

        In-app notifications are delivered immediately; other channels are delivered
        by a background job.
        """
        link = validate_link(link)
        created: list[uuid.UUID] = []
        for channel in channels:
            key = f"{dedupe_key}:{channel.value}:{recipient_user_id}" if dedupe_key else None
            in_app = channel is Channel.IN_APP
            stmt = (
                insert(Notification)
                .values(
                    id=uuid.uuid4(),
                    recipient_user_id=recipient_user_id,
                    workspace_id=workspace_id,
                    channel=channel.value,
                    severity=severity.value,
                    category=category[:50],
                    title=title[:MAX_TITLE],
                    body=body[:MAX_BODY],
                    link=link,
                    dedupe_key=key,
                    status=(DeliveryStatus.DELIVERED if in_app else DeliveryStatus.PENDING).value,
                    delivered_at=self._now() if in_app else None,
                )
                .on_conflict_do_nothing(index_elements=[Notification.dedupe_key])
                .returning(Notification.id)
            )
            notification_id: uuid.UUID | None = await self._db.scalar(stmt)
            if notification_id is None:
                continue  # duplicate
            created.append(notification_id)
            if not in_app:
                await JobQueue(self._db, self._now).enqueue(
                    DELIVER_JOB,
                    {"notification_id": str(notification_id)},
                    idempotency_key=f"notification:{notification_id}",
                    workspace_id=workspace_id,
                    max_attempts=8,
                )
        return created

    async def notify_workspace(
        self,
        workspace_id: uuid.UUID,
        title: str,
        body: str = "",
        *,
        minimum_role: Role = Role.MEMBER,
        severity: Severity = Severity.INFO,
        category: str = "general",
        channels: Sequence[Channel] = (Channel.IN_APP,),
        link: str | None = None,
        dedupe_key: str | None = None,
        external: bool = False,
    ) -> list[uuid.UUID]:
        """Notify every member of a workspace with at least ``minimum_role``.

        ``external=True`` additionally posts once to the shared chat channel
        (Discord) when that integration is connected.
        """
        created: list[uuid.UUID] = []
        members = await workspace_member_ids(self._db, workspace_id, minimum_role)
        if external and members and await is_connected(self._db, "discord", None):
            created += await self.notify(
                members[0],
                title,
                body,
                severity=severity,
                category=category,
                channels=(Channel.DISCORD,),
                workspace_id=workspace_id,
                link=link,
                dedupe_key=f"{dedupe_key}:external" if dedupe_key else None,
            )
        for user_id in members:
            created += await self.notify(
                user_id,
                title,
                body,
                severity=severity,
                category=category,
                channels=channels,
                workspace_id=workspace_id,
                link=link,
                dedupe_key=dedupe_key,
            )
        return created

    # ------------------------------------------------------------------ inbox

    async def list_for_user(
        self, user_id: uuid.UUID, *, unread_only: bool = False, limit: int = 50
    ) -> list[Notification]:
        stmt = select(Notification).where(
            Notification.recipient_user_id == user_id,
            Notification.channel == Channel.IN_APP.value,
        )
        if unread_only:
            stmt = stmt.where(Notification.read_at.is_(None))
        stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
        return list(await self._db.scalars(stmt))

    async def unread_count(self, user_id: uuid.UUID) -> int:
        count = await self._db.scalar(
            select(func.count()).where(
                Notification.recipient_user_id == user_id,
                Notification.channel == Channel.IN_APP.value,
                Notification.read_at.is_(None),
            )
        )
        return int(count or 0)

    async def mark_read(self, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
        notification = await self._db.scalar(
            select(Notification).where(
                Notification.id == notification_id, Notification.recipient_user_id == user_id
            )
        )
        if notification is None:
            raise NotFound("Notification not found.")
        if notification.read_at is None:
            notification.read_at = self._now()
            await self._db.commit()
        return notification

    async def mark_all_read(self, user_id: uuid.UUID) -> None:
        await self._db.execute(
            update(Notification)
            .where(Notification.recipient_user_id == user_id, Notification.read_at.is_(None))
            .values(read_at=self._now())
        )
        await self._db.commit()


def make_delivery_handler(adapters: Mapping[str, ChannelAdapter]) -> JobHandler:
    """Job handler delivering a pending notification through its channel adapter."""

    async def deliver(ctx: JobContext) -> None:
        try:
            notification_id = uuid.UUID(str(ctx.payload["notification_id"]))
        except (KeyError, ValueError) as exc:
            raise PermanentJobError("Malformed notification delivery payload") from exc
        async with ctx.worker.session_factory() as db:
            notification = await db.get(Notification, notification_id)
            if notification is None:
                raise PermanentJobError("Notification no longer exists")
            if notification.status == DeliveryStatus.DELIVERED.value:
                return  # already delivered (at-least-once redelivery)
            adapter = adapters.get(notification.channel)
            if adapter is None:
                notification.status = DeliveryStatus.FAILED.value
                notification.error = f"Channel {notification.channel!r} is not configured"
                await db.commit()
                raise PermanentJobError(notification.error)
            try:
                await adapter.send(notification)
            except Exception as exc:
                if ctx.is_last_attempt:
                    notification.status = DeliveryStatus.FAILED.value
                    notification.error = f"{type(exc).__name__}: {exc}"[:500]
                    await db.commit()
                raise
            notification.status = DeliveryStatus.DELIVERED.value
            notification.delivered_at = ctx.worker.clock()
            notification.error = None
            await db.commit()

    return deliver
