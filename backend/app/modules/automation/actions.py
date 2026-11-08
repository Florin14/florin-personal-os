"""Built-in, side-effect-free actions available to every workflow."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.actions import ActionContext, ActionDefinition, ActionRisk

logger = logging.getLogger(__name__)


class LogParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=1000)


async def log_message(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, LogParams)
    logger.info(
        "workflow_log",
        extra={
            "execution_id": str(ctx.execution_id),
            "step": ctx.step_key,
            "msg_text": params.message,
        },
    )
    return {"logged": params.message}


class SetValuesParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(default_factory=dict)


async def set_values(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Expose computed/rendered values to later steps as ``steps.<key>.values``."""
    assert isinstance(params, SetValuesParams)
    return {"values": params.values}


BUILTIN_ACTIONS = (
    ActionDefinition(
        name="core.log",
        title="Write to execution log",
        description="Records a message in the execution history.",
        params_model=LogParams,
        handler=log_message,
        side_effecting=False,
        risk=ActionRisk.LOW,
    ),
    ActionDefinition(
        name="core.set_values",
        title="Set values",
        description="Stores values (templates allowed) for use by later steps.",
        params_model=SetValuesParams,
        handler=set_values,
        side_effecting=False,
        risk=ActionRisk.LOW,
    ),
)
