"""Automation actions offered by the banking module."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from app.core.actions import ActionContext, ActionDefinition, ActionRisk
from app.modules.banking.service import BankingService


class ReconcileParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def reconcile(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Re-scores open bank transactions against documents, expenses and invoices."""
    assert isinstance(params, ReconcileParams)
    async with ctx.worker.session_factory() as db:
        result = await BankingService(db, ctx.worker.clock).reconcile(ctx.workspace_id)
    return {
        "processed": result.processed,
        "auto_matched": result.auto_matched,
        "suggested": result.suggested,
    }


BANKING_ACTIONS = (
    ActionDefinition(
        name="banking.reconcile",
        title="Reconcile bank transactions",
        description=(
            "Matches open bank transactions to documents, expenses and issued invoices; only "
            "unambiguous exact matches are confirmed automatically, the rest wait for review."
        ),
        params_model=ReconcileParams,
        handler=reconcile,
        # Writes match records (internal, reversible): dry runs plan instead of writing.
        side_effecting=True,
        risk=ActionRisk.LOW,
    ),
)
