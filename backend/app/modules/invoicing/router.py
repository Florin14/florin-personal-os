"""Invoice profiles and issued invoices (workspace scoped)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.invoicing.actions import monthly_invoice_template
from app.modules.invoicing.service import InvoicingService
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}", tags=["invoicing"], responses=ERROR_RESPONSES
)

Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]
Money = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=4)]


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    client_name: str = Field(min_length=1, max_length=200)
    client_cif: str | None = Field(default=None, max_length=32)
    client_rc: str | None = Field(default=None, max_length=50)
    client_address: str | None = Field(default=None, max_length=300)
    client_city: str | None = Field(default=None, max_length=100)
    client_state: str | None = Field(default=None, max_length=100)
    client_country: str | None = Field(default=None, max_length=100)
    client_email: str | None = Field(default=None, max_length=320, pattern=r"^\S+@\S+$")
    client_vat_payer: bool = False
    series_name: str = Field(min_length=1, max_length=20)
    language: Literal["RO", "EN", "FR", "DE", "IT", "ES", "HU"] = "RO"
    currency: str = Field(default="RON", pattern=r"^[A-Z]{3}$")
    description: str = Field(min_length=1, max_length=500)
    measuring_unit: str = Field(default="buc", min_length=1, max_length=20)
    unit_price: Money
    quantity: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=4)] = Decimal(1)
    vat_name: str | None = Field(default=None, max_length=50)
    vat_percentage: Annotated[Decimal, Field(ge=0, le=100, decimal_places=2)] | None = None
    vat_included: bool = False
    billing_period: Literal["previous_month", "current_month"] = "previous_month"
    due_days: int = Field(default=15, ge=0, le=365)
    timezone: str = "Europe/Bucharest"
    mentions: str | None = Field(default=None, max_length=500)
    send_email: bool = False


class ProfileOut(ProfileIn):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    workspace_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    profile_id: uuid.UUID | None
    status: str
    period_start: date
    period_end: date
    issue_date: date
    due_date: date
    client_name: str
    description: str
    net_amount: Decimal
    currency: str
    series_name: str
    number: str | None
    link: str | None
    einvoice_code: int | None
    einvoice_text: str | None
    error: str | None
    execution_id: uuid.UUID | None
    issued_at: datetime | None


@router.get("/invoice-profiles", response_model=list[ProfileOut])
async def list_profiles(access: Viewer, db: DbSession) -> list[ProfileOut]:
    profiles = await InvoicingService(db).list_profiles(access.workspace_id)
    return [ProfileOut.model_validate(p) for p in profiles]


@router.post("/invoice-profiles", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: ProfileIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> ProfileOut:
    profile = await InvoicingService(db).save_profile(
        access.workspace_id, body.model_dump(), ctx.user.id
    )
    return ProfileOut.model_validate(profile)


@router.put("/invoice-profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: uuid.UUID, body: ProfileIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> ProfileOut:
    service = InvoicingService(db)
    profile = await service.get_profile(access.workspace_id, profile_id)
    profile = await service.save_profile(
        access.workspace_id, body.model_dump(), ctx.user.id, profile
    )
    return ProfileOut.model_validate(profile)


@router.delete("/invoice-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: uuid.UUID, access: Admin, ctx: CurrentUser, db: DbSession
) -> None:
    service = InvoicingService(db)
    await service.delete_profile(
        await service.get_profile(access.workspace_id, profile_id), ctx.user.id
    )


@router.get("/invoice-profiles/{profile_id}/preview", response_model=dict[str, Any])
async def preview(
    profile_id: uuid.UUID,
    access: Viewer,
    db: DbSession,
    period: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> dict[str, Any]:
    service = InvoicingService(db)
    draft = await service.preview(
        await service.get_profile(access.workspace_id, profile_id), period
    )
    return draft.as_output()


@router.get("/invoice-profiles/{profile_id}/workflow-template", response_model=dict[str, Any])
async def workflow_template(profile_id: uuid.UUID, access: Viewer, db: DbSession) -> dict[str, Any]:
    profile = await InvoicingService(db).get_profile(access.workspace_id, profile_id)
    return monthly_invoice_template(str(profile.id), profile.timezone)


@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    access: Viewer, db: DbSession, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> list[InvoiceOut]:
    invoices = await InvoicingService(db).list_invoices(access.workspace_id, limit)
    return [InvoiceOut.model_validate(i) for i in invoices]
