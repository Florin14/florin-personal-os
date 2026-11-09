"""Shopping & price tracking endpoints (workspace scoped)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.shopping.identity import clean_url
from app.modules.shopping.models import (
    Merchant,
    PriceAlert,
    PriceObservation,
    Product,
    ProductStatus,
)
from app.modules.shopping.service import ListingView, ShoppingService
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/shopping",
    tags=["shopping"],
    responses=ERROR_RESPONSES,
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]

Price = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
StatusName = Literal["watching", "approved", "purchased", "archived"]
AlertKindName = Literal["below_target", "price_drop", "back_in_stock"]

# Display-only links: http(s), no credentials; never fetched by the server (ADR-022).
Link = Annotated[str | None, Field(max_length=500), AfterValidator(clean_url)]


# ------------------------------------------------------------------- schemas


class MerchantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    website: Link = None


class MerchantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    website: str | None


class ProductIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    brand: str = Field(default="", max_length=100)
    model: str = Field(default="", max_length=100)
    gtin: str | None = Field(default=None, max_length=14)
    category: str = Field(default="", max_length=50)
    target_price: Price | None = None
    currency: Currency = "RON"
    drop_alert_percent: Annotated[Decimal, Field(gt=0, le=90, decimal_places=2)] = Decimal("5")
    notes: str = Field(default="", max_length=4000)

    @field_validator("gtin")
    @classmethod
    def _gtin(cls, value: str | None) -> str | None:
        compact = (value or "").replace(" ", "").replace("-", "")
        return compact or None


class ObservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_id: uuid.UUID
    price: Decimal
    currency: str
    in_stock: bool | None
    observed_at: datetime
    source: str
    note: str


class BestOfferOut(BaseModel):
    listing_id: uuid.UUID
    merchant: str
    price: Decimal
    currency: str
    in_stock: bool | None
    observed_at: datetime


class ProductOut(BaseModel):
    id: uuid.UUID
    name: str
    brand: str
    model: str
    gtin: str | None
    category: str
    target_price: Decimal | None
    currency: str
    drop_alert_percent: Decimal
    status: StatusName
    decided_price: Decimal | None
    decided_at: datetime | None
    purchased_at: datetime | None
    notes: str
    created_at: datetime
    best: BestOfferOut | None = None
    listing_count: int = 0
    open_alerts: int = 0


class ListingOut(BaseModel):
    id: uuid.UUID
    merchant: MerchantOut
    url: str | None
    source: str
    latest: ObservationOut | None
    lowest_price: Decimal | None


class AlertOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    kind: AlertKindName
    price: Decimal
    previous_price: Decimal | None
    currency: str
    status: Literal["open", "dismissed"]
    created_at: datetime


class ProductDetailOut(BaseModel):
    product: ProductOut
    listings: list[ListingOut]
    history: list[ObservationOut]
    alerts: list[AlertOut]


class ListingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchant_id: uuid.UUID
    url: Link = None


class ListingUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: Link = None


class ObservationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: Price
    currency: Currency | None = None  # defaults to the product currency
    in_stock: bool | None = None
    observed_at: AwareDatetime | None = None
    note: str = Field(default="", max_length=300)


class RecordedOut(BaseModel):
    observation: ObservationOut
    alerts: list[AlertOut]


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusName
    price: Price | None = None


# ------------------------------------------------------------------- mapping


def _product(
    p: Product, best: ListingView | None = None, listings: int = 0, alerts: int = 0
) -> ProductOut:
    return ProductOut(
        id=p.id,
        name=p.name,
        brand=p.brand,
        model=p.model,
        gtin=p.gtin,
        category=p.category,
        target_price=p.target_price,
        currency=p.currency,
        drop_alert_percent=p.drop_alert_percent,
        status=p.status,
        decided_price=p.decided_price,
        decided_at=p.decided_at,
        purchased_at=p.purchased_at,
        notes=p.notes,
        created_at=p.created_at,
        best=(
            BestOfferOut(
                listing_id=best.listing.id,
                merchant=best.merchant.name,
                price=best.latest.price,
                currency=best.latest.currency,
                in_stock=best.latest.in_stock,
                observed_at=best.latest.observed_at,
            )
            if best and best.latest
            else None
        ),
        listing_count=listings,
        open_alerts=alerts,
    )


def _alert(a: PriceAlert, product_name: str) -> AlertOut:
    return AlertOut(
        id=a.id,
        product_id=a.product_id,
        product_name=product_name,
        kind=a.kind,
        price=a.price,
        previous_price=a.previous_price,
        currency=a.currency,
        status=a.status,
        created_at=a.created_at,
    )


def _observation(o: PriceObservation) -> ObservationOut:
    return ObservationOut.model_validate(o)


def _merchant(m: Merchant) -> MerchantOut:
    return MerchantOut.model_validate(m)


# ----------------------------------------------------------------- merchants


@router.get("/merchants", response_model=list[MerchantOut])
async def list_merchants(access: Viewer, db: DbSession) -> list[MerchantOut]:
    return [_merchant(m) for m in await ShoppingService(db).list_merchants(access.workspace_id)]


@router.post("/merchants", response_model=MerchantOut, status_code=status.HTTP_201_CREATED)
async def create_merchant(
    body: MerchantIn, access: Member, ctx: CurrentUser, db: DbSession
) -> MerchantOut:
    merchant = await ShoppingService(db).save_merchant(
        access.workspace_id, body.name, body.website, ctx.user.id
    )
    return _merchant(merchant)


@router.put("/merchants/{merchant_id}", response_model=MerchantOut)
async def update_merchant(
    merchant_id: uuid.UUID, body: MerchantIn, access: Member, ctx: CurrentUser, db: DbSession
) -> MerchantOut:
    service = ShoppingService(db)
    merchant = await service.get_merchant(access.workspace_id, merchant_id)
    return _merchant(
        await service.save_merchant(
            access.workspace_id, body.name, body.website, ctx.user.id, merchant
        )
    )


@router.delete("/merchants/{merchant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_merchant(
    merchant_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    service = ShoppingService(db)
    await service.delete_merchant(
        await service.get_merchant(access.workspace_id, merchant_id), ctx.user.id
    )


# ------------------------------------------------------------------ products


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    access: Viewer,
    db: DbSession,
    status_filter: Annotated[StatusName | None, Query(alias="status")] = None,
) -> list[ProductOut]:
    summaries = await ShoppingService(db).summaries(access.workspace_id, status_filter)
    return [_product(s.product, s.best, s.listing_count, s.open_alerts) for s in summaries]


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ProductOut:
    product = await ShoppingService(db).save_product(
        access.workspace_id, body.model_dump(), ctx.user.id
    )
    return _product(product)


@router.get("/products/{product_id}", response_model=ProductDetailOut)
async def product_detail(product_id: uuid.UUID, access: Viewer, db: DbSession) -> ProductDetailOut:
    service = ShoppingService(db)
    product = await service.get_product(access.workspace_id, product_id)
    views, history, alerts = await service.detail(product)
    best = next((v for v in views if v.latest and v.latest.currency == product.currency), None)
    return ProductDetailOut(
        product=_product(product, best, len(views), sum(1 for a in alerts if a.status == "open")),
        listings=[
            ListingOut(
                id=v.listing.id,
                merchant=_merchant(v.merchant),
                url=v.listing.url,
                source=v.listing.source,
                latest=_observation(v.latest) if v.latest else None,
                lowest_price=v.lowest,
            )
            for v in views
        ],
        history=[_observation(o) for o in history],
        alerts=[_alert(a, product.name) for a in alerts],
    )


@router.put("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: uuid.UUID, body: ProductIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ProductOut:
    service = ShoppingService(db)
    product = await service.get_product(access.workspace_id, product_id)
    return _product(
        await service.save_product(access.workspace_id, body.model_dump(), ctx.user.id, product)
    )


@router.put("/products/{product_id}/status", response_model=ProductOut)
async def set_product_status(
    product_id: uuid.UUID, body: StatusIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ProductOut:
    """Record a purchase decision or a purchase made elsewhere (no checkout happens here)."""
    service = ShoppingService(db)
    product = await service.get_product(access.workspace_id, product_id)
    return _product(
        await service.set_status(product, ProductStatus(body.status), ctx.user.id, body.price)
    )


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    service = ShoppingService(db)
    await service.delete_product(
        await service.get_product(access.workspace_id, product_id), ctx.user.id
    )


# ------------------------------------------------------------------ listings


@router.post(
    "/products/{product_id}/listings",
    response_model=ListingOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_listing(
    product_id: uuid.UUID, body: ListingIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ListingOut:
    service = ShoppingService(db)
    product = await service.get_product(access.workspace_id, product_id)
    listing = await service.add_listing(product, body.merchant_id, body.url, ctx.user.id)
    merchant = await service.get_merchant(access.workspace_id, listing.merchant_id)
    return ListingOut(
        id=listing.id,
        merchant=_merchant(merchant),
        url=listing.url,
        source=listing.source,
        latest=None,
        lowest_price=None,
    )


@router.put("/listings/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def update_listing(
    listing_id: uuid.UUID, body: ListingUpdateIn, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    service = ShoppingService(db)
    await service.update_listing(
        await service.get_listing(access.workspace_id, listing_id), body.url, ctx.user.id
    )


@router.delete("/listings/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_listing(
    listing_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    service = ShoppingService(db)
    await service.delete_listing(
        await service.get_listing(access.workspace_id, listing_id), ctx.user.id
    )


@router.post(
    "/listings/{listing_id}/observations",
    response_model=RecordedOut,
    status_code=status.HTTP_201_CREATED,
)
async def record_price(
    listing_id: uuid.UUID, body: ObservationIn, access: Member, ctx: CurrentUser, db: DbSession
) -> RecordedOut:
    """Records a price seen by the user; returns any alerts it triggered."""
    service = ShoppingService(db)
    listing = await service.get_listing(access.workspace_id, listing_id)
    product = await service.get_product(access.workspace_id, listing.product_id)
    observation, alerts = await service.record_observation(
        listing,
        price=body.price,
        currency=body.currency or product.currency,
        in_stock=body.in_stock,
        observed_at=body.observed_at,
        note=body.note,
        actor_user_id=ctx.user.id,
    )
    return RecordedOut(
        observation=_observation(observation), alerts=[_alert(a, product.name) for a in alerts]
    )


@router.delete("/observations/{observation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_observation(
    observation_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    await ShoppingService(db).delete_observation(access.workspace_id, observation_id, ctx.user.id)


# -------------------------------------------------------------------- alerts


@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(
    access: Viewer,
    db: DbSession,
    status_filter: Annotated[Literal["open", "dismissed"] | None, Query(alias="status")] = "open",
) -> list[AlertOut]:
    rows = await ShoppingService(db).list_alerts(access.workspace_id, status_filter)
    return [_alert(alert, product.name) for alert, product in rows]


@router.post("/alerts/{alert_id}/dismiss", response_model=AlertOut)
async def dismiss_alert(
    alert_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> AlertOut:
    service = ShoppingService(db)
    alert = await service.dismiss_alert(access.workspace_id, alert_id, ctx.user.id)
    product = await service.get_product(access.workspace_id, alert.product_id)
    return _alert(alert, product.name)
