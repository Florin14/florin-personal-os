"""Approval workflow (framework independent).

Security properties:

* An approval covers exactly one action payload (SHA-256 of canonical JSON)
  and one version reference. Any change invalidates it.
* Approvals expire; an expired approval can neither be decided nor executed.
* Only workspace members with role >= member may decide; others never see it.
* High-risk approvals require an in-app decision with fresh MFA (step-up).
* An approval can authorize a single execution (consumed on use).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, DomainError, ErrorKind, Forbidden, NotFound, ValidationFailed
from app.core.tasks import WorkerContext
from app.modules.approvals.models import (
    ApprovalRequest,
    ApprovalStatus,
    DecisionChannel,
    RiskLevel,
)
from app.modules.audit.public import ActorType, AuditRecorder, Outcome
from app.modules.events.public import EventPublisher
from app.modules.notifications.public import NotificationService, Severity
from app.modules.workspaces.public import Role, WorkspaceService, accessible_workspace_ids

DEFAULT_EXPIRY = timedelta(hours=24)
MAX_EXPIRY = timedelta(days=30)

EVENT_REQUESTED = "approvals.requested"
EVENT_DECIDED = "approvals.decided"
EVENT_EXPIRED = "approvals.expired"


class Decision(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"


@dataclass(frozen=True, slots=True)
class RiskPolicy:
    channels: frozenset[DecisionChannel]
    requires_step_up: bool


RISK_POLICIES: dict[RiskLevel, RiskPolicy] = {
    RiskLevel.LOW: RiskPolicy(frozenset(DecisionChannel), requires_step_up=False),
    RiskLevel.MEDIUM: RiskPolicy(frozenset(DecisionChannel), requires_step_up=False),
    # e.g. invoice issuance, banking: never via chat alone.
    RiskLevel.HIGH: RiskPolicy(frozenset({DecisionChannel.IN_APP}), requires_step_up=True),
}


class ApprovalInvalid(DomainError):
    kind = ErrorKind.CONFLICT
    code = "approval_invalid"
    message = "The approval is not valid for this action."


def _json_default(value: object) -> str:
    if isinstance(value, Decimal | uuid.UUID | datetime):
        return str(value)
    raise TypeError(f"Unsupported type in approval payload: {type(value).__name__}")


def canonical_payload_hash(payload: dict[str, Any]) -> str:
    """Deterministic hash: sorted keys, no whitespace, Decimal/UUID/datetime as strings."""
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=_json_default
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _json_safe(payload: dict[str, Any]) -> dict[str, Any]:
    """Display copy with Decimal/UUID/datetime rendered as strings (JSONB-compatible)."""
    result: dict[str, Any] = json.loads(json.dumps(payload, default=_json_default))
    return result


StepUp = Callable[[str], Awaitable[None]]


class ApprovalService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock
        self._audit = AuditRecorder(session)
        self._events = EventPublisher(session, clock)

    # -------------------------------------------------------------- requesting

    async def request(
        self,
        *,
        workspace_id: uuid.UUID,
        action_type: str,
        title: str,
        payload: dict[str, Any],
        risk_level: RiskLevel,
        subject_type: str,
        subject_id: str,
        summary: str = "",
        display_payload: dict[str, Any] | None = None,
        version_ref: str | None = None,
        expires_in: timedelta = DEFAULT_EXPIRY,
        requested_by_user_id: uuid.UUID | None = None,
        idempotency_key: str | None = None,
    ) -> ApprovalRequest:
        """Create a pending approval in the caller's transaction (caller commits).

        ``payload`` is hashed; ``display_payload`` (defaults to ``payload``) is what
        approvers see and must not contain secrets.
        """
        if not timedelta(minutes=1) <= expires_in <= MAX_EXPIRY:
            raise ValidationFailed("Approval expiry must be between 1 minute and 30 days.")
        if idempotency_key is not None:
            existing = await self._db.scalar(
                select(ApprovalRequest).where(ApprovalRequest.idempotency_key == idempotency_key)
            )
            if existing is not None:
                return existing
        now = self._now()
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            requested_by_user_id=requested_by_user_id,
            idempotency_key=idempotency_key,
            subject_type=subject_type,
            subject_id=subject_id,
            action_type=action_type,
            title=title[:200],
            summary=summary,
            payload=_json_safe(display_payload if display_payload is not None else payload),
            payload_hash=canonical_payload_hash(payload),
            version_ref=version_ref,
            risk_level=risk_level.value,
            status=ApprovalStatus.PENDING.value,
            expires_at=now + expires_in,
        )
        self._db.add(approval)
        await self._db.flush()
        self._events.publish(
            EVENT_REQUESTED,
            {"approval_id": str(approval.id), "action_type": action_type, "risk": risk_level},
            workspace_id=workspace_id,
        )
        await NotificationService(self._db, self._now).notify_workspace(
            workspace_id,
            f"Approval needed: {approval.title}",
            summary,
            minimum_role=Role.MEMBER,
            severity=Severity.WARNING,
            category="approval",
            link=f"/approvals/{approval.id}",
            dedupe_key=f"approval-requested:{approval.id}",
            external=True,
        )
        self._audit.record(
            "approvals.requested",
            actor_type=ActorType.USER if requested_by_user_id else ActorType.SYSTEM,
            actor_user_id=requested_by_user_id,
            workspace_id=workspace_id,
            target_type="approval",
            target_id=approval.id,
            details={"action_type": action_type, "risk": risk_level.value},
        )
        return approval

    # ---------------------------------------------------------------- deciding

    async def decide(
        self,
        approval_id: uuid.UUID,
        *,
        actor_user_id: uuid.UUID,
        decision: Decision,
        channel: DecisionChannel,
        note: str | None = None,
        mfa_code: str | None = None,
        step_up: StepUp | None = None,
    ) -> ApprovalRequest:
        approval = await self._db.scalar(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id).with_for_update()
        )
        if approval is None:
            raise NotFound("Approval not found.")
        # Non-members get NotFound; viewers get Forbidden.
        await WorkspaceService(self._db).authorize(actor_user_id, approval.workspace_id)
        try:
            await WorkspaceService(self._db).authorize(
                actor_user_id, approval.workspace_id, Role.MEMBER
            )
        except Forbidden:
            self._record_denied(approval, actor_user_id, channel, "insufficient_role")
            await self._db.commit()
            raise

        now = self._now()
        if approval.status != ApprovalStatus.PENDING.value:
            raise Conflict(f"Approval is already {approval.status}.", code="approval_not_pending")
        if now >= approval.expires_at:
            self._expire(approval)
            await self._db.commit()
            raise Conflict("Approval has expired.", code="approval_expired")

        policy = RISK_POLICIES[RiskLevel(approval.risk_level)]
        if decision is Decision.APPROVE:
            if channel not in policy.channels:
                self._record_denied(approval, actor_user_id, channel, "channel_not_allowed")
                await self._db.commit()
                raise Forbidden(
                    "This approval must be confirmed in the Personal OS app.",
                    code="in_app_confirmation_required",
                )
            if policy.requires_step_up:
                if not mfa_code or step_up is None:
                    raise Forbidden(
                        "Enter a current two-factor code to approve this action.",
                        code="step_up_required",
                    )
                await step_up(mfa_code)  # raises on invalid/replayed code

        approval.status = (
            ApprovalStatus.APPROVED if decision is Decision.APPROVE else ApprovalStatus.REJECTED
        ).value
        approval.decided_by_user_id = actor_user_id
        approval.decided_at = now
        approval.decided_via = channel.value
        approval.decision_note = note[:500] if note else None
        self._events.publish(
            EVENT_DECIDED,
            {
                "approval_id": str(approval.id),
                "decision": approval.status,
                "subject_type": approval.subject_type,
                "subject_id": approval.subject_id,
            },
            workspace_id=approval.workspace_id,
            actor_user_id=actor_user_id,
        )
        self._audit.record(
            f"approvals.{approval.status}",
            actor_type=ActorType.DISCORD if channel is DecisionChannel.DISCORD else ActorType.USER,
            actor_user_id=actor_user_id,
            workspace_id=approval.workspace_id,
            target_type="approval",
            target_id=approval.id,
            details={
                "channel": channel.value,
                "payload_hash": approval.payload_hash,
                "risk": approval.risk_level,
            },
        )
        await self._db.commit()
        return approval

    # --------------------------------------------------------------- execution

    async def consume_for_execution(
        self,
        approval_id: uuid.UUID,
        *,
        payload: dict[str, Any],
        version_ref: str | None,
    ) -> ApprovalRequest:
        """Verify an approval authorizes exactly this action, and mark it used.

        Runs in the caller's transaction (commit together with the side-effect
        bookkeeping). Raises ApprovalInvalid otherwise.
        """
        approval = await self._db.scalar(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id).with_for_update()
        )
        reason: str | None = None
        if approval is None:
            raise ApprovalInvalid("Approval not found.", code="approval_missing")
        if approval.status != ApprovalStatus.APPROVED.value:
            reason = f"status_{approval.status}"
        elif approval.consumed_at is not None:
            reason = "already_used"
        elif approval.decided_at is None or approval.decided_at >= approval.expires_at:
            reason = "decided_after_expiry"
        elif approval.payload_hash != canonical_payload_hash(payload):
            reason = "payload_changed"
        elif approval.version_ref != version_ref:
            reason = "version_changed"
        if reason is not None:
            self._audit.record(
                "approvals.execution_rejected",
                outcome=Outcome.DENIED,
                actor_type=ActorType.SYSTEM,
                workspace_id=approval.workspace_id,
                target_type="approval",
                target_id=approval.id,
                details={"reason": reason},
            )
            raise ApprovalInvalid(f"Approval cannot be used: {reason}.", code=f"approval_{reason}")
        approval.consumed_at = self._now()
        return approval

    async def cancel(self, approval_id: uuid.UUID, reason: str) -> None:
        """System cancellation (e.g. the execution was cancelled). Caller commits."""
        approval = await self._db.get(ApprovalRequest, approval_id)
        if approval is not None and approval.status == ApprovalStatus.PENDING.value:
            approval.status = ApprovalStatus.CANCELLED.value
            approval.decision_note = reason[:500]

    async def expire_due(self) -> int:
        now = self._now()
        due = list(
            await self._db.scalars(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.status == ApprovalStatus.PENDING.value,
                    ApprovalRequest.expires_at <= now,
                )
                .with_for_update(skip_locked=True)
                .limit(200)
            )
        )
        for approval in due:
            self._expire(approval)
        await self._db.commit()
        return len(due)

    # ------------------------------------------------------------------ reading

    async def list_for_user(
        self, user_id: uuid.UUID, *, status: ApprovalStatus | None = None, limit: int = 50
    ) -> list[ApprovalRequest]:
        workspace_ids = await accessible_workspace_ids(self._db, user_id, Role.VIEWER)
        stmt = select(ApprovalRequest).where(ApprovalRequest.workspace_id.in_(workspace_ids))
        if status is not None:
            stmt = stmt.where(ApprovalRequest.status == status.value)
        stmt = stmt.order_by(ApprovalRequest.created_at.desc()).limit(limit)
        return list(await self._db.scalars(stmt))

    async def get(self, approval_id: uuid.UUID) -> ApprovalRequest:
        approval = await self._db.get(ApprovalRequest, approval_id)
        if approval is None:
            raise NotFound("Approval not found.")
        return approval

    async def get_for_user(self, user_id: uuid.UUID, approval_id: uuid.UUID) -> ApprovalRequest:
        approval = await self._db.get(ApprovalRequest, approval_id)
        if approval is None:
            raise NotFound("Approval not found.")
        await WorkspaceService(self._db).authorize(user_id, approval.workspace_id)
        return approval

    # ----------------------------------------------------------------- helpers

    def _expire(self, approval: ApprovalRequest) -> None:
        approval.status = ApprovalStatus.EXPIRED.value
        self._events.publish(
            EVENT_EXPIRED,
            {
                "approval_id": str(approval.id),
                "subject_type": approval.subject_type,
                "subject_id": approval.subject_id,
            },
            workspace_id=approval.workspace_id,
        )
        self._audit.record(
            "approvals.expired",
            actor_type=ActorType.SYSTEM,
            workspace_id=approval.workspace_id,
            target_type="approval",
            target_id=approval.id,
        )

    def _record_denied(
        self,
        approval: ApprovalRequest,
        actor_user_id: uuid.UUID,
        channel: DecisionChannel,
        reason: str,
    ) -> None:
        self._audit.record(
            "approvals.decision_denied",
            outcome=Outcome.DENIED,
            actor_user_id=actor_user_id,
            workspace_id=approval.workspace_id,
            target_type="approval",
            target_id=approval.id,
            details={"reason": reason, "channel": channel.value},
        )


async def expire_due_approvals(worker: WorkerContext) -> None:
    async with worker.session_factory() as db:
        await ApprovalService(db, worker.clock).expire_due()
