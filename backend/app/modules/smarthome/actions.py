"""Approval-gated automation controls with durable, non-replayed command intents."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.actions import ActionContext, ActionDefinition, ActionError, ActionRisk
from app.core.errors import DomainError
from app.modules.smarthome.service import SmartHomeService


class HomeServiceParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: uuid.UUID
    service: str = Field(min_length=1, max_length=60, pattern=r"^[a-z_]+$")
    data: dict[str, Any] = Field(default_factory=dict, max_length=4)


async def call_service(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, HomeServiceParams)
    async with ctx.worker.session_factory() as db:
        try:
            command = await SmartHomeService(db, ctx.worker.secret_box, ctx.worker.clock).command(
                ctx.workspace_id,
                params.device_id,
                service=params.service,
                data=params.data,
                idempotency_key=ctx.idempotency_key,
                source="automation",
            )
        except DomainError as exc:
            raise ActionError(str(exc)) from exc
        if command.status != "succeeded":
            raise ActionError(command.message or "Command outcome is pending; verify the device.")
        return {
            "command_id": str(command.id),
            "entity_id": command.entity_id,
            "status": command.status,
        }


SMARTHOME_ACTIONS = (
    ActionDefinition(
        name="smarthome.call_service",
        title="Control a Home Assistant device",
        description=(
            "Approval-gated command to an opted-in device. Respects cooldowns and overrides. "
            "Sensitive services are manual-only; uncertain outcomes are never replayed."
        ),
        params_model=HomeServiceParams,
        handler=call_service,
        risk=ActionRisk.MEDIUM,
        requires_approval=True,
    ),
)
