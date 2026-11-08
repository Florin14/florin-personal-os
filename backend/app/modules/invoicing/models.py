"""Invoice profiles (explicit billing settings) and issued invoice records."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InvoiceStatus(StrEnum):
    PENDING = "pending"  # intent recorded; provider call in progress or outcome unknown
    ISSUED = "issued"
    FAILED = "failed"


class InvoiceProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Everything needed to issue a recurring invoice; nothing is inferred."""

    __tablename__ = "invoice_profiles"
    __table_args__ = (
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        CheckConstraint("unit_price >= 0 AND quantity > 0", name="amounts_valid"),
        CheckConstraint("due_days >= 0 AND due_days <= 365", name="due_days_valid"),
        CheckConstraint(
            "billing_period IN ('previous_month', 'current_month')", name="period_valid"
        ),
        Index("ix_invoice_profiles_workspace", "workspace_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(default=True)
    # Client (buyer) data sent to Oblio.
    client_name: Mapped[str] = mapped_column(String(200))
    client_cif: Mapped[str | None] = mapped_column(String(32), default=None)
    client_rc: Mapped[str | None] = mapped_column(String(50), default=None)
    client_address: Mapped[str | None] = mapped_column(String(300), default=None)
    client_city: Mapped[str | None] = mapped_column(String(100), default=None)
    client_state: Mapped[str | None] = mapped_column(String(100), default=None)
    client_country: Mapped[str | None] = mapped_column(String(100), default=None)
    client_email: Mapped[str | None] = mapped_column(String(320), default=None)
    client_vat_payer: Mapped[bool] = mapped_column(default=False)
    # Document settings.
    series_name: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(2), default="RO")
    currency: Mapped[str] = mapped_column(String(3), default="RON")
    # Line item. Description may contain {period}, {month_name}, {year}.
    description: Mapped[str] = mapped_column(String(500))
    measuring_unit: Mapped[str] = mapped_column(String(20), default="buc")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal(1))
    # Tax: explicit, as configured in Oblio. NULL = Oblio's default for the product.
    vat_name: Mapped[str | None] = mapped_column(String(50), default=None)
    vat_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), default=None)
    vat_included: Mapped[bool] = mapped_column(default=False)
    # Dates.
    billing_period: Mapped[str] = mapped_column(String(20), default="previous_month")
    due_days: Mapped[int] = mapped_column(default=15)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Bucharest")
    mentions: Mapped[str | None] = mapped_column(String(500), default=None)
    send_email: Mapped[bool] = mapped_column(default=False)


class Invoice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        # One invoice per profile and billing period: the core duplicate guard.
        UniqueConstraint("profile_id", "period_start", name="uq_invoices_profile_period"),
        CheckConstraint("status IN ('pending', 'issued', 'failed')", name="status_valid"),
        Index("ix_invoices_workspace_issue", "workspace_id", "issue_date"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("invoice_profiles.id", ondelete="SET NULL"), default=None
    )
    provider: Mapped[str] = mapped_column(String(20), default="oblio")
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(String(16), default=InvoiceStatus.PENDING.value)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    issue_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    client_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500))
    # Net amount computed locally (quantity x unit price); the provider applies VAT.
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    currency: Mapped[str] = mapped_column(String(3))
    series_name: Mapped[str] = mapped_column(String(20))
    number: Mapped[str | None] = mapped_column(String(20), default=None)
    link: Mapped[str | None] = mapped_column(String(500), default=None)
    einvoice_code: Mapped[int | None] = mapped_column(default=None)
    einvoice_text: Mapped[str | None] = mapped_column(String(500), default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    request_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    issued_at: Mapped[datetime | None] = mapped_column(default=None)
