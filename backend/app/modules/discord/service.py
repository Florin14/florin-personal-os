"""Discord interaction handling and notification delivery."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainError
from app.core.integrations import ProviderError
from app.core.tasks import PermanentJobError, RetryableJobError, WorkerContext
from app.modules.approvals.public import (
    ApprovalService,
    ApprovalStatus,
    Decision,
    DecisionChannel,
)
from app.modules.audit.public import ActorType, AuditRecorder, Outcome
from app.modules.automation.public import emergency_stop_active
from app.modules.discord.provider import DiscordClient, DiscordConfig, load_discord
from app.modules.identity.public import user_id_by_email
from app.modules.jobs.public import JobStatus, count_jobs
from app.modules.notifications.public import Notification

logger = logging.getLogger(__name__)

PING, APPLICATION_COMMAND, MESSAGE_COMPONENT = 1, 2, 3
PONG, CHANNEL_MESSAGE, UPDATE_MESSAGE = 1, 4, 7
EPHEMERAL = 1 << 6
BUTTON_SUCCESS, BUTTON_DANGER, BUTTON_LINK = 3, 4, 5


def ephemeral(text: str) -> dict[str, Any]:
    return {
        "type": CHANNEL_MESSAGE,
        "data": {"content": text[:1900], "flags": EPHEMERAL, "allowed_mentions": {"parse": []}},
    }


def approval_buttons(approval_id: str) -> list[dict[str, Any]]:
    return [
        {
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "style": BUTTON_SUCCESS,
                    "label": "Approve",
                    "custom_id": f"approval:approve:{approval_id}",
                },
                {
                    "type": 2,
                    "style": BUTTON_DANGER,
                    "label": "Reject",
                    "custom_id": f"approval:reject:{approval_id}",
                },
            ],
        }
    ]


def _actor(interaction: dict[str, Any]) -> str | None:
    """``member.user`` in guilds, ``user`` in DMs."""
    member = interaction.get("member")
    user = member.get("user") if isinstance(member, dict) else interaction.get("user")
    return str(user["id"]) if isinstance(user, dict) and "id" in user else None


class InteractionHandler:
    def __init__(self, session: AsyncSession, config: DiscordConfig, app_url: str | None) -> None:
        self._db = session
        self._config = config
        self._app_url = app_url

    async def handle(self, interaction: dict[str, Any]) -> dict[str, Any]:
        kind = interaction.get("type")
        if kind == PING:
            return {"type": PONG}
        discord_user = _actor(interaction)
        channel_id = interaction.get("channel_id")
        email = self._config.email_for(discord_user)
        user_id = await user_id_by_email(self._db, email) if email else None
        if user_id is None or not self._config.channel_allowed(
            str(channel_id) if channel_id else None
        ):
            AuditRecorder(self._db).record(
                "discord.interaction_denied",
                outcome=Outcome.DENIED,
                actor_type=ActorType.DISCORD,
                details={"discord_user_id": discord_user or "", "channel_id": str(channel_id)},
            )
            await self._db.commit()
            return ephemeral("You are not allowed to use this bot here.")

        data = interaction.get("data") or {}
        if kind == APPLICATION_COMMAND:
            return await self._command(str(data.get("name", "")), user_id)
        if kind == MESSAGE_COMPONENT:
            return await self._component(str(data.get("custom_id", "")), user_id)
        return ephemeral("Unsupported interaction.")

    async def _command(self, name: str, user_id: uuid.UUID) -> dict[str, Any]:
        approvals = ApprovalService(self._db)
        pending = await approvals.list_for_user(user_id, status=ApprovalStatus.PENDING, limit=10)
        if name == "status":
            stats = await _system_status(self._db)
            return ephemeral(
                f"Pending approvals: {len(pending)}\n"
                f"Failed background jobs: {stats['failed_jobs']}\n"
                f"Emergency stop: {'ACTIVE' if stats['emergency_stop'] else 'off'}"
            )
        if name == "approvals":
            if not pending:
                return ephemeral("Nothing is waiting for your approval.")
            lines = [self._describe(a.action_type, a.title, a.risk_level, a.id) for a in pending]
            return ephemeral("\n".join(lines))
        return ephemeral("Unknown command.")

    def _describe(self, action_type: str, title: str, risk: str, approval_id: uuid.UUID) -> str:
        label = title if self._config.include_titles else action_type
        link = f" — {self._app_url}/approvals/{approval_id}" if self._app_url else ""
        return f"• [{risk}] {label}{link}"

    async def _component(self, custom_id: str, user_id: uuid.UUID) -> dict[str, Any]:
        parts = custom_id.split(":")
        if len(parts) != 3 or parts[0] != "approval" or parts[1] not in ("approve", "reject"):
            return ephemeral("Unknown button.")
        try:
            approval_id = uuid.UUID(parts[2])
        except ValueError:
            return ephemeral("Unknown approval.")
        decision = Decision.APPROVE if parts[1] == "approve" else Decision.REJECT
        try:
            approval = await ApprovalService(self._db).decide(
                approval_id,
                actor_user_id=user_id,
                decision=decision,
                channel=DecisionChannel.DISCORD,
            )
        except DomainError as exc:
            # e.g. high-risk approvals must be confirmed in the app with fresh MFA.
            hint = f" Open {self._app_url}/approvals/{approval_id}" if self._app_url else ""
            return ephemeral(f"{exc.message}{hint}")
        verb = "Approved" if approval.status == ApprovalStatus.APPROVED.value else "Rejected"
        return {
            "type": UPDATE_MESSAGE,
            "data": {
                "content": f"{verb} via Discord ({approval.action_type}).",
                "components": [],
                "allowed_mentions": {"parse": []},
            },
        }


async def _system_status(db: AsyncSession) -> dict[str, Any]:
    return {
        "failed_jobs": await count_jobs(db, JobStatus.FAILED),
        "emergency_stop": await emergency_stop_active(db),
    }


class DiscordChannelAdapter:
    """Delivers notifications to the configured Discord channel (ADR-016)."""

    def __init__(self, worker: WorkerContext, app_url: str | None) -> None:
        self._worker = worker
        self._app_url = app_url

    async def send(self, notification: Notification) -> None:
        async with self._worker.session_factory() as db:
            try:
                loaded = await load_discord(db, self._worker.secret_box)
            except ProviderError as exc:
                raise PermanentJobError(exc.message) from exc
        config = loaded.config
        title = notification.title if config.include_titles else _generic_title(notification)
        message: dict[str, Any] = {
            "content": title[:1900],
            "allowed_mentions": {"parse": []},
            # Discord deduplicates messages with the same nonce (redelivery safety).
            "nonce": notification.id.hex[:25],
            "enforce_nonce": True,
        }
        approval_id = _approval_id_from_link(notification.link)
        if notification.category == "approval" and approval_id:
            message["components"] = approval_buttons(approval_id)
        elif notification.link and self._app_url:
            message["content"] += f"\n{self._app_url}{notification.link}"
        try:
            await DiscordClient(loaded.secrets.bot_token.get_secret_value()).send_message(
                config.notification_channel_id, message
            )
        except ProviderError as exc:
            if exc.retryable:
                raise RetryableJobError(exc.message) from exc
            raise PermanentJobError(exc.message) from exc


def _generic_title(notification: Notification) -> str:
    labels = {
        "approval": "An approval is waiting in Personal OS.",
        "execution": "An automation needs attention in Personal OS.",
    }
    return labels.get(notification.category, "New Personal OS notification.")


def _approval_id_from_link(link: str | None) -> str | None:
    if link and link.startswith("/approvals/"):
        candidate = link.removeprefix("/approvals/")
        try:
            return str(uuid.UUID(candidate))
        except ValueError:
            return None
    return None
