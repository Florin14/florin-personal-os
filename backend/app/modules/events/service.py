"""Domain event publishing (outbox) and relay to subscriber jobs."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.tasks import JobContext, PermanentJobError, WorkerContext
from app.modules.events.models import OutboxEvent
from app.modules.jobs.public import JobQueue

logger = logging.getLogger(__name__)

RELAY_BATCH_SIZE = 100


@dataclass(frozen=True, slots=True)
class DomainEvent:
    id: uuid.UUID
    event_type: str
    occurred_at: datetime
    workspace_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    payload: dict[str, Any]


class EventPublisher:
    """Writes events to the outbox in the caller's transaction (caller commits)."""

    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    def publish(
        self,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        workspace_id: uuid.UUID | None = None,
        actor_user_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        event = OutboxEvent(
            id=uuid.uuid4(),
            event_type=event_type,
            occurred_at=self._now(),
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            payload=payload or {},
        )
        self._db.add(event)
        return event.id


def delivery_payload(event: OutboxEvent) -> dict[str, Any]:
    return {
        "event_id": str(event.id),
        "event_type": event.event_type,
        "occurred_at": event.occurred_at.isoformat(),
        "workspace_id": str(event.workspace_id) if event.workspace_id else None,
        "actor_user_id": str(event.actor_user_id) if event.actor_user_id else None,
        "payload": event.payload,
    }


def event_from_job(ctx: JobContext) -> DomainEvent:
    """Decode the event delivered to a subscriber job."""
    data = ctx.payload
    try:
        return DomainEvent(
            id=uuid.UUID(data["event_id"]),
            event_type=data["event_type"],
            occurred_at=datetime.fromisoformat(data["occurred_at"]),
            workspace_id=uuid.UUID(data["workspace_id"]) if data.get("workspace_id") else None,
            actor_user_id=uuid.UUID(data["actor_user_id"]) if data.get("actor_user_id") else None,
            payload=dict(data.get("payload") or {}),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise PermanentJobError("Malformed event delivery payload") from exc


async def relay_outbox(worker: WorkerContext, subscriptions: Mapping[str, Sequence[str]]) -> int:
    """Turn unpublished events into one idempotent job per subscriber.

    Event publication and job creation happen in a single transaction, so a
    crash cannot lose an event; a re-run cannot duplicate deliveries because
    of the per-(event, subscriber) idempotency key.
    """
    now = worker.clock()
    async with worker.session_factory() as db:
        events = list(
            await db.scalars(
                select(OutboxEvent)
                .where(OutboxEvent.published_at.is_(None))
                .order_by(OutboxEvent.occurred_at)
                .limit(RELAY_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        )
        queue = JobQueue(db, worker.clock)
        for event in events:
            for kind in subscriptions.get(event.event_type, ()):
                await queue.enqueue(
                    kind,
                    delivery_payload(event),
                    idempotency_key=f"event:{event.id}:{kind}",
                    workspace_id=event.workspace_id,
                    priority=50,
                )
            event.published_at = now
        await db.commit()
    if events:
        logger.debug("outbox_relayed", extra={"count": len(events)})
    return len(events)


async def purge_published_events(worker: WorkerContext) -> None:
    cutoff = worker.clock() - timedelta(days=worker.settings.job_retention_days)
    async with worker.session_factory() as db:
        await db.execute(
            delete(OutboxEvent).where(
                OutboxEvent.published_at.is_not(None), OutboxEvent.published_at < cutoff
            )
        )
        await db.commit()


class EventQueryService:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def recent(self, *, limit: int = 50, event_type: str | None = None) -> list[OutboxEvent]:
        stmt = select(OutboxEvent)
        if event_type:
            stmt = stmt.where(OutboxEvent.event_type == event_type)
        stmt = stmt.order_by(OutboxEvent.occurred_at.desc()).limit(limit)
        return list(await self._db.scalars(stmt))
