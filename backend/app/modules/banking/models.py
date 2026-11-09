"""Bank accounts, statement imports, transactions and reconciliation matches (ADR-021)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TransactionStatus(StrEnum):
    UNMATCHED = "unmatched"
    SUGGESTED = "suggested"  # has match suggestions waiting for review
    MATCHED = "matched"  # one confirmed match
    IGNORED = "ignored"  # e.g. transfers between own accounts, fees


class MatchStatus(StrEnum):
    SUGGESTED = "suggested"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class TargetType(StrEnum):
    INVOICE = "invoice"
    DOCUMENT = "document"
    EXPENSE = "expense"


class BankAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bank_accounts"
    __table_args__ = (
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        Index("ix_bank_accounts_workspace", "workspace_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    bank_name: Mapped[str] = mapped_column(String(100), default="")
    iban: Mapped[str | None] = mapped_column(String(34), default=None)
    currency: Mapped[str] = mapped_column(String(3), default="RON")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class BankImport(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bank_imports"
    __table_args__ = (
        # The same file can never be imported twice into one account.
        UniqueConstraint("account_id", "sha256", name="uq_bank_imports_account_sha256"),
        Index("ix_bank_imports_workspace_created", "workspace_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bank_accounts.id", ondelete="CASCADE")
    )
    filename: Mapped[str] = mapped_column(String(200))
    sha256: Mapped[str] = mapped_column(String(64))
    parser: Mapped[str] = mapped_column(String(40))
    row_count: Mapped[int] = mapped_column(default=0)
    imported_count: Mapped[int] = mapped_column(default=0)
    duplicate_count: Mapped[int] = mapped_column(default=0)
    error_count: Mapped[int] = mapped_column(default=0)
    first_date: Mapped[date | None] = mapped_column(default=None)
    last_date: Mapped[date | None] = mapped_column(default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


class BankTransaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bank_transactions"
    __table_args__ = (
        # Overlapping statements add only new rows (fingerprint includes the occurrence number).
        UniqueConstraint(
            "account_id", "import_fingerprint", name="uq_bank_transactions_account_fingerprint"
        ),
        CheckConstraint("amount <> 0", name="amount_nonzero"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        CheckConstraint(
            "status IN ('unmatched', 'suggested', 'matched', 'ignored')", name="status_valid"
        ),
        Index("ix_bank_transactions_workspace_date", "workspace_id", "booking_date"),
        Index("ix_bank_transactions_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bank_accounts.id", ondelete="CASCADE")
    )
    import_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_imports.id", ondelete="CASCADE"))
    booking_date: Mapped[date]
    value_date: Mapped[date | None] = mapped_column(default=None)
    # Signed: negative = money out (debit), positive = money in (credit). Never float.
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    counterparty: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    reference: Mapped[str] = mapped_column(String(100), default="")
    import_fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default=TransactionStatus.UNMATCHED.value)


class ReconciliationMatch(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reconciliation_matches"
    __table_args__ = (
        UniqueConstraint(
            "transaction_id", "target_type", "target_id", name="uq_reconciliation_matches_pair"
        ),
        CheckConstraint("target_type IN ('invoice', 'document', 'expense')", name="target_valid"),
        CheckConstraint("status IN ('suggested', 'confirmed', 'rejected')", name="status_valid"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        # One confirmed match per transaction and per target (no double counting).
        Index(
            "uq_reconciliation_confirmed_transaction",
            "transaction_id",
            unique=True,
            postgresql_where=text("status = 'confirmed'"),
        ),
        Index(
            "uq_reconciliation_confirmed_target",
            "target_type",
            "target_id",
            unique=True,
            postgresql_where=text("status = 'confirmed'"),
        ),
        Index("ix_reconciliation_matches_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bank_transactions.id", ondelete="CASCADE")
    )
    target_type: Mapped[str] = mapped_column(String(16))
    # Polymorphic reference; ownership is checked by the service on every write.
    target_id: Mapped[uuid.UUID]
    rule: Mapped[str] = mapped_column(String(80))
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    reasons: Mapped[list[str]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default=MatchStatus.SUGGESTED.value)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    decided_at: Mapped[datetime | None] = mapped_column(default=None)
