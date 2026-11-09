"""Shopping & price tracking application service (ADR-022)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.modules.audit.public import AuditRecorder
from app.modules.events.public import EventPublisher
from app.modules.notifications.public import NotificationService, Severity
from app.modules.shopping.identity import identity_key, model_key, normalize, valid_gtin
from app.modules.shopping.models import (
    AlertKind,
    AlertStatus,
    Listing,
    Merchant,
    PriceAlert,
    PriceObservation,
    Product,
    ProductStatus,
)

EVENT_PRICE_ALERT = "shopping.price_alert"
HUNDRED = Decimal(100)

ALERT_TITLES = {
    AlertKind.BELOW_TARGET: "Price below your target",
    AlertKind.PRICE_DROP: "Price drop",
    AlertKind.BACK_IN_STOCK: "Back in stock",
}


@dataclass(frozen=True, slots=True)
class ListingView:
    listing: Listing
    merchant: Merchant
    latest: PriceObservation | None
    lowest: Decimal | None


@dataclass(frozen=True, slots=True)
class ProductSummary:
    product: Product
    best: ListingView | None
    listing_count: int
    open_alerts: int


class ShoppingService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    def _audit(
        self,
        action: str,
        workspace_id: uuid.UUID,
        target: str,
        target_id: uuid.UUID,
        actor_user_id: uuid.UUID | None,
        details: dict[str, Any] | None = None,
    ) -> None:
        AuditRecorder(self._db).record(
            action,
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type=target,
            target_id=target_id,
            details=details,
        )

    async def _commit_unique(self, message: str) -> None:
        try:
            await self._db.commit()
        except IntegrityError as exc:
            await self._db.rollback()
            raise Conflict(message) from exc

    # ----------------------------------------------------------------- merchants

    async def list_merchants(self, workspace_id: uuid.UUID) -> list[Merchant]:
        return list(
            await self._db.scalars(
                select(Merchant)
                .where(Merchant.workspace_id == workspace_id)
                .order_by(Merchant.name)
            )
        )

    async def get_merchant(self, workspace_id: uuid.UUID, merchant_id: uuid.UUID) -> Merchant:
        merchant = await self._db.scalar(
            select(Merchant).where(
                Merchant.id == merchant_id, Merchant.workspace_id == workspace_id
            )
        )
        if merchant is None:
            raise NotFound("Merchant not found.")
        return merchant

    async def save_merchant(
        self,
        workspace_id: uuid.UUID,
        name: str,
        website: str | None,
        actor_user_id: uuid.UUID,
        merchant: Merchant | None = None,
    ) -> Merchant:
        if not normalize(name):
            raise ValidationFailed("Merchant name must contain letters or digits.")
        if merchant is None:
            merchant = Merchant(id=uuid.uuid4(), workspace_id=workspace_id)
            self._db.add(merchant)
        merchant.name = name.strip()
        merchant.name_key = normalize(name)[:100]
        merchant.website = website
        self._audit("shopping.merchant_saved", workspace_id, "merchant", merchant.id, actor_user_id)
        await self._commit_unique("A merchant with this name already exists.")
        return merchant

    async def delete_merchant(self, merchant: Merchant, actor_user_id: uuid.UUID) -> None:
        used = await self._db.scalar(
            select(Listing.id).where(Listing.merchant_id == merchant.id).limit(1)
        )
        if used is not None:
            raise Conflict("Remove this merchant's listings first.")
        self._audit(
            "shopping.merchant_deleted",
            merchant.workspace_id,
            "merchant",
            merchant.id,
            actor_user_id,
        )
        await self._db.delete(merchant)
        await self._db.commit()

    # ------------------------------------------------------------------ products

    async def get_product(self, workspace_id: uuid.UUID, product_id: uuid.UUID) -> Product:
        product = await self._db.scalar(
            select(Product).where(Product.id == product_id, Product.workspace_id == workspace_id)
        )
        if product is None:
            raise NotFound("Product not found.")
        return product

    async def save_product(
        self,
        workspace_id: uuid.UUID,
        data: dict[str, Any],
        actor_user_id: uuid.UUID,
        product: Product | None = None,
    ) -> Product:
        gtin = data.get("gtin") or None
        if gtin is not None and not valid_gtin(gtin):
            raise ValidationFailed("The GTIN/EAN check digit is not valid.")
        if product is None:
            product = Product(
                id=uuid.uuid4(), workspace_id=workspace_id, created_by_user_id=actor_user_id
            )
            self._db.add(product)
        for key in (
            "name",
            "brand",
            "model",
            "category",
            "target_price",
            "currency",
            "drop_alert_percent",
            "notes",
        ):
            if key in data:
                setattr(product, key, data[key])
        product.gtin = gtin
        product.identity_key = identity_key(product.name, product.brand, product.model, gtin)
        product.model_key = model_key(product.brand, product.model)
        self._audit("shopping.product_saved", workspace_id, "product", product.id, actor_user_id)
        await self._commit_unique(
            "This product is already tracked (same GTIN, brand and model, or name)."
        )
        return product

    async def delete_product(self, product: Product, actor_user_id: uuid.UUID) -> None:
        self._audit(
            "shopping.product_deleted",
            product.workspace_id,
            "product",
            product.id,
            actor_user_id,
            {"name": product.name},
        )
        await self._db.delete(product)
        await self._db.commit()

    async def set_status(
        self,
        product: Product,
        status: ProductStatus,
        actor_user_id: uuid.UUID | None,
        price: Decimal | None = None,
    ) -> Product:
        """watching / approved (decision to buy) / purchased / archived. No checkout, ever."""
        now = self._now()
        product.status = status.value
        if status in (ProductStatus.APPROVED, ProductStatus.PURCHASED):
            product.decided_at = product.decided_at or now
            if price is not None:
                product.decided_price = price
        if status is ProductStatus.PURCHASED:
            product.purchased_at = now
        if status is ProductStatus.WATCHING:
            product.decided_at = product.purchased_at = product.decided_price = None
        if status is not ProductStatus.WATCHING:
            # Decided or shelved products stop alerting; close what is still open.
            for alert in await self._db.scalars(
                select(PriceAlert).where(
                    PriceAlert.product_id == product.id,
                    PriceAlert.status == AlertStatus.OPEN.value,
                )
            ):
                alert.status = AlertStatus.DISMISSED.value
        self._audit(
            f"shopping.product_{status.value}",
            product.workspace_id,
            "product",
            product.id,
            actor_user_id,
            {"price": str(price) if price is not None else None},
        )
        await self._db.commit()
        return product

    async def summaries(
        self, workspace_id: uuid.UUID, status: str | None = None
    ) -> list[ProductSummary]:
        stmt = select(Product).where(Product.workspace_id == workspace_id)
        if status:
            stmt = stmt.where(Product.status == status)
        products = list(await self._db.scalars(stmt.order_by(Product.name)))
        views = await self._listing_views([p.id for p in products])
        alerts = dict(
            (
                await self._db.execute(
                    select(PriceAlert.product_id, func.count())
                    .where(
                        PriceAlert.workspace_id == workspace_id,
                        PriceAlert.status == AlertStatus.OPEN.value,
                    )
                    .group_by(PriceAlert.product_id)
                )
            ).all()
        )
        result = []
        for product in products:
            mine = views.get(product.id, [])
            priced = [v for v in mine if v.latest and v.latest.currency == product.currency]
            best = min(
                priced, key=lambda v: v.latest.price if v.latest else Decimal(0), default=None
            )
            result.append(ProductSummary(product, best, len(mine), int(alerts.get(product.id, 0))))
        return result

    async def _listing_views(
        self, product_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[ListingView]]:
        if not product_ids:
            return {}
        rows = (
            await self._db.execute(
                select(Listing, Merchant)
                .join(Merchant, Merchant.id == Listing.merchant_id)
                .where(Listing.product_id.in_(list(product_ids)))
            )
        ).all()
        listing_ids = [listing.id for listing, _ in rows]
        latest: dict[uuid.UUID, PriceObservation] = {}
        lowest: dict[uuid.UUID, Decimal] = {}
        if listing_ids:
            for obs in await self._db.scalars(
                select(PriceObservation)
                .where(PriceObservation.listing_id.in_(listing_ids))
                .distinct(PriceObservation.listing_id)
                .order_by(PriceObservation.listing_id, PriceObservation.observed_at.desc())
            ):
                latest[obs.listing_id] = obs
            for listing_id, low in (
                await self._db.execute(
                    select(PriceObservation.listing_id, func.min(PriceObservation.price))
                    .where(PriceObservation.listing_id.in_(listing_ids))
                    .group_by(PriceObservation.listing_id)
                )
            ).all():
                lowest[listing_id] = low
        views: dict[uuid.UUID, list[ListingView]] = defaultdict(list)
        for listing, merchant in rows:
            views[listing.product_id].append(
                ListingView(listing, merchant, latest.get(listing.id), lowest.get(listing.id))
            )
        for product_views in views.values():
            # Merchant comparison order: in stock first, then cheapest latest price.
            product_views.sort(
                key=lambda v: (
                    v.latest is None,
                    v.latest is not None and v.latest.in_stock is False,
                    v.latest.price if v.latest else Decimal(0),
                    v.merchant.name,
                )
            )
        return dict(views)

    async def detail(
        self, product: Product
    ) -> tuple[list[ListingView], list[PriceObservation], list[PriceAlert]]:
        views = (await self._listing_views([product.id])).get(product.id, [])
        history = (
            list(
                await self._db.scalars(
                    select(PriceObservation)
                    .where(PriceObservation.listing_id.in_([v.listing.id for v in views]))
                    .order_by(PriceObservation.observed_at)
                    .limit(2000)
                )
            )
            if views
            else []
        )
        alerts = list(
            await self._db.scalars(
                select(PriceAlert)
                .where(PriceAlert.product_id == product.id)
                .order_by(PriceAlert.created_at.desc())
                .limit(50)
            )
        )
        return views, history, alerts

    # ------------------------------------------------------------------ listings

    async def get_listing(self, workspace_id: uuid.UUID, listing_id: uuid.UUID) -> Listing:
        listing = await self._db.scalar(
            select(Listing).where(Listing.id == listing_id, Listing.workspace_id == workspace_id)
        )
        if listing is None:
            raise NotFound("Listing not found.")
        return listing

    async def add_listing(
        self,
        product: Product,
        merchant_id: uuid.UUID,
        url: str | None,
        actor_user_id: uuid.UUID,
    ) -> Listing:
        merchant = await self.get_merchant(product.workspace_id, merchant_id)  # ownership check
        listing = Listing(
            id=uuid.uuid4(),
            workspace_id=product.workspace_id,
            product_id=product.id,
            merchant_id=merchant.id,
            url=url,
            source="manual",
        )
        self._db.add(listing)
        self._audit(
            "shopping.listing_added", product.workspace_id, "listing", listing.id, actor_user_id
        )
        await self._commit_unique(f"{merchant.name} is already listed for this product.")
        return listing

    async def update_listing(
        self, listing: Listing, url: str | None, actor_user_id: uuid.UUID
    ) -> Listing:
        listing.url = url
        self._audit(
            "shopping.listing_updated", listing.workspace_id, "listing", listing.id, actor_user_id
        )
        await self._db.commit()
        return listing

    async def delete_listing(self, listing: Listing, actor_user_id: uuid.UUID) -> None:
        self._audit(
            "shopping.listing_deleted", listing.workspace_id, "listing", listing.id, actor_user_id
        )
        await self._db.delete(listing)
        await self._db.commit()

    # -------------------------------------------------------------- observations

    async def record_observation(
        self,
        listing: Listing,
        *,
        price: Decimal,
        currency: str,
        in_stock: bool | None,
        observed_at: datetime | None,
        note: str,
        actor_user_id: uuid.UUID | None,
        source: str = "manual",
    ) -> tuple[PriceObservation, list[PriceAlert]]:
        now = self._now()
        when = observed_at or now
        if when > now:
            raise ValidationFailed("Observations cannot be in the future.")
        product = await self.get_product(listing.workspace_id, listing.product_id)
        previous = await self._db.scalar(
            select(PriceObservation)
            .where(PriceObservation.listing_id == listing.id, PriceObservation.observed_at <= when)
            .order_by(PriceObservation.observed_at.desc())
            .limit(1)
        )
        newer_exists = await self._db.scalar(
            select(PriceObservation.id)
            .where(PriceObservation.listing_id == listing.id, PriceObservation.observed_at > when)
            .limit(1)
        )
        observation = PriceObservation(
            id=uuid.uuid4(),
            workspace_id=listing.workspace_id,
            listing_id=listing.id,
            price=price,
            currency=currency,
            in_stock=in_stock,
            observed_at=when,
            source=source,
            note=note,
            created_by_user_id=actor_user_id,
        )
        self._db.add(observation)
        await self._db.flush()

        alerts: list[PriceAlert] = []
        if product.status == ProductStatus.WATCHING.value and newer_exists is None:
            alerts = await self._evaluate(product, observation, previous)
        if alerts:
            merchant = await self.get_merchant(listing.workspace_id, listing.merchant_id)
            await self._announce(product, merchant, alerts)
        self._audit(
            "shopping.price_recorded",
            listing.workspace_id,
            "listing",
            listing.id,
            actor_user_id,
            {"price": str(price), "currency": currency, "alerts": [a.kind for a in alerts]},
        )
        await self._db.commit()
        return observation, alerts

    async def _evaluate(
        self, product: Product, obs: PriceObservation, previous: PriceObservation | None
    ) -> list[PriceAlert]:
        """Deterministic alert rules (ADR-022) for an observation that is the newest one."""
        kinds: list[tuple[AlertKind, Decimal | None]] = []
        if (
            product.target_price is not None
            and obs.currency == product.currency
            and obs.price <= product.target_price
            and obs.in_stock is not False
        ):
            already_open = await self._db.scalar(
                select(PriceAlert.id).where(
                    PriceAlert.product_id == product.id,
                    PriceAlert.kind == AlertKind.BELOW_TARGET.value,
                    PriceAlert.status == AlertStatus.OPEN.value,
                )
            )
            if already_open is None:
                kinds.append((AlertKind.BELOW_TARGET, product.target_price))
        if (
            previous is not None
            and previous.currency == obs.currency
            and obs.price < previous.price
        ):
            drop = (previous.price - obs.price) * HUNDRED / previous.price
            if drop >= product.drop_alert_percent:
                kinds.append((AlertKind.PRICE_DROP, previous.price))
        if previous is not None and previous.in_stock is False and obs.in_stock is True:
            kinds.append((AlertKind.BACK_IN_STOCK, None))
        alerts = [
            PriceAlert(
                id=uuid.uuid4(),
                workspace_id=product.workspace_id,
                product_id=product.id,
                observation_id=obs.id,
                kind=kind.value,
                price=obs.price,
                previous_price=reference,
                currency=obs.currency,
                status=AlertStatus.OPEN.value,
            )
            for kind, reference in kinds
        ]
        self._db.add_all(alerts)
        return alerts

    async def _announce(
        self, product: Product, merchant: Merchant, alerts: list[PriceAlert]
    ) -> None:
        notifications = NotificationService(self._db, self._now)
        events = EventPublisher(self._db, self._now)
        for alert in alerts:
            kind = AlertKind(alert.kind)
            detail = f"{product.name}: {alert.price} {alert.currency} at {merchant.name}"
            if kind is AlertKind.BELOW_TARGET:
                detail += f" (target {alert.previous_price} {alert.currency})"
            elif kind is AlertKind.PRICE_DROP:
                detail += f" (was {alert.previous_price})"
            await notifications.notify_workspace(
                product.workspace_id,
                ALERT_TITLES[kind],
                detail,
                severity=Severity.SUCCESS if kind is AlertKind.BELOW_TARGET else Severity.INFO,
                category="shopping",
                link=f"/shopping?product={product.id}",
                dedupe_key=f"shopping-alert:{alert.id}",
            )
            events.publish(
                EVENT_PRICE_ALERT,
                {
                    "alert_id": str(alert.id),
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "kind": alert.kind,
                    "price": str(alert.price),
                    "previous_price": str(alert.previous_price) if alert.previous_price else None,
                    "currency": alert.currency,
                    "merchant": merchant.name,
                },
                workspace_id=product.workspace_id,
            )

    async def delete_observation(
        self, workspace_id: uuid.UUID, observation_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> None:
        obs = await self._db.scalar(
            select(PriceObservation).where(
                PriceObservation.id == observation_id, PriceObservation.workspace_id == workspace_id
            )
        )
        if obs is None:
            raise NotFound("Observation not found.")
        self._audit(
            "shopping.price_deleted",
            workspace_id,
            "listing",
            obs.listing_id,
            actor_user_id,
            {"price": str(obs.price), "observed_at": obs.observed_at.isoformat()},
        )
        await self._db.delete(obs)
        await self._db.commit()

    # -------------------------------------------------------------------- alerts

    async def list_alerts(
        self, workspace_id: uuid.UUID, status: str | None = AlertStatus.OPEN.value
    ) -> list[tuple[PriceAlert, Product]]:
        stmt = (
            select(PriceAlert, Product)
            .join(Product, Product.id == PriceAlert.product_id)
            .where(PriceAlert.workspace_id == workspace_id)
        )
        if status:
            stmt = stmt.where(PriceAlert.status == status)
        rows = await self._db.execute(stmt.order_by(PriceAlert.created_at.desc()).limit(200))
        return [(alert, product) for alert, product in rows.all()]

    async def dismiss_alert(
        self, workspace_id: uuid.UUID, alert_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> PriceAlert:
        alert = await self._db.scalar(
            select(PriceAlert).where(
                PriceAlert.id == alert_id, PriceAlert.workspace_id == workspace_id
            )
        )
        if alert is None:
            raise NotFound("Alert not found.")
        alert.status = AlertStatus.DISMISSED.value
        self._audit(
            "shopping.alert_dismissed", workspace_id, "price_alert", alert.id, actor_user_id
        )
        await self._db.commit()
        return alert
