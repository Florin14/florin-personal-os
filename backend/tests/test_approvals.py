"""Approval workflow tests, including the spec's critical security scenarios."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.modules.approvals.models import ApprovalRequest, DecisionChannel, RiskLevel
from app.modules.approvals.service import (
    ApprovalInvalid,
    ApprovalService,
    Decision,
    canonical_payload_hash,
)
from app.modules.events.models import OutboxEvent
from app.modules.identity.models import User
from app.modules.notifications.service import NotificationService
from app.modules.workspaces.models import Role, Workspace
from app.modules.workspaces.service import WorkspaceService
from tests.conftest import AuthenticatedUser, Clock, UserFactory, csrf_headers, totp_code

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]
PAYLOAD: dict[str, Any] = {"client": "ACME SRL", "amount": Decimal("1500.00"), "currency": "RON"}


@pytest.fixture
async def setup(db_session: AsyncSession, make_user: UserFactory) -> tuple[User, User, Workspace]:
    owner, viewer = await make_user(), await make_user()
    ws = await make_user.workspace(owner, "approvals")
    await WorkspaceService(db_session).add_member(ws.id, viewer.id, Role.VIEWER)
    return owner, viewer, ws


async def _request(
    db: AsyncSession,
    clock: Clock,
    ws: Workspace,
    *,
    risk: RiskLevel = RiskLevel.LOW,
    payload: dict[str, Any] | None = None,
    expires_in: timedelta = timedelta(hours=1),
    key: str | None = None,
) -> ApprovalRequest:
    approval = await ApprovalService(db, clock).request(
        workspace_id=ws.id,
        action_type="test.issue_invoice",
        title="Issue invoice",
        payload=payload or PAYLOAD,
        risk_level=risk,
        subject_type="test",
        subject_id=str(uuid.uuid4()),
        version_ref="v1",
        expires_in=expires_in,
        idempotency_key=key,
    )
    await db.commit()
    return approval


def test_canonical_hash_is_order_independent_and_sensitive_to_values() -> None:
    a = canonical_payload_hash({"a": 1, "b": Decimal("2.50")})
    b = canonical_payload_hash({"b": Decimal("2.50"), "a": 1})
    assert a == b
    assert a != canonical_payload_hash({"a": 1, "b": Decimal("2.51")})
    with pytest.raises(TypeError):
        canonical_payload_hash({"x": object()})


async def test_request_notifies_members_and_is_idempotent(
    db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
) -> None:
    owner, viewer, ws = setup
    first = await _request(db_session, clock, ws, key="exec:1:step")
    second = await _request(db_session, clock, ws, key="exec:1:step")
    assert first.id == second.id
    notifications = NotificationService(db_session)
    assert await notifications.unread_count(owner.id) == 1
    assert await notifications.unread_count(viewer.id) == 0  # viewers cannot approve
    events = await db_session.scalars(
        select(OutboxEvent.event_type).where(OutboxEvent.workspace_id == ws.id)
    )
    assert "approvals.requested" in list(events)


async def test_member_approves_and_event_is_published(
    db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
) -> None:
    owner, _, ws = setup
    approval = await _request(db_session, clock, ws)
    decided = await ApprovalService(db_session, clock).decide(
        approval.id,
        actor_user_id=owner.id,
        decision=Decision.APPROVE,
        channel=DecisionChannel.IN_APP,
    )
    assert decided.status == "approved"
    assert decided.decided_by_user_id == owner.id
    events = list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "approvals.decided")
        )
    )
    assert events[-1].payload["decision"] == "approved"


async def test_third_parties_cannot_approve(
    db_session: AsyncSession,
    clock: Clock,
    setup: tuple[User, User, Workspace],
    make_user: UserFactory,
) -> None:
    _, viewer, ws = setup
    stranger = await make_user()
    approval = await _request(db_session, clock, ws)
    service = ApprovalService(db_session, clock)
    with pytest.raises(NotFound):
        await service.decide(
            approval.id,
            actor_user_id=stranger.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )
    with pytest.raises(Forbidden):
        await service.decide(
            approval.id,
            actor_user_id=viewer.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )
    db_session.expunge_all()
    assert (await db_session.get_one(ApprovalRequest, approval.id)).status == "pending"


async def test_expired_approval_cannot_be_decided_or_executed(
    db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
) -> None:
    owner, _, ws = setup
    approval = await _request(db_session, clock, ws, expires_in=timedelta(minutes=10))
    clock.advance(minutes=11)
    service = ApprovalService(db_session, clock)
    with pytest.raises(Conflict, match="expired"):
        await service.decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )
    db_session.expunge_all()
    assert (await db_session.get_one(ApprovalRequest, approval.id)).status == "expired"
    with pytest.raises(ApprovalInvalid, match="status_expired"):
        await service.consume_for_execution(approval.id, payload=PAYLOAD, version_ref="v1")


async def test_expiry_task_expires_pending_approvals(
    db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
) -> None:
    _, _, ws = setup
    approval = await _request(db_session, clock, ws, expires_in=timedelta(minutes=5))
    clock.advance(minutes=6)
    assert await ApprovalService(db_session, clock).expire_due() >= 1
    db_session.expunge_all()
    assert (await db_session.get_one(ApprovalRequest, approval.id)).status == "expired"


class TestExecutionBinding:
    async def _approved(
        self, db: AsyncSession, clock: Clock, owner: User, ws: Workspace
    ) -> ApprovalRequest:
        approval = await _request(db, clock, ws)
        return await ApprovalService(db, clock).decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.APPROVE,
            channel=DecisionChannel.IN_APP,
        )

    async def test_exact_payload_is_accepted_once(
        self, db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
    ) -> None:
        owner, _, ws = setup
        approval = await self._approved(db_session, clock, owner, ws)
        service = ApprovalService(db_session, clock)
        reordered = {"currency": "RON", "amount": Decimal("1500.00"), "client": "ACME SRL"}
        used = await service.consume_for_execution(approval.id, payload=reordered, version_ref="v1")
        assert used.consumed_at is not None
        await db_session.commit()
        with pytest.raises(ApprovalInvalid, match="already_used"):
            await service.consume_for_execution(approval.id, payload=PAYLOAD, version_ref="v1")

    async def test_changed_payload_invalidates_approval(
        self, db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
    ) -> None:
        owner, _, ws = setup
        approval = await self._approved(db_session, clock, owner, ws)
        tampered = PAYLOAD | {"amount": Decimal("15000.00")}
        with pytest.raises(ApprovalInvalid, match="payload_changed"):
            await ApprovalService(db_session, clock).consume_for_execution(
                approval.id, payload=tampered, version_ref="v1"
            )

    async def test_changed_version_invalidates_approval(
        self, db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
    ) -> None:
        owner, _, ws = setup
        approval = await self._approved(db_session, clock, owner, ws)
        with pytest.raises(ApprovalInvalid, match="version_changed"):
            await ApprovalService(db_session, clock).consume_for_execution(
                approval.id, payload=PAYLOAD, version_ref="v2"
            )

    async def test_rejected_approval_cannot_execute(
        self, db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
    ) -> None:
        owner, _, ws = setup
        approval = await _request(db_session, clock, ws)
        service = ApprovalService(db_session, clock)
        await service.decide(
            approval.id,
            actor_user_id=owner.id,
            decision=Decision.REJECT,
            channel=DecisionChannel.IN_APP,
        )
        with pytest.raises(ApprovalInvalid, match="status_rejected"):
            await service.consume_for_execution(approval.id, payload=PAYLOAD, version_ref="v1")


class TestHighRisk:
    async def test_discord_alone_cannot_approve_high_risk(
        self, db_session: AsyncSession, clock: Clock, setup: tuple[User, User, Workspace]
    ) -> None:
        owner, _, ws = setup
        approval = await _request(db_session, clock, ws, risk=RiskLevel.HIGH)
        with pytest.raises(Forbidden, match="in the Personal OS app"):
            await ApprovalService(db_session, clock).decide(
                approval.id,
                actor_user_id=owner.id,
                decision=Decision.APPROVE,
                channel=DecisionChannel.DISCORD,
            )

    async def test_high_risk_requires_fresh_mfa_in_app(
        self,
        client: httpx.AsyncClient,
        login_full: LoginFull,
        db_session: AsyncSession,
        make_user: UserFactory,
        settings: object,
    ) -> None:
        owner = await make_user()
        ws = await make_user.workspace(owner, "high-risk")
        approval = await ApprovalService(db_session).request(
            workspace_id=ws.id,
            action_type="banking.transfer",
            title="Transfer",
            payload={"amount": "100.00"},
            risk_level=RiskLevel.HIGH,
            subject_type="test",
            subject_id="1",
        )
        await db_session.commit()
        auth = await login_full(owner)
        headers = csrf_headers(client, settings)  # type: ignore[arg-type]
        url = f"/api/v1/approvals/{approval.id}/decision"

        detail = (await client.get(f"/api/v1/approvals/{approval.id}")).json()
        assert detail["requires_step_up"] is True

        missing = await client.post(url, json={"decision": "approve"}, headers=headers)
        assert missing.status_code == 403
        assert missing.json()["error"]["code"] == "step_up_required"

        valid = {totp_code(auth.totp_secret, o) for o in (-1, 0, 1)}
        wrong = next(c for c in ("111111", "222222", "333333") if c not in valid)
        bad = await client.post(
            url, json={"decision": "approve", "mfa_code": wrong}, headers=headers
        )
        assert bad.status_code == 401

        ok = await client.post(
            url,
            json={"decision": "approve", "mfa_code": totp_code(auth.totp_secret, 1)},
            headers=headers,
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["status"] == "approved"


async def test_inbox_lists_only_accessible_approvals(
    client: httpx.AsyncClient,
    login_full: LoginFull,
    db_session: AsyncSession,
    make_user: UserFactory,
    clock: Clock,
) -> None:
    me, other = await make_user(), await make_user()
    mine = await make_user.workspace(me, "mine")
    theirs = await make_user.workspace(other, "theirs")
    visible = await _request(db_session, clock, mine)
    hidden = await _request(db_session, clock, theirs)
    await login_full(me)
    ids = {a["id"] for a in (await client.get("/api/v1/approvals?status=pending")).json()}
    assert str(visible.id) in ids
    assert str(hidden.id) not in ids
    assert (await client.get(f"/api/v1/approvals/{hidden.id}")).status_code == 404
