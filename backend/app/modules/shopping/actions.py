"""Automation actions offered by the shopping module (ADR-022)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.actions import ActionContext, ActionDefinition, ActionError, ActionRisk
from app.core.errors import NotFound
from app.modules.shopping.models import ProductStatus
from app.modules.shopping.service import ShoppingService


class ApprovePurchaseParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    price: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)] | None = None


async def approve_purchase(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Records an approved decision to buy; it never buys anything (no checkout)."""
    assert isinstance(params, ApprovePurchaseParams)
    async with ctx.worker.session_factory() as db:
        service = ShoppingService(db, ctx.worker.clock)
        try:
            product = await service.get_product(ctx.workspace_id, params.product_id)
        except NotFound as exc:
            raise ActionError("Product not found in this workspace.") from exc
        if product.status == ProductStatus.APPROVED.value:
            # Idempotent across retries: the decision is already recorded.
            return {"product": product.name, "status": product.status, "already": True}
        if product.status != ProductStatus.WATCHING.value:
            raise ActionError(f"Product is {product.status}; nothing to approve.")
        await service.set_status(product, ProductStatus.APPROVED, None, params.price)
        return {
            "product": product.name,
            "status": ProductStatus.APPROVED.value,
            "price": str(params.price) if params.price is not None else None,
        }


SHOPPING_ACTIONS = (
    ActionDefinition(
        name="shopping.approve_purchase",
        title="Approve a purchase decision",
        description=(
            "Records that you decided to buy a tracked product (and at what price) and stops its "
            "alerts. It never places an order; you buy manually and mark it purchased."
        ),
        params_model=ApprovePurchaseParams,
        handler=approve_purchase,
        risk=ActionRisk.MEDIUM,
        requires_approval=True,
    ),
)
