"""Automation management, triggering and scheduling (framework independent)."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from cronsim import CronSim
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.actions import ActionRegistry
from app.core.db import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.tasks import JobContext, WorkerContext
from app.modules.audit.public import AuditRecorder
from app.modules.automation.definition import (
    CronTrigger,
    EventTrigger,
    IntervalTrigger,
    ManualTrigger,
    WorkflowDefinition,
    validate_actions,
)
from app.modules.automation.engine import enqueue_run
from app.modules.automation.models import (
    Automation,
    AutomationControl,
    AutomationTrigger,
    AutomationVersion,
    ExecutionStatus,
    StepExecution,
    WorkflowExecution,
)
from app.modules.events.public import event_from_job

logger = logging.getLogger(__name__)

SCHEDULE_BATCH = 50


def definition_hash(definition: dict[str, Any]) -> str:
    raw = json.dumps(definition, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_definition(raw: dict[str, Any], registry: ActionRegistry) -> WorkflowDefinition:
    try:
        definition = WorkflowDefinition.model_validate(raw)
    except ValidationError as exc:
        messages = "; ".join(
            f"{'.'.join(map(str, e['loc'])) or 'definition'}: {e['msg']}" for e in exc.errors()
        )
        raise ValidationFailed(f"Invalid workflow: {messages}", code="invalid_workflow") from exc
    errors = validate_actions(definition, registry)
    if errors:
        raise ValidationFailed("Invalid workflow: " + " ".join(errors), code="invalid_workflow")
    return definition


def next_fire_time(trigger: CronTrigger | IntervalTrigger, after: datetime) -> datetime:
    """Next fire instant strictly after ``after`` (UTC), honouring the trigger timezone/DST."""
    if isinstance(trigger, IntervalTrigger):
        return after + timedelta(seconds=trigger.seconds)
    local = after.astimezone(ZoneInfo(trigger.timezone))
    fire: datetime = next(CronSim(trigger.expression, local))
    return fire.astimezone(after.tzinfo)


class AutomationService:
    def __init__(
        self,
        session: AsyncSession,
        registry: ActionRegistry,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._db = session
        self._registry = registry
        self._now = clock
        self._audit = AuditRecorder(session)

    # ------------------------------------------------------------ definitions

    async def create(
        self,
        workspace_id: uuid.UUID,
        *,
        name: str,
        description: str,
        definition: dict[str, Any],
        actor_user_id: uuid.UUID,
    ) -> Automation:
        parsed = parse_definition(definition, self._registry)
        automation = Automation(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name.strip()[:100],
            description=description,
            enabled=True,
            current_version=1,
            created_by_user_id=actor_user_id,
        )
        self._db.add(automation)
        await self._db.flush()
        await self._add_version(automation, parsed, actor_user_id)
        self._audit.record(
            "automation.created",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="automation",
            target_id=automation.id,
            details={"name": automation.name},
        )
        await self._db.commit()
        return automation

    async def update_definition(
        self,
        automation: Automation,
        *,
        definition: dict[str, Any],
        actor_user_id: uuid.UUID,
        name: str | None = None,
        description: str | None = None,
    ) -> Automation:
        parsed = parse_definition(definition, self._registry)
        if name is not None:
            automation.name = name.strip()[:100]
        if description is not None:
            automation.description = description
        current = await self.current_version(automation)
        if current.definition_hash != definition_hash(parsed.model_dump(mode="json")):
            automation.current_version += 1
            await self._add_version(automation, parsed, actor_user_id)
            self._audit.record(
                "automation.version_created",
                actor_user_id=actor_user_id,
                workspace_id=automation.workspace_id,
                target_type="automation",
                target_id=automation.id,
                details={"version": automation.current_version},
            )
        await self._db.commit()
        return automation

    async def set_enabled(
        self, automation: Automation, enabled: bool, actor_user_id: uuid.UUID
    ) -> Automation:
        automation.enabled = enabled
        self._audit.record(
            "automation.enabled" if enabled else "automation.disabled",
            actor_user_id=actor_user_id,
            workspace_id=automation.workspace_id,
            target_type="automation",
            target_id=automation.id,
        )
        await self._db.commit()
        return automation

    async def _add_version(
        self, automation: Automation, definition: WorkflowDefinition, actor: uuid.UUID | None
    ) -> AutomationVersion:
        data = definition.model_dump(mode="json")
        version = AutomationVersion(
            id=uuid.uuid4(),
            automation_id=automation.id,
            version=automation.current_version,
            definition=data,
            definition_hash=definition_hash(data),
            created_at=self._now(),
            created_by_user_id=actor,
        )
        self._db.add(version)
        await self._sync_triggers(automation, definition)
        return version

    async def _sync_triggers(self, automation: Automation, definition: WorkflowDefinition) -> None:
        """Rebuild the trigger index for the current version (keeping schedule progress)."""
        existing = {
            t.trigger_key: t
            for t in await self._db.scalars(
                select(AutomationTrigger).where(AutomationTrigger.automation_id == automation.id)
            )
        }
        now = self._now()
        keep: set[str] = set()
        for trigger in definition.triggers:
            if isinstance(trigger, ManualTrigger):
                continue
            keep.add(trigger.key)
            row = existing.get(trigger.key)
            if row is None:
                row = AutomationTrigger(
                    id=uuid.uuid4(),
                    automation_id=automation.id,
                    workspace_id=automation.workspace_id,
                    trigger_key=trigger.key,
                )
                self._db.add(row)
            row.trigger_type = trigger.type
            row.enabled = True
            if isinstance(trigger, EventTrigger):
                row.event_type = trigger.event_type
                row.next_fire_at = None
            else:
                row.event_type = None
                row.next_fire_at = next_fire_time(trigger, now)
        stale = [key for key in existing if key not in keep]
        if stale:
            await self._db.execute(
                delete(AutomationTrigger).where(
                    AutomationTrigger.automation_id == automation.id,
                    AutomationTrigger.trigger_key.in_(stale),
                )
            )

    # --------------------------------------------------------------- reading

    async def list_automations(self, workspace_id: uuid.UUID) -> list[Automation]:
        return list(
            await self._db.scalars(
                select(Automation)
                .where(Automation.workspace_id == workspace_id)
                .order_by(Automation.name)
            )
        )

    async def get(self, workspace_id: uuid.UUID, automation_id: uuid.UUID) -> Automation:
        automation = await self._db.scalar(
            select(Automation).where(
                Automation.id == automation_id, Automation.workspace_id == workspace_id
            )
        )
        if automation is None:
            raise NotFound("Automation not found.")
        return automation

    async def current_version(self, automation: Automation) -> AutomationVersion:
        return await self._version(automation.id, automation.current_version)

    async def _version(self, automation_id: uuid.UUID, version: int) -> AutomationVersion:
        row = await self._db.scalar(
            select(AutomationVersion).where(
                AutomationVersion.automation_id == automation_id,
                AutomationVersion.version == version,
            )
        )
        if row is None:
            raise NotFound("Automation version not found.")
        return row

    async def versions(self, automation: Automation) -> list[AutomationVersion]:
        return list(
            await self._db.scalars(
                select(AutomationVersion)
                .where(AutomationVersion.automation_id == automation.id)
                .order_by(AutomationVersion.version.desc())
            )
        )

    async def triggers(self, automation_ids: list[uuid.UUID]) -> list[AutomationTrigger]:
        return list(
            await self._db.scalars(
                select(AutomationTrigger).where(AutomationTrigger.automation_id.in_(automation_ids))
            )
        )

    # -------------------------------------------------------------- executing

    async def start_execution(
        self,
        automation: Automation,
        *,
        trigger_key: str,
        trigger_type: str,
        payload: dict[str, Any] | None = None,
        dry_run: bool = False,
        actor_user_id: uuid.UUID | None = None,
        idempotency_key: str | None = None,
    ) -> WorkflowExecution:
        """Create an execution of the current version and enqueue it (caller commits)."""
        if not automation.enabled and not dry_run:
            raise Conflict("Automation is disabled.", code="automation_disabled")
        if idempotency_key is not None:
            existing = await self._db.scalar(
                select(WorkflowExecution).where(
                    WorkflowExecution.idempotency_key == idempotency_key
                )
            )
            if existing is not None:
                return existing
        version = await self.current_version(automation)
        execution = WorkflowExecution(
            id=uuid.uuid4(),
            workspace_id=automation.workspace_id,
            automation_id=automation.id,
            version_id=version.id,
            version=version.version,
            trigger_key=trigger_key,
            trigger_type=trigger_type,
            trigger_payload=payload or {},
            status=ExecutionStatus.PENDING.value,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            context={},
            triggered_by_user_id=actor_user_id,
        )
        self._db.add(execution)
        await self._db.flush()
        await enqueue_run(self._db, self._now, execution, "start")
        return execution

    async def run_manually(
        self,
        automation: Automation,
        *,
        payload: dict[str, Any],
        dry_run: bool,
        actor_user_id: uuid.UUID,
    ) -> WorkflowExecution:
        version = await self.current_version(automation)
        definition = WorkflowDefinition.model_validate(version.definition)
        manual = next((t for t in definition.triggers if isinstance(t, ManualTrigger)), None)
        if manual is None and not dry_run:
            raise Conflict("This automation cannot be run manually.", code="no_manual_trigger")
        execution = await self.start_execution(
            automation,
            trigger_key=manual.key if manual else "manual",
            trigger_type="manual",
            payload=payload,
            dry_run=dry_run,
            actor_user_id=actor_user_id,
        )
        self._audit.record(
            "automation.run_requested",
            actor_user_id=actor_user_id,
            workspace_id=automation.workspace_id,
            target_type="execution",
            target_id=execution.id,
            details={"automation_id": str(automation.id), "dry_run": dry_run},
        )
        await self._db.commit()
        return execution

    async def list_executions(
        self,
        workspace_id: uuid.UUID,
        *,
        automation_id: uuid.UUID | None = None,
        status: ExecutionStatus | None = None,
        limit: int = 50,
    ) -> list[WorkflowExecution]:
        stmt = select(WorkflowExecution).where(WorkflowExecution.workspace_id == workspace_id)
        if automation_id is not None:
            stmt = stmt.where(WorkflowExecution.automation_id == automation_id)
        if status is not None:
            stmt = stmt.where(WorkflowExecution.status == status.value)
        stmt = stmt.order_by(WorkflowExecution.created_at.desc()).limit(limit)
        return list(await self._db.scalars(stmt))

    async def get_execution(
        self, workspace_id: uuid.UUID, execution_id: uuid.UUID
    ) -> tuple[WorkflowExecution, list[StepExecution]]:
        execution = await self._db.scalar(
            select(WorkflowExecution).where(
                WorkflowExecution.id == execution_id,
                WorkflowExecution.workspace_id == workspace_id,
            )
        )
        if execution is None:
            raise NotFound("Execution not found.")
        steps = list(
            await self._db.scalars(
                select(StepExecution)
                .where(StepExecution.execution_id == execution.id)
                .order_by(StepExecution.started_at, StepExecution.created_at)
            )
        )
        return execution, steps

    async def cancel_execution(
        self, workspace_id: uuid.UUID, execution_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> WorkflowExecution:
        execution = await self._db.scalar(
            select(WorkflowExecution)
            .where(
                WorkflowExecution.id == execution_id,
                WorkflowExecution.workspace_id == workspace_id,
            )
            .with_for_update()
        )
        if execution is None:
            raise NotFound("Execution not found.")
        status = ExecutionStatus(execution.status)
        if status.is_terminal:
            raise Conflict(f"Execution already {status.value}.", code="execution_finished")
        execution.cancel_requested = True
        if status in (ExecutionStatus.WAITING_APPROVAL, ExecutionStatus.WAITING_DELAY):
            # Nothing is running: let the engine finalize it promptly.
            await enqueue_run(self._db, self._now, execution, f"cancel:{uuid.uuid4().hex[:8]}")
        self._audit.record(
            "automation.execution_cancel_requested",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="execution",
            target_id=execution.id,
        )
        await self._db.commit()
        return execution

    # --------------------------------------------------------- emergency stop

    async def controls(self) -> AutomationControl:
        control = await self._db.get(AutomationControl, 1)
        if control is None:
            control = AutomationControl(id=1, emergency_stop=False)
            self._db.add(control)
            await self._db.flush()
        return control

    async def set_emergency_stop(
        self, active: bool, *, actor_user_id: uuid.UUID, reason: str | None
    ) -> AutomationControl:
        control = await self.controls()
        control.emergency_stop = active
        control.changed_at = self._now()
        control.changed_by_user_id = actor_user_id
        control.reason = reason[:500] if reason else None
        self._audit.record(
            "automation.emergency_stop_activated"
            if active
            else "automation.emergency_stop_released",
            actor_user_id=actor_user_id,
            details={"reason": reason or ""},
        )
        await self._db.commit()
        return control


# ------------------------------------------------------------ worker entrypoints


async def fire_due_schedules(worker: WorkerContext) -> int:
    """Start executions for due cron/interval triggers.

    Missed runs (e.g. worker downtime) are coalesced into a single run; the
    idempotency key per (trigger, scheduled instant) prevents duplicates.
    """
    now = worker.clock()
    fired = 0
    async with worker.session_factory() as db:
        due = list(
            await db.scalars(
                select(AutomationTrigger)
                .where(
                    AutomationTrigger.enabled.is_(True),
                    AutomationTrigger.next_fire_at.is_not(None),
                    AutomationTrigger.next_fire_at <= now,
                )
                .order_by(AutomationTrigger.next_fire_at)
                .limit(SCHEDULE_BATCH)
                .with_for_update(skip_locked=True)
            )
        )
        service = AutomationService(db, worker.actions, worker.clock)
        for row in due:
            automation = await db.get_one(Automation, row.automation_id)
            definition = WorkflowDefinition.model_validate(
                (await service.current_version(automation)).definition
            )
            trigger = next((t for t in definition.triggers if t.key == row.trigger_key), None)
            if not isinstance(trigger, CronTrigger | IntervalTrigger):
                row.enabled = False
                continue
            scheduled_for = row.next_fire_at
            assert scheduled_for is not None
            if automation.enabled:
                await service.start_execution(
                    automation,
                    trigger_key=row.trigger_key,
                    trigger_type=trigger.type,
                    payload={"scheduled_for": scheduled_for.isoformat()},
                    idempotency_key=(
                        f"schedule:{automation.id}:{row.trigger_key}:{scheduled_for.isoformat()}"
                    ),
                )
                fired += 1
            row.last_fired_at = now
            row.next_fire_at = next_fire_time(trigger, max(now, scheduled_for))
        await db.commit()
    return fired


async def on_domain_event(ctx: JobContext) -> None:
    """Start automations whose event trigger matches the delivered event."""
    event = event_from_job(ctx)
    if event.workspace_id is None:
        return
    async with ctx.worker.session_factory() as db:
        rows = list(
            await db.scalars(
                select(AutomationTrigger).where(
                    AutomationTrigger.enabled.is_(True),
                    AutomationTrigger.event_type == event.event_type,
                    AutomationTrigger.workspace_id == event.workspace_id,
                )
            )
        )
        service = AutomationService(db, ctx.worker.actions, ctx.worker.clock)
        for row in rows:
            automation = await db.get_one(Automation, row.automation_id)
            if not automation.enabled:
                continue
            await service.start_execution(
                automation,
                trigger_key=row.trigger_key,
                trigger_type="event",
                payload={"event_type": event.event_type, "event": event.payload},
                idempotency_key=f"event:{event.id}:{automation.id}:{row.trigger_key}",
            )
        await db.commit()


async def on_approval_event(ctx: JobContext) -> None:
    """Resume the execution waiting on a decided/expired approval."""
    event = event_from_job(ctx)
    subject_id = str(event.payload.get("subject_id", ""))
    if event.payload.get("subject_type") != "execution_step" or ":" not in subject_id:
        return
    execution_ref, _ = subject_id.split(":", 1)
    async with ctx.worker.session_factory() as db:
        execution = await db.get(WorkflowExecution, uuid.UUID(execution_ref))
        if execution is None or ExecutionStatus(execution.status).is_terminal:
            return
        await enqueue_run(
            db, ctx.worker.clock, execution, f"approval:{event.payload.get('approval_id')}"
        )
        await db.commit()
