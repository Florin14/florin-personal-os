"""Execution engine, scheduling and event-trigger tests (real database, fake clock)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.actions import (
    ActionContext,
    ActionDefinition,
    ActionError,
    ActionRegistry,
    ActionRisk,
    RetryableActionError,
)
from app.core.tasks import WorkerContext
from app.modules.approvals.models import ApprovalRequest, DecisionChannel
from app.modules.approvals.service import ApprovalService, Decision
from app.modules.automation.actions import BUILTIN_ACTIONS
from app.modules.automation.models import (
    Automation,
    AutomationTrigger,
    StepExecution,
    WorkflowExecution,
)
from app.modules.automation.module import module as automation_module
from app.modules.automation.service import AutomationService, fire_due_schedules
from app.modules.events.public import EventPublisher
from app.modules.events.service import relay_outbox
from app.modules.identity.models import User
from app.modules.jobs.service import JobRunner
from app.modules.notifications.models import Notification
from app.modules.workspaces.models import Workspace
from app.worker import collect_handlers, collect_subscriptions
from tests.conftest import Clock, UserFactory


@dataclass
class FakeProvider:
    """Simulates an external provider that deduplicates by idempotency key."""

    charges: dict[str, str] = field(default_factory=dict)
    calls: int = 0
    fail_next: int = 0
    crash_after_charge: int = 0


class ChargeParams(BaseModel):
    customer: str
    amount: str


def make_actions(provider: FakeProvider) -> list[ActionDefinition]:
    async def charge(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
        assert isinstance(params, ChargeParams)
        provider.calls += 1
        if provider.fail_next > 0:
            provider.fail_next -= 1
            raise RetryableActionError("provider timeout")
        provider.charges.setdefault(ctx.idempotency_key, params.amount)
        if provider.crash_after_charge > 0:
            provider.crash_after_charge -= 1
            raise ConnectionResetError("connection lost after the provider accepted the request")
        return {"charged": params.amount}

    async def broken(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
        raise ActionError("customer does not exist")

    return [
        ActionDefinition(
            name="test.charge",
            title="Charge",
            description="",
            params_model=ChargeParams,
            handler=charge,
            risk=ActionRisk.MEDIUM,
        ),
        ActionDefinition(
            name="test.broken",
            title="Broken",
            description="",
            params_model=ChargeParams,
            handler=broken,
        ),
    ]


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def ctx(worker_ctx: WorkerContext, provider: FakeProvider) -> WorkerContext:
    return WorkerContext(
        session_factory=worker_ctx.session_factory,
        settings=worker_ctx.settings,
        secret_box=worker_ctx.secret_box,
        clock=worker_ctx.clock,
        actions=ActionRegistry([*BUILTIN_ACTIONS, *make_actions(provider)]),
    )


class Harness:
    def __init__(self, ctx: WorkerContext) -> None:
        from app.modules.registry import MODULES

        self.ctx = ctx
        handlers = collect_handlers(MODULES)
        self.subscriptions = collect_subscriptions(MODULES, handlers)
        self.runner = JobRunner(ctx, handlers, worker_id="test")

    async def pump(self, rounds: int = 30) -> None:
        """Relay events and run due jobs until the system is idle."""
        for _ in range(rounds):
            relayed = await relay_outbox(self.ctx, self.subscriptions)
            ran = await self.runner.run_once(limit=20)
            if relayed == 0 and ran == 0:
                return
        raise AssertionError("system did not become idle")


@pytest.fixture
def harness(ctx: WorkerContext) -> Harness:
    return Harness(ctx)


@pytest.fixture
async def world(db_session: AsyncSession, make_user: UserFactory) -> tuple[User, Workspace]:
    owner = await make_user()
    workspace = await make_user.workspace(owner, "auto")
    return owner, workspace


async def create(
    db: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    definition: dict[str, Any],
) -> Automation:
    owner, workspace = world
    return await AutomationService(db, ctx.actions, ctx.clock).create(
        workspace.id, name="Test", description="", definition=definition, actor_user_id=owner.id
    )


async def run(
    db: AsyncSession,
    ctx: WorkerContext,
    automation: Automation,
    payload: dict[str, Any] | None = None,
    *,
    dry_run: bool = False,
) -> uuid.UUID:
    execution = await AutomationService(db, ctx.actions, ctx.clock).run_manually(
        automation,
        payload=payload or {},
        dry_run=dry_run,
        actor_user_id=automation.created_by_user_id or uuid.uuid4(),
    )
    return execution.id


async def fetch(
    db: AsyncSession, execution_id: uuid.UUID
) -> tuple[WorkflowExecution, dict[str, StepExecution]]:
    db.expunge_all()
    execution = await db.get_one(WorkflowExecution, execution_id)
    steps = {
        s.step_key: s
        for s in await db.scalars(
            select(StepExecution).where(StepExecution.execution_id == execution_id)
        )
    }
    return execution, steps


CHARGE = {
    "key": "charge",
    "type": "action",
    "action": "test.charge",
    "params": {"customer": "{{ trigger.customer }}", "amount": "{{ trigger.amount }}"},
}


async def test_branching_workflow(
    db_session: AsyncSession, ctx: WorkerContext, world: tuple[User, Workspace], harness: Harness
) -> None:
    automation = await create(
        db_session,
        ctx,
        world,
        {
            "steps": [
                {
                    "key": "prep",
                    "type": "action",
                    "action": "core.set_values",
                    "params": {"values": {"who": "{{ trigger.customer }}"}},
                },
                {
                    "key": "big",
                    "type": "condition",
                    "conditions": [{"left": "trigger.amount", "op": "gt", "right": "100"}],
                    "on_false": "small_log",
                },
                {
                    "key": "alert",
                    "type": "notify",
                    "message_title": "Big order from {{ steps.prep.values.who }}",
                    "next": "end",
                },
                {
                    "key": "small_log",
                    "type": "action",
                    "action": "core.log",
                    "params": {"message": "small"},
                },
            ]
        },
    )
    big = await run(db_session, ctx, automation, {"customer": "ACME", "amount": "250"})
    small = await run(db_session, ctx, automation, {"customer": "Bob", "amount": "5"})
    await harness.pump()

    execution, steps = await fetch(db_session, big)
    assert execution.status == "succeeded"
    assert steps["big"].output == {"result": True}
    assert "small_log" not in steps
    titles = list(await db_session.scalars(select(Notification.title)))
    assert "Big order from ACME" in titles

    execution, steps = await fetch(db_session, small)
    assert execution.status == "succeeded"
    assert "alert" not in steps
    assert steps["small_log"].output == {"logged": "small"}


async def test_dry_run_has_no_side_effects(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    provider: FakeProvider,
) -> None:
    automation = await create(
        db_session,
        ctx,
        world,
        {
            "steps": [
                {"key": "wait", "type": "delay", "seconds": 3600},
                CHARGE | {"approval": {"risk_level": "medium"}},
                {"key": "tell", "type": "notify", "message_title": "done"},
            ]
        },
    )
    execution_id = await run(
        db_session, ctx, automation, {"customer": "ACME", "amount": "10"}, dry_run=True
    )
    await harness.pump()
    execution, steps = await fetch(db_session, execution_id)
    assert execution.status == "succeeded"
    assert provider.calls == 0
    assert steps["wait"].status == "skipped"
    assert steps["charge"].output["would_execute"] == {"customer": "ACME", "amount": "10"}
    assert steps["tell"].output["dry_run"] is True
    assert await db_session.scalar(select(func.count()).select_from(ApprovalRequest)) == 0


async def test_delay_waits_for_the_clock(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    clock: Clock,
) -> None:
    automation = await create(
        db_session,
        ctx,
        world,
        {
            "steps": [
                {"key": "wait", "type": "delay", "seconds": 600},
                {"key": "log", "type": "action", "action": "core.log", "params": {"message": "x"}},
            ]
        },
    )
    execution_id = await run(db_session, ctx, automation)
    await harness.pump()
    execution, _ = await fetch(db_session, execution_id)
    assert execution.status == "waiting_delay"
    clock.advance(seconds=601)
    await harness.pump()
    execution, steps = await fetch(db_session, execution_id)
    assert execution.status == "succeeded"
    assert steps["wait"].status == "succeeded"


class TestApprovalGatedActions:
    definition: dict[str, Any] = {"steps": [CHARGE | {"approval": {"risk_level": "medium"}}]}

    async def _waiting(
        self, db: AsyncSession, ctx: WorkerContext, world: tuple[User, Workspace], h: Harness
    ) -> tuple[uuid.UUID, ApprovalRequest]:
        automation = await create(db, ctx, world, self.definition)
        execution_id = await run(db, ctx, automation, {"customer": "ACME", "amount": "1500.00"})
        await h.pump()
        execution, steps = await fetch(db, execution_id)
        assert execution.status == "waiting_approval"
        approval = await db.get_one(ApprovalRequest, steps["charge"].approval_id)
        assert approval.payload == {
            "action": "test.charge",
            "params": {"customer": "ACME", "amount": "1500.00"},
        }
        return execution_id, approval

    async def test_approved_action_runs_exactly_once(
        self,
        db_session: AsyncSession,
        ctx: WorkerContext,
        world: tuple[User, Workspace],
        harness: Harness,
        provider: FakeProvider,
    ) -> None:
        owner, _ = world
        execution_id, approval = await self._waiting(db_session, ctx, world, harness)
        assert provider.calls == 0
        await ApprovalService(db_session, ctx.clock).decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )
        await harness.pump()
        execution, steps = await fetch(db_session, execution_id)
        assert execution.status == "succeeded"
        assert steps["charge"].output == {"charged": "1500.00"}
        assert provider.calls == 1
        assert (await db_session.get_one(ApprovalRequest, approval.id)).consumed_at is not None

    async def test_rejected_action_never_runs(
        self,
        db_session: AsyncSession,
        ctx: WorkerContext,
        world: tuple[User, Workspace],
        harness: Harness,
        provider: FakeProvider,
    ) -> None:
        owner, _ = world
        execution_id, approval = await self._waiting(db_session, ctx, world, harness)
        await ApprovalService(db_session, ctx.clock).decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.REJECT,
            channel=DecisionChannel.IN_APP,
        )
        await harness.pump()
        execution, _ = await fetch(db_session, execution_id)
        assert execution.status == "rejected"
        assert provider.calls == 0

    async def test_expired_approval_never_executes(
        self,
        db_session: AsyncSession,
        ctx: WorkerContext,
        world: tuple[User, Workspace],
        harness: Harness,
        provider: FakeProvider,
        clock: Clock,
    ) -> None:
        execution_id, _ = await self._waiting(db_session, ctx, world, harness)
        clock.advance(hours=25)
        async with ctx.session_factory() as db:
            await ApprovalService(db, ctx.clock).expire_due()
        await harness.pump()
        execution, _ = await fetch(db_session, execution_id)
        assert execution.status == "expired"
        assert provider.calls == 0

    async def test_new_version_does_not_affect_running_execution(
        self,
        db_session: AsyncSession,
        ctx: WorkerContext,
        world: tuple[User, Workspace],
        harness: Harness,
        provider: FakeProvider,
    ) -> None:
        owner, _ = world
        execution_id, approval = await self._waiting(db_session, ctx, world, harness)
        execution, _ = await fetch(db_session, execution_id)
        automation = await db_session.get_one(Automation, execution.automation_id)
        changed = {
            "steps": [
                CHARGE
                | {
                    "params": {"customer": "X", "amount": "99999"},
                    "approval": {"risk_level": "medium"},
                }
            ]
        }
        await AutomationService(db_session, ctx.actions, ctx.clock).update_definition(
            automation, definition=changed, actor_user_id=owner.id
        )
        await ApprovalService(db_session, ctx.clock).decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )
        await harness.pump()
        execution, steps = await fetch(db_session, execution_id)
        assert execution.status == "succeeded"
        assert execution.version == 1
        assert steps["charge"].output == {"charged": "1500.00"}  # the approved payload

    async def test_cancel_while_waiting_cancels_approval(
        self,
        db_session: AsyncSession,
        ctx: WorkerContext,
        world: tuple[User, Workspace],
        harness: Harness,
    ) -> None:
        owner, workspace = world
        execution_id, approval = await self._waiting(db_session, ctx, world, harness)
        await AutomationService(db_session, ctx.actions, ctx.clock).cancel_execution(
            workspace.id, execution_id, owner.id
        )
        await harness.pump()
        execution, _ = await fetch(db_session, execution_id)
        assert execution.status == "cancelled"
        assert (await db_session.get_one(ApprovalRequest, approval.id)).status == "cancelled"


async def test_transient_failures_are_retried_with_the_same_idempotency_key(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    provider: FakeProvider,
    clock: Clock,
) -> None:
    provider.fail_next = 2
    automation = await create(db_session, ctx, world, {"steps": [CHARGE]})
    execution_id = await run(db_session, ctx, automation, {"customer": "A", "amount": "1"})
    for _ in range(3):
        await harness.pump()
        clock.advance(minutes=10)
    execution, _ = await fetch(db_session, execution_id)
    assert execution.status == "succeeded"
    assert provider.calls == 3
    assert list(provider.charges) == [f"execution:{execution_id}:charge"]


async def test_restarted_worker_does_not_duplicate_side_effects(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    provider: FakeProvider,
    clock: Clock,
) -> None:
    """The provider accepted the charge but the worker lost the response (crash).

    The retry reuses the idempotency key, so the provider records a single charge.
    """
    provider.crash_after_charge = 1
    automation = await create(db_session, ctx, world, {"steps": [CHARGE]})
    execution_id = await run(db_session, ctx, automation, {"customer": "A", "amount": "7"})
    await harness.pump()
    clock.advance(minutes=10)
    await harness.pump()
    execution, _ = await fetch(db_session, execution_id)
    assert execution.status == "succeeded"
    assert provider.calls == 2
    assert len(provider.charges) == 1


async def test_permanent_action_error_fails_execution_and_alerts_admins(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
) -> None:
    automation = await create(
        db_session,
        ctx,
        world,
        {"steps": [CHARGE | {"key": "bad", "action": "test.broken"}]},
    )
    execution_id = await run(db_session, ctx, automation, {"customer": "A", "amount": "1"})
    await harness.pump()
    execution, steps = await fetch(db_session, execution_id)
    assert execution.status == "failed"
    assert steps["bad"].error == "customer does not exist"
    titles = list(await db_session.scalars(select(Notification.title)))
    assert "Automation failed: Test" in titles


async def test_invalid_rendered_params_fail_safely(
    db_session: AsyncSession, ctx: WorkerContext, world: tuple[User, Workspace], harness: Harness
) -> None:
    automation = await create(db_session, ctx, world, {"steps": [CHARGE]})
    execution_id = await run(db_session, ctx, automation, {"customer": "A"})  # amount missing
    await harness.pump()
    execution, steps = await fetch(db_session, execution_id)
    assert execution.status == "failed"
    assert "Invalid params" in (steps["charge"].error or "")


async def test_emergency_stop_blocks_side_effects_only(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    provider: FakeProvider,
) -> None:
    owner, _ = world
    service = AutomationService(db_session, ctx.actions, ctx.clock)
    await service.set_emergency_stop(True, actor_user_id=owner.id, reason="test")
    safe = await create(
        db_session,
        ctx,
        world,
        {
            "steps": [
                {"key": "log", "type": "action", "action": "core.log", "params": {"message": "ok"}}
            ]
        },
    )
    risky = await create(db_session, ctx, world, {"steps": [CHARGE]})
    safe_id = await run(db_session, ctx, safe)
    risky_id = await run(db_session, ctx, risky, {"customer": "A", "amount": "1"})
    await harness.pump()
    assert (await fetch(db_session, safe_id))[0].status == "succeeded"
    execution, _ = await fetch(db_session, risky_id)
    assert execution.status == "failed"
    assert "Emergency stop" in (execution.error or "")
    assert provider.calls == 0


async def test_cron_schedule_fires_once_per_slot_and_coalesces_missed_runs(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    clock: Clock,
) -> None:
    automation = await create(
        db_session,
        ctx,
        world,
        {
            "triggers": [
                {
                    "type": "cron",
                    "key": "daily",
                    "expression": "0 9 * * *",
                    "timezone": "Europe/Bucharest",
                }
            ],
            "steps": [
                {"key": "log", "type": "action", "action": "core.log", "params": {"message": "x"}}
            ],
        },
    )
    trigger = await db_session.scalar(
        select(AutomationTrigger).where(AutomationTrigger.automation_id == automation.id)
    )
    assert trigger is not None
    assert trigger.next_fire_at is not None
    first_slot = trigger.next_fire_at
    assert first_slot.astimezone(ZoneInfo("Europe/Bucharest")).hour == 9

    assert await fire_due_schedules(ctx) == 0
    clock.now = first_slot + timedelta(days=3, minutes=1)  # worker was down for 3 days
    assert await fire_due_schedules(ctx) == 1
    assert await fire_due_schedules(ctx) == 0
    count = await db_session.scalar(
        select(func.count()).where(WorkflowExecution.automation_id == automation.id)
    )
    assert count == 1
    db_session.expunge_all()
    trigger = await db_session.get_one(AutomationTrigger, trigger.id)
    assert trigger.next_fire_at is not None
    assert trigger.next_fire_at > clock.now


async def test_event_trigger_starts_matching_automation_in_same_workspace(
    db_session: AsyncSession,
    ctx: WorkerContext,
    world: tuple[User, Workspace],
    harness: Harness,
    make_user: UserFactory,
) -> None:
    _, workspace = world
    automation = await create(
        db_session,
        ctx,
        world,
        {
            "triggers": [{"type": "event", "key": "paid", "event_type": "test.invoice_paid"}],
            "steps": [
                {
                    "key": "log",
                    "type": "action",
                    "action": "core.log",
                    "params": {"message": "paid {{ trigger.event.number }}"},
                }
            ],
        },
    )
    other_owner = await make_user()
    other_ws = await make_user.workspace(other_owner, "other")
    EventPublisher(db_session, ctx.clock).publish(
        "test.invoice_paid", {"number": "INV-1"}, workspace_id=workspace.id
    )
    EventPublisher(db_session, ctx.clock).publish(
        "test.invoice_paid", {"number": "INV-2"}, workspace_id=other_ws.id
    )
    await db_session.commit()
    await harness.pump()
    executions = list(
        await db_session.scalars(
            select(WorkflowExecution).where(WorkflowExecution.automation_id == automation.id)
        )
    )
    assert len(executions) == 1
    _, steps = await fetch(db_session, executions[0].id)
    assert steps["log"].output == {"logged": "paid INV-1"}


def test_module_declares_wildcard_subscription() -> None:
    assert "*" in automation_module.event_subscriptions
