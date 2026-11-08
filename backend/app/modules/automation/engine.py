"""Workflow execution engine (runs inside worker jobs).

Each step is processed in its own transaction while holding a row lock on the
execution, so progress is durable and two jobs for the same execution can
never run a step twice concurrently. Side-effecting actions receive a stable
idempotency key (``execution:<id>:<step>``) so a retry after a crash can be
deduplicated by the provider adapter: execution is at-least-once.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from enum import Enum
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.actions import ActionContext, ActionError, RetryableActionError
from app.core.tasks import JobContext, PermanentJobError, RetryableJobError, WorkerContext
from app.modules.approvals.public import (
    ApprovalInvalid,
    ApprovalService,
    ApprovalStatus,
    RiskLevel,
)
from app.modules.automation.definition import (
    END,
    MAX_STEPS,
    ActionStep,
    ApprovalConfig,
    ApprovalStep,
    ConditionStep,
    DelayStep,
    NotifyStep,
    Step,
    WorkflowDefinition,
    default_next,
    evaluate_all,
    render,
)
from app.modules.automation.models import (
    Automation,
    AutomationControl,
    AutomationVersion,
    ExecutionStatus,
    StepExecution,
    StepStatus,
    WorkflowExecution,
)
from app.modules.events.public import EventPublisher
from app.modules.jobs.public import JobQueue
from app.modules.notifications.public import NotificationService, Severity
from app.modules.workspaces.public import Role

logger = logging.getLogger(__name__)

RUN_JOB = "automation.run_execution"
EVENT_FINISHED = "automation.execution.finished"
MAX_ERROR = 1000


class _Flow(Enum):
    CONTINUE = "continue"
    STOP = "stop"


def build_context(execution: WorkflowExecution) -> dict[str, Any]:
    return {
        "trigger": execution.trigger_payload,
        "steps": dict(execution.context.get("steps", {})),
        "execution": {
            "id": str(execution.id),
            "automation_id": str(execution.automation_id),
            "dry_run": execution.dry_run,
            "version": execution.version,
        },
    }


async def enqueue_run(
    db: AsyncSession,
    worker_clock: Any,
    execution: WorkflowExecution,
    reason: str,
    run_at: Any = None,
) -> None:
    await JobQueue(db, worker_clock).enqueue(
        RUN_JOB,
        {"execution_id": str(execution.id)},
        idempotency_key=f"execution:{execution.id}:{reason}",
        workspace_id=execution.workspace_id,
        run_at=run_at,
        max_attempts=5,
    )


async def emergency_stop_active(db: AsyncSession) -> bool:
    control = await db.get(AutomationControl, 1)
    return bool(control and control.emergency_stop)


class ExecutionEngine:
    def __init__(self, worker: WorkerContext) -> None:
        self._worker = worker
        self._now = worker.clock

    async def run(self, execution_id: uuid.UUID, *, is_last_attempt: bool) -> None:
        async with self._worker.session_factory() as db:
            execution = await db.get(WorkflowExecution, execution_id)
            if execution is None:
                raise PermanentJobError("Execution not found")
            version = await db.get_one(AutomationVersion, execution.version_id)
            definition = WorkflowDefinition.model_validate(version.definition)

        while True:
            async with self._worker.session_factory() as db:
                execution = await db.scalar(
                    select(WorkflowExecution)
                    .where(WorkflowExecution.id == execution_id)
                    .with_for_update()
                )
                assert execution is not None
                try:
                    flow = await self._advance(db, execution, definition)
                except (RetryableActionError, RetryableJobError) as exc:
                    if is_last_attempt:
                        await self._finish(db, execution, ExecutionStatus.FAILED, str(exc))
                        await db.commit()
                        return
                    raise RetryableJobError(str(exc)) from exc
                await db.commit()
            if flow is _Flow.STOP:
                return

    # ----------------------------------------------------------------- core

    async def _advance(
        self, db: AsyncSession, execution: WorkflowExecution, definition: WorkflowDefinition
    ) -> _Flow:
        status = ExecutionStatus(execution.status)
        if status.is_terminal:
            return _Flow.STOP
        if execution.cancel_requested:
            await self._finish(db, execution, ExecutionStatus.CANCELLED, "Cancelled by user.")
            return _Flow.STOP
        if status is ExecutionStatus.PENDING:
            execution.started_at = self._now()
            execution.current_step_key = definition.steps[0].key
        execution.status = ExecutionStatus.RUNNING.value

        key = execution.current_step_key
        if key is None or key == END:
            await self._finish(db, execution, ExecutionStatus.SUCCEEDED, None)
            return _Flow.STOP
        execution.steps_executed += 1
        if execution.steps_executed > MAX_STEPS * 4:
            await self._finish(db, execution, ExecutionStatus.FAILED, "Step limit exceeded.")
            return _Flow.STOP

        step = definition.step(key)
        if step is None:
            await self._finish(db, execution, ExecutionStatus.FAILED, f"Unknown step {key!r}.")
            return _Flow.STOP
        record = await self._step_record(db, execution, step)
        context = build_context(execution)

        if isinstance(step, ConditionStep):
            result = evaluate_all(step, context)
            target = (
                (step.on_true or step.next or default_next(definition, key))
                if result
                else (step.on_false)
            )
            return self._complete(execution, record, {"result": result}, target)
        if isinstance(step, DelayStep):
            return await self._delay(db, execution, record, step, definition)
        if isinstance(step, NotifyStep):
            return await self._notify(db, execution, record, step, context, definition)
        if isinstance(step, ApprovalStep):
            payload = {
                "execution_id": str(execution.id),
                "step": step.key,
                "title": render(step.approval.title or step.title, context),
            }
            gate = await self._approval_gate(
                db, execution, record, step.approval, "automation.approval_gate", payload, context
            )
            if gate is not _Flow.CONTINUE:
                return gate
            return self._complete(
                execution, record, {"approved": True}, self._next(definition, step)
            )
        return await self._action(db, execution, record, step, context, definition)

    def _next(self, definition: WorkflowDefinition, step: Step) -> str:
        return step.next or default_next(definition, step.key)

    async def _step_record(
        self, db: AsyncSession, execution: WorkflowExecution, step: Step
    ) -> StepExecution:
        record = await db.scalar(
            select(StepExecution).where(
                StepExecution.execution_id == execution.id, StepExecution.step_key == step.key
            )
        )
        if record is None:
            record = StepExecution(
                id=uuid.uuid4(),
                execution_id=execution.id,
                step_key=step.key,
                step_type=step.type,
                status=StepStatus.RUNNING.value,
                attempts=0,
                input={},
                output={},
                started_at=self._now(),
            )
            db.add(record)
        record.attempts += 1
        return record

    def _complete(
        self,
        execution: WorkflowExecution,
        record: StepExecution,
        output: dict[str, Any],
        target: str,
        status: StepStatus = StepStatus.SUCCEEDED,
    ) -> _Flow:
        record.status = status.value
        record.output = output
        record.error = None
        record.finished_at = self._now()
        steps = dict(execution.context.get("steps", {}))
        steps[record.step_key] = output
        execution.context = {**execution.context, "steps": steps}
        execution.current_step_key = target
        return _Flow.CONTINUE

    async def _fail_step(
        self, db: AsyncSession, execution: WorkflowExecution, record: StepExecution, error: str
    ) -> _Flow:
        record.status = StepStatus.FAILED.value
        record.error = error[:MAX_ERROR]
        record.finished_at = self._now()
        await self._finish(db, execution, ExecutionStatus.FAILED, error)
        return _Flow.STOP

    # ---------------------------------------------------------------- steps

    async def _delay(
        self,
        db: AsyncSession,
        execution: WorkflowExecution,
        record: StepExecution,
        step: DelayStep,
        definition: WorkflowDefinition,
    ) -> _Flow:
        target = self._next(definition, step)
        if execution.dry_run:
            return self._complete(
                execution,
                record,
                {"dry_run": True, "skipped_seconds": step.seconds},
                target,
                StepStatus.SKIPPED,
            )
        now = self._now()
        if record.resume_at is None:
            record.resume_at = now + timedelta(seconds=step.seconds)
        if now >= record.resume_at:
            return self._complete(execution, record, {"waited_seconds": step.seconds}, target)
        record.status = StepStatus.WAITING.value
        execution.status = ExecutionStatus.WAITING_DELAY.value
        await enqueue_run(db, self._now, execution, f"delay:{step.key}", run_at=record.resume_at)
        return _Flow.STOP

    async def _notify(
        self,
        db: AsyncSession,
        execution: WorkflowExecution,
        record: StepExecution,
        step: NotifyStep,
        context: dict[str, Any],
        definition: WorkflowDefinition,
    ) -> _Flow:
        title = str(render(step.message_title, context))
        body = str(render(step.message_body, context))
        record.input = {"title": title, "body": body}
        if execution.dry_run:
            output: dict[str, Any] = {"dry_run": True, "would_notify": {"title": title}}
        else:
            ids = await NotificationService(db, self._now).notify_workspace(
                execution.workspace_id,
                title,
                body,
                minimum_role=Role.MEMBER,
                severity=Severity(step.severity),
                category="automation",
                link=f"/executions/{execution.id}",
                dedupe_key=f"execution:{execution.id}:{step.key}",
            )
            output = {"notified": len(ids)}
        return self._complete(execution, record, output, self._next(definition, step))

    async def _approval_gate(
        self,
        db: AsyncSession,
        execution: WorkflowExecution,
        record: StepExecution,
        config: ApprovalConfig,
        action_type: str,
        payload: dict[str, Any],
        context: dict[str, Any],
    ) -> _Flow:
        """CONTINUE once an approval for exactly ``payload`` was granted and consumed."""
        if execution.dry_run:
            record.input = {
                **record.input,
                "approval": {"dry_run": True, "risk": config.risk_level},
            }
            return _Flow.CONTINUE
        approvals = ApprovalService(db, self._now)
        version_ref = str(execution.version_id)
        if record.approval_id is None:
            automation = await db.get_one(Automation, execution.automation_id)
            approval = await approvals.request(
                workspace_id=execution.workspace_id,
                action_type=action_type,
                title=str(render(config.title, context)) or f"{automation.name}: {record.step_key}",
                summary=str(render(config.summary, context)),
                payload=payload,
                risk_level=RiskLevel(config.risk_level),
                subject_type="execution_step",
                subject_id=f"{execution.id}:{record.step_key}",
                version_ref=version_ref,
                expires_in=timedelta(minutes=config.expires_in_minutes),
                idempotency_key=f"execution:{execution.id}:{record.step_key}",
            )
            record.approval_id = approval.id
            return self._wait_for_approval(execution, record)

        approval = await approvals.get(record.approval_id)
        status = ApprovalStatus(approval.status)
        if status is ApprovalStatus.PENDING:
            return self._wait_for_approval(execution, record)
        if status is ApprovalStatus.REJECTED:
            record.status = StepStatus.FAILED.value
            record.error = "Approval rejected."
            record.finished_at = self._now()
            await self._finish(db, execution, ExecutionStatus.REJECTED, "Approval rejected.")
            return _Flow.STOP
        if status is not ApprovalStatus.APPROVED:
            record.status = StepStatus.FAILED.value
            record.error = f"Approval {status.value}."
            record.finished_at = self._now()
            await self._finish(db, execution, ExecutionStatus.EXPIRED, f"Approval {status.value}.")
            return _Flow.STOP
        try:
            await approvals.consume_for_execution(
                approval.id, payload=payload, version_ref=version_ref
            )
        except ApprovalInvalid as exc:
            return await self._fail_step(db, execution, record, exc.message)
        return _Flow.CONTINUE

    def _wait_for_approval(self, execution: WorkflowExecution, record: StepExecution) -> _Flow:
        record.status = StepStatus.WAITING.value
        execution.status = ExecutionStatus.WAITING_APPROVAL.value
        return _Flow.STOP

    async def _action(
        self,
        db: AsyncSession,
        execution: WorkflowExecution,
        record: StepExecution,
        step: ActionStep,
        context: dict[str, Any],
        definition: WorkflowDefinition,
    ) -> _Flow:
        action = self._worker.actions.get(step.action)
        if action is None:
            return await self._fail_step(db, execution, record, f"Unknown action {step.action!r}.")
        rendered = render(step.params, context)
        try:
            params = action.validate_params(rendered)
        except ValidationError as exc:
            errors = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
            return await self._fail_step(db, execution, record, f"Invalid params: {errors}")
        params_json = params.model_dump(mode="json")
        record.input = {"action": action.name, "params": params_json}

        if action.side_effecting and not execution.dry_run and await emergency_stop_active(db):
            return await self._fail_step(
                db, execution, record, "Emergency stop is active: side-effecting actions blocked."
            )

        approval_config = step.approval
        if approval_config is None and action.requires_approval:
            approval_config = ApprovalConfig(risk_level=action.risk.value)
        if approval_config is not None:
            gate = await self._approval_gate(
                db,
                execution,
                record,
                approval_config,
                action.name,
                {"action": action.name, "params": params_json},
                context,
            )
            if gate is not _Flow.CONTINUE:
                return gate

        action_ctx = ActionContext(
            workspace_id=execution.workspace_id,
            execution_id=execution.id,
            step_key=step.key,
            idempotency_key=f"execution:{execution.id}:{step.key}",
            worker=self._worker,
        )
        try:
            if execution.dry_run and action.side_effecting:
                output = await action.plan(action_ctx, params)
            else:
                output = await action.handler(action_ctx, params)
        except ActionError as exc:
            return await self._fail_step(db, execution, record, str(exc) or type(exc).__name__)
        except RetryableActionError:
            raise
        except Exception as exc:
            logger.exception("action_failed", extra={"action": action.name})
            raise RetryableActionError(f"{type(exc).__name__}: {exc}") from exc
        return self._complete(execution, record, output, self._next(definition, step))

    # ------------------------------------------------------------- finishing

    async def _finish(
        self,
        db: AsyncSession,
        execution: WorkflowExecution,
        status: ExecutionStatus,
        error: str | None,
    ) -> None:
        execution.status = status.value
        execution.finished_at = self._now()
        execution.error = error[:MAX_ERROR] if error else None
        if status is ExecutionStatus.CANCELLED:
            pending = await db.scalars(
                select(StepExecution.approval_id).where(
                    StepExecution.execution_id == execution.id,
                    StepExecution.approval_id.is_not(None),
                )
            )
            for approval_id in pending:
                if approval_id is not None:
                    await ApprovalService(db, self._now).cancel(approval_id, "Execution cancelled")
        EventPublisher(db, self._now).publish(
            EVENT_FINISHED,
            {
                "execution_id": str(execution.id),
                "automation_id": str(execution.automation_id),
                "status": status.value,
                "dry_run": execution.dry_run,
            },
            workspace_id=execution.workspace_id,
        )
        if status in (ExecutionStatus.FAILED, ExecutionStatus.EXPIRED) and not execution.dry_run:
            automation = await db.get_one(Automation, execution.automation_id)
            await NotificationService(db, self._now).notify_workspace(
                execution.workspace_id,
                f"Automation failed: {automation.name}",
                error or "",
                minimum_role=Role.ADMIN,
                severity=Severity.ERROR,
                category="execution",
                link=f"/executions/{execution.id}",
                dedupe_key=f"execution-finished:{execution.id}",
                external=True,
            )


async def run_execution_job(ctx: JobContext) -> None:
    try:
        execution_id = uuid.UUID(str(ctx.payload["execution_id"]))
    except (KeyError, ValueError) as exc:
        raise PermanentJobError("Malformed execution job payload") from exc
    await ExecutionEngine(ctx.worker).run(execution_id, is_last_attempt=ctx.is_last_attempt)
