"""Replaceable bank statement parsers (ADR-021).

Only a header-driven generic CSV parser exists. Bank-specific parsers must be written from real
export samples; none is guessed. Parsing is pure (no I/O, no database) so previews have no side
effects.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

MAX_STATEMENT_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000
HEADER_SCAN_LINES = 40

DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%y", "%Y%m%d")


@dataclass(frozen=True, slots=True)
class ParsedRow:
    line: int
    booking_date: date
    value_date: date | None
    amount: Decimal  # signed, 2 decimals
    currency: str
    description: str
    counterparty: str
    reference: str


@dataclass(frozen=True, slots=True)
class RowError:
    line: int
    message: str


@dataclass(slots=True)
class ParseResult:
    parser: str
    columns: dict[str, str]  # field -> header text found in the file
    rows: list[ParsedRow] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    total_rows: int = 0


class StatementParser(Protocol):
    name: str

    def parse(self, text: str, default_currency: str) -> ParseResult: ...


class StatementError(ValueError):
    """The file cannot be parsed at all (as opposed to individual bad rows)."""


# ---------------------------------------------------------------------- helpers


def normalize(value: str) -> str:
    """Lowercase ASCII words separated by single spaces (diacritics removed)."""
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.casefold()).strip()


def decode(content: bytes) -> str:
    """UTF-8 (with or without BOM), falling back to Windows-1250 (common in Romanian exports)."""
    for encoding in ("utf-8-sig", "cp1250"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise StatementError("The file is not UTF-8 or Windows-1250 text.")


def parse_date(raw: str) -> date | None:
    value = raw.strip()
    if not value:
        return None
    value = re.split(r"[ T]", value, maxsplit=1)[0]  # drop a time part
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


_AMOUNT_JUNK = re.compile(r"[A-Za-z\s\u00a0'\u2019]")  # letters, spaces, NBSP, quotes


def detect_decimal_separator(samples: list[str]) -> str:
    """Majority vote: ',' when most values end in ',d' or ',dd', otherwise '.'."""
    comma = dot = 0
    for raw in samples:
        value = _AMOUNT_JUNK.sub("", raw).strip("()+-")
        if re.search(r",\d{1,2}$", value):
            comma += 1
        elif re.search(r"\.\d{1,2}$", value):
            dot += 1
    return "," if comma > dot else "."


def parse_amount(raw: str, decimal_sep: str) -> Decimal | None:
    value = _AMOUNT_JUNK.sub("", raw)
    if not value:
        return None
    negative = value.startswith("-") or value.endswith("-") or value.startswith("(")
    value = value.strip("()+-")
    thousands = "." if decimal_sep == "," else ","
    value = value.replace(thousands, "").replace(decimal_sep, ".")
    if not re.fullmatch(r"\d+(\.\d+)?", value):
        return None
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return None
    if amount != amount.quantize(Decimal("0.01")):
        return None  # more than 2 significant decimals: not a bank amount
    amount = amount.quantize(Decimal("0.01"))
    return -amount if negative else amount


def fingerprint(account_id: uuid.UUID, row: ParsedRow, occurrence: int) -> str:
    """Stable identity of a statement line; `occurrence` separates genuinely identical rows."""
    parts = (
        str(account_id),
        row.booking_date.isoformat(),
        str(row.amount),
        row.currency,
        normalize(row.description),
        normalize(row.counterparty),
        normalize(row.reference),
        str(occurrence),
    )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


# ------------------------------------------------------------------- generic CSV

# Normalized header text -> field. Exact matches only:
# "valuta" = currency, but "data valuta" = value date.
ALIASES: dict[str, str] = {}
for _field, _names in {
    "booking_date": (
        "date",
        "booking date",
        "transaction date",
        "posting date",
        "data",
        "data tranzactie",
        "data tranzactiei",
        "data operatiunii",
        "data operatiune",
        "data inregistrare",
        "data contabila",
        "data inregistrarii",
    ),
    "value_date": ("value date", "data valuta", "data valutei", "data decontarii"),
    "amount": ("amount", "suma", "valoare", "sum", "value", "transaction amount"),
    "debit": ("debit", "debit amount", "suma debit", "plati", "iesiri", "withdrawal", "money out"),
    "credit": (
        "credit",
        "credit amount",
        "suma credit",
        "incasari",
        "intrari",
        "deposit",
        "money in",
    ),
    "currency": ("currency", "valuta", "moneda", "ccy"),
    "description": (
        "description",
        "descriere",
        "detalii",
        "details",
        "explicatii",
        "detalii tranzactie",
        "narrative",
        "memo",
        "transaction details",
        "tranzactie",
    ),
    "counterparty": (
        "counterparty",
        "beneficiary",
        "payee",
        "beneficiar",
        "platitor",
        "nume beneficiar",
        "contrapartida",
        "partener",
        "merchant",
        "nume",
        "name",
    ),
    "reference": (
        "reference",
        "referinta",
        "ref",
        "transaction id",
        "id tranzactie",
        "numar referinta",
        "nr referinta",
    ),
}.items():
    for _name in _names:
        ALIASES[_name] = _field


def _sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample else ""
        return max(",;\t|", key=first.count)


def _find_header(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    """The first line (within the preamble window) naming a date and an amount column."""
    for index, row in enumerate(rows[:HEADER_SCAN_LINES]):
        mapping: dict[str, int] = {}
        for column, cell in enumerate(row):
            name = ALIASES.get(normalize(cell))
            if name and name not in mapping:
                mapping[name] = column
        has_amount = "amount" in mapping or "debit" in mapping or "credit" in mapping
        if "booking_date" in mapping and has_amount:
            return index, mapping
    return None


class GenericCsvParser:
    """Header-driven CSV parser: finds columns by name, tolerates a preamble before the header."""

    name = "generic_csv"

    def parse(self, text: str, default_currency: str) -> ParseResult:
        delimiter = _sniff_delimiter(text[:8192])
        table = list(csv.reader(io.StringIO(text), delimiter=delimiter))
        found = _find_header(table)
        if found is None:
            raise StatementError(
                "No header row with a date column and an amount (or debit/credit) column was "
                "found. Supported names include Date/Data, Amount/Suma, Debit, Credit."
            )
        header_index, mapping = found
        header = table[header_index]
        result = ParseResult(
            parser=self.name, columns={f: header[i].strip() for f, i in mapping.items()}
        )
        body = [
            (header_index + 2 + offset, row)  # 1-based file line numbers
            for offset, row in enumerate(table[header_index + 1 :])
            if any(cell.strip() for cell in row)
        ]
        if len(body) > MAX_ROWS:
            raise StatementError(f"The statement has more than {MAX_ROWS} rows; split it.")
        result.total_rows = len(body)

        def cell(row: list[str], name: str) -> str:
            return _cell(row, mapping, name)

        samples = [cell(r, n) for _, r in body for n in ("amount", "debit", "credit")]
        decimal_sep = detect_decimal_separator([s for s in samples if s])

        for line, row in body:
            booking = parse_date(cell(row, "booking_date"))
            if booking is None:
                result.errors.append(RowError(line, "Missing or unrecognized date."))
                continue
            amount = _row_amount(row, mapping, decimal_sep)
            if amount is None:
                result.errors.append(RowError(line, "Missing or unrecognized amount."))
                continue
            if amount == 0:
                result.errors.append(RowError(line, "Zero amount skipped."))
                continue
            currency = (cell(row, "currency") or default_currency).upper()
            if not re.fullmatch(r"[A-Z]{3}", currency):
                result.errors.append(RowError(line, f"Unrecognized currency {currency!r}."))
                continue
            result.rows.append(
                ParsedRow(
                    line=line,
                    booking_date=booking,
                    value_date=parse_date(cell(row, "value_date")),
                    amount=amount,
                    currency=currency,
                    description=cell(row, "description")[:500],
                    counterparty=cell(row, "counterparty")[:200],
                    reference=cell(row, "reference")[:100],
                )
            )
        return result


def _cell(row: list[str], mapping: dict[str, int], name: str) -> str:
    index = mapping.get(name)
    return row[index].strip() if index is not None and index < len(row) else ""


def _row_amount(row: list[str], mapping: dict[str, int], decimal_sep: str) -> Decimal | None:
    """A single signed amount column, or separate debit/credit columns (debit = money out)."""
    single = _cell(row, mapping, "amount")
    if single:
        return parse_amount(single, decimal_sep)
    debit_raw, credit_raw = _cell(row, mapping, "debit"), _cell(row, mapping, "credit")
    debit = parse_amount(debit_raw, decimal_sep) if debit_raw else None
    credit = parse_amount(credit_raw, decimal_sep) if credit_raw else None
    if debit is None and credit is None:
        return None
    return (credit or Decimal(0)).copy_abs() - (debit or Decimal(0)).copy_abs()


PARSERS: dict[str, StatementParser] = {GenericCsvParser.name: GenericCsvParser()}


def parse_statement(
    content: bytes, default_currency: str, parser: str = "generic_csv"
) -> ParseResult:
    if len(content) > MAX_STATEMENT_BYTES:
        raise StatementError("Statement files are limited to 5 MB.")
    if not content.strip():
        raise StatementError("The file is empty.")
    implementation = PARSERS.get(parser)
    if implementation is None:
        raise StatementError(f"Unknown statement format {parser!r}.")
    return implementation.parse(decode(content), default_currency)
