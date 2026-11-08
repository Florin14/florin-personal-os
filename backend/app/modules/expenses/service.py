"""Basic expense tracking (manual entry or from documents) with monthly summaries."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    extract,
    func,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.core.errors import NotFound
from app.modules.audit.public import AuditRecorder
from app.modules.documents.public import Document

EXPENSE_CATEGORIES = (
    "software",
    "hardware",
    "office",
    "services",
    "travel",
    "transport",
    "meals",
    "utilities",
    "rent",
    "taxes",
    "groceries",
    "health",
    "entertainment",
    "other",
)
PAYMENT_METHODS = ("card", "transfer", "cash", "other")


class Expense(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        Index("ix_expenses_workspace_date", "workspace_id", "expense_date"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), default=None
    )
    expense_date: Mapped[date]
    vendor: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500), default="")
    category: Mapped[str] = mapped_column(String(30), default="other")
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3), default="RON")
    vat_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), default=None)
    payment_method: Mapped[str] = mapped_column(String(20), default="card")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


FIELDS = (
    "document_id",
    "expense_date",
    "vendor",
    "description",
    "category",
    "amount",
    "currency",
    "vat_amount",
    "payment_method",
    "notes",
)


class ExpenseService:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def list_expenses(
        self, workspace_id: uuid.UUID, year: int | None, month: int | None
    ) -> list[Expense]:
        stmt = select(Expense).where(Expense.workspace_id == workspace_id)
        if year:
            stmt = stmt.where(extract("year", Expense.expense_date) == year)
        if month:
            stmt = stmt.where(extract("month", Expense.expense_date) == month)
        return list(await self._db.scalars(stmt.order_by(Expense.expense_date.desc()).limit(500)))

    async def get(self, workspace_id: uuid.UUID, expense_id: uuid.UUID) -> Expense:
        expense = await self._db.scalar(
            select(Expense).where(Expense.id == expense_id, Expense.workspace_id == workspace_id)
        )
        if expense is None:
            raise NotFound("Expense not found.")
        return expense

    async def save(
        self,
        workspace_id: uuid.UUID,
        data: dict[str, Any],
        actor_user_id: uuid.UUID,
        expense: Expense | None = None,
    ) -> Expense:
        if data.get("document_id") is not None:
            # The document must belong to the same workspace (personal/business separation).
            owned = await self._db.scalar(
                select(Document.id).where(
                    Document.id == data["document_id"], Document.workspace_id == workspace_id
                )
            )
            if owned is None:
                raise NotFound("Document not found.")
        if expense is None:
            expense = Expense(
                id=uuid.uuid4(), workspace_id=workspace_id, created_by_user_id=actor_user_id
            )
            self._db.add(expense)
        for key in FIELDS:
            if key in data:
                setattr(expense, key, data[key])
        AuditRecorder(self._db).record(
            "expenses.saved",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="expense",
            target_id=expense.id,
        )
        await self._db.commit()
        return expense

    async def delete(self, expense: Expense) -> None:
        await self._db.delete(expense)
        await self._db.commit()

    async def summary(self, workspace_id: uuid.UUID, year: int) -> list[dict[str, Any]]:
        """Totals per month, category and currency (exact NUMERIC sums, never floats)."""
        month = extract("month", Expense.expense_date).label("month")
        rows = await self._db.execute(
            select(month, Expense.category, Expense.currency, func.sum(Expense.amount))
            .where(
                Expense.workspace_id == workspace_id,
                extract("year", Expense.expense_date) == year,
            )
            .group_by(month, Expense.category, Expense.currency)
            .order_by(month, Expense.category)
        )
        return [
            {"month": int(m), "category": c, "currency": cur, "total": str(total)}
            for m, c, cur, total in rows.all()
        ]
