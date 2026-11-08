"""Invoice profiles, deterministic drafts and duplicate-safe issuance."""

from __future__ import annotations

import calendar
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.actions import ActionError, RetryableActionError
from app.core.db import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.integrations import ProviderError, ProviderErrorKind
from app.core.tasks import WorkerContext
from app.modules.audit.public import ActorType, AuditRecorder
from app.modules.events.public import EventPublisher
from app.modules.integrations.public import mark_connection_error
from app.modules.invoicing.models import Invoice, InvoiceProfile, InvoiceStatus
from app.modules.oblio.public import load_oblio

logger = logging.getLogger(__name__)

EVENT_ISSUED = "invoicing.invoice_issued"
RO_MONTHS = (
    "ianuarie",
    "februarie",
    "martie",
    "aprilie",
    "mai",
    "iunie",
    "iulie",
    "august",
    "septembrie",
    "octombrie",
    "noiembrie",
    "decembrie",
)
PROFILE_FIELDS = (
    "name",
    "enabled",
    "client_name",
    "client_cif",
    "client_rc",
    "client_address",
    "client_city",
    "client_state",
    "client_country",
    "client_email",
    "client_vat_payer",
    "series_name",
    "language",
    "currency",
    "description",
    "measuring_unit",
    "unit_price",
    "quantity",
    "vat_name",
    "vat_percentage",
    "vat_included",
    "billing_period",
    "due_days",
    "timezone",
    "mentions",
    "send_email",
)


@dataclass(frozen=True, slots=True)
class InvoiceDraft:
    profile_id: uuid.UUID
    period: str  # YYYY-MM
    period_start: date
    period_end: date
    issue_date: date
    due_date: date
    client_name: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    net_amount: Decimal
    currency: str
    series_name: str

    def as_output(self) -> dict[str, Any]:
        return {
            "profile_id": str(self.profile_id),
            "period": self.period,
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
            "issue_date": self.issue_date.isoformat(),
            "due_date": self.due_date.isoformat(),
            "client_name": self.client_name,
            "description": self.description,
            "quantity": str(self.quantity),
            "unit_price": str(self.unit_price),
            "net_amount": str(self.net_amount),
            "currency": self.currency,
            "series_name": self.series_name,
        }


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def parse_period(period: str) -> tuple[int, int]:
    try:
        year_s, month_s = period.split("-")
        year, month = int(year_s), int(month_s)
    except ValueError as exc:
        raise ValidationFailed("Period must look like YYYY-MM.") from exc
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise ValidationFailed("Period out of range.")
    return year, month


def default_period(profile: InvoiceProfile, today: date) -> str:
    if profile.billing_period == "current_month":
        return f"{today.year:04d}-{today.month:02d}"
    previous = today.replace(day=1) - timedelta(days=1)
    return f"{previous.year:04d}-{previous.month:02d}"


def local_today(profile: InvoiceProfile, now: datetime) -> date:
    return now.astimezone(ZoneInfo(profile.timezone)).date()


def build_draft(profile: InvoiceProfile, period: str, issue_date: date) -> InvoiceDraft:
    year, month = parse_period(period)
    start, end = month_bounds(year, month)
    description = (
        profile.description.replace("{period}", f"{year:04d}-{month:02d}")
        .replace("{month_name}", RO_MONTHS[month - 1])
        .replace("{year}", str(year))
    )
    net = (profile.unit_price * profile.quantity).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return InvoiceDraft(
        profile_id=profile.id,
        period=f"{year:04d}-{month:02d}",
        period_start=start,
        period_end=end,
        issue_date=issue_date,
        due_date=issue_date + timedelta(days=profile.due_days),
        client_name=profile.client_name,
        description=description[:500],
        quantity=profile.quantity,
        unit_price=profile.unit_price,
        net_amount=net,
        currency=profile.currency,
        series_name=profile.series_name,
    )


def oblio_payload(
    profile: InvoiceProfile, draft: InvoiceDraft, cif: str, idempotency_key: str
) -> dict[str, Any]:
    """Request body for Oblio ``POST /docs/invoice`` built only from explicit settings."""
    client: dict[str, Any] = {
        "name": profile.client_name,
        "vatPayer": 1 if profile.client_vat_payer else 0,
        "save": 0,
    }
    for key, value in (
        ("cif", profile.client_cif),
        ("rc", profile.client_rc),
        ("address", profile.client_address),
        ("city", profile.client_city),
        ("state", profile.client_state),
        ("country", profile.client_country),
        ("email", profile.client_email),
    ):
        if value:
            client[key] = value
    product: dict[str, Any] = {
        "name": draft.description,
        "price": profile.unit_price,
        "quantity": profile.quantity,
        "measuringUnit": profile.measuring_unit,
        "currency": profile.currency,
        "vatIncluded": 1 if profile.vat_included else 0,
        "save": 0,
    }
    if profile.vat_name:
        product["vatName"] = profile.vat_name
    if profile.vat_percentage is not None:
        product["vatPercentage"] = profile.vat_percentage
    payload: dict[str, Any] = {
        "cif": cif,
        "client": client,
        "issueDate": draft.issue_date.isoformat(),
        "dueDate": draft.due_date.isoformat(),
        "seriesName": profile.series_name,
        "language": profile.language,
        "currency": profile.currency,
        "products": [product],
        "sendEmail": 1 if profile.send_email and profile.client_email else 0,
        "idempotencyKey": idempotency_key,
    }
    if profile.mentions:
        payload["mentions"] = profile.mentions
    return payload


def idempotency_key_for(profile_id: uuid.UUID, period: str) -> str:
    return f"pos-{profile_id}-{period}"


class InvoicingService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    async def list_profiles(self, workspace_id: uuid.UUID) -> list[InvoiceProfile]:
        return list(
            await self._db.scalars(
                select(InvoiceProfile)
                .where(InvoiceProfile.workspace_id == workspace_id)
                .order_by(InvoiceProfile.name)
            )
        )

    async def get_profile(self, workspace_id: uuid.UUID, profile_id: uuid.UUID) -> InvoiceProfile:
        profile = await self._db.scalar(
            select(InvoiceProfile).where(
                InvoiceProfile.id == profile_id, InvoiceProfile.workspace_id == workspace_id
            )
        )
        if profile is None:
            raise NotFound("Invoice profile not found.")
        return profile

    async def save_profile(
        self,
        workspace_id: uuid.UUID,
        data: dict[str, Any],
        actor_user_id: uuid.UUID,
        profile: InvoiceProfile | None = None,
    ) -> InvoiceProfile:
        try:
            ZoneInfo(str(data.get("timezone", "Europe/Bucharest")))
        except Exception as exc:
            raise ValidationFailed("Unknown timezone.", code="invalid_timezone") from exc
        if profile is None:
            profile = InvoiceProfile(id=uuid.uuid4(), workspace_id=workspace_id)
            self._db.add(profile)
        for key in PROFILE_FIELDS:
            if key in data:
                setattr(profile, key, data[key])
        AuditRecorder(self._db).record(
            "invoicing.profile_saved",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="invoice_profile",
            target_id=profile.id,
        )
        await self._db.commit()
        return profile

    async def delete_profile(self, profile: InvoiceProfile, actor_user_id: uuid.UUID) -> None:
        AuditRecorder(self._db).record(
            "invoicing.profile_deleted",
            actor_user_id=actor_user_id,
            workspace_id=profile.workspace_id,
            target_type="invoice_profile",
            target_id=profile.id,
        )
        await self._db.delete(profile)
        await self._db.commit()

    async def preview(self, profile: InvoiceProfile, period: str | None) -> InvoiceDraft:
        today = local_today(profile, self._now())
        return build_draft(profile, period or default_period(profile, today), today)

    async def list_invoices(self, workspace_id: uuid.UUID, limit: int = 100) -> list[Invoice]:
        return list(
            await self._db.scalars(
                select(Invoice)
                .where(Invoice.workspace_id == workspace_id)
                .order_by(Invoice.issue_date.desc(), Invoice.created_at.desc())
                .limit(limit)
            )
        )

    async def mark_failed_reviewed(self, invoice: Invoice) -> None:
        if invoice.status != InvoiceStatus.FAILED.value:
            raise Conflict("Only failed invoices can be dismissed.")
        await self._db.delete(invoice)
        await self._db.commit()


# ------------------------------------------------------------ worker-side issuing


@dataclass(frozen=True, slots=True)
class IssueRequest:
    workspace_id: uuid.UUID
    profile_id: uuid.UUID
    period: str
    expected_net_amount: str
    expected_currency: str
    expected_client_name: str
    execution_id: uuid.UUID | None


def _invoice_output(invoice: Invoice, *, already_existed: bool) -> dict[str, Any]:
    return {
        "invoice_id": str(invoice.id),
        "status": invoice.status,
        "series_name": invoice.series_name,
        "number": invoice.number,
        "link": invoice.link,
        "net_amount": str(invoice.net_amount),
        "currency": invoice.currency,
        "already_existed": already_existed,
    }


async def issue_invoice(worker: WorkerContext, request: IssueRequest) -> dict[str, Any]:
    """Issue the invoice for (profile, period) at most once.

    1. The intent is recorded (unique per profile+period) and committed *before*
       calling Oblio, so a crash can never lose track of an issuance attempt.
    2. Oblio receives a stable ``idempotencyKey`` for retries of an unknown outcome.
    3. An invoice recorded as issued is never sent again.
    """
    async with worker.session_factory() as db:
        profile = await db.scalar(
            select(InvoiceProfile).where(
                InvoiceProfile.id == request.profile_id,
                InvoiceProfile.workspace_id == request.workspace_id,
            )
        )
        if profile is None:
            raise ActionError("Invoice profile not found in this workspace.")
        if not profile.enabled:
            raise ActionError("Invoice profile is disabled.")
        today = local_today(profile, worker.clock())
        draft = build_draft(profile, request.period, today)
        if (
            str(draft.net_amount) != request.expected_net_amount
            or draft.currency != request.expected_currency
            or draft.client_name != request.expected_client_name
        ):
            raise ActionError("The invoice profile changed after approval; run the workflow again.")

        invoice = await db.scalar(
            select(Invoice)
            .where(Invoice.profile_id == profile.id, Invoice.period_start == draft.period_start)
            .with_for_update()
        )
        if invoice is not None and invoice.status == InvoiceStatus.ISSUED.value:
            return _invoice_output(invoice, already_existed=True)
        key = idempotency_key_for(profile.id, draft.period)
        connection_id, config, api = await load_oblio_or_fail(db, worker, request.workspace_id)
        payload = oblio_payload(profile, draft, config.cif, key)
        if invoice is None:
            invoice = Invoice(
                id=uuid.uuid4(),
                workspace_id=request.workspace_id,
                profile_id=profile.id,
                provider="oblio",
                idempotency_key=key,
                status=InvoiceStatus.PENDING.value,
                period_start=draft.period_start,
                period_end=draft.period_end,
                issue_date=draft.issue_date,
                due_date=draft.due_date,
                client_name=draft.client_name,
                description=draft.description,
                net_amount=draft.net_amount,
                currency=draft.currency,
                series_name=draft.series_name,
                execution_id=request.execution_id,
                request_snapshot={k: v for k, v in draft.as_output().items()},
            )
            db.add(invoice)
        else:
            invoice.status = InvoiceStatus.PENDING.value
            invoice.error = None
        await db.commit()
        invoice_id = invoice.id

    try:
        document = await api.create_invoice(payload)
    except ProviderError as exc:
        async with worker.session_factory() as db:
            invoice = await db.get_one(Invoice, invoice_id)
            if exc.kind is ProviderErrorKind.AUTH:
                await mark_connection_error(db, connection_id, exc.message, worker.clock)
            if exc.retryable:
                invoice.error = f"{exc.kind.value}: {exc.message}"[:1000]
                await db.commit()
                raise RetryableActionError(exc.message) from exc
            invoice.status = InvoiceStatus.FAILED.value
            invoice.error = f"{exc.kind.value}: {exc.message}"[:1000]
            await db.commit()
        raise ActionError(f"Oblio rejected the invoice: {exc.message}") from exc

    async with worker.session_factory() as db:
        invoice = await db.get_one(Invoice, invoice_id)
        invoice.status = InvoiceStatus.ISSUED.value
        invoice.series_name = document.series_name
        invoice.number = document.number
        invoice.link = document.link
        invoice.issued_at = worker.clock()
        invoice.error = None
        AuditRecorder(db).record(
            "invoicing.invoice_issued",
            actor_type=ActorType.SYSTEM,
            workspace_id=invoice.workspace_id,
            target_type="invoice",
            target_id=invoice.id,
            details={"series": document.series_name, "number": document.number},
        )
        EventPublisher(db, worker.clock).publish(
            EVENT_ISSUED,
            {
                "invoice_id": str(invoice.id),
                "series": document.series_name,
                "number": document.number,
            },
            workspace_id=invoice.workspace_id,
        )
        await db.commit()
        return _invoice_output(invoice, already_existed=False)


async def load_oblio_or_fail(
    db: AsyncSession, worker: WorkerContext, workspace_id: uuid.UUID
) -> Any:
    try:
        return await load_oblio(db, worker.secret_box, workspace_id)
    except ProviderError as exc:
        raise ActionError(f"Oblio is not available: {exc.message}") from exc


async def send_einvoice(
    worker: WorkerContext, workspace_id: uuid.UUID, invoice_id: uuid.UUID
) -> dict[str, Any]:
    async with worker.session_factory() as db:
        invoice = await db.scalar(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
        )
        if invoice is None or invoice.status != InvoiceStatus.ISSUED.value or not invoice.number:
            raise ActionError("Only issued invoices can be sent to SPV.")
        if invoice.einvoice_code in (0, 1):
            return {
                "code": invoice.einvoice_code,
                "text": invoice.einvoice_text,
                "already_sent": True,
            }
        _, config, api = await load_oblio_or_fail(db, worker, workspace_id)
        series, number = invoice.series_name, invoice.number
    try:
        result = await api.send_einvoice(config.cif, series, number)
    except ProviderError as exc:
        if exc.retryable:
            raise RetryableActionError(exc.message) from exc
        raise ActionError(f"SPV submission failed: {exc.message}") from exc
    async with worker.session_factory() as db:
        invoice = await db.get_one(Invoice, invoice_id)
        invoice.einvoice_code = result.code
        invoice.einvoice_text = result.text[:500]
        await db.commit()
    if result.code == -1:
        raise RetryableActionError(f"SPV did not accept the submission yet: {result.text}")
    if result.code == 2:
        raise ActionError(f"SPV reported errors: {result.text}")
    return {"code": result.code, "text": result.text, "already_sent": False}
