"""Banking application service: accounts, statement imports, transactions, reconciliation."""

from __future__ import annotations

import hashlib
import uuid
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.modules.audit.public import AuditRecorder
from app.modules.banking.models import (
    BankAccount,
    BankImport,
    BankTransaction,
    MatchStatus,
    ReconciliationMatch,
    TargetType,
    TransactionStatus,
)
from app.modules.banking.parsers import (
    ParsedRow,
    ParseResult,
    StatementError,
    fingerprint,
    normalize,
    parse_statement,
)
from app.modules.banking.reconciliation import (
    MAX_SUGGESTIONS,
    BankLine,
    Candidate,
    Scored,
    auto_pick,
    rank,
)
from app.modules.documents.public import Document
from app.modules.events.public import EventPublisher
from app.modules.expenses.public import Expense
from app.modules.invoicing.public import Invoice, InvoiceStatus

EVENT_IMPORTED = "banking.statement_imported"
RECONCILE_BATCH = 5000
CANDIDATE_MARGIN = timedelta(days=130)
CENT = Decimal("0.01")

Pair = tuple[str, uuid.UUID]


@dataclass(frozen=True, slots=True)
class TargetInfo:
    target_type: str
    target_id: uuid.UUID
    label: str
    when: date
    amount: Decimal
    currency: str


@dataclass(frozen=True, slots=True)
class ReconcileResult:
    processed: int = 0
    auto_matched: int = 0
    suggested: int = 0


def _bank_text(tx: BankTransaction) -> str:
    return " ".join(p for p in (tx.counterparty, tx.description, tx.reference) if p)


class BankingService:
    def __init__(self, session: AsyncSession, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = session
        self._now = clock

    # ------------------------------------------------------------------ accounts

    async def list_accounts(self, workspace_id: uuid.UUID) -> list[BankAccount]:
        return list(
            await self._db.scalars(
                select(BankAccount)
                .where(BankAccount.workspace_id == workspace_id)
                .order_by(BankAccount.name)
            )
        )

    async def get_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> BankAccount:
        account = await self._db.scalar(
            select(BankAccount).where(
                BankAccount.id == account_id, BankAccount.workspace_id == workspace_id
            )
        )
        if account is None:
            raise NotFound("Bank account not found.")
        return account

    async def save_account(
        self,
        workspace_id: uuid.UUID,
        data: dict[str, Any],
        actor_user_id: uuid.UUID,
        account: BankAccount | None = None,
    ) -> BankAccount:
        if account is None:
            account = BankAccount(
                id=uuid.uuid4(), workspace_id=workspace_id, created_by_user_id=actor_user_id
            )
            self._db.add(account)
        elif data.get("currency") not in (None, account.currency) and await self._has_transactions(
            account.id
        ):
            raise Conflict("The currency cannot change once transactions were imported.")
        for key in ("name", "bank_name", "iban", "currency"):
            if key in data:
                setattr(account, key, data[key])
        AuditRecorder(self._db).record(
            "banking.account_saved",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="bank_account",
            target_id=account.id,
        )
        await self._db.commit()
        return account

    async def delete_account(self, account: BankAccount, actor_user_id: uuid.UUID) -> None:
        if await self._has_transactions(account.id):
            raise Conflict("Undo this account's imports before deleting it.")
        AuditRecorder(self._db).record(
            "banking.account_deleted",
            actor_user_id=actor_user_id,
            workspace_id=account.workspace_id,
            target_type="bank_account",
            target_id=account.id,
        )
        await self._db.delete(account)
        await self._db.commit()

    async def _has_transactions(self, account_id: uuid.UUID) -> bool:
        found = await self._db.scalar(
            select(BankTransaction.id).where(BankTransaction.account_id == account_id).limit(1)
        )
        return found is not None

    # -------------------------------------------------------------------- imports

    @staticmethod
    def _parse(content: bytes, account: BankAccount) -> ParseResult:
        try:
            return parse_statement(content, account.currency)
        except StatementError as exc:
            raise ValidationFailed(str(exc)) from exc

    @staticmethod
    def _fingerprints(account_id: uuid.UUID, rows: Sequence[ParsedRow]) -> list[str]:
        seen: Counter[tuple[object, ...]] = Counter()
        result = []
        for row in rows:
            key = (
                row.booking_date,
                row.amount,
                row.currency,
                normalize(row.description),
                normalize(row.counterparty),
                normalize(row.reference),
            )
            seen[key] += 1
            result.append(fingerprint(account_id, row, seen[key]))
        return result

    async def _existing_fingerprints(self, account_id: uuid.UUID, fps: list[str]) -> set[str]:
        existing: set[str] = set()
        for start in range(0, len(fps), 1000):
            existing.update(
                await self._db.scalars(
                    select(BankTransaction.import_fingerprint).where(
                        BankTransaction.account_id == account_id,
                        BankTransaction.import_fingerprint.in_(fps[start : start + 1000]),
                    )
                )
            )
        return existing

    async def preview(self, account: BankAccount, content: bytes) -> tuple[ParseResult, int]:
        """Parses without persisting anything; returns the result and the already-known count."""
        result = self._parse(content, account)
        fps = self._fingerprints(account.id, result.rows)
        return result, len(await self._existing_fingerprints(account.id, fps))

    async def import_statement(
        self, account: BankAccount, filename: str, content: bytes, actor_user_id: uuid.UUID
    ) -> tuple[BankImport, ReconcileResult]:
        digest = hashlib.sha256(content).hexdigest()
        previous = await self._db.scalar(
            select(BankImport).where(
                BankImport.account_id == account.id, BankImport.sha256 == digest
            )
        )
        if previous is not None:
            raise Conflict(
                f"This file was already imported on {previous.created_at.date().isoformat()}."
            )
        result = self._parse(content, account)
        if not result.rows:
            first = "; ".join(f"line {e.line}: {e.message}" for e in result.errors[:3])
            raise ValidationFailed(f"No valid transactions found. {first}".strip())

        batch = BankImport(
            id=uuid.uuid4(),
            workspace_id=account.workspace_id,
            account_id=account.id,
            filename=filename[:200],
            sha256=digest,
            parser=result.parser,
            row_count=result.total_rows,
            error_count=len(result.errors),
            first_date=min(r.booking_date for r in result.rows),
            last_date=max(r.booking_date for r in result.rows),
            created_by_user_id=actor_user_id,
        )
        self._db.add(batch)
        try:
            inserted = await self._store_import(account, batch, result, actor_user_id)
        except IntegrityError as exc:  # concurrent upload of the same file
            await self._db.rollback()
            raise Conflict("This file was already imported.") from exc
        # Reconciliation runs after the import is durable; its failure never loses the import.
        reconciled = (
            await self.reconcile(account.workspace_id, inserted) if inserted else ReconcileResult()
        )
        return batch, reconciled

    async def _store_import(
        self,
        account: BankAccount,
        batch: BankImport,
        result: ParseResult,
        actor_user_id: uuid.UUID,
    ) -> list[uuid.UUID]:
        await self._db.flush()
        values = [
            {
                "id": uuid.uuid4(),
                "workspace_id": account.workspace_id,
                "account_id": account.id,
                "import_id": batch.id,
                "booking_date": row.booking_date,
                "value_date": row.value_date,
                "amount": row.amount,
                "currency": row.currency,
                "counterparty": row.counterparty,
                "description": row.description,
                "reference": row.reference,
                "import_fingerprint": fp,
                "status": TransactionStatus.UNMATCHED.value,
            }
            for row, fp in zip(
                result.rows, self._fingerprints(account.id, result.rows), strict=True
            )
        ]
        inserted: list[uuid.UUID] = []
        for start in range(0, len(values), 1000):
            # Rows already known (overlapping statements) are skipped atomically, race-free.
            outcome = await self._db.execute(
                pg_insert(BankTransaction)
                .values(values[start : start + 1000])
                .on_conflict_do_nothing(constraint="uq_bank_transactions_account_fingerprint")
                .returning(BankTransaction.id)
            )
            inserted.extend(outcome.scalars().all())
        batch.imported_count = len(inserted)
        batch.duplicate_count = len(values) - len(inserted)

        AuditRecorder(self._db).record(
            "banking.statement_imported",
            actor_user_id=actor_user_id,
            workspace_id=account.workspace_id,
            target_type="bank_import",
            target_id=batch.id,
            details={
                "account_id": str(account.id),
                "imported": batch.imported_count,
                "duplicates": batch.duplicate_count,
                "errors": batch.error_count,
            },
        )
        EventPublisher(self._db, self._now).publish(
            EVENT_IMPORTED,
            {
                "account_id": str(account.id),
                "import_id": str(batch.id),
                "imported": batch.imported_count,
                "duplicates": batch.duplicate_count,
            },
            workspace_id=account.workspace_id,
            actor_user_id=actor_user_id,
        )
        await self._db.commit()
        return inserted

    async def list_imports(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID | None = None
    ) -> list[BankImport]:
        stmt = select(BankImport).where(BankImport.workspace_id == workspace_id)
        if account_id:
            stmt = stmt.where(BankImport.account_id == account_id)
        return list(await self._db.scalars(stmt.order_by(BankImport.created_at.desc()).limit(200)))

    async def undo_import(
        self, workspace_id: uuid.UUID, import_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> int:
        """Removes the transactions this import added (and their matches). Returns the count."""
        batch = await self._db.scalar(
            select(BankImport).where(
                BankImport.id == import_id, BankImport.workspace_id == workspace_id
            )
        )
        if batch is None:
            raise NotFound("Import not found.")
        removed = await self._db.scalar(
            select(func.count())
            .select_from(BankTransaction)
            .where(BankTransaction.import_id == batch.id)
        )
        await self._db.execute(delete(BankTransaction).where(BankTransaction.import_id == batch.id))
        AuditRecorder(self._db).record(
            "banking.import_undone",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="bank_import",
            target_id=batch.id,
            details={"filename": batch.filename, "removed": removed or 0},
        )
        await self._db.delete(batch)
        await self._db.commit()
        return removed or 0

    # --------------------------------------------------------------- transactions

    async def list_transactions(
        self,
        workspace_id: uuid.UUID,
        *,
        account_id: uuid.UUID | None = None,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        query: str | None = None,
        limit: int = 200,
    ) -> list[BankTransaction]:
        stmt = select(BankTransaction).where(BankTransaction.workspace_id == workspace_id)
        if account_id:
            stmt = stmt.where(BankTransaction.account_id == account_id)
        if status:
            stmt = stmt.where(BankTransaction.status == status)
        if date_from:
            stmt = stmt.where(BankTransaction.booking_date >= date_from)
        if date_to:
            stmt = stmt.where(BankTransaction.booking_date <= date_to)
        if query:
            like = f"%{query.replace('%', '').replace('_', '')}%"
            stmt = stmt.where(
                or_(
                    BankTransaction.counterparty.ilike(like),
                    BankTransaction.description.ilike(like),
                    BankTransaction.reference.ilike(like),
                )
            )
        stmt = stmt.order_by(BankTransaction.booking_date.desc(), BankTransaction.id).limit(limit)
        return list(await self._db.scalars(stmt))

    async def get_transaction(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> BankTransaction:
        tx = await self._db.scalar(
            select(BankTransaction).where(
                BankTransaction.id == transaction_id, BankTransaction.workspace_id == workspace_id
            )
        )
        if tx is None:
            raise NotFound("Transaction not found.")
        return tx

    async def set_ignored(
        self, tx: BankTransaction, ignored: bool, actor_user_id: uuid.UUID
    ) -> BankTransaction:
        if ignored:
            if tx.status == TransactionStatus.MATCHED.value:
                raise Conflict("Undo the confirmed match before ignoring this transaction.")
            await self._db.execute(
                delete(ReconciliationMatch).where(
                    ReconciliationMatch.transaction_id == tx.id,
                    ReconciliationMatch.status == MatchStatus.SUGGESTED.value,
                )
            )
            tx.status = TransactionStatus.IGNORED.value
        elif tx.status == TransactionStatus.IGNORED.value:
            tx.status = TransactionStatus.UNMATCHED.value
        AuditRecorder(self._db).record(
            "banking.transaction_ignored" if ignored else "banking.transaction_restored",
            actor_user_id=actor_user_id,
            workspace_id=tx.workspace_id,
            target_type="bank_transaction",
            target_id=tx.id,
        )
        await self._db.commit()
        return tx

    async def summary(self, workspace_id: uuid.UUID) -> dict[uuid.UUID, dict[str, Any]]:
        rows = await self._db.execute(
            select(BankTransaction.account_id, BankTransaction.status, func.count())
            .where(BankTransaction.workspace_id == workspace_id)
            .group_by(BankTransaction.account_id, BankTransaction.status)
        )
        result: dict[uuid.UUID, dict[str, Any]] = defaultdict(
            lambda: {s.value: 0 for s in TransactionStatus}
        )
        for account_id, status, count in rows.all():
            result[account_id][status] = count
        imports = await self._db.execute(
            select(BankImport.account_id, func.max(BankImport.created_at))
            .where(BankImport.workspace_id == workspace_id)
            .group_by(BankImport.account_id)
        )
        for account_id, last in imports.all():
            result[account_id]["last_import_at"] = last
        return dict(result)

    # ------------------------------------------------------------ reconciliation

    async def _confirmed_targets(self, workspace_id: uuid.UUID) -> set[Pair]:
        rows = await self._db.execute(
            select(ReconciliationMatch.target_type, ReconciliationMatch.target_id).where(
                ReconciliationMatch.workspace_id == workspace_id,
                ReconciliationMatch.status == MatchStatus.CONFIRMED.value,
            )
        )
        return {(t, i) for t, i in rows.all()}

    async def _candidates(
        self, workspace_id: uuid.UUID, start: date, end: date
    ) -> tuple[list[Candidate], list[Candidate]]:
        """(incoming candidates, outgoing candidates) dated within [start, end]."""
        incoming = [
            Candidate(
                target_type=TargetType.INVOICE.value,
                target_id=inv.id,
                when=inv.issue_date,
                amount=inv.net_amount.quantize(CENT),
                currency=inv.currency,
                label=f"Invoice {inv.series_name} {inv.number or ''} · {inv.client_name}".strip(),
                names=(inv.client_name,),
                numbers=(f"{inv.series_name} {inv.number}", inv.number) if inv.number else (),
                window_before=5,
                window_after=120,
            )
            for inv in await self._db.scalars(
                select(Invoice).where(
                    Invoice.workspace_id == workspace_id,
                    Invoice.status == InvoiceStatus.ISSUED.value,
                    Invoice.issue_date.between(start, end),
                )
            )
        ]
        expenses = list(
            await self._db.scalars(
                select(Expense).where(
                    Expense.workspace_id == workspace_id, Expense.expense_date.between(start, end)
                )
            )
        )
        # A document recorded as an expense is matched through the expense only.
        linked = {e.document_id for e in expenses if e.document_id}
        outgoing = [
            Candidate(
                target_type=TargetType.EXPENSE.value,
                target_id=e.id,
                when=e.expense_date,
                amount=e.amount,
                currency=e.currency,
                label=f"Expense · {e.vendor}",
                names=(e.vendor,),
                window_before=10,
                window_after=60,
            )
            for e in expenses
        ]
        start_dt = datetime.combine(start, time.min, tzinfo=UTC)
        documents = await self._db.scalars(
            select(Document).where(
                Document.workspace_id == workspace_id,
                Document.amount.is_not(None),
                Document.currency.is_not(None),
                or_(
                    Document.document_date.between(start, end),
                    and_(Document.document_date.is_(None), Document.created_at >= start_dt),
                ),
            )
        )
        for d in documents:
            if d.id in linked or d.amount is None or d.currency is None:
                continue
            outgoing.append(
                Candidate(
                    target_type=TargetType.DOCUMENT.value,
                    target_id=d.id,
                    when=d.document_date or d.created_at.date(),
                    amount=d.amount,
                    currency=d.currency,
                    label=f"Document · {d.vendor or d.title}",
                    names=tuple(n for n in (d.vendor, d.title) if n),
                    window_before=10,
                    window_after=60,
                )
            )
        return incoming, outgoing

    async def _matches_by_transaction(
        self, transaction_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, dict[Pair, ReconciliationMatch]]:
        ids = list(transaction_ids)
        found: dict[uuid.UUID, dict[Pair, ReconciliationMatch]] = defaultdict(dict)
        for start in range(0, len(ids), 1000):
            for match in await self._db.scalars(
                select(ReconciliationMatch).where(
                    ReconciliationMatch.transaction_id.in_(ids[start : start + 1000])
                )
            ):
                found[match.transaction_id][(match.target_type, match.target_id)] = match
        return found

    async def candidates_for(
        self, workspace_id: uuid.UUID, tx: BankTransaction, include_weak: bool = True
    ) -> list[Scored]:
        incoming, outgoing = await self._candidates(
            workspace_id, tx.booking_date - CANDIDATE_MARGIN, tx.booking_date + CANDIDATE_MARGIN
        )
        taken = await self._confirmed_targets(workspace_id)
        own = await self._matches_by_transaction([tx.id])
        own_confirmed = {p for p, m in own[tx.id].items() if m.status == MatchStatus.CONFIRMED}
        pool = [
            c
            for c in (incoming if tx.amount > 0 else outgoing)
            if (c.target_type, c.target_id) not in taken - own_confirmed
        ]
        line = BankLine(tx.booking_date, abs(tx.amount), tx.currency, _bank_text(tx))
        return rank(line, pool, include_weak=include_weak)[:20]

    async def reconcile(
        self, workspace_id: uuid.UUID, transaction_ids: Sequence[uuid.UUID] | None = None
    ) -> ReconcileResult:
        """Scores open transactions; auto-confirms only single unambiguous exact candidates."""
        stmt = select(BankTransaction).where(
            BankTransaction.workspace_id == workspace_id,
            BankTransaction.status.in_(
                [TransactionStatus.UNMATCHED.value, TransactionStatus.SUGGESTED.value]
            ),
        )
        if transaction_ids is not None:
            stmt = stmt.where(BankTransaction.id.in_(list(transaction_ids)))
        txs = list(
            await self._db.scalars(
                stmt.order_by(BankTransaction.booking_date).limit(RECONCILE_BATCH)
            )
        )
        if not txs:
            return ReconcileResult()
        incoming, outgoing = await self._candidates(
            workspace_id,
            min(t.booking_date for t in txs) - CANDIDATE_MARGIN,
            max(t.booking_date for t in txs) + CANDIDATE_MARGIN,
        )
        taken = await self._confirmed_targets(workspace_id)
        existing = await self._matches_by_transaction(t.id for t in txs)
        now = self._now()
        auto = suggested = 0
        for tx in txs:
            mine = existing[tx.id]
            rejected = {p for p, m in mine.items() if m.status == MatchStatus.REJECTED}
            pool = [
                c
                for c in (incoming if tx.amount > 0 else outgoing)
                if (c.target_type, c.target_id) not in taken | rejected
            ]
            line = BankLine(tx.booking_date, abs(tx.amount), tx.currency, _bank_text(tx))
            ranked = rank(line, pool)[:MAX_SUGGESTIONS]
            pick = auto_pick(ranked)
            if pick is not None:
                pair = (pick.candidate.target_type, pick.candidate.target_id)
                match = mine.get(pair) or self._new_match(tx, pick)
                match.status = MatchStatus.CONFIRMED.value
                match.rule = f"auto:{pick.rule}"[:80]
                match.decided_at = now
                for other_pair, other in mine.items():
                    if other_pair != pair and other.status == MatchStatus.SUGGESTED:
                        await self._db.delete(other)
                tx.status = TransactionStatus.MATCHED.value
                taken.add(pair)
                auto += 1
                continue
            for s in ranked:
                if (s.candidate.target_type, s.candidate.target_id) not in mine:
                    self._new_match(tx, s)
            if ranked or any(m.status == MatchStatus.SUGGESTED for m in mine.values()):
                tx.status = TransactionStatus.SUGGESTED.value
                suggested += 1
        await self._db.commit()
        return ReconcileResult(processed=len(txs), auto_matched=auto, suggested=suggested)

    def _new_match(self, tx: BankTransaction, scored: Scored) -> ReconciliationMatch:
        match = ReconciliationMatch(
            id=uuid.uuid4(),
            workspace_id=tx.workspace_id,
            transaction_id=tx.id,
            target_type=scored.candidate.target_type,
            target_id=scored.candidate.target_id,
            rule=scored.rule[:80],
            confidence=scored.confidence,
            reasons=list(scored.reasons),
            status=MatchStatus.SUGGESTED.value,
        )
        self._db.add(match)
        return match

    # ---------------------------------------------------------------- decisions

    async def get_match(self, workspace_id: uuid.UUID, match_id: uuid.UUID) -> ReconciliationMatch:
        match = await self._db.scalar(
            select(ReconciliationMatch).where(
                ReconciliationMatch.id == match_id,
                ReconciliationMatch.workspace_id == workspace_id,
            )
        )
        if match is None:
            raise NotFound("Match not found.")
        return match

    async def matches_for(
        self, transaction_ids: Sequence[uuid.UUID], statuses: Sequence[MatchStatus] | None = None
    ) -> dict[uuid.UUID, list[ReconciliationMatch]]:
        grouped = await self._matches_by_transaction(transaction_ids)
        wanted = {s.value for s in statuses} if statuses else None
        return {
            tx_id: sorted(
                (m for m in by_pair.values() if wanted is None or m.status in wanted),
                key=lambda m: (-m.confidence, str(m.id)),
            )
            for tx_id, by_pair in grouped.items()
        }

    async def _apply_confirmation(
        self, tx: BankTransaction, match: ReconciliationMatch, actor_user_id: uuid.UUID
    ) -> None:
        """Makes `match` the transaction's only live match; one confirmed match per side."""
        taken = await self._db.scalar(
            select(ReconciliationMatch.id).where(
                ReconciliationMatch.status == MatchStatus.CONFIRMED.value,
                ReconciliationMatch.id != match.id,
                or_(
                    ReconciliationMatch.transaction_id == tx.id,
                    and_(
                        ReconciliationMatch.target_type == match.target_type,
                        ReconciliationMatch.target_id == match.target_id,
                    ),
                ),
            )
        )
        if taken is not None:
            raise Conflict(
                "That transaction or record is already matched elsewhere; undo that match first."
            )
        match.status = MatchStatus.CONFIRMED.value
        match.decided_by_user_id = actor_user_id
        match.decided_at = self._now()
        try:
            await self._db.execute(
                delete(ReconciliationMatch).where(
                    ReconciliationMatch.transaction_id == tx.id,
                    ReconciliationMatch.status == MatchStatus.SUGGESTED.value,
                    ReconciliationMatch.id != match.id,
                )
            )
            tx.status = TransactionStatus.MATCHED.value
            self._audit("banking.match_confirmed", match, actor_user_id)
            await self._db.commit()
        except IntegrityError as exc:  # a concurrent confirmation won the race
            await self._db.rollback()
            raise Conflict("That record was just matched elsewhere; refresh and retry.") from exc

    async def _refresh_status(self, tx: BankTransaction) -> None:
        if tx.status == TransactionStatus.IGNORED.value:
            return
        live = await self._db.scalars(
            select(ReconciliationMatch.status).where(
                ReconciliationMatch.transaction_id == tx.id,
                ReconciliationMatch.status != MatchStatus.REJECTED.value,
            )
        )
        statuses = set(live)
        tx.status = (
            TransactionStatus.MATCHED.value
            if MatchStatus.CONFIRMED.value in statuses
            else TransactionStatus.SUGGESTED.value
            if MatchStatus.SUGGESTED.value in statuses
            else TransactionStatus.UNMATCHED.value
        )

    def _audit(self, action: str, match: ReconciliationMatch, actor_user_id: uuid.UUID) -> None:
        AuditRecorder(self._db).record(
            action,
            actor_user_id=actor_user_id,
            workspace_id=match.workspace_id,
            target_type="bank_transaction",
            target_id=match.transaction_id,
            details={"target_type": match.target_type, "target_id": str(match.target_id)},
        )

    async def confirm(
        self, workspace_id: uuid.UUID, match_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> ReconciliationMatch:
        match = await self.get_match(workspace_id, match_id)
        tx = await self.get_transaction(workspace_id, match.transaction_id)
        if tx.status == TransactionStatus.IGNORED.value:
            raise Conflict("Restore the transaction before matching it.")
        if not await self.describe_targets(workspace_id, [(match.target_type, match.target_id)]):
            raise NotFound("The matched record no longer exists.")
        await self._apply_confirmation(tx, match, actor_user_id)
        return match

    async def reject(
        self, workspace_id: uuid.UUID, match_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> ReconciliationMatch:
        match = await self.get_match(workspace_id, match_id)
        if match.status == MatchStatus.CONFIRMED.value:
            raise Conflict("Undo the confirmed match instead.")
        tx = await self.get_transaction(workspace_id, match.transaction_id)
        match.status = MatchStatus.REJECTED.value
        match.decided_by_user_id = actor_user_id
        match.decided_at = self._now()
        await self._db.flush()
        await self._refresh_status(tx)
        self._audit("banking.match_rejected", match, actor_user_id)
        await self._db.commit()
        return match

    async def unmatch(
        self, workspace_id: uuid.UUID, match_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> None:
        """Removes a match (it may be suggested again by the next reconciliation run)."""
        match = await self.get_match(workspace_id, match_id)
        tx = await self.get_transaction(workspace_id, match.transaction_id)
        self._audit("banking.match_removed", match, actor_user_id)
        await self._db.delete(match)
        await self._db.flush()
        await self._refresh_status(tx)
        await self._db.commit()

    async def manual_match(
        self,
        workspace_id: uuid.UUID,
        tx: BankTransaction,
        target_type: TargetType,
        target_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> ReconciliationMatch:
        if tx.status == TransactionStatus.IGNORED.value:
            raise Conflict("Restore the transaction before matching it.")
        if not await self.describe_targets(workspace_id, [(target_type.value, target_id)]):
            raise NotFound("Record not found in this workspace.")
        mine = (await self._matches_by_transaction([tx.id]))[tx.id]
        match = mine.get((target_type.value, target_id))
        if match is None:
            match = ReconciliationMatch(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                transaction_id=tx.id,
                target_type=target_type.value,
                target_id=target_id,
                rule="manual",
                confidence=Decimal(1),
                reasons=["Matched manually."],
                status=MatchStatus.SUGGESTED.value,
            )
            self._db.add(match)
        await self._apply_confirmation(tx, match, actor_user_id)
        return match

    async def review_queue(
        self, workspace_id: uuid.UUID, limit: int = 100
    ) -> list[BankTransaction]:
        return list(
            await self._db.scalars(
                select(BankTransaction)
                .where(
                    BankTransaction.workspace_id == workspace_id,
                    BankTransaction.status == TransactionStatus.SUGGESTED.value,
                )
                .order_by(BankTransaction.booking_date.desc(), BankTransaction.id)
                .limit(limit)
            )
        )

    async def describe_targets(
        self, workspace_id: uuid.UUID, pairs: Iterable[Pair]
    ) -> dict[Pair, TargetInfo]:
        """Display data for match targets, restricted to the workspace (ownership check)."""
        wanted: dict[str, set[uuid.UUID]] = defaultdict(set)
        for target_type, target_id in pairs:
            wanted[target_type].add(target_id)
        found: dict[Pair, TargetInfo] = {}
        if ids := wanted.get(TargetType.INVOICE.value):
            for inv in await self._db.scalars(
                select(Invoice).where(Invoice.workspace_id == workspace_id, Invoice.id.in_(ids))
            ):
                found[(TargetType.INVOICE.value, inv.id)] = TargetInfo(
                    TargetType.INVOICE.value,
                    inv.id,
                    f"Invoice {inv.series_name} {inv.number or '(pending)'} · {inv.client_name}",
                    inv.issue_date,
                    inv.net_amount.quantize(CENT),
                    inv.currency,
                )
        if ids := wanted.get(TargetType.EXPENSE.value):
            for e in await self._db.scalars(
                select(Expense).where(Expense.workspace_id == workspace_id, Expense.id.in_(ids))
            ):
                found[(TargetType.EXPENSE.value, e.id)] = TargetInfo(
                    TargetType.EXPENSE.value,
                    e.id,
                    f"Expense · {e.vendor}",
                    e.expense_date,
                    e.amount,
                    e.currency,
                )
        if ids := wanted.get(TargetType.DOCUMENT.value):
            for d in await self._db.scalars(
                select(Document).where(Document.workspace_id == workspace_id, Document.id.in_(ids))
            ):
                found[(TargetType.DOCUMENT.value, d.id)] = TargetInfo(
                    TargetType.DOCUMENT.value,
                    d.id,
                    f"Document · {d.vendor or d.title}",
                    d.document_date or d.created_at.date(),
                    d.amount or Decimal(0),
                    d.currency or "",
                )
        return found
