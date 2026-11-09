"""Merchants, products, listings, price observations and alerts (ADR-022)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ProductStatus(StrEnum):
    WATCHING = "watching"
    APPROVED = "approved"  # decided to buy (possibly through an approval); not bought yet
    PURCHASED = "purchased"
    ARCHIVED = "archived"


class AlertKind(StrEnum):
    BELOW_TARGET = "below_target"
    PRICE_DROP = "price_drop"
    BACK_IN_STOCK = "back_in_stock"


class AlertStatus(StrEnum):
    OPEN = "open"
    DISMISSED = "dismissed"


class Merchant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shopping_merchants"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name_key", name="uq_shopping_merchants_name"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    name_key: Mapped[str] = mapped_column(String(100))
    website: Mapped[str | None] = mapped_column(String(300), default=None)


class Product(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shopping_products"
    __table_args__ = (
        # Canonical identity: one tracked product per GTIN / brand+model / name.
        UniqueConstraint("workspace_id", "identity_key", name="uq_shopping_products_identity"),
        # Brand+model is unique too, even when the primary identity is a GTIN (NULLs allowed).
        UniqueConstraint("workspace_id", "model_key", name="uq_shopping_products_model"),
        CheckConstraint(
            "status IN ('watching', 'approved', 'purchased', 'archived')", name="status_valid"
        ),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        CheckConstraint("target_price IS NULL OR target_price > 0", name="target_positive"),
        CheckConstraint(
            "drop_alert_percent > 0 AND drop_alert_percent <= 90", name="drop_percent_range"
        ),
        Index("ix_shopping_products_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str] = mapped_column(String(100), default="")
    model: Mapped[str] = mapped_column(String(100), default="")
    gtin: Mapped[str | None] = mapped_column(String(14), default=None)
    category: Mapped[str] = mapped_column(String(50), default="")
    identity_key: Mapped[str] = mapped_column(String(250))
    model_key: Mapped[str | None] = mapped_column(String(250), default=None)
    target_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), default=None)
    currency: Mapped[str] = mapped_column(String(3), default="RON")
    drop_alert_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("5"))
    status: Mapped[str] = mapped_column(String(16), default=ProductStatus.WATCHING.value)
    decided_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), default=None)
    decided_at: Mapped[datetime | None] = mapped_column(default=None)
    purchased_at: Mapped[datetime | None] = mapped_column(default=None)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class Listing(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shopping_listings"
    __table_args__ = (
        UniqueConstraint("product_id", "merchant_id", name="uq_shopping_listings_product_merchant"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_products.id", ondelete="CASCADE")
    )
    merchant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_merchants.id", ondelete="RESTRICT")
    )
    # Stored for the user only; the server never fetches it (ADR-022).
    url: Mapped[str | None] = mapped_column(String(500), default=None)
    source: Mapped[str] = mapped_column(String(20), default="manual")


class PriceObservation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shopping_price_observations"
    __table_args__ = (
        CheckConstraint("price > 0", name="price_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        Index("ix_shopping_observations_listing_time", "listing_id", "observed_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_listings.id", ondelete="CASCADE")
    )
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    in_stock: Mapped[bool | None] = mapped_column(default=None)
    observed_at: Mapped[datetime]
    source: Mapped[str] = mapped_column(String(20), default="manual")
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class PriceAlert(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shopping_price_alerts"
    __table_args__ = (
        UniqueConstraint("observation_id", "kind", name="uq_shopping_alerts_observation_kind"),
        CheckConstraint(
            "kind IN ('below_target', 'price_drop', 'back_in_stock')", name="kind_valid"
        ),
        CheckConstraint("status IN ('open', 'dismissed')", name="status_valid"),
        Index("ix_shopping_alerts_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_products.id", ondelete="CASCADE")
    )
    observation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shopping_price_observations.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(20))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    previous_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), default=None)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(16), default=AlertStatus.OPEN.value)
