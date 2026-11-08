"""Typed workflow actions for invoicing."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.actions import ActionContext, ActionDefinition, ActionError, ActionRisk
from app.modules.invoicing.models import InvoiceProfile
from app.modules.invoicing.service import (
    IssueRequest,
    build_draft,
    default_period,
    issue_invoice,
    local_today,
    send_einvoice,
)

PERIOD = r"^\d{4}-\d{2}$"


class PrepareParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: uuid.UUID
    # Defaults to the profile's billing period relative to today (profile timezone).
    period: str | None = Field(default=None, pattern=PERIOD)


async def prepare(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, PrepareParams)
    async with ctx.worker.session_factory() as db:
        profile = await db.scalar(
            select(InvoiceProfile).where(
                InvoiceProfile.id == params.profile_id,
                InvoiceProfile.workspace_id == ctx.workspace_id,
            )
        )
        if profile is None:
            raise ActionError("Invoice profile not found in this workspace.")
        today = local_today(profile, ctx.worker.clock())
        draft = build_draft(profile, params.period or default_period(profile, today), today)
    return draft.as_output()


class IssueParams(BaseModel):
    """The approved values; issuance fails if the profile no longer matches them."""

    model_config = ConfigDict(extra="forbid")

    profile_id: uuid.UUID
    period: str = Field(pattern=PERIOD)
    client_name: str = Field(min_length=1, max_length=200)
    net_amount: str = Field(pattern=r"^\d+(\.\d+)?$")
    currency: str = Field(pattern=r"^[A-Z]{3}$")


async def issue(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, IssueParams)
    return await issue_invoice(
        ctx.worker,
        IssueRequest(
            workspace_id=ctx.workspace_id,
            profile_id=params.profile_id,
            period=params.period,
            expected_net_amount=params.net_amount,
            expected_currency=params.currency,
            expected_client_name=params.client_name,
            execution_id=ctx.execution_id,
        ),
    )


async def plan_issue(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Dry run: no provider call; placeholder ids keep later steps renderable."""
    assert isinstance(params, IssueParams)
    return {
        "dry_run": True,
        "would_execute": params.model_dump(mode="json"),
        "invoice_id": str(uuid.UUID(int=0)),
        "series_name": "(dry-run)",
        "number": "0000",
    }


class EinvoiceParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_id: uuid.UUID


async def submit_einvoice(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    assert isinstance(params, EinvoiceParams)
    return await send_einvoice(ctx.worker, ctx.workspace_id, params.invoice_id)


INVOICING_ACTIONS = (
    ActionDefinition(
        name="invoicing.prepare_monthly_invoice",
        title="Prepare monthly invoice",
        description="Computes the invoice draft (period, client, amount) from an invoice profile.",
        params_model=PrepareParams,
        handler=prepare,
        side_effecting=False,
    ),
    ActionDefinition(
        name="invoicing.issue_invoice",
        title="Issue invoice in Oblio",
        description="Issues the fiscal invoice for a profile and period exactly once.",
        params_model=IssueParams,
        handler=issue,
        plan=plan_issue,
        side_effecting=True,
        risk=ActionRisk.HIGH,
        requires_approval=True,
    ),
    ActionDefinition(
        name="invoicing.send_einvoice",
        title="Send invoice to SPV (e-Factura)",
        description="Submits an issued invoice to ANAF SPV through Oblio.",
        params_model=EinvoiceParams,
        handler=submit_einvoice,
        side_effecting=True,
        risk=ActionRisk.MEDIUM,
    ),
)


def monthly_invoice_template(profile_id: str, timezone: str) -> dict[str, Any]:
    """Recommended workflow: prepare -> approval-gated issue -> SPV -> notify."""
    return {
        "triggers": [
            {"type": "cron", "key": "monthly", "expression": "0 9 1 * *", "timezone": timezone},
            {"type": "manual"},
        ],
        "steps": [
            {
                "key": "draft",
                "type": "action",
                "action": "invoicing.prepare_monthly_invoice",
                "params": {"profile_id": profile_id},
            },
            {
                "key": "issue",
                "type": "action",
                "action": "invoicing.issue_invoice",
                "params": {
                    "profile_id": profile_id,
                    "period": "{{ steps.draft.period }}",
                    "client_name": "{{ steps.draft.client_name }}",
                    "net_amount": "{{ steps.draft.net_amount }}",
                    "currency": "{{ steps.draft.currency }}",
                },
                "approval": {
                    "risk_level": "high",
                    "title": (
                        "Issue invoice {{ steps.draft.period }} for {{ steps.draft.client_name }}"
                    ),
                    "summary": (
                        "{{ steps.draft.description }}: {{ steps.draft.net_amount }} "
                        "{{ steps.draft.currency }} (net), due {{ steps.draft.due_date }}"
                    ),
                    "expires_in_minutes": 4320,
                },
            },
            {
                "key": "spv",
                "type": "action",
                "action": "invoicing.send_einvoice",
                "params": {"invoice_id": "{{ steps.issue.invoice_id }}"},
            },
            {
                "key": "done",
                "type": "notify",
                "message_title": (
                    "Invoice {{ steps.issue.series_name }} {{ steps.issue.number }} issued"
                ),
                "message_body": "SPV: {{ steps.spv.text }}",
                "severity": "success",
            },
        ],
    }
