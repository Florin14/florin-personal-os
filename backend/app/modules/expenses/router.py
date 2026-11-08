"""Expense endpoints (workspace scoped)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.expenses.service import ExpenseService
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}", tags=["expenses"], responses=ERROR_RESPONSES
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]

Category = Literal[
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
]
Amount = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)]


class ExpenseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID | None = None
    expense_date: date
    vendor: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    category: Category = "other"
    amount: Amount
    currency: str = Field(default="RON", pattern=r"^[A-Z]{3}$")
    vat_amount: Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2)] | None = None
    payment_method: Literal["card", "transfer", "cash", "other"] = "card"
    notes: str = Field(default="", max_length=4000)


class ExpenseOut(ExpenseIn):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    created_at: datetime


class SummaryRow(BaseModel):
    month: int
    category: str
    currency: str
    total: str


@router.get("/expenses", response_model=list[ExpenseOut])
async def list_expenses(
    access: Viewer,
    db: DbSession,
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
    month: Annotated[int | None, Query(ge=1, le=12)] = None,
) -> list[ExpenseOut]:
    items = await ExpenseService(db).list_expenses(access.workspace_id, year, month)
    return [ExpenseOut.model_validate(e) for e in items]


@router.get("/expenses/summary", response_model=list[SummaryRow])
async def summary(
    access: Viewer, db: DbSession, year: Annotated[int, Query(ge=2000, le=2100)]
) -> list[SummaryRow]:
    rows = await ExpenseService(db).summary(access.workspace_id, year)
    return [SummaryRow(**r) for r in rows]


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    body: ExpenseIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ExpenseOut:
    expense = await ExpenseService(db).save(access.workspace_id, body.model_dump(), ctx.user.id)
    return ExpenseOut.model_validate(expense)


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: uuid.UUID, body: ExpenseIn, access: Member, ctx: CurrentUser, db: DbSession
) -> ExpenseOut:
    service = ExpenseService(db)
    expense = await service.save(
        access.workspace_id,
        body.model_dump(),
        ctx.user.id,
        await service.get(access.workspace_id, expense_id),
    )
    return ExpenseOut.model_validate(expense)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(expense_id: uuid.UUID, access: Member, db: DbSession) -> None:
    service = ExpenseService(db)
    await service.delete(await service.get(access.workspace_id, expense_id))
