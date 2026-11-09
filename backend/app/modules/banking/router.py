"""Banking & reconciliation endpoints (workspace scoped)."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.dependencies import DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.banking.models import (
    BankAccount,
    BankImport,
    BankTransaction,
    MatchStatus,
    ReconciliationMatch,
    TargetType,
    TransactionStatus,
)
from app.modules.banking.parsers import MAX_STATEMENT_BYTES
from app.modules.banking.reconciliation import Scored
from app.modules.banking.service import BankingService, ReconcileResult, TargetInfo
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/banking",
    tags=["banking"],
    responses=ERROR_RESPONSES,
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]
StatementFile = Annotated[UploadFile, File(description="CSV statement, max 5 MB")]

# ------------------------------------------------------------------- schemas


class AccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    bank_name: str = Field(default="", max_length=100)
    iban: str | None = Field(default=None, max_length=50)
    currency: str = Field(default="RON", pattern=r"^[A-Z]{3}$")

    @field_validator("iban")
    @classmethod
    def _iban(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        compact = re.sub(r"\s+", "", value).upper()
        if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{10,30}", compact):
            raise ValueError("Not a valid IBAN format.")
        return compact


class AccountOut(BaseModel):
    id: uuid.UUID
    name: str
    bank_name: str
    iban: str | None
    currency: str
    created_at: datetime
    counts: dict[str, int]
    last_import_at: datetime | None


class ImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    filename: str
    parser: str
    row_count: int
    imported_count: int
    duplicate_count: int
    error_count: int
    first_date: date | None
    last_date: date | None
    created_at: datetime


class ReconcileOut(BaseModel):
    processed: int
    auto_matched: int
    suggested: int


class ImportResultOut(BaseModel):
    batch: ImportOut
    reconciliation: ReconcileOut


class RowErrorOut(BaseModel):
    line: int
    message: str


class PreviewRowOut(BaseModel):
    line: int
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty: str
    description: str
    reference: str


class PreviewOut(BaseModel):
    parser: str
    columns: dict[str, str]
    total_rows: int
    valid_rows: int
    duplicate_rows: int
    errors: list[RowErrorOut]
    sample: list[PreviewRowOut]


class TargetOut(BaseModel):
    target_type: Literal["invoice", "document", "expense"]
    target_id: uuid.UUID
    label: str
    date: date
    amount: Decimal
    currency: str


class TransactionOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty: str
    description: str
    reference: str
    status: Literal["unmatched", "suggested", "matched", "ignored"]
    matched: TargetOut | None = None


class MatchOut(BaseModel):
    id: uuid.UUID
    transaction_id: uuid.UUID
    target: TargetOut | None
    rule: str
    confidence: Decimal
    reasons: list[str]
    status: Literal["suggested", "confirmed", "rejected"]
    decided_at: datetime | None


class CandidateOut(BaseModel):
    target: TargetOut
    confidence: Decimal
    rule: str
    reasons: list[str]


class CandidatesOut(BaseModel):
    transaction: TransactionOut
    matches: list[MatchOut]
    candidates: list[CandidateOut]


class ReviewItemOut(BaseModel):
    transaction: TransactionOut
    suggestions: list[MatchOut]


class ManualMatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: TargetType
    target_id: uuid.UUID


class IgnoreIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ignored: bool


class UndoOut(BaseModel):
    removed: int


# ------------------------------------------------------------------- mapping


def _target(info: TargetInfo | None) -> TargetOut | None:
    if info is None:
        return None
    return TargetOut(
        target_type=info.target_type,
        target_id=info.target_id,
        label=info.label,
        date=info.when,
        amount=info.amount,
        currency=info.currency,
    )


def _transaction(tx: BankTransaction, matched: TargetInfo | None = None) -> TransactionOut:
    return TransactionOut(
        id=tx.id,
        account_id=tx.account_id,
        booking_date=tx.booking_date,
        value_date=tx.value_date,
        amount=tx.amount,
        currency=tx.currency,
        counterparty=tx.counterparty,
        description=tx.description,
        reference=tx.reference,
        status=tx.status,
        matched=_target(matched),
    )


def _match(m: ReconciliationMatch, targets: dict[tuple[str, uuid.UUID], TargetInfo]) -> MatchOut:
    return MatchOut(
        id=m.id,
        transaction_id=m.transaction_id,
        target=_target(targets.get((m.target_type, m.target_id))),
        rule=m.rule,
        confidence=m.confidence,
        reasons=list(m.reasons),
        status=m.status,
        decided_at=m.decided_at,
    )


def _reconcile(result: ReconcileResult) -> ReconcileOut:
    return ReconcileOut(
        processed=result.processed, auto_matched=result.auto_matched, suggested=result.suggested
    )


async def _with_matches(
    service: BankingService, workspace_id: uuid.UUID, txs: list[BankTransaction]
) -> list[TransactionOut]:
    confirmed = await service.matches_for([t.id for t in txs], [MatchStatus.CONFIRMED])
    pairs = [(m.target_type, m.target_id) for ms in confirmed.values() for m in ms]
    targets = await service.describe_targets(workspace_id, pairs)
    out = []
    for tx in txs:
        first = next(iter(confirmed.get(tx.id, [])), None)
        out.append(
            _transaction(tx, targets.get((first.target_type, first.target_id)) if first else None)
        )
    return out


def _import(batch: BankImport) -> ImportOut:
    return ImportOut.model_validate(batch)


# ------------------------------------------------------------------ accounts


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(access: Viewer, db: DbSession) -> list[AccountOut]:
    service = BankingService(db)
    summary = await service.summary(access.workspace_id)
    empty = {s.value: 0 for s in TransactionStatus}
    result = []
    for account in await service.list_accounts(access.workspace_id):
        info = summary.get(account.id, {})
        result.append(
            AccountOut(
                id=account.id,
                name=account.name,
                bank_name=account.bank_name,
                iban=account.iban,
                currency=account.currency,
                created_at=account.created_at,
                counts={k: int(info.get(k, v)) for k, v in empty.items()},
                last_import_at=info.get("last_import_at"),
            )
        )
    return result


def _account_out(account: BankAccount) -> AccountOut:
    """Account without statistics (create/update responses; the list endpoint adds them)."""
    return AccountOut(
        id=account.id,
        name=account.name,
        bank_name=account.bank_name,
        iban=account.iban,
        currency=account.currency,
        created_at=account.created_at,
        counts={s.value: 0 for s in TransactionStatus},
        last_import_at=None,
    )


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> AccountOut:
    service = BankingService(db)
    return _account_out(
        await service.save_account(access.workspace_id, body.model_dump(), ctx.user.id)
    )


@router.put("/accounts/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: uuid.UUID, body: AccountIn, access: Admin, ctx: CurrentUser, db: DbSession
) -> AccountOut:
    service = BankingService(db)
    account = await service.get_account(access.workspace_id, account_id)
    return _account_out(
        await service.save_account(access.workspace_id, body.model_dump(), ctx.user.id, account)
    )


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: uuid.UUID, access: Admin, ctx: CurrentUser, db: DbSession
) -> None:
    service = BankingService(db)
    await service.delete_account(
        await service.get_account(access.workspace_id, account_id), ctx.user.id
    )


# ------------------------------------------------------------------- imports


@router.post("/accounts/{account_id}/imports/preview", response_model=PreviewOut)
async def preview_import(
    account_id: uuid.UUID, file: StatementFile, access: Member, db: DbSession
) -> PreviewOut:
    """Parses a statement without storing anything."""
    service = BankingService(db)
    account = await service.get_account(access.workspace_id, account_id)
    result, duplicates = await service.preview(account, await file.read(MAX_STATEMENT_BYTES + 1))
    return PreviewOut(
        parser=result.parser,
        columns=result.columns,
        total_rows=result.total_rows,
        valid_rows=len(result.rows),
        duplicate_rows=duplicates,
        errors=[RowErrorOut(line=e.line, message=e.message) for e in result.errors[:50]],
        sample=[
            PreviewRowOut(
                line=r.line,
                booking_date=r.booking_date,
                value_date=r.value_date,
                amount=r.amount,
                currency=r.currency,
                counterparty=r.counterparty,
                description=r.description,
                reference=r.reference,
            )
            for r in result.rows[:50]
        ],
    )


@router.post(
    "/accounts/{account_id}/imports",
    response_model=ImportResultOut,
    status_code=status.HTTP_201_CREATED,
)
async def import_statement(
    account_id: uuid.UUID, file: StatementFile, access: Member, ctx: CurrentUser, db: DbSession
) -> ImportResultOut:
    service = BankingService(db)
    account = await service.get_account(access.workspace_id, account_id)
    batch, reconciled = await service.import_statement(
        account,
        file.filename or "statement.csv",
        await file.read(MAX_STATEMENT_BYTES + 1),
        ctx.user.id,
    )
    return ImportResultOut(batch=_import(batch), reconciliation=_reconcile(reconciled))


@router.get("/imports", response_model=list[ImportOut])
async def list_imports(
    access: Viewer, db: DbSession, account_id: uuid.UUID | None = None
) -> list[ImportOut]:
    return [
        _import(b) for b in await BankingService(db).list_imports(access.workspace_id, account_id)
    ]


@router.delete("/imports/{import_id}", response_model=UndoOut)
async def undo_import(
    import_id: uuid.UUID, access: Admin, ctx: CurrentUser, db: DbSession
) -> UndoOut:
    """Removes the transactions this import added, with their matches."""
    removed = await BankingService(db).undo_import(access.workspace_id, import_id, ctx.user.id)
    return UndoOut(removed=removed)


# -------------------------------------------------------------- transactions


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    access: Viewer,
    db: DbSession,
    account_id: uuid.UUID | None = None,
    status_filter: Annotated[
        Literal["unmatched", "suggested", "matched", "ignored"] | None, Query(alias="status")
    ] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> list[TransactionOut]:
    service = BankingService(db)
    txs = await service.list_transactions(
        access.workspace_id,
        account_id=account_id,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
        query=q,
        limit=limit,
    )
    return await _with_matches(service, access.workspace_id, txs)


@router.get("/transactions/{transaction_id}/candidates", response_model=CandidatesOut)
async def transaction_candidates(
    transaction_id: uuid.UUID, access: Viewer, db: DbSession
) -> CandidatesOut:
    """Current matches plus freshly scored candidates (including weak ones) for manual review."""
    service = BankingService(db)
    tx = await service.get_transaction(access.workspace_id, transaction_id)
    matches = (await service.matches_for([tx.id])).get(tx.id, [])
    scored: list[Scored] = await service.candidates_for(access.workspace_id, tx)
    targets = await service.describe_targets(
        access.workspace_id,
        [(m.target_type, m.target_id) for m in matches]
        + [(s.candidate.target_type, s.candidate.target_id) for s in scored],
    )
    confirmed = next((m for m in matches if m.status == MatchStatus.CONFIRMED), None)
    candidates = []
    for s in scored:
        target = _target(targets.get((s.candidate.target_type, s.candidate.target_id)))
        if target is not None:
            candidates.append(
                CandidateOut(
                    target=target, confidence=s.confidence, rule=s.rule, reasons=list(s.reasons)
                )
            )
    return CandidatesOut(
        transaction=_transaction(
            tx, targets.get((confirmed.target_type, confirmed.target_id)) if confirmed else None
        ),
        matches=[_match(m, targets) for m in matches],
        candidates=candidates,
    )


@router.post(
    "/transactions/{transaction_id}/matches",
    response_model=MatchOut,
    status_code=status.HTTP_201_CREATED,
)
async def manual_match(
    transaction_id: uuid.UUID, body: ManualMatchIn, access: Member, ctx: CurrentUser, db: DbSession
) -> MatchOut:
    service = BankingService(db)
    tx = await service.get_transaction(access.workspace_id, transaction_id)
    match = await service.manual_match(
        access.workspace_id, tx, body.target_type, body.target_id, ctx.user.id
    )
    targets = await service.describe_targets(
        access.workspace_id, [(match.target_type, match.target_id)]
    )
    return _match(match, targets)


@router.put("/transactions/{transaction_id}/ignored", response_model=TransactionOut)
async def set_ignored(
    transaction_id: uuid.UUID, body: IgnoreIn, access: Member, ctx: CurrentUser, db: DbSession
) -> TransactionOut:
    service = BankingService(db)
    tx = await service.set_ignored(
        await service.get_transaction(access.workspace_id, transaction_id),
        body.ignored,
        ctx.user.id,
    )
    return _transaction(tx)


# ------------------------------------------------------------ reconciliation


@router.get("/review", response_model=list[ReviewItemOut])
async def review_queue(access: Viewer, db: DbSession) -> list[ReviewItemOut]:
    """Transactions with match suggestions waiting for a decision."""
    service = BankingService(db)
    txs = await service.review_queue(access.workspace_id)
    suggestions = await service.matches_for([t.id for t in txs], [MatchStatus.SUGGESTED])
    targets = await service.describe_targets(
        access.workspace_id,
        [(m.target_type, m.target_id) for ms in suggestions.values() for m in ms],
    )
    return [
        ReviewItemOut(
            transaction=_transaction(tx),
            suggestions=[_match(m, targets) for m in suggestions.get(tx.id, [])],
        )
        for tx in txs
    ]


@router.post("/reconcile", response_model=ReconcileOut)
async def reconcile(access: Member, db: DbSession) -> ReconcileOut:
    """Re-scores every open transaction (e.g. after adding documents or invoices)."""
    return _reconcile(await BankingService(db).reconcile(access.workspace_id))


async def _decided(
    service: BankingService, workspace_id: uuid.UUID, match: ReconciliationMatch
) -> MatchOut:
    targets = await service.describe_targets(workspace_id, [(match.target_type, match.target_id)])
    return _match(match, targets)


@router.post("/matches/{match_id}/confirm", response_model=MatchOut)
async def confirm_match(
    match_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> MatchOut:
    service = BankingService(db)
    match = await service.confirm(access.workspace_id, match_id, ctx.user.id)
    return await _decided(service, access.workspace_id, match)


@router.post("/matches/{match_id}/reject", response_model=MatchOut)
async def reject_match(
    match_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> MatchOut:
    service = BankingService(db)
    match = await service.reject(access.workspace_id, match_id, ctx.user.id)
    return await _decided(service, access.workspace_id, match)


@router.delete("/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_match(
    match_id: uuid.UUID, access: Member, ctx: CurrentUser, db: DbSession
) -> None:
    await BankingService(db).unmatch(access.workspace_id, match_id, ctx.user.id)
